// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'whatsapp-engine',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      kill_timeout: 12000,
      env: {
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://default:YOUR_PASSWORD@your-host.upstash.io:6379',
        // …other secrets, or use a secrets manager here
      },
      max_memory_restart: '512M',
      error_file: './logs/engine-error.log',
      out_file: './logs/engine-out.log',
      time: true,
    },
    {
      name: 'whatsapp-worker',
      script: 'queues/broadcastWorker.js',
      instances: 1,
      exec_mode: 'fork',
      kill_timeout: 12000,
      env: {
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://default:YOUR_PASSWORD@your-host.upstash.io:6379',
      },
      max_memory_restart: '512M',
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      time: true,
    },
  ],
};