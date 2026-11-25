// Bulk sending (campaigns): daily limit, sending hours, template variables, Meta error handling and campaign stats.
// The sender itself runs in the BusinessHub Durable Object (src/do/hub.js); everything it decides is here.
import { nowIso, json } from './text.js';
import { newId } from './crypto.js';

const DAY = 864e5;

// ---------- daily limit ----------
const META_LIMITS = { TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: Infinity, UNLIMITED: Infinity };
/** "TIER_2K" → 2000, "TIER_UNLIMITED" → Infinity; null when unknown. */
export function parseMetaLimit(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).toUpperCase();
  if (META_LIMITS[s] !== undefined) return META_LIMITS[s];
  const m = /(\d+)\s*(K)?/.exec(s);
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : null;
}

export const DEFAULT_SENDING = { limitMode: 'auto', manualLimit: null, startHour: 9, endHour: 20, costMarketing: 0.86, costUtility: 0.12 };
export const sendingSettings = (tenant) => ({ ...DEFAULT_SENDING, ...(tenant?.sending || {}) });

/**
 * How many people may be messaged first per 24 hours.
 * auto: Meta's live limit (250 until Meta says more). manual: the number the business typed (e.g. 2000).
 */
export function dailyLimit(tenant) {
  const s = sendingSettings(tenant);
  const meta = parseMetaLimit(s.metaLimit);
  if (s.limitMode === 'manual' && Number(s.manualLimit) > 0) {
    const limit = Math.floor(Number(s.manualLimit));
    return { limit, mode: 'manual', meta, aboveMeta: meta != null && limit > meta };
  }
  return { limit: meta ?? 250, mode: 'auto', meta, aboveMeta: false };
}

/** Validates the settings form. Returns { value } or { error }. */
export function cleanSending(b, current = {}) {
  const out = { ...DEFAULT_SENDING, ...current };
  if (b.limitMode !== undefined) {
    if (!['auto', 'manual'].includes(b.limitMode)) return { error: 'Limit mode must be auto or manual.' };
    out.limitMode = b.limitMode;
  }
  if (b.manualLimit !== undefined) {
    const n = b.manualLimit === null || b.manualLimit === '' ? null : Math.floor(Number(b.manualLimit));
    if (n !== null && (!Number.isFinite(n) || n < 1 || n > 1000000)) return { error: 'Daily limit: a number from 1 to 1,000,000.' };
    out.manualLimit = n;
  }
  if (out.limitMode === 'manual' && !out.manualLimit) return { error: 'Type the daily limit, or choose Auto.' };
  for (const k of ['startHour', 'endHour']) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < 0 || n > 24) return { error: 'Sending hours: whole hours from 0 to 24.' };
    out[k] = n;
  }
  if (out.startHour >= out.endHour) return { error: 'Sending hours: the start must be before the end.' };
  for (const k of ['costMarketing', 'costUtility']) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { error: 'Price per message: a number from 0 to 100.' };
    out[k] = Math.round(n * 10000) / 10000;
  }
  return { value: out };
}

// ---------- sending hours (site time) ----------
export function offsetMs(offset = '+05:30') {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(String(offset || ''));
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000 : 330 * 60000;
}
/** { open: true } inside the sending hours, else { open: false, nextOpenAt } (ms). */
export function sendingWindow(now, settings, offset) {
  const s = { ...DEFAULT_SENDING, ...settings };
  if (s.startHour <= 0 && s.endHour >= 24) return { open: true };
  const off = offsetMs(offset);
  const local = new Date(now + off);
  const h = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (h >= s.startHour && h < s.endHour) return { open: true };
  const next = new Date(local);
  next.setUTCHours(s.startHour, 0, 0, 0);
  if (h >= s.endHour) next.setUTCDate(next.getUTCDate() + 1);
  return { open: false, nextOpenAt: next.getTime() - off };
}

/** People messaged first in the last 24 hours (Meta's rolling window) and when the next one leaves it. */
export async function usage(env, tenantId, now = Date.now()) {
  const since = new Date(now - DAY).toISOString();
  const r = await env.DB.prepare(`SELECT COUNT(DISTINCT phone) AS n, MIN(sent_at) AS oldest FROM campaign_recipients
    WHERE tenant_id = ? AND counted = 1 AND sent_at >= ? AND status IN ('sent', 'delivered', 'read')`).bind(tenantId, since).first();
  return { used: r?.n || 0, freesAt: r?.oldest ? Date.parse(r.oldest) + DAY + 60000 : null };
}

