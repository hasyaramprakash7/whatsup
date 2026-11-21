require('dotenv').config();
const { Worker } = require('bullmq');
const { createRedisConnection } = require('../config/queue');
const connectDB = require('../config/db');
const Tenant = require('../models/Tenant');
const Lead = require('../models/Lead');
const MetaApiClient = require('../services/metaApiClient');
const { outboundRecorder } = require('../services/chatLog');
const { publish } = require('../services/realtime');
const sessionRedis = require('../config/redis');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

const BROADCAST_QUEUE = 'broadcast';

// Defaults for vendors who haven't set their own template in the dashboard.
// Override in .env to test with another approved template, e.g. Meta's hello_world (en_US, no variables).
const TEMPLATE_NAME = process.env.BROADCAST_TEMPLATE_NAME || 'realestate_reengage_v1';
const TEMPLATE_LANG = process.env.BROADCAST_TEMPLATE_LANG || 'en';
// realestate_reengage_v1 takes {{1}}=customer name, {{2}}=project name; set to false for templates without variables.
const TEMPLATE_HAS_PARAMS = (process.env.BROADCAST_TEMPLATE_PARAMS || 'true').toLowerCase() !== 'false';

async function main() {
  await connectDB();
  const connection = createRedisConnection('broadcast-worker');

  logger.info(`[Worker] Starting worker for queue: ${BROADCAST_QUEUE}...`);

  const worker = new Worker(BROADCAST_QUEUE, async (job) => {
    logger.info(`[Worker] 🔄 Picked up Job ${job.id} | Phone: ${job.data.phone} | Attempt: ${job.attemptsMade + 1}`);
    const { tenantId, phone, customerName } = job.data;

    const tenant = await Tenant.findById(tenantId).select('+accessToken');
    if (!tenant || !tenant.isActive) {
      logger.error(`[Worker] ❌ Job ${job.id} failed: Tenant ${tenantId} missing or inactive.`);
      throw new Error(`Tenant ${tenantId} missing or inactive`);
    }

    const existing = await Lead.findOne({ tenantId: tenant._id, phone });
    if (existing && existing.status === 'COLD') {
      logger.warn(`[Worker] ⏭️ Skipping +${phone} because they are marked COLD (opted out).`);
      return { phone, skipped: 'COLD' };
    }

    // The broadcast also appears in the lead's chat in the Inbox.
    const client = new MetaApiClient(tenant.accessToken, tenant.phoneNumberId, { onSent: outboundRecorder(tenant._id, 'broadcast') });
    const t = tenant.templates || {};
    const templateName = t.broadcastName || TEMPLATE_NAME;
    const templateLang = t.broadcastLanguage || TEMPLATE_LANG;
    const hasParams = typeof t.broadcastHasParams === 'boolean' && t.broadcastName ? t.broadcastHasParams : TEMPLATE_HAS_PARAMS;

    // DB Update before sending. Status is only set on insert so an existing lead keeps its progress.
    await Lead.findOneAndUpdate(
      { tenantId: tenant._id, phone },
      { $set: { name: customerName, lastBroadcastAt: new Date() }, $setOnInsert: { tenantId: tenant._id, phone, status: 'BROADCAST_SENT' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).catch((err) => {
      if (err.code !== 11000) throw err;
    });

    const params = hasParams ? [customerName, tenant.projectDetails.projectName] : [];
    logger.info(`[Worker] 📤 Sending template '${templateName}' (${templateLang}) to +${phone}...`);
    const sent = await client.sendTemplate(phone, templateName, params, templateLang);

    // Remember the message id so Meta's delivered/read/failed webhooks can be matched to this lead.
    const updatedLead = await Lead.findOneAndUpdate(
      { tenantId: tenant._id, phone },
      { $set: { lastBroadcastMessageId: sent?.messages?.[0]?.id || null, broadcastStatus: 'SENT', broadcastStatusAt: new Date(), broadcastError: null } },
      { new: true }
    ).lean().catch((err) => logger.warn(`[Worker] Could not save message id for +${phone}: ${err.message}`));
    if (updatedLead) publish(tenant._id, 'lead:update', { lead: updatedLead });

    // A fresh broadcast starts a fresh conversation: drop any saved bot step (e.g. COMPLETED)
    // so the lead's next reply begins the flow again. Key format matches ConversationEngine.sessionKey().
    await sessionRedis.del(`session:${tenant._id}:${phone}`).catch((err) =>
      logger.warn(`[Worker] Could not reset conversation state for +${phone}: ${err.message}`));

    logger.info(`[Worker] ✅ Job ${job.id} finished successfully for +${phone}.`);
    return { phone, deliveredAt: new Date().toISOString() };
  }, {
    connection,
    concurrency: Number(process.env.BROADCAST_CONCURRENCY) || 1,
    limiter: { max: Number(process.env.BROADCAST_RATE_MAX) || 10, duration: Number(process.env.BROADCAST_RATE_DURATION_MS) || 1000 },
  });

  worker.on('completed', (job) => logger.debug(`[Worker Event] Job ${job.id} marked as completed.`));
  worker.on('failed', async (job, err) => {
    if (!job) return;
    const finalAttempt = job.attemptsMade >= (job.opts?.attempts || 1);
    if (!finalAttempt) {
      logger.warn(`[Worker Event] Job ${job.id} failed (attempt ${job.attemptsMade}), will retry. Reason: ${err.message}`);
      return;
    }
    logger.error(`[Worker Event] Job ${job.id} failed permanently. Reason: ${err.message}`);
    // Show the failure on the lead instead of leaving it looking like a successful send.
    const detail = err.response?.data?.error;
    const errorText = detail ? `${detail.code}: ${detail.error_data?.details || detail.message}` : err.message;
    const failedLead = await Lead.findOneAndUpdate(
      { tenantId: job.data.tenantId, phone: job.data.phone },
      { $set: { broadcastStatus: 'FAILED', broadcastStatusAt: new Date(), broadcastError: errorText, lastBroadcastMessageId: null } },
      { new: true }
    ).lean().catch((e) => logger.warn(`[Worker Event] Could not record failure for +${job.data.phone}: ${e.message}`));
    if (failedLead) publish(job.data.tenantId, 'lead:update', { lead: failedLead });
  });
  worker.on('error', (err) => logger.error(`[Worker Event] Fatal error: ${err.message}`));

  logger.info(`[Worker] Ready and listening. Concurrency: ${process.env.BROADCAST_CONCURRENCY || 1}, Rate: ${process.env.BROADCAST_RATE_MAX || 10}/${process.env.BROADCAST_RATE_DURATION_MS || 1000}ms`);

  const shutdown = async (signal) => {
    logger.info(`[Worker] ${signal} received — draining queue and shutting down...`);
    await worker.close();
    await connection.quit();
    await sessionRedis.quit();
    await mongoose.connection.close();
    logger.info('[Worker] Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error(`[Worker] Boot failed: ${err.message}`);
  process.exit(1);
});