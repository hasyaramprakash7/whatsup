const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Lead = require('../models/Lead');
const Message = require('../models/Message');
const MetaApiClient = require('../services/metaApiClient');
const { outboundRecorder } = require('../services/chatLog');
const { publish } = require('../services/realtime');
const logger = require('../utils/logger');

// WhatsApp only allows free-form replies within 24h of the customer's last message.
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clampInt = (v, def, min, max) => Math.min(Math.max(parseInt(v, 10) || def, min), max);

/** Conversations, newest first. ?search= matches name or phone; ?before=<ISO> pages back. */
exports.listChats = async (req, res) => {
  const { tenantId } = req.params;
  const limit = clampInt(req.query.limit, 30, 1, 100);
  const filter = { tenantId, lastMessageAt: { $ne: null } };
  const search = String(req.query.search || '').trim();
  if (search) {
    const digits = search.replace(/\D/g, '');
    filter.$or = [{ name: { $regex: escapeRegex(search), $options: 'i' } }, ...(digits ? [{ phone: { $regex: escapeRegex(digits) } }] : [])];
  }
  if (req.query.unread === 'true') filter.unreadCount = { $gt: 0 };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (!Number.isNaN(before.getTime())) filter.lastMessageAt = { $lt: before };
  }

  const [chats, unread] = await Promise.all([
    Lead.find(filter).sort({ lastMessageAt: -1 }).limit(limit).lean(),
    Lead.aggregate([{ $match: { tenantId: new mongoose.Types.ObjectId(tenantId), unreadCount: { $gt: 0 } } }, { $group: { _id: null, chats: { $sum: 1 }, messages: { $sum: '$unreadCount' } } }]),
  ]);
  return res.json({ success: true, data: chats, hasMore: chats.length === limit, unreadChats: unread[0]?.chats || 0 });
};

/** One chat's messages, oldest first. ?before=<ISO createdAt> loads older ones. */
exports.getMessages = async (req, res) => {
  const { tenantId, phone } = req.params;
  const limit = clampInt(req.query.limit, 50, 1, 200);
  const filter = { tenantId, phone };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (!Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
  }
  const [lead, messages] = await Promise.all([
    Lead.findOne({ tenantId, phone }).lean(),
    Message.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
  ]);
  if (!lead) return res.status(404).json({ success: false, error: 'Chat not found' });
  return res.json({ success: true, lead, data: messages.reverse(), hasMore: messages.length === limit });
};

/** A team member replies from the Inbox. The bot pauses for this chat so it doesn't talk over them. */
exports.sendMessage = async (req, res) => {
  const { tenantId, phone } = req.params;
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ success: false, error: 'Type a message first.' });
  if (text.length > 4096) return res.status(400).json({ success: false, error: 'Messages can be at most 4096 characters.' });

  const [tenant, lead] = await Promise.all([
    Tenant.findById(tenantId).select('+accessToken'),
    Lead.findOne({ tenantId, phone }).lean(),
  ]);
  if (!tenant || !tenant.isActive) return res.status(404).json({ success: false, error: 'Tenant not found or inactive' });
  if (!lead) return res.status(404).json({ success: false, error: 'Chat not found' });
  if (lead.status === 'COLD') return res.status(409).json({ success: false, error: 'This lead opted out. WhatsApp policy does not allow messaging them.' });
  if (!lead.lastInboundAt || Date.now() - new Date(lead.lastInboundAt).getTime() > REPLY_WINDOW_MS) {
    return res.status(409).json({ success: false, code: 'WINDOW_CLOSED', error: "More than 24 hours since this customer's last message. WhatsApp only allows a template now — re-engage them with a broadcast." });
  }

  let recorded = null;
  const record = outboundRecorder(tenant._id, 'agent');
  const client = new MetaApiClient(tenant.accessToken, tenant.phoneNumberId, { onSent: async (payload, data) => { recorded = await record(payload, data); } });
  try {
    await client.sendTextMessage(phone, text);
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    logger.warn(`[Chat] Team reply to +${phone} failed: ${detail}`);
    return res.status(502).json({ success: false, error: `WhatsApp rejected the message: ${detail}` });
  }

  let updatedLead = recorded?.lead || lead;
  const pauseBot = req.body?.pauseBot !== false;
  if (pauseBot && !lead.botPaused) {
    updatedLead = await Lead.findOneAndUpdate({ _id: lead._id }, { $set: { botPaused: true } }, { new: true }).lean();
    publish(tenantId, 'lead:update', { lead: updatedLead });
  }
  return res.status(201).json({ success: true, data: recorded?.message || null, lead: updatedLead });
};

exports.markRead = async (req, res) => {
  const { tenantId, phone } = req.params;
  const lead = await Lead.findOneAndUpdate({ tenantId, phone }, { $set: { unreadCount: 0 } }, { new: true }).lean();
  if (!lead) return res.status(404).json({ success: false, error: 'Chat not found' });
  publish(tenantId, 'lead:update', { lead });
  return res.json({ success: true, lead });
};

/** Turn the bot on/off for one chat. */
exports.updateChat = async (req, res) => {
  const { tenantId, phone } = req.params;
  if (typeof req.body?.botPaused !== 'boolean') return res.status(400).json({ success: false, error: 'Send { "botPaused": true | false }.' });
  const lead = await Lead.findOneAndUpdate({ tenantId, phone }, { $set: { botPaused: req.body.botPaused } }, { new: true }).lean();
  if (!lead) return res.status(404).json({ success: false, error: 'Chat not found' });
  publish(tenantId, 'lead:update', { lead });
  return res.json({ success: true, lead });
};
