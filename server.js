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

const webhookRoutes = require('./routes/webhookRoutes');
const tenantRoutes = require('./routes/tenantRoutes');
const leadRoutes = require('./routes/leadRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const rateLimiter = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

const app = express();
logger.info('[Server] Booting application...');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()) : '*' }));
app.use(morgan('dev')); // Logs all HTTP requests to terminal

app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

connectDB();

app.use('/webhook', webhookRoutes);
app.use('/api/tenants', rateLimiter, tenantRoutes);
app.use('/api/leads', rateLimiter, leadRoutes);
app.use('/api/uploads', rateLimiter, uploadRoutes);

app.get('/health', (_req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info(`[Server] ✅ Engine Online! Listening on http://localhost:${PORT}`);
});

async function shutdown(signal) {
  logger.info(`[Server] ${signal} received — closing resources...`);

  server.close(async () => {
    try {
      await broadcastQueue.close();
      logger.info('[Server] Broadcast queue closed.');
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
process.on('unhandledRejection', (reason) => logger.error(`[Server] Unhandled Rejection: ${reason?.message || reason}`));
process.on('uncaughtException', (err) => logger.error(`[Server] Uncaught Exception: ${err.message}`));