// Personal keys, 2-step codes, sessions, roles and the activity log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { totpCode, totpOk, createMember, memberByKey, revokeMember, startTwoStep, confirmTwoStep, checkTwoStep, signSession, verifySession,
  memberAuth, audit, recentActivity, describeAction, agentMayDo } from '../src/lib/team.js';

function d1Env() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), run: async () => { db.prepare(sql).run(...args); }, first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) });
  return { DB: { prepare: (s) => stmt(s), batch: async (arr) => { for (const s of arr) await s.run(); } }, TOKEN_ENCRYPTION_KEY: 'k'.repeat(44) };
}

test('2-step codes match the RFC 6238 test values (what authenticator apps show)', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
  assert.equal(await totpCode(secret, 59 * 1000), '287082');
  assert.equal(await totpCode(secret, 1111111109 * 1000), '081804');
  assert.equal(await totpCode(secret, 1234567890 * 1000), '005924');
  assert.ok(await totpOk(secret, '287082', 59 * 1000 + 25000), 'previous window still accepted');
  assert.ok(!(await totpOk(secret, '287082', 59 * 1000 + 95000)), 'old code rejected');
});

test('personal key → 2-step setup → code required; revoked keys and sessions stop working', async () => {
  const env = d1Env();
  const { key, member } = await createMember(env, { tenantId: 't1', name: 'Ravi', role: 'agent' });
  assert.match(key, /^bxm_/);
  let m = await memberByKey(env, key);
  assert.equal(m.name, 'Ravi');
  const { secret, uri } = await startTwoStep(env, m);
  assert.match(uri, /^otpauth:\/\/totp\//);
  m = await memberByKey(env, key);
  assert.equal(await confirmTwoStep(env, m, '000000'), false);
  assert.equal(await confirmTwoStep(env, m, await totpCode(secret)), true);
  m = await memberByKey(env, key);
  assert.equal(m.totp_on, 1);
  assert.equal(await checkTwoStep(env, m, '123456'), false);
  assert.equal(await checkTwoStep(env, m, await totpCode(secret)), true);
  const session = await signSession(env, memberAuth(m, 'Demo'), 1);
  assert.equal((await verifySession(env, session)).memberName, 'Ravi');
  assert.equal(await verifySession(env, session.slice(0, -3) + 'abc'), null, 'tampered');
  await revokeMember(env, member.id);
  assert.equal(await memberByKey(env, key), null);
  assert.equal(await verifySession(env, session), null, 'revoked person signed out everywhere');
});

test('roles: agents get the inbox only; the activity log names who did what', async () => {
  assert.ok(agentMayDo('GET', '/api/leads/t'));
  assert.ok(agentMayDo('POST', '/api/chats/t/919/messages'));
  assert.ok(agentMayDo('PATCH', '/api/chats/t/919'));
  assert.ok(!agentMayDo('PATCH', '/api/tenants/t'));
  assert.ok(!agentMayDo('DELETE', '/api/chats/t/919'));
  assert.ok(!agentMayDo('POST', '/api/leads/t/upload'));
  assert.ok(!agentMayDo('GET', '/api/team/t'));
  assert.equal(describeAction('POST', '/api/chats/t/919876543210/messages'), 'Sent a message to +9198…3210');
  assert.equal(describeAction('PATCH', '/api/tenants/t'), 'Changed settings (flow / profile / AI)');
  const env = d1Env();
  await audit(env, { memberName: 'Ravi', tenantId: 't1' }, 'Signed in');
  await audit(env, { role: 'admin' }, 'Changed products', '', 't1');
  const log = await recentActivity(env, 't1');
  assert.deepEqual(log.map((x) => `${x.actor}: ${x.action}`), ['Admin key: Changed products', 'Ravi: Signed in']);
});
