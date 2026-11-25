// Appointment / visit slots with real dates, in the business's local time.
import { timeWordsToEnglish } from './lang.js';
// India has no daylight saving, so a fixed UTC offset is enough (SITE_UTC_OFFSET, default +05:30).
let OFFSET_MIN = 330;
/** Sets the UTC offset from the Worker env (called once per request). */
export function setUtcOffset(value) { OFFSET_MIN = parseOffsetMinutes(value || '+05:30'); }

function parseOffsetMinutes(value) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(value || '').trim());
  if (!m) return 330; // +05:30 (IST)
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minutes : minutes;
}


/** Is `now` inside the business's AI hours? cfg: { schedule, hoursFrom, hoursTo, days } in site-local time. */
export function withinAiHours(cfg, now = new Date()) {
  if (!cfg || cfg.schedule !== 'hours') return true;
  const local = new Date(now.getTime() + OFFSET_MIN * 60000);
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
  const from = toMin(cfg.hoursFrom || '09:00'); const to = toMin(cfg.hoursTo || '21:00');
  const days = Array.isArray(cfg.days) ? cfg.days : [0, 1, 2, 3, 4, 5, 6];
  const today = local.getUTCDay();
  if (from < to) return days.includes(today) && mins >= from && mins < to;
  // Overnight, e.g. 21:00–09:00: the part after midnight belongs to the previous day's window.
  if (mins >= from) return days.includes(today);
  return mins < to && days.includes((today + 6) % 7);
}

// Default slot plan (each flow step can set its own): tomorrow 11 AM, Saturday 4 PM, Sunday 11 AM.
const DEFAULT_PLAN = [{ day: 'TOMORROW', time: '11:00' }, { day: 'SAT', time: '16:00' }, { day: 'SUN', time: '11:00' }];
const WEEKDAY_INDEX = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const MAX_DAYS_AHEAD = 60; // a tapped slot further out than this is treated as invalid

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Telugu: buttons ("రేపు, 11 AM", "శని 28 నవం, 4 PM") and full dates ("శనివారం, 28 నవంబర్ 2026, 4:00 PM").
const TE_DAYS_SHORT = ['ఆది', 'సోమ', 'మంగళ', 'బుధ', 'గురు', 'శుక్ర', 'శని'];
const TE_DAYS_LONG = ['ఆదివారం', 'సోమవారం', 'మంగళవారం', 'బుధవారం', 'గురువారం', 'శుక్రవారం', 'శనివారం'];
const TE_MONTHS = ['జన', 'ఫిబ్ర', 'మార్చి', 'ఏప్రి', 'మే', 'జూన్', 'జులై', 'ఆగ', 'సెప్టె', 'అక్టో', 'నవం', 'డిసెం'];
const TE_MONTHS_LONG = ['జనవరి', 'ఫిబ్రవరి', 'మార్చి', 'ఏప్రిల్', 'మే', 'జూన్', 'జులై', 'ఆగస్టు', 'సెప్టెంబర్', 'అక్టోబర్', 'నవంబర్', 'డిసెంబర్'];

// A Date shifted so its getUTC* fields read as site-local wall-clock time.
const toLocal = (date) => new Date(date.getTime() + OFFSET_MIN * 60000);
// The real instant for a site-local wall-clock time (day overflow is handled by Date.UTC).
const fromLocal = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m, d, h, min) - OFFSET_MIN * 60000);

