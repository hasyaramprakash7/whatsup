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

/** The test notification (closed = sent by "Test with the app closed"). */
export const testPushPayload = (closed) => ({
  kind: 'message', title: 'Bluxury WhatsApp AI',
  body: closed ? 'It works! Alerts reach this phone even when the app is closed.' : 'Test message: customer messages will appear like this, at the top of your screen.',
  url: '/#/inbox/0', tag: 'test', at: Date.now(), ...(closed ? { test: true } : {}),
});

// ---------- subscriptions (D1) ----------
// Same as migrations/0006_push.sql; created on first use so notifications work even before the migration runs.
let tableReady = null;
const ensureTable = (env) => (tableReady ||= env.DB.batch([
  env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, scope TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
    prefs TEXT NOT NULL DEFAULT '{}', user_agent TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, fail_count INTEGER NOT NULL DEFAULT 0)`),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS push_subscriptions_scope ON push_subscriptions (scope)'),
]).then(async () => {
  // Delivery tracking (migrations/0008_push_health.sql); added here too so it works before the migration runs.
  for (const col of ['pending_at INTEGER', 'ack_at INTEGER', "health TEXT", 'health_delay_ms INTEGER', 'health_at INTEGER', 'slow_count INTEGER NOT NULL DEFAULT 0']) {
    await env.DB.prepare(`ALTER TABLE push_subscriptions ADD COLUMN ${col}`).run().catch(() => {}); // already there
  }
}).catch((err) => { tableReady = null; throw err; }));
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

// ---------- delivery health: did alerts really reach this phone while the app was closed? ----------
// Every alert carries its send time; the phone's background script reports back the moment it arrives.
// A phone that blocks the app in the background gets them only when the app is opened → arrives minutes late.
export const SLOW_MS = 30 * 1000; // a normal alert arrives in under 5 s; held-back ones arrive when the app is opened
const outstanding = (r) => r.pending_at != null; // cleared when that alert (or a newer one) arrives

/** Remembers the oldest alert this device hasn't confirmed yet. */
export async function markSent(env, endpoint, at) {
  await env.DB.prepare('UPDATE push_subscriptions SET pending_at = ? WHERE endpoint = ? AND pending_at IS NULL')
    .bind(at, endpoint).run().catch(() => {});
}

/** The phone confirmed an alert arrived. awake = the app was open on screen at that moment. */
export async function recordAck(env, endpoint, { sentAt, awake, test }) {
  await ensureTable(env);
  const row = await getSubscription(env, endpoint);
  if (!row) return false;
  const now = Date.now();
  const resolves = outstanding(row) && sentAt >= row.pending_at - 1000;
  const wait = Math.max(0, now - (resolves ? row.pending_at : sentAt));
  const sets = []; const vals = [];
  if (resolves) { sets.push('ack_at = ?', 'pending_at = NULL'); vals.push(now); }
  if (wait > SLOW_MS) {
    // Held back. Two separate times (or once in the closed-app test) = this phone blocks alerts, not just a moment offline.
    sets.push("health = 'slow'", 'health_delay_ms = ?', 'health_at = ?', test ? 'slow_count = MAX(slow_count + 1, 2)' : (resolves ? 'slow_count = slow_count + 1' : 'slow_count = slow_count'));
    vals.push(wait, now);
  } else if (!awake) {
    // Arrived on time with the app closed: proof this phone works.
    sets.push("health = 'ok'", 'health_delay_ms = ?', 'health_at = ?', 'slow_count = 0');
    vals.push(wait, now);
  }
  if (sets.length) await env.DB.prepare(`UPDATE push_subscriptions SET ${sets.join(', ')} WHERE endpoint = ?`).bind(...vals, endpoint).run();
  return true;
}

/** ok | late (once) | blocked (repeatedly late) | waiting (an alert hasn't arrived yet) | unknown (nothing to judge yet) */
export function deliveryHealth(row, now = Date.now()) {
  if (!row) return { state: 'unknown' };
  if (outstanding(row) && now - row.pending_at > SLOW_MS) return { state: 'waiting', delayMs: now - row.pending_at, at: row.pending_at };
  if (row.health === 'slow') return { state: row.slow_count >= 2 ? 'blocked' : 'late', delayMs: row.health_delay_ms, at: row.health_at };
  if (row.health === 'ok') return { state: 'ok', delayMs: row.health_delay_ms, at: row.health_at };
  return { state: 'unknown' };
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
        const r = await sendPush(env, s, payload, { urgency: kind === 'broadcast' ? 'normal' : 'high' }); // no Topic: Android drops collapsed ones; the tag already replaces old ones on the phone
        if (r.ok) { sent++; console.log(`[Push] ${kind} delivered to a device`); if (kind !== 'broadcast') await markSent(env, s.endpoint, payload.at); return; }
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
