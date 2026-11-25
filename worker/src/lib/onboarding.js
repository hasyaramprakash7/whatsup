// A business connects its own Meta (WhatsApp) account: the IDs + access key are checked with Meta, then either the
// business is created right away (admin) or a request waits for the admin's approval (a business's own login).
import { encryptToken } from './crypto.js';
import { normalizePhone, isValidPhone, nowIso } from './text.js';

const newId = () => crypto.randomUUID();
const DIGITS = /^\d{8,25}$/;

/** Checks the form; returns { value } or { errors }. */
export function cleanConnect(b = {}) {
  const errors = [];
  const v = {
    businessName: String(b.businessName || '').trim().slice(0, 80),
    industry: String(b.industry || 'real_estate').trim().slice(0, 40),
    wabaId: String(b.wabaId || '').replace(/\s/g, ''),
    phoneNumberId: String(b.phoneNumberId || '').replace(/\s/g, ''),
    accessToken: String(b.accessToken || '').trim(),
    appSecret: String(b.appSecret || '').trim(),
    adminPhone: normalizePhone(b.adminNotificationPhone || ''),
  };
  if (!v.businessName) errors.push('Business name is required.');
  if (!DIGITS.test(v.wabaId)) errors.push('WhatsApp Business Account ID: digits only (Meta calls it "Messaging Account ID" or "WABA ID").');
  if (!DIGITS.test(v.phoneNumberId)) errors.push('Phone number ID: digits only (Meta → WhatsApp → Production setup → "Phone Number ID").');
  if (!/^EA[A-Za-z0-9]{40,}$/.test(v.accessToken)) errors.push('Access key: paste the whole permanent token from Meta (it starts with "EA").');
  if (v.appSecret && !/^[a-f0-9]{32}$/i.test(v.appSecret)) errors.push('App secret: 32 letters/digits from Meta → App settings → Basic → App secret.');
  if (!isValidPhone(v.adminPhone)) errors.push('Team alert number: with country code, e.g. 919876543210.');
  return errors.length ? { errors } : { value: v };
}

/**
 * Asks Meta (with the business's own key) that the number belongs to that account. Test copy (no Meta): skipped.
 * Returns { ok, checked, displayPhone, verifiedName, quality, error }.
 */
export async function verifyWithMeta(env, { wabaId, phoneNumberId, accessToken }, fetchImpl = fetch) {
  const base = String(env.GRAPH_BASE_URL || 'https://graph.facebook.com').replace(/\/$/, '');
  if (base === 'fake') return { ok: true, checked: false, displayPhone: null, verifiedName: null };
  const get = async (path) => {
    const r = await fetchImpl(`${base}/${env.GRAPH_API_VERSION || 'v25.0'}/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, data };
  };
  const [phone, list] = await Promise.all([
    get(`${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`),
    get(`${wabaId}/phone_numbers?fields=id,display_phone_number&limit=100`),
  ]);
  const why = (x) => x.data?.error?.message || 'Meta did not accept these details.';
  if (!phone.ok) return { ok: false, checked: true, error: `Phone number ID: ${why(phone)}` };
  if (!list.ok) return { ok: false, checked: true, error: `WhatsApp Business Account ID: ${why(list)}` };
  if (!(list.data.data || []).some((p) => String(p.id) === phoneNumberId)) {
    return { ok: false, checked: true, error: 'That phone number ID is not in that WhatsApp Business Account. Check both IDs.' };
  }
  return { ok: true, checked: true, displayPhone: phone.data.display_phone_number || null, verifiedName: phone.data.verified_name || null, quality: phone.data.quality_rating || null };
}

/** Saves a request for the admin (the key and app secret are stored encrypted). */
export async function saveRequest(env, fromTenantId, v, check) {
  const id = newId();
  await env.DB.prepare(`INSERT INTO onboarding_requests (id, from_tenant_id, business_name, industry, waba_id, phone_number_id, access_token_enc, app_secret_enc, admin_phone, display_phone, verified_name, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`).bind(id, fromTenantId || null, v.businessName, v.industry, v.wabaId, v.phoneNumberId,
    await encryptToken(env.TOKEN_ENCRYPTION_KEY, v.accessToken), v.appSecret ? await encryptToken(env.TOKEN_ENCRYPTION_KEY, v.appSecret) : null,
    v.adminPhone, check?.displayPhone || null, check?.verifiedName || null, nowIso()).run();
  return id;
}

const rowToRequest = (r) => r && ({
  _id: r.id, fromTenantId: r.from_tenant_id, businessName: r.business_name, industry: r.industry, wabaId: r.waba_id, phoneNumberId: r.phone_number_id,
  adminPhone: r.admin_phone, displayPhone: r.display_phone, verifiedName: r.verified_name, ownApp: !!r.app_secret_enc, status: r.status,
  createdTenantId: r.created_tenant_id, createdAt: r.created_at, decidedAt: r.decided_at,
  _tokenEnc: r.access_token_enc, _secretEnc: r.app_secret_enc,
});
export async function listRequests(env, status = 'waiting') {
  const { results } = await env.DB.prepare('SELECT * FROM onboarding_requests WHERE status = ? ORDER BY created_at DESC LIMIT 50').bind(status).all();
  return results.map(rowToRequest);
}
export const getRequest = async (env, id) => rowToRequest(await env.DB.prepare('SELECT * FROM onboarding_requests WHERE id = ?').bind(id).first());
export const publicRequest = (r) => { if (!r) return r; const { _tokenEnc, _secretEnc, ...rest } = r; return rest; };
export async function decideRequest(env, id, status, tenantId = null) {
  await env.DB.prepare('UPDATE onboarding_requests SET status = ?, created_tenant_id = ?, decided_at = ? WHERE id = ?').bind(status, tenantId, nowIso(), id).run();
}
