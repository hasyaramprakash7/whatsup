// One Durable Object per business: live dashboard WebSockets and the campaign sender (paced, daily limit, sending hours).
import { DurableObject } from 'cloudflare:workers';
import { getTenant, getItem, updateLeads, tenantAccessToken } from '../lib/db.js';
import { json } from '../lib/text.js';
import { sendingSettings, sendingWindow, dailyLimit, usage, resolveParams, templateComponents, errorAction, pauseAll, setCampaignStatus, listCampaigns, PAUSE_REASONS } from '../lib/campaigns.js';
import { outboundRecorder } from '../lib/chatlog.js';
import { WhatsAppClient } from '../lib/whatsapp.js';
import { notifyTenant, getSubscription, sendPush, deleteSubscription, testPushPayload, markSent } from '../lib/push.js';

const MAX_ATTEMPTS = 3;

export class BusinessHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Answer dashboard pings without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ---------- live dashboard ----------
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify({ event: 'hello', data: { at: new Date().toISOString() } }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async publish(event, data, tenantId) {
    const frame = JSON.stringify({ event, data });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(frame); } catch { /* closed */ }
    }
    if (tenantId) {
      // Finish the phone notification before returning (background work can be cut off once this call ends),
      // but never hold up the caller for more than a few seconds.
      const job = this.pushFor(event, data, tenantId);
      if (job) await Promise.race([job.catch((err) => console.warn('[Push]', err.message)), new Promise((r) => setTimeout(r, 2500))]);
    }
    return true;
  }

  // ---------- phone notifications ----------
  /** Turns a live event into a phone notification, when it is one people want. */
  pushFor(event, data, tenantId) {
    const name = (l, phone) => (l?.name || '').trim() || `+${phone}`;
    if (event === 'message:new' && data?.message?.direction === 'in') {
      const { message, lead } = data;
      return this.notify(tenantId, 'message', {
        title: name(lead, message.phone),
        body: (lead?.lastMessagePreview || message.text || 'New message').slice(0, 160),
        url: `/#/inbox/${message.phone}`, tag: `chat-${message.phone}`,
      });
    }
    if (event === 'alert' && data?.phone) {
      const booking = data.kind === 'booking';
      return this.notify(tenantId, booking ? 'booking' : 'handoff', {
        title: booking ? `🎉 New booking · ${name(data, data.phone)}` : `📞 ${name(data, data.phone)} needs a person`,
        body: String(data.details || '').slice(0, 180),
        url: booking ? '/#/confirmed' : `/#/inbox/${data.phone}`, tag: `${data.kind}-${data.phone}`,
      });
    }
    return null;
  }

  async notify(tenantId, kind, payload) {
    const tenant = await getTenant(this.env, tenantId).catch(() => null);
    const businessName = tenant ? (tenant.profile?.displayName || tenant.businessName) : '';
    await notifyTenant(this.env, tenantId, kind, { ...payload, businessName });
  }

  webSocketMessage() { /* dashboards only listen */ }
  webSocketClose(ws, code) { try { ws.close(code, 'bye'); } catch { /* already closed */ } }

  // ---------- "test with the app closed" (runs in its own hub instance, never a business's) ----------
  async scheduleTestPush(endpoint, delayMs) {
    const at = Date.now() + delayMs;
    await this.ctx.storage.put('testPush', { endpoint, at });
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || cur > at) await this.ctx.storage.setAlarm(at);
    return true;
  }

  async runTestPush() {
    const t = await this.ctx.storage.get('testPush');
    if (!t) return;
    if (t.at > Date.now() + 500) { await this.ctx.storage.setAlarm(t.at); return; }
    await this.ctx.storage.delete('testPush');
    const sub = await getSubscription(this.env, t.endpoint);
    if (!sub) return;
    try {
      const payload = testPushPayload(true);
      const r = await sendPush(this.env, sub, payload, { urgency: 'high' });
      if (r.gone) await deleteSubscription(this.env, sub.endpoint);
      if (r.ok) await markSent(this.env, sub.endpoint, payload.at);
      console.log(`[Push] closed-app test ${r.ok ? 'delivered' : `failed ${r.status}`}`);
    } catch (err) { console.warn('[Push] closed-app test failed:', err.message); }
  }

  // ---------- campaigns (bulk sending) ----------
  /** A campaign was created, resumed or scheduled: (re)start the sender for this business. */
  async kick(tenantId) {
    await this.ctx.storage.put('tenantId', String(tenantId));
    await this.wakeAt(Date.now());
    return true;
  }
  async wakeAt(t) {
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || cur > t) await this.ctx.storage.setAlarm(t);
  }

  async alarm() {
    await this.runTestPush();
    let next = null;
    try { next = await this.runCampaigns(); } catch (err) { console.error('[Campaigns] run failed:', err.message); next = Date.now() + 30000; }
    if (next) await this.wakeAt(Math.max(next, Date.now() + 1000));
  }

  /**
   * One tick: sends up to BROADCAST_RATE_PER_SECOND messages, never more than the daily limit allows, only during
   * the sending hours. Returns when to wake up next (ms) or null when there is nothing left to do.
   */
  async runCampaigns() {
    const tenantId = await this.ctx.storage.get('tenantId');
    if (!tenantId) return null;
    const tenant = await getTenant(this.env, tenantId);
    if (!tenant || !tenant.isActive) return null;
    const DB = this.env.DB; const now = Date.now(); const nowIs = new Date(now).toISOString();
    await DB.prepare("UPDATE campaigns SET status = 'sending', updated_at = ? WHERE tenant_id = ? AND status IN ('scheduled', 'waiting_limit', 'waiting_hours') AND start_at <= ?")
      .bind(nowIs, tenantId, nowIs).run();
    const { results: active } = await DB.prepare("SELECT * FROM campaigns WHERE tenant_id = ? AND status = 'sending' ORDER BY created_at").bind(tenantId).all();
    const scheduled = (await DB.prepare("SELECT MIN(start_at) AS t FROM campaigns WHERE tenant_id = ? AND status = 'scheduled'").bind(tenantId).first())?.t;
    const schedAt = scheduled ? Date.parse(scheduled) : null;
    const soonest = (...ts) => { const v = ts.filter((x) => x != null && Number.isFinite(x)); return v.length ? Math.min(...v) : null; };
    if (!active.length) return schedAt;
    const ids = active.map((c) => c.id); const q = ids.map(() => '?').join(',');

    // Night (outside the sending hours): wait for the morning.
    const win = sendingWindow(now, sendingSettings(tenant), this.env.SITE_UTC_OFFSET);
    if (!win.open) {
      await DB.prepare(`UPDATE campaigns SET status = 'waiting_hours', updated_at = ? WHERE id IN (${q})`).bind(nowIs, ...ids).run();
      return soonest(win.nextOpenAt, schedAt);
    }

    const { limit } = dailyLimit(tenant);
    const { used } = await usage(this.env, tenantId, now);
    let room = limit - used;
    const since = new Date(now - 864e5).toISOString();
    const perTick = Math.max(1, Number(this.env.BROADCAST_RATE_PER_SECOND) || 10);
    // Limit reached: only customers who wrote in the last 24 hours can still get it (Meta doesn't count them).
    const due = (await DB.prepare(`SELECT r.campaign_id, r.phone, r.name, r.vars, r.attempts, l.status AS lead_status, l.name AS lead_name, l.reach_status, l.capped_until, l.language, l.last_inbound_at
      FROM campaign_recipients r JOIN campaigns c ON c.id = r.campaign_id LEFT JOIN leads l ON l.tenant_id = r.tenant_id AND l.phone = r.phone
      WHERE r.campaign_id IN (${q}) AND r.status = 'waiting' AND (r.next_at IS NULL OR r.next_at <= ?) ${room > 0 ? '' : 'AND l.last_inbound_at >= ?'}
      ORDER BY c.created_at, r.rowid LIMIT ?`).bind(...ids, nowIs, ...(room > 0 ? [] : [since]), room > 0 ? Math.min(perTick, room) : perTick).all()).results;

    if (due.length) {
      const byId = Object.fromEntries(active.map((c) => [c.id, c]));
      const items = {};
      for (const c of active) if (c.item_id && !(c.item_id in items)) items[c.item_id] = await getItem(this.env, tenantId, c.item_id).catch(() => null);
      const client = new WhatsAppClient(this.env, { accessToken: await tenantAccessToken(this.env, tenant), phoneNumberId: tenant.phoneNumberId },
        { onSent: outboundRecorder(this.env, tenant._id, 'broadcast') });
      for (const rec of due) {
        const c = byId[rec.campaign_id];
        const r = await this.sendOne(tenant, client, c, rec, items[c.item_id] || null, since);
        if (r === 'stop') return schedAt; // paused for the whole business (payment, spam limit, template)
        if (r === 'counted') room--;
      }
    }

    // What next: finished campaigns, more now, or wait for the limit / a retry.
    const nowIs2 = new Date().toISOString();
    const left = (await DB.prepare(`SELECT campaign_id, COUNT(*) AS n, SUM(CASE WHEN next_at IS NULL OR next_at <= ? THEN 1 ELSE 0 END) AS due_now, MIN(CASE WHEN next_at > ? THEN next_at END) AS later
      FROM campaign_recipients WHERE campaign_id IN (${q}) AND status = 'waiting' GROUP BY campaign_id`).bind(nowIs2, nowIs2, ...ids).all()).results;
    for (const c of active) {
      if (left.some((x) => x.campaign_id === c.id)) continue;
      await setCampaignStatus(this.env, tenantId, c.id, 'done');
      const [s] = await listCampaigns(this.env, tenantId, { ids: [c.id] });
      const st = s?.stats || {};
      await this.notify(tenantId, 'broadcast', {
        title: `✅ Campaign finished · ${c.name}`,
        body: [`${st.accepted || 0} sent`, st.replied ? `${st.replied} replied` : '', (st.failed || 0) + (st.invalid || 0) ? `${(st.failed || 0) + (st.invalid || 0)} failed` : '', st.capped ? `${st.capped} capped by WhatsApp` : ''].filter(Boolean).join(' · '),
        url: '/#/broadcast', tag: `campaign-${c.id}`,
      }).catch(() => {});
    }
    if (!left.length) return schedAt;
    const dueNow = left.reduce((a, x) => a + (x.due_now || 0), 0);
    const later = soonest(...left.map((x) => (x.later ? Date.parse(x.later) : null)));
    if (dueNow && room > 0) return Date.now() + 1000;
    if (dueNow) {
      if (due.length) return Date.now() + 1000; // still customers who wrote today (free of the limit)
      // Daily limit used up: wait until the oldest message of the last 24 hours leaves Meta's window.
      const waiting = left.filter((x) => x.due_now).map((x) => x.campaign_id);
      await DB.prepare(`UPDATE campaigns SET status = 'waiting_limit', updated_at = ? WHERE id IN (${waiting.map(() => '?').join(',')})`).bind(nowIs, ...waiting).run();
      const { freesAt } = await usage(this.env, tenantId);
      return soonest(freesAt ?? Date.now() + 10 * 60000, later, schedAt);
    }
    return soonest(later, schedAt);
  }

  /** Sends one campaign message. Returns 'counted' | 'free' (no limit used) | 'skip' | 'retry' | 'stop'. */
  async sendOne(tenant, client, c, rec, item, since) {
    const DB = this.env.DB;
    const set = (status, error = null, extra = '', vals = []) => DB.prepare(`UPDATE campaign_recipients SET status = ?, error = ?${extra} WHERE campaign_id = ? AND phone = ?`)
      .bind(status, error, ...vals, rec.campaign_id, rec.phone).run();
    if (rec.lead_status === 'COLD') { await set('skipped', 'Opted out'); return 'skip'; }
    if (rec.reach_status === 'invalid') { await set('invalid', 'Not on WhatsApp (an earlier message could not be delivered)'); return 'skip'; }
    if (rec.capped_until && Date.parse(rec.capped_until) > Date.now()) { await set('waiting', 'WhatsApp marketing cap for this person — trying again later', ', next_at = ?', [rec.capped_until]); return 'retry'; }

    const opts = json(c.header, {}) || {};
    const business = tenant.profile?.displayName || tenant.businessName;
    const values = resolveParams(json(c.params, []), { name: rec.name || rec.lead_name, vars: json(rec.vars, {}), business, item });
    const headerImage = opts.image === 'project' ? item?.imageUrl : opts.image || null;
    const components = templateComponents(values, { named: !!opts.named, headerImage });
    const counted = !(rec.last_inbound_at && rec.last_inbound_at >= since); // wrote in the last 24 h → Meta doesn't count it
    const send = async () => {
      if (c.telugu && rec.language === 'te' && c.template_lang !== 'te') {
        try { return await client.templateWith(rec.phone, c.template_name, 'te', components); }
        catch (err) { if (!(err.code === 132001 || /does not exist/i.test(err.text || ''))) throw err; }
      }
      return client.templateWith(rec.phone, c.template_name, c.template_lang, components);
    };
    try {
      const res = await send();
      const waId = res?.messages?.[0]?.id || null; const at = new Date().toISOString();
      await set('sent', null, ', wa_message_id = ?, sent_at = ?, counted = ?, attempts = attempts + 1, next_at = NULL', [waId, at, counted ? 1 : 0]);
      const leads = await updateLeads(this.env, tenant._id, 'phone = ?', [rec.phone], {
        lastBroadcastAt: at, lastBroadcastMessageId: waId, broadcastStatus: 'SENT', broadcastStatusAt: at, broadcastError: null, campaignId: c.id,
        botPaused: false, // the bot answers again even if this chat was handed to the team before
      });
      await DB.prepare("UPDATE leads SET status = 'CONTACTED' WHERE tenant_id = ? AND phone = ? AND status = 'NEW'").bind(tenant._id, rec.phone).run();
      // A reply starts fresh — and goes straight to the campaign's project when it has one.
      await this.env.CONVERSATION.get(this.env.CONVERSATION.idFromName(`${tenant._id}:${rec.phone}`)).reset({ itemId: c.item_id || null, lang: c.template_lang }).catch(() => {});
      if (leads[0]) await this.publish('lead:update', { lead: leads[0] });
      return counted ? 'counted' : 'free';
    } catch (err) {
      const action = errorAction(err.code);
      const text = err.text || err.message;
      if (action?.startsWith('pause_')) {
        const reason = action.slice(6);
        const n = await pauseAll(this.env, tenant._id, reason);
        console.warn(`[Campaigns] ${tenant._id}: paused ${n} campaign(s) — ${text}`);
        await this.notify(tenant._id, 'broadcast', { title: '⏸️ Broadcast paused', body: `${PAUSE_REASONS[reason]} (${text})`.slice(0, 180), url: '/#/broadcast', tag: 'campaign-paused' }).catch(() => {});
        return 'stop';
      }
      if (action === 'capped' && rec.attempts < 1) { await set('waiting', text, ', next_at = ?, attempts = attempts + 1', [new Date(Date.now() + 864e5).toISOString()]); return 'retry'; }
      if (action === 'capped') { await set('capped', text); return 'skip'; }
      if (action === 'invalid') {
        await set('invalid', text);
        await DB.prepare("UPDATE leads SET reach_status = 'invalid' WHERE tenant_id = ? AND phone = ?").bind(tenant._id, rec.phone).run();
        return 'skip';
      }
      if (action === 'opted_out') {
        await set('skipped', text);
        await DB.prepare("UPDATE leads SET status = 'COLD' WHERE tenant_id = ? AND phone = ?").bind(tenant._id, rec.phone).run();
        return 'skip';
      }
      const attempts = rec.attempts + 1;
      if (err.permanent || attempts >= MAX_ATTEMPTS) {
        await set('failed', text, ', attempts = ?', [attempts]);
        const leads = await updateLeads(this.env, tenant._id, 'phone = ?', [rec.phone], { broadcastStatus: 'FAILED', broadcastStatusAt: new Date().toISOString(), broadcastError: text, lastBroadcastMessageId: null });
        if (leads[0]) await this.publish('lead:update', { lead: leads[0] });
        return 'skip';
      }
      await set('waiting', text, ', attempts = ?, next_at = ?', [attempts, new Date(Date.now() + attempts * 5000).toISOString()]);
      return 'retry';
    }
  }
}
