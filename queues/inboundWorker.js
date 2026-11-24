// Processes queued webhook events. Runs inside the API server process (see server.js).
const { Worker, DelayedError } = require('bullmq');
const { createRedisConnection } = require('../config/queue');
const redis = require('../config/redis');
const Tenant = require('../models/Tenant');
const Lead = require('../models/Lead');
const Message = require('../models/Message');
const ConversationEngine = require('../services/conversationEngine');
const { recordInbound, applyMessageStatus } = require('../services/chatLog');
const { publish } = require('../services/realtime');
const logger = require('../utils/logger');
const { INBOUND_QUEUE } = require('./inboundQueue');

const LOCK_TTL_MS = 30000;
const LOCK_RETRY_MS = 1000;
// Meta error 131050: the customer turned off marketing messages from this business.
const MARKETING_OPT_OUT_CODE = 131050;

const STATUS_RANK = { SENT: 1, DELIVERED: 2, READ: 3 };

const RELEASE_LOCK = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** One customer message. A per-lead lock keeps two messages from the same person from racing. */
async function processMessageEvent(job, token) {
  const { phoneNumberId, from, message } = job.data;
  const tenant = await Tenant.findOne({ phoneNumberId, isActive: true }).select('+accessToken');
  if (!tenant) {
    logger.error(`[Inbound] No active tenant for PhoneID ${phoneNumberId}. Dropping message from +${from}.`);
    return { skipped: 'NO_TENANT' };
  }

  const lockKey = `lock:lead:${tenant._id}:${from}`;
  const lockValue = String(job.id);
  const locked = await redis.set(lockKey, lockValue, 'PX', LOCK_TTL_MS, 'NX');
  if (locked !== 'OK') {
    // Another message from this lead is being handled; try again shortly without using up an attempt.
    logger.debug(`[Inbound] +${from} is busy. Delaying job ${job.id}.`);
    await job.moveToDelayed(Date.now() + LOCK_RETRY_MS, token);
    throw new DelayedError();
  }

  try {
    logger.info(`[Inbound] 📩 Message from +${from} for tenant ${tenant.businessName}.`);
    // Retries must not show the same message twice in the Inbox.
    const already = message.id ? await Message.exists({ tenantId: tenant._id, waMessageId: message.id, direction: 'in' }) : null;
    const { lead } = already ? { lead: await Lead.findOne({ tenantId: tenant._id, phone: from }).lean() } : await recordInbound(tenant._id, from, message, job.data.profileName);

    // A team member took over this chat: the bot stays silent (opt-outs are still honoured).
    if (lead?.botPaused && !ConversationEngine.isOptOut(message)) {
      logger.info(`[Inbound] Bot paused for +${from}; leaving the reply to the team.`);
      return { handled: false, botPaused: true };
    }

    await new ConversationEngine(tenant).handleInboundMessage(from, message);
    return { handled: true };
  } finally {
    await redis.eval(RELEASE_LOCK, 1, lockKey, lockValue).catch((err) => logger.warn(`[Inbound] Lock release failed: ${err.message}`));
  }
}

/** A delivery status (sent / delivered / read / failed) for a message we sent. */
async function processStatusEvent(job) {
  const { phoneNumberId, id, status, timestamp, errors } = job.data;
  const tenant = await Tenant.findOne({ phoneNumberId }).select('_id');
  if (!tenant) return { skipped: 'NO_TENANT' };

  const upper = String(status).toUpperCase();
  const at = timestamp ? new Date(Number(timestamp) * 1000) : new Date();
  const err = errors?.[0];
  const errorText = err ? `${err.code}: ${err.error_data?.details || err.message || err.title || 'Unknown error'}` : null;

  // The chat bubble's ticks in the Inbox.
  await applyMessageStatus(tenant._id, id, status, errorText);

  const changed = [];
  const update = async (filter, set) => {
    const lead = await Lead.findOneAndUpdate({ tenantId: tenant._id, ...filter }, { $set: set }, { new: true }).lean();
    if (lead) changed.push(lead);
  };

  if (upper === 'FAILED') {
    const set = { broadcastStatus: 'FAILED', broadcastStatusAt: at, broadcastError: errorText };
    if (err?.code === MARKETING_OPT_OUT_CODE) set.status = 'COLD';
    await update({ lastBroadcastMessageId: id }, set);
    await update({ adminAlertMessageId: id }, { adminAlertStatus: 'FAILED', adminAlertError: errorText });
    if (changed.length) logger.warn(`[Delivery] Message ${id} FAILED (${errorText}).`);
  } else if (STATUS_RANK[upper]) {
    // Statuses can arrive out of order; only move forward (SENT -> DELIVERED -> READ), never back or past FAILED.
    const earlier = Object.keys(STATUS_RANK).filter((s) => STATUS_RANK[s] < STATUS_RANK[upper]);
    await update({ lastBroadcastMessageId: id, broadcastStatus: { $in: [null, ...earlier] } }, { broadcastStatus: upper, broadcastStatusAt: at });
    if (upper !== 'SENT') await update({ adminAlertMessageId: id, adminAlertStatus: 'SENT' }, { adminAlertStatus: 'DELIVERED' });
  } else {
    return { skipped: 'UNKNOWN_STATUS' };
  }

  for (const lead of changed) publish(tenant._id, 'lead:update', { lead });
  return { status: upper };
}

function startInboundWorker() {
  const connection = createRedisConnection('inbound-worker');
  const worker = new Worker(INBOUND_QUEUE, (job, token) => (job.name === 'status' ? processStatusEvent(job) : processMessageEvent(job, token)), {
    connection,
    concurrency: Number(process.env.INBOUND_CONCURRENCY) || 5,
  });

  worker.on('failed', (job, err) => logger.error(`[Inbound] Job ${job?.id} (${job?.name}) failed on attempt ${job?.attemptsMade}: ${err.message}`));
  worker.on('error', (err) => logger.error(`[Inbound] Worker error: ${err.message}`));
  logger.info(`[Inbound] Worker listening on queue '${INBOUND_QUEUE}'.`);

  return {
    worker,
    close: async () => { await worker.close(); await connection.quit(); },
  };
}

module.exports = { startInboundWorker, processMessageEvent, processStatusEvent };