function formatTime(local, withMinutes) {
  const h = local.getUTCHours();
  const min = local.getUTCMinutes();
  const h12 = h % 12 || 12;
  const suffix = h < 12 ? 'AM' : 'PM';
  return withMinutes || min ? `${h12}:${String(min).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
}

function sameLocalDay(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

/** Button title, at most 20 characters (WhatsApp limit): "Tomorrow, 11 AM" or "Sat 28 Nov, 4 PM". */
function formatSlotShort(at, now = new Date(), lang = 'en') {
  const local = toLocal(at);
  const today = toLocal(now);
  const tomorrow = toLocal(fromLocal(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
  if (lang === 'te') {
    const time = formatTime(local, local.getUTCMinutes() !== 0);
    if (sameLocalDay(local, today)) return `ఈరోజు, ${time}`;
    if (sameLocalDay(local, tomorrow)) return `రేపు, ${time}`;
    const t = `${TE_DAYS_SHORT[local.getUTCDay()]} ${local.getUTCDate()} ${TE_MONTHS[local.getUTCMonth()]}, ${time}`;
    if (t.length <= 20) return t; // WhatsApp button limit; otherwise the English form below
  }
  if (sameLocalDay(local, today)) return `Today, ${formatTime(local, local.getUTCMinutes() !== 0)}`;
  if (sameLocalDay(local, tomorrow)) return `Tomorrow, ${formatTime(local, false)}`;
  return `${DAYS_SHORT[local.getUTCDay()]} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}, ${formatTime(local, false)}`;
}

/** Full wording for messages and the dashboard: "Saturday, 28 Nov 2026 at 4:00 PM". */
function formatSlotLong(at, lang = 'en') {
  const local = toLocal(at);
  if (lang === 'te') return `${TE_DAYS_LONG[local.getUTCDay()]}, ${local.getUTCDate()} ${TE_MONTHS_LONG[local.getUTCMonth()]} ${local.getUTCFullYear()}, ${formatTime(local, true)}`;
  return `${DAYS_LONG[local.getUTCDay()]}, ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()} at ${formatTime(local, true)}`;
}

/**
 * The next visit slots as WhatsApp buttons: { id: 'SLOT_<epoch ms>', title, at }.
 * Walks forward day by day from tomorrow and takes every plan rule that matches the day
 * ('TOMORROW' only matches tomorrow), skipping duplicates, until `count` slots are found.
 */
function buildVisitSlots(now = new Date(), count = 3, plan = DEFAULT_PLAN, lang = 'en') {
  const rules = (Array.isArray(plan) && plan.length ? plan : DEFAULT_PLAN).map((r) => {
    const [hour, minute] = String(r.time || '11:00').split(':').map(Number);
    return { day: String(r.day || '').toUpperCase(), hour: hour || 0, minute: minute || 0 };
  });
  count = Math.min(count, rules.length) || 1;
  const today = toLocal(now);
  const [y, m, d] = [today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()];
  const slots = [];

  for (let i = 1; slots.length < count && i <= 21; i++) {
    const weekday = toLocal(fromLocal(y, m, d + i)).getUTCDay();
    for (const r of rules) {
      if (slots.length >= count) break;
      const matches = r.day === 'TOMORROW' ? i === 1 : WEEKDAY_INDEX[r.day] === weekday;
      if (!matches) continue;
      const at = fromLocal(y, m, d + i, r.hour, r.minute);
      if (!slots.some((x) => x.getTime() === at.getTime())) slots.push(at);
    }
  }

  return slots
    .sort((a, b) => a - b)
    .slice(0, count)
    .map((at) => ({ id: `SLOT_${at.getTime()}`, title: formatSlotShort(at, now, lang), at }));
}

/** Date for a tapped slot button id, or null if it is not one of ours (e.g. an old-format id). */
function parseSlotId(id) {
  const m = /^SLOT_(\d{12,14})$/.exec(String(id || ''));
  if (!m) return null;
  const at = new Date(Number(m[1]));
  if (Number.isNaN(at.getTime())) return null;
  if (at.getTime() > Date.now() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) return null;
  return at;
}

// ---------- a day and time the customer typed ("today 4 pm", "tomorrow at 11", "Sat 5:30pm", "29 Nov 4 o'clock") ----------
const WD = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MO = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const NOT_TIME = '(?!\\s*(?:km|kms|bhk|lakh|lakhs|lac|cr|crore|crores|sq|sqft|sft|acre|acres|floor|th|st|nd|rd|%|k\\b|l\\b))';
const hm = (s) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/**
 * The visit time a customer typed, in site-local time. Returns null when the message names no clock time,
 * { at } when it can be booked, or { at, error: 'soon' | 'hours' | 'far' } when it can't.
 * Hours without am/pm: 1–8 → PM (nobody visits a site at 4 AM), 9–12 as written.
 */
function parseRequestedTime(text, now = new Date(), { from = '09:00', to = '19:00', leadMinutes = 60 } = {}) {
  // Telugu / Tenglish day and time words ("రేపు మూడు గంటలకి", "repu moodu gantalaki") become English first.
  const s = ` ${timeWordsToEnglish(String(text || '').replace(/[’‘`]/g, "'")).toLowerCase().replace(/\s+/g, ' ')} `;
  let h = null; let mi = 0; let mer = null; let m;
  if ((m = new RegExp(`(?<![\\d₹.])(\\d{1,2})[:.](\\d{2})\\s*(a\\.?m\\.?|p\\.?m\\.?)?${NOT_TIME}`).exec(s))) { h = +m[1]; mi = +m[2]; mer = m[3]; }
  else if ((m = /(?<![\d₹.])(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/.exec(s))) { h = +m[1]; mer = m[2]; }
  else if ((m = /(?<![\d₹.])(\d{1,2})\s*o\s?'?\s?clock/.exec(s))) { h = +m[1]; }
  else if ((m = new RegExp(`\\b(?:at|@|by|around|after)\\s*(\\d{1,2})\\b${NOT_TIME}`).exec(s))) { h = +m[1]; }
  else if (/\bnoon\b/.test(s)) h = 12;
  else if (/\b(evening)\b/.test(s)) h = 17;
  else if (/\b(morning)\b/.test(s)) h = 11;
  else if (/\b(afternoon)\b/.test(s)) h = 15;
  if (h == null || h > 23 || mi > 59) return null;
  if (mer) { if (h < 1 || h > 12) return null; h = (h % 12) + (mer[0] === 'p' ? 12 : 0); }
  else if (h >= 1 && h <= 8) h += 12;

  const today = toLocal(now);
  let [y, mo, d] = [today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()];
  let dayGiven = true; let wd;
  if (/\bday after (tomorrow|tmrw|tmr)\b/.test(s)) d += 2;
  else if (/\b(tomorrow|tmrw|tmr|tomorow|tommorow|tommorrow|tomoro)\b/.test(s)) d += 1;
  else if (/\b(today|tonight|todays)\b/.test(s)) { /* today */ }
  else if ((wd = Object.keys(WD).find((k) => new RegExp(`\\b(next |this |coming )?${k}\\b`).test(s))) !== undefined) {
    d += (WD[wd] - today.getUTCDay() + 7) % 7;
  } else if ((m = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\b/.exec(s)) || (m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\s*(\d{1,2})(?:st|nd|rd|th)?\b/.exec(s))) {
    const [dd, mm] = /\d/.test(m[1]) ? [+m[1], MO[m[2]]] : [+m[2], MO[m[1]]];
    d = dd; mo = mm; if (fromLocal(y, mo, d, 23, 59) < now) y += 1;
  } else dayGiven = false;

  let at = fromLocal(y, mo, d, h, mi);
  // "4 pm" with no day: today if there is still time, else tomorrow.
  if (!dayGiven && at.getTime() < now.getTime() + leadMinutes * 60000) at = fromLocal(y, mo, d + 1, h, mi);
  const mins = h * 60 + mi;
  if (at.getTime() < now.getTime() + leadMinutes * 60000) return { at, error: 'soon' };
  if (mins < hm(from) || mins > hm(to)) return { at, error: 'hours' };
  if (at.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * 3600 * 1000) return { at, error: 'far' };
  return { at };
}
/** "2026-11-26 15:00" (site-local, from the AI) → same answer shape as parseRequestedTime. */
function checkLocalTime(str, now = new Date(), { from = '09:00', to = '19:00', leadMinutes = 60 } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  const at = fromLocal(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (Number.isNaN(at.getTime())) return null;
  const mins = +m[4] * 60 + +m[5];
  if (at.getTime() < now.getTime() + leadMinutes * 60000) return { at, error: 'soon' };
  if (mins < hm(from) || mins > hm(to)) return { at, error: 'hours' };
  if (at.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * 3600 * 1000) return { at, error: 'far' };
  return { at };
}
/** "9 AM" for "09:00". */
const clockLabel = (s) => { const v = hm(s); const h = Math.floor(v / 60); const m = v % 60; return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };

export { buildVisitSlots, parseSlotId, formatSlotShort, formatSlotLong, DEFAULT_PLAN, parseRequestedTime, checkLocalTime, clockLabel };
