const Tenant = require('../models/Tenant');
const { normalizePhone, isValidPhone } = require('../utils/phoneUtils');
const logger = require('../utils/logger');
const { generateTenantApiKey } = require('../middleware/auth');
const { getBotContent, validateBotContent, DEFAULT_BOT_CONTENT } = require('../services/botContent');

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
  // botContent = what the bot actually says now (saved values over defaults), for Bot Studio.
  return res.json({ success: true, data: tenant, botContent: getBotContent(tenant), botDefaults: DEFAULT_BOT_CONTENT });
};

const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

/**
 * Vendors edit their own project, contact, templates and bot messages from the dashboard.
 * Only admins can change the WhatsApp credentials, tier and active flag.
 */
exports.updateTenant = async (req, res) => {
  const body = req.body || {};
  const isAdmin = req.auth.role === 'admin';
  const set = {};
  const errors = [];

  if (body.businessName !== undefined) {
    const v = String(body.businessName).trim();
    if (!v || v.length > 120) errors.push('Business name: 1–120 characters.');
    set.businessName = v;
  }
  if (body.adminNotificationPhone !== undefined) {
    const phone = normalizePhone(body.adminNotificationPhone);
    if (!isValidPhone(phone)) errors.push('Alert phone: enter a valid number with country code.');
    set.adminNotificationPhone = phone;
  }

  const p = body.projectDetails;
  if (p && typeof p === 'object') {
    if (p.projectName !== undefined) {
      const v = String(p.projectName).trim();
      if (!v || v.length > 120) errors.push('Project name: 1–120 characters.');
      set['projectDetails.projectName'] = v;
    }
    if (p.siteAddress !== undefined) {
      const v = String(p.siteAddress).trim();
      if (!v || v.length > 300) errors.push('Site address: 1–300 characters.');
      set['projectDetails.siteAddress'] = v;
    }
    if (p.latitude !== undefined) {
      const v = Number(p.latitude);
      if (!Number.isFinite(v) || v < -90 || v > 90) errors.push('Latitude must be between -90 and 90.');
      set['projectDetails.latitude'] = v;
    }
    if (p.longitude !== undefined) {
      const v = Number(p.longitude);
      if (!Number.isFinite(v) || v < -180 || v > 180) errors.push('Longitude must be between -180 and 180.');
      set['projectDetails.longitude'] = v;
    }
    // Brochures are uploaded via /api/uploads; here it can only be removed.
    if (p.brochurePdfUrl === null) set['projectDetails.brochurePdfUrl'] = null;
  }

  const t = body.templates;
  if (t && typeof t === 'object') {
    for (const [field, re, label] of [['broadcastName', TEMPLATE_NAME_RE, 'Broadcast template name'], ['adminAlertName', TEMPLATE_NAME_RE, 'Alert template name'],
      ['broadcastLanguage', LANGUAGE_RE, 'Broadcast template language'], ['adminAlertLanguage', LANGUAGE_RE, 'Alert template language']]) {
      if (t[field] === undefined) continue;
      const v = t[field] === null ? '' : String(t[field]).trim();
      if (v && !re.test(v)) errors.push(`${label} looks invalid (template names use lowercase letters, numbers and _; languages look like en or en_US).`);
      set[`templates.${field}`] = v || null;
    }
    if (t.broadcastHasParams !== undefined) set['templates.broadcastHasParams'] = t.broadcastHasParams === null ? null : Boolean(t.broadcastHasParams);
  }

  if (body.botContent !== undefined) {
    if (body.botContent === null) {
      set.botContent = null; // reset everything to the defaults
    } else {
      const { value, errors: contentErrors } = validateBotContent(body.botContent);
      errors.push(...contentErrors);
      set.botContent = value;
    }
  }

  if (isAdmin) {
    if (body.tier !== undefined) {
      const v = Number(body.tier);
      if (![0, 1, 2, 3].includes(v)) errors.push('Tier must be 0–3.');
      set.tier = v;
    }
    if (body.isActive !== undefined) set.isActive = Boolean(body.isActive);
    if (body.wabaId !== undefined) set.wabaId = String(body.wabaId).trim();
    if (body.accessToken) set.accessToken = String(body.accessToken).trim();
  } else if (['tier', 'isActive', 'wabaId', 'accessToken', 'phoneNumberId'].some((k) => body[k] !== undefined)) {
    return res.status(403).json({ success: false, error: 'Only an admin can change WhatsApp credentials, tier or account status.' });
  }

  if (errors.length) return res.status(400).json({ success: false, error: errors[0], errors });
  if (!Object.keys(set).length) return res.status(400).json({ success: false, error: 'Nothing to update.' });

  const tenant = await Tenant.findByIdAndUpdate(req.params.id, { $set: set }, { new: true, runValidators: true });
  if (!tenant) return res.status(404).json({ success: false, error: 'Not found' });
  logger.info(`[API] Tenant ${tenant.businessName} updated (${Object.keys(set).join(', ')}).`);
  return res.json({ success: true, data: tenant, botContent: getBotContent(tenant), botDefaults: DEFAULT_BOT_CONTENT });
};

exports.rotateApiKey = async (req, res) => {
  const { key: apiKey, hash: apiKeyHash } = generateTenantApiKey();
  const tenant = await Tenant.findByIdAndUpdate(req.params.id, { apiKeyHash }, { new: true });
  if (!tenant) return res.status(404).json({ success: false, error: 'Not found' });
  logger.info(`[API] API key rotated for tenant ${tenant.businessName} (ID: ${tenant._id})`);
  return res.json({ success: true, tenantId: tenant._id, apiKey });
};

exports.whoAmI = (req, res) => res.json({ success: true, auth: req.auth });