// Checks the STAGING copy the way a customer would: signed WhatsApp webhooks in, bot replies out
// (staging's pretend WhatsApp records every reply in the Inbox instead of sending it).
//   node scripts/staging-check.mjs smoke        one short conversation — must pass before a live deploy
//   node scripts/staging-check.mjs load 200     200 customers say "Hi" at the same moment; reports reply times
//   node scripts/staging-check.mjs flood        one number sends 40 messages in a few seconds; the bot must go quiet
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

const [mode = 'smoke', arg] = process.argv.slice(2);
try {
  if (mode === 'smoke') await smoke(); else if (mode === 'load') await load(Number(arg) || 200); else if (mode === 'flood') await flood();
  else throw new Error(`unknown mode ${mode}`);
} catch (err) { console.error(`❌ staging ${mode} failed: ${err.message}`); process.exit(1); }
