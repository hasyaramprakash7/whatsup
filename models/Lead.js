const mongoose = require('mongoose');
const leadSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  phone: { type: String, required: true, index: true },
  name: { type: String, default: 'Valued Customer', trim: true },
  configuration: { type: String, default: 'Unspecified' },
  budget: { type: String, default: 'Unspecified' },
  visitSlot: { type: String, default: null }, // human-readable, e.g. "Saturday, 28 Nov 2026 at 4:00 PM"
  visitAt: { type: Date, default: null },     // the exact booked date and time
  adminAlertStatus: { type: String, enum: ['SENT', 'DELIVERED', 'FAILED'], default: null },
  adminAlertAt: { type: Date, default: null },
  adminAlertMessageId: { type: String, default: null },
  adminAlertError: { type: String, default: null },
  status: { type: String, enum: ['BROADCAST_SENT', 'ENGAGED', 'QUALIFIED', 'VISIT_CONFIRMED', 'COLD'], default: 'BROADCAST_SENT' },
  lastBroadcastAt: { type: Date, default: null, index: true },
  // Delivery of the latest broadcast template, updated from Meta's status webhooks.
  lastBroadcastMessageId: { type: String, default: null },
  broadcastStatus: { type: String, enum: ['SENT', 'DELIVERED', 'READ', 'FAILED'], default: null },
  broadcastStatusAt: { type: Date, default: null },
  broadcastError: { type: String, default: null },
  // Inbox
  lastMessageAt: { type: Date, default: null },
  lastMessagePreview: { type: String, default: null },
  lastMessageDirection: { type: String, enum: ['in', 'out'], default: null },
  lastMessageSentBy: { type: String, enum: ['customer', 'bot', 'agent', 'broadcast'], default: null },
  lastInboundAt: { type: Date, default: null }, // starts WhatsApp's 24h window for free-form replies
  unreadCount: { type: Number, default: 0 },
  botPaused: { type: Boolean, default: false }, // a person from the vendor's team has taken over
}, { timestamps: true });
leadSchema.index({ tenantId: 1, lastMessageAt: -1 });
leadSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
leadSchema.index({ tenantId: 1, lastBroadcastMessageId: 1 }, { partialFilterExpression: { lastBroadcastMessageId: { $type: 'string' } } });
leadSchema.index({ tenantId: 1, adminAlertMessageId: 1 }, { partialFilterExpression: { adminAlertMessageId: { $type: 'string' } } });
module.exports = mongoose.model('Lead', leadSchema);