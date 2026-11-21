const crypto = require('crypto');
const Tenant = require('../models/Tenant');
const logger = require('../utils/logger');

const TENANT_KEY_PREFIX = 'wre_';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Compares via fixed-length digests so neither content nor length leaks through timing.
const safeEqual = (a, b) => crypto.timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b)));

/** Generates a new tenant API key. Returns the plaintext (shown once) and the hash to store. */
function generateTenantApiKey() {
  const key = TENANT_KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
  return { key, hash: sha256(key) };
}

function extractKey(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** { role: 'admin' } | { role: 'tenant', tenantId, businessName } for a valid key, otherwise null. */
async function resolveApiKey(key) {
  if (!key || typeof key !== 'string') return null;
  const adminKey = process.env.ADMIN_API_KEY;
  if (adminKey && safeEqual(key, adminKey)) return { role: 'admin' };
  if (key.startsWith(TENANT_KEY_PREFIX)) {
    const tenant = await Tenant.findOne({ apiKeyHash: sha256(key) }).select('_id businessName isActive');
    if (tenant && tenant.isActive) return { role: 'tenant', tenantId: String(tenant._id), businessName: tenant.businessName };
  }
  return null;
}

/** Resolves the caller to { role: 'admin' } or { role: 'tenant', tenantId }; 401 otherwise. */
async function authenticate(req, res, next) {
  const key = extractKey(req);
  if (!key) return res.status(401).json({ success: false, error: 'Missing API key. Send "Authorization: Bearer <key>".' });

  try {
    const auth = await resolveApiKey(key);
    if (auth) {
      req.auth = auth;
      return next();
    }

    logger.warn(`[Auth] Rejected invalid API key on ${req.method} ${req.originalUrl} from ${req.ip}`);
    return res.status(401).json({ success: false, error: 'Invalid API key.' });
  } catch (err) {
    return next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.auth?.role === 'admin') return next();
  return res.status(403).json({ success: false, error: 'Admin access required.' });
}

/** Allows admins, or the tenant whose id is in req.params[paramName]. */
const requireTenantAccess = (paramName = 'tenantId') => (req, res, next) => {
  if (req.auth?.role === 'admin') return next();
  if (req.auth?.role === 'tenant' && req.auth.tenantId === String(req.params[paramName])) return next();
  return res.status(403).json({ success: false, error: 'You do not have access to this tenant.' });
};

module.exports = { authenticate, resolveApiKey, requireAdmin, requireTenantAccess, generateTenantApiKey };
