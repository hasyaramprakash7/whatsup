// WhatsApp agent for any business — Cloudflare Worker entry: API, Meta webhook, WebSockets, dashboard.
import { Hono } from 'hono';
import { ConversationDO } from './do/conversation.js';
import { BusinessHub } from './do/hub.js';
import {
  getTenant, getTenantByPhoneNumberId, getTenantByKeyHash, listTenants, insertTenant, updateTenant, publicTenant, tenantAccessToken,
  getLead, upsertLead, updateLeads, listLeads, leadStats, listChats, listMessages, applyMessageStatus,
} from './lib/db.js';
import { sha256Hex, safeEqual, verifyMetaSignature, generateApiKey, encryptToken, TENANT_KEY_PREFIX, signWsTicket, verifyWsTicket } from './lib/crypto.js';
import { normalizePhone, isValidPhone, parseCsv, pickPhone, pickName, nowIso } from './lib/text.js';
import { validateFlow, validateProfile, validateAi, flowFields } from './lib/flow.js';
import { translateFlow } from './lib/lang.js';
import { recordEvent, findProblems, runMonitor } from './lib/monitor.js';
import { forgetCustomer, applyRetention } from './lib/privacy.js';
import { TEMPLATES, flowFromTemplate, getTemplate, personalizeFlow } from './lib/templates.js';
import { WhatsAppClient } from './lib/whatsapp.js';
import { outboundRecorder, publish } from './lib/chatlog.js';
import { aiDecide } from './lib/ai.js';
import { MEDIA_FILE, moveInboundToPrivate } from './lib/media.js';
import { ITEM_FIELDS, cleanDetails, resolveMapPoint } from './lib/itemfields.js';
import { geocode, reverseGeocode } from './lib/geo.js';
import { pushConfigured, saveSubscription, deleteSubscription, getSubscription, sendPush, NOTIFY_KINDS, testPushPayload, markSent, recordAck, deliveryHealth } from './lib/push.js';
import { takeAiReply, layoutOf, listCatalog, getItem, insertItem, updateItem, deleteItem, MAX_CATALOG_ITEMS } from './lib/db.js';

export { ConversationDO, BusinessHub };

const app = new Hono();
const DAILY_LIMIT_BY_TIER = { 0: 250, 1: 1000, 2: 10000, 3: 100000 };
const REPLY_WINDOW_MS = 24 * 3600 * 1000;
const fail = (c, status, error, extra = {}) => c.json({ success: false, error, ...extra }, status);
const isId = (s) => /^[0-9a-f-]{36}$/i.test(String(s || ''));

// ---------------- security ----------------
// Browser hardening on everything the Worker answers (static files get the same from public/_headers).
app.use('*', async (c, next) => {
  await next();
  if (c.res.status === 101) return; // live-update connection
  try {
    const h = c.res.headers;
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    h.set('X-Frame-Options', 'DENY');
    if (c.req.path.startsWith('/api/')) h.set('Cache-Control', 'no-store');
  } catch { /* read-only headers (static files carry their own from public/_headers) */ }
});
const MAX_BODY = { '/webhook': 2 * 1024 * 1024 };
app.use('*', async (c, next) => {
  const len = Number(c.req.header('content-length') || 0);
  const max = MAX_BODY[c.req.path] ?? 12 * 1024 * 1024;   // uploads: 10 MB CSV / 5 MB photos + form overhead
  if (len > max) return fail(c, 413, 'Request too large.');
  return next();
});
const clientIp = (c) => c.req.header('cf-connecting-ip') || 'unknown';
/** Cloudflare rate limiter; allows the request if the limiter is not configured. */
const limited = async (binding, key) => { try { return binding ? !(await binding.limit({ key })).success : false; } catch { return false; } };

app.onError((err, c) => {
  console.error('[Worker] unhandled:', err.stack || err.message);
  c.executionCtx?.waitUntil?.(recordEvent(c.env, 'server_error', `${c.req.method} ${c.req.path}: ${err.message}`));
  return fail(c, 500, 'Internal Server Error');
});

