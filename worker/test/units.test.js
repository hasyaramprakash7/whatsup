// Small rules that money, times and languages depend on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { detectLanguage, parseAmount, rupees, amountRange, timeWordsToEnglish, translateFlow } from '../src/lib/lang.js';
import { parseRequestedTime, checkLocalTime, formatSlotLong, buildVisitSlots, earliestSlot, localTimeString } from '../src/lib/slots.js';
import { validateFlow } from '../src/lib/flow.js';
import { aiDecide } from '../src/lib/ai.js';
import * as push from '../src/lib/push.js';
import { TENANT } from './fixtures/realestate.js';

const NOW = new Date('2026-11-25T04:00:00Z'); // Wed 25 Nov 2026, 9:30 AM IST

test('language: clear signals switch, "hi"/"ok"/numbers do not', () => {
  const cases = { 'నమస్తే': 'te', 'repu visit cheyocha': 'te', 'naaku villa kavali': 'te', 'Can I visit tomorrow?': 'en', 'In english': 'en', 'telugu lo matladandi': 'te', 'ఇంగ్లీష్ లో': 'en' };
  for (const [t, lang] of Object.entries(cases)) assert.equal(detectLanguage(t)?.lang, lang, t);
  for (const t of ['hi', 'ok', '2 bhk', '123', 'Sunil garu']) assert.equal(detectLanguage(t), null, t);
  assert.equal(detectLanguage('In english').explicit, true);
  assert.equal(detectLanguage('I want english medium school nearby').explicit, undefined);
});

test('money: amounts in words, digits and Telugu; never BHK or times', () => {
  const cases = { 'My budget is twenty lakhs': 20e5, '50 lakh': 50e5, 'నా బడ్జెట్ రెండు కోట్లు': 2e7, 'ఇరవై లక్షలు': 20e5, 'budget 1.5 cr': 1.5e7, 'around 75L': 75e5, 'one and a half crore': 1.5e7, '₹1.45 Cr': 1.45e7, '₹48 Lakh': 48e5 };
  for (const [t, v] of Object.entries(cases)) assert.equal(parseAmount(t), v, t);
  for (const t of ['2 BHK flat', '4 pm tomorrow', '3 crore? no, 3 BHK'.replace('3 crore? no, ', '')]) assert.equal(parseAmount(t), null, t);
  assert.equal(rupees(1.45e7), '₹1.45 Cr');
  assert.deepEqual(amountRange('₹85 Lakh - ₹1.2 Cr'), [85e5, 1.2e7]);
  assert.deepEqual(amountRange('₹1.8 Cr+'), [1.8e7, Infinity]);
});

test('times: English, Telugu and Tenglish; prices and BHK are not times', () => {
  const at = (t) => { const r = parseRequestedTime(t, NOW); return r && !r.error ? formatSlotLong(r.at) : r?.error || null; };
  assert.equal(at('tomorrow at 4 pm'), 'Thursday, 26 Nov 2026 at 4:00 PM');
  assert.equal(at('రేపు మూడు గంటలకి'), 'Thursday, 26 Nov 2026 at 3:00 PM');
  assert.equal(at('repu moodu gantalaki'), 'Thursday, 26 Nov 2026 at 3:00 PM');
  assert.equal(at('శనివారం సాయంత్రం 5 గంటలకు'), 'Saturday, 28 Nov 2026 at 5:00 PM');
  assert.equal(at('29 Nov 4 o clock'), 'Sunday, 29 Nov 2026 at 4:00 PM');
  assert.equal(at('today 9 pm'), 'hours');
  assert.equal(at('today at 10'), 'soon');
  for (const t of ['price ₹1.45 Cr', 'rendu bhk', 'Skyline Towers 3 BHK at 18 km']) assert.equal(parseRequestedTime(t, NOW), null, t);
  assert.equal(timeWordsToEnglish('eeroju naalugu gantalaku').replace(/\s+/g, ' ').trim(), "today 4 o'clock");
});

