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

// Everyday words customers use, so Whisper spells Telugu properly (it is only a spelling hint, never added to the text).
const WORD_HINTS = {
  te: 'నమస్కారం. రేపు, ఈరోజు, ఎల్లుండి, శనివారం, ఆదివారం, ఉదయం, సాయంత్రం, గంటలకి, సైట్ విజిట్, బుక్ చేయండి, షెడ్యూల్, ప్రాజెక్ట్, ఫ్లాట్, విల్లా, ప్లాట్, 2 BHK, 3 BHK, ధర ఎంత, లొకేషన్, అడ్రస్, ఆఫర్, లోన్, అందుబాటులో ఉందా, చేయగలరా, కావాలి.',
};
const CLEANUP_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// How Whisper typically misspells everyday Telugu, so the clean-up reads the right word (and the right time).
const CLEANUP_HINTS = {
  te: 'Common mis-hearings: రేప / ప్రేప / ప్రా / రేప్ = రేపు (tomorrow); ఈరోజ / ఇరోజు = ఈరోజు (today); ఎల్లుండ = ఎల్లుండి (day after tomorrow); '
    + 'గాన్టలకి / గాన్ట్ లకీ / గండ్లక / గాంటలకు / గాంట్ లోకే = గంటలకి (at … o\'clock); శెడ్యల్ / శెడ్డ్యుల = షెడ్యూల్ (schedule); '
    + 'Number words: ఒకటి 1, రెండు 2, మూడు / మూరు / మూడ / మోడ 3, నాలుగు 4, ఐదు 5, ఆరు 6, ఏడు 7, ఎనిమిది 8, తొమ్మిది 9, పది 10, పదకొండు 11, పన్నెండు 12. '
    + 'A number before గంటలకి is the hour (e.g. రేపు మూడు గంటలకి = tomorrow at 3 o\'clock). Never read a word as a person\'s name unless it clearly is one.',
};
/** Workers AI call with one retry (it sometimes answers 8004 "internal server error"). */
const withLimit = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`no answer in ${ms / 1000} s`)), ms))]);
const runAi = async (env, model, input) => {
  try { return await withLimit(env.AI.run(model, input), 25000); } catch (err) {
    if (/no answer/.test(err.message)) throw err; // slow, not broken: don't make the customer wait twice
    await new Promise((r) => setTimeout(r, 600));
    return withLimit(env.AI.run(model, input), 25000);
  }
};
const UNCLEAR_LOGPROB = -0.7; // Whisper's own confidence: clear speech ≈ -0.2, garbled ≈ -1.0 or worse

/** Duration-weighted average confidence of Whisper's segments (null when it gives none). */
function confidence(r) {
  const segs = (r?.segments || []).filter((g) => Number.isFinite(Number(g.avg_logprob)));
  if (!segs.length) return null;
  const w = (g) => Math.max(0.1, Number(g.end) - Number(g.start) || 0.1);
  return segs.reduce((s, g) => s + Number(g.avg_logprob) * w(g), 0) / segs.reduce((s, g) => s + w(g), 0);
}

