// Customer media (photos, voice notes, videos, documents, stickers) from WhatsApp.
// Meta only keeps a download link for a short time, so each file is copied to R2 when it arrives
// and the dashboard reads it through the authenticated /api/media route.
// Voice notes are also turned into text (Workers AI Whisper) so the bot and AI can answer them.

export const MEDIA_TYPES = ['image', 'audio', 'voice', 'video', 'document', 'sticker'];
const MAX_BYTES = 25 * 1024 * 1024; // WhatsApp's own limit for audio/video is 16 MB, documents 100 MB
const MAX_TRANSCRIBE_BYTES = 10 * 1024 * 1024;
const WHISPER = '@cf/openai/whisper-large-v3-turbo';

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/opus': 'opus',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf',
};
const extOf = (mime, filename) => EXT[String(mime).split(';')[0].trim()] || (/\.([a-z0-9]{1,6})$/i.exec(filename || '')?.[1] || 'bin').toLowerCase();

/** R2 key for one inbound file: inbound/<tenantId>/<random>.<ext> (the random part keeps it unguessable). */
const keyFor = (tenantId, mime, filename) => `inbound/${tenantId}/${crypto.randomUUID().replace(/-/g, '')}.${extOf(mime, filename)}`;
export const MEDIA_FILE = /^[a-f0-9]{32}\.[a-z0-9]{1,6}$/;

async function graphJson(env, accessToken, path) {
  const base = String(env.GRAPH_BASE_URL || 'https://graph.facebook.com').replace(/\/$/, '');
  const res = await fetch(`${base}/${env.GRAPH_API_VERSION || 'v25.0'}/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data;
}

/**
 * Plain text from Whisper's answer, or '' when it heard nothing.
 * Indian languages sound alike to Whisper: Telugu speech often comes back as Tamil or Gujarati text.
 * So: listen once with no hint; if it hears English, Hindi or the business's own customer language, keep it.
 * Anything else (or a shaky guess) is heard again as the customer language (default Telugu).
 */
async function transcribe(env, bytes, voiceLanguage = 'te') {
  if (!env.AI || bytes.byteLength > MAX_TRANSCRIBE_BYTES) return '';
  let b64 = ''; const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) b64 += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  const audio = btoa(b64);
  const clean = (r) => String(r?.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  const first = await env.AI.run(WHISPER, { audio, task: 'transcribe' });
  const lang = first?.transcription_info?.language; const sure = Number(first?.transcription_info?.language_probability ?? 1);
  if (!voiceLanguage || voiceLanguage === 'auto' || !lang || lang === voiceLanguage || ((lang === 'en' || lang === 'hi') && sure >= 0.6)) return clean(first);
  const again = await env.AI.run(WHISPER, { audio, task: 'transcribe', language: voiceLanguage }).catch(() => null);
  console.log(`[Media] voice note heard as "${lang}" (${sure.toFixed(2)}), transcribed again as "${voiceLanguage}"`);
  return clean(again) || clean(first);
}

/**
 * Copies one inbound media message to R2 (and transcribes voice notes).
 * Returns { key, mime, size, filename, transcript } or null. Never throws: a failure just means the
 * Inbox shows "could not load" for that file.
 */
export async function saveInboundMedia(env, { tenantId, accessToken, message, voiceLanguage }) {
  const t = message?.type;
  const m = message?.[t];
  if (!MEDIA_TYPES.includes(t) || !m?.id || !env.MEDIA) return null;
  try {
    const info = await graphJson(env, accessToken, m.id);
    if (Number(info.file_size) > MAX_BYTES) return { tooLarge: true, mime: info.mime_type, size: Number(info.file_size) };
    const res = await fetch(info.url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const bytes = await res.arrayBuffer();
    const mime = String(info.mime_type || m.mime_type || res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    const key = keyFor(tenantId, mime, m.filename);
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime, cacheControl: 'private, max-age=31536000, immutable' } });
    let transcript = '';
    if (t === 'audio' || t === 'voice') {
      transcript = await transcribe(env, bytes, voiceLanguage).catch((err) => { console.warn('[Media] transcription failed:', err.message); return ''; });
    }
    return { key, mime, size: bytes.byteLength, filename: m.filename || null, transcript };
  } catch (err) {
    console.warn(`[Media] could not save ${t} ${m.id}:`, err.message);
    return null;
  }
}
