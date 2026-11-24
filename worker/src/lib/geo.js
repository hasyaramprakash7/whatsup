// Place lookup: area name / pincode → map point, and map point → short place name.
//
// Default: OpenStreetMap Nominatim (free). Its usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// allows at most 1 request per second, no heavy/bulk use, an identifying User-Agent, and asks for caching.
// Every result is cached in D1 (table geocache), so each place is looked up once.
// For high volume set GOOGLE_MAPS_API_KEY (Google Geocoding API, paid) and it is used instead.

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const userAgent = (env) => env.GEOCODER_USER_AGENT || 'WhatsAppBusinessAgent/1.0 (Cloudflare Worker; low-volume, cached)';
const country = (env) => (env.GEOCODE_COUNTRY || 'in').toLowerCase();

export const isPincode = (s) => /^\d{6}$/.test(String(s).replace(/\s/g, ''));

/** Distance in km between two { lat, lng } points. */
export function distanceKm(a, b) {
  const R = 6371; const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const kmLabel = (km) => (km < 1 ? `${Math.max(Math.round(km * 1000 / 50) * 50, 50)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);
export const mapsLink = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

async function cached(env, key, fn) {
  const row = await env.DB.prepare('SELECT lat, lng, label FROM geocache WHERE key = ?').bind(key).first().catch(() => null);
  if (row) return row.lat == null ? null : { lat: row.lat, lng: row.lng, label: row.label };
  const v = await fn();
  if (v === undefined) return null; // the lookup itself failed (network/limit): don't remember that
  // Misses are cached too (lat NULL) so a typo isn't looked up again and again.
  await env.DB.prepare('INSERT OR REPLACE INTO geocache (key, lat, lng, label) VALUES (?, ?, ?, ?)').bind(key, v?.lat ?? null, v?.lng ?? null, v?.label ?? null).run().catch(() => {});
  return v;
}

/** "Kokapet, Hyderabad 500075" from a Nominatim address object. */
function shortLabel(a = {}, fallback = '') {
  const local = a.suburb || a.neighbourhood || a.village || a.quarter || a.hamlet || a.town || a.city_district;
  const city = a.city || a.town || a.county || a.state_district || a.state;
  const parts = [...new Set([local, city].filter(Boolean))];
  const s = `${parts.join(', ')}${a.postcode ? ` ${a.postcode}` : ''}`.trim();
  return s || fallback.split(',').slice(0, 3).join(',').trim();
}

async function nominatim(env, path) {
  const res = await fetch(`${NOMINATIM}${path}`, { headers: { 'User-Agent': userAgent(env), 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`geocoder ${res.status}`);
  return res.json();
}

/** Area name, landmark or pincode → { lat, lng, label } or null. */
export async function geocode(env, query) {
  const q = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (q.length < 3) return null;
  const pin = isPincode(q) ? q.replace(/\s/g, '') : null;
  return cached(env, `f:${country(env)}:${q.toLowerCase()}`, async () => {
    try {
      if (env.GOOGLE_MAPS_API_KEY) {
        const p = new URLSearchParams({ address: q, region: country(env), key: env.GOOGLE_MAPS_API_KEY, ...(pin ? { components: `postal_code:${pin}|country:${country(env)}` } : {}) });
        const j = await (await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${p}`)).json();
        const r = j.results?.[0]; if (!r) return null;
        return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, label: r.formatted_address.split(',').slice(0, 3).join(',').trim() };
      }
      const p = new URLSearchParams({ format: 'jsonv2', limit: '1', addressdetails: '1', countrycodes: country(env), ...(pin ? { postalcode: pin } : { q }) });
      const [r] = await nominatim(env, `/search?${p}`);
      if (!r) return null;
      return { lat: +(+r.lat).toFixed(6), lng: +(+r.lon).toFixed(6), label: shortLabel(r.address, r.display_name) || q };
    } catch (e) { console.warn('[geo] lookup failed', e.message); return undefined; }
  }).then((v) => v || null);
}

/** Map point → short place name ("Kokapet, Hyderabad 500075"); falls back to coordinates. */
export async function reverseGeocode(env, lat, lng) {
  const k = `r:${lat.toFixed(3)},${lng.toFixed(3)}`;
  const v = await cached(env, k, async () => {
    try {
      if (env.GOOGLE_MAPS_API_KEY) {
        const j = await (await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${env.GOOGLE_MAPS_API_KEY}`)).json();
        const r = j.results?.[0]; return r ? { lat, lng, label: r.formatted_address.split(',').slice(0, 3).join(',').trim() } : null;
      }
      const r = await nominatim(env, `/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${lat}&lon=${lng}`);
      return r && !r.error ? { lat, lng, label: shortLabel(r.address, r.display_name) } : null;
    } catch (e) { console.warn('[geo] reverse failed', e.message); return undefined; }
  });
  return v?.label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}