// ---------------- auth ----------------
async function resolveApiKey(env, key) {
  if (!key) return null;
  if (env.ADMIN_API_KEY && env.ADMIN_API_KEY.length >= 32 && await safeEqual(key, env.ADMIN_API_KEY)) return { role: 'admin' };
  if (key.startsWith(TENANT_KEY_PREFIX)) {
    const t = await getTenantByKeyHash(env, await sha256Hex(key));
    if (t && t.isActive) return { role: 'tenant', tenantId: t._id, businessName: t.businessName };
  }
  return null;
}
const bearer = (c) => (c.req.header('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;

app.use('/api/*', async (c, next) => {
  const ip = clientIp(c);
  if (await limited(c.env.API_LIMIT, `api:${ip}`)) return fail(c, 429, 'Too many requests. Please wait a moment.');
  const auth = await resolveApiKey(c.env, bearer(c));
  if (!auth) {
    // Guessing keys: after 20 wrong keys a minute from one address, block it for the rest of the minute.
    if (await limited(c.env.AUTH_LIMIT, `auth:${ip}`)) return fail(c, 429, 'Too many failed sign-in attempts. Try again in a minute.');
    return fail(c, 401, 'Missing or invalid API key. Send "Authorization: Bearer <key>".');
  }
  c.set('auth', auth);
  return next();
});
const requireAdmin = (c, next) => (c.get('auth').role === 'admin' ? next() : fail(c, 403, 'Admin access required.'));
/** Admins, or the business whose id is in the URL. */
const tenantAccess = (param = 'tid') => async (c, next) => {
  const id = c.req.param(param);
  if (!isId(id)) return fail(c, 400, 'Invalid business id');
  const a = c.get('auth');
  if (a.role === 'admin' || a.tenantId === id) return next();
  return fail(c, 403, 'You do not have access to this business.');
};

// ---------------- health ----------------
app.get('/health', async (c) => {
  try { await c.env.DB.prepare('SELECT 1').first(); return c.json({ status: 'OK', d1: 'up', timestamp: nowIso() }); }
  catch { return c.json({ status: 'DEGRADED', d1: 'down', timestamp: nowIso() }, 503); }
});

// ---------------- Meta webhook ----------------
/**
 * The phone's background script calls this when the browser silently replaced its notification address
 * (happens on some phones and after updates). Proof = knowing the old address, which only that device and the push service have.
 */
app.post('/push/renew', async (c) => {
  if (await limited(c.env.AUTH_LIMIT, `renew:${clientIp(c)}`)) return fail(c, 429, 'Too many requests.');
  const b = await c.req.json().catch(() => ({}));
  if (!pushConfigured(c.env) || typeof b.oldEndpoint !== 'string' || b.oldEndpoint.length > 1000 || !validSub(b.subscription)) return fail(c, 400, 'Invalid request.');
  const old = await getSubscription(c.env, b.oldEndpoint);
  if (!old) return fail(c, 404, 'Unknown device.');
  const s = b.subscription;
  await saveSubscription(c.env, { scope: old.scope, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, prefs: old.prefs, userAgent: c.req.header('user-agent') });
  if (s.endpoint !== old.endpoint) await deleteSubscription(c.env, old.endpoint);
  console.log('[Push] a device renewed its notification address');
  return c.json({ success: true });
});

/** The phone's background script: "this alert just arrived" (lets us tell, per phone, whether alerts get through when the app is closed). */
app.post('/push/ack', async (c) => {
  if (await limited(c.env.API_LIMIT, `ack:${clientIp(c)}`)) return fail(c, 429, 'Too many requests.');
  const b = await c.req.json().catch(() => ({}));
  const sentAt = Number(b.sentAt); const now = Date.now();
  if (typeof b.endpoint !== 'string' || b.endpoint.length > 1000 || !Number.isFinite(sentAt) || sentAt > now + 5000 || sentAt < now - 26 * 3600e3) return fail(c, 400, 'Invalid request.');
  const ok = await recordAck(c.env, b.endpoint, { sentAt, awake: b.awake === true, test: b.test === true });
  return ok ? c.json({ success: true }) : fail(c, 404, 'Unknown device.');
});

app.get('/webhook', async (c) => {
  const expected = c.env.WHATSAPP_VERIFY_TOKEN;
  const token = c.req.query('hub.verify_token');
  if (expected && c.req.query('hub.mode') === 'subscribe' && token && await safeEqual(token, expected)) return c.text(c.req.query('hub.challenge') || '');
  return c.text('Forbidden', 403);
});

app.post('/webhook', async (c) => {
  const raw = await c.req.arrayBuffer();
  const secret = c.env.META_APP_SECRET;
  if (secret) {
    if (!await verifyMetaSignature(secret, raw, c.req.header('x-hub-signature-256'))) return c.text('Invalid signature', 401);
  } else if (c.env.ALLOW_UNSIGNED_WEBHOOKS !== 'true') {
    console.error('[Webhook] META_APP_SECRET is not set — rejecting.');
    return c.text('Webhook secret not configured', 500);
  }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return c.text('Bad JSON', 400); }

  const tenants = new Map();
  const tenantFor = async (pnid) => {
    if (!tenants.has(pnid)) tenants.set(pnid, await getTenantByPhoneNumberId(c.env, pnid));
    return tenants.get(pnid);
  };

  try {
    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        const v = change?.value; const pnid = v?.metadata?.phone_number_id;
        if (!pnid) continue;
        const tenant = await tenantFor(pnid);
        if (!tenant) { console.warn(`[Webhook] no business for phone number id ${pnid}`); continue; }
        const names = new Map((v.contacts || []).map((x) => [x?.wa_id, x?.profile?.name]));
        // Messages: stored durably in the chat's Durable Object before we answer Meta.
        for (const m of v.messages || []) {
          if (!m?.id || !m?.from) continue;
          const stub = c.env.CONVERSATION.get(c.env.CONVERSATION.idFromName(`${tenant._id}:${m.from}`));
          await stub.enqueue({ tenantId: tenant._id, from: m.from, profileName: names.get(m.from) || null, message: m });
        }
        // Delivery statuses: applied straight to D1 (idempotent; a failure makes Meta retry).
        for (const s of v.statuses || []) if (s?.id && s?.status) await applyStatus(c.env, tenant, s);
      }
    }
  } catch (err) {
    console.error('[Webhook] could not store events, asking Meta to retry:', err.message);
    return c.text('Retry later', 500);
  }
  return c.text('OK');
});

const MARKETING_OPT_OUT = 131050;
const RANK = { SENT: 1, DELIVERED: 2, READ: 3 };
async function applyStatus(env, tenant, s) {
  const up = String(s.status).toUpperCase();
  const err = s.errors?.[0];
  const errorText = err ? `${err.code}: ${err.error_data?.details || err.message || err.title || 'Unknown error'}` : null;
  const at = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : nowIso();
  const msg = await applyMessageStatus(env, tenant._id, s.id, s.status, errorText);
  if (msg) await publish(env, tenant._id, 'message:status', { id: msg._id, waMessageId: s.id, phone: msg.phone, status: msg.status, error: msg.error });
  const changed = [];
  if (up === 'FAILED') {
    changed.push(...await updateLeads(env, tenant._id, 'last_broadcast_message_id = ?', [s.id], { broadcastStatus: 'FAILED', broadcastStatusAt: at, broadcastError: errorText, ...(err?.code === MARKETING_OPT_OUT ? { status: 'COLD' } : {}) }));
    changed.push(...await updateLeads(env, tenant._id, 'admin_alert_message_id = ?', [s.id], { adminAlertStatus: 'FAILED', adminAlertError: errorText }));
  } else if (RANK[up]) {
    const earlier = Object.keys(RANK).filter((k) => RANK[k] < RANK[up]);
    changed.push(...await updateLeads(env, tenant._id, `last_broadcast_message_id = ? AND (broadcast_status IS NULL OR broadcast_status IN (${earlier.map(() => '?').join(',') || "''"}))`, [s.id, ...earlier], { broadcastStatus: up, broadcastStatusAt: at }));
    if (up !== 'SENT') changed.push(...await updateLeads(env, tenant._id, "admin_alert_message_id = ? AND admin_alert_status = 'SENT'", [s.id], { adminAlertStatus: 'DELIVERED' }));
  }
  for (const lead of changed) await publish(env, tenant._id, 'lead:update', { lead });
}

// ---------------- live dashboard WebSocket ----------------
app.get('/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected a WebSocket', 426);
  const tenantId = c.req.query('tenant');
  if (!isId(tenantId) || !(await verifyWsTicket(c.env, c.req.query('ticket'), tenantId))) return c.text('Unauthorized', 401);
  return c.env.HUB.get(c.env.HUB.idFromName(tenantId)).fetch(c.req.raw);
});
/** One-minute pass for the live-updates connection, so the API key never appears in a URL or log. */
app.post('/api/ws-ticket/:tid', tenantAccess(), async (c) => c.json({ success: true, ticket: await signWsTicket(c.env, c.req.param('tid')) }));

// ---------------- businesses (tenants) ----------------
const templateSummaries = () => TEMPLATES.map(({ key, name, description, icon }) => ({ key, name, description, icon, itemFields: ITEM_FIELDS[key] || ITEM_FIELDS.general }));
const tenantPayload = (t) => ({ success: true, data: publicTenant(t), fields: flowFields(t.flow), templates: templateSummaries() });

