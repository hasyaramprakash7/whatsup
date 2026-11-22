// Runs one customer's conversation through the business's flow, with the AI for typed questions.
// Called by ConversationDO (one per chat), which persists `state` and guarantees one message at a time.
import { fill, normalizePhone } from './text.js';
import { stepById, stepAfter } from './flow.js';
import { DEFAULT_MESSAGES } from './templates.js';
import { buildVisitSlots, parseSlotId, formatSlotLong } from './slots.js';
import { aiDecide } from './ai.js';
import { upsertLead, recentTurns, takeAiReply, listCatalog, itemCaption, layoutOf } from './db.js';
import { publish } from './chatlog.js';
import { detailsShort, hasPin, areasOf, inArea } from './itemfields.js';
import { geocode, reverseGeocode, distanceKm, kmLabel, mapsLink } from './geo.js';

const MAX_UNEXPECTED = 2;              // re-ask this many times, then hand over to a person
const STATE_TTL_MS = 24 * 3600 * 1000;  // a conversation idle this long starts over
const OPT_OUT_TEXTS = ['stop', 'unsubscribe', 'opt out', 'optout', 'not interested'];
const STATUS_RANK = { NEW: 0, CONTACTED: 1, ENGAGED: 2, QUALIFIED: 3, CONVERTED: 4, COLD: -1 };

export const freshState = () => ({ stepId: null, unexpected: 0, done: false, updatedAt: Date.now() });

export function interactiveIdOf(message) {
  if (message?.type === 'interactive') return message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || null;
  if (message?.type === 'button') return message.button?.payload || null;
  return null;
}
const textOf = (message) => (message?.type === 'text' ? message.text?.body || '' : message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title || message?.button?.text || '');

