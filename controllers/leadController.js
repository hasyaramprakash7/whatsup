const fs = require('fs');
const mongoose = require('mongoose');
const fsPromises = require('fs/promises');
const csv = require('csv-parser');
const Tenant = require('../models/Tenant');
const Lead = require('../models/Lead');
const { enqueueBroadcastBatch, getQueueStats } = require('../queues/broadcastQueue');
const { normalizePhone, isValidPhone } = require('../utils/phoneUtils');
const logger = require('../utils/logger');

const COLUMN_CANDIDATES = { phone: ['phone', 'mobile', 'Phone', 'Mobile', 'phonenumber', 'whatsapp', 'Phone Number'], name: ['name', 'Name', 'fullname', 'Full Name', 'customer', 'Customer Name'] };
const DAILY_LIMIT_BY_TIER = { 0: 250, 1: 1000, 2: 10000, 3: 100000 };
// Skip leads broadcast to within this many days (0 = no cooldown). Opted-out (COLD) leads are always skipped.
const COOLDOWN_DAYS = Number(process.env.BROADCAST_COOLDOWN_DAYS) || 0;
const LEAD_STATUSES = Lead.schema.path('status').enumValues;

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

    // Never message leads who opted out; optionally skip leads contacted within the cooldown window.
    const existingLeads = await Lead.find({ tenantId: tenant._id, phone: { $in: recipients.map((r) => r.phone) } })
      .select('phone status lastBroadcastAt').lean();
    const cooldownStart = COOLDOWN_DAYS > 0 ? new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000) : null;
    const optedOut = new Set();
    const recentlyContacted = new Set();
    for (const lead of existingLeads) {
      if (lead.status === 'COLD') optedOut.add(lead.phone);
      else if (cooldownStart && lead.lastBroadcastAt && lead.lastBroadcastAt >= cooldownStart) recentlyContacted.add(lead.phone);
    }
    const toSend = recipients.filter((r) => !optedOut.has(r.phone) && !recentlyContacted.has(r.phone));
    logger.info(`[Leads] Skipping ${optedOut.size} opted-out and ${recentlyContacted.size} recently contacted leads. Sending to ${toSend.length}.`);

    const summary = {
      total: rawRows.length,
      enqueued: 0,
      duplicatesSkipped: rawRows.length - recipients.length - invalid.length,
      invalidSkipped: invalid.length,
      optedOutSkipped: optedOut.size,
      recentlyContactedSkipped: recentlyContacted.size,
    };

    if (toSend.length === 0) {
      return res.status(200).json({ success: true, message: 'Nothing to send: every valid number has opted out or was contacted recently.', summary, invalidSamples: invalid.slice(0, 10) });
    }

    // Tier Guard — counts only the numbers that will actually be messaged.
    const tenantTier = tenant.tier ?? 0;
    const dailyLimit = DAILY_LIMIT_BY_TIER[tenantTier] ?? 250;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sentInLast24Hours = await Lead.countDocuments({ tenantId: tenant._id, lastBroadcastAt: { $gte: twentyFourHoursAgo } });

    logger.debug(`[Leads] Tier check: Tenant is Tier ${tenantTier}. Limit: ${dailyLimit}/24h. Sent: ${sentInLast24Hours}. Sending: ${toSend.length}.`);

    if (toSend.length + sentInLast24Hours > dailyLimit) {
      logger.warn(`[Leads] ❌ Tier limit exceeded. Rejecting broadcast.`);
      return res.status(429).json({ success: false, error: `Tier ${tenantTier} limit exceeded. Allowed: ${dailyLimit}/24h, already sent: ${sentInLast24Hours}.` });
    }

    // Bulk DB upsert. Status is only set for new leads, so existing progress
    // (ENGAGED, QUALIFIED, VISIT_CONFIRMED) is kept rather than reset.
    logger.debug(`[Leads] Upserting ${toSend.length} leads into MongoDB...`);
    const now = new Date();
    const bulkOps = toSend.map((r) => ({
      updateOne: {
        filter: { tenantId: tenant._id, phone: r.phone },
        // Delivery fields are cleared until the worker sends this broadcast (the dashboard shows "queued").
        update: { $set: { name: r.customerName, lastBroadcastAt: now, lastBroadcastMessageId: null, broadcastStatus: null, broadcastStatusAt: null, broadcastError: null }, $setOnInsert: { tenantId: tenant._id, phone: r.phone, status: 'BROADCAST_SENT' } },
        upsert: true,
      },
    }));
    await Lead.bulkWrite(bulkOps, { ordered: false }).catch((err) => { if (err.code !== 11000) throw err; });

    // Enqueue
    const enqueued = await enqueueBroadcastBatch({ tenantId: tenant._id, recipients: toSend });

    logger.info(`[Leads] ✅ Broadcast successfully enqueued. ${enqueued} jobs added.`);

    return res.status(202).json({
      success: true,
      message: `Enqueued ${enqueued} broadcast jobs. Processing in background.`,
      summary: { ...summary, enqueued, quotaRemaining: dailyLimit - sentInLast24Hours - enqueued, tier: tenantTier },
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
    // ?page=1&limit=100 (max 500), optional ?status=QUALIFIED
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const filter = { tenantId };
    if (req.query.status && LEAD_STATUSES.includes(req.query.status)) filter.status = req.query.status;

    const [total, leads] = await Promise.all([
      Lead.countDocuments(filter),
      Lead.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    return res.json({ success: true, count: leads.length, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1), data: leads });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** Numbers for the dashboard Overview: funnel, delivery, upcoming visits. */
exports.getLeadStats = async (req, res) => {
  try {
    const tenantId = new mongoose.Types.ObjectId(req.params.tenantId);
    const now = new Date();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [byStatus, byDelivery, upcoming, newToday, unread, needsReply] = await Promise.all([
      Lead.aggregate([{ $match: { tenantId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Lead.aggregate([{ $match: { tenantId, broadcastStatus: { $ne: null } } }, { $group: { _id: '$broadcastStatus', n: { $sum: 1 } } }]),
      Lead.find({ tenantId, visitAt: { $gte: now }, status: 'VISIT_CONFIRMED' }).sort({ visitAt: 1 }).limit(8).select('name phone configuration budget visitAt visitSlot').lean(),
      Lead.countDocuments({ tenantId, createdAt: { $gte: dayAgo } }),
      Lead.countDocuments({ tenantId, unreadCount: { $gt: 0 } }),
      Lead.countDocuments({ tenantId, botPaused: true, lastMessageDirection: 'in' }),
    ]);
    const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
    const status = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
    Object.assign(status, toMap(byStatus));
    const total = Object.values(status).reduce((a, b) => a + b, 0);
    return res.json({ success: true, data: { total, status, delivery: { SENT: 0, DELIVERED: 0, READ: 0, FAILED: 0, ...toMap(byDelivery) }, upcomingVisits: upcoming, newToday, unreadChats: unread, needsReply } });
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