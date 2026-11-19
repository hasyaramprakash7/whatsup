const { Queue } = require('bullmq');
const { createRedisConnection } = require('../config/queue');
const logger = require('../utils/logger');

const BROADCAST_QUEUE = 'broadcast';
logger.info(`[Queue] Initializing Producer for queue: ${BROADCAST_QUEUE}`);

const connection = createRedisConnection('broadcast-queue-producer');

const broadcastQueue = new Queue(BROADCAST_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: Number(process.env.BROADCAST_ATTEMPTS) || 3,
    backoff: { type: 'exponential', delay: Number(process.env.BROADCAST_BACKOFF_MS) || 5000 },
    removeOnComplete: { age: 86400, count: 5000 },
    removeOnFail: { age: 604800 },
  },
});

async function enqueueBroadcastBatch({ tenantId, recipients }) {
  logger.info(`[Queue] Preparing to enqueue ${recipients.length} jobs for tenant ${tenantId}`);
  const jobs = recipients.map((r) => ({
    name: 'send-template',
    data: { tenantId: String(tenantId), phone: r.phone, customerName: r.customerName, enqueuedAt: new Date().toISOString() },
  }));

  const added = await broadcastQueue.addBulk(jobs);
  logger.info(`[Queue] Successfully added ${added.length} jobs to Redis queue.`);
  return added.length;
}

async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    broadcastQueue.getWaitingCount(), broadcastQueue.getActiveCount(), broadcastQueue.getCompletedCount(), broadcastQueue.getFailedCount(), broadcastQueue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

module.exports = { broadcastQueue, enqueueBroadcastBatch, getQueueStats, BROADCAST_QUEUE };