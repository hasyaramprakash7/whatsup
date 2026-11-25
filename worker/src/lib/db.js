// D1 data layer. API objects keep the same shape the dashboard already uses (_id, camelCase fields).
import { json, nowIso } from './text.js';
import { newId, decryptToken } from './crypto.js';
import { detailPairs, locationLines } from './itemfields.js';

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'ENGAGED', 'QUALIFIED', 'CONVERTED', 'COLD'];

// ---------- tenants ----------
export function rowToTenant(r) {
  if (!r) return null;
  return {
    _id: r.id, businessName: r.business_name, industry: r.industry, phoneNumberId: r.phone_number_id, wabaId: r.waba_id,
    adminNotificationPhone: r.admin_phone, tier: r.tier, isActive: !!r.is_active,
    profile: json(r.profile, {}), flow: json(r.flow, {}), ai: json(r.ai, {}), templates: json(r.templates, {}), sending: json(r.sending, {}),
    createdAt: r.created_at, updatedAt: r.updated_at,
    // never sent to clients; used internally to decrypt the WhatsApp token
    _tokenEnc: r.access_token_enc,
    _appSecretEnc: r.app_secret_enc || null, // a business's own Meta app: its webhooks are signed with this secret
  };
}
/** Strips internal fields before sending to the dashboard. */
export const publicTenant = (t) => { if (!t) return t; const { _tokenEnc, _appSecretEnc, ...rest } = t; return { ...rest, ownMetaApp: !!_appSecretEnc }; };

export const getTenant = async (env, id) => rowToTenant(await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first());
export const getTenantByPhoneNumberId = async (env, pnid) => rowToTenant(await env.DB.prepare('SELECT * FROM tenants WHERE phone_number_id = ?').bind(pnid).first());
export const getTenantByKeyHash = async (env, hash) => rowToTenant(await env.DB.prepare('SELECT * FROM tenants WHERE api_key_hash = ?').bind(hash).first());
export async function listTenants(env, onlyId) {
  const q = onlyId ? env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(onlyId) : env.DB.prepare('SELECT * FROM tenants ORDER BY created_at DESC');
  return (await q.all()).results.map(rowToTenant);
}
export const tenantAccessToken = (env, tenant) => decryptToken(env.TOKEN_ENCRYPTION_KEY, tenant._tokenEnc);

const TENANT_COLS = {
  businessName: 'business_name', industry: 'industry', phoneNumberId: 'phone_number_id', wabaId: 'waba_id', accessTokenEnc: 'access_token_enc', appSecretEnc: 'app_secret_enc',
  apiKeyHash: 'api_key_hash', adminNotificationPhone: 'admin_phone', tier: 'tier', isActive: 'is_active',
  profile: 'profile', flow: 'flow', ai: 'ai', templates: 'templates', sending: 'sending',
};
const tenantValue = (k, v) => (['profile', 'flow', 'ai', 'templates', 'sending'].includes(k) ? JSON.stringify(v ?? {}) : k === 'isActive' ? (v ? 1 : 0) : v);