/** Fixes the speech engine's spelling and adds the English meaning: "రేపు మూడు గంటలకు…\n(English: …)". */
async function cleanUp(env, text, voiceLanguage, context) {
  const lang = { te: 'Telugu', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', gu: 'Gujarati', bn: 'Bengali', pa: 'Punjabi', or: 'Odia', ur: 'Urdu' }[voiceLanguage] || 'Indian-language';
  try {
    const r = await runAi(env, CLEANUP_MODEL, { max_tokens: 250, temperature: 0.1, messages: [
      { role: 'system', content: `You fix speech-recognition spelling mistakes. The text is an automatic transcript of a short ${lang} (maybe mixed with English) WhatsApp voice note from a customer${context ? ` to ${context}` : ''}. Write what the customer said in correct ${lang} script, keeping their meaning exactly (do not add anything they did not say), then on a new line "English: " and the meaning in English. If the text is too garbled to be sure, answer exactly UNCLEAR.${CLEANUP_HINTS[voiceLanguage] ? `\n${CLEANUP_HINTS[voiceLanguage]}` : ''}` },
      { role: 'user', content: text },
    ] });
    const out = String(r?.response || '').trim();
    if (/^UNCLEAR\b/i.test(out)) return { unclear: true };
    const m = /^([\s\S]*?)\s*\|?\s*\n?\s*English\s*:\s*([\s\S]+)$/i.exec(out);
    if (!m || !m[1].trim() || !m[2].trim()) return null;
    return { text: `${m[1].trim()}\n(English: ${m[2].trim().replace(/\s+/g, ' ')})`.slice(0, 2000) };
  } catch (err) { console.warn('[Media] clean-up failed:', err.message); return null; }
}

/**
 * Voice note → { transcript } or { unclear: true }. All on Cloudflare's free Workers AI.
 * 1) Whisper listens with no hint; clear English or Hindi is kept as heard.
 * 2) Otherwise it listens again in the business's customer language (default Telugu), with silence removed and
 *    a list of everyday words as a spelling hint (Indian languages sound alike to Whisper: Telugu came back as
 *    Tamil, Gujarati, even Tibetan text).
 * 3) Whisper's own confidence decides: garbled → unclear (the bot asks them to type or resend — it never guesses);
 *    clear → the AI fixes the spelling and adds the English meaning, which the bot and the team can read.
 */
async function transcribe(env, bytes, voiceLanguage = 'te', context = '', customerLanguage = null) {
  if (!env.AI || bytes.byteLength > MAX_TRANSCRIBE_BYTES) return { transcript: '' };
  let b64 = ''; const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) b64 += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  const audio = btoa(b64);
  const clean = (r) => String(r?.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  const first = await runAi(env, WHISPER, { audio, task: 'transcribe', vad_filter: true });
  const lang = first?.transcription_info?.language; const sure = Number(first?.transcription_info?.language_probability ?? 1);
  // A customer we know speaks the local language: Hindi is never kept (Telugu came out in Hindi letters), English only when very clear.
  const local = customerLanguage && customerLanguage === voiceLanguage;
  const keepAsHeard = local ? lang === 'en' && sure >= 0.85 : (lang === 'en' || lang === 'hi') && sure >= 0.6;
  if (!voiceLanguage || voiceLanguage === 'auto' || keepAsHeard || ['en', 'hi'].includes(voiceLanguage)) {
    const c = confidence(first);
    return c != null && c < UNCLEAR_LOGPROB ? { unclear: true } : { transcript: clean(first) };
  }
  const again = await runAi(env, WHISPER, { audio, task: 'transcribe', language: voiceLanguage, vad_filter: true, ...(WORD_HINTS[voiceLanguage] ? { initial_prompt: WORD_HINTS[voiceLanguage] } : {}) }).catch(() => null);
  const text = clean(again); const c = confidence(again);
  console.log(`[Media] voice note heard as "${lang}" (${sure.toFixed(2)}), transcribed as "${voiceLanguage}", confidence ${c == null ? '?' : c.toFixed(2)}`);
  if (!text || (c != null && c < UNCLEAR_LOGPROB)) return { unclear: true };
  const fixed = await cleanUp(env, text, voiceLanguage, context);
  if (fixed?.unclear) return { unclear: true };
  return { transcript: fixed?.text || text };
}

/**
 * Copies one inbound media message to R2 (and transcribes voice notes).
 * Returns { key, mime, size, filename, transcript } or null. Never throws: a failure just means the
 * Inbox shows "could not load" for that file.
 */
export async function saveInboundMedia(env, { tenantId, accessToken, message, voiceLanguage, context, customerLanguage }) {
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
      // If the speech engine fails or is too slow, treat it as unclear: the customer is asked to type or resend.
      const heard = await transcribe(env, bytes, voiceLanguage, context, customerLanguage).catch((err) => { console.warn('[Media] transcription failed:', err.message); return { unclear: true }; });
      transcript = heard.transcript || '';
      if (heard.unclear) return { key, mime, size: bytes.byteLength, filename: m.filename || null, transcript: '', unclear: true };
    }
    return { key, mime, size: bytes.byteLength, filename: m.filename || null, transcript };
  } catch (err) {
    console.warn(`[Media] could not save ${t} ${m.id}:`, err.message);
    return null;
  }
}
