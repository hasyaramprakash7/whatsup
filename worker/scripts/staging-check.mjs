// Checks the STAGING copy the way a customer would: signed WhatsApp webhooks in, bot replies out
// (staging's pretend WhatsApp records every reply in the Inbox instead of sending it).
//   node scripts/staging-check.mjs smoke        one short conversation — must pass before a live deploy
//   node scripts/staging-check.mjs load 200     200 customers say "Hi" at the same moment; reports reply times
//   node scripts/staging-check.mjs flood        one number sends 40 messages in a few seconds; the bot must go quiet
//   node scripts/staging-check.mjs campaign     bulk sending: daily limit, continue later, statuses, reply → project
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const STAGING = process.env.STAGING_URL || 'https://whatsapp-agent-staging.hasya7893828468.workers.dev';
const PNID = '100000000000001'; // the staging demo business (scripts/seed-staging.mjs)
const vars = JSON.parse(fs.readFileSync(new URL('../.staging.vars', import.meta.url), 'utf8'));
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${vars.ADMIN_API_KEY}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path) => (await fetch(STAGING + path, { headers: H })).json();

let seq = 0;
/** One signed webhook, exactly like Meta sends it. */
async function send(phone, message) {
  const m = { from: phone, id: `wamid.check${Date.now()}${seq++}${Math.random().toString(36).slice(2, 6)}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message };
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'staging', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '910000000000', phone_number_id: PNID },
    contacts: [{ wa_id: phone, profile: { name: 'Staging Check' } }], messages: [m] } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', vars.META_APP_SECRET).update(body).digest('hex');
  const r = await fetch(`${STAGING}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig }, body });
  if (!r.ok) throw new Error(`webhook answered ${r.status}`);
}
const text = (body) => ({ type: 'text', text: { body } });
const button = (id, title) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const testPhone = () => `9199${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function tenantId() {
  const t = (await api('/api/tenants')).data?.find((x) => x.phoneNumberId === PNID);
  if (!t) throw new Error('staging demo business missing — run: node scripts/seed-staging.mjs');
  return t._id;
}
const outbound = async (tid, phone) => ((await api(`/api/chats/${tid}/${phone}/messages?limit=100`)).data || []).filter((m) => m.direction === 'out');
async function waitForReplies(tid, phone, atLeast, ms = 25000) {
  const end = Date.now() + ms;
  for (;;) {
    const out = await outbound(tid, phone).catch(() => []);
    if (out.length >= atLeast) return out;
    if (Date.now() > end) throw new Error(`no reply from the bot within ${ms / 1000}s (${out.length} replies, wanted ${atLeast})`);
    await sleep(1000);
  }
}
const forget = (tid, phone) => fetch(`${STAGING}/api/chats/${tid}/${phone}`, { method: 'DELETE', headers: H }).catch(() => {});

async function smoke() {
  const health = await fetch(`${STAGING}/health`).then((r) => r.json());
  if (health?.status !== 'OK') throw new Error(`health: ${JSON.stringify(health)}`);
  const tid = await tenantId(); const phone = testPhone(); const t0 = Date.now();
  await send(phone, text('Hi'));
  const first = await waitForReplies(tid, phone, 1);
  console.log(`  ✓ "Hi" answered in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await send(phone, button('LANG_en', 'English'));
  const next = await waitForReplies(tid, phone, first.length + 1);
  console.log(`  ✓ language choice answered (${next.length} bot messages so far)`);
  await forget(tid, phone);
  console.log('✅ staging smoke test passed');
}

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'whatsapp-agent-staging', '--remote', '--env', 'staging', '--json', '--command', `"${sql}"`], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out)[0].results;
}

