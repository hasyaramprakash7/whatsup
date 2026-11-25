// Customers' files live in private storage; old ones are moved out of the public bucket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveInboundToPrivate } from '../src/lib/media.js';

function bucket(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    list: async ({ prefix, limit }) => ({ objects: [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((key) => ({ key })) }),
    get: async (k) => (m.has(k) ? { arrayBuffer: async () => m.get(k), httpMetadata: { contentType: 'audio/ogg' } } : null),
    head: async (k) => (m.has(k) ? {} : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
  };
}

test('customer files move to private storage; product photos stay public', async () => {
  const pub = bucket({ 'inbound/t/a.ogg': 'voice', 'inbound/t/b.jpg': 'photo', 'catalog/t/p.jpg': 'product' });
  const priv = bucket();
  assert.equal(await moveInboundToPrivate({ MEDIA: pub, PRIVATE_MEDIA: priv }), 2);
  assert.deepEqual([...pub.m.keys()], ['catalog/t/p.jpg']);
  assert.deepEqual([...priv.m.keys()].sort(), ['inbound/t/a.ogg', 'inbound/t/b.jpg']);
  assert.equal(await moveInboundToPrivate({ MEDIA: pub, PRIVATE_MEDIA: priv }), 0, 'nothing left to move');
});
