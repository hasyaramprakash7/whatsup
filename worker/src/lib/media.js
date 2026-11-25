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

// Google Speech-to-Text knows Indian languages far better than Whisper (Telugu especially).
// Used only when Whisper isn't sure, so the free monthly minutes last. Needs the GOOGLE_SPEECH_KEY secret.
const GOOGLE_STT = 'https://speech.googleapis.com/v1p1beta1/speech:recognize';
const GOOGLE_RATES = [8000, 12000, 16000, 24000, 48000];
const GOOGLE_MAX_BYTES = 9 * 1024 * 1024; // sync requests: up to 1 minute of audio, 10 MB

/** Sample rate from an Ogg Opus header (WhatsApp voice notes: 48 kHz mono); Google needs it exactly. */
function opusRate(u8) {
  const tag = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]; // "OpusHead"
  for (let i = 0; i < Math.min(u8.length - 20, 512); i++) {
    if (tag.every((c, j) => u8[i + j] === c)) {
      const rate = u8[i + 12] | (u8[i + 13] << 8) | (u8[i + 14] << 16) | (u8[i + 15] << 24);
      return GOOGLE_RATES.includes(rate) ? rate : 48000;
    }
  }
  return null; // not Ogg Opus
}

/** Text from Google for a voice note in the customer language (with English and Hindi as alternatives), or ''. */
async function googleTranscribe(env, u8, b64, voiceLanguage) {
  if (!env.GOOGLE_SPEECH_KEY || u8.byteLength > GOOGLE_MAX_BYTES) return '';
  const rate = opusRate(u8);
  if (!rate) return '';
  const main = `${voiceLanguage}-IN`;
  const alternatives = ['en-IN', 'hi-IN'].filter((l) => l !== main);
  const res = await fetch(`${GOOGLE_STT}?key=${encodeURIComponent(env.GOOGLE_SPEECH_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: { encoding: 'OGG_OPUS', sampleRateHertz: rate, audioChannelCount: 1, languageCode: main, alternativeLanguageCodes: alternatives, enableAutomaticPunctuation: true },
      audio: { content: b64 },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google speech ${res.status}: ${data?.error?.message || 'error'}`);
  return (data.results || []).map((r) => r.alternatives?.[0]?.transcript || '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
}

/**
 * Plain text for a voice note, or '' when nothing was heard.
 * 1) Whisper (free) listens with no hint; clear English or Hindi is kept as is.
 * 2) Otherwise — Telugu, or a shaky guess (Whisper often writes Telugu as Tamil/Gujarati) — Google, in the
 *    business's customer language (default Telugu) with English and Hindi as alternatives.
 * 3) No Google key, or Google heard nothing: Whisper again, told the customer language.
 */
async function transcribe(env, bytes, voiceLanguage = 'te') {
  if (!env.AI || bytes.byteLength > MAX_TRANSCRIBE_BYTES) return '';
  const u8 = new Uint8Array(bytes); let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  const audio = btoa(bin);
  const clean = (r) => String(r?.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  const first = await env.AI.run(WHISPER, { audio, task: 'transcribe' });
  const lang = first?.transcription_info?.language; const sure = Number(first?.transcription_info?.language_probability ?? 1);
  if (!voiceLanguage || voiceLanguage === 'auto' || ((lang === 'en' || lang === 'hi') && sure >= 0.6)) return clean(first);
  if (lang === voiceLanguage && sure >= 0.9 && !env.GOOGLE_SPEECH_KEY) return clean(first);
  const target = voiceLanguage;
  try {
    const g = await googleTranscribe(env, u8, audio, target);
    if (g) { console.log(`[Media] voice note heard as "${lang}" (${sure.toFixed(2)}), transcribed by Google as ${target}-IN`); return g; }
  } catch (err) { console.warn('[Media]', err.message); }
  const again = await env.AI.run(WHISPER, { audio, task: 'transcribe', language: target }).catch(() => null);
  console.log(`[Media] voice note heard as "${lang}" (${sure.toFixed(2)}), transcribed again by Whisper as "${target}"`);
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