async function load(n) {
  const tid = await tenantId();
  const phones = Array.from({ length: n }, testPhone);
  const t0 = Date.now(); let failed = 0;
  await Promise.all(phones.map((p) => send(p, text('Hi')).catch(() => { failed++; })));
  console.log(`  ${n} webhooks sent in ${((Date.now() - t0) / 1000).toFixed(1)}s (${failed} refused)`);
  await sleep(45000);
  const list = phones.map((p) => `'${p}'`).join(',');
  const rows = d1(`SELECT phone, MIN(CASE WHEN direction='in' THEN created_at END) AS a, MIN(CASE WHEN direction='out' THEN created_at END) AS b FROM messages WHERE tenant_id='${tid}' AND phone IN (${list}) GROUP BY phone`);
  const times = rows.filter((r) => r.a && r.b).map((r) => (Date.parse(r.b) - Date.parse(r.a)) / 1000).sort((x, y) => x - y);
  const pct = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))]?.toFixed(1);
  console.log(`  answered ${times.length}/${n} · reply time median ${pct(0.5)}s · 95% within ${pct(0.95)}s · slowest ${times.at(-1)?.toFixed(1)}s`);
  await Promise.all(phones.map((p) => forget(tid, p)));
  if (times.length < n * 0.98 || failed) throw new Error('not every customer got an answer');
  console.log('✅ load test passed');
}

async function flood() {
  const tid = await tenantId(); const phone = testPhone();
  for (let i = 0; i < 40; i++) { await send(phone, text(`spam ${i}`)); }
  // wait until the bot has worked through the backlog (no new reply for 10 s)
  let before = -1;
  for (let still = 0; still < 10; await sleep(1000)) { const n = (await outbound(tid, phone)).length; still = n === before ? still + 1 : 0; before = n; }
  for (let i = 0; i < 3; i++) await send(phone, text('Hi'));
  await sleep(15000);
  const after = (await outbound(tid, phone)).length;
  console.log(`  40 messages in → ${before} bot messages; 3 more afterwards → ${after - before} new replies`);
  await forget(tid, phone);
  if (after !== before) throw new Error('the bot kept answering after a flood');
  console.log('✅ spam guard works');
}

/** A delivery status from Meta (delivered / read / failed with an error code). */
async function status(waId, phone, st, error = null) {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'staging', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '910000000000', phone_number_id: PNID },
    statuses: [{ id: waId, status: st, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: phone, ...(error ? { errors: [error] } : {}) }] } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', vars.META_APP_SECRET).update(body).digest('hex');
  const r = await fetch(`${STAGING}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig }, body });
  if (!r.ok) throw new Error(`status webhook answered ${r.status}`);
}
const call = async (method, path, body) => {
  const r = await fetch(STAGING + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path}: ${d.error || r.status}`);
  return d;
};

/**
 * Bulk sending end to end: limit 50 with 120 people → 50 today, 70 wait; limit raised → the rest go;
 * delivered / read / "not on WhatsApp" statuses; a reply goes straight to the campaign's project.
 */
