// Stores every WhatsApp message (customer, bot, team member, broadcast) for the vendor's Inbox
// and pushes it to open dashboards in real time.
const Message = require('../models/Message');
const Lead = require('../models/Lead');
const { publish } = require('./realtime');
const logger = require('../utils/logger');

const DEFAULT_NAME = 'Valued Customer';
const MEDIA_LABELS = { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message', voice: '🎤 Voice message', document: '📄 Document', sticker: '💟 Sticker', location: '📍 Location', contacts: '👤 Contact', reaction: 'Reaction' };

/** What we sent, in a shape the Inbox can render. */
function describeOutbound(payload) {
  switch (payload.type) {
    case 'text':
      return { type: 'text', text: payload.text?.body || '' };
    case 'interactive': {
      const i = payload.interactive || {};
      if (i.type === 'button') return { type: 'buttons', text: i.body?.text || '', meta: { buttons: (i.action?.buttons || []).map((b) => b.reply?.title) } };
      if (i.type === 'list') {
        const rows = (i.action?.sections || []).flatMap((s) => s.rows || []).map((r) => ({ title: r.title, description: r.description || '' }));
        return { type: 'list', text: i.body?.text || '', meta: { header: i.header?.text || '', button: i.action?.button || '', rows } };
      }
      return { type: 'interactive', text: i.body?.text || '' };
    }
    case 'document':
      return { type: 'document', text: payload.document?.caption || '', meta: { link: payload.document?.link, filename: payload.document?.filename } };
    case 'location': {
      const l = payload.location || {};
      return { type: 'location', text: l.name || 'Location', meta: { latitude: l.latitude, longitude: l.longitude, name: l.name, address: l.address } };
    }
    case 'template': {
      const t = payload.template || {};
      const params = (t.components || []).flatMap((c) => c.parameters || []).map((p) => p.text);
      return { type: 'template', text: `Template “${t.name}”`, meta: { name: t.name, language: t.language?.code, params } };
    }
    default:
      return { type: payload.type || 'unknown', text: '' };
  }
}

/** What the customer sent. Media is shown as a labelled placeholder (with any caption). */
function describeInbound(message) {
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

async function updateLeadForMessage(tenantId, phone, direction, sentBy, at, preview) {
  const set = { lastMessageAt: at, lastMessagePreview: preview.slice(0, 140), lastMessageDirection: direction, lastMessageSentBy: sentBy };
  const update = { $set: set };
  if (direction === 'in') {
    set.lastInboundAt = at;
    update.$inc = { unreadCount: 1 };
  }
  const opts = { new: true, upsert: direction === 'in', setDefaultsOnInsert: true };
  try {
    return await Lead.findOneAndUpdate({ tenantId, phone }, update, opts).lean();
  } catch (err) {
    if (err.code === 11000) return Lead.findOneAndUpdate({ tenantId, phone }, update, { new: true }).lean();
    throw err;
  }
}

/** Saves one message, updates the lead's inbox fields and notifies open dashboards. Never throws. */
async function recordMessage({ tenantId, phone, direction, sentBy, type, text = '', meta = null, waMessageId = null, status, profileName = null }) {
  try {
    const message = await Message.create({ tenantId, phone, direction, sentBy, type, text, meta, waMessageId, status: status || (direction === 'in' ? 'received' : 'sent') });
    let lead = await updateLeadForMessage(tenantId, phone, direction, sentBy, message.createdAt, previewOf(type, text, meta));
    // Use the customer's WhatsApp profile name when we only have the placeholder.
    if (lead && profileName && (!lead.name || lead.name === DEFAULT_NAME)) {
      lead = await Lead.findOneAndUpdate({ _id: lead._id }, { $set: { name: String(profileName).slice(0, 80) } }, { new: true }).lean();
    }
    publish(tenantId, 'message:new', { message: message.toJSON(), lead });
    return { message, lead };
  } catch (err) {
    logger.warn(`[ChatLog] Could not record ${direction} message for +${phone}: ${err.message}`);
    return { message: null, lead: null };
  }
}

/** onSent hook for MetaApiClient: records each successful send as an outbound chat message. */
const outboundRecorder = (tenantId, sentBy) => (payload, response) =>
  recordMessage({ tenantId, phone: payload.to, direction: 'out', sentBy, ...describeOutbound(payload), waMessageId: response?.messages?.[0]?.id || null });

const recordInbound = (tenantId, from, message, profileName) =>
  recordMessage({ tenantId, phone: from, direction: 'in', sentBy: 'customer', ...describeInbound(message), waMessageId: message.id || null, profileName });

const STATUS_RANK = { sent: 1, delivered: 2, read: 3 };

/** Applies a delivery status to the chat message it belongs to (if we recorded one). */
async function applyMessageStatus(tenantId, waMessageId, status, error) {
  const s = String(status).toLowerCase();
  let filter = { tenantId, waMessageId };
  const set = { status: s };
  if (s === 'failed') set.error = error || 'Failed';
  else if (STATUS_RANK[s]) filter = { ...filter, status: { $in: Object.keys(STATUS_RANK).filter((k) => STATUS_RANK[k] < STATUS_RANK[s]) } };
  else return null;
  const message = await Message.findOneAndUpdate(filter, { $set: set }, { new: true }).lean();
  if (message) publish(tenantId, 'message:status', { id: String(message._id), waMessageId, phone: message.phone, status: message.status, error: message.error });
  return message;
}

module.exports = { recordMessage, recordInbound, outboundRecorder, applyMessageStatus, describeInbound, describeOutbound };