app.get('/api/tenants/me', (c) => c.json({ success: true, auth: c.get('auth') }));

// ---------------- phone notifications ----------------
const pushScope = (a) => (a.role === 'admin' ? '*' : a.tenantId);
const cleanPrefs = (p) => Object.fromEntries(NOTIFY_KINDS.map((k) => [k, p?.[k] !== false]));
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];
const pushHostOk = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && !x.port && PUSH_HOSTS.some((re) => re.test(x.hostname)); } catch { return false; } };
const validSub = (s) => s && typeof s.endpoint === 'string' && pushHostOk(s.endpoint) && s.endpoint.length < 1000
  && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string' && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;

app.get('/api/push/key', (c) => c.json({ success: true, enabled: pushConfigured(c.env), publicKey: c.env.VAPID_PUBLIC_KEY || null, kinds: NOTIFY_KINDS }));

/** Turns notifications on for this phone/computer (or updates its choices). */
app.post('/api/push/subscribe', async (c) => {
  if (!pushConfigured(c.env)) return fail(c, 503, 'Notifications are not set up on the server yet.');
  const b = await c.req.json().catch(() => ({}));
  if (!validSub(b.subscription)) return fail(c, 400, 'Invalid subscription.');
  const prefs = cleanPrefs(b.prefs);
  await saveSubscription(c.env, { scope: pushScope(c.get('auth')), endpoint: b.subscription.endpoint, p256dh: b.subscription.keys.p256dh, auth: b.subscription.keys.auth, prefs, userAgent: c.req.header('user-agent') });
  return c.json({ success: true, prefs });
});

/** This device's saved choices. */
app.post('/api/push/status', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const sub = b.endpoint ? await getSubscription(c.env, String(b.endpoint)) : null;
  if (!sub || sub.scope !== pushScope(c.get('auth'))) return c.json({ success: true, subscribed: false });
  return c.json({ success: true, subscribed: true, prefs: cleanPrefs(sub.prefs), health: deliveryHealth(sub) });
});

app.post('/api/push/unsubscribe', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const sub = b.endpoint ? await getSubscription(c.env, String(b.endpoint)) : null;
  if (sub && sub.scope === pushScope(c.get('auth'))) await deleteSubscription(c.env, sub.endpoint);
  return c.json({ success: true });
});

/** Sends a test notification to this device only. */
app.post('/api/push/test', async (c) => {
  if (!pushConfigured(c.env)) return fail(c, 503, 'Notifications are not set up on the server yet.');
  const b = await c.req.json().catch(() => ({}));
  const sub = b.endpoint ? await getSubscription(c.env, String(b.endpoint)) : null;
  if (!sub || sub.scope !== pushScope(c.get('auth'))) return fail(c, 404, 'Turn notifications on first.');
  // "Test with the app closed": the phone gets it a little later, after the app has been closed and the screen locked.
  const delay = Math.min(60, Math.max(0, Math.round(Number(b.delay) || 0)));
  if (delay) {
    await c.env.HUB.get(c.env.HUB.idFromName(`pushtest:${await sha256Hex(sub.endpoint)}`)).scheduleTestPush(sub.endpoint, delay * 1000);
    return c.json({ success: true, scheduled: true, delay });
  }
  let r; const payload = testPushPayload(false);
  try { r = await sendPush(c.env, sub, payload, { urgency: 'high' }); } // same path as a real customer message
  catch (err) { return fail(c, 502, `Could not reach the notification service: ${err.message}`); }
  if (r.gone) { await deleteSubscription(c.env, sub.endpoint); return fail(c, 410, 'This device turned notifications off. Turn them on again.'); }
  if (!r.ok) return fail(c, 502, `The notification service refused it (${r.status}).`);
  await markSent(c.env, sub.endpoint, payload.at);
  return c.json({ success: true });
});
app.get('/api/templates', (c) => c.json({ success: true, data: TEMPLATES }));

app.get('/api/tenants', async (c) => {
  const a = c.get('auth');
  const list = await listTenants(c.env, a.role === 'admin' ? null : a.tenantId);
  return c.json({ success: true, count: list.length, data: list.map(publicTenant) });
});

app.post('/api/tenants', requireAdmin, async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const errors = [];
  const businessName = String(b.businessName || '').trim();
  const phoneNumberId = String(b.phoneNumberId || '').trim();
  const accessToken = String(b.accessToken || '').trim();
  const adminPhone = normalizePhone(b.adminNotificationPhone);
  if (!businessName) errors.push('Business name is required.');
  if (!/^\d{5,30}$/.test(phoneNumberId)) errors.push('Phone number ID must be digits (from Meta → WhatsApp → API Setup).');
  if (!accessToken) errors.push('Access token is required.');
  if (!isValidPhone(adminPhone)) errors.push('Team alert number must include the country code.');
  const industry = getTemplate(b.industry).key;
  const { value: profile, errors: pErr } = validateProfile({ displayName: b.displayName || businessName, address: b.address, latitude: b.latitude, longitude: b.longitude, faq: [] });
  errors.push(...pErr);
  if (errors.length) return fail(c, 400, errors[0], { errors });
  if (await getTenantByPhoneNumberId(c.env, phoneNumberId)) return fail(c, 409, 'That phone number ID is already connected to another business.');

  const { key, hash } = await generateApiKey();
  const tenant = await insertTenant(c.env, {
    businessName, industry, phoneNumberId, wabaId: String(b.wabaId || '').trim(), accessTokenEnc: await encryptToken(c.env.TOKEN_ENCRYPTION_KEY, accessToken),
    apiKeyHash: hash, adminNotificationPhone: adminPhone, tier: [0, 1, 2, 3].includes(Number(b.tier)) ? Number(b.tier) : 0, isActive: true,
    profile, flow: flowFromTemplate(industry), ai: validateAi({ enabled: false }).value, templates: {},
  });
  return c.json({ success: true, tenant: publicTenant(tenant), apiKey: key }, 201);
});

app.get('/api/tenants/:tid', tenantAccess(), async (c) => {
  const t = await getTenant(c.env, c.req.param('tid'));
  return t ? c.json(tenantPayload(t)) : fail(c, 404, 'Not found');
});

const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

