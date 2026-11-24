// Web Push notifications (works with Chrome/Android, Edge, Firefox and installed iPhone apps).
// Standard VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291), using only WebCrypto.
// Keys: VAPID_PUBLIC_KEY (base64url, 65-byte uncompressed point) and VAPID_PRIVATE_KEY (base64url, 32 bytes).

const enc = new TextEncoder();
export const NOTIFY_KINDS = ['message', 'booking', 'handoff', 'broadcast'];

export const b64u = {
  encode(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export const pushConfigured = (env) => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

let signingKey = null;
async function vapidKey(env) {
  if (signingKey) return signingKey;
  const pub = b64u.decode(env.VAPID_PUBLIC_KEY);
  signingKey = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return signingKey;
}

/** Signed VAPID JWT for the push service that owns this endpoint (valid 12 hours). */
async function vapidAuth(env, endpoint) {
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.encode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:notifications@bluxurytech.com',
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Encrypts the payload for one browser subscription (RFC 8291, aes128gcm, single record). */
async function encryptPayload(sub, plaintext) {
  const uaPublic = b64u.decode(sub.p256dh);
  const authSecret = b64u.decode(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = concat(enc.encode(plaintext), new Uint8Array([2])); // 0x02 = last record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, body));

  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** Sends one notification. Returns { ok, gone } — gone means the browser unsubscribed. */
export async function sendPush(env, sub, payload, { ttl = 86400, urgency = 'high', topic } = {}) {
  const body = await encryptPayload(sub, JSON.stringify(payload));
  const headers = {
    'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm',
    TTL: String(ttl), Urgency: urgency, Authorization: await vapidAuth(env, sub.endpoint),
  };
  if (topic) headers.Topic = String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
  if (res.ok) return { ok: true };
  const text = await res.text().catch(() => '');
  return { ok: false, gone: res.status === 404 || res.status === 410, status: res.status, error: text.slice(0, 200) };
}

// ---------- subscriptions (D1) ----------
// Same as migrations/0006_push.sql; created on first use so notifications work even before the migration runs.
let tableReady = null;
const ensureTable = (env) => (tableReady ||= env.DB.batch([
  env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, scope TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
    prefs TEXT NOT NULL DEFAULT '{}', user_agent TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, fail_count INTEGER NOT NULL DEFAULT 0)`),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS push_subscriptions_scope ON push_subscriptions (scope)'),
]).catch((err) => { tableReady = null; throw err; }));
const parsePrefs = (s) => { try { return { ...JSON.parse(s || '{}') }; } catch { return {}; } };

export async function saveSubscription(env, { scope, endpoint, p256dh, auth, prefs, userAgent }) {
  await ensureTable(env);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO push_subscriptions (endpoint, scope, p256dh, auth, prefs, user_agent, created_at, updated_at, fail_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT (endpoint) DO UPDATE SET scope = excluded.scope, p256dh = excluded.p256dh, auth = excluded.auth, prefs = excluded.prefs,
      user_agent = excluded.user_agent, updated_at = excluded.updated_at, fail_count = 0`)
    .bind(endpoint, scope, p256dh, auth, JSON.stringify(prefs || {}), String(userAgent || '').slice(0, 200), now, now).run();
}
export const deleteSubscription = async (env, endpoint) => { await ensureTable(env); return env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run(); };
export async function getSubscription(env, endpoint) {
  await ensureTable(env);
  const row = await env.DB.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).first();
  return row ? { ...row, prefs: parsePrefs(row.prefs) } : null;
}

/**
 * Notifies every phone/computer that turned notifications on for this business (and admins, who see all).
 * kind: message | booking | handoff | broadcast. Never throws.
 */
export async function notifyTenant(env, tenantId, kind, { title, body, url, tag, businessName }) {
  if (!pushConfigured(env)) return 0;
  try {
    await ensureTable(env);
    const { results } = await env.DB.prepare("SELECT * FROM push_subscriptions WHERE scope = ? OR scope = '*'").bind(String(tenantId)).all();
    const subs = results.filter((s) => parsePrefs(s.prefs)[kind] !== false);
    if (!subs.length) return 0;
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      const forAdmin = s.scope === '*' && businessName;
      const payload = { kind, title: forAdmin ? `${title} · ${businessName}` : title, body, url, tag: tag || kind, tenantId: String(tenantId), at: Date.now() };
      try {
        const r = await sendPush(env, s, payload, { urgency: kind === 'broadcast' ? 'normal' : 'high', topic: tag });
        if (r.ok) { sent++; console.log(`[Push] ${kind} delivered to a device`); return; }
        if (r.gone) { console.log('[Push] a device turned notifications off; removed'); await deleteSubscription(env, s.endpoint); }
        else {
          console.warn(`[Push] ${r.status} ${r.error}`);
          await env.DB.prepare('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE endpoint = ?').bind(s.endpoint).run();
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND fail_count >= 20').bind(s.endpoint).run();
        }
      } catch (err) { console.warn('[Push] send failed:', err.message); }
    }));
    return sent;
  } catch (err) {
    console.warn('[Push] notify failed:', err.message);
    return 0;
  }
}
