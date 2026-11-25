// Bulk sending rules: daily limit, sending hours, template blanks, Meta errors, delivery statuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { parseMetaLimit, dailyLimit, cleanSending, sendingWindow, daysNeeded, templateShape, cleanParams, resolveParams, templateComponents,
  previewText, errorAction, usage, applyRecipientStatus, markReplied, costEach } from '../src/lib/campaigns.js';

test('daily limit: Meta live limit in auto, the typed number in manual', () => {
  assert.equal(parseMetaLimit('TIER_250'), 250);
  assert.equal(parseMetaLimit('TIER_2K'), 2000);
  assert.equal(parseMetaLimit('TIER_UNLIMITED'), Infinity);
  assert.equal(dailyLimit({}).limit, 250, 'nothing known yet: 250');
  assert.equal(dailyLimit({ sending: { metaLimit: 'TIER_2K' } }).limit, 2000, 'auto follows Meta the same day');
  const m = dailyLimit({ sending: { limitMode: 'manual', manualLimit: 2000, metaLimit: 'TIER_250' } });
  assert.deepEqual([m.limit, m.mode, m.aboveMeta], [2000, 'manual', true], 'a typed number wins, with a warning');
  assert.ok(cleanSending({ limitMode: 'manual' }).error, 'manual needs a number');
  assert.equal(cleanSending({ limitMode: 'manual', manualLimit: '2000' }).value.manualLimit, 2000);
  assert.ok(cleanSending({ startHour: 20, endHour: 9 }).error);
});

test('sending hours: 9 AM to 8 PM India time; at night it waits for 9 AM', () => {
  const s = { startHour: 9, endHour: 20 };
  assert.equal(sendingWindow(Date.parse('2026-11-25T05:00:00Z'), s, '+05:30').open, true); // 10:30 AM IST
  const night = sendingWindow(Date.parse('2026-11-25T16:00:00Z'), s, '+05:30'); // 9:30 PM IST
  assert.equal(night.open, false);
  assert.equal(new Date(night.nextOpenAt).toISOString(), '2026-11-26T03:30:00.000Z'); // 9 AM IST next day
  const early = sendingWindow(Date.parse('2026-11-25T01:00:00Z'), s, '+05:30'); // 6:30 AM IST
  assert.equal(new Date(early.nextOpenAt).toISOString(), '2026-11-25T03:30:00.000Z');
});

test('days needed: 1,000 people at 250 a day = 4 days; 2,000 limit = 1 day', () => {
  assert.equal(daysNeeded(1000, 250, 250), 4);
  assert.equal(daysNeeded(1000, 100, 250), 5);
  assert.equal(daysNeeded(1000, 2000, 2000), 1);
  assert.equal(daysNeeded(1000, 0, 250), 4);
  assert.equal(costEach({}, 'MARKETING'), 0.86);
});

test('templates: blanks, photo header, unsupported kinds; filled per customer', () => {
  const t = templateShape({ name: 'offer', language: 'en', category: 'MARKETING', status: 'APPROVED', components: [
    { type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hi {{1}}, {{2}} has 3BHK flats at {{3}}.' }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Stop promotions' }] }] });
  assert.deepEqual(t.vars, ['1', '2', '3']);
  assert.equal(t.header.format, 'IMAGE'); assert.equal(t.unsupported, null);
  assert.equal(templateShape({ name: 'v', components: [{ type: 'HEADER', format: 'VIDEO' }, { type: 'BODY', text: 'x' }] }).unsupported, 'video header');
  assert.ok(cleanParams([{ key: '1', src: 'name' }], t).error, 'every blank must be chosen');
  const p = cleanParams([{ key: '1', src: 'name' }, { key: '2', src: 'project' }, { key: '3', src: 'column', arg: 'Price' }], t).value;
  const v = resolveParams(p, { name: '', vars: { price: '₹95 L' }, business: 'Demo', item: { name: 'Skyline' } });
  assert.deepEqual(v.map((x) => x.text), ['there', 'Skyline', '₹95 L'], 'empty name gives "there"; columns match without case');
  assert.equal(previewText(t.body, v), 'Hi there, Skyline has 3BHK flats at ₹95 L.');
  const comps = templateComponents(v, { headerImage: 'https://x.test/a.jpg' });
  assert.equal(comps[0].parameters[0].image.link, 'https://x.test/a.jpg');
  assert.equal(comps[1].parameters.length, 3);
  const named = templateShape({ name: 'n', components: [{ type: 'BODY', text: 'Hi {{customer}}' }] });
  assert.equal(named.named, true);
  assert.equal(templateComponents([{ key: 'customer', text: 'Ravi' }], { named: true })[0].parameters[0].parameter_name, 'customer');
});

