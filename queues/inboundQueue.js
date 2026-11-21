// Inbound webhook events (customer messages and delivery statuses) are queued in Redis before
// Meta gets its 200, so a crash or restart never loses them, and failed jobs are retried.
const crypto = require('crypto');
const { Queue } = require('bullmq');
const { createRedisConnection } = require('../config/queue');
const logger = require('../utils/logger');

const INBOUND_QUEUE = 'inbound';
// Status jobs wait briefly so the broadcast worker has saved the message id they refer to.
const STATUS_DELAY_MS = 5000;

const connection = createRedisConnection('inbound-queue-producer');

const inboundQueue = new Queue(INBOUND_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    // Finished jobs are kept for 24h: Meta re-sending the same event gets the same job id and is ignored.
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 604800 },
  },
});

// BullMQ job ids may not contain ':', and Meta's message ids are long, so use a hash.
const jobIdFor = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex');

/** Pulls every message and status out of a webhook body (Meta can batch several in one call). */
function extractWebhookEvents(body) {
  const events = [];
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const names = new Map((value.contacts || []).map((c) => [c?.wa_id, c?.profile?.name]));
      for (const message of value.messages || []) {
        if (message?.id && message?.from) events.push({ kind: 'message', id: message.id, phoneNumberId, from: message.from, profileName: names.get(message.from) || null, message });
      }
      for (const s of value.statuses || []) {
        if (s?.id && s?.status) {
          events.push({ kind: 'status', id: s.id, phoneNumberId, status: s.status, recipient: s.recipient_id || null, timestamp: s.timestamp || null, errors: s.errors || [] });
        }
      }
    }
  }
  return events;
}

async function enqueueWebhookEvents(events) {
  if (!events.length) return 0;
  await inboundQueue.addBulk(events.map((e) => ({
    name: e.kind,
    data: e,
    opts: { jobId: jobIdFor(e.kind, e.id, e.status || ''), ...(e.kind === 'status' ? { delay: STATUS_DELAY_MS } : {}) },
  })));
  logger.debug(`[Inbound Queue] Enqueued ${events.length} webhook event(s).`);
  return events.length;
}

module.exports = { inboundQueue, extractWebhookEvents, enqueueWebhookEvents, INBOUND_QUEUE };
