// The only way to put a change live:  npm run deploy
//   1. all tests  2. backup of the live database  3. staging deploy  4. staging conversation check  5. live deploy  6. live health check
// Any step failing stops the release; customers never see an untested version.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const LIVE = 'https://whatsapp-agent.hasya7893828468.workers.dev';
const KEEP_DAYS = 30;
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const step = (n, label) => console.log(`\n━━ ${n}/6 ${label}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  step(1, 'tests'); run('npm test');

  step(2, 'backup of the live database');
  const dir = path.join(root, 'backups'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `db-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sql`);
  run(`npx wrangler d1 export whatsapp-agent --remote --output "${file}"`);
  if (!fs.existsSync(file) || fs.statSync(file).size < 1000) throw new Error('the backup file is missing or empty');
  console.log(`  saved ${path.relative(root, file)} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
  for (const f of fs.readdirSync(dir)) { // keep 30 days
    const p = path.join(dir, f);
    if (/^db-.*\.sql$/.test(f) && Date.now() - fs.statSync(p).mtimeMs > KEEP_DAYS * 864e5) fs.unlinkSync(p);
  }

  step(3, 'staging deploy'); run('npx wrangler d1 migrations apply whatsapp-agent-staging --remote --env staging'); run('npx wrangler deploy --env staging');
  step(4, 'staging conversation check'); await sleep(15000);
  try { run('node scripts/staging-check.mjs smoke'); } catch { await sleep(15000); run('node scripts/staging-check.mjs smoke'); } // one retry: a fresh deploy can take a moment to reach every server
  run('node scripts/staging-check.mjs campaign'); // bulk sending: daily limit, continue later, statuses, reply → project

  step(5, 'live deploy'); run('npx wrangler d1 migrations apply whatsapp-agent --remote'); run('npx wrangler deploy --env=""');
  step(6, 'live health check'); await sleep(5000);
  const h = await fetch(`${LIVE}/health`).then((r) => r.json()).catch(() => null);
  if (h?.status !== 'OK') throw new Error(`live /health says ${JSON.stringify(h)} — roll back with: npx wrangler rollback`);
  console.log('\n✅ released — live is healthy');
} catch (err) {
  console.error(`\n❌ release stopped: ${err.message}`);
  process.exit(1);
}
