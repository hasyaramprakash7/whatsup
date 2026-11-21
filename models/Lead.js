const mongoose = require('mongoose');
const leadSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  phone: { type: String, required: true, index: true },
  name: { type: String, default: 'Valued Customer', trim: true },
  configuration: { type: String, default: 'Unspecified' },
  budget: { type: String, default: 'Unspecified' },
  visitSlot: { type: String, default: null }, // human-readable, e.g. "Saturday, 28 Nov 2026 at 4:00 PM"
  visitAt: { type: Date, default: null },     // the exact booked date and time
  adminAlertStatus: { type: String, enum: ['SENT', 'FAILED'], default: null },
  adminAlertAt: { type: Date, default: null },
  status: { type: String, enum: ['BROADCAST_SENT', 'ENGAGED', 'QUALIFIED', 'VISIT_CONFIRMED', 'COLD'], default: 'BROADCAST_SENT' },
  lastBroadcastAt: { type: Date, default: null, index: true },
}, { timestamps: true });
leadSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
module.exports = mongoose.model('Lead', leadSchema);