// One Durable Object per business: live dashboard WebSockets and paced, retried broadcast sending.
import { DurableObject } from 'cloudflare:workers';
import { getTenant, getLead, updateLeads, tenantAccessToken } from '../lib/db.js';
import { outboundRecorder } from '../lib/chatlog.js';
import { WhatsAppClient } from '../lib/whatsapp.js';

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

  async publish(event, data) {
    const frame = JSON.stringify({ event, data });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(frame); } catch { /* closed */ }
    }
    return true;
  }

  webSocketMessage() { /* dashboards only listen */ }
  webSocketClose(ws, code) { try { ws.close(code, 'bye'); } catch { /* already closed */ } }

  // ---------- broadcasts ----------
  /** Queues recipients; sending happens in alarm() at the configured rate. */
  async startBroadcast(tenantId, recipients, template) {
    await this.ctx.storage.put('tenantId', String(tenantId));
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

  bump(k) { this.sql.exec('INSERT INTO totals (k, n) VALUES (?, 1) ON CONFLICT (k) DO UPDATE SET n = n + 1', k); }

  async alarm() {
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
