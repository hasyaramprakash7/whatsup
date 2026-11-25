// Watches the bot every 10 minutes (Cron Trigger) and alerts the admin's phone (free Web Push) when something
// is wrong: customers left without a reply, WhatsApp refusing messages, bot errors, team alerts failing.
// The same alert is not repeated within an hour. Events (errors) are kept 14 days.
import { sendPush } from './push.js';

const WINDOW_MIN = 30;          // look at the last 30 minutes
const REPLY_GRACE_MIN = 3;      // a customer message older than this with no answer counts as unanswered
const REPEAT_AFTER_MIN = 60;    // the same alert at most once an hour
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

const ready = new WeakMap(); // per database: tables created once
const ensureTables = (env) => {
  if (!ready.has(env.DB)) {
    ready.set(env.DB, env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT, kind TEXT NOT NULL, detail TEXT, at TEXT NOT NULL)`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS events_kind_at ON events (kind, at)'),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS monitor_alerts (key TEXT PRIMARY KEY, last_at TEXT NOT NULL, detail TEXT)`),
    ]).catch((err) => { ready.delete(env.DB); throw err; }));
  }
  return ready.get(env.DB);
};

/** Remembers an error (or other notable event) for the monitor. Never throws. */
export async function recordEvent(env, kind, detail, tenantId = null) {
  try {
    await ensureTables(env);
    await env.DB.prepare('INSERT INTO events (tenant_id, kind, detail, at) VALUES (?, ?, ?, ?)').bind(tenantId, kind, String(detail || '').slice(0, 500), new Date().toISOString()).run();
  } catch { /* monitoring must never break the bot */ }
}

/** What is wrong right now: [{ key, title, body }] (empty = all fine). */
export async function findProblems(env) {
  await ensureTables(env);
  const since = iso(WINDOW_MIN * 60000); const grace = iso(REPLY_GRACE_MIN * 60000);
  const problems = [];

  // 1) Customer messages with no answer (bot on, not a reaction / "ok"-type ack after the chat ended).
  const { results: unanswered } = await env.DB.prepare(`
    SELECT m.tenant_id, m.phone, MIN(m.created_at) AS at, COUNT(*) AS n FROM messages m
    JOIN leads l ON l.tenant_id = m.tenant_id AND l.phone = m.phone
    WHERE m.direction = 'in' AND m.created_at >= ? AND m.created_at <= ? AND l.bot_paused = 0 AND m.type NOT IN ('reaction', 'unsupported')
      AND lower(trim(COALESCE(m.text, ''))) NOT IN ('ok', 'okay', 'ok thanks', 'thanks', 'thank you', 'thankyou', 'tq', 'thx', 'k', 'kk', 'fine', 'done', 'bye', 'sure', 'yes', 'good', 'nice', 'super', '👍', '🙏', 'సరే', 'ఓకే', 'థాంక్స్', 'ధన్యవాదాలు', 'sare')
      AND NOT EXISTS (SELECT 1 FROM messages o WHERE o.tenant_id = m.tenant_id AND o.phone = m.phone AND o.direction = 'out' AND o.created_at >= m.created_at)
    GROUP BY m.tenant_id, m.phone`).bind(since, grace).all();
  if (unanswered.length >= 2) {
    problems.push({ key: 'unanswered', title: `⚠️ ${unanswered.length} customers got no reply`, body: `In the last ${WINDOW_MIN} minutes ${unanswered.length} chats had no answer from the bot. Open the Inbox to check.` });
  }

  // 2) WhatsApp refusing our messages.
  const failed = await env.DB.prepare(`SELECT COUNT(*) AS n, MAX(error) AS error FROM messages WHERE direction = 'out' AND status = 'failed' AND created_at >= ?`).bind(since).first();
  if ((failed?.n || 0) >= 3) problems.push({ key: 'failed_sends', title: `⚠️ WhatsApp refused ${failed.n} messages`, body: String(failed.error || 'Check the Inbox for red ticks.').slice(0, 160) });

  // 3) Bot errors.
  const errs = await env.DB.prepare(`SELECT COUNT(*) AS n, MAX(detail) AS detail FROM events WHERE kind IN ('flow_error', 'server_error') AND at >= ?`).bind(since).first();
  if ((errs?.n || 0) >= 3) problems.push({ key: 'errors', title: `⚠️ The bot hit ${errs.n} errors`, body: String(errs.detail || '').slice(0, 160) });

  // 4) Team alerts not reaching the team.
  const alerts = await env.DB.prepare(`SELECT COUNT(*) AS n, MAX(admin_alert_error) AS error FROM leads WHERE admin_alert_status = 'FAILED' AND admin_alert_at >= ?`).bind(since).first();
  if ((alerts?.n || 0) >= 1) problems.push({ key: 'team_alerts', title: `⚠️ ${alerts.n} team alert(s) failed`, body: String(alerts.error || '').slice(0, 160) });

  return problems;
}

