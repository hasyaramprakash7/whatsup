// What WhatsApp messaging costs each business, from Meta's own pricing report (pricing_analytics on the WhatsApp
// Business Account), plus our estimate for campaigns that are still sending. Meta has no way for another app to read
// the remaining balance or add money, so the screen links to that account's Meta Billing page for top-ups.
import { offsetMs } from './campaigns.js';

const DAY = 86400000;
const CATEGORY_LABELS = { MARKETING: 'Marketing', MARKETING_LITE: 'Marketing (lite)', UTILITY: 'Utility', AUTHENTICATION: 'Authentication',
  AUTHENTICATION_INTERNATIONAL: 'Authentication (international)', SERVICE: 'Service (customer wrote first)', REFERRAL_CONVERSION: 'From ads (free)' };

/** Local (India) calendar date of a time, as YYYY-MM-DD. */
const localDate = (ms, off) => new Date(ms + off).toISOString().slice(0, 10);
/** Start of the local day / month that contains `now`, as a UTC time. */
function localStarts(now, off) {
  const d = new Date(now + off); d.setUTCHours(0, 0, 0, 0);
  const day = d.getTime() - off;
  d.setUTCDate(1);
  return { day, month: d.getTime() - off };
}
const round = (n) => Math.round(n * 100) / 100;

/**
 * Turns Meta's data points into the numbers on screen: today, last 7 days, this month, last 30 days, a 30-day chart,
 * and this month split by message type and by phone number.
 */
export function summarizePricing(points, { now = Date.now(), offset = '+05:30', phones = [] } = {}) {
  const off = offsetMs(offset);
  const { day, month } = localStarts(now, off);
  const weekFrom = day - 6 * DAY; const last30From = day - 29 * DAY;
  const totals = { today: 0, week: 0, month: 0, last30: 0 };
  const volume = { today: 0, week: 0, month: 0, last30: 0 };
  let freeMonth = 0;
  const byCat = new Map(); const byPhone = new Map(); const byDay = new Map();
  for (let i = 0; i < 30; i++) byDay.set(localDate(last30From + i * DAY, off), { cost: 0, volume: 0 });
  for (const p of points || []) {
    // Meta gives seconds; its days start at midnight UTC, so the middle of the bucket picks the right local date.
    const at = ((Number(p.start) + Number(p.end || p.start)) / 2) * 1000;
    const cost = Number(p.cost) || 0; const vol = Number(p.volume) || 0;
    if (!Number.isFinite(at)) continue;
    const add = (key, from) => { if (at >= from) { totals[key] += cost; volume[key] += vol; } };
    add('last30', last30From); add('week', weekFrom); add('month', month); add('today', day);
    const d = byDay.get(localDate(at, off)); if (d) { d.cost += cost; d.volume += vol; }
    if (at < month) continue;
    if (String(p.pricing_type || '').startsWith('FREE')) freeMonth += vol;
    const cat = String(p.pricing_category || 'OTHER').toUpperCase();
    const c = byCat.get(cat) || { category: cat, label: CATEGORY_LABELS[cat] || cat, volume: 0, cost: 0 };
    c.volume += vol; c.cost += cost; byCat.set(cat, c);
    if (p.phone_number) {
      const key = String(p.phone_number).replace(/\D/g, '');
      const x = byPhone.get(key) || { phone: key, volume: 0, cost: 0 };
      x.volume += vol; x.cost += cost; byPhone.set(key, x);
    }
  }
  // Every number of the account shows, also the ones that sent nothing this month.
  for (const ph of phones) {
    const key = String(ph.phone || '').replace(/\D/g, '');
    if (key && !byPhone.has(key)) byPhone.set(key, { phone: key, volume: 0, cost: 0 });
    if (key) Object.assign(byPhone.get(key), { name: ph.name || '', quality: ph.quality || null, display: ph.display || key });
  }
  for (const k of Object.keys(totals)) totals[k] = round(totals[k]);
  return {
    totals, volume, freeMonth,
    byCategory: [...byCat.values()].map((x) => ({ ...x, cost: round(x.cost) })).sort((a, b) => b.cost - a.cost || b.volume - a.volume),
    byPhone: [...byPhone.values()].map((x) => ({ ...x, cost: round(x.cost) })).sort((a, b) => b.cost - a.cost || b.volume - a.volume),
    days: [...byDay.entries()].map(([date, x]) => ({ date, cost: round(x.cost), volume: x.volume })),
  };
}

/** Meta adds 18% GST in India on top of the message prices; it comes out of the same balance. */
export const GST = 0.18;

/** Message cost (without tax) of the data points that start at or after `sinceMs`. */
export const costSince = (points, sinceMs) => round((points || []).filter((p) => Number(p.start) * 1000 >= sinceMs).reduce((s, p) => s + (Number(p.cost) || 0), 0));

/** The balance the owner typed from Meta Billing ("Available funds"), checked. */
export function cleanBalance(b) {
  if (b?.amount === null || b?.amount === '') return { value: null };
  const n = Math.round(Number(b?.amount) * 100) / 100;
  if (!Number.isFinite(n) || n < 0 || n > 10000000) return { error: 'Type the "Available funds" amount from Meta Billing, e.g. 89.81.' };
  return { value: { amount: n, setAt: new Date().toISOString() } };
}

/**
 * The real balance exactly as shown in Meta Billing ("Available funds") when the owner copied it, and whether that is
 * already too little for the campaign messages still waiting (price + 18% GST). No estimate, no counting down.
 */