/** Case, punctuation and extra spaces are ignored, so "Stop." or "NOT interested!!" also opt out. */
export function isOptOut(message) {
  if (interactiveIdOf(message) === 'NOT_INTERESTED') return true;
  const t = (message?.text?.body || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return OPT_OUT_TEXTS.includes(t);
}

/** "ok", "thanks", "👍" and similar: nothing to answer, so the bot doesn't keep replying to them. */
const ACK_TEXTS = new Set(['ok', 'okay', 'okk', 'okkk', 'ok ok', 'k', 'kk', 'fine', 'cool', 'great', 'nice', 'sure', 'done', 'got it', 'noted', 'alright', 'hmm', 'hm', 'yes', 'yeah', 'yep', 'thanks', 'thank you', 'thankyou', 'thanx', 'thnx', 'thx', 'ty', 'tq', 'ok thanks', 'ok thank you', 'okay thanks', 'thanks a lot', 'welcome', 'bye', 'good', 'perfect', 'super']);
export function isAck(message) {
  if (message?.type === 'reaction') return true;
  if (message?.type !== 'text') return false;
  const raw = (message.text?.body || '').trim();
  if (raw && !/[\p{L}\p{N}]/u.test(raw)) return true; // only emoji / punctuation
  return ACK_TEXTS.has(raw.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim());
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class Conversation {
  /**
   * ctx: { env, tenant, lead, state, phone, bot, ai, admin } where bot/ai/admin are WhatsAppClients
   * (bot and ai log to the Inbox as "bot" / "ai"; admin is for team alerts and is not logged).
   */
  constructor(ctx) {
    Object.assign(this, ctx);
    this.flow = ctx.tenant.flow || {};
    this.flow.steps = this.flow.steps || [];
    this.messages = { ...DEFAULT_MESSAGES, ...(this.flow.messages || {}) };
    this.aiCfg = ctx.tenant.ai || {};
    if (!this.state || Date.now() - (this.state.updatedAt || 0) > STATE_TTL_MS) this.state = freshState();
  }

  // ---------- helpers ----------
  vars(extra = {}) {
    const p = this.tenant.profile || {};
    return { business: p.displayName || this.tenant.businessName, name: this.lead?.name || 'there', address: p.address || '', adminPhone: this.tenant.adminNotificationPhone, ...(this.lead?.data || {}), ...extra };
  }
  t(text, extra) { return fill(text, this.vars(extra)); }
  msg(key) { return this.t(this.messages[key]); }

  async saveLead(opts) {
    this.lead = await upsertLead(this.env, this.tenant._id, this.phone, opts);
    await publish(this.env, this.tenant._id, 'lead:update', { lead: this.lead });
    return this.lead;
  }
  /** Moves the lead forward (never backwards) through NEW → … → CONVERTED. */
  async raiseStatus(status) {
    if (!status) return;
    const cur = this.lead?.status || 'NEW';
    if (cur === 'COLD' || STATUS_RANK[status] > (STATUS_RANK[cur] ?? 0)) await this.saveLead({ set: { status } });
  }

  /** Active products/services of the selected layout, loaded once per message. */
  async catalog() {
    if (!this._catalog) {
      const items = await listCatalog(this.env, this.tenant._id, { activeOnly: true, layout: layoutOf(this.tenant) });
      const at = this.state.point; const area = this.state.area?.key;
      if (at || area) { // the chosen area first, then nearest; items without a pin keep their order at the end
        if (at) for (const it of items) if (hasPin(it)) it.km = distanceKm(at, { lat: it.details.lat, lng: it.details.lng });
        items.sort((a, b) => (inArea(b, area) - inArea(a, area)) || (a.km ?? Infinity) - (b.km ?? Infinity));
      }
      this._catalog = items;
    }
    return this._catalog;
  }
  async item(id) { return id ? (await this.catalog()).find((x) => x._id === id) || null : null; }

  /** Sends each item as a photo with its name, price and description (text-only if it has no photo). */
  async sendItems(items, client = this.bot) {
    for (const it of items.slice(0, 10)) await this.sendItem(it, '', client);
  }

  /** One product as one message: its photo with the caption (and an optional lead-in text above it). */
  async sendItem(it, lead = '', client = this.bot) {
    const caption = `${lead ? `${lead}\n\n` : ''}${itemCaption(it)}`.slice(0, 1024);
    try {
      if (it.imageUrl) await client.image(this.phone, it.imageUrl, caption);
      else await client.text(this.phone, caption);
    } catch (e) { console.warn('[Flow] item photo failed', e.message); }
  }

  /**
   * Several products as ONE list message: the customer taps one to get its photo.
   * Every message the bot sends is billed by WhatsApp, so this costs 1 message instead of one per photo.
   */
  async sendItemList(items, body = '', client = this.bot) {
    const list = items.slice(0, 10);
    const fit = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
    try {
      await client.list(this.phone, {
        body: (body || 'Tap below to see photos and prices 👇').slice(0, 1024),
        button: 'View photos',
        sections: [{ title: 'Tap one to see it', rows: list.map((it) => ({ id: `ITEM_${it._id}`, title: fit(it.name, 24), description: fit([it.km != null && `${kmLabel(it.km)} away`, it.price, detailsShort(it), it.description].filter(Boolean).join(' · ').replace(/\s+/g, ' '), 72) || undefined })) }],
      });
    } catch (e) { console.warn('[Flow] item list failed', e.message); }
  }

  /** One product → its photo; several → a tap-to-open list. `lead` is shown with it (caption or list text). */
  async showItems(items, lead = '', client = this.bot) {
    if (!items.length) return lead ? client.text(this.phone, lead) : null;
    if (items.length === 1) return this.sendItem(items[0], lead, client);
    return this.sendItemList(items, lead, client);
  }

  async aiAvailable(message) {
    if (!this.aiCfg.enabled || !textOf(message) || message.type !== 'text') return false;
    return takeAiReply(this.env, this.tenant._id, this.aiCfg.dailyLimit ?? 300);
  }

  // ---------- entry point ----------
  /** Handles one inbound message. Returns the new state for the Durable Object to store. */
  async handle(message) {
    const iid = interactiveIdOf(message);
    if (isOptOut(message)) {
      await this.saveLead({ set: { status: 'COLD' } });
      await this.bot.text(this.phone, this.msg('optOut')).catch(() => {});
      return freshState();
    }

    // Tapped a product in a photo list: send that one photo. Where they are in the flow doesn't change,
    // and the question above stays tappable, so nothing is repeated (each message costs money).
    if (iid?.startsWith('ITEM_')) {
      const it = await this.item(iid.slice(5));
      if (it) { this.state.itemId = it._id; await this.sendItem(it); }
      else await this.bot.text(this.phone, 'Sorry, that one is no longer available.').catch(() => {});
      return this.touch();
    }

    try {
      const flowOn = this.flow.enabled !== false && this.flow.steps.length > 0;
      if (!flowOn) { await this.afterFlow(message); return this.touch(); }

      if (!this.state.stepId) {
        const first = this.flow.steps[0];
        // A quick-reply button on the broadcast template can answer the first question directly.
        if (iid && first.type === 'choice' && first.options.some((o) => o.id === iid)) this.state.stepId = first.id;
        else if (this.state.done) { await this.afterFlow(message); return this.touch(); }
        else { await this.raiseStatus('ENGAGED'); await this.advance(null); return this.touch(); }
      }

      const step = stepById(this.flow, this.state.stepId);
      if (!step) { this.state = freshState(); await this.advance(null); return this.touch(); }

      const r = step.type === 'question' && step.input === 'location' ? await this.answerLocation(message) : this.answer(step, message);
      if (r?.prompted) { // "Other location": ask for a pin or a pincode, stay on this step
        await this.bot.locationRequest(this.phone, 'Tap *Send location* below, or type your pincode or area name 📍').catch(() => {});
      } else if (r?.location) {
        await this.unexpected(step, message, false); // not a place we know: the AI may still match it to one of our areas
      } else if (r?.passed) {
        await this.bot.text(this.phone, this.msg('slotPassed'));
        await this.ask(step);
      } else if (r && !r.invalid) {
        await this.accept(step, r);
      } else {
        await this.unexpected(step, message, !!r?.invalid);
      }
    } catch (err) {
      console.error(`[Flow] +${this.phone}:`, err.message);
      await this.bot.text(this.phone, this.msg('error')).catch(() => {});
    }
    return this.touch();
  }

  touch() { this.state.updatedAt = Date.now(); return this.state; }

  // ---------- steps ----------
  /** Sends the question for a step that waits for an answer. */
  async ask(step) {
    const text = this.t(step.text);
    if (step.type === 'choice') {
      const photo = (await this.item(step.imageItemId))?.imageUrl || null;
      step = await this.nearestOptions(step);
      if (step.forceList || step.options.length > 3) {
        // WhatsApp lists can't carry a photo, so it goes just before the list.
        if (photo) await this.bot.image(this.phone, photo).catch((e) => console.warn('[Flow] photo failed', e.message));
        return this.bot.list(this.phone, {
          header: this.t(step.listHeader || 'Choose an option'), body: text, button: this.t(step.listButton || 'View options'),
          sections: [{ title: this.t(step.listSection || 'Options'), rows: step.options.map((o) => ({ id: o.id, title: o.title, ...(o.description ? { description: o.description } : {}) })) }],
        });
      }
      return this.bot.buttons(this.phone, text, step.options.map((o) => ({ id: o.id, title: o.title })), photo);
    }
    if (step.type === 'slots') {
      const slots = buildVisitSlots(new Date(), 3, step.plan);
      return this.bot.buttons(this.phone, text, slots.map((s) => ({ id: s.id, title: s.title })));
    }
    if (step.type === 'question' && step.input === 'location') {
      const areas = areasOf(await this.catalog()).slice(0, 9);
      if (areas.length) {
        // Our locations to pick from; typing a pincode/area or choosing "Other location" also works.
        const fit = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
        return this.bot.list(this.phone, {
          header: 'Our locations', body: text, button: 'Choose area',
          sections: [{ title: 'Areas', rows: [
            ...areas.map((a) => ({ id: `AREA_${a.key}`.slice(0, 200), title: fit(a.name, 24), description: fit([`${a.count} ${a.count === 1 ? 'project' : 'projects'}`, a.pincodes.join(', ')].filter(Boolean).join(' · '), 72) })),
            { id: 'LOC_OTHER', title: '📍 Other location', description: 'Share your location or type a pincode' },
          ] }],
        }).catch(() => this.bot.locationRequest(this.phone, text));
      }
      // No locations on products yet: "Send location" button; typing an area name or pincode also works.
      return this.bot.locationRequest(this.phone, text).catch(() => this.bot.text(this.phone, text));
    }
    return this.bot.text(this.phone, text);
  }

  /** The place the customer gave (for the AI), e.g. "Kokapet, Hyderabad 500075". */
  customerPlace() {
    if (this.state.area) return this.state.area.name;
    if (!this.state.point) return null;
    const f = this.flow.steps.find((s) => s.type === 'question' && s.input === 'location');
    return (f && this.lead?.data?.[f.field]) || 'shared on WhatsApp';
  }

  /** Options linked to products with a pin are shown nearest first (with "2.4 km away" in lists). */
  async nearestOptions(step) {
    if (!(this.state.point || this.state.area) || !step.options.some((o) => o.itemId)) return step;
    const all = await this.catalog();
    const itemOf = (o) => all.find((x) => x._id === o.itemId);
    const km = (o) => itemOf(o)?.km;
    let opts = step.options;
    const keep = (test) => { const f = opts.filter((o) => !o.itemId || test(itemOf(o))); if (f.some((o) => o.itemId)) opts = f; };
    // Only that area's projects (when it has any)…
    if (this.state.area) keep((it) => it && inArea(it, this.state.area.key));
    // …of the home type they asked for (e.g. "3 BHK"), when products say what they are.
    const want = String(this.lead?.data?.configuration || '').toLowerCase();
    if (want) keep((it) => { const c = String(it?.details?.config || '').toLowerCase(); return !c || want.includes(c) || c.includes(want); }); // '4 BHK / Villa' matches '4 BHK' and 'Villa'
    const options = opts.map((o, i) => ({ ...o, _i: i, _km: km(o) }))
      .sort((a, b) => (a._km ?? Infinity) - (b._km ?? Infinity) || a._i - b._i)
      .map(({ _i, _km, ...o }) => (_km != null ? { ...o, description: [`${kmLabel(_km)} away`, o.description].filter(Boolean).join(' · ').slice(0, 72) } : o));
    return { ...step, options };
  }

  /** Shared pin → nearest place name; typed area/pincode → looked up. Returns an answer, { invalid } or null. */
  async answerLocation(message) {
    const areas = areasOf(await this.catalog());
    const pick = (a, point = a.center) => ({ value: a.name, area: { key: a.key, name: a.name }, point });
    const nearArea = (p) => { // our area within 8 km of a point, if any
      let best = null;
      for (const a of areas) if (a.center) { const km = distanceKm(p, a.center); if (km <= 8 && (!best || km < best.km)) best = { a, km }; }
      return best?.a || null;
    };
    const iid = interactiveIdOf(message);
    if (iid === 'LOC_OTHER') return { prompted: true };
    if (iid?.startsWith('AREA_')) { const a = areas.find((x) => x.key === iid.slice(5)); return a ? pick(a) : null; }
    if (message.type === 'location') {
      const l = message.location || {};
      const lat = Number(l.latitude); const lng = Number(l.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const point = { lat, lng }; const a = nearArea(point);
      if (a) return pick(a, point);
      const label = [l.name, l.address].filter(Boolean).join(', ') || await reverseGeocode(this.env, lat, lng);
      return { value: label.slice(0, 120), point };
    }
    if (message.type !== 'text') return null;
    const text = textOf(message).trim();
    if (!text || text.length > 120) return null; // a question, not a place: let the AI answer it
    const low = text.toLowerCase().replace(/\s+/g, ' ');
    // 1) one of our areas or pincodes, by name
    const pin = /\b\d{6}\b/.exec(text)?.[0];
    const byText = areas.find((a) => (pin && a.pincodes.includes(pin)) || (low.length >= 3 && (a.key.includes(low) || low.includes(a.key))));
    if (byText) return pick(byText);
    // 2) any place: look it up, then use our nearest area (if close) or just sort by distance
    const g = await geocode(this.env, text);
    if (!g) return { invalid: true, location: true };
    const point = { lat: g.lat, lng: g.lng }; const a = nearArea(point);
    return a ? pick(a, point) : { value: g.label || text, point };
  }

  /** Runs steps after `from` (or from the start) until one needs an answer or the flow finishes. */
  async advance(from, explicitNext = null) {
    let step = from ? stepAfter(this.flow, from, explicitNext) : this.flow.steps[0];
    while (step) {
      if (step.type === 'send') { await this.sendContent(step); step = stepAfter(this.flow, step); continue; }
      if (step.type === 'finish') { await this.finish(step); return; }
      await this.ask(step);
      this.state.stepId = step.id;
      this.state.unexpected = 0;
      return;
    }
    this.state.stepId = null;
    this.state.done = true;
  }

  async sendContent(step) {
    const p = this.tenant.profile || {};
    const business = p.displayName || this.tenant.businessName;
    if (step.kind === 'document') {
      await this.sendDocument(this.bot, this.t(step.text) || undefined);
    } else if (step.kind === 'catalog') {
      const all = await this.catalog();
      const items = step.itemIds?.length
        ? step.itemIds.map((id) => all.find((x) => x._id === id)).filter(Boolean)
        : all.filter((x) => !step.category || x.category.toLowerCase() === step.category.toLowerCase());
      if (!items.length) return; // nothing added yet
      if (step.display === 'photos') { // every photo at once (one billed message each)
        if (step.text) await this.bot.text(this.phone, this.t(step.text));
        await this.sendItems(items);
      } else await this.showItems(items, this.t(step.text || ''));
    } else if (step.kind === 'location') {
      // The project/branch the customer chose has its own pin → send that one; otherwise the business pin.
      const chosen = await this.item(this.state.itemId);
      if (hasPin(chosen)) {
        const d = chosen.details;
        return this.bot.location(this.phone, { latitude: d.lat, longitude: d.lng, name: chosen.name, address: d.address || p.address || '' }).catch((e) => console.warn('[Flow] location failed', e.message));
      }
      if (p.latitude == null || p.longitude == null) return;
      await this.bot.location(this.phone, { latitude: p.latitude, longitude: p.longitude, name: business, address: p.address || '' }).catch((e) => console.warn('[Flow] location failed', e.message));
    } else if (step.text) {
      await this.bot.text(this.phone, this.t(step.text));
    }
  }

  /** The uploaded brochure/menu PDF (no-op if none). */
  async sendDocument(client, caption) {
    const p = this.tenant.profile || {};
    if (!p.documentUrl) return false;
    const base = this.t(p.documentName || p.displayName || this.tenant.businessName).replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Document';
    try { await client.document(this.phone, p.documentUrl, `${base}.pdf`, caption); return true; }
    catch (e) { console.warn('[Flow] document failed', e.message); return false; }
  }

  /** Sends what the AI decided: its reply, then the brochure and product photos it asked for. */
  // The reply travels inside the photo caption (1 product) or the list text (several), so a product
  // answer is a single message instead of a text plus one photo each.
  async sendAi(d) {
    const all = await this.catalog();
    const items = (d.itemIds || []).map((id) => all.find((x) => x._id === id)).filter(Boolean);
    if (items.length) await this.showItems(items, d.reply, this.ai);
    else if (d.reply) await this.ai.text(this.phone, d.reply);
    if (d.sendDocument) await this.sendDocument(this.ai);
  }

  async finish(step) {
    await this.bot.text(this.phone, this.t(step.text));
    await this.raiseStatus('CONVERTED');
    this.state.stepId = null;
    this.state.done = true;
    if (step.alertTeam !== false) {
      const fields = this.fieldSummary();
      await this.alertTeam({
        headline: 'New booking',
        details: fields.map(([l, v]) => `${l}: ${v}`).join(' · ') || 'Completed the conversation',
        text: `🎉 *NEW ${String(this.tenant.profile?.displayName || this.tenant.businessName).toUpperCase()} LEAD*\n\n• *Name:* ${this.lead.name || '—'}\n• *Phone:* +${this.phone}\n${fields.map(([l, v]) => `• *${l}:* ${v}`).join('\n')}`,
      });
    }
  }

  fieldSummary() {
    return this.flow.steps.filter((s) => s.field && this.lead?.data?.[s.field]).map((s) => [s.label || s.field, this.lead.data[s.field]]);
  }

  /** Parses a reply for the waiting step. null = not an answer; { invalid } = wrong format; { passed } = expired slot. */
  answer(step, message) {
    const iid = interactiveIdOf(message);
    const text = textOf(message).trim();
    if (step.type === 'choice') {
      const lower = text.toLowerCase();
      const opt = step.options.find((o) => o.id === iid) || (text && step.options.find((o) => o.title.toLowerCase() === lower || o.label.toLowerCase() === lower));
      return opt ? { value: opt.label, next: opt.next, itemId: opt.itemId || null } : null;
    }
    if (step.type === 'slots') {
      const at = parseSlotId(iid);
      if (!at) return null;
      if (at.getTime() <= Date.now()) return { passed: true };
      return { value: formatSlotLong(at), bookedAt: at.toISOString() };
    }
    if (step.type === 'question') {
      if (!text) return null;
      switch (step.input) {
        case 'name': return /^[\p{L}][\p{L} .'-]{1,79}$/u.test(text) ? { value: text.replace(/\s+/g, ' '), isName: true } : { invalid: true };
        case 'email': return EMAIL_RE.test(text) ? { value: text.toLowerCase() } : { invalid: true };
        case 'phone': { const p = normalizePhone(text); return p ? { value: `+${p}` } : { invalid: true }; }
        case 'number': return /^\d+(\.\d+)?$/.test(text.replace(/[, ]/g, '')) ? { value: text.replace(/[, ]/g, '') } : { invalid: true };
        default: return text.length <= 1000 ? { value: text } : { invalid: true };
      }
    }
    return null;
  }

  async accept(step, r) {
    const set = {};
    if (r.isName || step.field === 'name') set.name = r.value;
    if (r.bookedAt) set.bookedAt = r.bookedAt;
    if (r.point) this.state.point = r.point; // nearest projects first from now on
    if (r.area) this.state.area = r.area;    // and only that area's projects, when it has some
    await this.saveLead({ set, mergeData: { [step.field]: r.value, ...(r.point ? { [`${step.field}_map`]: mapsLink(r.point) } : {}) } });
    this._catalog = null;
    await this.raiseStatus(step.setStatus);
    this.state.unexpected = 0;
    // The option is linked to a product/service: show its photo before moving on.
    const linked = await this.item(r.itemId);
    if (linked) this.state.itemId = linked._id; // e.g. the project whose site pin the location step sends
    if (linked) await this.sendItems([linked]);
    await this.advance(step, r.next || null);
  }

  pendingFor(step) {
    if (step.type === 'choice') return { question: this.t(step.text), options: step.options.map((o) => ({ id: o.id, title: o.title })) };
    if (step.type === 'slots') return { question: this.t(step.text), options: buildVisitSlots(new Date(), 3, step.plan).map((s) => ({ id: s.id, title: s.title })) };
    if (step.input === 'location') return { question: this.t(step.text), options: areasOf(this._catalog || []).map((a) => ({ id: `AREA_${a.key}`, title: [a.name, ...a.pincodes].join(' ') })) };
    return { question: this.t(step.text), options: [] };
  }

  /** The customer typed (or sent media) instead of answering. AI first, then nudge, then hand over. */
  async unexpected(step, message, invalid) {
    if (!invalid && await this.aiAvailable(message)) {
      const pending = this.pendingFor(step);
      const d = await aiDecide(this.env, { tenant: this.tenant, aiCfg: this.aiCfg, pending, catalog: await this.catalog(), customerPlace: this.customerPlace(), history: await recentTurns(this.env, this.tenant._id, this.phone) });
      if (d?.action === 'select') {
        const fake = { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: d.optionId } } };
        const r = step.input === 'location' ? await this.answerLocation(fake) : this.answer(step, fake);
        if (r && !r.invalid && !r.passed && !r.prompted && !r.location) return this.accept(step, r);
      }
      if (d?.action === 'answer') {
        await this.sendAi(d);
        return this.ask(step);
      }
      if (d?.action === 'handoff') return this.handoff(message, d.reply);
    }

    this.state.unexpected = (this.state.unexpected || 0) + 1;
    if (this.state.unexpected <= MAX_UNEXPECTED) {
      const tip = step.input === 'location' ? "Sorry, I couldn't find that place 🙏 Tap *Send location*, or type an area name or a 6-digit pincode." : this.msg(invalid || step.type === 'question' ? 'invalidInput' : 'nudge');
      await this.bot.text(this.phone, tip);
      return this.ask(step);
    }
    return this.handoff(message, null);
  }

  /** Photos of the products/services the AI talked about (max 3), sent as the AI. */
  /** After the flow (or with no flow): AI answers, otherwise the "completed" reply. */
  // "ok"/"thanks" get the closing message once and are then left alone (no AI call, no repeats).
  // Real questions go to the AI; without an answer the closing message is sent once, then a person takes over.
  async afterFlow(message) {
    if (isAck(message)) {
      if (this.state.done && !this.state.closed) { this.state.closed = true; await this.bot.text(this.phone, this.msg('completed')); }
      return null;
    }
    if (this.aiCfg.answerAfterFlow !== false && await this.aiAvailable(message)) {
      const d = await aiDecide(this.env, { tenant: this.tenant, aiCfg: this.aiCfg, pending: null, catalog: await this.catalog(), customerPlace: this.customerPlace(), history: await recentTurns(this.env, this.tenant._id, this.phone) });
      if (d?.action === 'handoff') return this.handoff(message, d.reply);
      if (d?.reply || d?.sendDocument) return this.sendAi(d);
    }
    if (!this.state.done) return null;
    if (!this.state.closed) { this.state.closed = true; return this.bot.text(this.phone, this.msg('completed')); }
    return this.handoff(message, null);
  }

  /** Hands the chat to the team: tells the customer, pauses the bot for this chat, alerts the team. */
  async handoff(message, aiReply) {
    if (aiReply) await this.ai.text(this.phone, aiReply);
    else await this.bot.text(this.phone, this.msg('handoff'));
    await this.saveLead({ set: { botPaused: true } });
    this.state.unexpected = 0; // when the team turns the bot back on, it continues from this step
    const said = message.type === 'text' ? (message.text?.body || '').trim() : `(sent ${/^[aeiou]/i.test(message.type) ? 'an' : 'a'} ${message.type} message)`;
    await this.alertTeam({
      headline: 'Customer needs a person',
      details: `Last message: ${said.replace(/\s+/g, ' ').slice(0, 200)}`,
      text: `📞 *CUSTOMER NEEDS A PERSON*\n\n• *Name:* ${this.lead?.name || '—'}\n• *Phone:* +${this.phone}\n• *Their message:* ${said}\n\nThe bot is paused for this chat. Reply from the Inbox.`,
    });
  }

  /** WhatsApp alert to the business's team number; result recorded on the lead. */
  async alertTeam({ headline, details, text }) {
    const tpl = this.tenant.templates || {};
    const to = this.tenant.adminNotificationPhone;
    let messageId = null; let error = null;
    try {
      const res = tpl.adminAlertName
        ? await this.admin.template(to, tpl.adminAlertName, [headline, this.lead?.name || 'Customer', `+${this.phone}`, details].map((v) => String(v || '-').replace(/\s+/g, ' ').trim() || '-'), tpl.adminAlertLanguage || 'en')
        : await this.admin.text(to, text);
      messageId = res?.messages?.[0]?.id || null;
    } catch (err) {
      error = err.text || err.message;
      console.warn('[Flow] team alert failed:', error);
    }
    await this.saveLead({ set: { adminAlertStatus: error ? 'FAILED' : 'SENT', adminAlertAt: new Date().toISOString(), adminAlertMessageId: messageId, adminAlertError: error } });
  }
}