test('Meta errors: capped, not on WhatsApp, opted out; pause on payment, spam limit and template problems', () => {
  assert.equal(errorAction(131049), 'capped');
  assert.equal(errorAction(131026), 'invalid');
  assert.equal(errorAction(131050), 'opted_out');
  assert.equal(errorAction(131042), 'pause_payment');
  assert.equal(errorAction(131048), 'pause_meta');
  assert.equal(errorAction(132001), 'pause_template');
  assert.equal(errorAction(131000), null);
});

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE campaign_recipients (campaign_id TEXT, tenant_id TEXT, phone TEXT, name TEXT DEFAULT '', vars TEXT, status TEXT DEFAULT 'waiting', wa_message_id TEXT, error TEXT,
      attempts INTEGER DEFAULT 0, next_at TEXT, counted INTEGER DEFAULT 1, sent_at TEXT, replied_at TEXT, PRIMARY KEY (campaign_id, phone));
    CREATE TABLE leads (tenant_id TEXT, phone TEXT, reach_status TEXT, capped_until TEXT);`);
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), run: async () => { db.prepare(sql).run(...args); }, first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) });
  return { db, env: { DB: { prepare: (s) => stmt(s) } } };
}
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

test('limit usage: different people messaged first in the last 24 h; customers who wrote first do not count', async () => {
  const { db, env } = d1();
  const ins = db.prepare('INSERT INTO campaign_recipients (campaign_id, tenant_id, phone, status, sent_at, counted) VALUES (?,?,?,?,?,?)');
  ins.run('c1', 't', '1', 'sent', ago(2), 1); ins.run('c2', 't', '1', 'read', ago(1), 1); // same person twice = 1
  ins.run('c1', 't', '2', 'delivered', ago(23), 1);
  ins.run('c1', 't', '3', 'sent', ago(25), 1);  // older than 24 h
  ins.run('c1', 't', '4', 'sent', ago(1), 0);   // had written to us: free
  ins.run('c1', 't', '5', 'failed', ago(1), 1); // not delivered
  const u = await usage(env, 't');
  assert.equal(u.used, 2);
  assert.ok(Math.abs(u.freesAt - (Date.now() + 3600e3 + 60000)) < 5000, 'room again when the 23-hour-old one leaves the window');
});

test('delivery statuses: read never goes backwards; capped tries again in 24 h; not on WhatsApp never again', async () => {
  const { db, env } = d1();
  const ins = db.prepare("INSERT INTO campaign_recipients (campaign_id, tenant_id, phone, status, wa_message_id, sent_at) VALUES ('c', 't', ?, 'sent', ?, ?)");
  ins.run('1', 'w1', ago(1)); ins.run('2', 'w2', ago(1)); ins.run('3', 'w3', ago(1));
  db.exec("INSERT INTO leads VALUES ('t','2',NULL,NULL), ('t','3',NULL,NULL)");
  await applyRecipientStatus(env, 't', 'w1', 'read');
  await applyRecipientStatus(env, 't', 'w1', 'delivered');
  assert.equal(db.prepare("SELECT status FROM campaign_recipients WHERE phone = '1'").get().status, 'read');
  const capped = await applyRecipientStatus(env, 't', 'w2', 'failed', { code: 131049, message: 'cap' });
  assert.equal(capped.action, 'capped');
  const r2 = db.prepare("SELECT status, next_at, sent_at FROM campaign_recipients WHERE phone = '2'").get();
  assert.equal(r2.status, 'waiting'); assert.equal(r2.sent_at, null);
  assert.ok(Date.parse(r2.next_at) > Date.now() + 23 * 3600e3);
  await applyRecipientStatus(env, 't', 'w3', 'failed', { code: 131026, message: 'undeliverable' });
  assert.equal(db.prepare("SELECT status FROM campaign_recipients WHERE phone = '3'").get().status, 'invalid');
  assert.equal(db.prepare("SELECT reach_status FROM leads WHERE phone = '3'").get().reach_status, 'invalid');
  await markReplied(env, 't', '1');
  assert.ok(db.prepare("SELECT replied_at FROM campaign_recipients WHERE phone = '1'").get().replied_at);
});
