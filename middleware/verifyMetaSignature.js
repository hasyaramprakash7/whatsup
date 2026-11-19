const crypto = require('crypto');
const logger = require('../utils/logger');

module.exports = function verifyMetaSignature(req, res, next) {
  const secret = process.env.META_APP_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('[Security] META_APP_SECRET missing in production — rejecting webhook.');
      return res.sendStatus(500);
    }
    logger.warn('[Security] META_APP_SECRET not set — skipping verification (dev only).');
    return next();
  }

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    logger.warn('[Security] Missing X-Hub-Signature-256 header — rejecting.');
    return res.sendStatus(401);
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    logger.error('[Security] rawBody not captured — check express.json verify hook.');
    return res.sendStatus(500);
  }

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    logger.warn('[Security] Invalid webhook signature — rejecting.');
    return res.sendStatus(401);
  }

  logger.debug('[Security] Webhook signature verified successfully.');
  return next();
};