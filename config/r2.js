const { S3Client } = require('@aws-sdk/client-s3');
const logger = require('../utils/logger');

// R2 is optional: without credentials the app still runs, only brochure uploads are disabled.
if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  logger.warn('[R2] Credentials not set — brochure uploads are disabled until R2_* values are added to .env');
  module.exports = null;
  return;
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