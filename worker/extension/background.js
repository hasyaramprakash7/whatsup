// Bluxury Meta Helper: the dashboard (only the Bluxury sites listed in the manifest) asks this extension to open a Meta
// page, read it, or click / type one thing. It works only on facebook.com / meta.com pages, in one tab it opens itself.
const META = /^https:\/\/([a-z0-9-]+\.)*(facebook\.com|meta\.com|whatsapp\.com|fb\.com)\//i;
const DASHBOARDS = /^(https:\/\/whatsapp-agent(-staging)?\.hasya7893828468\.workers\.dev|http:\/\/localhost(:\d+)?|http:\/\/127\.0\.0\.1(:\d+)?)$/;

let helperTab = null; // the Meta tab the helper works in

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tabAlive(id) { try { return await chrome.tabs.get(id); } catch { return null; } }

function waitLoaded(tabId, timeout = 25000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(on); clearTimeout(t); setTimeout(resolve, 1500); };
    const on = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    const t = setTimeout(finish, timeout);
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') finish(); }).catch(finish);
  });
}

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['page-agent.js'] });
}
async function run(tabId, fn, args = []) {
  await inject(tabId);
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: fn, args });
  return res?.result;
}

async function metaTab() {
  const t = helperTab != null ? await tabAlive(helperTab) : null;
  if (!t) throw new Error('No Meta tab yet. Open a Meta page first.');
  if (!META.test(t.url || '')) throw new Error(`The helper tab is not on a Meta page (${t.url || 'loading'}).`);
  return t;
}

async function handle(msg) {
  switch (msg.cmd) {
    case 'ping': return { ok: true, version: chrome.runtime.getManifest().version, tab: helperTab != null && !!(await tabAlive(helperTab)) };
    case 'open': {
      if (!META.test(msg.url || '')) throw new Error('Only Meta pages can be opened.');
      let t = helperTab != null ? await tabAlive(helperTab) : null;
      if (t) await chrome.tabs.update(t.id, { url: msg.url, active: true });
      else {
        // a window next to the dashboard, so the person sees both the chat and Meta
        const L = msg.layout || {};
        const opts = { url: msg.url, focused: true, type: 'normal' };
        for (const k of ['left', 'top', 'width', 'height']) if (Number.isFinite(L[k]) && L[k] >= 0) opts[k] = Math.round(L[k]);
        let w; try { w = await chrome.windows.create(opts); } catch { w = await chrome.windows.create({ url: msg.url, focused: true }); }
        t = w.tabs[0]; helperTab = t.id;
      }
      await waitLoaded(t.id);
      return { ok: true, result: `opened ${msg.url}` };
    }
    case 'observe': {
      const t = await metaTab();
      if (t.status !== 'complete') await waitLoaded(t.id, 10000);
      await run(t.id, () => globalThis.__bx.settle()).catch(() => {});
      const obs = await run(t.id, () => globalThis.__bx.observe());
      return { ok: true, observation: obs };
    }
    case 'act': {
      const t = await metaTab();
      const before = t.url;
      let result;
      try { result = await run(t.id, (a) => globalThis.__bx.act(a), [msg.action]); } catch { result = null; }
      if (result == null) result = 'done (the page changed or reloaded)';
      const after = await tabAlive(t.id);
      if (after && after.url !== before) await waitLoaded(t.id, 15000);
      return { ok: true, result };
    }
    case 'show': { // bring the Meta tab to the front so the person can do their part (login, OTP, payment)
      const t = await metaTab().catch(() => null); if (!t) return { ok: false };
      await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true });
      return { ok: true };
    }
    case 'adopt': { // use the Meta tab the person already has open
      const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!t || !META.test(t.url || '')) throw new Error('Open the Meta page in the active tab first.');
      helperTab = t.id; return { ok: true };
    }
    default: throw new Error(`unknown command ${msg.cmd}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : '');
  if (!DASHBOARDS.test(origin)) { reply({ ok: false, error: 'Not allowed from this site.' }); return false; }
  handle(msg).then(reply, (err) => reply({ ok: false, error: err.message }));
  return true; // async reply
});

chrome.tabs.onRemoved.addListener((id) => { if (id === helperTab) helperTab = null; });
void sleep;
