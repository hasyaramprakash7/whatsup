// Fills the STAGING copy with a demo real-estate business (flow, Telugu wording, projects) to try changes on.
// No real WhatsApp number: messages are not sent. Run:  node scripts/seed-staging.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TENANT, ITEMS } from '../test/fixtures/realestate.js';

const STAGING = 'https://whatsapp-agent-staging.hasya7893828468.workers.dev';
const vars = JSON.parse(fs.readFileSync(new URL('../.staging.vars', import.meta.url), 'utf8'));
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${vars.ADMIN_API_KEY}` };
const call = async (method, path, body) => {
  const r = await fetch(STAGING + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path}: ${d.error || r.status}`);
  return d;
};

const existing = (await call('GET', '/api/tenants')).data.find((t) => t.businessName === 'Demo Realty (staging)');
const tenant = existing || (await call('POST', '/api/tenants', {
  businessName: 'Demo Realty (staging)', industry: 'real_estate', phoneNumberId: '100000000000001',
  accessToken: 'staging-no-whatsapp', adminNotificationPhone: '919000000000',
})).data;
await call('PATCH', `/api/tenants/${tenant._id}`, { flow: TENANT.flow, ai: TENANT.ai, profile: { ...TENANT.profile, displayName: 'Demo Realty' } });

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const sql = ITEMS.map((it, i) => `INSERT OR REPLACE INTO catalog_items (id, tenant_id, name, category, description, price, active, sort, layout, details) VALUES (${[it._id, tenant._id, it.name, it.category, it.description, it.price].map(q).join(', ')}, 1, ${i}, ${q(it.layout || 'real_estate')}, ${q(JSON.stringify(it.details || {}))});`).join('\n');
const file = new URL('../.staging-seed.sql', import.meta.url);
fs.writeFileSync(file, sql);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'whatsapp-agent-staging', '--remote', '--env', 'staging', '--file', `"${fileURLToPath(file)}"`], { stdio: 'ignore', shell: true });
fs.unlinkSync(file);
console.log(`Staging ready: ${STAGING}  (business "${tenant.businessName}", ${ITEMS.length} projects). Sign in with ADMIN_API_KEY from worker/.staging.vars.`);
