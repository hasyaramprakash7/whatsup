// Runs inside a Meta page (injected by the extension): describes what is on screen and does one action.
// Everything stays in this tab; nothing here sends data anywhere. The access token and app secret found on a page are
// returned to the dashboard only (never to the AI), and password / card fields are never typed into.
(() => {
  if (globalThis.__bx) return;
  const INTERACTIVE = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="combobox"], [role="listbox"], [contenteditable="true"]';
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  let ids = new WeakMap(); let byId = new Map(); let next = 1;

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < -40 || r.top > innerHeight * 1.6 || r.right < 0 || r.left > innerWidth) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
  };
  /** The words a person would use for this element. */
  function labelOf(el) {
    const aria = el.getAttribute('aria-label'); if (aria) return clean(aria);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((i) => document.getElementById(i)?.innerText || '').join(' '); if (clean(t)) return clean(t); }
    if (el.labels?.length) return clean([...el.labels].map((l) => l.innerText).join(' '));
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      const ph = el.getAttribute('placeholder');
      // Meta forms put the question in text just above the box
      let p = el.parentElement; let above = '';
      for (let i = 0; i < 5 && p && !above; i++, p = p.parentElement) {
        const t = clean(p.innerText); if (t && t.length < 200) above = t;
      }
      return clean([above, ph].filter(Boolean).join(' · ')) || clean(el.name || el.id || '');
    }
    const txt = clean(el.innerText || el.textContent);
    if (txt) return txt.slice(0, 120);
    return clean(el.getAttribute('title') || el.getAttribute('alt') || el.querySelector('img')?.alt || el.getAttribute('data-testid') || '');
  }
  const SECRET = /password|passcode|otp|one-time|verification code|cvv|card number|upi pin/i;

  /** The open dialog on top (Meta shows most forms in dialogs): only its contents count. */
  function topDialog() {
    const ds = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter(visible);
    return ds.length ? ds[ds.length - 1] : null;
  }

  function found(root) {
    const text = root.innerText || '';
    const all = `${text}\n${[...root.querySelectorAll('input, textarea')].map((i) => i.value || '').join('\n')}`;
    const ids2 = []; const seen = new Set();
    const re = /(Phone number ID|Phone Number ID|Messaging Account ID|WhatsApp Business Account ID|WhatsApp business account ID|Business Account ID|WABA ID|App ID|Business ID|Account ID|\bID)\s*[:#]?\s*\n?\s*(\d{8,25})/g;
    let m; while ((m = re.exec(all))) { const k = `${m[1]}|${m[2]}`; if (!seen.has(k)) { seen.add(k); ids2.push({ label: m[1], value: m[2] }); } }
    const tokens = [...new Set(all.match(/EA[A-Za-z0-9]{60,}/g) || [])];
    const secrets = /App secret/i.test(text) ? [...new Set(all.match(/\b[a-f0-9]{32}\b/g) || [])] : [];
    const bal = /Available funds[\s\S]{0,60}?₹\s?([\d,]+(?:\.\d{1,2})?)/.exec(text);
    return { ids: ids2.slice(0, 12), tokens, secrets, balance: bal ? bal[1].replace(/,/g, '') : null };
  }

  function observe() {
    ids = new WeakMap(); byId = new Map(); next = 1;
    const dlg = topDialog(); const root = dlg || document.body;
    const elements = [];
    for (const el of root.querySelectorAll(INTERACTIVE)) {
      if (elements.length >= 110) break;
      if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
      if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
      const label = labelOf(el); const role = el.getAttribute('role') || '';
      if (!label && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) continue;
      const id = next++; ids.set(el, id); byId.set(id, el);
      const e = { id, tag: el.tagName.toLowerCase(), role: role || undefined, label: label.slice(0, 120) };
      if (el.tagName === 'INPUT') e.type = el.type;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { if (el.type !== 'password' && !SECRET.test(label)) e.value = /^EA[A-Za-z0-9]{40,}$/.test(el.value) ? '(access token)' : (el.value || '').slice(0, 60); }
      if (el.tagName === 'SELECT') e.value = el.selectedOptions?.[0]?.text || '';
      if (el.type === 'checkbox' || el.type === 'radio') e.checked = el.checked;
      else if (el.getAttribute('aria-checked')) e.checked = el.getAttribute('aria-checked') === 'true';
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') e.disabled = true;
      elements.push(e);
    }
    const f = found(root);
    // not logged in to Meta: a "Log in" button/link and no account menu, or a login page
    const loginWords = /^(log ?in|login|log into facebook|continue with facebook)$/i;
    const loggedOut = /\/(login|loginpage)(\/|\.php|\?|$)/.test(location.pathname) || /loginpage|checkpoint/.test(location.href)
      || (!!document.querySelector('input[name="pass"], input[type="password"][name*="pass"]') && !!document.querySelector('input[name="email"]'))
      || [...document.querySelectorAll('a, button, [role="button"]')].some((el) => visible(el) && loginWords.test(clean(el.innerText)));
    return {
      loggedOut,
      url: location.href, title: document.title,
      dialog: dlg ? clean(dlg.querySelector('h1,h2,h3,[role="heading"]')?.innerText || dlg.innerText).slice(0, 80) : null,
      // the page's own content first (menus repeat on every page and would push it out)
      text: clean(dlg ? root.innerText : `${(document.querySelector('main, [role="main"]') || root).innerText}
${root.innerText}`).slice(0, 2500),
      elements,
      // the dashboard keeps tokens / secrets; the AI only learns that they are there
      found: { ids: f.ids, tokens: f.tokens.length, secrets: f.secrets.length, balance: f.balance },
      _tokens: f.tokens, _secrets: f.secrets,
    };
  }

  const setNative = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const press = (el, key) => {
    for (const type of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode: key === 'Enter' ? 13 : 0, which: key === 'Enter' ? 13 : 0, bubbles: true }));
  };
  function realClick(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2;
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerover', o)); el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o)); el.focus?.();
    el.dispatchEvent(new PointerEvent('pointerup', o)); el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
  }

  async function act(a) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (a.type === 'scroll') { const d = topDialog(); const box = d?.querySelector('[style*="overflow"], [class*="scroll"]') || d; if (d && box.scrollHeight > box.clientHeight) box.scrollBy(0, a.direction === 'up' ? -500 : 500); else scrollBy(0, a.direction === 'up' ? -600 : 600); await sleep(600); return 'scrolled'; }
    const el = byId.get(Number(a.id));
    if (!el || !el.isConnected) return `element [${a.id}] is gone (the page changed); look again`;
    const label = labelOf(el);
    if (a.type === 'click') {
      if (/\b(revoke|remove|delete|disconnect|deactivate)\b/i.test(label)) return `refused: "${label}" removes something`;
      realClick(el); await sleep(900); return `clicked "${label.slice(0, 60)}"`;
    }
    if (a.type === 'type') {
      if (el.type === 'password' || SECRET.test(label)) return 'refused: password / code fields are for the person';
      el.scrollIntoView({ block: 'center' }); el.focus(); realClick(el);
      if (el.isContentEditable) { document.execCommand('selectAll', false, null); document.execCommand('insertText', false, a.text); }
      else setNative(el, a.text);
      if (a.enter) press(el, 'Enter');
      await sleep(500);
      return `typed "${String(a.text).slice(0, 40)}" into "${label.slice(0, 50)}"`;
    }
    if (a.type === 'select') {
      if (el.tagName === 'SELECT') {
        const opt = [...el.options].find((o) => clean(o.text).toLowerCase().includes(String(a.option).toLowerCase()));
        if (!opt) return `no option "${a.option}"`;
        el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); return `picked "${opt.text}"`;
      }
      realClick(el); await sleep(700);
      const opt = [...document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li')].filter(visible).find((o) => clean(o.innerText).toLowerCase().includes(String(a.option).toLowerCase()));
      if (!opt) return `opened the list but found no option "${a.option}"`;
      realClick(opt); await sleep(600); return `picked "${clean(opt.innerText).slice(0, 50)}"`;
    }
    return `unknown action ${a.type}`;
  }

  /** Waits until the page stops changing (Meta loads panels after the page itself), at most `max` ms. */
  async function settle(max = 9000) {
    const t0 = Date.now(); let last = -1; let same = 0;
    while (Date.now() - t0 < max) {
      const n = document.body.innerText.length + document.querySelectorAll('*').length;
      same = n === last ? same + 1 : 0; last = n;
      if (same >= 3 && !document.querySelector('[role="progressbar"], [aria-busy="true"]')) return true;
      await new Promise((r) => setTimeout(r, 350));
    }
    return false;
  }

  globalThis.__bx = { observe, act, settle, version: 2 };
})();
