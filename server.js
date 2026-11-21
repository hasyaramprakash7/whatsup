require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const mongoose = require('mongoose');

const connectDB = require('./config/db');
const redis = require('./config/redis');
const logger = require('./utils/logger');
const { broadcastQueue } = require('./queues/broadcastQueue');
const { inboundQueue } = require('./queues/inboundQueue');
const { startInboundWorker } = require('./queues/inboundWorker');

const webhookRoutes = require('./routes/webhookRoutes');
const tenantRoutes = require('./routes/tenantRoutes');
const leadRoutes = require('./routes/leadRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const chatRoutes = require('./routes/chatRoutes');
const { attachSocketServer } = require('./services/realtime');
const rateLimiter = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const { authenticate, resolveApiKey } = require('./middleware/auth');

if (!process.env.ADMIN_API_KEY || process.env.ADMIN_API_KEY.length < 32) {
  logger.error('[Server] ADMIN_API_KEY is missing or shorter than 32 characters. Refusing to start.');
  process.exit(1);
}

const app = express();
logger.info('[Server] Booting application...');

// Behind a reverse proxy (Caddy in docker-compose) the client IP arrives in X-Forwarded-For;
// trust that many hops so the rate limiter limits real clients instead of the proxy.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

app.use(helmet({ contentSecurityPolicy: false }));
const corsOrigin = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()) : '*';
app.use(cors({ origin: corsOrigin }));
app.use(morgan('dev')); // Logs all HTTP requests to terminal

app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

connectDB();
// Customer messages and delivery statuses are processed from the Redis queue the webhook fills.
const inboundWorker = startInboundWorker();

app.use('/webhook', webhookRoutes);
app.use('/api/tenants', rateLimiter, authenticate, tenantRoutes);
app.use('/api/leads', rateLimiter, authenticate, leadRoutes);
app.use('/api/uploads', rateLimiter, authenticate, uploadRoutes);
app.use('/api/chats', rateLimiter, authenticate, chatRoutes);

// Reports 503 unless MongoDB and Redis are both reachable, so Docker and the dashboard see real outages.
app.get('/health', async (_req, res) => {
  const mongo = mongoose.connection.readyState === 1;
  let redisOk = false;
  try {
    const pong = await Promise.race([redis.ping(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))]);
    redisOk = pong === 'PONG';
  } catch (_) {}
  const ok = mongo && redisOk;
  res.status(ok ? 200 : 503).json({ status: ok ? 'OK' : 'DEGRADED', mongo: mongo ? 'up' : 'down', redis: redisOk ? 'up' : 'down', timestamp: new Date().toISOString() });
});
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info(`[Server] ✅ Engine Online! Listening on http://localhost:${PORT}`);
});
// Live dashboard updates (new messages, delivery ticks, lead changes) over WebSockets.
const realtime = attachSocketServer(server, { resolveApiKey, corsOrigin });

async function shutdown(signal) {
  logger.info(`[Server] ${signal} received — closing resources...`);
  // Open WebSockets would keep server.close() waiting, so drop them first.
  await realtime.close().catch(() => {});

  server.close(async () => {
    try {
      await inboundWorker.close();
      logger.info('[Server] Inbound worker stopped.');
      await inboundQueue.close();
      await broadcastQueue.close();
      logger.info('[Server] Queues closed.');
      await redis.quit();
      logger.info('[Server] Session Redis disconnected.');
      await mongoose.connection.close();
      logger.info('[Server] MongoDB disconnected.');
      logger.info('[Server] Shutdown complete. Clean exit.');
      process.exit(0);
    } catch (e) {
      logger.error(`[Server] Error during cleanup: ${e.message}`);
      process.exit(1);
    }
  });

  setTimeout(() => { logger.error('[Server] Cleanup timed out — forcing exit.'); process.exit(1); }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error(`[Server] Unhandled Rejection: ${reason?.stack || reason?.message || reason}`));
// After an uncaught exception the process may be in a broken state: log it and exit so
// Docker (restart: unless-stopped) or pm2 starts a clean one. Queued webhook events are not lost.
process.on('uncaughtException', (err) => {
  logger.error(`[Server] Uncaught Exception — exiting: ${err.stack || err.message}`);
  process.exit(1);
});