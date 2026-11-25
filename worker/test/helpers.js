// Plays a customer against the real conversation engine, with WhatsApp, the database and the AI replaced by
// in-memory fakes. Each message builds a new Conversation from the saved state, exactly like the Durable Object.
import { mock } from 'node:test';
import { TENANT, ITEMS } from './fixtures/realestate.js';

const lib = (f) => new URL(`../src/lib/${f}`, import.meta.url).href;

/**
 * Must be called once per test file, before anything imports engine.js.
 * Returns { newChat, ai } — set ai.decide to control what the "AI" answers, ai.geocode for typed places.
 */
export async function setup() {
  const realGeo = await import(`${lib('geo.js')}?real`);
  const ai = { decide: async () => null, geocode: async () => null, calls: 0 };
  const store = {};
  mock.module(lib('db.js'), { namedExports: {
    upsertLead: async (env, tid, phone, { set = {}, mergeData = {} } = {}) => {
      store.lead = { ...store.lead, ...set, data: { ...(store.lead?.data || {}), ...mergeData } };
      return store.lead;
    },
    recentTurns: async () => [{ direction: 'in', text: 'x', sent_by: 'customer' }],
    takeAiReply: async () => true,
    listCatalog: async () => ITEMS.map((x) => ({ ...x, imageUrl: `https://img.test/${x._id}.jpg`, details: { ...x.details } })),
    itemCaption: (it) => `*${it.name}* — ${it.price}`,
    layoutOf: () => 'real_estate',
  } });
  mock.module(lib('ai.js'), { namedExports: { aiDecide: async (...a) => { ai.calls++; return ai.decide(...a); } } });
  mock.module(lib('chatlog.js'), { namedExports: { publish: async () => {} } });
  mock.module(lib('geo.js'), { namedExports: {
    geocode: (...a) => ai.geocode(...a), reverseGeocode: async () => 'Somewhere',
    distanceKm: realGeo.distanceKm, kmLabel: realGeo.kmLabel, mapsLink: realGeo.mapsLink,
  } });
  const { Conversation } = await import(lib('engine.js'));

  /** A new customer (optionally with a known language). */
  function newChat({ language = null, phone = '919111111111' } = {}) {
    store.lead = { name: '', status: 'NEW', data: {}, language };
    const sent = [];
    const client = (who, failTemplate = false) => new Proxy({}, { get: (_, kind) => async (to, ...args) => {
      if (kind === 'template' && failTemplate) { const e = new Error('template'); e.text = '132001: template name (team_lead_alert) does not exist in en'; throw e; }
      sent.push({ who, kind, args });
      return { messages: [{ id: `wamid.test${sent.length}` }] };
    } });
    let state;
    const send = async (message) => {
      const from = sent.length;
      const c = new Conversation({ env: {}, tenant: structuredClone(TENANT), lead: store.lead, state, phone,
        bot: client('bot'), ai: client('ai'), admin: client('admin', true) });
      state = await c.handle(message);
      return sent.slice(from).map(view);
    };
    return {
      sent,
      get state() { return state; },
      get lead() { return store.lead; },
      text: (body) => send({ type: 'text', text: { body } }),
      voice: (body) => send({ type: 'text', voice: true, text: { body } }),
      unclearVoice: () => send({ type: 'audio', voice: true, unclear: true, audio: {} }),
      tap: (id) => send({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id } } }),
      pick: (id) => send({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id } } }),
      /** Taps the option whose title contains `title` in the last buttons/list the bot sent. */
      choose: (title) => {
        const o = lastOptions(sent).find((x) => x.title.toLowerCase().includes(String(title).toLowerCase()));
        if (!o) throw new Error(`no option "${title}" in ${JSON.stringify(lastOptions(sent).map((x) => x.title))}`);
        return send({ type: 'interactive', interactive: { type: o.kind, [o.kind]: { id: o.id, title: o.title } } });
      },
      options: () => lastOptions(sent),
    };
  }
  return { newChat, ai, TENANT, ITEMS };
}

/** A sent message as { who, kind, text, options }. */
function view(m) {
  const [a, b] = m.args;
  if (m.kind === 'buttons') return { who: m.who, kind: m.kind, text: a, options: b.map((x) => ({ id: x.id, title: x.title, kind: 'button_reply' })) };
  if (m.kind === 'list') return { who: m.who, kind: m.kind, text: a.body, options: a.sections.flatMap((s) => s.rows).map((r) => ({ id: r.id, title: r.title, kind: 'list_reply' })) };
  if (m.kind === 'image') return { who: m.who, kind: m.kind, text: b || '' };
  if (m.kind === 'location') return { who: m.who, kind: m.kind, text: a.name };
  if (m.kind === 'locationRequest') return { who: m.who, kind: m.kind, text: a };
  if (m.kind === 'template') return { who: m.who, kind: m.kind, text: (m.args[1] || []).join(' | ') };
  return { who: m.who, kind: m.kind, text: typeof a === 'string' ? a : JSON.stringify(a) };
}
function lastOptions(sent) {
  for (let i = sent.length - 1; i >= 0; i--) { const v = view(sent[i]); if (v.options) return v.options; }
  return [];
}
export const all = (replies) => replies.map((r) => r.text).join('\n');