async function campaign() {
  const tid = await tenantId();
  const before = (await call('GET', `/api/campaigns/${tid}`)).limit;
  const restore = { limitMode: before.mode, manualLimit: before.manualLimit, startHour: before.startHour, endHour: before.endHour };
  const phones = Array.from({ length: 120 }, testPhone);
  try {
    await call('PUT', `/api/tenants/${tid}/sending`, { limitMode: 'manual', manualLimit: before.used + 50, startHour: 0, endHour: 24 });
    const item = (await call('GET', `/api/catalog/${tid}`)).data.find((x) => x.active && x.imageUrl) || (await call('GET', `/api/catalog/${tid}`)).data[0];
    const tpl = (await call('GET', `/api/campaigns/${tid}/templates`)).data[0];
    const fd = new FormData();
    fd.append('file', new Blob([`phone,name,project_name\n${phones.map((p, i) => `${p},Check ${i},${item.name}`).join('\n')}\n`], { type: 'text/csv' }), 'list.csv');
    fd.append('campaign', JSON.stringify({ templateName: tpl.name, templateLang: tpl.language, itemId: item._id, name: 'Staging check',
      params: tpl.vars.map((k, i) => ({ key: k, src: i === 0 ? 'name' : 'column', arg: i === 0 ? '' : 'project_name' })) }));
    const r = await fetch(`${STAGING}/api/campaigns/${tid}`, { method: 'POST', headers: { Authorization: H.Authorization }, body: fd });
    const created = await r.json();
    if (!r.ok) throw new Error(`create: ${created.error}`);
    const cid = created.campaign._id;
    console.log(`  campaign created: ${created.message}`);
    const stats = async () => (await call('GET', `/api/campaigns/${tid}`)).data.find((c) => c._id === cid);
    let c;
    for (let i = 0; i < 40; i++) { await sleep(2000); c = await stats(); if (c.status === 'waiting_limit' || c.stats.waiting <= 70) break; }
    await sleep(4000); c = await stats();
    console.log(`  limit 50: ${c.stats.accepted} sent, ${c.stats.waiting} waiting, status "${c.status}"`);
    if (c.stats.accepted !== 50 || c.stats.waiting !== 70 || c.status !== 'waiting_limit') throw new Error('the daily limit was not respected');

    await call('PUT', `/api/tenants/${tid}/sending`, { limitMode: 'manual', manualLimit: before.used + 1000 });
    for (let i = 0; i < 40; i++) { await sleep(2000); c = await stats(); if (c.status === 'done') break; }
    console.log(`  limit raised: ${c.stats.accepted} sent, ${c.stats.waiting} waiting, status "${c.status}"`);
    if (c.stats.accepted !== 120 || c.status !== 'done') throw new Error('the rest did not continue after the limit was raised');

    // statuses from Meta
    const list = phones.map((p) => `'${p}'`).join(',');
    const rows = d1(`SELECT phone, wa_message_id AS w FROM campaign_recipients WHERE campaign_id = '${cid}' AND phone IN (${list}) ORDER BY phone LIMIT 4`);
    await status(rows[0].w, rows[0].phone, 'delivered');
    await status(rows[1].w, rows[1].phone, 'delivered'); await status(rows[1].w, rows[1].phone, 'read'); await status(rows[1].w, rows[1].phone, 'delivered');
    await status(rows[2].w, rows[2].phone, 'failed', { code: 131026, title: 'Message undeliverable' });
    await status(rows[3].w, rows[3].phone, 'failed', { code: 131049, title: 'per-user marketing limit' });
    c = await stats();
    console.log(`  statuses: delivered ${c.stats.delivered + c.stats.read}, read ${c.stats.read}, not on WhatsApp ${c.stats.invalid}, held for 24 h ${c.stats.waiting}`);
    if (c.stats.read !== 1 || c.stats.delivered !== 1 || c.stats.invalid !== 1 || c.stats.waiting !== 1) throw new Error('delivery statuses were not applied');

    // a reply goes straight to the project
    const who = phones[10];
    const n0 = (await outbound(tid, who)).length;
    await send(who, text('Hi'));
    const out = await waitForReplies(tid, who, n0 + 1);
    const first = out.filter((m) => m.sentBy !== 'broadcast').at(-1) || out.at(-1);
    const all = out.map((m) => `${m.type}:${(m.text || '').slice(0, 40)}`).join(' | ');
    c = await stats();
    console.log(`  reply "Hi" → ${all.slice(0, 200)}`);
    if (!out.some((m) => m.sentBy !== 'broadcast' && ['image', 'text'].includes(m.type) && (m.text || '').includes(item.name)) || /language|area/i.test(all)) throw new Error(`the reply did not go to the project (${first?.type})`);
    if (c.stats.replied < 1) throw new Error('the reply was not counted');
    console.log(`  replied counted: ${c.stats.replied}`);
    await call('POST', `/api/campaigns/${tid}/${cid}/cancel`).catch(() => {});
    console.log('✅ campaign check passed');
  } finally {
    await call('PUT', `/api/tenants/${tid}/sending`, restore).catch((e) => console.warn('restore failed', e.message));
    for (let i = 0; i < phones.length; i += 20) await Promise.all(phones.slice(i, i + 20).map((p) => forget(tid, p)));
  }
}

const [mode = 'smoke', arg] = process.argv.slice(2);
try {
  if (mode === 'smoke') await smoke(); else if (mode === 'load') await load(Number(arg) || 200); else if (mode === 'flood') await flood(); else if (mode === 'campaign') await campaign();
  else throw new Error(`unknown mode ${mode}`);
} catch (err) { console.error(`❌ staging ${mode} failed: ${err.message}`); process.exit(1); }
