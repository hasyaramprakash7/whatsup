import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floodCheck, FLOOD_LIMIT, FLOOD_QUIET_MS } from '../src/lib/flood.js';

const memory = () => { const m = new Map(); return { get: async (k) => m.get(k), put: async (k, v) => m.set(k, v) }; };

test('spam guard: a normal chat is never muted; a flood mutes once, then lifts', async () => {
  const s = memory(); let t = 1_000_000;
  for (let i = 0; i < 20; i++) assert.equal((await floodCheck(s, t += 5000)).quiet, false); // a message every 5 s, for ever
  const f = memory(); t = 5_000_000; const results = [];
  for (let i = 0; i < FLOOD_LIMIT + 5; i++) results.push(await floodCheck(f, t += 500));
  assert.equal(results.slice(0, FLOOD_LIMIT).every((r) => !r.quiet), true);
  assert.equal(results.filter((r) => r.started).length, 1, 'the team is alerted once');
  assert.equal(results.at(-1).quiet, true);
  assert.equal((await floodCheck(f, t + FLOOD_QUIET_MS + 61000)).quiet, false, 'answers again after the quiet time');
});
