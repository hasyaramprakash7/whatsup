// Extra details a product/service has, depending on the business type (layout).
// Shown in the dashboard form, sent in the WhatsApp photo caption and list, and given to the AI.
// type: 'text' (free text, max 80) or 'select' (one of `options`).

const sel = (key, label, options) => ({ key, label, type: 'select', options });
const txt = (key, label, placeholder) => ({ key, label, type: 'text', placeholder });

export const ITEM_FIELDS = {
  real_estate: [
    sel('config', 'Configuration', ['1 BHK', '2 BHK', '3 BHK', '4 BHK', '5+ BHK', 'Villa', 'Plot', 'Commercial']),
    txt('area', 'Area', '1,850 sq.ft'),
    txt('floor', 'Floor', '12th floor'),
    sel('facing', 'Facing', ['East', 'West', 'North', 'South', 'North-East', 'North-West', 'South-East', 'South-West']),
    sel('possession', 'Possession', ['Ready to move', 'Under construction', 'New launch']),
    sel('availability', 'Availability', ['Available', 'Few left', 'Sold out']),
    // Each project can be somewhere else: its own address and map pin.
    txt('address', 'Area / locality', 'Kokapet'),
    { ...txt('pincode', 'Pincode', '500075'), pattern: /^\d{6}$/, patternHint: 'a 6-digit pincode' },
    { key: 'map', label: 'Google Maps link', type: 'map', placeholder: 'https://maps.app.goo.gl/…' },
  ],
  clinic: [
    txt('duration', 'Duration', '30 minutes'),
    txt('doctor', 'Doctor', 'Dr. Priya Rao'),
    txt('days', 'Available on', 'Mon–Sat, 10 AM – 6 PM'),
    sel('mode', 'Consultation', ['In clinic', 'Online', 'In clinic or online']),
  ],
  salon: [
    txt('duration', 'Duration', '90 minutes'),
    sel('for', 'For', ['Women', 'Men', 'Unisex', 'Kids']),
    txt('includes', 'Includes', 'Wash, cut and blow-dry'),
  ],
  restaurant: [
    sel('food', 'Type', ['Veg', 'Non-veg', 'Egg', 'Vegan']),
    sel('spice', 'Spice level', ['Mild', 'Medium', 'Spicy']),
    txt('serves', 'Serves', '2 people'),
    sel('availability', 'Availability', ['Available', 'Today only', 'Sold out']),
  ],
  coaching: [
    txt('duration', 'Duration', '1 year'),
    sel('mode', 'Mode', ['Online', 'At the centre', 'Online or at the centre']),
    txt('batch', 'Batch timing', 'Weekends, 10 AM'),
    txt('eligibility', 'For', 'Class 9–10'),
    sel('availability', 'Seats', ['Open', 'Few seats left', 'Batch full']),
  ],
  retail: [
    txt('sizes', 'Sizes', 'S, M, L, XL'),
    txt('colours', 'Colours', 'Red, Blue, Black'),
    txt('material', 'Material', 'Cotton'),
    sel('stock', 'Stock', ['In stock', 'Few left', 'Out of stock']),
  ],
  general: [
    txt('duration', 'Duration / delivery', '2 weeks'),
    sel('availability', 'Availability', ['Available', 'Limited', 'Not available']),
  ],
};

export const itemFieldsFor = (layout) => ITEM_FIELDS[layout] || ITEM_FIELDS.general;

/** Keeps only this layout's fields, trimmed; select values must be one of the options. */
export function cleanDetails(layout, raw, errors = []) {
  let src = raw;
  if (typeof src === 'string') { try { src = JSON.parse(src || '{}'); } catch { errors.push('Details are not valid.'); return {}; } }
  if (!src || typeof src !== 'object') return {};
  const out = {};
  for (const f of itemFieldsFor(layout)) {
    const v = String(src[f.key] ?? '').trim();
    if (!v) continue;
    if (f.type === 'map') {
      if (v.length > 500 || !(MAPS_LINK.test(v) || COORDS.test(v))) { errors.push(`${f.label}: paste a Google Maps link (or coordinates like 17.4123, 78.3456).`); continue; }
      out[f.key] = v; continue;
    }
    if (v.length > 80) { errors.push(`${f.label}: up to 80 characters.`); continue; }
    if (f.pattern && !f.pattern.test(v)) { errors.push(`${f.label}: enter ${f.patternHint || 'a valid value'}.`); continue; }
    if (f.type === 'select' && !f.options.includes(v)) { errors.push(`${f.label}: choose one of the options.`); continue; }
    out[f.key] = v;
  }
  return out;
}

