// Phone numbers, CSV parsing and small text helpers.

/** Digits with country code; 10-digit numbers get the default code (India: 91). Null if invalid. */
export function normalizePhone(raw, defaultCountryCode = '91') {
  if (!raw) return null;
  let digits = String(raw).replace(/[^0-9]/g, '');
  if (digits.length === 10) digits = defaultCountryCode + digits;
  if (digits.startsWith('0') && digits.length === 11) digits = defaultCountryCode + digits.slice(1);
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}
export const isValidPhone = (digits) => typeof digits === 'string' && /^\d{11,15}$/.test(digits);

/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). Returns objects keyed by the header row. */
export function parseCsv(text) {
  const rows = [];
  let row = []; let field = ''; let inQuotes = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const PHONE_COLUMNS = ['phone', 'mobile', 'phonenumber', 'phone number', 'whatsapp', 'whatsapp number', 'number', 'contact'];
const NAME_COLUMNS = ['name', 'fullname', 'full name', 'customer', 'customer name', 'first name'];
export function pickColumn(row, candidates) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const k = keys.find((x) => x.toLowerCase() === c);
    if (k && row[k]) return String(row[k]).trim();
  }
  return null;
}
export const pickPhone = (row) => pickColumn(row, PHONE_COLUMNS);
export const pickName = (row) => pickColumn(row, NAME_COLUMNS);

/** Replaces {placeholders}; unknown ones are left as typed so the vendor can spot them. */
export function fill(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null && vars[k] !== '' ? String(vars[k]) : m));
}

export const nowIso = () => new Date().toISOString();
export const json = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
