// AI Meta helper: reading the model's reply, safety rules on each action, daily cap; connecting an own Meta account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { parseReply, checkAction, describePage, buildMessages, takeStep, nextStep, DAILY_STEPS } from '../src/lib/helper.js';
import { cleanConnect, verifyWithMeta } from '../src/lib/onboarding.js';

const page = { url: 'https://developers.facebook.com/apps/', title: 'Apps', text: 'Apps Create App', found: { ids: [{ label: 'Phone Number ID', value: '123456789012345' }], tokens: 1, balance: null },
  elements: [{ id: 1, tag: 'button', label: 'Create App' }, { id: 2, tag: 'input', type: 'text', label: 'App name' }, { id: 3, tag: 'input', type: 'password', label: 'Password' },
    { id: 4, tag: 'button', label: 'Revoke tokens' }, { id: 5, tag: 'input', type: 'text', label: 'Enter OTP code' }] };

test('model reply: the JSON is found even with extra words or code fences', () => {
  assert.equal(parseReply('Sure! ```json\n{"say":"Opening","action":{"type":"click","id":1}}\n```').action.id, 1);
  assert.equal(parseReply('{"say":"a { b","action":{"type":"wait","seconds":2}} trailing').action.type, 'wait');
  assert.equal(parseReply('no json here'), null);
  assert.equal(parseReply('{"say":"x"}'), null, 'needs an action');
});

test('safety: only Meta pages, only listed elements; never passwords, codes or "revoke"', () => {
  assert.ok(checkAction({ action: { type: 'open', url: 'https://business.facebook.com/latest/settings/system_users' } }, page).action);
  assert.ok(checkAction({ action: { type: 'open', url: 'https://evil.example.com/' } }, page).error);
  assert.ok(checkAction({ action: { type: 'open', url: 'http://facebook.com/' } }, page).error, 'https only');
  assert.ok(checkAction({ action: { type: 'open', url: 'https://facebook.com.evil.io/' } }, page).error);
  assert.ok(checkAction({ action: { type: 'click', id: 1 } }, page).action);
  assert.ok(checkAction({ action: { type: 'click', id: 99 } }, page).error, 'made-up element');
  assert.ok(checkAction({ action: { type: 'click', id: 4 } }, page).error, 'revoke refused');
  assert.ok(checkAction({ action: { type: 'type', id: 2, text: 'Sri Homes WhatsApp' } }, page).action);
  assert.ok(checkAction({ action: { type: 'type', id: 3, text: 'x' } }, page).error, 'password');
  assert.ok(checkAction({ action: { type: 'type', id: 5, text: '123456' } }, page).error, 'OTP');
  const s = checkAction({ action: { type: 'save', fields: { wabaId: '1665167448691064', phoneNumberId: 'abc', token: 'EAAxyz', balance: '₹ 89.81' } } }, page).action;
  assert.deepEqual(s.fields, { wabaId: '1665167448691064', token: 'page', balance: 89.81 }, 'IDs digits only; the token never comes from the model');
  assert.ok(checkAction({ action: { type: 'save', fields: { phoneNumberId: '12' } } }, page).error);
  assert.equal(checkAction({ action: { type: 'wait', seconds: 99 } }, page).action.seconds, 8);
});

test('what the model reads: page, found IDs, that a token exists (not the token), task route', () => {
  const d = describePage(page);
  assert.match(d, /\[1\] button "Create App"/);
  assert.match(d, /Phone Number ID: 123456789012345/);
  assert.match(d, /access token on the page: yes/);
  const m = buildMessages({ task: 'token', facts: { businessName: 'Sri Homes' }, history: [{ action: { type: 'click', id: 1 }, result: 'clicked' }], observation: page, reply: 'done' });
  assert.equal(m.length, 2);
  assert.match(m[1].content, /system_users/); assert.match(m[1].content, /businessName=Sri Homes/); assert.match(m[1].content, /THE PERSON JUST SAID: done/);
});

test('one step: a bad reply is corrected once; the answer is a safe action', async () => {
  const replies = ['I will click it', '{"say":"Clicking Create App","action":{"type":"click","id":1}}'];
  const env = { AI: { run: async () => ({ response: replies.shift() }) } };
  const out = await nextStep(env, { task: 'setup', observation: page, history: [] });
  assert.deepEqual(out.action, { type: 'click', id: 1 }); assert.equal(out.say, 'Clicking Create App');
  const stuck = await nextStep({ AI: { run: async () => ({ response: '{"say":"x","action":{"type":"click","id":42}}' }) } }, { task: 'ids', observation: page, history: [] });
  assert.equal(stuck.action.type, 'ask', 'never acts on a made-up element: asks the person');
});

test('daily cap: the free AI allowance is kept for the WhatsApp bot', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE helper_usage (day TEXT, tenant_id TEXT, steps INTEGER DEFAULT 0, PRIMARY KEY (day, tenant_id))');
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), run: async () => db.prepare(sql).run(...args), first: async () => db.prepare(sql).get(...args) ?? null });
  const env = { DB: { prepare: (s) => stmt(s) } };
  assert.equal(await takeStep(env, 't1'), true);
  db.exec(`UPDATE helper_usage SET steps = ${DAILY_STEPS}`);
  assert.equal(await takeStep(env, 't2'), false);
  assert.equal(await takeStep(env, 't2', Date.now() + 86400e3), true, 'new day');
});

test('connect own Meta account: form checks and Meta confirms the number is in the account', async () => {
  const good = { businessName: 'Sri Homes', wabaId: '111111111111111', phoneNumberId: '222222222222222', accessToken: `EAA${'x'.repeat(80)}`, adminNotificationPhone: '919876543210' };
  assert.ok(cleanConnect(good).value);
  assert.ok(cleanConnect({ ...good, wabaId: 'abc' }).errors);
  assert.ok(cleanConnect({ ...good, accessToken: 'hello' }).errors);
  assert.ok(cleanConnect({ ...good, appSecret: 'short' }).errors);
  assert.ok(cleanConnect({ ...good, adminNotificationPhone: '12' }).errors);
  const fake = (pnList) => async (url) => ({ ok: true, json: async () => (url.includes('/phone_numbers') ? { data: pnList.map((id) => ({ id })) } : { display_phone_number: '+91 90000 00001', verified_name: 'Sri Homes' }) });
  const v = cleanConnect(good).value;
  const ok = await verifyWithMeta({}, v, fake(['222222222222222']));
  assert.deepEqual([ok.ok, ok.checked, ok.verifiedName], [true, true, 'Sri Homes']);
  assert.equal((await verifyWithMeta({}, v, fake(['999']))).ok, false, 'number not in that account');
  const refused = await verifyWithMeta({}, v, async () => ({ ok: false, json: async () => ({ error: { message: 'Invalid OAuth access token.' } }) }));
  assert.match(refused.error, /Invalid OAuth/);
  assert.equal((await verifyWithMeta({ GRAPH_BASE_URL: 'fake' }, v)).checked, false, 'test copy');
});
