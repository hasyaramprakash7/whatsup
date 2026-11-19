const fs = require('fs');
const fsPromises = require('fs/promises');
const csv = require('csv-parser');
const Tenant = require('../models/Tenant');
const Lead = require('../models/Lead');
const { enqueueBroadcastBatch, getQueueStats } = require('../queues/broadcastQueue');
const { normalizePhone, isValidPhone } = require('../utils/phoneUtils');
const logger = require('../utils/logger');

const COLUMN_CANDIDATES = { phone: ['phone', 'mobile', 'Phone', 'Mobile', 'phonenumber', 'whatsapp', 'Phone Number'], name: ['name', 'Name', 'fullname', 'Full Name', 'customer', 'Customer Name'] };
const DAILY_LIMIT_BY_TIER = { 0: 250, 1: 1000, 2: 10000, 3: 100000 };

function pickColumn(row, candidates) {
  for (const c of candidates) if (row[c] !== undefined && row[c] !== '') return String(row[c]).trim();
  return null;
}

function parseCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath).pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

exports.uploadLeadsAndBroadcast = async (req, res) => {
  const { tenantId } = req.params;
  const filePath = req.file?.path;
  const cleanup = async () => { if (filePath) await fsPromises.unlink(filePath).catch(() => {}); };

  logger.info(`[Leads] CSV upload received for Tenant ${tenantId}`);

  try {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant || !tenant.isActive || !req.file) {
      await cleanup();
      logger.warn(`[Leads] Upload aborted. Tenant missing, inactive, or no file provided.`);
      return res.status(400).json({ success: false, error: 'Tenant invalid or no file provided.' });
    }

    logger.debug(`[Leads] Parsing CSV file ${filePath}...`);
    const rawRows = await parseCsv(filePath).catch(async (err) => { await cleanup(); throw new Error(`CSV parse failed: ${err.message}`); });
    
    if (rawRows.length === 0) {
      await cleanup();
      return res.status(400).json({ success: false, error: 'CSV is empty' });
    }
    logger.info(`[Leads] CSV parsed successfully. Found ${rawRows.length} rows.`);

    // Tier Guard
    const tenantTier = tenant.tier ?? 0;
    const dailyLimit = DAILY_LIMIT_BY_TIER[tenantTier] ?? 250;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sentInLast24Hours = await Lead.countDocuments({ tenantId: tenant._id, lastBroadcastAt: { $gte: twentyFourHoursAgo } });

    logger.debug(`[Leads] Tier check: Tenant is Tier ${tenantTier}. Limit: ${dailyLimit}/24h. Sent: ${sentInLast24Hours}. Uploading: ${rawRows.length}.`);

    if (rawRows.length + sentInLast24Hours > dailyLimit) {
      await cleanup();
      logger.warn(`[Leads] ❌ Tier limit exceeded. Rejecting broadcast.`);
      return res.status(429).json({ success: false, error: `Tier ${tenantTier} limit exceeded. Allowed: ${dailyLimit}/24h.` });
    }

    // Normalize & Deduplicate
    const seen = new Set();
    const recipients = [];
    const invalid = [];

    for (const row of rawRows) {
      const rawPhone = pickColumn(row, COLUMN_CANDIDATES.phone);
      const cleanPhone = normalizePhone(rawPhone);
      if (!isValidPhone(cleanPhone)) { invalid.push(rawPhone || '(blank)'); continue; }
      if (seen.has(cleanPhone)) continue;
      seen.add(cleanPhone);
      recipients.push({ phone: cleanPhone, customerName: pickColumn(row, COLUMN_CANDIDATES.name) || 'Valued Customer' });
    }

    await cleanup();
    logger.info(`[Leads] Normalization complete. Valid recipients: ${recipients.length}. Invalid: ${invalid.length}. Duplicates skipped.`);

    if (recipients.length === 0) {
      logger.warn(`[Leads] No valid phone numbers found in CSV.`);
      return res.status(400).json({ success: false, error: 'No valid phone numbers found in CSV', invalidSamples: invalid.slice(0, 10) });
    }

    // Bulk DB Insert
    logger.debug(`[Leads] Inserting ${recipients.length} leads into MongoDB...`);
    const now = new Date();
    const bulkOps = recipients.map((r) => ({
      updateOne: {
        filter: { tenantId: tenant._id, phone: r.phone },
        update: { $set: { name: r.customerName, status: 'BROADCAST_SENT', lastBroadcastAt: now }, $setOnInsert: { tenantId: tenant._id, phone: r.phone } },
        upsert: true,
      },
    }));
    await Lead.bulkWrite(bulkOps, { ordered: false }).catch((err) => { if (err.code !== 11000) throw err; });

    // Enqueue
    const enqueued = await enqueueBroadcastBatch({ tenantId: tenant._id, recipients });

    logger.info(`[Leads] ✅ Broadcast successfully enqueued. ${enqueued} jobs added.`);

    return res.status(202).json({
      success: true,
      message: `Enqueued ${enqueued} broadcast jobs. Processing in background.`,
      summary: { total: rawRows.length, enqueued, duplicatesSkipped: rawRows.length - recipients.length - invalid.length, invalidSkipped: invalid.length, quotaRemaining: dailyLimit - sentInLast24Hours - enqueued, tier: tenantTier },
      invalidSamples: invalid.slice(0, 10),
    });
  } catch (error) {
    await cleanup();
    logger.error(`[Leads] Upload processing error: ${error.message}`);
    if (!res.headersSent) return res.status(500).json({ success: false, error: error.message });
  }
};

exports.getLeadsByTenant = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const leads = await Lead.find({ tenantId }).sort({ updatedAt: -1 });
    return res.json({ success: true, count: leads.length, data: leads });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.getBroadcastStats = async (_req, res) => {
  try {
    const stats = await getQueueStats();
    return res.json({ success: true, stats });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};