/** Cron: find problems, alert the admin devices (once an hour per problem), tidy old events. */
export async function runMonitor(env) {
  const problems = await findProblems(env);
  const fresh = [];
  for (const p of problems) {
    const last = await env.DB.prepare('SELECT last_at FROM monitor_alerts WHERE key = ?').bind(p.key).first();
    if (last && Date.now() - new Date(last.last_at).getTime() < REPEAT_AFTER_MIN * 60000) continue;
    fresh.push(p);
    await env.DB.prepare('INSERT INTO monitor_alerts (key, last_at, detail) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET last_at = excluded.last_at, detail = excluded.detail')
      .bind(p.key, new Date().toISOString(), p.body).run();
  }
  if (fresh.length) {
    console.error('[Monitor]', fresh.map((p) => p.title).join(' | '));
    const { results: admins } = await env.DB.prepare("SELECT * FROM push_subscriptions WHERE scope = '*'").all().catch(() => ({ results: [] }));
    for (const s of admins) {
      for (const p of fresh) {
        await sendPush(env, s, { kind: 'alert', title: p.title, body: p.body, url: '/#/overview', tag: `monitor-${p.key}`, at: Date.now() }, { urgency: 'high' }).catch(() => {});
      }
    }
  }
  await env.DB.prepare('DELETE FROM events WHERE at < ?').bind(iso(14 * 24 * 3600e3)).run().catch(() => {});
  return { problems, alerted: fresh.map((p) => p.key) };
}

// ---------- daily summary (9 AM site time): yesterday at a glance, on the admin's and each business's phones ----------
const SUMMARY_HOUR = 9;
/** Local day [start, end) as ISO strings, `daysAgo` days before `now`, for a "+05:30"-style offset. */
export function localDay(now, offset = '+05:30', daysAgo = 1) {
  const [, sign, h, m] = /^([+-])(\d{2}):(\d{2})$/.exec(offset) || [, '+', '05', '30'];
  const off = (sign === '-' ? -1 : 1) * (Number(h) * 60 + Number(m)) * 60000;
  const local = new Date(now + off); local.setUTCHours(0, 0, 0, 0);
  const start = local.getTime() - off - daysAgo * 864e5;
  return { start: new Date(start).toISOString(), end: new Date(start + 864e5).toISOString(), label: new Date(start + off).toISOString().slice(0, 10), hour: new Date(now + off).getUTCHours() };
}

export async function dailySummary(env, now = Date.now(), { force = false } = {}) {
  await ensureTables(env);
  const day = localDay(now, env.SITE_UTC_OFFSET || '+05:30');
  if (!force && day.hour !== SUMMARY_HOUR) return null;
  const key = `daily-${day.label}`;
  if (!force && await env.DB.prepare('SELECT 1 FROM monitor_alerts WHERE key = ?').bind(key).first()) return null; // once a day
  await env.DB.prepare('INSERT INTO monitor_alerts (key, last_at, detail) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET last_at = excluded.last_at')
    .bind(key, new Date(now).toISOString(), 'daily summary').run();
  const { results } = await env.DB.prepare(`SELECT t.id, t.business_name AS name,
      (SELECT COUNT(*) FROM leads l WHERE l.tenant_id = t.id AND l.created_at >= ?1 AND l.created_at < ?2) AS newChats,
      (SELECT COUNT(DISTINCT m.phone) FROM messages m WHERE m.tenant_id = t.id AND m.direction = 'in' AND m.created_at >= ?1 AND m.created_at < ?2) AS chats,
      (SELECT COUNT(*) FROM leads l WHERE l.tenant_id = t.id AND l.booked_at IS NOT NULL AND l.updated_at >= ?1 AND l.updated_at < ?2) AS bookings,
      (SELECT COUNT(*) FROM messages m WHERE m.tenant_id = t.id AND m.direction = 'out' AND m.status = 'failed' AND m.created_at >= ?1 AND m.created_at < ?2) AS failed
    FROM tenants t WHERE t.is_active = 1`).bind(day.start, day.end).all();
  const errors = (await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE at >= ? AND at < ?').bind(day.start, day.end).first())?.n || 0;
  const line = (r) => `${r.chats} chats (${r.newChats} new) · ${r.bookings} visits booked${r.failed ? ` · ${r.failed} not delivered` : ''}`;
  const total = results.reduce((a, r) => ({ chats: a.chats + r.chats, newChats: a.newChats + r.newChats, bookings: a.bookings + r.bookings, failed: a.failed + r.failed }), { chats: 0, newChats: 0, bookings: 0, failed: 0 });
  const { results: subs } = await env.DB.prepare('SELECT * FROM push_subscriptions').all().catch(() => ({ results: [] }));
  let sent = 0;
  for (const s of subs) {
    const mine = s.scope === '*' ? null : results.find((r) => r.id === s.scope);
    if (s.scope !== '*' && !mine) continue;
    const body = mine ? line(mine) : `${line(total)}${errors ? ` · ${errors} bot problems` : ' · no problems'}${results.length > 1 ? `\n${results.filter((r) => r.chats).map((r) => `${r.name}: ${r.chats} chats, ${r.bookings} booked`).join('\n')}` : ''}`;
    await sendPush(env, s, { kind: 'summary', title: `Yesterday (${day.label})`, body: body.slice(0, 400), url: mine ? '/#/leads' : '/#/overview', tag: key, at: now }, { urgency: 'normal' }).then(() => sent++).catch(() => {});
  }
  console.log(`[Monitor] daily summary for ${day.label} sent to ${sent} device(s)`);
  return { day: day.label, total, errors, perBusiness: results, sent };
}
