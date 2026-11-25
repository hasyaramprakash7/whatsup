// The 10-minute monitor: finds unanswered customers, refused messages, errors and failed team alerts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { findProblems, runMonitor, recordEvent } from '../src/lib/monitor.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE messages (tenant_id TEXT, phone TEXT, direction TEXT, type TEXT, status TEXT, error TEXT, created_at TEXT, text TEXT);
    CREATE TABLE leads (tenant_id TEXT, phone TEXT, bot_paused INTEGER DEFAULT 0, admin_alert_status TEXT, admin_alert_error TEXT, admin_alert_at TEXT);`);
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), run: async () => { db.prepare(sql).run(...args); }, first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) });
  return { db, env: { DB: { prepare: (s) => stmt(s), batch: async (arr) => { for (const s of arr) await s.run(); } } } };
}
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

test('all fine: answered chats, paused chats and fresh messages are not problems', async () => {
  const { db, env } = d1();
  db.exec(`INSERT INTO leads VALUES ('t','1',0,NULL,NULL,NULL), ('t','2',1,NULL,NULL,NULL), ('t','3',0,NULL,NULL,NULL)`);
  db.prepare('INSERT INTO messages (tenant_id, phone, direction, type, status, error, created_at) VALUES (?,?,?,?,?,?,?)').run('t', '1', 'in', 'text', 'received', null, ago(10));
  db.prepare('INSERT INTO messages (tenant_id, phone, direction, type, status, error, created_at) VALUES (?,?,?,?,?,?,?)').run('t', '1', 'out', 'text', 'read', null, ago(9));
  db.prepare('INSERT INTO messages (tenant_id, phone, direction, type, status, error, created_at) VALUES (?,?,?,?,?,?,?)').run('t', '2', 'in', 'text', 'received', null, ago(10)); // team handling (paused)
  db.prepare('INSERT INTO messages (tenant_id, phone, direction, type, status, error, created_at) VALUES (?,?,?,?,?,?,?)').run('t', '3', 'in', 'text', 'received', null, ago(1));  // still within 3 minutes
  assert.deepEqual(await findProblems(env), []);
});

test('problems: unanswered customers, refused messages, errors, failed team alerts', async () => {
  const { db, env } = d1();
  db.exec(`INSERT INTO leads VALUES ('t','1',0,NULL,NULL,NULL), ('t','2',0,'FAILED','132001: template missing','${ago(5)}')`);
  for (const p of ['1', '2']) db.prepare('INSERT INTO messages (tenant_id, phone, direction, type, status, error, created_at) VALUES (?,?,?,?,?,?,?)').run('t', p, 'in', 'text', 'received', null, ago(8));
  for (let i = 0; i < 3; i++) db.prepare('INSERT INTO messages (tenant_id, phone, direction, type, status, error, created_at) VALUES (?,?,?,?,?,?,?)').run('t', '9', 'out', 'text', 'failed', '131047: re-engagement', ago(5));
  for (let i = 0; i < 3; i++) await recordEvent(env, 'flow_error', 'boom');
  const keys = (await findProblems(env)).map((p) => p.key).sort();
  assert.deepEqual(keys, ['errors', 'failed_sends', 'team_alerts', 'unanswered']);
  const first = await runMonitor(env);
  assert.equal(first.alerted.length, 4);
  const again = await runMonitor(env);
  assert.equal(again.alerted.length, 0, 'not repeated within the hour');
});
