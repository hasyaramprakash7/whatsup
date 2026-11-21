// Live dashboard updates. Any process (API server or broadcast worker) publishes events to a Redis
// channel; the API server relays them over Socket.IO to everyone watching that vendor.
const redis = require('../config/redis');
const logger = require('../utils/logger');

const CHANNEL = 'realtime:events';
const roomFor = (tenantId) => `tenant:${tenantId}`;

/** Fire-and-forget: a failed publish must never break message handling. */
function publish(tenantId, event, data) {
  if (!tenantId) return;
  redis.publish(CHANNEL, JSON.stringify({ tenantId: String(tenantId), event, data }))
    .catch((err) => logger.warn(`[Realtime] Publish failed (${event}): ${err.message}`));
}

/** Attaches Socket.IO to the HTTP server. Clients authenticate with the same API key as the REST API. */
function attachSocketServer(httpServer, { resolveApiKey, corsOrigin }) {
  const { Server } = require('socket.io');
  const { createRedisConnection } = require('../config/queue');

  const io = new Server(httpServer, { cors: { origin: corsOrigin } });

  io.use(async (socket, next) => {
    try {
      const auth = await resolveApiKey(socket.handshake.auth?.token);
      if (!auth) return next(new Error('unauthorized'));
      socket.data.auth = auth;
      return next();
    } catch (err) {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { auth } = socket.data;
    if (auth.role === 'tenant') socket.join(roomFor(auth.tenantId));

    // Admins pick which vendor they are looking at; vendors are always locked to their own room.
    socket.on('watch-tenant', (tenantId) => {
      if (auth.role !== 'admin' || !/^[a-f0-9]{24}$/i.test(String(tenantId))) return;
      for (const room of socket.rooms) if (room.startsWith('tenant:')) socket.leave(room);
      socket.join(roomFor(tenantId));
    });
  });

  const subscriber = createRedisConnection('realtime-subscriber');
  subscriber.subscribe(CHANNEL).catch((err) => logger.error(`[Realtime] Subscribe failed: ${err.message}`));
  subscriber.on('message', (_channel, raw) => {
    try {
      const { tenantId, event, data } = JSON.parse(raw);
      io.to(roomFor(tenantId)).emit(event, data);
    } catch (err) {
      logger.warn(`[Realtime] Bad event on channel: ${err.message}`);
    }
  });

  logger.info('[Realtime] Socket.IO ready.');
  return {
    io,
    // Drops open sockets (otherwise http server.close() waits on them) and stops the subscriber.
    close: async () => { io.disconnectSockets(true); await subscriber.quit().catch(() => {}); },
  };
}

module.exports = { publish, attachSocketServer };
