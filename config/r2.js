const { S3Client } = require('@aws-sdk/client-s3');
const logger = require('../utils/logger');

if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  logger.error('[R2] Missing credentials. Check .env');
  throw new Error('Missing R2 credentials');
}

logger.info('[R2] Initializing Cloudflare R2 Client...');

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

module.exports = r2Client;