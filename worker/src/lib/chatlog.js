// Stores every WhatsApp message (customer, bot, AI, team, broadcast) and pushes it to open dashboards.
import { insertMessage, upsertLead } from './db.js';

const MEDIA_LABELS = { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message', voice: '🎤 Voice message', document: '📄 Document', sticker: '💟 Sticker', location: '📍 Location', contacts: '👤 Contact', reaction: 'Reaction' };

/** Sends a live event to everyone watching this business's dashboard. Never throws. */
export async function publish(env, tenantId, event, data) {
  try {
    await env.HUB.get(env.HUB.idFromName(String(tenantId))).publish(event, data);
  } catch (err) {
    console.warn(`[Realtime] publish ${event} failed:`, err.message);
  }
}

export function describeOutbound(payload) {
  switch (payload.type) {
    case 'text': return { type: 'text', text: payload.text?.body || '' };
    case 'interactive': {
      const i = payload.interactive || {};
      if (i.type === 'button') return { type: 'buttons', text: i.body?.text || '', meta: { buttons: (i.action?.buttons || []).map((b) => b.reply?.title), ...(i.header?.image?.link ? { image: i.header.image.link } : {}) } };
      if (i.type === 'list') {
        const rows = (i.action?.sections || []).flatMap((s) => s.rows || []).map((r) => ({ title: r.title, description: r.description || '' }));
        return { type: 'list', text: i.body?.text || '', meta: { header: i.header?.text || '', button: i.action?.button || '', rows } };
      }
      if (i.type === 'location_request_message') return { type: 'buttons', text: i.body?.text || '', meta: { buttons: ['📍 Send location'] } };
      return { type: 'interactive', text: i.body?.text || '' };
    }
    case 'document': return { type: 'document', text: payload.document?.caption || '', meta: { link: payload.document?.link, filename: payload.document?.filename } };
    case 'image': return { type: 'image', text: payload.image?.caption || '', meta: { link: payload.image?.link, label: '📷 Photo' } };
    case 'location': {
      const l = payload.location || {};
      return { type: 'location', text: l.name || 'Location', meta: { latitude: l.latitude, longitude: l.longitude, name: l.name, address: l.address } };
    }
    case 'template': {
      const t = payload.template || {};
      const params = (t.components || []).flatMap((c) => c.parameters || []).map((p) => p.text);
      return { type: 'template', text: `Template “${t.name}”`, meta: { name: t.name, language: t.language?.code, params } };
    }
    default: return { type: payload.type || 'unknown', text: '' };
  }
}

export function describeInbound(message) {
  const t = message.type;
  if (t === 'text') return { type: 'text', text: message.text?.body || '' };
  if (t === 'interactive') {
    const r = message.interactive?.button_reply || message.interactive?.list_reply;
    return { type: 'reply', text: r?.title || '', meta: { id: r?.id, description: r?.description || '' } };
  }
  if (t === 'button') return { type: 'reply', text: message.button?.text || message.button?.payload || '', meta: { id: message.button?.payload } };
  if (t === 'location') {
    const l = message.location || {};
    return { type: 'location', text: l.name || 'Shared location', meta: { latitude: l.latitude, longitude: l.longitude, name: l.name, address: l.address } };
  }
  if (t === 'reaction') return { type: 'reaction', text: message.reaction?.emoji || '' };
  const media = message[t] || {};
  return { type: t, text: media.caption || '', meta: { label: MEDIA_LABELS[t] || `[${t}]`, filename: media.filename || null } };
}

function previewOf(type, text, meta) {
  const label = meta?.label || MEDIA_LABELS[type];
  if (type === 'template') return text;
  if (text) return label && type !== 'location' ? `${label} · ${text}` : text;
  return label || `[${type}]`;
}

/** Saves one message, updates the lead's inbox fields and notifies dashboards. Never throws. */
export async function recordMessage(env, { tenantId, phone, direction, sentBy, type, text = '', meta = null, waMessageId = null, status, profileName = null }) {
  try {
    const message = await insertMessage(env, { tenantId, phone, direction, sentBy, type, text, meta, waMessageId, status: status || (direction === 'in' ? 'received' : 'sent') });
    const set = {
      lastMessageAt: message.createdAt, lastMessagePreview: previewOf(type, text, meta).slice(0, 140),
      lastMessageDirection: direction, lastMessageSentBy: sentBy,
    };
    if (direction === 'in') set.lastInboundAt = message.createdAt;
    let lead = await upsertLead(env, tenantId, phone, { set, onInsert: { status: 'ENGAGED', name: profileName || '' }, incUnread: direction === 'in' });
    // Use the customer's WhatsApp profile name when we don't have one yet.
    if (lead && profileName && !lead.name) lead = await upsertLead(env, tenantId, phone, { set: { name: String(profileName).slice(0, 80) } });
    await publish(env, tenantId, 'message:new', { message, lead });
    return { message, lead };
  } catch (err) {
    console.warn(`[ChatLog] could not record ${direction} message for +${phone}:`, err.message);
    return { message: null, lead: null };
  }
}

/** onSent hook for WhatsAppClient: logs each successful send as an outbound chat message. */
export const outboundRecorder = (env, tenantId, sentBy) => (payload, response) =>
  recordMessage(env, { tenantId, phone: payload.to, direction: 'out', sentBy, ...describeOutbound(payload), waMessageId: response?.messages?.[0]?.id || null });

export const recordInbound = (env, tenantId, from, message, profileName) =>
  recordMessage(env, { tenantId, phone: from, direction: 'in', sentBy: 'customer', ...describeInbound(message), waMessageId: message.id || null, profileName });