export function balanceStatus(balance, { waitingCost = 0 } = {}) {
  const amount = Number(balance.amount);
  const needed = round((waitingCost || 0) * (1 + GST));
  return { amount, seenAt: balance.setAt || null, needed, short: needed > 0 && amount < needed, empty: amount <= 0 };
}

/** The Meta Billing page of this WhatsApp account, where the owner adds money or changes the card. */
export const billingUrl = (wabaId) => (wabaId ? `https://business.facebook.com/billing_hub/payment_settings/?asset_id=${encodeURIComponent(wabaId)}` : 'https://business.facebook.com/billing_hub/payment_settings/');

/** Our own numbers: campaign messages sent this month (at the saved price) and what the waiting ones will cost. */
export async function campaignEstimate(env, tenantId, { now = Date.now(), offset = '+05:30' } = {}) {
  const { month } = localStarts(now, offsetMs(offset));
  const [sent, waiting, payment] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(c.cost_each), 0) AS cost FROM campaign_recipients r JOIN campaigns c ON c.id = r.campaign_id
      WHERE r.tenant_id = ? AND r.status IN ('sent', 'delivered', 'read') AND r.sent_at >= ?`).bind(tenantId, new Date(month).toISOString()).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(c.cost_each), 0) AS cost FROM campaign_recipients r JOIN campaigns c ON c.id = r.campaign_id
      WHERE r.tenant_id = ? AND r.status = 'waiting' AND c.status NOT IN ('done', 'cancelled')`).bind(tenantId).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM campaigns WHERE tenant_id = ? AND status = 'paused' AND paused_reason = 'payment'`).bind(tenantId).first(),
  ]);
  return { sentThisMonth: sent?.n || 0, sentCostThisMonth: round(sent?.cost || 0), waitingPeople: waiting?.n || 0, waitingCost: round(waiting?.cost || 0), paymentProblem: (payment?.n || 0) > 0 };
}

/** Sample numbers for the test copy (no real WhatsApp account there), so the screen can be checked. */
function demoPoints(now) {
  const out = [];
  for (let i = 0; i < 30; i++) {
    const start = Math.floor((now - i * DAY) / DAY) * DAY / 1000;
    const m = (i * 7) % 23; const u = i % 4; const s = (i * 3) % 11;
    if (m) out.push({ start, end: start + 86400, phone_number: '919000000001', pricing_type: 'REGULAR', pricing_category: 'MARKETING', volume: m * 10, cost: round(m * 10 * 0.8631) });
    if (u) out.push({ start, end: start + 86400, phone_number: '919000000001', pricing_type: 'REGULAR', pricing_category: 'UTILITY', volume: u * 5, cost: round(u * 5 * 0.115) });
    if (s) out.push({ start, end: start + 86400, phone_number: '919000000001', pricing_type: 'FREE_CUSTOMER_SERVICE', pricing_category: 'SERVICE', volume: s * 6, cost: 0 });
  }
  return out;
}

/**
 * Reads the account's spending from Meta. `graph(path)` calls the Graph API with this business's token and returns
 * { ok, data }. Never throws: problems come back as `error` so the screen still shows our own estimate.
 */
export async function metaSpending(env, tenant, graph, { now = Date.now() } = {}) {
  const offset = env.SITE_UTC_OFFSET || '+05:30';
  const out = { available: false, demo: false, currency: null, accountName: null, fundingLinked: null, error: null, billingUrl: billingUrl(tenant.wabaId), checkedAt: new Date(now).toISOString() };
  const base = String(env.GRAPH_BASE_URL || '');
  if (base === 'fake') {
    const pts = demoPoints(now);
    return { ...out, available: true, demo: true, currency: 'INR', accountName: 'Test account (sample numbers)',
      ...summarizePricing(pts, { now, offset, phones: [{ phone: '919000000001', name: tenant.businessName, quality: 'GREEN', display: '+91 90000 00001' }] }) };
  }
  if (!tenant.wabaId) return { ...out, error: 'No WhatsApp Business Account ID saved for this business (Businesses → Edit → WABA ID).' };
  const off = offsetMs(offset);
  const { month, day } = localStarts(now, off);
  const from = Math.floor(Math.min(month, day - 29 * DAY) / 1000); const to = Math.floor(now / 1000);
  const [acct, funding, phones, pricing] = await Promise.all([
    graph(`${tenant.wabaId}?fields=name,currency`),
    graph(`${tenant.wabaId}?fields=primary_funding_id`),
    graph(`${tenant.wabaId}/phone_numbers?fields=display_phone_number,verified_name,quality_rating&limit=50`),
    graph(`${tenant.wabaId}?fields=pricing_analytics.start(${from}).end(${to}).granularity(DAILY).dimensions(PRICING_CATEGORY,PRICING_TYPE,PHONE)`),
  ].map((p) => p.catch((e) => ({ ok: false, data: { error: { message: e.message } } }))));
  if (acct.ok) { out.accountName = acct.data.name || null; out.currency = acct.data.currency || null; }
  if (funding.ok) out.fundingLinked = !!funding.data.primary_funding_id;
  const phoneList = phones.ok ? (phones.data.data || []).map((p) => ({ phone: p.display_phone_number, display: p.display_phone_number, name: p.verified_name, quality: p.quality_rating })) : [];
  if (!pricing.ok) {
    out.error = pricing.data?.error?.message || 'Meta did not return the pricing report.';
    return { ...out, ...summarizePricing([], { now, offset, phones: phoneList }) };
  }
  const points = (pricing.data.pricing_analytics?.data || []).flatMap((d) => d.data_points || []);
  return { ...out, available: true, ...summarizePricing(points, { now, offset, phones: phoneList }) };
}
