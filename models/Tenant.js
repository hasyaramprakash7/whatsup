const mongoose = require('mongoose');
const tenantSchema = new mongoose.Schema({
  businessName: { type: String, required: true, trim: true },
  phoneNumberId: { type: String, required: true, unique: true, index: true },
  wabaId: { type: String, required: true },
  accessToken: { type: String, required: true, select: false },
  adminNotificationPhone: { type: String, required: true, trim: true },
  tier: { type: Number, default: 0, min: 0, max: 3 },
  projectDetails: {
    projectName: { type: String, required: true, default: 'Luxury Heights' },
    brochurePdfUrl: { type: String, default: null },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    siteAddress: { type: String, required: true },
  },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
tenantSchema.set('toJSON', { transform: (_doc, ret) => { delete ret.accessToken; delete ret.__v; return ret; } });
module.exports = mongoose.model('Tenant', tenantSchema);