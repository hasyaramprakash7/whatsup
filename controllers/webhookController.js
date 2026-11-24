const crypto = require('crypto');
const { extractWebhookEvents, enqueueWebhookEvents } = require('../queues/inboundQueue');
const logger = require('../utils/logger');

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();

exports.verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;

  logger.info('[Webhook] Received GET verification request from Meta.');
  if (!expected) {
    logger.error('[Webhook] ❌ WHATSAPP_VERIFY_TOKEN is not set — refusing verification.');
    return res.sendStatus(403);
  }
  if (mode === 'subscribe' && typeof token === 'string' && crypto.timingSafeEqual(sha256(token), sha256(expected))) {
    logger.info('[Webhook] ✅ Verification successful. Returning challenge.');
    return res.status(200).send(challenge);
  }
  logger.warn('[Webhook] ❌ Verification failed: Token mismatch.');
  return res.sendStatus(403);
};

/**
 * Queues every message and status in the payload, then ACKs. If queueing fails we answer 500 so
 * Meta retries the delivery; duplicates from those retries are ignored by the queue's job ids.
 */
exports.handleIncomingMessage = async (req, res) => {
  const events = extractWebhookEvents(req.body);
  if (!events.length) {
    logger.debug('[Webhook] Payload had no messages or statuses. Ignoring.');
    return res.sendStatus(200);
  }

  try {
    await enqueueWebhookEvents(events);
    logger.debug(`[Webhook] Queued ${events.length} event(s).`);
    return res.sendStatus(200);
  } catch (err) {
    logger.error(`[Webhook] Could not queue ${events.length} event(s), asking Meta to retry: ${err.message}`);
    return res.sendStatus(500);
  }
};