export async function insertTenant(env, fields) {
  const id = newId();
  const cols = ['id']; const vals = [id];
  for (const [k, v] of Object.entries(fields)) { if (TENANT_COLS[k]) { cols.push(TENANT_COLS[k]); vals.push(tenantValue(k, v)); } }
  await env.DB.prepare(`INSERT INTO tenants (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...vals).run();
  return getTenant(env, id);
}
export async function updateTenant(env, id, fields) {
  const sets = []; const vals = [];
  for (const [k, v] of Object.entries(fields)) { if (TENANT_COLS[k]) { sets.push(`${TENANT_COLS[k]} = ?`); vals.push(tenantValue(k, v)); } }
  if (!sets.length) return getTenant(env, id);
  sets.push('updated_at = ?'); vals.push(nowIso());
  await env.DB.prepare(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return getTenant(env, id);
}

// ---------- leads ----------
const LEAD_COLS = {
  name: 'name', status: 'status', data: 'data', bookedAt: 'booked_at',
  lastBroadcastAt: 'last_broadcast_at', lastBroadcastMessageId: 'last_broadcast_message_id', broadcastStatus: 'broadcast_status',
  broadcastStatusAt: 'broadcast_status_at', broadcastError: 'broadcast_error',
  adminAlertStatus: 'admin_alert_status', adminAlertAt: 'admin_alert_at', adminAlertMessageId: 'admin_alert_message_id', adminAlertError: 'admin_alert_error',
  lastMessageAt: 'last_message_at', lastMessagePreview: 'last_message_preview', lastMessageDirection: 'last_message_direction',
  lastMessageSentBy: 'last_message_sent_by', lastInboundAt: 'last_inbound_at', unreadCount: 'unread_count', botPaused: 'bot_paused',
  language: 'language', campaignId: 'campaign_id', reachStatus: 'reach_status', cappedUntil: 'capped_until',
};
const leadValue = (k, v) => (k === 'data' ? JSON.stringify(v || {}) : k === 'botPaused' ? (v ? 1 : 0) : v instanceof Date ? v.toISOString() : v ?? null);

export function rowToLead(r) {
  if (!r) return null;
  const out = { _id: r.id, tenantId: r.tenant_id, phone: r.phone, createdAt: r.created_at, updatedAt: r.updated_at };
  for (const [k, col] of Object.entries(LEAD_COLS)) out[k] = r[col];
  out.data = json(r.data, {});
  out.botPaused = !!r.bot_paused;
  return out;
}

export const getLead = async (env, tenantId, phone) => rowToLead(await env.DB.prepare('SELECT * FROM leads WHERE tenant_id = ? AND phone = ?').bind(tenantId, phone).first());

/**
 * Insert-or-update a lead in one statement.
 *  set:       columns written on insert and update
 *  onInsert:  columns written only when the lead is new (e.g. starting status)
 *  mergeData: object merged into the lead's collected answers
 *  incUnread: add 1 to the unread counter
 */
export async function upsertLead(env, tenantId, phone, { set = {}, onInsert = {}, mergeData = null, incUnread = false } = {}) {
  const insCols = ['id', 'tenant_id', 'phone']; const insVals = [newId(), tenantId, phone];
  const upd = [];
  for (const [k, v] of Object.entries({ ...onInsert, ...set })) {
    if (!LEAD_COLS[k] || k === 'data') continue;
    insCols.push(LEAD_COLS[k]); insVals.push(leadValue(k, v));
    if (k in set) upd.push(`${LEAD_COLS[k]} = excluded.${LEAD_COLS[k]}`);
  }
  if (mergeData) { insCols.push('data'); insVals.push(JSON.stringify(mergeData)); upd.push('data = json_patch(leads.data, excluded.data)'); }
  if (incUnread) { insCols.push('unread_count'); insVals.push(1); upd.push('unread_count = leads.unread_count + 1'); }
  upd.push('updated_at = excluded.updated_at');
  insCols.push('updated_at'); insVals.push(nowIso());
  const sql = `INSERT INTO leads (${insCols.join(',')}) VALUES (${insCols.map(() => '?').join(',')})
    ON CONFLICT (tenant_id, phone) DO UPDATE SET ${upd.join(', ')} RETURNING *`;
  return rowToLead(await env.DB.prepare(sql).bind(...insVals).first());
}

/** UPDATE leads SET ... WHERE tenant_id = ? AND <where>; returns updated rows. */
export async function updateLeads(env, tenantId, whereSql, whereVals, set) {
  const sets = []; const vals = [];
  for (const [k, v] of Object.entries(set)) { if (LEAD_COLS[k]) { sets.push(`${LEAD_COLS[k]} = ?`); vals.push(leadValue(k, v)); } }
  sets.push('updated_at = ?'); vals.push(nowIso());
  const res = await env.DB.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE tenant_id = ? AND ${whereSql} RETURNING *`).bind(...vals, tenantId, ...whereVals).all();
  return res.results.map(rowToLead);
}

export async function listLeads(env, tenantId, { page = 1, limit = 50, status = '', search = '' } = {}) {
  const where = ['tenant_id = ?']; const vals = [tenantId];
  if (status && LEAD_STATUSES.includes(status)) { where.push('status = ?'); vals.push(status); }
  if (search) { where.push('(name LIKE ? OR phone LIKE ?)'); vals.push(`%${search}%`, `%${search.replace(/\D/g, '') || search}%`); }
  const w = where.join(' AND ');
  const [{ results }, count] = await Promise.all([
    env.DB.prepare(`SELECT * FROM leads WHERE ${w} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).bind(...vals, limit, (page - 1) * limit).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM leads WHERE ${w}`).bind(...vals).first(),
  ]);
  return { data: results.map(rowToLead), total: count.n, page, limit, pages: Math.max(Math.ceil(count.n / limit), 1) };
}