test('slots: Telugu buttons fit WhatsApp; earliest time respects lead time and hours', () => {
  for (const s of buildVisitSlots(NOW, 3, undefined, 'te')) assert.ok(s.title.length <= 20, s.title);
  assert.equal(formatSlotLong(new Date('2026-11-26T09:30:00Z'), 'te'), 'గురువారం, 26 నవంబర్ 2026, 3:00 PM');
  const first = earliestSlot(NOW, { from: '09:00', to: '19:00' });
  assert.ok(first.getTime() >= NOW.getTime() + 60 * 60000);
  assert.equal(localTimeString(first), '2026-11-25 11:00');
  assert.equal(checkLocalTime('2026-11-25 22:00', NOW).error, 'hours');
});

test('flow: Telugu texts are kept when valid and rejected when too long for WhatsApp', () => {
  const { value, errors } = validateFlow(TENANT.flow);
  assert.deepEqual(errors, []);
  assert.ok(Object.keys(value.i18n.te).length > 40);
  const bad = structuredClone(TENANT.flow);
  const opt = bad.steps.find((s) => s.id === 'budget').options[0];
  bad.i18n.te[`o.budget.${opt.id}.title`] = 'చాలా చాలా పొడవైన బటన్ టెక్స్ట్ ఇది సరిపోదు';
  assert.ok(validateFlow(bad).errors.some((e) => /longer than WhatsApp allows/.test(e)));
});

test('translation: a text that loses a {placeholder} stays in English', async () => {
  const env = { AI: { run: async (model, input) => {
    const keys = JSON.parse(input.messages[1].content);
    return { response: Object.fromEntries(Object.keys(keys).map((k) => [k, k === 's.home.text' ? 'ప్రాజెక్ట్‌లు' : `తెలుగు ${keys[k]}`])) };
  } } };
  const { te, skipped } = await translateFlow(env, TENANT.flow);
  assert.ok(skipped.includes('s.home.text'), 'missing {area} → skipped');
  assert.ok(te['s.area.text'].includes('{business}'));
});

test('AI replies never show internal codes', async () => {
  const env = { AI: { run: async () => ({ response: JSON.stringify({ action: 'answer', reply: 'Choose BUDGET_TIER_1 or OPT_P3_8BB21395 please', item_ids: [] }) }) } };
  const pending = { question: 'Budget?', options: [{ id: 'BUDGET_TIER_1', title: '₹85 Lakh - ₹1.2 Cr' }] };
  const d = await aiDecide(env, { tenant: TENANT, aiCfg: {}, pending, history: [{ direction: 'in', text: 'hi', sent_by: 'customer' }], catalog: [] });
  assert.equal(d.reply.includes('BUDGET_TIER'), false);
  assert.equal(d.reply.includes('OPT_'), false);
  assert.match(d.reply, /₹85 Lakh - ₹1.2 Cr/);
});

test('notification health: on time / late / blocked / waiting', async () => {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), run: async () => { db.prepare(sql).run(...args); }, first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) });
  const env = { DB: { prepare: (s) => stmt(s), batch: async (arr) => { for (const s of arr) await s.run(); } } };
  const E = 'https://fcm.googleapis.com/fcm/send/x';
  await push.saveSubscription(env, { scope: 't', endpoint: E, p256dh: 'a', auth: 'b', prefs: {} });
  const state = async () => push.deliveryHealth(await push.getSubscription(env, E)).state;
  let t = Date.now() - 2000; await push.markSent(env, E, t); await push.recordAck(env, E, { sentAt: t, awake: false });
  assert.equal(await state(), 'ok');
  t = Date.now() - 5 * 60e3; await push.markSent(env, E, t);
  assert.equal(await state(), 'waiting');
  await push.recordAck(env, E, { sentAt: t, awake: true });
  assert.equal(await state(), 'late');
  t = Date.now() - 6 * 60e3; await push.markSent(env, E, t); await push.recordAck(env, E, { sentAt: t, awake: true });
  assert.equal(await state(), 'blocked');
});
