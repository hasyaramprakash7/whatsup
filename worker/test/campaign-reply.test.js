// A customer replies to a campaign about one project: straight to that project and the visit — no area or budget questions.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setup, all } from './helpers.js';

let newChat, ai, ITEMS;
before(async () => { ({ newChat, ai, ITEMS } = await setup()); });
const fresh = (itemId, lang = 'en') => ({ stepId: null, unexpected: 0, done: false, updatedAt: Date.now(), campaignItem: itemId, campaignLang: lang });

test('campaign reply "Hi": the project photo, then the name, then visit times', async () => {
  const it = ITEMS[0];
  const c = newChat({ state: fresh(it._id) });
  const r = await c.text('Hi');
  assert.equal(r[0].kind, 'image', 'the project photo first');
  assert.match(r[0].text, new RegExp(it.name));
  assert.doesNotMatch(all(r), /which area|budget|choose your language/i);
  const next = await c.text('Ravi');
  assert.ok(next.at(-1).options?.length, 'visit time buttons');
  assert.equal(c.lead.name, 'Ravi');
  assert.equal(c.state.campaignItem, null);
});

test('campaign reply with a question: photo, the AI answers, then it asks the next thing', async () => {
  const it = ITEMS[1];
  ai.decide = async () => ({ action: 'answer', reply: 'Yes, covered parking for every flat.', itemIds: [] });
  const c = newChat({ state: fresh(it._id) });
  const r = await c.text('Is there car parking?');
  assert.equal(r[0].kind, 'image');
  assert.match(all(r), /covered parking/);
  ai.decide = async () => null;
});

test('campaign in Telugu: the reply is in Telugu', async () => {
  const c = newChat({ state: fresh(ITEMS[0]._id, 'te') });
  const r = await c.text('Hi');
  assert.equal(r[0].kind, 'image');
  assert.equal(c.lead.language, 'te');
  assert.match(all(r.slice(1)), /[ఀ-౿]/);
});

test('no campaign project: the normal flow (language / area) as before', async () => {
  const c = newChat();
  const r = await c.text('Hi');
  assert.match(r[0].text, /choose your language/);
});
