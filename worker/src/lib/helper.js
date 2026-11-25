// AI helper that sets up a business's own Meta / WhatsApp account by working in the person's own Chrome (through the
// "Bluxury Meta Helper" extension), like a person sitting next to them: it opens Meta pages, reads them, clicks and
// types, and stops to ask the person whenever only they can do something (log in, OTP, payment, choices).
// The model is Cloudflare Workers AI (free daily allowance). The access token it finds is never sent to the model:
// the extension reports only "a token is on the page", and the dashboard keeps the real value.

export const HELPER_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const HELPER_FALLBACK = '@cf/mistralai/mistral-small-3.1-24b-instruct';
export const DAILY_STEPS = 400; // across all businesses: keeps the free AI allowance for the WhatsApp bot
export const ALLOWED_HOSTS = ['facebook.com', 'meta.com', 'whatsapp.com', 'fb.com'];

/** What the helper can do for the person, with the route it follows (Meta's pages as of Nov 2026). */
export const TASKS = {
  ids: {
    title: 'Find my WhatsApp IDs',
    goal: 'Find this person\'s WhatsApp Business Account ID (also called WABA ID or "Messaging Account ID") and the Phone number ID of their WhatsApp number, then save both.',
    route: [
      'Open https://developers.facebook.com/apps/ and open their app that has WhatsApp (click the app name).',
      'In the app, open "Use cases", then "Customize" next to "Connect on WhatsApp" (or the left menu "WhatsApp" → "API Setup").',
      'Open "Step 2. Production setup" and expand "Register your WhatsApp phone number". It lists "Messaging Account ID: <digits>" and, under each number, "Phone Number ID: <digits>".',
      'The FOUND section of the page lists these numbers when they are on screen. Save them with a save action. If there are several numbers, ask the person which one.',
      'Other place with the account ID: https://business.facebook.com/latest/settings/whatsapp_account (WhatsApp accounts → click the account → "ID").',
    ],
  },
  token: {
    title: 'Create my permanent access key',
    goal: 'Create a permanent access token (a System user token that never expires) with whatsapp_business_messaging and whatsapp_business_management, and save it.',
    route: [
      'Open https://business.facebook.com/latest/settings/system_users .',
      'If there is no system user yet: click "Add", name it "Bluxury WhatsApp bot", role "Admin", then "Create system user".',
      'Select the system user. Click "Assign assets" (or "Add assets"): under Apps pick their WhatsApp app with "Full control"; under WhatsApp accounts pick their account with "Full control". Save.',
      'Click "Generate token". Select app: their WhatsApp app → Next. Token expiry: "Never" → Next.',
      'Permissions: tick "whatsapp_business_messaging" and "whatsapp_business_management" (type "whatsapp" in the search box). Click "Generate token".',
      'The token appears once. When FOUND shows a token, do a save action with "token":"page". Then click "Done".',
    ],
  },
  setup: {
    title: 'Create my Meta business + WhatsApp app',
    goal: 'Create a Meta developer app with the WhatsApp use case connected to the person\'s business portfolio (creating the portfolio if needed), register their WhatsApp number, then find and save the WABA ID and Phone number ID.',
    route: [
      'Open https://developers.facebook.com/apps/ . If Meta asks to register as a developer, ask the person to finish that (it needs their phone).',
      'Click "Create App". App name: ask the person (suggest "<their business> WhatsApp"). Email is filled already. Next.',
      'Use cases: tick "Connect with customers through WhatsApp". Next.',
      'Business: choose their business portfolio. If they have none, click "Create a business portfolio": portfolio name = their business name, first name, surname, business email (ask the person for any you do not know). Next.',
      'Requirements → Next. Overview → "Go to dashboard" / "Create app". If Meta asks for the Facebook password again, ask the person to type it.',
      'In the app: "Use cases" → "Customize" (Connect on WhatsApp) → "Step 2. Production setup" → "Register your WhatsApp phone number" → "Add new number": display name, category, the phone number. Meta sends an OTP: ask the person for the code or to type it.',
      '"Add payment to send business-initiated messages": the person must add UPI or a card themselves (ask them).',
      'Then do the "ids" steps: save the Messaging Account ID and the Phone Number ID.',
    ],
  },
  balance: {
    title: 'Read my Meta balance',
    goal: 'Open the Meta billing page of this WhatsApp account and read "Available funds", then save it.',
    route: [
      'Open the billing page given in FACTS (or https://business.facebook.com/billing_hub/accounts).',
      'Pick the account of this business if a list is shown. "Available funds" shows the amount. FOUND lists it as balance; save it with {"type":"save","fields":{"balance":"<amount>"}} and then finish.',
    ],
  },
};

