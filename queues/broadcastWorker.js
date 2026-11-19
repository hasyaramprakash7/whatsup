require('dotenv').config();
const { Worker } = require('bullmq');
const { createRedisConnection } = require('../config/queue');
const connectDB = require('../config/db');
const Tenant = require('../models/Tenant');
const Lead = require('../models/Lead');
const MetaApiClient = require('../services/metaApiClient');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

const BROADCAST_QUEUE = 'broadcast';

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

    const client = new MetaApiClient(tenant.accessToken, tenant.phoneNumberId);

    // DB Update before sending
    await Lead.findOneAndUpdate(
      { tenantId: tenant._id, phone },
      { $set: { name: customerName, status: 'BROADCAST_SENT', lastBroadcastAt: new Date() }, $setOnInsert: { tenantId: tenant._id, phone } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).catch((err) => {
      if (err.code !== 11000) throw err;
    });

    logger.info(`[Worker] 📤 Sending template 'realestate_reengage_v1' to +${phone}...`);
    await client.sendTemplate(phone, 'realestate_reengage_v1', customerName, tenant.projectDetails.projectName);

    logger.info(`[Worker] ✅ Job ${job.id} finished successfully for +${phone}.`);
    return { phone, deliveredAt: new Date().toISOString() };
  }, {
    connection,
    concurrency: Number(process.env.BROADCAST_CONCURRENCY) || 1,
    limiter: { max: Number(process.env.BROADCAST_RATE_MAX) || 10, duration: Number(process.env.BROADCAST_RATE_DURATION_MS) || 1000 },
  });

  worker.on('completed', (job) => logger.debug(`[Worker Event] Job ${job.id} marked as completed.`));
  worker.on('failed', (job, err) => logger.error(`[Worker Event] Job ${job?.id} failed permanently. Reason: ${err.message}`));
  worker.on('error', (err) => logger.error(`[Worker Event] Fatal error: ${err.message}`));

  logger.info(`[Worker] Ready and listening. Concurrency: ${process.env.BROADCAST_CONCURRENCY || 1}, Rate: ${process.env.BROADCAST_RATE_MAX || 10}/${process.env.BROADCAST_RATE_DURATION_MS || 1000}ms`);

  const shutdown = async (signal) => {
    logger.info(`[Worker] ${signal} received — draining queue and shutting down...`);
    await worker.close();
    await connection.quit();
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