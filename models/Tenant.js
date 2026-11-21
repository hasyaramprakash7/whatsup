const mongoose = require('mongoose');
const tenantSchema = new mongoose.Schema({
  businessName: { type: String, required: true, trim: true },
  phoneNumberId: { type: String, required: true, unique: true, index: true },
  wabaId: { type: String, required: true },
  accessToken: { type: String, required: true, select: false },
  apiKeyHash: { type: String, select: false, index: { unique: true, sparse: true } },
  adminNotificationPhone: { type: String, required: true, trim: true },
  tier: { type: Number, default: 0, min: 0, max: 3 },
  projectDetails: {
    projectName: { type: String, required: true, default: 'Luxury Heights' },
    brochurePdfUrl: { type: String, default: null },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    siteAddress: { type: String, required: true },
  },
  // Bot Studio content (validated by services/botContent.js); null = use the defaults.
  botContent: { type: mongoose.Schema.Types.Mixed, default: null },
  // Meta-approved template names for this vendor's WhatsApp account; empty = use the .env defaults.
  templates: {
    broadcastName: { type: String, default: null },
    broadcastLanguage: { type: String, default: null },
    broadcastHasParams: { type: Boolean, default: null },
    adminAlertName: { type: String, default: null },
    adminAlertLanguage: { type: String, default: null },
  },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
tenantSchema.set('toJSON', { transform: (_doc, ret) => { delete ret.accessToken; delete ret.apiKeyHash; delete ret.__v; return ret; } });
module.exports = mongoose.model('Tenant', tenantSchema);