export async function leadStats(env, tenantId) {
  const nowIsoStr = nowIso();
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const [byStatus, byDelivery, upcoming, misc] = await env.DB.batch([
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM leads WHERE tenant_id = ? GROUP BY status').bind(tenantId),
    env.DB.prepare('SELECT broadcast_status AS s, COUNT(*) AS n FROM leads WHERE tenant_id = ? AND broadcast_status IS NOT NULL GROUP BY broadcast_status').bind(tenantId),
    env.DB.prepare('SELECT * FROM leads WHERE tenant_id = ? AND booked_at >= ? ORDER BY booked_at ASC LIMIT 8').bind(tenantId, nowIsoStr),
    env.DB.prepare(`SELECT
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS newToday,
        SUM(CASE WHEN unread_count > 0 THEN 1 ELSE 0 END) AS unreadChats,
        SUM(CASE WHEN bot_paused = 1 AND last_message_direction = 'in' THEN 1 ELSE 0 END) AS needsReply
      FROM leads WHERE tenant_id = ?`).bind(dayAgo, tenantId),
  ]);
  const status = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
  for (const r of byStatus.results) status[r.status] = r.n;
  const delivery = { SENT: 0, DELIVERED: 0, READ: 0, FAILED: 0 };
  for (const r of byDelivery.results) delivery[r.s] = r.n;
  const m = misc.results[0] || {};
  return {
    total: Object.values(status).reduce((a, b) => a + b, 0), status, delivery,
    upcoming: upcoming.results.map(rowToLead), newToday: m.newToday || 0, unreadChats: m.unreadChats || 0, needsReply: m.needsReply || 0,
  };
}

export async function listChats(env, tenantId, { limit = 30, search = '', unread = false, before = null } = {}) {
  const where = ['tenant_id = ?', 'last_message_at IS NOT NULL']; const vals = [tenantId];
  if (search) {
    const digits = search.replace(/\D/g, '');
    where.push(digits ? '(name LIKE ? OR phone LIKE ?)' : 'name LIKE ?');
    vals.push(`%${search}%`); if (digits) vals.push(`%${digits}%`);
  }
  if (unread) where.push('unread_count > 0');
  if (before) { where.push('last_message_at < ?'); vals.push(before); }
  const [{ results }, u] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM leads WHERE ${where.join(' AND ')} ORDER BY last_message_at DESC LIMIT ?`).bind(...vals, limit),
    env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ? AND unread_count > 0').bind(tenantId),
  ]);
  return { data: results.map(rowToLead), hasMore: results.length === limit, unreadChats: u.results[0].n };
}

// ---------- messages ----------
export function rowToMessage(r) {
  if (!r) return null;
  return { _id: r.id, tenantId: r.tenant_id, phone: r.phone, direction: r.direction, sentBy: r.sent_by, type: r.type, text: r.text, meta: json(r.meta, null), waMessageId: r.wa_message_id, status: r.status, error: r.error, createdAt: r.created_at };
}

export async function insertMessage(env, m) {
  const id = newId();
  const created = nowIso();
  await env.DB.prepare(`INSERT INTO messages (id, tenant_id, phone, direction, sent_by, type, text, meta, wa_message_id, status, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, m.tenantId, m.phone, m.direction, m.sentBy, m.type, m.text || '', m.meta ? JSON.stringify(m.meta) : null, m.waMessageId || null, m.status, m.error || null, created).run();
  return { _id: id, tenantId: m.tenantId, phone: m.phone, direction: m.direction, sentBy: m.sentBy, type: m.type, text: m.text || '', meta: m.meta || null, waMessageId: m.waMessageId || null, status: m.status, error: m.error || null, createdAt: created };
}

export async function listMessages(env, tenantId, phone, { limit = 50, before = null } = {}) {
  const q = before
    ? env.DB.prepare('SELECT * FROM messages WHERE tenant_id = ? AND phone = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?').bind(tenantId, phone, before, limit)
    : env.DB.prepare('SELECT * FROM messages WHERE tenant_id = ? AND phone = ? ORDER BY created_at DESC LIMIT ?').bind(tenantId, phone, limit);
  const { results } = await q.all();
  return { data: results.map(rowToMessage).reverse(), hasMore: results.length === limit };
}

/** Recent chat turns for the AI, oldest first. */
export async function recentTurns(env, tenantId, phone, limit = 12) {
  const { results } = await env.DB.prepare('SELECT direction, sent_by, type, text FROM messages WHERE tenant_id = ? AND phone = ? ORDER BY created_at DESC LIMIT ?').bind(tenantId, phone, limit).all();
  return results.reverse();
}

