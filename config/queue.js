const IORedis = require('ioredis');
const logger = require('../utils/logger');

const createRedisConnection = (label = 'bullmq') => {
  if (process.env.REDIS_URL) {
    const conn = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectionName: label,
      family: 0,
    });
    conn.on('error', (err) => logger.error(`[Queue Redis ${label}] Error: ${err.message}`));
    return conn;
  }

  const conn = new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectionName: label,
  });
  conn.on('error', (err) => logger.error(`[Queue Redis ${label}] Error: ${err.message}`));
  return conn;
};

module.exports = { createRedisConnection };