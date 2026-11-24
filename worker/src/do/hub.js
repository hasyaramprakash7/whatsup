// One Durable Object per business: live dashboard WebSockets and paced, retried broadcast sending.
import { DurableObject } from 'cloudflare:workers';
import { getTenant, getLead, updateLeads, tenantAccessToken } from '../lib/db.js';
import { outboundRecorder } from '../lib/chatlog.js';
import { WhatsAppClient } from '../lib/whatsapp.js';
import { notifyTenant, getSubscription, sendPush, deleteSubscription, testPushPayload, markSent } from '../lib/push.js';

const MAX_ATTEMPTS = 3;

export class BusinessHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS outbox (
      phone TEXT PRIMARY KEY, name TEXT, template TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, added_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS totals (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)`);
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

  // ---------- broadcasts ----------
  /** Queues recipients; sending happens in alarm() at the configured rate. */
  async startBroadcast(tenantId, recipients, template) {
    await this.ctx.storage.put('tenantId', String(tenantId));
    if (!(await this.ctx.storage.get('runStart'))) await this.ctx.storage.put('runStart', this.queueStats());
    const now = Date.now();
    const tpl = JSON.stringify(template);
    for (const r of recipients) {
      this.sql.exec(`INSERT INTO outbox (phone, name, template, attempts, next_at, added_at) VALUES (?, ?, ?, 0, ?, ?)
        ON CONFLICT (phone) DO UPDATE SET name = excluded.name, template = excluded.template, attempts = 0, next_at = excluded.next_at`, r.phone, r.name, tpl, now, now);
    }
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now);
    return this.queueStats();
  }

  queueStats() {
    const waiting = this.sql.exec('SELECT COUNT(*) AS n FROM outbox').one().n;
    const t = Object.fromEntries(this.sql.exec('SELECT k, n FROM totals').toArray().map((r) => [r.k, r.n]));
    return { waiting, sent: t.sent || 0, failed: t.failed || 0, skipped: t.skipped || 0 };
  }

  /** When the queue empties: "Broadcast finished — 120 sent, 3 failed". */
  async reportBroadcastDone() {
    const start = await this.ctx.storage.get('runStart');
    const tenantId = await this.ctx.storage.get('tenantId');
    if (!start || !tenantId) return;
    await this.ctx.storage.delete('runStart');
    const now = this.queueStats();
    const sent = now.sent - start.sent; const failed = now.failed - start.failed; const skipped = now.skipped - start.skipped;
    if (sent + failed + skipped <= 0) return;
    await this.notify(tenantId, 'broadcast', {
      title: failed ? `Broadcast finished · ${failed} failed` : 'Broadcast finished',
      body: [`${sent} sent`, failed ? `${failed} failed` : '', skipped ? `${skipped} skipped (opted out)` : ''].filter(Boolean).join(' · '),
      url: '/#/leads', tag: 'broadcast',
    });
  }

  bump(k) { this.sql.exec('INSERT INTO totals (k, n) VALUES (?, 1) ON CONFLICT (k) DO UPDATE SET n = n + 1', k); }

  async alarm() {
    await this.runTestPush();
    const perTick = Math.max(1, Number(this.env.BROADCAST_RATE_PER_SECOND) || 10);
    const due = this.sql.exec('SELECT * FROM outbox WHERE next_at <= ? ORDER BY added_at LIMIT ?', Date.now(), perTick).toArray();
    if (due.length) {
      const tenantId = await this.ctx.storage.get('tenantId');
      const tenant = tenantId ? await getTenant(this.env, tenantId) : null;
      if (!tenant || !tenant.isActive) {
        this.sql.exec('DELETE FROM outbox');
        return;
      }
      const client = new WhatsAppClient(this.env, { accessToken: await tenantAccessToken(this.env, tenant), phoneNumberId: tenant.phoneNumberId },
        { onSent: outboundRecorder(this.env, tenant._id, 'broadcast') });
      for (const row of due) await this.sendOne(tenant, client, row);
    }
    const next = this.sql.exec('SELECT MIN(next_at) AS t FROM outbox').one().t;
    if (next != null) await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
    else await this.reportBroadcastDone();
  }

  async sendOne(tenant, client, row) {
    const done = (k) => { this.sql.exec('DELETE FROM outbox WHERE phone = ?', row.phone); this.bump(k); };
    const lead = await getLead(this.env, tenant._id, row.phone);
    if (lead?.status === 'COLD') return done('skipped'); // opted out since it was queued

    const tpl = JSON.parse(row.template);
    const business = tenant.profile?.displayName || tenant.businessName;
    const params = tpl.hasParams ? [row.name || 'there', business] : [];
    try {
      const res = await client.template(row.phone, tpl.name, params, tpl.language);
      const leads = await updateLeads(this.env, tenant._id, 'phone = ?', [row.phone], {
        lastBroadcastMessageId: res?.messages?.[0]?.id || null, broadcastStatus: 'SENT', broadcastStatusAt: new Date().toISOString(), broadcastError: null,
        botPaused: false, // the bot answers again even if this chat was handed to the team before
      });
      // A fresh broadcast starts a fresh conversation: the flow begins again from the first question.
      await this.env.CONVERSATION.get(this.env.CONVERSATION.idFromName(`${tenant._id}:${row.phone}`)).reset().catch(() => {});
      if (leads[0]) await this.publish('lead:update', { lead: leads[0] });
      done('sent');
    } catch (err) {
      const attempts = row.attempts + 1;
      if (err.permanent || attempts >= MAX_ATTEMPTS) {
        // e.g. #131030 number not in Meta's allowed list: fail at once with the reason.
        const leads = await updateLeads(this.env, tenant._id, 'phone = ?', [row.phone], {
          broadcastStatus: 'FAILED', broadcastStatusAt: new Date().toISOString(), broadcastError: err.text || err.message, lastBroadcastMessageId: null,
        });
        if (leads[0]) await this.publish('lead:update', { lead: leads[0] });
        done('failed');
      } else {
        this.sql.exec('UPDATE outbox SET attempts = ?, next_at = ? WHERE phone = ?', attempts, Date.now() + attempts * 5000, row.phone);
      }
    }
  }
}
