// Site-visit slots with real dates, in the project site's local time.
// India has no daylight saving, so a fixed UTC offset is enough; override with SITE_UTC_OFFSET.

function parseOffsetMinutes(value) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(value || '').trim());
  if (!m) return 330; // +05:30 (IST)
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minutes : minutes;
}

const OFFSET_MIN = parseOffsetMinutes(process.env.SITE_UTC_OFFSET || '+05:30');

// Slot plan: tomorrow at 11 AM, then upcoming weekend slots, until 3 slots are offered.
const FIRST_SLOT = { hour: 11, minute: 0 };
const WEEKEND_SLOTS = [
  { weekday: 6, hour: 16, minute: 0 }, // Saturday 4 PM
  { weekday: 0, hour: 11, minute: 0 }, // Sunday 11 AM
];
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

/** The next `count` visit slots as WhatsApp buttons: { id: 'SLOT_<epoch ms>', title, at }. */
function buildVisitSlots(now = new Date(), count = 3) {
  const today = toLocal(now);
  const [y, m, d] = [today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()];
  const slots = [fromLocal(y, m, d + 1, FIRST_SLOT.hour, FIRST_SLOT.minute)];

  for (let i = 1; slots.length < count && i <= 14; i++) {
    const weekday = toLocal(fromLocal(y, m, d + i)).getUTCDay();
    for (const s of WEEKEND_SLOTS) {
      if (s.weekday !== weekday || slots.length >= count) continue;
      const at = fromLocal(y, m, d + i, s.hour, s.minute);
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

module.exports = { buildVisitSlots, parseSlotId, formatSlotShort, formatSlotLong };