/** Days a campaign needs: today's room first, then a full limit per day. */
export function daysNeeded(waiting, room, limit) {
  if (!waiting) return 0;
  if (!Number.isFinite(limit)) return 1;
  if (waiting <= room) return 1;
  return (room > 0 ? 1 : 0) + Math.ceil((waiting - Math.max(room, 0)) / Math.max(limit, 1));
}

/** Price of one message for this template category (₹, from the business's settings). */
export function costEach(settings, category) {
  const s = { ...DEFAULT_SENDING, ...settings };
  return String(category || 'MARKETING').toUpperCase() === 'MARKETING' ? s.costMarketing : s.costUtility;
}

// ---------- templates ----------
const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const varsIn = (text) => [...new Set([...String(text || '').matchAll(VAR_RE)].map((m) => m[1]))];

/**
 * A Meta template (from /message_templates) in the shape the Broadcast page needs.
 * unsupported: why it can't be sent from here (e.g. a video header or a link button with a variable).
 */
export function templateShape(t) {
  const comps = t.components || [];
  const body = comps.find((c) => c.type === 'BODY');
  const header = comps.find((c) => c.type === 'HEADER');
  const buttons = comps.find((c) => c.type === 'BUTTONS')?.buttons || [];
  const vars = varsIn(body?.text);
  let unsupported = null;
  if (header && header.format && !['TEXT', 'IMAGE'].includes(header.format)) unsupported = `${header.format.toLowerCase()} header`;
  else if (header?.format === 'TEXT' && varsIn(header.text).length) unsupported = 'a variable in the header';
  else if (buttons.some((b) => /\{\{/.test(b.url || ''))) unsupported = 'a link button with a variable';
  else if (buttons.some((b) => ['COPY_CODE', 'OTP', 'FLOW', 'CATALOG', 'MPM'].includes(b.type))) unsupported = `a ${String(buttons.find((b) => ['COPY_CODE', 'OTP', 'FLOW', 'CATALOG', 'MPM'].includes(b.type)).type).toLowerCase().replace('_', ' ')} button`;
  return {
    name: t.name, language: t.language, category: t.category, status: t.status,
    body: body?.text || '', header: header ? { format: header.format, text: header.text || '' } : null,
    buttons: buttons.map((b) => ({ type: b.type, text: b.text })),
    vars, named: t.parameter_format === 'NAMED' || vars.some((v) => !/^\d+$/.test(v)),
    unsupported,
  };
}

/** What can fill a variable: the customer's name, the business, the campaign's project, a CSV column, fixed text. */
export const PARAM_SOURCES = ['name', 'business', 'project', 'price', 'column', 'text'];
export function cleanParams(params, shape) {
  if (!Array.isArray(params)) return { error: 'Choose what goes into each blank of the template.' };
  const out = [];
  for (const key of shape.vars) {
    const p = params.find((x) => String(x?.key) === key);
    if (!p) return { error: `Choose what goes into {{${key}}}.` };
    const src = String(p.src || '');
    if (!PARAM_SOURCES.includes(src)) return { error: `{{${key}}}: unknown choice.` };
    const arg = String(p.arg ?? '').slice(0, 200);
    if ((src === 'column' || src === 'text') && !arg.trim()) return { error: `{{${key}}}: ${src === 'column' ? 'choose the column' : 'type the text'}.` };
    out.push({ key, src, ...(arg ? { arg } : {}) });
  }
  return { value: out };
}

/** The text for each variable, for one customer. Empty values get a safe filler (Meta refuses empty ones). */
export function resolveParams(params, { name, vars, business, item }) {
  return params.map((p) => {
    const raw = p.src === 'name' ? name : p.src === 'business' ? business : p.src === 'project' ? item?.name : p.src === 'price' ? item?.price
      : p.src === 'column' ? findColumn(vars, p.arg) : p.src === 'text' ? p.arg : '';
    let text = String(raw ?? '').replace(/[\n\t]+/g, ' ').replace(/ {5,}/g, '    ').trim();
    if (!text) text = p.src === 'name' ? 'there' : '-';
    return { key: p.key, text: text.slice(0, 1000) };
  });
}
const findColumn = (vars, col) => {
  if (!vars) return '';
  if (vars[col] !== undefined) return vars[col];
  const k = Object.keys(vars).find((x) => x.toLowerCase() === String(col).toLowerCase());
  return k ? vars[k] : '';
};

/** The template's components for the Cloud API. */
export function templateComponents(values, { named = false, headerImage = null } = {}) {
  const comps = [];
  if (headerImage) comps.push({ type: 'header', parameters: [{ type: 'image', image: { link: headerImage } }] });
  if (values.length) comps.push({ type: 'body', parameters: values.map((v) => (named ? { type: 'text', parameter_name: v.key, text: v.text } : { type: 'text', text: v.text })) });
  return comps;
}

/** The message as the customer will read it (for the preview). */
export const previewText = (body, values) => String(body || '').replace(VAR_RE, (m, k) => values.find((v) => v.key === k)?.text ?? m);

// ---------- Meta errors ----------
/** What a failed send means for the campaign. */
export function errorAction(code) {
  switch (Number(code)) {
    case 131049: return 'capped';         // Meta's per-person marketing cap: try again after 24 h
    case 131026: return 'invalid';        // not on WhatsApp / can't receive: never again
    case 131050: return 'opted_out';      // the customer stopped marketing messages
    case 131042: return 'pause_payment';  // money / payment problem: every message would fail
    case 131048: case 368: case 131031: return 'pause_meta'; // spam rate limit, temporarily blocked, account locked
    case 132000: case 132001: case 132005: case 132007: case 132012: case 132015: case 132016: case 132068: case 132069:
      return 'pause_template';            // template missing, paused, disabled or the variables don't fit
    default: return null;
  }
}
export const PAUSE_REASONS = {
  payment: 'WhatsApp refused the messages because of a payment problem. Add funds in Meta Business → Billing & payments, then tap Resume.',
  meta: 'WhatsApp is limiting this number (too many messages or reports). Wait a day before resuming.',
  template: 'WhatsApp refused the template (not approved, paused, or the blanks don\'t fit). Check it in WhatsApp Manager.',
  quality: 'Your number\'s quality rating dropped. Sending paused to protect the number; resume when it is back to High.',
  user: 'Paused by you.',
};

// ---------- campaigns in the database ----------
export async function createCampaign(env, tenantId, c, recipients) {
  const id = newId(); const now = nowIso();
  await env.DB.prepare(`INSERT INTO campaigns (id, tenant_id, name, template_name, template_lang, template_category, params, header, item_id, telugu, status, start_at, cost_each, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, tenantId, c.name, c.templateName, c.templateLang, c.category || null, JSON.stringify(c.params || []),
    c.header ? JSON.stringify(c.header) : null, c.itemId || null, c.telugu ? 1 : 0, Date.parse(c.startAt) > Date.now() + 60000 ? 'scheduled' : 'sending', c.startAt, c.costEach || 0, c.createdBy || null, now, now).run();
  const stmt = env.DB.prepare('INSERT OR IGNORE INTO campaign_recipients (campaign_id, tenant_id, phone, name, vars) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < recipients.length; i += 50) {
    await env.DB.batch(recipients.slice(i, i + 50).map((r) => stmt.bind(id, tenantId, r.phone, r.name || '', r.vars ? JSON.stringify(r.vars) : null)));
  }
  return id;
}

const rowToCampaign = (r) => r && ({
  _id: r.id, name: r.name, templateName: r.template_name, templateLang: r.template_lang, category: r.template_category,
  params: json(r.params, []), header: json(r.header, null), itemId: r.item_id, telugu: !!r.telugu, status: r.status, pausedReason: r.paused_reason,
  startAt: r.start_at, costEach: r.cost_each, createdAt: r.created_at, updatedAt: r.updated_at, finishedAt: r.finished_at,
});
export const getCampaign = async (env, tenantId, id) => rowToCampaign(await env.DB.prepare('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first());

/** Campaigns with live counts: sent, delivered, read, replied, booked, failed, waiting… */
export async function listCampaigns(env, tenantId, { limit = 30, ids = null } = {}) {
  const { results } = ids
    ? await env.DB.prepare(`SELECT * FROM campaigns WHERE tenant_id = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(tenantId, ...ids).all()
    : await env.DB.prepare('SELECT * FROM campaigns WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?').bind(tenantId, limit).all();
  const list = results.map(rowToCampaign);
  if (!list.length) return list;
  const q = list.map(() => '?').join(',');
  const [counts, booked] = await Promise.all([
    env.DB.prepare(`SELECT campaign_id, status, COUNT(*) AS n, SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) AS replied
      FROM campaign_recipients WHERE campaign_id IN (${q}) GROUP BY campaign_id, status`).bind(...list.map((c) => c._id)).all(),
    env.DB.prepare(`SELECT campaign_id, COUNT(*) AS n FROM leads WHERE tenant_id = ? AND campaign_id IN (${q}) AND booked_at IS NOT NULL GROUP BY campaign_id`)
      .bind(tenantId, ...list.map((c) => c._id)).all(),
  ]);
  for (const c of list) {
    const s = { total: 0, waiting: 0, sent: 0, delivered: 0, read: 0, failed: 0, capped: 0, invalid: 0, skipped: 0, cancelled: 0, replied: 0, booked: 0 };
    for (const r of counts.results.filter((x) => x.campaign_id === c._id)) { s[r.status] = (s[r.status] || 0) + r.n; s.total += r.n; s.replied += r.replied || 0; }
    s.booked = booked.results.find((x) => x.campaign_id === c._id)?.n || 0;
    // "sent" on screen = everything WhatsApp accepted (delivered and read ones were sent too)
    s.accepted = s.sent + s.delivered + s.read;
    c.stats = s; c.costSoFar = Math.round(s.accepted * c.costEach * 100) / 100;
  }
  return list;
}

export async function listRecipients(env, tenantId, campaignId, { status = '', page = 1, limit = 100 } = {}) {
  const where = ['campaign_id = ?', 'tenant_id = ?']; const vals = [campaignId, tenantId];
  if (status === 'replied') where.push('replied_at IS NOT NULL');
  else if (status) { where.push('status = ?'); vals.push(status); }
  const { results } = await env.DB.prepare(`SELECT phone, name, status, error, sent_at, replied_at, next_at FROM campaign_recipients WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(sent_at, '9') DESC, phone LIMIT ? OFFSET ?`).bind(...vals, limit, (page - 1) * limit).all();
  return results.map((r) => ({ phone: r.phone, name: r.name, status: r.status, error: r.error, sentAt: r.sent_at, repliedAt: r.replied_at, nextAt: r.next_at }));
}

export async function setCampaignStatus(env, tenantId, id, status, reason = null) {
  await env.DB.prepare(`UPDATE campaigns SET status = ?, paused_reason = ?, updated_at = ?${['done', 'cancelled'].includes(status) ? ', finished_at = ?' : ''} WHERE id = ? AND tenant_id = ?`)
    .bind(status, reason, nowIso(), ...(['done', 'cancelled'].includes(status) ? [nowIso()] : []), id, tenantId).run();
}

/** Pauses every running campaign of a business (payment problem, spam limit, quality drop). Returns how many. */
export async function pauseAll(env, tenantId, reason) {
  const r = await env.DB.prepare(`UPDATE campaigns SET status = 'paused', paused_reason = ?, updated_at = ? WHERE tenant_id = ? AND status IN ('sending', 'scheduled', 'waiting_limit', 'waiting_hours') RETURNING id`)
    .bind(reason, nowIso(), tenantId).all();
  return r.results.length;
}

const RANK = { sent: 1, delivered: 2, read: 3 };
/**
 * A delivery status from Meta's webhook for a campaign message. Returns { campaignId, phone, action } when it
 * was one, so the caller can react (pause on payment problems, opt the customer out, …).
 */
export async function applyRecipientStatus(env, tenantId, waId, status, err) {
  const rec = await env.DB.prepare('SELECT campaign_id, phone, status, attempts FROM campaign_recipients WHERE tenant_id = ? AND wa_message_id = ?').bind(tenantId, waId).first();
  if (!rec) return null;
  const st = String(status).toLowerCase();
  if (st === 'failed') {
    const action = errorAction(err?.code);
    const text = err ? `${err.code}: ${err.error_data?.details || err.message || err.title || 'failed'}` : 'failed';
    if (action === 'capped' && rec.attempts < 2) {
      // Meta held it back for this person today: try once more after 24 hours (doesn't use today's limit).
      await env.DB.prepare(`UPDATE campaign_recipients SET status = 'waiting', error = ?, next_at = ?, sent_at = NULL, wa_message_id = NULL WHERE campaign_id = ? AND phone = ?`)
        .bind(text, new Date(Date.now() + DAY).toISOString(), rec.campaign_id, rec.phone).run();
    } else {
      const final = action === 'capped' ? 'capped' : action === 'invalid' ? 'invalid' : action === 'opted_out' ? 'skipped' : 'failed';
      await env.DB.prepare('UPDATE campaign_recipients SET status = ?, error = ? WHERE campaign_id = ? AND phone = ?').bind(final, text, rec.campaign_id, rec.phone).run();
    }
    if (action === 'invalid') await env.DB.prepare("UPDATE leads SET reach_status = 'invalid' WHERE tenant_id = ? AND phone = ?").bind(tenantId, rec.phone).run();
    if (action === 'capped') await env.DB.prepare('UPDATE leads SET capped_until = ? WHERE tenant_id = ? AND phone = ?').bind(new Date(Date.now() + DAY).toISOString(), tenantId, rec.phone).run();
    return { campaignId: rec.campaign_id, phone: rec.phone, action, error: text };
  }
  if (RANK[st] && RANK[st] > (RANK[rec.status] || 0) && ['sent', 'delivered'].includes(rec.status)) {
    await env.DB.prepare('UPDATE campaign_recipients SET status = ? WHERE campaign_id = ? AND phone = ?').bind(st, rec.campaign_id, rec.phone).run();
  }
  return { campaignId: rec.campaign_id, phone: rec.phone, action: null };
}

/** A customer wrote back: counts as "replied" for the campaign that last messaged them (within 7 days). */
export async function markReplied(env, tenantId, phone) {
  await env.DB.prepare(`UPDATE campaign_recipients SET replied_at = ?, status = CASE WHEN status IN ('sent', 'delivered') THEN 'read' ELSE status END
    WHERE tenant_id = ? AND phone = ? AND replied_at IS NULL AND sent_at >= ? AND status IN ('sent', 'delivered', 'read')`)
    .bind(nowIso(), tenantId, phone, new Date(Date.now() - 7 * DAY).toISOString()).run();
}

// ---------- Meta's live limit and quality ----------
/**
 * Every few hours: reads each business's messaging limit and quality rating from Meta and stores them.
 * A drop to Yellow/Red pauses its campaigns. Returns [{ tenantId, metaLimit, quality, paused }].
 */
export async function refreshMetaLimits(env, { tenants, token, notify, force = false } = {}) {
  const out = [];
  const base = String(env.GRAPH_BASE_URL || 'https://graph.facebook.com').replace(/\/$/, '');
  if (base === 'fake') return out;
  for (const t of tenants) {
    const s = sendingSettings(t);
    if (!force && s.metaCheckedAt && Date.now() - Date.parse(s.metaCheckedAt) < 3 * 3600e3) continue;
    try {
      const res = await fetch(`${base}/${env.GRAPH_API_VERSION || 'v25.0'}/${t.phoneNumberId}?fields=whatsapp_business_manager_messaging_limit,quality_rating`, {
        headers: { Authorization: `Bearer ${await token(t)}` },
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { console.warn(`[Campaigns] limit check failed for ${t._id}: ${d?.error?.message || res.status}`); continue; }
      const metaLimit = d.whatsapp_business_manager_messaging_limit || null;
      const quality = d.quality_rating || null;
      const worse = ['YELLOW', 'RED'].includes(String(quality).toUpperCase()) && !['YELLOW', 'RED'].includes(String(s.quality || '').toUpperCase());
      const next = { ...(t.sending || {}), metaLimit, quality, metaCheckedAt: nowIso() };
      await env.DB.prepare('UPDATE tenants SET sending = ? WHERE id = ?').bind(JSON.stringify(next), t._id).run();
      let paused = 0;
      if (worse) {
        paused = await pauseAll(env, t._id, 'quality');
        await notify?.(t, { title: `⚠️ WhatsApp quality is ${String(quality).toLowerCase()}`, body: `${paused ? `${paused} campaign(s) paused to protect your number. ` : ''}Check WhatsApp Manager → Phone numbers.` });
      }
      out.push({ tenantId: t._id, metaLimit, quality, paused });
    } catch (e) { console.warn('[Campaigns] limit check error:', e.message); }
  }
  return out;
}
