// Appointment / visit slots with real dates, in the business's local time.
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


// Default slot plan (each flow step can set its own): tomorrow 11 AM, Saturday 4 PM, Sunday 11 AM.
const DEFAULT_PLAN = [{ day: 'TOMORROW', time: '11:00' }, { day: 'SAT', time: '16:00' }, { day: 'SUN', time: '11:00' }];
const WEEKDAY_INDEX = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const MAX_DAYS_AHEAD = 60; // a tapped slot further out than this is treated as invalid

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
function formatSlotShort(at, now = new Date()) {
  const local = toLocal(at);
  const today = toLocal(now);
  const tomorrow = toLocal(fromLocal(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
  if (sameLocalDay(local, tomorrow)) return `Tomorrow, ${formatTime(local, false)}`;
  return `${DAYS_SHORT[local.getUTCDay()]} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}, ${formatTime(local, false)}`;
}

/** Full wording for messages and the dashboard: "Saturday, 28 Nov 2026 at 4:00 PM". */
function formatSlotLong(at) {
  const local = toLocal(at);
  return `${DAYS_LONG[local.getUTCDay()]}, ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()} at ${formatTime(local, true)}`;
}

/**
 * The next visit slots as WhatsApp buttons: { id: 'SLOT_<epoch ms>', title, at }.
 * Walks forward day by day from tomorrow and takes every plan rule that matches the day
 * ('TOMORROW' only matches tomorrow), skipping duplicates, until `count` slots are found.
 */
function buildVisitSlots(now = new Date(), count = 3, plan = DEFAULT_PLAN) {
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
    .map((at) => ({ id: `SLOT_${at.getTime()}`, title: formatSlotShort(at, now), at }));
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

export { buildVisitSlots, parseSlotId, formatSlotShort, formatSlotLong, DEFAULT_PLAN };
