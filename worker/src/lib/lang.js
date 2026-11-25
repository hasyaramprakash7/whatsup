// Customer language (English / Telugu): detection from what they write, the bot's fixed texts in both languages,
// Telugu words for times, and AI translation of a business's flow (done once, when the business asks for it).
// WhatsApp never tells us a customer's language, so it is worked out from their own messages.

export const LANGS = ['en', 'te'];
export const LANG_NAMES = { en: 'English', te: 'తెలుగు' };

const TE_CHARS = /[ఀ-౿]/g;
// Telugu typed in English letters ("Tenglish"): everyday words that are not English words.
const TENGLISH = new Set(('nenu naaku naku meeru miru meeku miku manaki kavali kaavali kaavaali undi unda undha unnai unnayi ledu ledha leda ela '
  + 'elaa unnaru unnav unnava cheyandi cheyyandi chey cheyi cheyocha cheyochaa cheyyocha cheyagalara cheyagalava chestara chesthara chesthaaru '
  + 'repu eeroju eroju ivala ivvala ellundi gantalaki gantalaku gantaki gantaku gantala emaina enti endi entha enta dhara dara chupinchandi '
  + 'chupinchu pampandi pampinchandi pampinchu ravacha ravocha raavacha vasthanu vastanu vasta vachi chudali choodali chudocha chudochha '
  + 'baagundi bagundi sare saree andi garu ekkada ikkada akkada evaru inka kuda kooda ippudu tarvata taruvata illu sthalam '
  + 'namaskaram namaste namasthe dhanyavadalu thelugu telugulo matladandi cheppandi chepandi teliyadu telusu kada kadha '
  + 'okati rendu moodu mudu naalugu nalugu aidu ayidu aaru enimidi tommidi padi padakondu pannendu udayam sayantram saayantram madhyanam').split(' '));

/** Text to judge a message by: a voice note's added "(English: …)" meaning is left out. */
const forDetection = (text) => String(text || '').replace(/\(English:[^)]*\)/gi, ' ').trim();

/**
 * The language a message is clearly written in: { lang, explicit } or null when it gives no clear signal
 * ("hi", "ok", numbers, button taps keep whatever language the customer already has).
 */