const STATUS_RANK = { sent: 1, delivered: 2, read: 3 };
/** Applies a delivery status to a stored message; returns it if it changed. Never moves backwards. */
export async function applyMessageStatus(env, tenantId, waMessageId, status, error) {
  const s = String(status).toLowerCase();
  if (s === 'failed') {
    return rowToMessage(await env.DB.prepare("UPDATE messages SET status = 'failed', error = ? WHERE tenant_id = ? AND wa_message_id = ? RETURNING *").bind(error || 'Failed', tenantId, waMessageId).first());
  }
  if (!STATUS_RANK[s]) return null;
  const earlier = Object.keys(STATUS_RANK).filter((k) => STATUS_RANK[k] < STATUS_RANK[s]);
  return rowToMessage(await env.DB.prepare(`UPDATE messages SET status = ? WHERE tenant_id = ? AND wa_message_id = ? AND status IN (${earlier.map(() => '?').join(',')}) RETURNING *`)
    .bind(s, tenantId, waMessageId, ...earlier).first());
}

// ---------- AI usage cap ----------
export async function takeAiReply(env, tenantId, dailyLimit) {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(`INSERT INTO ai_usage (tenant_id, day, replies) VALUES (?, ?, 1)
    ON CONFLICT (tenant_id, day) DO UPDATE SET replies = replies + 1 RETURNING replies`).bind(tenantId, day).first();
  return row.replies <= dailyLimit;
}

// ---------- catalog (products & services with photos) ----------
export const MAX_CATALOG_ITEMS = 100;
const parseDetails = (s) => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
export function rowToItem(r) {
  if (!r) return null;
  return { _id: r.id, tenantId: r.tenant_id, name: r.name, category: r.category, description: r.description, price: r.price, imageUrl: r.image_url, imageKey: r.image_key, layout: r.layout || 'general', details: parseDetails(r.details), active: !!r.active, sort: r.sort, createdAt: r.created_at, updatedAt: r.updated_at };
}
/** The layout (flow template) a business has selected; its products are the ones customers see. */
export const layoutOf = (tenant) => tenant?.flow?.template || tenant?.industry || 'general';
/** layout: only that layout's items (omit for all of the business's items). */
export async function listCatalog(env, tenantId, { activeOnly = false, layout = null } = {}) {
  const { results } = await env.DB.prepare(`SELECT * FROM catalog_items WHERE tenant_id = ? ${layout ? 'AND layout = ?' : ''} ${activeOnly ? 'AND active = 1' : ''} ORDER BY sort, created_at`).bind(...(layout ? [tenantId, layout] : [tenantId])).all();
  return results.map(rowToItem);
}
export const getItem = async (env, tenantId, id) => rowToItem(await env.DB.prepare('SELECT * FROM catalog_items WHERE tenant_id = ? AND id = ?').bind(tenantId, id).first());
export async function insertItem(env, tenantId, f) {
  const id = newId();
  const sortRow = await env.DB.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM catalog_items WHERE tenant_id = ? AND layout = ?').bind(tenantId, f.layout || 'general').first();
  await env.DB.prepare('INSERT INTO catalog_items (id, tenant_id, layout, details, name, category, description, price, image_url, image_key, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, tenantId, f.layout || 'general', JSON.stringify(f.details || {}), f.name, f.category || '', f.description || '', f.price || '', f.imageUrl || null, f.imageKey || null, f.active === false ? 0 : 1, sortRow.s).run();
  return getItem(env, tenantId, id);
}
const ITEM_COLS = { layout: 'layout', details: 'details', name: 'name', category: 'category', description: 'description', price: 'price', imageUrl: 'image_url', imageKey: 'image_key', active: 'active', sort: 'sort' };
export async function updateItem(env, tenantId, id, f) {
  const sets = []; const vals = [];
  for (const [k, v] of Object.entries(f)) if (ITEM_COLS[k]) { sets.push(`${ITEM_COLS[k]} = ?`); vals.push(k === 'active' ? (v ? 1 : 0) : k === 'details' ? JSON.stringify(v || {}) : v); }
  if (sets.length) { sets.push('updated_at = ?'); vals.push(nowIso()); await env.DB.prepare(`UPDATE catalog_items SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`).bind(...vals, tenantId, id).run(); }
  return getItem(env, tenantId, id);
}
export const deleteItem = (env, tenantId, id) => env.DB.prepare('DELETE FROM catalog_items WHERE tenant_id = ? AND id = ?').bind(tenantId, id).run();
/** WhatsApp caption for an item: *Name* — price, then the description. */
export const itemCaption = (it) => {
  const d = detailPairs(it).map(([k, v]) => `${k}: ${v}`).join('\n');
  const loc = locationLines(it); // address + map link: no extra message needed for directions
  return `*${it.name}*${it.price ? ` — ${it.price}` : ''}${d ? `\n${d}` : ''}${it.description ? `\n${it.description}` : ''}${loc ? `\n\n${loc}` : ''}`.slice(0, 1024);
};
