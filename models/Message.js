const mongoose = require('mongoose');

// One WhatsApp message in a lead's chat, shown in the vendor's Inbox.
const messageSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  phone: { type: String, required: true },
  direction: { type: String, enum: ['in', 'out'], required: true },
  sentBy: { type: String, enum: ['customer', 'bot', 'agent', 'broadcast'], required: true },
  type: { type: String, required: true }, // text, buttons, list, document, location, template, reply, image, ...
  text: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: null }, // buttons, list rows, file, location, template params
  waMessageId: { type: String, default: null },
  status: { type: String, enum: ['received', 'sent', 'delivered', 'read', 'failed'], default: 'sent' },
  error: { type: String, default: null },
}, { timestamps: true });

messageSchema.index({ tenantId: 1, phone: 1, createdAt: -1 });
messageSchema.index({ tenantId: 1, waMessageId: 1 }, { partialFilterExpression: { waMessageId: { $type: 'string' } } });

messageSchema.set('toJSON', { transform: (_doc, ret) => { delete ret.__v; return ret; } });

module.exports = mongoose.model('Message', messageSchema);
