const fs = require('fs');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const r2Client = require('../config/r2');
const logger = require('../utils/logger');

const BUCKET = process.env.R2_BUCKET;
const PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');

async function uploadBrochure({ localPath, originalName, contentType, tenantId }) {
  const safeName = String(originalName || 'brochure.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(-180);
  if (!r2Client) {
    const err = new Error('Brochure uploads are disabled: Cloudflare R2 is not configured on the server');
    err.status = 503;
    throw err;
  }
  const key = `brochures/${tenantId}/${Date.now()}_${safeName}`;

  logger.info(`[R2] Reading file ${localPath} for upload...`);
  const fileBuffer = await fs.promises.readFile(localPath);

  logger.info(`[R2] Uploading to bucket '${BUCKET}' as key '${key}'...`);
  await r2Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType || 'application/pdf',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  const publicUrl = `${PUBLIC_BASE_URL}/${key}`;
  logger.info(`[R2] Upload successful. Public URL: ${publicUrl}`);
  return { key, publicUrl };
}

async function deleteByKey(key) {
  if (!key || !r2Client) return;
  try {
    logger.info(`[R2] Deleting old object: ${key}`);
    await r2Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    logger.info(`[R2] Successfully deleted ${key}`);
  } catch (err) {
    logger.warn(`[R2] Delete failed for ${key}: ${err.message}`);
  }
}

function keyFromPublicUrl(publicUrl) {
  if (!publicUrl || !PUBLIC_BASE_URL || !publicUrl.startsWith(PUBLIC_BASE_URL + '/')) return null;
  return publicUrl.slice(PUBLIC_BASE_URL.length + 1);
}

module.exports = { uploadBrochure, deleteByKey, keyFromPublicUrl };