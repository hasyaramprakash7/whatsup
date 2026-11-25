// People who use the dashboard: one key per person (revocable), optional 2-step sign-in with an authenticator app
// (TOTP, RFC 6238), signed sessions so a key is only typed once, and an activity log of who did what.
import { sha256Hex, encryptToken, decryptToken } from './crypto.js';

const enc = new TextEncoder(); const dec = new TextDecoder();
export const MEMBER_KEY_PREFIX = 'bxm_';
export const SESSION_PREFIX = 'bxs_';
export const ROLES = ['owner', 'agent']; // owner: everything for the business; agent: inbox, leads, bookings only

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const now = () => new Date().toISOString();

const ready = new WeakMap();
export function ensureTeamTables(env) {
  if (!ready.has(env.DB)) {
    ready.set(env.DB, env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS team_members (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL, role TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE, totp_enc TEXT, totp_pending_enc TEXT, totp_on INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, created_by TEXT, last_used_at TEXT, revoked_at TEXT)`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS team_members_tenant ON team_members (tenant_id)'),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, at TEXT NOT NULL)`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS audit_log_tenant_at ON audit_log (tenant_id, at)'),
    ]).catch((err) => { ready.delete(env.DB); throw err; }));
  }
  return ready.get(env.DB);
}

// ---------- members ----------
const publicMember = (r) => r && ({ id: r.id, tenantId: r.tenant_id, name: r.name, role: r.role, twoStep: !!r.totp_on, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at });

