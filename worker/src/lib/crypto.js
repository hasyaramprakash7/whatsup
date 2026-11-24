// Web Crypto helpers: hashing, Meta signature checks, API keys and token encryption.
const enc = new TextEncoder();
const dec = new TextDecoder();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function sha256Hex(value) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(String(value))));
}

/** Constant-time string comparison (compares fixed-length digests). */
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Verifies Meta's X-Hub-Signature-256 header against the raw request body. */
export async function verifyMetaSignature(secret, rawBody, header) {
  if (!header || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = 'sha256=' + toHex(await crypto.subtle.sign('HMAC', key, rawBody));
  return safeEqual(expected, header);
}

export const TENANT_KEY_PREFIX = 'wre_';

/** New vendor dashboard key: plaintext shown once, only the hash is stored. */
export async function generateApiKey() {
  const key = TENANT_KEY_PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)));
  return { key, hash: await sha256Hex(key) };
}

export const newId = () => crypto.randomUUID();

async function aesKey(secret) {
  if (!secret || String(secret).length < 16) throw new Error('TOKEN_ENCRYPTION_KEY is missing or shorter than 16 characters');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(String(secret)));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Encrypts a WhatsApp access token for storage in D1. Format: v1.<iv>.<ciphertext> */
export async function encryptToken(secret, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(plaintext));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function decryptToken(secret, stored) {
  const [v, iv, ct] = String(stored || '').split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('Stored access token has an unknown format');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await aesKey(secret), fromB64url(ct));
  return dec.decode(pt);
}

// ---------- live-update passes (HMAC-signed, 60 s) ----------
async function ticketKey(env) {
  const base = env.TOKEN_ENCRYPTION_KEY || env.ADMIN_API_KEY;
  if (!base) throw new Error('No signing secret configured');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`ws-ticket:${base}`));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signWsTicket(env, tenantId, ttlSec = 60) {
  const body = b64url(enc.encode(JSON.stringify({ t: String(tenantId), e: Math.floor(Date.now() / 1000) + ttlSec, n: b64url(crypto.getRandomValues(new Uint8Array(9))) })));
  const sig = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await ticketKey(env), enc.encode(body))));
  return `${body}.${sig}`;
}
export async function verifyWsTicket(env, ticket, tenantId) {
  try {
    const [body, sig] = String(ticket || '').split('.');
    if (!body || !sig) return false;
    if (!(await crypto.subtle.verify('HMAC', await ticketKey(env), fromB64urlPad(sig), enc.encode(body)))) return false;
    const { t, e } = JSON.parse(dec.decode(fromB64urlPad(body)));
    return t === String(tenantId) && e >= Math.floor(Date.now() / 1000);
  } catch { return false; }
}
const fromB64urlPad = (s) => fromB64url(s + '='.repeat((4 - (s.length % 4)) % 4));
