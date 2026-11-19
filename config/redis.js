const Redis = require('ioredis');
const logger = require('../utils/logger');

let redis;

if (process.env.REDIS_URL) {
  logger.info('[Redis] Connecting via REDIS_URL...');
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      logger.warn(`[Redis] Retry attempt ${times}`);
      return Math.min(times * 50, 2000);
    },
    family: 0,
  });
} else {
  logger.info(`[Redis] Connecting via host/port ${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}...`);
  redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      logger.warn(`[Redis] Retry attempt ${times}`);
      return Math.min(times * 50, 2000);
    },
  });
}

redis.on('connect', () => logger.info('[Redis] State cache connected.'));
redis.on('ready', () => logger.info('[Redis] Ready to accept commands.'));
redis.on('error', (err) => logger.error(`[Redis] Error: ${err.message}`));

module.exports = redis;