const SYSTEM = `You are the setup helper inside the Bluxury WhatsApp dashboard. You control the person's own Chrome tab on Meta's website, one action at a time, to complete a task for them. Talk like a friendly person helping a small business owner in India: short, simple English.

Each turn you get: the TASK and its ROUTE (how Meta's pages work), FACTS, the HISTORY of your earlier actions with results, and the PAGE (url, title, FOUND values, visible text, and numbered interactive elements like [12] button "Create App").

Reply with ONE JSON object only, no other text:
{"say": "<one short sentence for the person about what you are doing>", "action": {...}}

Actions:
{"type":"open","url":"https://..."}                  open a Meta page (facebook.com / meta.com only)
{"type":"click","id":12}                            click element [12]
{"type":"type","id":7,"text":"...","enter":false}  type into input [7] (replaces what is there)
{"type":"select","id":9,"option":"..."}             pick an option of a <select>
{"type":"scroll","direction":"down"}                see more of the page (or "up")
{"type":"wait","seconds":3}                          let the page load
{"type":"ask","question":"..."}                     ask the person (they answer in the chat, or do it themselves and say "done")
{"type":"save","fields":{"wabaId":"...","phoneNumberId":"...","token":"page","balance":"..."}}  save values you found (only the ones you have)
{"type":"done","summary":"..."}                     the task is finished (or cannot be finished: explain)

Rules:
- Use ONLY element ids that appear in the PAGE list. Never invent ids. If what you need is not listed, scroll or open the right page.
- Never type passwords, OTP codes, card or UPI details, or anything secret, and never log in: ask the person to do it in the Meta tab, then continue when they say done.
- Ask the person before choices that matter (business name, which number, app name) unless they already told you (see HISTORY).
- Never delete, remove, revoke or disconnect anything. Never click "Revoke tokens", "Remove", "Delete" or "Disconnect".
- Do not repeat the same action more than twice if the page does not change; try another way or ask.
- IDs: copy digits exactly from FOUND or the page text. Token: always "token":"page" (the app takes it from the page itself).
- Follow the ROUTE. When everything is saved, reply done.`;

/** Turns one page snapshot into the short text the model reads. */
export function describePage(obs) {
  if (!obs) return 'PAGE: (no Meta tab open yet)';
  const els = (obs.elements || []).slice(0, 90).map((e) => {
    const bits = [`[${e.id}] ${e.role || e.tag}`];
    if (e.label) bits.push(JSON.stringify(String(e.label).slice(0, 90)));
    if (e.type && !['button', 'submit'].includes(e.type)) bits.push(`type=${e.type}`);
    if (e.value) bits.push(`value=${JSON.stringify(String(e.value).slice(0, 60))}`);
    if (e.checked != null) bits.push(e.checked ? 'checked' : 'unchecked');
    if (e.disabled) bits.push('disabled');
    return bits.join(' ');
  });
  const f = obs.found || {};
  const found = [
    ...(f.ids || []).map((x) => `${x.label}: ${x.value}`),
    f.tokens ? `access token on the page: yes (${f.tokens} found)` : '',
    f.balance ? `balance (Available funds): ${f.balance}` : '',
  ].filter(Boolean);
  return [
    obs.loggedOut ? 'SIGNED OUT: the person is not logged in to Meta in this window. Ask them to log in there first.' : '',
    `PAGE url: ${obs.url || ''}`,
    `title: ${obs.title || ''}`,
    obs.dialog ? `A dialog is open: "${String(obs.dialog).slice(0, 80)}" (only its elements are listed)` : '',
    `FOUND: ${found.length ? found.join(' | ') : 'nothing yet'}`,
    `text: ${String(obs.text || '').replace(/\s+/g, ' ').slice(0, 1600)}`,
    `elements:\n${els.join('\n') || '(none visible)'}`,
  ].filter(Boolean).join('\n');
}

const actionText = (a) => (a ? JSON.stringify(a).slice(0, 200) : '');

/** Builds the chat for the model: rules, task, facts, recent history and the current page. */
export function buildMessages({ task, facts = {}, history = [], observation, reply }) {
  const t = TASKS[task] || TASKS.ids;
  const hist = history.slice(-14).map((h, i) => `${i + 1}. ${actionText(h.action)} → ${String(h.result || '').slice(0, 160)}`);
  const user = [
    `TASK: ${t.goal}`,
    `ROUTE:\n- ${t.route.join('\n- ')}`,
    `FACTS: ${Object.entries(facts).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`,
    `HISTORY:\n${hist.join('\n') || '(just started)'}`,
    reply ? `THE PERSON JUST SAID: ${String(reply).slice(0, 400)}` : '',
    describePage(observation),
    'Your JSON:',
  ].filter(Boolean).join('\n\n');
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

/** Pulls the first JSON object out of the model's reply (models sometimes add text or code fences). */
export function parseReply(raw) {
  if (raw && typeof raw === 'object') return raw.action ? raw : null;
  const s = String(raw || '');
  for (let start = s.indexOf('{'); start >= 0; start = s.indexOf('{', start + 1)) {
    let depth = 0; let inStr = false; let esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { const o = JSON.parse(s.slice(start, i + 1)); if (o && typeof o === 'object' && o.action) return o; } catch { /* next */ }
        break;
      }
    }
  }
  return null;
}

