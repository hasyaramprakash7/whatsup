// One Durable Object per customer chat (name: "<tenantId>:<phone>").
// Inbound messages are stored here before Meta gets its 200, then processed strictly in order by alarm,
// so a crash never loses a message and two messages from one person never race.
import { DurableObject } from 'cloudflare:workers';
import { getTenant, getLead, tenantAccessToken } from '../lib/db.js';
import { recordInbound, outboundRecorder } from '../lib/chatlog.js';
import { Conversation, freshState, isOptOut } from '../lib/engine.js';
import { WhatsAppClient } from '../lib/whatsapp.js';
import { setUtcOffset } from '../lib/slots.js';
import { MEDIA_TYPES, saveInboundMedia } from '../lib/media.js';

const SEEN_TTL_MS = 7 * 24 * 3600 * 1000;

export class ConversationDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS inbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, wa_id TEXT, event TEXT NOT NULL, received_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS seen (wa_id TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
  }

  /** Stores one webhook message event. Duplicates (Meta retries) are ignored. */
  async enqueue(event) {
    const waId = event.message?.id || null;
    if (waId) {
      if (this.sql.exec('SELECT 1 FROM seen WHERE wa_id = ?', waId).toArray().length) return { duplicate: true };
      this.sql.exec('INSERT INTO seen (wa_id, at) VALUES (?, ?)', waId, Date.now());
    }
    this.sql.exec('INSERT INTO inbox (wa_id, event, received_at) VALUES (?, ?, ?)', waId, JSON.stringify(event), Date.now());
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now());
    return { queued: true };
  }

  /** A new broadcast starts a fresh conversation. */
  async reset() {
    await this.ctx.storage.put('state', freshState());
    return true;
  }

  async getState() {
    return { state: (await this.ctx.storage.get('state')) || null, pending: this.sql.exec('SELECT COUNT(*) AS n FROM inbox').one().n };
  }

  async alarm() {
    for (;;) {
      const row = this.sql.exec('SELECT seq, event FROM inbox ORDER BY seq LIMIT 1').toArray()[0];
      if (!row) break;
      const event = JSON.parse(row.event);
      // Throws on D1/network trouble before anything is sent: the alarm is retried and the event stays queued.
      const ready = await this.prepare(event);
      // From here on, at most once: remove the event before replying so a retry can't double-send.
      this.sql.exec('DELETE FROM inbox WHERE seq = ?', row.seq);
      if (ready) await this.respond(ready).catch((err) => console.error('[ConversationDO] respond failed:', err.message));
    }
    this.sql.exec('DELETE FROM seen WHERE at < ?', Date.now() - SEEN_TTL_MS);
  }

  /** Records the inbound message in D1 (idempotent) and loads what the reply needs. */
  async prepare(event) {
    const { tenantId, from, message, profileName } = event;
    const tenant = await getTenant(this.env, tenantId);
    if (!tenant || !tenant.isActive) return null;
    const exists = message.id
      ? await this.env.DB.prepare("SELECT 1 FROM messages WHERE tenant_id = ? AND wa_message_id = ? AND direction = 'in'").bind(tenantId, message.id).first()
      : null;
    let msg = message;
    if (!exists && MEDIA_TYPES.includes(message.type)) {
      // Photos, voice notes, videos and documents are copied to R2 so the Inbox can show and play them.
      const saved = await saveInboundMedia(this.env, { tenantId, accessToken: await tenantAccessToken(this.env, tenant), message, voiceLanguage: tenant.ai?.voiceLanguage || 'te', context: `${tenant.profile?.displayName || tenant.businessName} (${String(tenant.industry || 'business').replace(/_/g, ' ')})` });
      if (saved) msg = { ...message, _media: saved };
    }
    const lead = exists ? await getLead(this.env, tenantId, from) : (await recordInbound(this.env, tenantId, from, msg, profileName)).lead;
    if (!lead) throw new Error('Could not record the inbound message');
    return { tenant, lead, from, message: msg };
  }

  async respond({ tenant, lead, from, message }) {
    // A team member took over: the bot stays silent (opt-outs are still honoured).
    if (lead.botPaused && !isOptOut(message)) return;
    setUtcOffset(this.env.SITE_UTC_OFFSET);
    const accessToken = await tenantAccessToken(this.env, tenant);
    const auth = { accessToken, phoneNumberId: tenant.phoneNumberId };
    const convo = new Conversation({
      env: this.env, tenant, lead, phone: from,
      state: await this.ctx.storage.get('state'),
      bot: new WhatsAppClient(this.env, auth, { onSent: outboundRecorder(this.env, tenant._id, 'bot') }),
      ai: new WhatsAppClient(this.env, auth, { onSent: outboundRecorder(this.env, tenant._id, 'ai') }),
      admin: new WhatsAppClient(this.env, auth),
    });
    // A transcribed voice note is answered exactly like the same words typed.
    const transcript = message._media?.transcript;
    const state = await convo.handle(transcript ? { ...message, type: 'text', text: { body: transcript }, voice: true }
      : message._media?.unclear ? { ...message, voice: true, unclear: true } : message);
    await this.ctx.storage.put('state', state);
  }
}
