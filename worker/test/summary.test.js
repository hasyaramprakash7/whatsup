// The 9 AM daily summary: yesterday's chats, bookings and problems, once a day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { dailySummary, localDay } from '../src/lib/monitor.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tenants (id TEXT, business_name TEXT, is_active INTEGER);
    CREATE TABLE messages (tenant_id TEXT, phone TEXT, direction TEXT, status TEXT, created_at TEXT);
    CREATE TABLE leads (tenant_id TEXT, phone TEXT, booked_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE push_subscriptions (endpoint TEXT, scope TEXT);`);
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), run: async () => { db.prepare(sql).run(...args); }, first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) });
  return { db, env: { SITE_UTC_OFFSET: '+05:30', DB: { prepare: (s) => stmt(s), batch: async (arr) => { for (const s of arr) await s.run(); } } } };
}

test('local day: 9 AM IST on the 25th covers the whole of the 24th in India', () => {
  const d = localDay(Date.parse('2026-11-25T03:35:00Z'));
  assert.deepEqual(d, { start: '2026-11-23T18:30:00.000Z', end: '2026-11-24T18:30:00.000Z', label: '2026-11-24', hour: 9 });
});

test('daily summary: counts yesterday only, sent once, only at 9 AM', async () => {
  const { db, env } = d1();
  db.exec(`INSERT INTO tenants VALUES ('t','Demo',1);
    INSERT INTO leads VALUES ('t','1','2026-11-26T05:00:00Z','2026-11-24T05:00:00Z','2026-11-24T06:00:00Z'), ('t','2',NULL,'2026-11-20T05:00:00Z','2026-11-24T07:00:00Z'), ('t','3',NULL,'2026-11-25T05:00:00Z','2026-11-25T05:00:00Z');
    INSERT INTO messages VALUES ('t','1','in','received','2026-11-24T05:00:00Z'), ('t','2','in','received','2026-11-24T07:00:00Z'), ('t','3','in','received','2026-11-25T05:00:00Z'), ('t','2','out','failed','2026-11-24T07:01:00Z');`);
  assert.equal(await dailySummary(env, Date.parse('2026-11-25T05:00:00Z')), null, '10:30 AM: not the hour');
  const r = await dailySummary(env, Date.parse('2026-11-25T03:30:00Z'));
  assert.deepEqual(r.total, { chats: 2, newChats: 1, bookings: 1, failed: 1 });
  assert.equal(await dailySummary(env, Date.parse('2026-11-25T03:40:00Z')), null, 'once a day');
});
