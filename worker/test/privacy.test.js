// Deleting a customer on request, and the 1-year retention of chats and files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { forgetCustomer, applyRetention } from '../src/lib/privacy.js';

function setupEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE messages (id TEXT, tenant_id TEXT, phone TEXT, meta TEXT, created_at TEXT);
    CREATE TABLE leads (tenant_id TEXT, phone TEXT, name TEXT);`);
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), run: async () => ({ meta: { changes: db.prepare(sql).run(...args).changes } }), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) });
  const files = new Set(['inbound/t/aaa.ogg', 'inbound/t/bbb.jpg', 'inbound/t/old.ogg']);
  const forgotten = [];
  const env = {
    DB: { prepare: (s) => stmt(s) },
    PRIVATE_MEDIA: { delete: async (k) => { files.delete(k); } },
    CONVERSATION: { idFromName: (n) => n, get: (n) => ({ forget: async () => { forgotten.push(n); } }) },
  };
  return { db, env, files, forgotten };
}
const ago = (days) => new Date(Date.now() - days * 24 * 3600e3).toISOString();

test('delete one customer: their messages, files, lead and chat memory — nobody else\'s', async () => {
  const { db, env, files, forgotten } = setupEnv();
  const add = (id, phone, media, at = ago(1)) => db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(id, 't', phone, media ? JSON.stringify({ media }) : null, at);
  add('1', '911', 'aaa.ogg'); add('2', '911', null); add('3', '922', 'bbb.jpg');
  db.exec(`INSERT INTO leads VALUES ('t','911','Ravi'), ('t','922','Sita')`);
  const r = await forgetCustomer(env, 't', '911');
  assert.deepEqual(r, { messages: 2, files: 1, lead: true });
  assert.equal(files.has('inbound/t/aaa.ogg'), false);
  assert.equal(files.has('inbound/t/bbb.jpg'), true);
  assert.deepEqual(db.prepare('SELECT phone FROM leads').all().map((x) => x.phone), ['922']);
  assert.deepEqual(forgotten, ['t:911']);
});

test('retention: only messages older than the limit (and their files) are removed', async () => {
  const { db, env, files } = setupEnv();
  db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run('old', 't', '911', JSON.stringify({ media: 'old.ogg' }), ago(400));
  db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run('new', 't', '911', null, ago(10));
  assert.equal(await applyRetention(env, 365), 1);
  assert.deepEqual(db.prepare('SELECT id FROM messages').all().map((x) => x.id), ['new']);
  assert.equal(files.has('inbound/t/old.ogg'), false);
  assert.equal(await applyRetention(env, 365), 0);
});
