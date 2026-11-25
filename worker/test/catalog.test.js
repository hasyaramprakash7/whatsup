// Product captions and descriptions for Telugu customers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { itemCaptionTe } from '../src/lib/itemfields.js';
import { itemCaption } from '../src/lib/db.js';
import { translateCatalogs } from '../src/lib/lang.js';

const IT = { name: 'Skyline Towers 2 BHK', price: '₹95 Lakh', layout: 'real_estate', description: 'Gated community with clubhouse.',
  details: { config: '2 BHK', area: '1,250 sq.ft', floor: '14th floor', facing: 'North-East', possession: 'Ready to move', availability: 'Few left', address: 'Kokapet', pincode: '500075' } };

test('Telugu caption: labels, values and price in Telugu; name and place unchanged', () => {
  const c = itemCaptionTe(IT, itemCaption);
  assert.match(c, /^\*Skyline Towers 2 BHK\* — ₹95 లక్షలు/);
  assert.match(c, /అంతస్తు: 14వ\n/);
  assert.match(c, /ఫేసింగ్: ఈశాన్యం/);
  assert.match(c, /పొజెషన్: రెడీ టు మూవ్/);
  assert.match(c, /📍 Kokapet 500075/);
  assert.match(c, /Gated community/, 'English description until the Telugu one exists');
  const withTe = itemCaptionTe({ ...IT, details: { ...IT.details, te_description: 'క్లబ్‌హౌస్‌తో గేటెడ్ కమ్యూనిటీ.' } }, itemCaption);
  assert.match(withTe, /క్లబ్‌హౌస్‌తో/);
  assert.doesNotMatch(withTe, /Gated community/);
});

test('descriptions are translated once, again only when the English changes', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tenants (id TEXT, is_active INTEGER, flow TEXT); CREATE TABLE catalog_items (id TEXT, tenant_id TEXT, description TEXT, details TEXT);
    INSERT INTO tenants VALUES ('t', 1, '{"i18n":{"te":{"s.a.text":"x"}}}'), ('en-only', 1, '{}');
    INSERT INTO catalog_items VALUES ('a', 't', 'Gated community.', '{}'), ('b', 'en-only', 'English only business.', '{}'), ('c', 't', '', '{}');`);
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), run: async () => { db.prepare(sql).run(...args); }, all: async () => ({ results: db.prepare(sql).all(...args) }) });
  let calls = 0;
  const env = { DB: { prepare: (s) => stmt(s) }, AI: { run: async () => { calls++; return { response: 'గేటెడ్ కమ్యూనిటీ.' }; } } };
  assert.equal(await translateCatalogs(env), 1);
  assert.equal(JSON.parse(db.prepare("SELECT details FROM catalog_items WHERE id='a'").get().details).te_description, 'గేటెడ్ కమ్యూనిటీ.');
  assert.equal(await translateCatalogs(env), 0, 'not translated again');
  db.exec(`UPDATE catalog_items SET description = 'Gated community with pool.' WHERE id = 'a'`);
  assert.equal(await translateCatalogs(env), 1, 'English changed → translated again');
  assert.equal(calls, 2);
});