// ---------- location (address + map pin) ----------
const LOCATION_KEYS = new Set(['address', 'pincode', 'map']);
const MAPS_LINK = /^https:\/\/(?:(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)\S*$/i;
const COORDS = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const validPoint = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** Coordinates written inside a Google Maps URL (…/@17.41,78.34,15z, ?q=17.41,78.34, !3d17.41!4d78.34, ?query=…). */
function pointFromUrl(url) {
  const s = decodeURIComponent(url);
  const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /\/place\/(-?\d+\.\d+),\s*(-?\d+\.\d+)/];
  for (const p of pats) { const m = p.exec(s); if (m && validPoint(+m[1], +m[2])) return { lat: +m[1], lng: +m[2] }; }
  return null;
}

/**
 * Finds the pin of a Google Maps link or "lat, lng" text. Short links (maps.app.goo.gl) are followed
 * to the full URL, which holds the coordinates. Returns null when the link has no exact point.
 */
export async function resolveMapPoint(value) {
  const c = COORDS.exec(value || '');
  if (c) return validPoint(+c[1], +c[2]) ? { lat: +c[1], lng: +c[2] } : null;
  let url = value;
  for (let hop = 0; hop < 4 && url; hop++) {
    const p = pointFromUrl(url); if (p) return p;
    if (!MAPS_LINK.test(url)) return null;
    try {
      const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
      const next = res.headers.get('location');
      if (!next) { const body = res.status === 200 ? (await res.text()).slice(0, 200000) : ''; return pointFromUrl(body.match(/https:\/\/www\.google\.[^"'\s]+\/maps[^"'\s]*/)?.[0] || '') || null; }
      url = new URL(next, url).toString();
    } catch { return null; }
  }
  return null;
}

/** Link customers tap: an exact pin when we know it, else the link the business pasted. */
export function mapUrl(it) {
  const d = it.details || {};
  if (Number.isFinite(d.lat) && Number.isFinite(d.lng)) return `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}`;
  return d.map || '';
}
/** "📍 Site address\nhttps://maps…" for captions ('' when the item has no location). */
export function locationLines(it) {
  const a = [it.details?.address, it.details?.pincode].filter(Boolean).join(' '); const u = mapUrl(it);
  return [a && `📍 ${a}`, u && (a ? u : `📍 ${u}`)].filter(Boolean).join('\n');
}
/**
 * The places a business has products in, from each product's area/locality (or pincode):
 * [{ key, name, pincodes, count, center: {lat,lng}|null, items }], most products first.
 */
export function areasOf(items) {
  const map = new Map();
  for (const it of items) {
    const name = String(it.details?.address || it.details?.pincode || '').trim();
    if (!name) continue;
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    const a = map.get(key) || { key, name, pincodes: new Set(), items: [] };
    if (it.details?.pincode) a.pincodes.add(it.details.pincode);
    a.items.push(it); map.set(key, a);
  }
  return [...map.values()].map((a) => {
    const pins = a.items.filter(hasPin);
    const center = pins.length ? { lat: pins.reduce((s, x) => s + x.details.lat, 0) / pins.length, lng: pins.reduce((s, x) => s + x.details.lng, 0) / pins.length } : null;
    return { key: a.key, name: a.name, pincodes: [...a.pincodes], count: a.items.length, center, items: a.items };
  }).sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
}
/** Does this product sit in the area? */
export const inArea = (it, areaKey) => !!areaKey && String(it.details?.address || it.details?.pincode || '').trim().toLowerCase().replace(/\s+/g, ' ') === areaKey;

export const hasPin = (it) => Number.isFinite(it?.details?.lat) && Number.isFinite(it?.details?.lng);

/** [[label, value], …] in the layout's order (address/map are shown separately). */
export const detailPairs = (it) => itemFieldsFor(it.layout).filter((f) => !LOCATION_KEYS.has(f.key) && it.details?.[f.key]).map((f) => [f.label, it.details[f.key]]);

/** "3 BHK · 1,850 sq.ft · East" — short, for list rows. */
export const detailsShort = (it) => detailPairs(it).map(([, v]) => v).join(' · ');
