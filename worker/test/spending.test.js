// Spending screen: Meta's pricing report turned into today / week / month, per type and per number; our estimate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { summarizePricing, campaignEstimate, metaSpending, billingUrl, cleanBalance, balanceStatus, costSince } from '../src/lib/spending.js';

const NOW = Date.parse('2026-11-25T10:00:00Z'); // 3:30 PM India time
const dayPt = (iso, extra) => { const s = Date.parse(`${iso}T00:00:00Z`) / 1000; return { start: s, end: s + 86400, ...extra }; };

test('pricing report: today, 7 days, month and 30 days in India time; by type and by number', () => {
  const pts = [
    dayPt('2026-11-25', { pricing_category: 'MARKETING', pricing_type: 'REGULAR', phone_number: '919000000001', volume: 10, cost: 8.63 }),
    dayPt('2026-11-25', { pricing_category: 'SERVICE', pricing_type: 'FREE_CUSTOMER_SERVICE', phone_number: '919000000001', volume: 4, cost: 0 }),
    dayPt('2026-11-20', { pricing_category: 'UTILITY', pricing_type: 'REGULAR', phone_number: '919000000002', volume: 8, cost: 0.92 }),
    dayPt('2026-11-02', { pricing_category: 'MARKETING', pricing_type: 'REGULAR', phone_number: '919000000001', volume: 100, cost: 86.3 }),
    dayPt('2026-10-30', { pricing_category: 'MARKETING', pricing_type: 'REGULAR', phone_number: '919000000001', volume: 50, cost: 43.15 }), // last month
  ];
  const s = summarizePricing(pts, { now: NOW, offset: '+05:30', phones: [{ phone: '+91 90000 00003', name: 'Spare' }] });
  assert.deepEqual(s.totals, { today: 8.63, week: 9.55, month: 95.85, last30: 139 });
  assert.equal(s.volume.today, 14);
  assert.equal(s.freeMonth, 4, 'customer-started replies are free');
  assert.deepEqual(s.byCategory.map((x) => [x.category, x.volume, x.cost]), [['MARKETING', 110, 94.93], ['UTILITY', 8, 0.92], ['SERVICE', 4, 0]]);
  assert.deepEqual(s.byPhone.map((x) => [x.phone, x.cost]), [['919000000001', 94.93], ['919000000002', 0.92], ['919000000003', 0]], 'a number that sent nothing still shows');
  assert.equal(s.days.length, 30);
  assert.equal(s.days.at(-1).date, '2026-11-25');
  assert.equal(s.days.at(-1).cost, 8.63);
});

test('estimate from our campaigns: sent this month and what the waiting people will cost; payment pause shows', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE campaigns (id TEXT, tenant_id TEXT, status TEXT, paused_reason TEXT, cost_each REAL);
    CREATE TABLE campaign_recipients (campaign_id TEXT, tenant_id TEXT, phone TEXT, status TEXT, sent_at TEXT);
    INSERT INTO campaigns VALUES ('a','t','sending',NULL,0.86), ('b','t','cancelled',NULL,0.86), ('c','t','paused','payment',0.12), ('x','other','sending',NULL,0.86);
    INSERT INTO campaign_recipients VALUES ('a','t','1','read','2026-11-24T10:00:00Z'), ('a','t','2','sent','2026-11-01T00:00:00Z'), ('a','t','3','sent','2026-10-20T00:00:00Z'),
      ('a','t','4','waiting',NULL), ('a','t','5','waiting',NULL), ('b','t','6','waiting',NULL), ('c','t','7','waiting',NULL), ('x','other','8','waiting',NULL);`);
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null });
  const e = await campaignEstimate({ DB: { prepare: (s) => stmt(s) } }, 't', { now: NOW });
  assert.deepEqual(e, { sentThisMonth: 2, sentCostThisMonth: 1.72, waitingPeople: 3, waitingCost: 1.84, paymentProblem: true });
});

test('Meta call: report read from the WABA; a refused report still returns numbers and the billing link', async () => {
  const tenant = { wabaId: '123', businessName: 'Demo' };
  const calls = [];
  const graph = async (path) => {
    calls.push(path);
    if (path.includes('pricing_analytics')) return { ok: true, data: { pricing_analytics: { data: [{ data_points: [dayPt('2026-11-25', { pricing_category: 'MARKETING', volume: 2, cost: 1.72 })] }] } } };
    if (path.includes('phone_numbers')) return { ok: true, data: { data: [{ display_phone_number: '+91 90000 00001', verified_name: 'Demo', quality_rating: 'GREEN' }] } };
    if (path.includes('primary_funding_id')) return { ok: true, data: { primary_funding_id: '9' } };
    return { ok: true, data: { name: 'Demo WABA', currency: 'INR' } };
  };
  const s = await metaSpending({}, tenant, graph, { now: NOW });
  assert.equal(s.available, true); assert.equal(s.currency, 'INR'); assert.equal(s.fundingLinked, true);
  assert.equal(s.totals.today, 1.72);
  assert.match(calls.find((p) => p.includes('pricing_analytics')), /^123\?fields=pricing_analytics\.start\(\d+\)\.end\(\d+\)\.granularity\(DAILY\)\.dimensions\(PRICING_CATEGORY,PRICING_TYPE,PHONE\)$/);
  assert.equal(s.billingUrl, billingUrl('123'));

  const refused = await metaSpending({}, tenant, async (p) => (p.includes('pricing') ? { ok: false, data: { error: { message: 'No permission' } } } : { ok: false, data: {} }));
  assert.equal(refused.available, false); assert.equal(refused.error, 'No permission'); assert.equal(refused.totals.month, 0);
  assert.ok((await metaSpending({}, { businessName: 'x' }, graph)).error, 'no WABA ID: explained');
  assert.equal((await metaSpending({ GRAPH_BASE_URL: 'fake' }, tenant, graph)).demo, true, 'test copy shows sample numbers');
});

test('Meta balance: exactly the figure copied from Meta Billing; warns only when it cannot cover waiting messages', () => {
  const b = balanceStatus({ amount: 89.81, setAt: '2026-11-25T14:50:00Z' });
  assert.deepEqual(b, { amount: 89.81, seenAt: '2026-11-25T14:50:00Z', needed: 0, short: false, empty: false }, 'no estimate, no counting down');
  assert.equal(balanceStatus({ amount: 89.81 }, { waitingCost: 100 }).short, true, '₹100 of waiting messages + GST > ₹89.81');
  assert.equal(balanceStatus({ amount: 0 }).empty, true);
  assert.ok(cleanBalance({ amount: -1 }).error); assert.ok(cleanBalance({ amount: 'abc' }).error);
  assert.equal(cleanBalance({ amount: '89.814' }).value.amount, 89.81);
  assert.equal(cleanBalance({ amount: null }).value, null, 'can be cleared');
  assert.equal(costSince([{ start: 100, cost: 1 }, { start: 200, cost: 2.5 }], 150000), 2.5);
});