/** Telugu for the flow's texts (free Workers AI). Body: { flow } (the builder's draft) — returns { te, skipped } to review, not saved. */
app.post('/api/tenants/:tid/translate', tenantAccess(), async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const current = await getTenant(c.env, c.req.param('tid'));
  if (!current) return fail(c, 404, 'Not found');
  const { value, errors } = validateFlow(b.flow || current.flow);
  if (!value) return fail(c, 400, errors.join(' '));
  if (!c.env.AI) return fail(c, 503, 'The AI is not available.');
  const keep = b.onlyMissing ? (value.i18n?.te || {}) : null;
  const { te, skipped } = await translateFlow(c.env, value, { onlyMissing: keep });
  return c.json({ success: true, te: { ...(keep || {}), ...te }, skipped });
});

app.patch('/api/tenants/:tid', tenantAccess(), async (c) => {
  const id = c.req.param('tid');
  const current = await getTenant(c.env, id);
  if (!current) return fail(c, 404, 'Not found');
  const b = await c.req.json().catch(() => ({}));
  const isAdmin = c.get('auth').role === 'admin';
  const patch = {}; const errors = [];

  if (b.businessName !== undefined) { const v = String(b.businessName).trim(); if (!v || v.length > 120) errors.push('Business name: 1–120 characters.'); patch.businessName = v; }
  if (b.adminNotificationPhone !== undefined) { const p = normalizePhone(b.adminNotificationPhone); if (!isValidPhone(p)) errors.push('Team alert number must include the country code.'); patch.adminNotificationPhone = p; }
  if (b.industry !== undefined) patch.industry = getTemplate(b.industry).key;
  if (b.profile !== undefined) {
    // documentUrl is only set by the upload endpoint (or cleared with null).
    const { value, errors: e } = validateProfile({ ...b.profile, documentUrl: b.profile?.documentUrl === null ? null : current.profile.documentUrl });
    errors.push(...e); patch.profile = value;
  }
  if (b.flow !== undefined) {
    const { value, errors: e } = validateFlow(b.flow); errors.push(...e); patch.flow = value;
    // Publishing a template from the Flow Builder also sets the business's industry.
    if (value?.template && TEMPLATES.some((t) => t.key === value.template) && b.industry === undefined) patch.industry = value.template;
  }
  if (b.ai !== undefined) { const { value, errors: e } = validateAi(b.ai); errors.push(...e); patch.ai = value; }
  if (b.templates !== undefined) {
    const t = { ...current.templates };
    for (const [k, re, label] of [['broadcastName', TEMPLATE_NAME_RE, 'Broadcast template name'], ['adminAlertName', TEMPLATE_NAME_RE, 'Alert template name'],
      ['broadcastLanguage', LANGUAGE_RE, 'Broadcast language'], ['adminAlertLanguage', LANGUAGE_RE, 'Alert language']]) {
      if (b.templates[k] === undefined) continue;
      const v = String(b.templates[k] ?? '').trim();
      if (v && !re.test(v)) errors.push(`${label} looks invalid (names use lowercase letters, numbers and _; languages look like en or en_US).`);
      t[k] = v || null;
    }
    if (b.templates.broadcastHasParams !== undefined) t.broadcastHasParams = b.templates.broadcastHasParams === null ? null : !!b.templates.broadcastHasParams;
    patch.templates = t;
  }
  const adminOnly = ['tier', 'isActive', 'wabaId', 'accessToken', 'phoneNumberId'];
  if (!isAdmin && adminOnly.some((k) => b[k] !== undefined)) return fail(c, 403, 'Only an admin can change WhatsApp credentials, tier or account status.');
  if (isAdmin) {
    if (b.tier !== undefined) { const v = Number(b.tier); if (![0, 1, 2, 3].includes(v)) errors.push('Tier must be 0–3.'); patch.tier = v; }
    if (b.isActive !== undefined) patch.isActive = !!b.isActive;
    if (b.wabaId !== undefined) patch.wabaId = String(b.wabaId).trim();
    if (b.accessToken) patch.accessTokenEnc = await encryptToken(c.env.TOKEN_ENCRYPTION_KEY, String(b.accessToken).trim());
    if (b.phoneNumberId !== undefined && b.phoneNumberId !== current.phoneNumberId) {
      const v = String(b.phoneNumberId).trim();
      if (!/^\d{5,30}$/.test(v)) errors.push('Phone number ID must be digits.');
      else if (await getTenantByPhoneNumberId(c.env, v)) errors.push('That phone number ID is already used by another business.');
      patch.phoneNumberId = v;
    }
  }
  if (errors.length) return fail(c, 400, errors[0], { errors });
  if (!Object.keys(patch).length) return fail(c, 400, 'Nothing to update.');
  return c.json(tenantPayload(await updateTenant(c.env, id, patch)));
});

app.post('/api/tenants/:tid/apply-template', tenantAccess(), async (c) => {
  const { template } = await c.req.json().catch(() => ({}));
  if (!TEMPLATES.some((t) => t.key === template)) return fail(c, 400, 'Unknown template');
  const catalog = await listCatalog(c.env, c.req.param('tid'), { activeOnly: true, layout: template });
  return c.json(tenantPayload(await updateTenant(c.env, c.req.param('tid'), { industry: template, flow: personalizeFlow(flowFromTemplate(template), template, catalog) })));
});

/** A template's flow filled with this business's own products/services (not saved). */
app.get('/api/tenants/:tid/templates/:key', tenantAccess(), async (c) => {
  const key = c.req.param('key');
  if (!TEMPLATES.some((t) => t.key === key)) return fail(c, 404, 'Unknown template');
  const catalog = await listCatalog(c.env, c.req.param('tid'), { activeOnly: true, layout: key });
  return c.json({ success: true, data: personalizeFlow(getTemplate(key).flow, key, catalog) });
});

/** "Try the assistant": runs the AI on a sample question with the saved (or draft) profile; sends nothing. */
app.post('/api/tenants/:tid/ai-test', tenantAccess(), async (c) => {
  const tenant = await getTenant(c.env, c.req.param('tid'));
  const b = await c.req.json().catch(() => ({}));
  const question = String(b.message || '').trim().slice(0, 500);
  if (!question) return fail(c, 400, 'Type a question to try.');
  const profile = b.profile ? validateProfile({ ...b.profile, documentUrl: tenant.profile.documentUrl }).value : tenant.profile;
  const aiCfg = b.ai ? validateAi(b.ai).value : tenant.ai;
  const allowed = await takeAiReply(c.env, tenant._id, aiCfg.dailyLimit ?? 300);
  if (!allowed) return fail(c, 429, "Today's AI reply limit is used up.");
  const catalog = await listCatalog(c.env, tenant._id, { activeOnly: true, layout: layoutOf(tenant) });
  const decision = await aiDecide(c.env, { tenant: { ...tenant, profile }, aiCfg, pending: null, catalog, history: [{ direction: 'in', sent_by: 'customer', type: 'text', text: question }] });
  if (!decision) return fail(c, 502, 'The AI model did not answer. Try again in a moment.');
  const items = (decision.itemIds || []).map((id) => catalog.find((x) => x._id === id)).filter(Boolean);
  return c.json({ success: true, data: { ...decision, items } });
});

