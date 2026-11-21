const Tenant = require('../models/Tenant');
const { normalizePhone, isValidPhone } = require('../utils/phoneUtils');
const logger = require('../utils/logger');
const { generateTenantApiKey } = require('../middleware/auth');

exports.createTenant = async (req, res) => {
  logger.info('[API] Creating new tenant...');
  try {
    const { businessName, phoneNumberId, wabaId, accessToken, adminNotificationPhone, projectDetails, tier } = req.body;

    const adminPhone = normalizePhone(adminNotificationPhone);
    if (!isValidPhone(adminPhone)) {
      logger.warn('[API] Tenant creation failed: Invalid admin phone.');
      return res.status(400).json({ success: false, error: 'Invalid adminNotificationPhone' });
    }

    const { key: apiKey, hash: apiKeyHash } = generateTenantApiKey();
    const tenant = await Tenant.create({
      businessName, phoneNumberId, wabaId, accessToken, apiKeyHash,
      adminNotificationPhone: adminPhone,
      tier: typeof tier === 'number' ? tier : 0,
      projectDetails: {
        projectName: projectDetails.projectName,
        brochurePdfUrl: projectDetails.brochurePdfUrl || null,
        latitude: projectDetails.latitude, longitude: projectDetails.longitude, siteAddress: projectDetails.siteAddress,
      },
    });

    logger.info(`[API] ✅ Tenant created successfully: ${tenant.businessName} (ID: ${tenant._id})`);
    // The plaintext key is returned only here; only its hash is stored.
    return res.status(201).json({ success: true, tenant, apiKey });
  } catch (error) {
    if (error.code === 11000) {
      logger.warn(`[API] Tenant creation failed: phoneNumberId ${req.body.phoneNumberId} already exists.`);
      return res.status(409).json({ success: false, error: 'phoneNumberId already exists' });
    }
    logger.error(`[API] Tenant creation error: ${error.message}`);
    return res.status(400).json({ success: false, error: error.message });
  }
};

exports.getAllTenants = async (req, res) => {
  // Tenants only ever see themselves; admins see everyone.
  const filter = req.auth.role === 'admin' ? {} : { _id: req.auth.tenantId };
  const tenants = await Tenant.find(filter).sort({ createdAt: -1 });
  logger.debug(`[API] Fetched ${tenants.length} tenants.`);
  return res.json({ success: true, count: tenants.length, data: tenants });
};

exports.getTenantById = async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) {
    logger.warn(`[API] Tenant ${req.params.id} not found.`);
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  return res.json({ success: true, data: tenant });
};

exports.rotateApiKey = async (req, res) => {
  const { key: apiKey, hash: apiKeyHash } = generateTenantApiKey();
  const tenant = await Tenant.findByIdAndUpdate(req.params.id, { apiKeyHash }, { new: true });
  if (!tenant) return res.status(404).json({ success: false, error: 'Not found' });
  logger.info(`[API] API key rotated for tenant ${tenant.businessName} (ID: ${tenant._id})`);
  return res.json({ success: true, tenantId: tenant._id, apiKey });
};

exports.whoAmI = (req, res) => res.json({ success: true, auth: req.auth });