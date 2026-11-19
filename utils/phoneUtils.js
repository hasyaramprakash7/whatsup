function normalizePhone(raw, defaultCountryCode = '91') {
  if (!raw) return null;
  let digits = String(raw).replace(/[^0-9]/g, '');
  if (digits.length === 10) digits = defaultCountryCode + digits;
  if (digits.startsWith('0') && digits.length === 11) digits = defaultCountryCode + digits.slice(1);
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}
function isValidPhone(digits) { return typeof digits === 'string' && /^\d{11,15}$/.test(digits); }
module.exports = { normalizePhone, isValidPhone };