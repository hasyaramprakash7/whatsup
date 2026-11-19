const redis = require('../config/redis');
const Tenant = require('../models/Tenant');
const ConversationEngine = require('../services/conversationEngine');
const logger = require('../utils/logger');

exports.verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  logger.info('[Webhook] Received GET verification request from Meta.');
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    logger.info('[Webhook] ✅ Verification successful. Returning challenge.');
    return res.status(200).send(challenge);
  }
  logger.warn('[Webhook] ❌ Verification failed: Token mismatch.');
  return res.sendStatus(403);
};

exports.handleIncomingMessage = (req, res) => {
  logger.debug('[Webhook] Received POST payload from Meta.');
  res.sendStatus(200); // Immediate ACK

  setImmediate(() => {
    processWebhook(req.body).catch((err) => logger.error(`[Webhook] Async processing error: ${err.message}`));
  });
};

async function processWebhook(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const message = change?.messages?.[0];

  if (!message) {
    logger.debug('[Webhook] Ignored event (likely status update, not a message).');
    return;
  }

  const messageId = message.id;
  const senderPhone = message.from;
  const recipientPhoneId = change?.metadata?.phone_number_id;

  if (!messageId || !senderPhone || !recipientPhoneId) {
    logger.warn('[Webhook] Missing required fields in payload. Dropping.');
    return;
  }

  logger.info(`[Webhook] 📩 Inbound message from +${senderPhone} to PhoneID ${recipientPhoneId}.`);

  const idempotencyKey = `idemp:${messageId}`;
  const isFirstTime = await redis.set(idempotencyKey, '1', 'EX', 86400, 'NX');

  if (isFirstTime !== 'OK') {
    logger.warn(`[Webhook] Duplicate message detected (ID: ${messageId}). Dropping.`);
    return;
  }

  const tenant = await Tenant.findOne({ phoneNumberId: recipientPhoneId, isActive: true }).select('+accessToken');
  if (!tenant) {
    logger.error(`[Webhook] Tenant lookup failed. No active tenant for PhoneID ${recipientPhoneId}.`);
    return;
  }

  logger.info(`[Webhook] Routing message to engine for Tenant: ${tenant.businessName}`);
  const engine = new ConversationEngine(tenant);
  await engine.handleInboundMessage(senderPhone, message);
}

module.exports.processWebhook = processWebhook;