app.post('/api/tenants/:tid/rotate-key', requireAdmin, async (c) => {
  if (!await getTenant(c.env, c.req.param('tid'))) return fail(c, 404, 'Not found');
  const { key, hash } = await generateApiKey();
  await updateTenant(c.env, c.req.param('tid'), { apiKeyHash: hash });
  return c.json({ success: true, apiKey: key });
});

// ---------------- Meta (Graph API) setup ----------------
async function graph(c, tenant, method, path, body) {
  const base = String(c.env.GRAPH_BASE_URL || 'https://graph.facebook.com').replace(/\/$/, '');
  const res = await fetch(`${base}/${c.env.GRAPH_API_VERSION || 'v25.0'}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${await tenantAccessToken(c.env, tenant)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Template approval status, webhook subscription and number status for one business. */
app.get('/api/tenants/:tid/meta-status', requireAdmin, async (c) => {
  const t = await getTenant(c.env, c.req.param('tid'));
  if (!t) return fail(c, 404, 'Not found');
  if (!t.wabaId) return fail(c, 400, 'This business has no WABA ID.');
  const [templates, subscribed, phone] = await Promise.all([
    graph(c, t, 'GET', `${t.wabaId}/message_templates?fields=name,status,language,category,rejected_reason&limit=100`),
    graph(c, t, 'GET', `${t.wabaId}/subscribed_apps`),
    graph(c, t, 'GET', `${t.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,status,messaging_limit_tier`),
  ]);
  return c.json({ success: true, templates: templates.data, subscribedApps: subscribed.data, phone: phone.data });
});

/** webhook: true → point this WhatsApp account's webhook (WABA-level override) at this Worker. */
app.post('/api/tenants/:tid/meta-setup', requireAdmin, async (c) => {
  const t = await getTenant(c.env, c.req.param('tid'));
  if (!t) return fail(c, 404, 'Not found');
  if (!t.wabaId) return fail(c, 400, 'This business has no WABA ID.');
  const b = await c.req.json().catch(() => ({}));
  const out = { success: true };
  if (b.webhook) {
    const callback = `${new URL(c.req.url).origin}/webhook`;
    out.webhook = { callback, ...(await graph(c, t, 'POST', `${t.wabaId}/subscribed_apps`, { override_callback_uri: callback, verify_token: c.env.WHATSAPP_VERIFY_TOKEN })) };
    if (!out.webhook.ok) out.success = false;
  }
  return c.json(out, out.success ? 200 : 502);
});

// ---------------- documents (R2) ----------------
app.post('/api/uploads/document/:tid', tenantAccess(), async (c) => {
  const tid = c.req.param('tid');
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return fail(c, 400, 'Choose a PDF to upload.');
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return fail(c, 400, 'Only PDF files are allowed.');
  if (file.size > 20 * 1024 * 1024) return fail(c, 400, 'PDFs can be at most 20 MB.');
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...head) !== '%PDF-') return fail(c, 400, "That file doesn't look like a PDF.");
  const tenant = await getTenant(c.env, tid);
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(-120);
  const key = `documents/${tid}/${Date.now()}_${safe}`;
  await c.env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: 'application/pdf', cacheControl: 'public, max-age=31536000, immutable' } });
  const url = `${String(c.env.R2_PUBLIC_BASE_URL).replace(/\/$/, '')}/${key}`;
  const old = tenant.profile?.documentUrl;
  const updated = await updateTenant(c.env, tid, { profile: { ...tenant.profile, documentUrl: url } });
  const base = String(c.env.R2_PUBLIC_BASE_URL).replace(/\/$/, '') + '/';
  if (old && old.startsWith(base)) c.executionCtx.waitUntil(c.env.MEDIA.delete(old.slice(base.length)).catch(() => {}));
  return c.json({ success: true, data: { documentUrl: url, size: file.size }, tenant: publicTenant(updated) }, 201);
});

// ---------------- products & services (photos in R2) ----------------
const IMAGE_MAX = 5 * 1024 * 1024; // WhatsApp's limit for image messages
function itemFields(src, errors, layout = 'general') {
  const f = {}; const str = (v) => String(v ?? '').trim();
  if (src.name !== undefined) { f.name = str(src.name); if (!f.name || f.name.length > 60) errors.push('Name: 1–60 characters.'); }
  for (const [k, max, label] of [['category', 40, 'Category'], ['description', 500, 'Description'], ['price', 40, 'Price']]) {
    if (src[k] !== undefined) { f[k] = str(src[k]); if (f[k].length > max) errors.push(`${label}: up to ${max} characters.`); }
  }
  if (src.layout !== undefined) { f.layout = str(src.layout); if (!TEMPLATES.some((t) => t.key === f.layout)) errors.push('Unknown layout.'); }
  if (src.details !== undefined) f.details = cleanDetails(f.layout || layout, src.details, errors);
  if (src.active !== undefined) f.active = src.active === true || src.active === 'true';
  return f;
}
/** Turns the pasted Google Maps link into an exact pin (for the WhatsApp location message). */
async function addMapPoint(f, old = {}) {
  if (!f.details) return;
  if (!f.details.map) return;
  const same = f.details.map === old?.map && Number.isFinite(old?.lat);
  const p = same ? { lat: old.lat, lng: old.lng } : await resolveMapPoint(f.details.map);
  if (p) Object.assign(f.details, p);
}
/** Checks the real file type (not just the name) and stores the photo in R2. */
async function storeImage(c, tid, file) {
  if (file.size > IMAGE_MAX) throw Object.assign(new Error('Photos can be at most 5 MB (WhatsApp limit).'), { status: 400 });
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (!isPng && !isJpeg) throw Object.assign(new Error('Only JPEG or PNG photos can be sent on WhatsApp.'), { status: 400 });
  const ext = isPng ? 'png' : 'jpg';
  const key = `images/${tid}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await c.env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: isPng ? 'image/png' : 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' } });
  return { imageKey: key, imageUrl: `${String(c.env.R2_PUBLIC_BASE_URL).replace(/\/$/, '')}/${key}` };
}
async function readItemRequest(c) {
  const type = c.req.header('content-type') || '';
  if (type.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
    const image = form.get('image');
    return { fields, image: image && typeof image !== 'string' && image.size ? image : null, removeImage: fields.removeImage === 'true' };
  }
  const body = await c.req.json().catch(() => ({}));
  return { fields: body, image: null, removeImage: body.removeImage === true };
}

/** Dashboard map picker: pincode / area name → point, or point → place name. Signed-in users only; results cached. */
app.get('/api/geocode', async (c) => {
  const { q, lat, lng } = c.req.query();
  if (lat && lng && Number.isFinite(+lat) && Number.isFinite(+lng)) return c.json({ success: true, data: { lat: +lat, lng: +lng, label: await reverseGeocode(c.env, +lat, +lng) } });
  const g = await geocode(c.env, q);
  return g ? c.json({ success: true, data: g }) : fail(c, 404, "Couldn't find that place. Try a pincode or a nearby landmark.");
});

app.get('/api/catalog/:tid', tenantAccess(), async (c) => c.json({ success: true, data: await listCatalog(c.env, c.req.param('tid')) }));

app.post('/api/catalog/:tid', tenantAccess(), async (c) => {
  const tid = c.req.param('tid');
  const { fields, image } = await readItemRequest(c);
  // New items go to the layout given, else the business's selected layout.
  const errors = []; const f = itemFields({ ...fields, name: fields.name ?? '', layout: fields.layout || layoutOf(await getTenant(c.env, tid)) }, errors);
  if (errors.length) return fail(c, 400, errors[0], { errors });
  await addMapPoint(f);
  const existing = await listCatalog(c.env, tid, { layout: f.layout });
  if (existing.length >= MAX_CATALOG_ITEMS) return fail(c, 400, `Up to ${MAX_CATALOG_ITEMS} products and services per layout.`);
  try { if (image) Object.assign(f, await storeImage(c, tid, image)); } catch (err) { return fail(c, err.status || 500, err.message); }
  return c.json({ success: true, data: await insertItem(c.env, tid, f) }, 201);
});

app.patch('/api/catalog/:tid/:itemId', tenantAccess(), async (c) => {
  const { tid, itemId } = c.req.param();
  const item = await getItem(c.env, tid, itemId);
  if (!item) return fail(c, 404, 'Not found');
  const { fields, image, removeImage } = await readItemRequest(c);
  const errors = []; const f = itemFields(fields, errors, item.layout);
  if (errors.length) return fail(c, 400, errors[0], { errors });
  await addMapPoint(f, item.details);
  try { if (image) Object.assign(f, await storeImage(c, tid, image)); } catch (err) { return fail(c, err.status || 500, err.message); }
  if (removeImage && !image) Object.assign(f, { imageUrl: null, imageKey: null });
  if ((image || removeImage) && item.imageKey) c.executionCtx.waitUntil(c.env.MEDIA.delete(item.imageKey).catch(() => {}));
  return c.json({ success: true, data: await updateItem(c.env, tid, itemId, f) });
});

app.delete('/api/catalog/:tid/:itemId', tenantAccess(), async (c) => {
  const { tid, itemId } = c.req.param();
  const item = await getItem(c.env, tid, itemId);
  if (!item) return fail(c, 404, 'Not found');
  await deleteItem(c.env, tid, itemId);
  if (item.imageKey) c.executionCtx.waitUntil(c.env.MEDIA.delete(item.imageKey).catch(() => {}));
  return c.json({ success: true });
});

app.post('/api/catalog/:tid/reorder', tenantAccess(), async (c) => {
  const tid = c.req.param('tid');
  const { ids } = await c.req.json().catch(() => ({}));
  if (!Array.isArray(ids) || ids.length > MAX_CATALOG_ITEMS) return fail(c, 400, 'Send { ids: [...] } in the new order.');
  const stmt = c.env.DB.prepare('UPDATE catalog_items SET sort = ? WHERE tenant_id = ? AND id = ?');
  if (ids.length) await c.env.DB.batch(ids.map((id, i) => stmt.bind(i, tid, String(id))));
  return c.json({ success: true, data: await listCatalog(c.env, tid) });
});

// ---------------- leads & broadcast ----------------
app.get('/api/leads/:tid', tenantAccess(), async (c) => {
  const q = c.req.query();
  const res = await listLeads(c.env, c.req.param('tid'), {
    page: Math.max(parseInt(q.page, 10) || 1, 1), limit: Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 500), status: q.status || '', search: (q.search || '').trim(),
  });
  return c.json({ success: true, count: res.data.length, ...res });
});

app.get('/api/leads/:tid/stats', tenantAccess(), async (c) => c.json({ success: true, data: await leadStats(c.env, c.req.param('tid')) }));

app.get('/api/leads/:tid/queue', tenantAccess(), async (c) => c.json({ success: true, stats: await c.env.HUB.get(c.env.HUB.idFromName(c.req.param('tid'))).queueStats() }));

/** Reads the uploaded CSV: unique valid numbers (first name wins), plus invalid samples and duplicate count. */
async function readCsvRecipients(c) {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  // Contacts typed in by hand on the Broadcast page: JSON [{ name, phone }]. They come first, so their name wins.
  let manual = [];
  const manualRaw = form?.get('manual');
  if (typeof manualRaw === 'string' && manualRaw) {
    try { manual = JSON.parse(manualRaw); } catch { manual = []; }
    if (!Array.isArray(manual)) manual = [];
    if (manual.length > 500) throw Object.assign(new Error('Up to 500 numbers can be added by hand. Use a CSV for more.'), { status: 400 });
    manual = manual.map((m) => ({ phone: String(m?.phone ?? '').slice(0, 40), name: String(m?.name ?? '').trim().slice(0, 80) }));
  }
  const hasFile = file && typeof file !== 'string';
  if (!hasFile && !manual.length) throw Object.assign(new Error('Add a number or choose a CSV file.'), { status: 400 });
  if (hasFile && file.size > 10 * 1024 * 1024) throw Object.assign(new Error('CSV files can be at most 10 MB.'), { status: 400 });
  const csvRows = hasFile ? parseCsv(await file.text()) : [];
  if (hasFile && !csvRows.length && !manual.length) throw Object.assign(new Error('The CSV is empty.'), { status: 400 });
  const rows = [...manual, ...csvRows];
  const seen = new Set(); const recipients = []; const invalid = [];
  for (const row of rows) {
    const raw = pickPhone(row); const phone = normalizePhone(raw);
    if (!isValidPhone(phone)) { invalid.push(raw || '(blank)'); continue; }
    if (seen.has(phone)) continue;
    seen.add(phone); recipients.push({ phone, name: pickName(row) || '' });
  }
  let selected = null; // phones the user ticked on the Broadcast page (null = everyone in the file)
  const raw = form.get('phones');
  if (typeof raw === 'string' && raw) { try { selected = new Set(JSON.parse(raw).map((p) => normalizePhone(String(p)))); } catch { /* ignore */ } }
  return { rows, recipients, invalid, selected, duplicates: rows.length - recipients.length - invalid.length };
}
/** What we already know about these numbers: opted out, broadcast before (when, delivery), chatted. */
async function knownLeads(c, tid, phones) {
  const map = new Map();
  for (let i = 0; i < phones.length; i += 90) {
    const chunk = phones.slice(i, i + 90);
    const { results } = await c.env.DB.prepare(`SELECT phone, name, status, last_broadcast_at, broadcast_status, broadcast_error, last_message_at, last_message_direction FROM leads WHERE tenant_id = ? AND phone IN (${chunk.map(() => '?').join(',')})`).bind(tid, ...chunk).all();
    for (const l of results) map.set(l.phone, l);
  }
  return map;
}

/** Step 1 of a broadcast: shows who is in the CSV and who already got a broadcast, so the user can choose. */
app.post('/api/leads/:tid/preview', tenantAccess(), async (c) => {
  const tid = c.req.param('tid');
  const tenant = await getTenant(c.env, tid);
  if (!tenant) return fail(c, 404, 'Not found');
  let csv; try { csv = await readCsvRecipients(c); } catch (err) { return fail(c, err.status || 500, err.message); }
  if (!csv.recipients.length) return fail(c, 400, 'No valid phone numbers found.', { invalidSamples: csv.invalid.slice(0, 10) });
  if (csv.recipients.length > 10000) return fail(c, 400, 'Up to 10,000 numbers per broadcast.');
  const known = await knownLeads(c, tid, csv.recipients.map((r) => r.phone));
  const contacts = csv.recipients.map((r) => {
    const l = known.get(r.phone);
    const state = l?.status === 'COLD' ? 'optedOut' : l?.last_broadcast_at ? 'sent' : 'new';
    return { phone: r.phone, name: r.name || l?.name || '', state, leadStatus: l?.status || null, lastBroadcastAt: l?.last_broadcast_at || null, broadcastStatus: l?.broadcast_status || null, broadcastError: l?.broadcast_error || null, replied: !!(l?.last_broadcast_at && l.last_message_direction === 'in' && l.last_message_at > l.last_broadcast_at) };
  });
  const limit = DAILY_LIMIT_BY_TIER[tenant.tier] ?? 250;
  const sent24h = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ? AND last_broadcast_at >= ?').bind(tid, new Date(Date.now() - 864e5).toISOString()).first()).n;
  return c.json({ success: true, data: contacts, summary: { total: csv.rows.length, duplicates: csv.duplicates, invalid: csv.invalid.length, invalidSamples: csv.invalid.slice(0, 10), quotaRemaining: Math.max(limit - sent24h, 0), limit, tier: tenant.tier } });
});

app.post('/api/leads/:tid/upload', tenantAccess(), async (c) => {
  const tid = c.req.param('tid');
  const tenant = await getTenant(c.env, tid);
  if (!tenant || !tenant.isActive) return fail(c, 400, 'This business is not active.');
  let csv; try { csv = await readCsvRecipients(c); } catch (err) { return fail(c, err.status || 500, err.message); }
  const { rows, invalid, selected } = csv;
  const recipients = selected ? csv.recipients.filter((r) => selected.has(r.phone)) : csv.recipients;
  const summary = { total: rows.length, enqueued: 0, duplicatesSkipped: csv.duplicates, invalidSkipped: invalid.length, notSelected: csv.recipients.length - recipients.length, optedOutSkipped: 0, recentlyContactedSkipped: 0 };
  if (!recipients.length) return fail(c, 400, selected ? 'Select at least one contact to send to.' : 'No valid phone numbers found in the CSV.', { invalidSamples: invalid.slice(0, 10), summary });

  // Never message people who opted out. The cooldown only applies when nobody was picked by hand:
  // a contact the user ticked again on purpose is sent again.
  const cooldownDays = selected ? 0 : Number(c.env.BROADCAST_COOLDOWN_DAYS) || 0;
  const cooldownStart = cooldownDays ? new Date(Date.now() - cooldownDays * 864e5).toISOString() : null;
  const skip = new Set();
  for (const l of (await knownLeads(c, tid, recipients.map((r) => r.phone))).values()) {
    if (l.status === 'COLD') { skip.add(l.phone); summary.optedOutSkipped++; }
    else if (cooldownStart && l.last_broadcast_at && l.last_broadcast_at >= cooldownStart) { skip.add(l.phone); summary.recentlyContactedSkipped++; }
  }
  const toSend = recipients.filter((r) => !skip.has(r.phone));
  if (!toSend.length) return c.json({ success: true, message: 'Nothing to send: every valid number has opted out or was contacted recently.', summary, invalidSamples: invalid.slice(0, 10) });

  const limit = DAILY_LIMIT_BY_TIER[tenant.tier] ?? 250;
  const sent24h = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ? AND last_broadcast_at >= ?').bind(tid, new Date(Date.now() - 864e5).toISOString()).first()).n;
  if (toSend.length + sent24h > limit) return fail(c, 429, `Tier ${tenant.tier} limit exceeded. Allowed: ${limit}/24h, already sent: ${sent24h}.`);

  const now = nowIso();
  const stmt = c.env.DB.prepare(`INSERT INTO leads (id, tenant_id, phone, name, status, last_broadcast_at, updated_at) VALUES (?, ?, ?, ?, 'CONTACTED', ?, ?)
    ON CONFLICT (tenant_id, phone) DO UPDATE SET name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE leads.name END,
      status = CASE WHEN leads.status = 'NEW' THEN 'CONTACTED' ELSE leads.status END,
      last_broadcast_at = excluded.last_broadcast_at, last_broadcast_message_id = NULL, broadcast_status = NULL, broadcast_status_at = NULL, broadcast_error = NULL, updated_at = excluded.updated_at`);
  for (let i = 0; i < toSend.length; i += 50) {
    await c.env.DB.batch(toSend.slice(i, i + 50).map((r) => stmt.bind(crypto.randomUUID(), tid, r.phone, r.name, now, now)));
  }

  const t = tenant.templates || {};
  const template = {
    name: t.broadcastName || c.env.DEFAULT_BROADCAST_TEMPLATE,
    language: t.broadcastLanguage || c.env.DEFAULT_BROADCAST_LANGUAGE || 'en',
    hasParams: t.broadcastName ? t.broadcastHasParams !== false : true,
  };
  await c.env.HUB.get(c.env.HUB.idFromName(tid)).startBroadcast(tid, toSend, template);
  summary.enqueued = toSend.length;
  return c.json({ success: true, message: `Queued ${toSend.length} messages. Sending in the background.`, summary: { ...summary, quotaRemaining: limit - sent24h - toSend.length, tier: tenant.tier }, invalidSamples: invalid.slice(0, 10) }, 202);
});

// ---------------- inbox ----------------
const phoneOk = (c, next) => (/^\d{6,15}$/.test(c.req.param('phone')) ? next() : fail(c, 400, 'Invalid phone'));

app.get('/api/chats/:tid', tenantAccess(), async (c) => {
  const q = c.req.query();
  const res = await listChats(c.env, c.req.param('tid'), { limit: Math.min(Math.max(parseInt(q.limit, 10) || 30, 1), 100), search: (q.search || '').trim(), unread: q.unread === 'true', before: q.before || null });
  return c.json({ success: true, ...res });
});

app.get('/api/chats/:tid/:phone/messages', tenantAccess(), phoneOk, async (c) => {
  const { tid, phone } = c.req.param();
  const lead = await getLead(c.env, tid, phone);
  if (!lead) return fail(c, 404, 'Chat not found');
  const res = await listMessages(c.env, tid, phone, { limit: Math.min(Math.max(parseInt(c.req.query('limit'), 10) || 50, 1), 200), before: c.req.query('before') || null });
  return c.json({ success: true, lead, ...res });
});

app.post('/api/chats/:tid/:phone/messages', tenantAccess(), phoneOk, async (c) => {
  const { tid, phone } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const text = String(body.text || '').trim();
  if (!text) return fail(c, 400, 'Type a message first.');
  if (text.length > 4096) return fail(c, 400, 'Messages can be at most 4096 characters.');
  const [tenant, lead] = await Promise.all([getTenant(c.env, tid), getLead(c.env, tid, phone)]);
  if (!tenant || !tenant.isActive) return fail(c, 404, 'Business not found or inactive');
  if (!lead) return fail(c, 404, 'Chat not found');
  if (lead.status === 'COLD') return fail(c, 409, 'This customer opted out. WhatsApp policy does not allow messaging them.');
  if (!lead.lastInboundAt || Date.now() - new Date(lead.lastInboundAt).getTime() > REPLY_WINDOW_MS) {
    return fail(c, 409, "More than 24 hours since this customer's last message. WhatsApp only allows a template now — re-engage them with a broadcast.", { code: 'WINDOW_CLOSED' });
  }
  let recorded = null;
  const record = outboundRecorder(c.env, tid, 'agent');
  const client = new WhatsAppClient(c.env, { accessToken: await tenantAccessToken(c.env, tenant), phoneNumberId: tenant.phoneNumberId }, { onSent: async (p, d) => { recorded = await record(p, d); } });
  try { await client.text(phone, text); } catch (err) { return fail(c, 502, `WhatsApp rejected the message: ${err.text || err.message}`); }
  let updated = recorded?.lead || lead;
  if (body.pauseBot !== false && !lead.botPaused) {
    updated = await upsertLead(c.env, tid, phone, { set: { botPaused: true } });
    await publish(c.env, tid, 'lead:update', { lead: updated });
  }
  return c.json({ success: true, data: recorded?.message || null, lead: updated }, 201);
});

app.post('/api/chats/:tid/:phone/read', tenantAccess(), phoneOk, async (c) => {
  const { tid, phone } = c.req.param();
  const [lead] = await updateLeads(c.env, tid, 'phone = ?', [phone], { unreadCount: 0 });
  if (!lead) return fail(c, 404, 'Chat not found');
  await publish(c.env, tid, 'lead:update', { lead });
  return c.json({ success: true, lead });
});

app.patch('/api/chats/:tid/:phone', tenantAccess(), phoneOk, async (c) => {
  const { tid, phone } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const patch = {};
  if (typeof body.botPaused === 'boolean') patch.botPaused = body.botPaused;
  if (body.language !== undefined) {
    if (body.language !== null && !['en', 'te'].includes(body.language)) return fail(c, 400, 'language must be "en", "te" or null.');
    patch.language = body.language;
  }
  if (!Object.keys(patch).length) return fail(c, 400, 'Send { "botPaused": true | false } and/or { "language": "en" | "te" | null }.');
  const [lead] = await updateLeads(c.env, tid, 'phone = ?', [phone], patch);
  if (!lead) return fail(c, 404, 'Chat not found');
  await publish(c.env, tid, 'lead:update', { lead });
  return c.json({ success: true, lead });
});

// Customer photos, voice notes, videos and documents (copied from WhatsApp to R2 when they arrive).
/** Deletes everything about one customer (their request under data-protection law). */
app.delete('/api/chats/:tid/:phone', tenantAccess(), phoneOk, async (c) => {
  const { tid, phone } = c.req.param();
  const removed = await forgetCustomer(c.env, tid, phone);
  await recordEvent(c.env, 'customer_deleted', `+${phone.slice(0, 4)}… (${removed.messages} messages, ${removed.files} files)`, tid);
  await publish(c.env, tid, 'lead:removed', { phone });
  return c.json({ success: true, removed });
});

app.get('/api/media/:tid/:file', tenantAccess(), async (c) => {
  const { tid, file } = c.req.param();
  if (!MEDIA_FILE.test(file)) return fail(c, 400, 'Invalid file name');
  const key = `inbound/${tid}/${file}`;
  const obj = (c.env.PRIVATE_MEDIA && await c.env.PRIVATE_MEDIA.get(key)) || await c.env.MEDIA.get(key); // older files may not be moved yet
  if (!obj) return fail(c, 404, 'File not found');
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'Content-Length': String(obj.size), 'Cache-Control': 'private, max-age=86400' } });
});

app.notFound((c) => (c.req.path.startsWith('/api/') ? fail(c, 404, 'Not found') : c.env.ASSETS.fetch(c.req.raw)));

/** Admin: what the monitor sees right now (the dashboard's "System health"). */
app.get('/api/monitor', async (c) => {
  if (c.get('auth').role !== 'admin') return fail(c, 403, 'Admins only.');
  return c.json({ success: true, problems: await findProblems(c.env) });
});

export default {
  fetch: app.fetch,
  // Every 10 minutes: check the bot is answering and alert the admin's phone if not.
  scheduled: (event, env, ctx) => ctx.waitUntil(Promise.all([
    runMonitor(env).catch((err) => console.error('[Monitor] failed:', err.message)),
    moveInboundToPrivate(env).catch((err) => console.error('[Media] move failed:', err.message)),
    // Chat messages and customers' files are kept for RETENTION_DAYS (default 365), then deleted.
    applyRetention(env, Number(env.RETENTION_DAYS) || 365).catch((err) => console.error('[Privacy] retention failed:', err.message)),
  ])),
};
