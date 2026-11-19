const fsPromises = require('fs/promises');
const Tenant = require('../models/Tenant');
const { uploadBrochure, deleteByKey, keyFromPublicUrl } = require('../services/r2Service');
const logger = require('../utils/logger');

exports.uploadBrochure = async (req, res) => {
  const { tenantId } = req.params;
  const localPath = req.file?.path;
  const cleanupLocal = async () => { if (localPath) await fsPromises.unlink(localPath).catch(() => {}); };

  logger.info(`[Upload] Received brochure upload request for Tenant ${tenantId}`);

  try {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant || !req.file) {
      await cleanupLocal();
      logger.warn(`[Upload] Rejected. Tenant not found or no file provided.`);
      return res.status(404).json({ success: false, error: 'Tenant not found or file missing' });
    }

    const previousUrl = tenant.projectDetails?.brochurePdfUrl;
    const previousKey = keyFromPublicUrl(previousUrl);

    const { key, publicUrl } = await uploadBrochure({ localPath, originalName: req.file.originalname, contentType: req.file.mimetype, tenantId: String(tenant._id) });

    tenant.projectDetails.brochurePdfUrl = publicUrl;
    await tenant.save();
    logger.info(`[Upload] DB updated with new brochure URL for Tenant ${tenantId}.`);

    await cleanupLocal();

    if (previousKey && previousKey !== key) {
      logger.info(`[Upload] Found previous brochure. Triggering cleanup of old R2 object...`);
      deleteByKey(previousKey).catch((err) => logger.warn(`[Upload] Old brochure cleanup failed: ${err.message}`));
    }

    return res.status(201).json({ success: true, data: { brochurePdfUrl: publicUrl, key, size: req.file.size, replacedPrevious: Boolean(previousKey) } });
  } catch (error) {
    await cleanupLocal();
    logger.error(`[Upload] Error during brochure upload: ${error.message}`);
    if (!res.headersSent) return res.status(500).json({ success: false, error: error.message });
  }
};