/** A new person's key (shown once). tenantId null = staff with admin access to every business. */
export async function createMember(env, { tenantId, name, role, createdBy }) {
  await ensureTeamTables(env);
  const key = MEMBER_KEY_PREFIX + b64u(crypto.getRandomValues(new Uint8Array(32)));
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO team_members (id, tenant_id, name, role, key_hash, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, tenantId || null, name, role, await sha256Hex(key), now(), createdBy || null).run();
  return { key, member: publicMember(await env.DB.prepare('SELECT * FROM team_members WHERE id = ?').bind(id).first()) };
}
export async function listMembers(env, tenantId) {
  await ensureTeamTables(env);
  const { results } = await env.DB.prepare('SELECT * FROM team_members WHERE tenant_id IS ? ORDER BY revoked_at IS NOT NULL, created_at').bind(tenantId || null).all();
  return results.map(publicMember);
}
export async function getMember(env, id) {
  await ensureTeamTables(env);
  return env.DB.prepare('SELECT * FROM team_members WHERE id = ?').bind(id).first();
}
export async function memberByKey(env, key) {
  await ensureTeamTables(env);
  const r = await env.DB.prepare('SELECT * FROM team_members WHERE key_hash = ? AND revoked_at IS NULL').bind(await sha256Hex(key)).first();
  if (r && (!r.last_used_at || Date.now() - new Date(r.last_used_at).getTime() > 10 * 60000)) {
    await env.DB.prepare('UPDATE team_members SET last_used_at = ? WHERE id = ?').bind(now(), r.id).run().catch(() => {});
  }
  return r;
}
export async function revokeMember(env, id) {
  await env.DB.prepare('UPDATE team_members SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now(), id).run();
}
/** The auth object a member's key or session gives. */
export const memberAuth = (m, tenantName = null) => (m.tenant_id
  ? { role: 'tenant', tenantId: m.tenant_id, businessName: tenantName, memberId: m.id, memberName: m.name, memberRole: m.role, twoStep: !!m.totp_on }
  : { role: 'admin', memberId: m.id, memberName: m.name, memberRole: 'owner', twoStep: !!m.totp_on });

// ---------- 2-step sign-in (TOTP: 6 digits, 30 s, SHA-1 — what Google/Microsoft Authenticator use) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const toB32 = (bytes) => { let bits = ''; for (const b of bytes) bits += b.toString(2).padStart(8, '0'); let out = ''; for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; };
const fromB32 = (s) => { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return new Uint8Array(out); };
export async function totpCode(secretB32, at = Date.now(), step = 30) {
  const counter = Math.floor(at / 1000 / step);
  const msg = new Uint8Array(8); let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
  const key = await crypto.subtle.importKey('raw', fromB32(secretB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}
/** Accepts the code of this 30-second window or the one before/after (phone clocks drift). */
export async function totpOk(secretB32, code, at = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return false;
  for (const d of [-1, 0, 1]) if (await totpCode(secretB32, at + d * 30000) === c) return true;
  return false;
}
const secretKey = (env) => env.TOKEN_ENCRYPTION_KEY;
/** Starts 2-step setup: a new secret (kept until confirmed) and the link authenticator apps understand. */
export async function startTwoStep(env, member, issuer = 'Bluxury WhatsApp AI') {
  const secret = toB32(crypto.getRandomValues(new Uint8Array(20)));
  await env.DB.prepare('UPDATE team_members SET totp_pending_enc = ? WHERE id = ?').bind(await encryptToken(secretKey(env), secret), member.id).run();
  const label = encodeURIComponent(`${issuer}:${member.name}`);
  return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30` };
}
export async function confirmTwoStep(env, member, code) {
  if (!member.totp_pending_enc) return false;
  const secret = await decryptToken(secretKey(env), member.totp_pending_enc);
  if (!(await totpOk(secret, code))) return false;
  await env.DB.prepare('UPDATE team_members SET totp_enc = totp_pending_enc, totp_pending_enc = NULL, totp_on = 1 WHERE id = ?').bind(member.id).run();
  return true;
}
export async function checkTwoStep(env, member, code) {
  if (!member.totp_on || !member.totp_enc) return true;
  return totpOk(await decryptToken(secretKey(env), member.totp_enc), code);
}
export async function disableTwoStep(env, member) {
  await env.DB.prepare('UPDATE team_members SET totp_enc = NULL, totp_pending_enc = NULL, totp_on = 0 WHERE id = ?').bind(member.id).run();
}

// ---------- sessions (signed; a key is typed once, then the dashboard uses the session) ----------
async function sessionKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`session:${env.TOKEN_ENCRYPTION_KEY || env.ADMIN_API_KEY}`));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
/** auth → "bxs_<payload>.<signature>", valid for `hours`. */
export async function signSession(env, auth, hours = 12) {
  const body = b64u(enc.encode(JSON.stringify({ a: auth, e: Math.floor(Date.now() / 1000) + hours * 3600 })));
  const sig = b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(env), enc.encode(body))));
  return `${SESSION_PREFIX}${body}.${sig}`;
}
export async function verifySession(env, token) {
  try {
    const [body, sig] = token.slice(SESSION_PREFIX.length).split('.');
    if (!body || !sig || !(await crypto.subtle.verify('HMAC', await sessionKey(env), fromB64u(sig), enc.encode(body)))) return null;
    const { a, e } = JSON.parse(dec.decode(fromB64u(body)));
    if (e < Math.floor(Date.now() / 1000)) return null;
    if (a.memberId) { // a revoked person's sessions stop working at once
      const m = await getMember(env, a.memberId);
      if (!m || m.revoked_at) return null;
    }
    return a;
  } catch { return null; }
}

// ---------- activity log ----------
export const actorOf = (auth) => auth?.memberName || (auth?.role === 'admin' ? 'Admin key' : 'Business key');
export async function audit(env, auth, action, detail = '', tenantId = null) {
  try {
    await ensureTeamTables(env);
    await env.DB.prepare('INSERT INTO audit_log (tenant_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?)')
      .bind(tenantId || auth?.tenantId || null, actorOf(auth), action, String(detail || '').slice(0, 300), now()).run();
  } catch { /* the log must never block the action */ }
}
export async function recentActivity(env, tenantId, limit = 100) {
  await ensureTeamTables(env);
  const { results } = await env.DB.prepare('SELECT actor, action, detail, at FROM audit_log WHERE tenant_id IS ? ORDER BY id DESC LIMIT ?').bind(tenantId || null, limit).all();
  return results;
}

/** "POST /api/chats/<tid>/<phone>/messages" → "Sent a message to +91…1234" (what the activity log shows). */
export function describeAction(method, path) {
  const p = path.replace(/^\/api\//, '');
  const phone = (x) => (x ? `+${String(x).slice(0, 4)}…${String(x).slice(-4)}` : '');
  const parts = p.split('/');
  const map = [
    [/^chats\/[^/]+\/([^/]+)\/messages$/, (m) => `Sent a message to ${phone(m[1])}`],
    [/^chats\/[^/]+\/([^/]+)$/, (m) => (method === 'DELETE' ? `Deleted the data of ${phone(m[1])}` : `Changed the bot / language for ${phone(m[1])}`)],
    [/^tenants\/[^/]+\/translate$/, () => 'Generated Telugu wording'],
    [/^tenants\/[^/]+\/rotate-key$/, () => 'Changed the business key'],
    [/^tenants\/[^/]+\/apply-template$/, () => 'Applied a flow template'],
    [/^tenants\/[^/]+$/, () => 'Changed settings (flow / profile / AI)'],
    [/^tenants$/, () => 'Added a business'],
    [/^catalog\//, () => (method === 'DELETE' ? 'Deleted a product' : 'Changed products')],
    [/^leads\/[^/]+\/upload$/, () => 'Sent a broadcast'],
    [/^uploads\//, () => 'Uploaded a file'],
    [/^team\//, () => (method === 'DELETE' ? 'Removed a team member' : 'Added a team member')],
  ];
  for (const [re, f] of map) { const m = p.match(re); if (m) return f(m); }
  return `${method} ${parts.slice(0, 2).join('/')}`;
}
/** Agents may use the inbox (reply, bot on/off, language, read) and their own sign-in; everything else is for owners. */
export function agentMayDo(method, path) {
  if (method === 'GET') return !/^\/api\/team\//.test(path);
  return /^\/api\/chats\/[^/]+\/[^/]+\/(messages|read)$/.test(path)
    || (method === 'PATCH' && /^\/api\/chats\/[^/]+\/[^/]+$/.test(path))
    || /^\/api\/(ws-ticket|push)\//.test(path) || /^\/api\/me\//.test(path);
}