const hostAllowed = (url) => {
  try { const u = new URL(url); return u.protocol === 'https:' && ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)); } catch { return false; }
};
const DANGER = /\b(revoke|remove|delete|disconnect|deactivate|unlink|close account)\b/i;

/** Checks the model's action against the page and the safety rules; returns { action } or { error }. */
export function checkAction(reply, observation) {
  const a = reply?.action; if (!a || typeof a !== 'object') return { error: 'no action' };
  const ids = new Map((observation?.elements || []).map((e) => [Number(e.id), e]));
  const el = () => ids.get(Number(a.id));
  switch (a.type) {
    case 'open': return hostAllowed(a.url) ? { action: { type: 'open', url: String(a.url) } } : { error: `I can only open Meta pages, not ${a.url}` };
    case 'click': {
      const e = el(); if (!e) return { error: `element [${a.id}] is not on the page` };
      if (DANGER.test(e.label || '')) return { error: `I won't click "${e.label}" (it removes something)` };
      return { action: { type: 'click', id: Number(a.id) } };
    }
    case 'type': {
      const e = el(); if (!e) return { error: `element [${a.id}] is not on the page` };
      if (e.type === 'password' || /password|otp|cvv|card number|upi pin/i.test(e.label || '')) return { error: 'that is a password / code field: the person types it' };
      return { action: { type: 'type', id: Number(a.id), text: String(a.text ?? '').slice(0, 300), enter: !!a.enter } };
    }
    case 'select': return el() ? { action: { type: 'select', id: Number(a.id), option: String(a.option ?? '') } } : { error: `element [${a.id}] is not on the page` };
    case 'scroll': return { action: { type: 'scroll', direction: a.direction === 'up' ? 'up' : 'down' } };
    case 'wait': return { action: { type: 'wait', seconds: Math.min(Math.max(Number(a.seconds) || 2, 1), 8) } };
    case 'ask': return { action: { type: 'ask', question: String(a.question || 'Can you help with this step?').slice(0, 400) } };
    case 'save': {
      const f = a.fields || {}; const out = {};
      for (const k of ['wabaId', 'phoneNumberId']) if (/^\d{8,25}$/.test(String(f[k] || '').trim())) out[k] = String(f[k]).trim();
      if (f.token && (observation?.found?.tokens ?? 1) > 0) out.token = 'page'; // only when a token is really on the page
      const bal = Number(String(f.balance ?? '').replace(/[^\d.]/g, ''));
      if (f.balance != null && Number.isFinite(bal) && String(f.balance).trim() !== '') out.balance = bal;
      return Object.keys(out).length ? { action: { type: 'save', fields: out } } : { error: 'nothing valid to save (IDs are digits only)' };
    }
    case 'done': return { action: { type: 'done', summary: String(a.summary || 'Finished.').slice(0, 400) } };
    default: return { error: `unknown action "${a.type}"` };
  }
}

/** Counts helper steps per day (all businesses), so the free AI allowance stays available for the bot. */
export async function takeStep(env, tenantId, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const row = await env.DB.prepare('SELECT COALESCE(SUM(steps), 0) AS n FROM helper_usage WHERE day = ?').bind(day).first();
  if ((row?.n || 0) >= DAILY_STEPS) return false;
  await env.DB.prepare('INSERT INTO helper_usage (day, tenant_id, steps) VALUES (?, ?, 1) ON CONFLICT (day, tenant_id) DO UPDATE SET steps = steps + 1').bind(day, tenantId).run();
  return true;
}

/**
 * One step: ask the model what to do next on this page. A reply that is not valid is sent back once with the reason,
 * then the bigger fallback model gets a try.
 */
export async function nextStep(env, input) {
  // Logged out of Meta: only the person can log in, so ask straight away (no AI call needed).
  if (input.observation?.loggedOut && !/log ?in|logged|done|ok|yes/i.test(String(input.reply || ''))) {
    return { say: 'You are not logged in to Meta in the helper window.', action: { type: 'ask', question: 'Please log in to Facebook in the Meta window (your email/phone and password — I never type those). Tell me "done" when you are logged in.' }, model: null };
  }
  const messages = buildMessages(input);
  let lastError = '';
  for (const model of [HELPER_MODEL, HELPER_MODEL, HELPER_FALLBACK]) {
    const msgs = lastError ? [...messages, { role: 'user', content: `Your last reply was not usable: ${lastError}. Reply with ONE valid JSON object.` }] : messages;
    let raw;
    try { raw = (await env.AI.run(model, { messages: msgs, max_tokens: 400, temperature: 0.1 }))?.response; }
    catch (err) { lastError = `the AI did not answer (${err.message})`; continue; }
    const reply = parseReply(raw);
    if (!reply) { lastError = 'it was not one JSON object with "say" and "action"'; continue; }
    const { action, error } = checkAction(reply, input.observation);
    if (error) { lastError = error; continue; }
    return { say: String(reply.say || '').slice(0, 300), action, model };
  }
  return { say: 'I am not sure what to do on this page.', action: { type: 'ask', question: `I got stuck (${lastError}). Can you tell me what you see, or click the next step yourself and say "done"?` }, model: null };
}