export function detectLanguage(text) {
  const t = forDetection(text);
  if (!t) return null;
  const low = t.toLowerCase().replace(/[^\p{L}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (/^(telugu|తెలుగు|telugu lo|telugulo|thelugu)$/.test(low)) return { lang: 'te', explicit: true };
  if (/^(english|ఇంగ్లీష్|ఇంగ్లిష్|inglish)$/.test(low)) return { lang: 'en', explicit: true };
  const te = (t.match(TE_CHARS) || []).length;
  const latin = (t.match(/[a-z]/gi) || []).length;
  if (te >= 2 && te >= latin * 0.3) return { lang: 'te' };
  const words = low.match(/[a-z]+/g) || [];
  const hits = words.filter((w) => TENGLISH.has(w)).length;
  if (hits && (hits >= 2 || words.length <= 4 || hits / words.length >= 0.2)) return { lang: 'te' };
  if (words.length >= 3 && latin >= 8) return { lang: 'en' };
  return null;
}

// ---------- the bot's own fixed texts ----------
const TE_PROJECTS = (n) => (n === 1 ? '1 ప్రాజెక్ట్' : `${n} ప్రాజెక్ట్‌లు`);
export const UI = {
  en: {
    chooseLanguage: '🌐 Please choose your language\n🌐 దయచేసి మీ భాషను ఎంచుకోండి',
    itemGone: 'Sorry, that one is no longer available.',
    unsupported: "Sorry, we couldn't open that message 🙏 Please send it again as a text, photo, voice note or document.",
    locationPrompt: 'Tap *Send location* below, or type your pincode or area name 📍',
    locationNotFound: "Sorry, I couldn't find that place 🙏 Tap *Send location*, or type an area name or a 6-digit pincode.",
    photosBody: 'Tap below to see photos and prices 👇', photosButton: 'View photos', photosSection: 'Tap one to see it',
    listHeader: 'Choose an option', listButton: 'View options', listSection: 'Options',
    areasHeader: 'Our locations', areasButton: 'Choose area', areasSection: 'Areas',
    otherLocation: '📍 Other location', otherLocationHint: 'Share your location or type a pincode',
    projects: (n) => `${n} ${n === 1 ? 'project' : 'projects'}`,
    away: (km) => `${km} away`,
    visitNoun: (visit) => (visit ? 'site visit' : 'booking'),
    timeWorks: (when, visit) => `Yes, *${when}* works 👍\nTap below to confirm your ${visit ? 'site visit' : 'booking'}, or choose another time:`,
    outsideHours: (from, to, visit) => `We arrange ${visit ? 'site visits' : 'bookings'} between ${from} and ${to}.`,
    tooSoon: 'That time is a little too soon for us to arrange.',
    tooFar: 'We can book up to 60 days ahead.',
    pickTimes: 'Please pick one of these times, or type another day and time 👇',
    offerVisit: (name, visit) => `Would you like to ${visit ? 'visit' : 'book'} *${name}*? 🏡 Pick a time below, or type the day and time you prefer:`,
    askWhen: (name, visit) => `Sure! When would you like to ${visit ? 'visit' : 'book'}${name ? ` *${name}*` : ''}? Pick a time below, or type the day and time you prefer 👇`,
    voiceUnclear: "Sorry, I couldn't hear that voice note clearly 🙏 Could you please type it, or send it again speaking a little slowly?",
    voiceUnclearAgain: "Sorry, I still couldn't hear that clearly 🙏 Please type your message — I'll reply right away.",
    voiceRetry: "Sorry, I couldn't catch that voice note clearly 🙏 Could you please type it, or send the voice note again speaking a little slowly?",
    chooseBelow: 'Please choose below 👇',
    timeNoted: "Sure! 👍 I've noted your preferred time — I'll confirm it with you in a moment. First, please answer this:",
  },
  te: {
    chooseLanguage: '🌐 Please choose your language\n🌐 దయచేసి మీ భాషను ఎంచుకోండి',
    itemGone: 'క్షమించండి, అది ఇప్పుడు అందుబాటులో లేదు.',
    unsupported: 'క్షమించండి, ఆ మెసేజ్ తెరవలేకపోయాం 🙏 దయచేసి టెక్స్ట్, ఫోటో, వాయిస్ నోట్ లేదా డాక్యుమెంట్‌గా మళ్ళీ పంపండి.',
    locationPrompt: 'కింద *Send location* నొక్కండి, లేదా మీ పిన్‌కోడ్ / ప్రాంతం పేరు టైప్ చేయండి 📍',
    locationNotFound: 'క్షమించండి, ఆ ప్రాంతం దొరకలేదు 🙏 *Send location* నొక్కండి, లేదా ప్రాంతం పేరు / 6 అంకెల పిన్‌కోడ్ టైప్ చేయండి.',
    photosBody: 'ఫోటోలు, ధరలు చూడటానికి కింద నొక్కండి 👇', photosButton: 'ఫోటోలు చూడండి', photosSection: 'ఒకటి ఎంచుకోండి',
    listHeader: 'ఒకటి ఎంచుకోండి', listButton: 'ఆప్షన్లు చూడండి', listSection: 'ఆప్షన్లు',
    areasHeader: 'మా ప్రాంతాలు', areasButton: 'ప్రాంతం ఎంచుకోండి', areasSection: 'ప్రాంతాలు',
    otherLocation: '📍 ఇతర ప్రాంతం', otherLocationHint: 'లొకేషన్ పంపండి లేదా పిన్‌కోడ్ టైప్ చేయండి',
    projects: TE_PROJECTS,
    away: (km) => `${km} దూరం`,
    visitNoun: (visit) => (visit ? 'సైట్ విజిట్' : 'బుకింగ్'),
    timeWorks: (when, visit) => `అవును, *${when}* సరిపోతుంది 👍\nమీ ${visit ? 'సైట్ విజిట్' : 'బుకింగ్'} కన్ఫర్మ్ చేయడానికి కింద నొక్కండి, లేదా వేరే సమయం ఎంచుకోండి:`,
    outsideHours: (from, to, visit) => `మేము ${visit ? 'సైట్ విజిట్‌లు' : 'బుకింగ్‌లు'} ${from} నుండి ${to} వరకు మాత్రమే ఏర్పాటు చేస్తాం.`,
    tooSoon: 'ఆ సమయం ఏర్పాటు చేయడానికి కొంచెం దగ్గరగా ఉంది.',
    tooFar: 'మేము 60 రోజుల ముందు వరకు మాత్రమే బుక్ చేయగలం.',
    pickTimes: 'దయచేసి ఈ సమయాల్లో ఒకటి ఎంచుకోండి, లేదా వేరే రోజు, సమయం టైప్ చేయండి 👇',
    offerVisit: (name, visit) => `*${name}* ${visit ? 'చూడటానికి రావాలనుకుంటున్నారా' : 'బుక్ చేయాలనుకుంటున్నారా'}? 🏡 కింద ఒక సమయం ఎంచుకోండి, లేదా మీకు నచ్చిన రోజు, సమయం టైప్ చేయండి:`,
    askWhen: (name, visit) => `తప్పకుండా! ${name ? `*${name}* ` : ''}${visit ? 'చూడటానికి ఎప్పుడు రావాలనుకుంటున్నారు' : 'ఎప్పుడు బుక్ చేయాలి'}? కింద ఒక సమయం ఎంచుకోండి, లేదా మీకు నచ్చిన రోజు, సమయం టైప్ చేయండి 👇`,
    voiceUnclear: 'క్షమించండి, ఆ వాయిస్ నోట్ స్పష్టంగా వినిపించలేదు 🙏 దయచేసి టైప్ చేయండి, లేదా కొంచెం నెమ్మదిగా మాట్లాడి మళ్ళీ పంపండి.',
    voiceUnclearAgain: 'క్షమించండి, ఇంకా స్పష్టంగా వినిపించలేదు 🙏 దయచేసి మీ మెసేజ్ టైప్ చేయండి — వెంటనే జవాబిస్తాం.',
    voiceRetry: 'క్షమించండి, ఆ వాయిస్ నోట్ స్పష్టంగా వినిపించలేదు 🙏 దయచేసి టైప్ చేయండి, లేదా కొంచెం నెమ్మదిగా మాట్లాడి మళ్ళీ పంపండి.',
    chooseBelow: 'దయచేసి కింద ఎంచుకోండి 👇',
    timeNoted: 'తప్పకుండా! 👍 మీకు నచ్చిన సమయం నోట్ చేసుకున్నాం — కొంచెం సేపట్లో కన్ఫర్మ్ చేస్తాం. ముందుగా దీనికి జవాబు ఇవ్వండి:',
  },
};
export const ui = (lang) => UI[lang] || UI.en;

/** Telugu versions of the standard bot messages (used when a business hasn't translated its own). */
export const DEFAULT_MESSAGES_TE = {
  completed: 'ధన్యవాదాలు {name}! *{business}* టీమ్ దగ్గర మీ వివరాలు ఉన్నాయి, త్వరలో మిమ్మల్ని సంప్రదిస్తాం. అత్యవసరమైతే +{adminPhone} కి కాల్ చేయండి.',
  optOut: 'సరే. ఇకపై {business} నుండి మీకు మెసేజ్‌లు రావు. మంచి రోజు గడపండి! 🙏',
  nudge: 'త్వరగా సహాయం చేయడానికి దయచేసి కింద ఉన్న ఆప్షన్లలో ఒకటి నొక్కండి 👇',
  invalidInput: 'క్షమించండి, అది సరిగ్గా లేదు. దయచేసి మళ్ళీ ప్రయత్నించండి.',
  handoff: 'సరే! *{business}* నుండి ఎవరైనా త్వరలో మిమ్మల్ని సంప్రదిస్తారు. +{adminPhone} కి కూడా కాల్ చేయవచ్చు.',
  slotPassed: 'ఆ సమయం ఇప్పటికే అయిపోయింది. తర్వాత అందుబాటులో ఉన్న సమయాలు ఇవి:',
  error: 'చిన్న సమస్య వచ్చింది. మళ్ళీ మొదలుపెట్టడానికి *Hi* అని పంపండి, లేదా మా టీమ్ త్వరలో సంప్రదిస్తుంది.',
};

// ---------- Telugu / Tenglish words for days and times → English, so the time reader understands them ----------
const TE_TIME_WORDS = [
  ['ఎల్లుండి', ' day after tomorrow '], ['రేపు', ' tomorrow '], ['ఈరోజు', ' today '], ['ఈ రోజు', ' today '], ['ఇవాళ', ' today '], ['ఈ రోజే', ' today '],
  ['ఆదివారం', ' sunday '], ['సోమవారం', ' monday '], ['మంగళవారం', ' tuesday '], ['బుధవారం', ' wednesday '], ['గురువారం', ' thursday '], ['శుక్రవారం', ' friday '], ['శనివారం', ' saturday '],
  ['గంటలకి', " o'clock "], ['గంటలకు', " o'clock "], ['గంటకి', " o'clock "], ['గంటకు', " o'clock "], ['గంటల', " o'clock "],
  ['ఉదయం', ' morning '], ['పొద్దున', ' morning '], ['మధ్యాహ్నం', ' afternoon '], ['సాయంత్రం', ' evening '],
  ['పన్నెండు', ' 12 '], ['పదకొండు', ' 11 '], ['తొమ్మిది', ' 9 '], ['ఎనిమిది', ' 8 '], ['ఒకటి', ' 1 '], ['రెండు', ' 2 '], ['మూడు', ' 3 '], ['నాలుగు', ' 4 '], ['ఐదు', ' 5 '], ['ఆరు', ' 6 '], ['ఏడు', ' 7 '], ['పది', ' 10 '],
];
const TENGLISH_TIME_WORDS = [
  [/\bellundi\b/g, 'day after tomorrow'], [/\brepu\b/g, 'tomorrow'], [/\b(eeroju|eroju|ivala|ivvala|ee roju)\b/g, 'today'],
  [/\b(gantalaki|gantalaku|gantaki|gantaku|gantala)\b/g, "o'clock"], [/\b(udayam|poddhuna|podduna)\b/g, 'morning'], [/\b(madhyanam|madhyahnam)\b/g, 'afternoon'], [/\b(sayantram|saayantram|sayantaram)\b/g, 'evening'],
  [/\bpannendu\b/g, '12'], [/\bpadakondu\b/g, '11'], [/\btommidi\b/g, '9'], [/\b(enimidi|enmidi)\b/g, '8'], [/\bokati\b/g, '1'], [/\brendu\b/g, '2'], [/\b(moodu|mudu|muudu)\b/g, '3'],
  [/\b(naalugu|nalugu)\b/g, '4'], [/\b(aidu|ayidu)\b/g, '5'], [/\baaru\b/g, '6'], [/\b(edu|yedu)\b/g, '7'], [/\bpadi\b/g, '10'],
];
/** "రేపు మూడు గంటలకి" / "repu moodu gantalaki" → " tomorrow  3  o'clock " (English text is left as it is). */
export function timeWordsToEnglish(text) {
  let s = String(text || '');
  for (const [te, en] of TE_TIME_WORDS) s = s.split(te).join(en);
  s = s.toLowerCase();
  for (const [re, en] of TENGLISH_TIME_WORDS) s = s.replace(re, en);
  return s;
}

// ---------- flow translation (AI, once; the business can edit the result) ----------
/** Every customer-facing text in a flow, keyed so the translation can be put back: "s.<step>.text", "o.<step>.<option>.title", "m.<key>". */
export function flowStrings(flow) {
  const out = {};
  for (const s of flow?.steps || []) {
    if (s.text) out[`s.${s.id}.text`] = s.text;
    if (s.type === 'choice') {
      for (const k of ['listHeader', 'listButton', 'listSection']) if (s[k]) out[`s.${s.id}.${k}`] = s[k];
      for (const o of s.options || []) {
        if (o.title) out[`o.${s.id}.${o.id}.title`] = o.title;
        if (o.description) out[`o.${s.id}.${o.id}.description`] = o.description;
      }
    }
  }
  for (const [k, v] of Object.entries(flow?.messages || {})) if (v) out[`m.${k}`] = v;
  return out;
}

/** Limits WhatsApp puts on each kind of text (characters). */
export function stringLimit(key, flow) {
  const [kind, stepId, b, c] = key.split('.');
  const step = (flow?.steps || []).find((x) => x.id === stepId);
  const asList = step && (step.forceList || (step.options || []).length > 3);
  if (kind === 'o') return c === 'title' ? (asList ? 24 : 20) : 72;
  if (kind === 's' && b === 'listButton') return 20;
  if (kind === 's' && b === 'listSection') return 24;
  if (kind === 's' && b === 'listHeader') return 60;
  if (kind === 's' && b === 'text') return step?.type === 'finish' || step?.type === 'send' ? 4096 : 1024;
  return 4096;
}

/** Sorted {placeholders} in a text, to check a translation kept them all. */
const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

/**
 * Telugu for a flow's texts, with Cloudflare's free AI: { te: { "<key>": "<telugu>" } }.
 * Each text keeps its {placeholders}, *bold* and emojis; one that breaks a rule (too long for a WhatsApp
 * button, a placeholder missing) is left out, so the English is used there and the business can fix it.
 */
export async function translateFlow(env, flow, { onlyMissing = null } = {}) {
  const all = flowStrings(flow);
  const keys = Object.keys(all).filter((k) => !onlyMissing || !onlyMissing[k]);
  const result = {}; const skipped = [];
  for (let i = 0; i < keys.length; i += 10) {
    const chunk = Object.fromEntries(keys.slice(i, i + 10).map((k) => [k, all[k]]));
    let out = {};
    try {
      const r = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        max_tokens: 3500, temperature: 0.2,
        response_format: { type: 'json_schema', json_schema: { type: 'object', properties: Object.fromEntries(Object.keys(chunk).map((k) => [k, { type: 'string' }])), required: Object.keys(chunk) } },
        messages: [
          { role: 'system', content: 'Translate WhatsApp chatbot messages from English to natural, friendly, everyday Telugu (Telugu script) as spoken in Hyderabad. '
            + 'Rules: keep every {placeholder} exactly as written (e.g. {business}, {name}); keep *bold* markers, emojis, line breaks, ₹ amounts, numbers, phone numbers and brand/project names unchanged; '
            + 'common English words Telugu speakers use (site visit, project, budget, schedule, BHK, OK) may stay in English or be written in Telugu letters; '
            + 'keys ending in ".title" are WhatsApp buttons: keep them very short (under 20 characters if possible). '
            + 'Reply with JSON only: the same keys with the Telugu text as values.' },
          { role: 'user', content: JSON.stringify(chunk) },
        ],
      });
      out = typeof r?.response === 'string' ? JSON.parse(r.response.replace(/^```(?:json)?\s*|\s*```$/g, '')) : (r?.response || {});
    } catch (err) { console.warn('[Translate] chunk failed:', err.message); }
    for (const k of Object.keys(chunk)) {
      const v = String(out?.[k] || '').trim();
      if (!v || v.length > stringLimit(k, flow) || placeholders(v) !== placeholders(chunk[k])) { skipped.push(k); continue; }
      result[k] = v;
    }
  }
  return { te: result, skipped };
}
