/* Bluxury WhatsApp AI — dashboard app (phone, tablet, desktop), served by the Cloudflare Worker. */
(() => {
  'use strict';

  // ============================================================
  // Utilities
  // ============================================================
  const API = '/api';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; return d; };
  const store = {
    get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
    set(k, v, s = localStorage) { try { v === null ? s.removeItem(k) : s.setItem(k, v); } catch { /* private mode */ } },
  };
  const rid = () => Math.random().toString(36).slice(2, 8);

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    grid: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    users: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20"/><circle cx="9.5" cy="7.5" r="3.5"/><path d="M21 20v-1.5a4 4 0 0 0-3-3.9M15.5 4.1a3.5 3.5 0 0 1 0 6.8"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 8h-6a3 3 0 0 0 0 6h6z"/><circle cx="16" cy="11" r=".8"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    bellOff: '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    up: '<path d="M18 15l-6-6-6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
    fire: '<path d="M12 22c4 0 7-2.7 7-7 0-5-5-7-5-12-2 2-3 4-3 6-1.5-1-2-2.5-2-4-2 2.5-4 5.4-4 9 0 4.3 3 8 7 8z"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
    reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    template: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
    food: '<path d="M3 2v7a3 3 0 0 0 3 3v10M9 2v7M6 2v7M18 2c-2 0-3 2-3 5v5h3v10"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  };
  const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.chat}</svg>`;
  const hydrateIcons = (root = document) => $$('[data-icon]', root).forEach((el) => { if (!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)); });
  const TICK1 = '<svg class="tick" viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l3 3 7-7"/></svg>';
  const TICK2 = (cls) => `<svg class="tick ${cls}" viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6l3 3 7-7"/><path d="M7 8.5l.5.5 7-7"/></svg>`;

  const AVATAR_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16'];
  const colorFor = (seed) => { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length]; };
  const initials = (name) => { const p = String(name || '').trim().split(/\s+/).filter(Boolean); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase(); };
  const avatar = (name, seed, cls = '') => { const ini = initials(name); return `<span class="avatar ${cls}" style="background:${colorFor(seed || name)}">${ini ? esc(ini) : icon('user', 'sm')}</span>`; };
  const displayName = (lead) => (lead?.name ? lead.name : `+${lead?.phone || ''}`);
  const fmtPhone = (p) => (p ? `+${p}` : '');

  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const timeOf = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function shortWhen(d) {
    if (!d) return '';
    const date = new Date(d); const now = new Date();
    if (sameDay(date, now)) return timeOf(date);
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(date, y)) return 'Yesterday';
    if (now - date < 6 * 864e5) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  function dayLabel(d) {
    const date = new Date(d); const now = new Date();
    if (sameDay(date, now)) return 'Today';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(date, y)) return 'Yesterday';
    return date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  const relTime = (d) => {
    if (!d) return '—';
    const s = Math.round((Date.now() - new Date(d)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  const wa = (text) => esc(text)
    .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>');

  const STATUS_LABELS = { NEW: 'New', CONTACTED: 'Contacted', ENGAGED: 'Engaged', QUALIFIED: 'Qualified', CONVERTED: 'Converted', COLD: 'Opted out' };
  const statusPill = (s) => `<span class="pill s-${esc(s)}">${esc(STATUS_LABELS[s] || s)}</span>`;
  const deliveryPill = (lead) => {
    if (lead.broadcastStatus) return `<span class="pill d-${esc(lead.broadcastStatus)}" ${lead.broadcastError ? `title="${esc(lead.broadcastError)}"` : ''}>${esc(lead.broadcastStatus[0] + lead.broadcastStatus.slice(1).toLowerCase())}</span>`;
    return lead.lastBroadcastAt ? '<span class="pill d-QUEUED">Queued</span>' : '<span class="muted">—</span>';
  };
  const bookedLabel = (lead) => (lead.bookedAt ? new Date(lead.bookedAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

  // ============================================================
  // Toasts, modal, activity log
  // ============================================================
  function toast(title, text = '', { kind = 'ok', onClick, timeout = 4500 } = {}) {
    const kinds = { ok: ['check', ''], error: ['alert', 'red'], info: ['info', 'blue'], chat: ['chat', ''], warn: ['alert', 'amber'] };
    const [ic, cls] = kinds[kind] || kinds.ok;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="section-icon ${cls}">${icon(ic, 'sm')}</span><div style="min-width:0"><strong>${esc(title)}</strong>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
    el.addEventListener('click', () => { onClick?.(); el.remove(); });
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), timeout);
  }
  function modal(html, { onMount, wide } = {}) {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${wide ? '' : 'max-width:560px'}">${html}</div>`;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    hydrateIcons(back);
    $$('[data-close]', back).forEach((b) => b.addEventListener('click', close));
    onMount?.(back, close);
    return close;
  }
  const LOG_KEY = 'agent_desk_logs';
  function log(message, type = 'info') {
    let logs = [];
    try { logs = JSON.parse(store.get(LOG_KEY)) || []; } catch { logs = []; }
    logs.push({ time: new Date().toLocaleString(), message, type });
    store.set(LOG_KEY, JSON.stringify(logs.slice(-300)));
    if (state.route.page === 'activity') renderActivity();
  }

  // ============================================================
  // State & API
  // ============================================================
  const KEY_STORAGE = 'agent_desk_api_key';
  const state = {
    auth: null, tenants: [], tenantId: null, tenant: null, fields: [], templates: [], catalog: [], catalogAll: [], catLayout: null,
    unreadChats: 0, live: null, route: { page: 'overview', arg: null }, inbox: null, builder: null, profileDraft: null, aiDraft: null,
  };
  const isAdmin = () => state.auth?.role === 'admin';
  const getKey = () => store.get(KEY_STORAGE, sessionStorage) || store.get(KEY_STORAGE);
  const bizName = () => state.tenant?.profile?.displayName || state.tenant?.businessName || '';

  async function authFetch(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${getKey()}` } });
    if (res.status === 401) { signOut('Your session expired or the key is no longer valid. Please sign in again.'); throw new Error('Not signed in'); }
    return res;
  }
  // Customer photos / voice notes / videos / documents: fetched with the API key, shown from a blob URL.
  const mediaCache = new Map();
  const mediaUrl = (tid, file) => {
    const k = `${tid}/${file}`;
    if (!mediaCache.has(k)) {
      mediaCache.set(k, authFetch(`${API}/media/${tid}/${file}`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); }).then((b) => URL.createObjectURL(b)));
      mediaCache.get(k).catch(() => mediaCache.delete(k));
    }
    return mediaCache.get(k);
  };
  function hydrateMedia(root = document) {
    root.querySelectorAll('[data-media]:not([data-state])').forEach((el) => {
      el.dataset.state = 'loading';
      mediaUrl(state.tenantId, el.dataset.media).then((url) => {
        const kind = el.dataset.kind;
        if (kind === 'image') { el.href = url; el.querySelector('img').src = url; }
        else if (kind === 'file') el.href = url;
        else el.src = url;
        el.dataset.state = 'ready';
      }).catch(() => {
        el.dataset.state = 'error';
        el.insertAdjacentHTML('afterend', '<div class="text muted small">Could not load this file.</div>');
      });
    });
  }
  new MutationObserver(() => hydrateMedia()).observe(document.documentElement, { childList: true, subtree: true });

  async function api(method, url, body) {
    const opts = { method };
    if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers = { 'Content-Type': 'application/json' }; }
    const tid = state.tenantId;
    const res = await authFetch(API + url, opts);
    const data = await res.json().catch(() => ({}));
    // Answer for a business that is no longer open (switched meanwhile): drop it so it never lands on the new one.
    if (tid && tid !== state.tenantId && url.includes(`/${tid}`)) return new Promise(() => {});
    if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.data = data; err.status = res.status; throw err; }
    return data;
  }
  async function uploadFile(url, file, extra = {}) {
    const fd = new FormData(); if (file) fd.append('file', file);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    const res = await authFetch(API + url, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `Upload failed (${res.status})`); err.data = data; throw err; }
    return data;
  }
  const errorList = (err) => {
    const list = err.data?.errors || [err.message];
    return `<div class="banner red">${icon('alert')}<div><strong>Please fix these:</strong><ul class="errors">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>`;
  };

  // ============================================================
  // Theme
  // ============================================================
  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
    const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    $('#theme-btn').innerHTML = icon(dark ? 'sun' : 'moon');
  }
  $('#theme-btn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    store.set('theme', next); applyTheme(next);
  });
  applyTheme(store.get('theme'));

  // ============================================================
  // Session
  // ============================================================
  let pendingKey = null; // the key of a sign-in that is waiting for its 2-step code
  /** Back to step 1 of sign-in (key), e.g. after signing out or signing in. */
  function resetLoginForm() {
    $('#code-field').hidden = true; $('#login-code').value = '';
    $('#api-key').required = true; $('#api-key').closest('.field').hidden = false;
  }
  function showLogin(message = '') {
    pendingKey = null; resetLoginForm();
    hideSplash();
    $('#shell').hidden = true; $('#login').hidden = false;
    $('#login-error').textContent = message;
    setTimeout(() => $('#api-key').focus(), 50);
  }
  function signOut(message = '') {
    if (state.auth) pushForget(); // this device stops getting this account's notifications
    store.set(KEY_STORAGE, null, sessionStorage); store.set(KEY_STORAGE, null);
    state.auth = null;
    disconnectLive();
    showLogin(message);
  }
  // Sign in: the key (and the 2-step code, when the key has it) is exchanged for a session; the key itself is not stored.
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('#api-key').value.trim() || pendingKey;
    if (!key) return;
    // Installed apps stay signed in (like any app: 30 days); untick on a shared computer (12 hours).
    const remember = $('#remember-me')?.checked !== false;
    const code = $('#login-code').value.trim();
    const btn = e.submitter || $('#login-form button[type=submit]'); btn.disabled = true;
    try {
      const res = await fetch('/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, code: code || undefined, remember }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.needsCode) {
          // Step 2: the key is remembered for this attempt; its box steps aside while the code is entered.
          pendingKey = key; $('#code-field').hidden = false; $('#api-key').value = ''; $('#api-key').required = false;
          $('#api-key').closest('.field').hidden = true; $('#login-code').value = ''; setTimeout(() => $('#login-code').focus(), 30);
        }
        $('#login-error').textContent = data.error || 'Could not sign in.';
        return;
      }
      pendingKey = null; resetLoginForm();
      store.set(KEY_STORAGE, null, sessionStorage); store.set(KEY_STORAGE, null);
      store.set(KEY_STORAGE, data.token, remember ? localStorage : sessionStorage);
      $('#api-key').value = ''; $('#login-error').textContent = '';
      await startSession();
    } catch { $('#login-error').textContent = 'No connection. Please try again.'; }
    finally { btn.disabled = false; }
  });
  $('#logout').addEventListener('click', () => { log('Signed out.'); signOut(); });
  $('#menu-btn').addEventListener('click', () => $('#shell').classList.toggle('nav-open'));

  // ---- Splash (opening screen) ----
  const splashStart = Date.now();
  function hideSplash() {
    const el = $('#splash'); if (!el || el.classList.contains('out')) return;
    // A short, calm opening in the installed app; instant in a browser tab.
    const min = matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 1500 : 300;
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, Math.max(0, min - (Date.now() - splashStart)));
  }

  // ---- App features (shown on sign-in, in the menu and when installing) ----
  const FEATURES = [
    ['chat', 'Live WhatsApp inbox', 'Every chat appears the moment it happens. Reply, send photos and take over from the bot any time.'],
    ['sparkle', 'AI assistant, 24×7', 'Answers prices, timings and FAQs — even voice notes — from your own business details, on the hours you choose.'],
    ['layers', 'Flow Builder', 'Ready-made conversations for your industry. Change every question, button and reply.'],
    ['image', 'Products & services', 'Photos with names and prices that the bot and AI send to customers.'],
    ['calendar', 'Bookings & time slots', 'Customers pick a time; every confirmed booking lands in one list you can export.'],
    ['megaphone', 'Broadcast offers', 'Send approved offers to a CSV list or numbers you type in — with delivery tracking.'],
    ['users', 'Leads & follow-up', 'Every customer with status, answers and history. Filter, search and export.'],
    ['bell', 'Instant notifications', 'New messages, bookings and customers who need a person — on your phone, even when the app is closed.'],
    ['shield', 'Private & secure', 'Your own key, encrypted WhatsApp access, opt-outs respected automatically.'],
    ['download', 'Works like an app', 'Install on Android, iPhone, tablet or computer. Opens full screen from your home screen.'],
  ];
  const featureHtml = (cls = 'hero-feature') => FEATURES.map(([ic, t, d]) => `<div class="${cls}"><span class="dot">${icon(ic)}</span><div><strong>${t}</strong>${d}</div></div>`).join('');
  if ($('#hero-features')) $('#hero-features').innerHTML = featureHtml();
  function showFeatures() {
    $('#shell').classList.remove('nav-open');
    modal(`<div class="features-head" role="img" aria-label="Bluxury WhatsApp AI"><div class="brand-tag">WhatsApp AI</div><p>Everything in the app</p></div>
      <div class="card-body feature-list">${featureHtml('feature-row')}</div>
      <div class="modal-foot">${isInstalled() || !canOfferInstall() ? '' : '<button class="btn" id="feat-install">' + icon('download') + 'Install the app</button>'}<button class="btn primary" data-close>Close</button></div>`, {
      onMount: (el, close) => el.querySelector('#feat-install')?.addEventListener('click', () => { close(); installApp(); }),
    });
  }
  $('#features-side').addEventListener('click', showFeatures);

  // ---- Phone notifications (Web Push) ----
  const PUSH_KINDS = [
    ['message', 'New customer messages', 'Someone writes to your WhatsApp number.'],
    ['booking', 'New bookings', 'A customer confirms a booking or order.'],
    ['handoff', 'Customer needs a person', 'The bot handed the chat to your team.'],
    ['broadcast', 'Broadcast finished', 'How many were sent, and any that failed.'],
  ];
  const PUSH_ON_KEY = 'bluxury_push_on';
  const PUSH_PREFS_KEY = 'bluxury_push_prefs';
  state.push = { supported: false, on: false, endpoint: null, prefs: null, key: null, serverReady: false };
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const appleDevice = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const localPrefs = () => { try { return { message: true, booking: true, handoff: true, broadcast: true, ...JSON.parse(store.get(PUSH_PREFS_KEY) || '{}') }; } catch { return { message: true, booking: true, handoff: true, broadcast: true }; } };
  const keyBytes = (b64) => { const s = b64.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
  function paintPushState() {
    const on = state.push.on;
    $('#notify-dot').hidden = on || !state.push.supported || !state.push.serverReady;
    const b = $('#notify-btn'); if (b) { b.innerHTML = `${icon(on ? 'bell' : 'bellOff')}<i class="notify-dot" id="notify-dot" ${on || !state.push.supported || !state.push.serverReady ? 'hidden' : ''}></i>`; b.title = on ? 'Notifications are on' : 'Turn on notifications'; b.classList.toggle('on', on); }
    const st = $('#notify-side-state'); if (st) { st.textContent = on ? 'On' : 'Off'; st.classList.toggle('on', on); }
  }
  async function currentSubscription() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  async function initPush() {
    state.push.supported = pushSupported();
    try {
      const k = await api('GET', '/push/key');
      state.push.serverReady = !!k.enabled; state.push.key = k.publicKey;
    } catch { state.push.serverReady = false; }
    await syncPush();
    // A gentle one-time nudge after sign-in.
    if (!state.push.on && state.push.supported && state.push.serverReady && Notification.permission !== 'denied' && !store.get('bluxury_push_nudged')) {
      store.set('bluxury_push_nudged', '1');
      setTimeout(() => toast('Get notified instantly', 'Tap to turn on notifications for new messages and bookings.', { kind: 'info', timeout: 12000, onClick: openNotifySheet }), 1500);
    }
  }
  /**
   * Runs on every open and every return to the app: makes sure this device is still connected for notifications.
   * Repairs it silently when the phone/browser dropped or replaced the connection, or the server removed it.
   */
  let pushSyncAt = 0; let pushLostWarned = false;
  async function syncPush() {
    pushSyncAt = Date.now();
    const p = state.push;
    if (!p.supported || !p.serverReady || store.get(PUSH_ON_KEY) !== '1') { paintPushState(); return; }
    if (Notification.permission !== 'granted') {
      // Turned off in phone/browser settings since last time.
      p.on = false; p.lost = true; paintPushState();
      if (!pushLostWarned) { pushLostWarned = true; toast('Notifications are off on this device', 'They were turned off in your phone settings. Tap to fix.', { kind: 'warn', timeout: 15000, onClick: openNotifySheet }); }
      return;
    }
    p.lost = false;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Server key changed, or the server dropped this device (address expired) → make a fresh connection.
        const k = sub.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
        const want = keyBytes(p.key);
        const sameKey = !k || (k.length === want.length && k.every((x, i) => x === want[i]));
        const known = sameKey && (await api('POST', '/push/status', { endpoint: sub.endpoint }).catch(() => ({ subscribed: true }))).subscribed;
        if (!sameKey || !known) { await sub.unsubscribe().catch(() => {}); sub = null; }
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(p.key) });
      const res = await api('POST', '/push/subscribe', { subscription: sub.toJSON(), prefs: localPrefs() });
      Object.assign(p, { on: true, endpoint: sub.endpoint, prefs: res.prefs });
    } catch { p.on = false; }
    paintPushState();
    if (p.on) checkDelivery();
  }

  // ---- Is this phone really getting alerts with the app closed? (measured by the server from real alerts) ----
  const PUSH_TEST_KEY = 'bluxury_push_test_at';
  const mins = (ms) => (ms >= 3600e3 ? `${Math.round(ms / 3600e3)} h` : ms >= 60e3 ? `${Math.round(ms / 60e3)} min` : `${Math.max(1, Math.round(ms / 1000))} s`);
  async function fetchHealth() {
    if (!state.push.on || !state.push.endpoint) return null;
    try { state.push.health = (await api('POST', '/push/status', { endpoint: state.push.endpoint })).health || { state: 'unknown' }; } catch { /* keep last */ }
    return state.push.health;
  }
  /** On open / return: if this phone held alerts back, say so once a day and show its exact fix. */
  async function checkDelivery({ afterTest } = {}) {
    let h = await fetchHealth(); if (!h) return;
    // Alerts that waited while the app was closed usually arrive right now, as the app opens: give them a moment.
    if (h.state === 'waiting') { await new Promise((r) => setTimeout(r, 8000)); h = (await fetchHealth()) || h; }
    if (!state.push.device) state.push.device = await detectDevice();
    const phoneName = DEVICES[state.push.device] || 'phone';
    if (afterTest) {
      if (h.state === 'ok' && h.at >= afterTest) toast('✓ Alerts work on this phone', 'The test arrived with the app closed. You’re all set — nothing more to do.', { timeout: 9000 });
      else toast('Your phone held back the test alert', `Your ${phoneName} is stopping alerts while the app is closed. Tap for the 2-minute fix.`, { kind: 'error', timeout: 20000, onClick: openNotifySheet });
      return;
    }
    if (!['blocked', 'late', 'waiting'].includes(h.state)) return;
    const today = new Date().toDateString(); if (store.get('bluxury_push_warned') === today) return;
    store.set('bluxury_push_warned', today);
    if (h.state === 'late') toast('An alert reached this phone late', `It arrived ${mins(h.delayMs)} after it was sent. If the phone had internet, tap to check its settings.`, { kind: 'warn', timeout: 15000, onClick: openNotifySheet });
    else toast('Alerts only arrive when you open the app', `Your ${phoneName} is holding them back while the app is closed. Tap for the 2-minute fix.`, { kind: 'error', timeout: 20000, onClick: openNotifySheet });
  }
  // Coming back to the app: finish a closed-app test, and re-check the connection (at most every 10 minutes).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.auth || !state.push.key) return;
    const t = Number(store.get(PUSH_TEST_KEY) || 0);
    if (t && Date.now() - t > 35e3) { store.set(PUSH_TEST_KEY, ''); if (Date.now() - t < 6 * 3600e3) { setTimeout(() => checkDelivery({ afterTest: t }), 2500); return; } }
    if (Date.now() - pushSyncAt > 10 * 60e3) syncPush();
  });
  async function pushEnable() {
    if (appleDevice() && !isInstalled()) throw new Error('On iPhone and iPad, install the app first (Share → Add to Home Screen), open it from your home screen, then turn notifications on.');
    if (!state.push.supported) throw new Error('This browser does not support notifications. Use Chrome, Edge, Firefox or Safari 16.4+.');
    if (!state.push.serverReady) throw new Error('Notifications are not set up on the server yet.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.' : 'Notifications were not allowed.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.push.key) });
    const res = await api('POST', '/push/subscribe', { subscription: sub.toJSON(), prefs: localPrefs() });
    store.set(PUSH_ON_KEY, '1');
    Object.assign(state.push, { on: true, endpoint: sub.endpoint, prefs: res.prefs });
    paintPushState();
  }
  async function pushDisable() {
    store.set(PUSH_ON_KEY, '0');
    try {
      const sub = await currentSubscription();
      if (sub) { await api('POST', '/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
    } finally { Object.assign(state.push, { on: false, endpoint: null }); paintPushState(); }
  }
  /** On sign-out: this device stops receiving this account's notifications (sign in again to get them back). */
  function pushForget() {
    if (!state.push?.on || !state.push.endpoint) return;
    api('POST', '/push/unsubscribe', { endpoint: state.push.endpoint }).catch(() => {});
    state.push.on = false; paintPushState();
  }
  async function savePushPrefs(prefs) {
    store.set(PUSH_PREFS_KEY, JSON.stringify(prefs));
    if (!state.push.on) return;
    const sub = await currentSubscription();
    if (sub) { const res = await api('POST', '/push/subscribe', { subscription: sub.toJSON(), prefs }); state.push.prefs = res.prefs; }
  }
  // ---- "Always get alerts, even when the app is closed": exact steps for each kind of phone ----
  // Phones (not the app) decide whether a closed app may receive alerts and pop them at the top. Each brand hides it differently.
  const DEVICES = {
    iphone: 'iPhone / iPad', samsung: 'Samsung', xiaomi: 'Xiaomi / Redmi / POCO', oppo: 'OPPO / Realme / OnePlus',
    vivo: 'vivo / iQOO', huawei: 'Huawei / Honor', stock: 'Google Pixel / Motorola / Nokia / other Android', computer: 'Computer (Windows / Mac)',
  };
  const PUSH_DEVICE_KEY = 'bluxury_push_device';
  function guessDevice(model = '') {
    const ua = navigator.userAgent; const m = `${model} ${ua}`;
    if (appleDevice()) return 'iphone';
    if (!/Android/i.test(ua)) return 'computer';
    if (/\bSM-|Samsung|Galaxy/i.test(m)) return 'samsung';
    if (/Redmi|POCO|Xiaomi|\bMi \d|\bM\d{4}[A-Z]|\b2[0-4]\d{6}[A-Z]{1,4}\b|\b2[0-4]\d{3}[A-Z0-9]{3,6}\b/i.test(m)) return 'xiaomi';
    if (/\bCPH\d|\bRMX\d|OnePlus|\b(IN|LE|KB|NE|PH|PJ|GM|HD)\d{4}\b|OPPO|realme/i.test(m)) return 'oppo';
    if (/vivo|\bV2\d{3}|\bI2\d{3}|iQOO/i.test(m)) return 'vivo';
    if (/HUAWEI|HONOR|\b[A-Z]{3}-[A-Z]{1,3}\d{1,2}\b/.test(m)) return 'huawei';
    return 'stock';
  }
  /** Detects the phone brand (Chrome on Android shares the model name only when asked). */
  async function detectDevice() {
    const saved = store.get(PUSH_DEVICE_KEY); if (saved && DEVICES[saved]) return saved;
    let model = '';
    try { if (navigator.userAgentData?.getHighEntropyValues) model = (await navigator.userAgentData.getHighEntropyValues(['model'])).model || ''; } catch { /* not shared */ }
    return guessDevice(model);
  }
  const iosVersion = () => { const m = navigator.userAgent.match(/OS (\d+)_(\d+)/); return m ? Number(m[1]) + Number(m[2]) / 100 : null; };
  function deviceGuide(dev, collapsed = false) {
    const demo = `<div class="demo"><img src="/icon-192.png" alt="" /><div><b>Ravi Kumar</b><span>Hi, is the 2BHK still available?</span></div></div>`;
    const popup = (alert = 'Default / Alerting', pop = 'Pop on screen') => `<li><b>Pop at the top:</b> tap <b>Send a test notification</b>, pull down the notification bar, <b>long-press</b> the Bluxury notification → <b>⚙ Settings</b> → choose <b>${alert}</b> (not Silent) and turn on <b>${pop}</b>, <b>Lock screen</b> and <b>Sound</b>.</li>`;
    const lock = '<li><b>Keep it from being closed:</b> open recent apps, long-press (or swipe down on) the <b>Chrome</b> card → tap the <b>🔒 lock</b>. Don’t use “Clear all”, cleaner or booster apps on Chrome.</li>';
    const chromeNote = '<p class="small muted" style="margin:8px 0 0">The app runs on <b>Chrome</b>, so Chrome must be allowed to work in the background — that’s what lets alerts arrive when the app is closed.</p>';
    const steps = {
      iphone: (() => {
        const v = iosVersion();
        return `${v && v < 16.4 ? `<div class="banner red">${icon('alert')}<div>This iPhone runs iOS ${String(v).replace('.', '.')}. Notifications need <b>iOS 16.4 or newer</b>: <b>Settings → General → Software Update</b>.</div></div>` : ''}
        <ol>
          <li><b>Use the Home Screen app:</b> in <b>Safari</b>, tap <b>Share</b> → <b>Add to Home Screen</b>. Always open Bluxury AI from that icon (not from Safari), then turn notifications on here.</li>
          <li><b>Settings → Notifications → Bluxury AI:</b> turn on <b>Allow Notifications</b>, <b>Time Sensitive</b>, <b>Sounds</b>; tick <b>Lock Screen</b>, <b>Notification Centre</b>, <b>Banners</b>; set <b>Banner Style → Persistent</b>.</li>
          <li><b>Settings → Notifications → Scheduled Summary:</b> keep it <b>off</b> (or leave Bluxury AI out of it) — otherwise alerts are held back and delivered later.</li>
          <li><b>Focus / Do Not Disturb:</b> Settings → Focus → each focus → <b>Apps → Add Bluxury AI</b> to the allowed list.</li>
          <li><b>Don’t delete the Home Screen icon</b> — removing it turns notifications off. Closing it from the app switcher is fine.</li>
        </ol>`;
      })(),
      samsung: `<ol>
          <li><b>Settings → Apps → Chrome → Battery</b> → <b>Unrestricted</b>. Do the same for <b>Bluxury AI</b>.</li>
          <li><b>Settings → Battery → Background usage limits</b> → turn <b>off</b> “Put unused apps to sleep”, and add <b>Chrome</b> and <b>Bluxury AI</b> to <b>Never sleeping apps</b>.</li>
          <li><b>Settings → Notifications → App notifications</b> → turn on <b>Chrome</b> and <b>Bluxury AI</b>.</li>
          ${popup('Alert', 'Pop-up / Show as pop-up')}${lock}</ol>`,
      xiaomi: `<ol>
          <li><b>Settings → Apps → Manage apps → Chrome</b> → turn on <b>Autostart</b>.</li>
          <li>Same screen → <b>Battery saver</b> → <b>No restrictions</b>. Do the same for <b>Bluxury AI</b>.</li>
          <li>Same screen → <b>Notifications</b> → turn on <b>Show notifications</b>, <b>Floating notifications</b>, <b>Lock screen notifications</b>, <b>Sound</b>.</li>
          <li><b>Settings → Battery</b> → keep <b>Ultra battery saver</b> off.</li>
          ${lock}</ol>`,
      oppo: `<ol>
          <li><b>Settings → Apps → App management → Chrome → Battery usage</b> → turn on <b>Allow background activity</b>, <b>Allow auto launch</b> (and <b>Allow foreground activity</b>).</li>
          <li><b>Settings → Battery</b> → keep <b>Power saving</b> / <b>Super power saving</b> off; under <b>More settings</b> turn off <b>Optimise battery use</b> for Chrome.</li>
          <li><b>Settings → Notifications & status bar → Chrome</b> and <b>Bluxury AI</b> → turn on <b>Banners</b> / <b>Floating notifications</b>, <b>Lock screen</b>, <b>Ring</b>.</li>
          ${lock}</ol>`,
      vivo: `<ol>
          <li><b>Settings → Battery → Background power consumption management → Chrome</b> → <b>Allow</b> (or <b>Don’t restrict</b>).</li>
          <li><b>Settings → Apps → Autostart</b> (i Manager → App manager → Autostart) → turn on <b>Chrome</b>.</li>
          <li><b>Settings → Notifications & status bar → Chrome</b> and <b>Bluxury AI</b> → turn on <b>Banners / Floating notifications</b>, <b>Lock screen</b>, <b>Sound</b>.</li>
          ${lock}</ol>`,
      huawei: `<div class="banner amber">${icon('info')}<div>Huawei phones made <b>without Google services</b> (most from 2020 on) can’t receive web-app alerts at all. Use your <b>WhatsApp team alert number</b> for bookings and hand-overs on those phones. Honor phones with Google Play work normally.</div></div>
        <ol>
          <li><b>Settings → Battery → App launch → Chrome</b> → <b>Manage manually</b> → turn on <b>Auto-launch</b>, <b>Secondary launch</b> and <b>Run in background</b>.</li>
          <li><b>Settings → Notifications → Chrome</b> → turn on <b>Allow notifications</b>, <b>Banners</b>, <b>Lock screen</b>.</li>
          ${lock}</ol>`,
      stock: `<ol>
          <li><b>Settings → Apps → Chrome → App battery usage</b> (or Battery) → <b>Unrestricted</b>. Do the same for <b>Bluxury AI</b>.</li>
          <li><b>Settings → Apps → Chrome → Notifications</b> → turn <b>on</b>; do the same for <b>Bluxury AI</b>.</li>
          ${popup()}
          <li>Keep <b>Battery Saver</b> off, and allow Bluxury AI in <b>Do Not Disturb → Apps</b> if you use it.</li></ol>`,
      computer: `<ol>
          <li>Alerts arrive while the browser is running — even with this tab closed. <b>Chrome / Edge:</b> Settings → System → turn on <b>Continue running background apps when closed</b>.</li>
          <li><b>Windows:</b> Settings → System → Notifications → turn on <b>Chrome / Edge</b>, and turn off <b>Do not disturb</b>. <b>Mac:</b> System Settings → Notifications → your browser → <b>Allow</b>, style <b>Alerts</b>.</li></ol>`,
    };
    const body = `
        <p class="small muted" style="margin:0 0 6px">Detected: <b>${DEVICES[dev]}</b> · <a href="#" id="dev-change">Not this phone?</a></p>
        <select id="dev-pick" class="input" style="min-height:36px;margin-bottom:8px" hidden>${Object.entries(DEVICES).map(([k, v]) => `<option value="${k}" ${k === dev ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <span class="small">Do this once on this phone — it stays set:</span>
        ${steps[dev] || steps.stock}
        ${!['iphone', 'computer'].includes(dev) ? chromeNote : ''}
        ${dev !== 'computer' ? demo : ''}`;
    // Working already → keep the steps folded away.
    if (collapsed) return `<details class="popup-help device-guide"><summary><strong>Setup steps for your ${DEVICES[dev]}</strong></summary>${body}</details>`;
    return `<div class="popup-help device-guide"><strong class="t">${icon('bell')}Fix it on your ${DEVICES[dev]}</strong>${body}</div>`;
  }
  /** What the server measured for this device, in plain words. */
  function healthBanner(h, dev) {
    const name = DEVICES[dev] || 'phone';
    switch (h?.state) {
      case 'ok': return `<div class="banner green">${icon('check')}<div><strong>Working on this phone.</strong> The last alert with the app closed arrived in ${mins(h.delayMs || 0)}. Nothing to set up.</div></div>`;
      case 'blocked': return `<div class="banner red">${icon('alert')}<div><strong>Your ${esc(name)} is holding alerts back.</strong> They only arrive when you open the app (the last one was ${mins(h.delayMs)} late). Do the steps below once, then tap <b>Test with the app closed</b>.</div></div>`;
      case 'late': return `<div class="banner amber">${icon('alert')}<div><strong>The last alert arrived ${mins(h.delayMs)} late.</strong> If the phone had internet then, your ${esc(name)} is holding alerts back — do the steps below once.</div></div>`;
      case 'waiting': return `<div class="banner amber">${icon('alert')}<div><strong>An alert sent ${mins(h.delayMs)} ago hasn’t reached this phone yet.</strong> Your ${esc(name)} may be blocking alerts while the app is closed — do the steps below once.</div></div>`;
      default: return `<div class="banner blue">${icon('info')}<div><strong>Not checked on this phone yet.</strong> Tap <b>Test with the app closed</b> — the app will tell you if this phone needs any setting changed.</div></div>`;
    }
  }
  function openNotifySheet() {
    $('#shell').classList.remove('nav-open');
    const draw = (el, close) => {
      const p = state.push; const prefs = p.prefs || localPrefs();
      const blocked = 'Notification' in window && Notification.permission === 'denied';
      const iosNeedsInstall = appleDevice() && !isInstalled();
      el.querySelector('.modal').innerHTML = `
        <div class="card-head"><span class="section-icon">${icon('bell')}</span><div><h2>Notifications</h2><p>${p.on ? 'On for this device' : 'Off on this device'}</p></div><span class="spacer"></span><button class="btn icon ghost" data-close aria-label="Close">${icon('x')}</button></div>
        <div class="card-body stack">
          ${iosNeedsInstall ? `<div class="banner amber">${icon('info')}<div><strong>iPhone / iPad:</strong> install the app first — tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, open Bluxury AI from your home screen, then turn notifications on here.</div></div>` : ''}
          ${blocked ? `<div class="banner red">${icon('alert')}<div>Notifications are <strong>blocked</strong> for this site. Allow them in your ${appleDevice() ? 'iPhone Settings → Notifications → Bluxury AI' : 'browser’s site settings (the lock icon next to the address)'} and come back.</div></div>` : ''}
          ${!p.serverReady ? `<div class="banner amber">${icon('info')}<div>Notifications are being set up on the server. Please try again shortly.</div></div>` : ''}
          <div class="notify-main ${p.on ? 'on' : ''}">
            <span class="section-icon">${icon(p.on ? 'bell' : 'bellOff', 'lg')}</span>
            <div class="grow"><strong>${p.on ? 'Notifications are on' : 'Get notified instantly'}</strong><p class="muted small">${p.on ? 'You’ll get them on this device even when the app is closed.' : 'New messages and bookings arrive on this device, even when the app is closed.'}</p></div>
            <button class="btn ${p.on ? '' : 'primary'}" id="push-toggle" ${(!p.on && (blocked || iosNeedsInstall || !p.serverReady)) ? 'disabled' : ''}>${p.on ? 'Turn off' : 'Turn on'}</button>
          </div>
          <div id="push-err"></div>
          <div class="stack" style="gap:2px">
            <strong class="small muted" style="text-transform:uppercase;letter-spacing:.06em">Notify me about</strong>
            ${PUSH_KINDS.map(([k, t, d]) => `<label class="notify-pref"><div class="grow"><strong>${t}</strong><small>${d}</small></div><span class="switch"><input type="checkbox" data-pk="${k}" ${prefs[k] !== false ? 'checked' : ''} /><span class="track"></span></span></label>`).join('')}
          </div>
          ${p.on ? `<div class="row wrap" style="gap:8px"><button class="btn" id="push-test">${icon('send')}Send a test notification</button><button class="btn primary" id="push-test-closed">${icon('bell')}Test with the app closed</button></div>
          <div id="push-closed-help"></div>` : ''}
          ${p.on ? `<div id="push-health">${healthBanner(p.health, p.device || guessDevice())}</div>` : ''}
          <div id="dev-guide"></div>
          <p class="hint">Each phone or computer is turned on separately. ${isAdmin() ? 'As admin you get notifications for every business.' : ''}</p>
        </div>`;
      hydrateIcons(el);
      el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
      const err = (m) => { el.querySelector('#push-err').innerHTML = m ? `<div class="banner red">${icon('alert')}<div>${esc(m)}</div></div>` : ''; };
      el.querySelector('#push-toggle')?.addEventListener('click', async (e) => {
        const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
        try {
          if (state.push.on) { await pushDisable(); toast('Notifications off', 'This device will not get notifications.'); }
          else { await pushEnable(); toast('Notifications on', 'You’ll be notified about new messages and bookings.'); }
          draw(el, close);
        } catch (x) { err(x.message); b.disabled = false; b.textContent = state.push.on ? 'Turn off' : 'Turn on'; }
      });
      el.querySelectorAll('[data-pk]').forEach((c) => c.addEventListener('change', async () => {
        const prefs = { ...localPrefs() }; el.querySelectorAll('[data-pk]').forEach((x) => { prefs[x.dataset.pk] = x.checked; });
        try { await savePushPrefs(prefs); } catch (x) { err(x.message); }
      }));
      const paintGuide = (dev) => {
        state.push.device = dev; const g = el.querySelector('#dev-guide'); if (!g) return;
        const hb = el.querySelector('#push-health'); if (hb) { hb.innerHTML = healthBanner(state.push.health, dev); hydrateIcons(hb); }
        g.innerHTML = deviceGuide(dev, state.push.on && state.push.health?.state === 'ok'); hydrateIcons(g);
        g.querySelector('#dev-change')?.addEventListener('click', (ev) => { ev.preventDefault(); g.querySelector('#dev-pick').hidden = false; ev.target.closest('p').hidden = true; });
        g.querySelector('#dev-pick')?.addEventListener('change', (ev) => { store.set(PUSH_DEVICE_KEY, ev.target.value); paintGuide(ev.target.value); });
      };
      paintGuide(state.push.device || guessDevice());
      if (!state.push.device) detectDevice().then((d) => paintGuide(d));
      if (state.push.on) fetchHealth().then(() => paintGuide(state.push.device || guessDevice()));
      el.querySelector('#push-test-closed')?.addEventListener('click', async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try {
          await api('POST', '/push/test', { endpoint: state.push.endpoint, delay: 30 });
          store.set(PUSH_TEST_KEY, String(Date.now()));
          el.querySelector('#push-closed-help').innerHTML = `<div class="banner green">${icon('check')}<div><strong>Now close the app completely</strong> (swipe it away from recent apps) and <strong>lock the phone</strong>. Wait about a minute, then open the app again — it will tell you whether this phone works or what to change.</div></div>`;
          hydrateIcons(el.querySelector('#push-closed-help'));
        } catch (x) { err(x.message); } finally { setTimeout(() => { b.disabled = false; }, 30000); }
      });
      el.querySelector('#push-test')?.addEventListener('click', async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try {
          await api('POST', '/push/test', { endpoint: state.push.endpoint });
          toast('Test sent', document.visibilityState === 'visible' ? 'It should appear in a moment.' : '');
        } catch (x) { err(x.message); } finally { b.disabled = false; }
      });
    };
    modal('', { onMount: draw });
  }
  navigator.serviceWorker?.startMessages?.();
  $('#notify-btn').addEventListener('click', openNotifySheet);
  $('#notify-side').addEventListener('click', openNotifySheet);
  // Notification tapped while the app is open: go straight to that chat / page.
  navigator.serviceWorker?.addEventListener('message', async (e) => {
    const d = e.data || {};
    // Background script asks before skipping a message notification: answer only if really on screen.
    if (d.type === 'push-check') { e.ports?.[0]?.postMessage({ awake: document.visibilityState === 'visible', onScreen: document.visibilityState === 'visible' && document.hasFocus() && !!state.auth && state.route.page === 'inbox' && state.inbox?.active === d.phone }); return; }
    if (d.type !== 'open' || !state.auth) return;
    if (d.tenantId && isAdmin() && d.tenantId !== state.tenantId && state.tenants.some((t) => t._id === d.tenantId)) await selectTenant(d.tenantId, { silent: true });
    location.hash = (d.url || '/#/overview').replace(/^\/?/, '').replace(/^[^#]*/, '');
    if (location.hash === '') location.hash = '#/overview';
  });

  // ---- Install as an app ----
  const isInstalled = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true || document.referrer.startsWith('android-app://');
  let installPrompt = null;
  let installedHere = false; // the app is already installed on this device (we're just in a browser tab)
  const INSTALL_BTNS = ['#install-top', '#install-side', '#install-login'];
  // Chrome/Edge (Android, Windows, Mac) can install with one tap, but only once they offer it (after the person has
  // used the page a little). There the button appears only when that is ready, so a tap always opens the real install
  // window. Browsers that never offer it (iPhone Safari, Firefox) keep the button, which shows that device's steps.
  const browserInstalls = 'onbeforeinstallprompt' in window;
  /** Is there an install to offer right now? (used by the App features window too) */
  function canOfferInstall() { return !installedHere && (!browserInstalls || !!installPrompt); }
  const showInstall = (on) => INSTALL_BTNS.forEach((id) => { const b = $(id); if (b) b.hidden = !on || installedHere || (browserInstalls && !installPrompt); });
  showInstall(!isInstalled());
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; installedHere = false; showInstall(!isInstalled()); });
  addEventListener('appinstalled', () => { installPrompt = null; installedHere = true; showInstall(false); toast('App installed ✓', 'Open Bluxury AI from your home screen or desktop.'); });
  matchMedia('(display-mode: standalone)').addEventListener?.('change', () => showInstall(!isInstalled()));
  // Chrome/Edge can tell whether this app is already installed on this device: then there is nothing to install.
  (async () => {
    try {
      const apps = await navigator.getInstalledRelatedApps?.();
      if (apps?.some((x) => x.platform === 'webapp')) { installedHere = true; showInstall(false); }
    } catch { /* not supported: keep the buttons */ }
  })();
  /** Chrome offers the install window a moment after the page loads; wait for it briefly instead of showing steps. */
  const waitForInstallPrompt = (ms = 3000) => (installPrompt ? Promise.resolve() : new Promise((done) => {
    const t = setTimeout(done, ms);
    addEventListener('beforeinstallprompt', () => { clearTimeout(t); setTimeout(done, 0); }, { once: true });
  }));
  async function installApp(e) {
    $('#shell').classList.remove('nav-open');
    const btn = e?.currentTarget; const label = btn?.innerHTML;
    if (!installPrompt && btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
    await waitForInstallPrompt();
    if (btn) { btn.disabled = false; btn.innerHTML = label; }
    if (installPrompt) {
      installPrompt.prompt(); // the browser's own "Install Bluxury WhatsApp AI?" window
      const { outcome } = await installPrompt.userChoice.catch(() => ({}));
      if (outcome === 'accepted') { installPrompt = null; installedHere = true; showInstall(false); }
      return;
    }
    if (installedHere) {
      modal(`<div class="card-head"><span class="section-icon">${icon('check')}</span><div><h2>Already installed</h2><p>Bluxury WhatsApp AI is installed on this device.</p></div></div>
        <div class="card-body"><p>Open <strong>Bluxury AI</strong> from your home screen, app list or desktop. In Chrome you can also click the <strong>Open in app</strong> icon at the right of the address bar.</p></div>
        <div class="modal-foot"><button class="btn primary" data-close>OK</button></div>`);
      return;
    }
    // No install prompt from the browser (iPhone/iPad, Firefox, or Chrome not ready yet): show the steps.
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /Android/.test(ua);
    const steps = ios
      ? ['Open this page in <strong>Safari</strong>.', 'Tap the <strong>Share</strong> button (square with an arrow).', 'Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.']
      : android
        ? ['Open this page in <strong>Chrome</strong>.', 'Tap the <strong>⋮</strong> menu at the top right.', 'Tap <strong>Add to Home screen</strong> → <strong>Install</strong> (or <strong>Install app</strong>).']
        : ['Use <strong>Chrome</strong> or <strong>Edge</strong>.', 'Click the <strong>install icon</strong> (a screen with an arrow) at the right end of the address bar — or open the <strong>⋮</strong> menu → <strong>Cast, save and share</strong> → <strong>Install page as app</strong>.', 'Click <strong>Install</strong>.'];
    modal(`<div class="card-head"><span class="section-icon">${icon('download')}</span><div><h2>Install Bluxury WhatsApp AI</h2><p>Use it like an app, straight from your ${ios || android ? 'home screen' : 'desktop'}.</p></div></div>
      <div class="card-body"><ol class="install-steps">${steps.map((x) => `<li>${x}</li>`).join('')}</ol></div>
      <div class="modal-foot"><button class="btn primary" data-close>Got it</button></div>`);
  }
  INSTALL_BTNS.forEach((id) => $(id)?.addEventListener('click', installApp));
  $('#shell').addEventListener('click', (e) => { if (e.target === $('#shell')) $('#shell').classList.remove('nav-open'); });

  async function startSession() {
    try { ({ auth: state.auth } = await api('GET', '/tenants/me')); }
    catch (err) { if (err.message !== 'Not signed in') showLogin(err.message); return; }
    $('#login').hidden = true; $('#shell').hidden = false;
    const who = state.auth.memberName || (isAdmin() ? 'Administrator' : state.auth.businessName);
    $('#me-name').textContent = who;
    $('#me-role').textContent = state.auth.memberName ? `${state.auth.memberRole === 'agent' ? 'Agent' : 'Owner'} · ${isAdmin() ? 'all businesses' : state.auth.businessName}` : (isAdmin() ? 'All businesses' : 'Business account');
    $('#me-avatar').outerHTML = avatar(who, 'me').replace('class="avatar ', 'id="me-avatar" class="avatar ');
    log(`Signed in as ${isAdmin() ? 'admin' : state.auth.businessName}.`, 'success');
    await loadTenants();
    // Opened from a notification for another business (admins): switch to it.
    const wanted = new URLSearchParams(location.search).get('t');
    if (wanted) {
      history.replaceState(null, '', location.pathname + location.hash);
      if (isAdmin() && wanted !== state.tenantId && state.tenants.some((t) => t._id === wanted)) await selectTenant(wanted, { silent: true });
    }
    renderNav();
    route();
    hideSplash();
    initPush();
  }

  async function loadTenants() {
    const { data } = await api('GET', '/tenants');
    state.tenants = data;
    $('#tenant-switch').hidden = !isAdmin() || !data.length;
    if (isAdmin()) renderTenantSelect();
    const saved = store.get('tenantId');
    const preferred = isAdmin() ? (data.find((t) => t._id === saved) || data[0]) : data.find((t) => t._id === state.auth.tenantId);
    if (preferred) await selectTenant(preferred._id, { silent: true });
    else { state.tenantId = null; state.tenant = null; disconnectLive(); setLive('off'); }
  }
  const renderTenantSelect = () => { $('#tenant-select').innerHTML = state.tenants.map((t) => `<option value="${t._id}" ${t._id === state.tenantId ? 'selected' : ''}>${esc(t.businessName)}</option>`).join(''); };

  function applyTenantPayload(res) {
    state.tenant = res.data; state.fields = res.fields || []; state.templates = res.templates || state.templates;
    const i = state.tenants.findIndex((x) => x._id === res.data._id);
    if (i >= 0) state.tenants[i] = res.data;
    if (isAdmin()) renderTenantSelect();
    renderAiQuick();
  }
  // Top-bar AI switch: one click turns the AI assistant on or off for this business, from any page.
  function renderAiQuick() {
    const b = $('#ai-quick'); if (!b) return;
    const a = state.tenant?.ai || {};
    b.hidden = !state.tenant;
    const live = a.enabled && a.schedule === 'hours';
    b.className = `ai-quick ${a.enabled ? (live ? 'on paused' : 'on') : ''}`;
    b.querySelector('.lbl').textContent = a.enabled ? (a.schedule === 'hours' ? `AI on · ${a.hoursFrom || '09:00'}–${a.hoursTo || '21:00'}` : 'AI on · 24/7') : 'AI off';
  }
  $('#ai-quick').addEventListener('click', async () => {
    if (!state.tenant) return;
    const ai = { ...(state.tenant.ai || {}), enabled: !state.tenant.ai?.enabled };
    try {
      const res = await api('PATCH', `/tenants/${state.tenantId}`, { ai });
      applyTenantPayload(res);
      if (state.route.page === 'ai') { state.aiDraft = null; renderAi(); hydrateIcons($('#page')); }
      toast(ai.enabled ? 'AI assistant is on' : 'AI assistant is off', ai.enabled ? 'It answers customers’ typed and spoken questions.' : 'The bot keeps running your flow; the AI stays quiet.');
    } catch (err) { toast('Could not change the AI', err.message, { kind: 'error' }); }
  });

  let switchSeq = 0;
  /** Everything kept in memory for one business: cleared on every switch so another account's data never shows. */
  function resetTenantMemory() {
    state.inbox = null; state.builder = null; state.profileDraft = null; state.aiDraft = null; state.catalogAll = [];
    clearInterval(bcTimer); bcTimer = null;
    Object.assign(bcData, { limit: null, reasons: {}, campaigns: [], templates: null, tplError: '', msg: null });
    bc = null; spendData = null;
  }
  async function selectTenant(id, { silent } = {}) {
    const seq = ++switchSeq;
    const changed = id !== state.tenantId;
    state.tenantId = id;
    if (isAdmin()) store.set('tenantId', id);
    if (changed) {
      resetTenantMemory();
      disconnectLive();
      if (!silent && state.tenant) $('#page').innerHTML = '<div class="page-inner"><div class="card card-pad"><div class="skeleton" style="height:160px"></div></div></div>';
    }
    let res, cat;
    try {
      [res, cat] = await Promise.all([api('GET', `/tenants/${id}`), api('GET', `/catalog/${id}`).catch(() => ({ data: [] }))]);
    } catch (err) {
      if (seq !== switchSeq) return;
      $('#page').innerHTML = `<div class="page-inner"><div class="card"><div class="empty"><span class="section-icon red">${icon('alert', 'lg')}</span><h3>Could not open this business</h3><p>${esc(err.message)}</p><button class="btn primary" id="switch-retry">${icon('refresh')}Try again</button></div></div></div>`;
      hydrateIcons($('#page'));
      $('#switch-retry')?.addEventListener('click', () => selectTenant(id));
      return;
    }
    if (seq !== switchSeq) return; // another business was picked meanwhile: this answer is out of date
    applyTenantPayload(res);
    state.catalogAll = cat.data || []; useLayout(savedLayout());
    if (!changed) { state.inbox = null; state.builder = null; state.profileDraft = null; state.aiDraft = null; }
    connectLive();
    refreshUnread();
    if (!silent) route();
  }
  $('#tenant-select').addEventListener('change', (e) => {
    if (!confirmLeave()) { e.target.value = state.tenantId; return; }
    selectTenant(e.target.value);
  });

  const refreshUnread = debounce(async () => {
    if (!state.tenantId) return;
    try {
      const { unreadChats } = await api('GET', `/chats/${state.tenantId}?limit=1`);
      state.unreadChats = unreadChats;
      for (const b of [$('#nav-unread'), ...$$('#tabbar .nav-unread')]) if (b) { b.textContent = unreadChats; b.hidden = !unreadChats; }
      document.title = `${unreadChats ? `(${unreadChats}) ` : ''}Bluxury WhatsApp AI`;
      // Installed app: number on the home-screen icon.
      if (navigator.setAppBadge) (unreadChats ? navigator.setAppBadge(unreadChats) : navigator.clearAppBadge()).catch(() => {});
    } catch { /* ignore */ }
  }, 300);

  // ============================================================
  // Live updates (WebSocket to the business's Durable Object)
  // ============================================================
  let liveRetry = 0;
  function setLive(status) {
    const el = $('#live');
    el.className = `live ${status === 'on' ? 'on' : status === 'off' ? 'off' : ''}`;
    el.innerHTML = `<span>${status === 'on' ? 'Live' : status === 'off' ? 'Offline' : 'Connecting…'}</span>`;
  }
  function disconnectLive() {
    const l = state.live;
    state.live = null;
    if (l) { clearInterval(l.ping); clearTimeout(l.retry); if (l.ws) { l.ws.onclose = null; try { l.ws.close(); } catch { /* */ } } }
  }
  async function connectLive() {
    disconnectLive();
    if (!state.tenantId || !getKey()) return;
    const live = { ws: null, ping: null, retry: null, tenantId: state.tenantId };
    state.live = live;
    setLive('connecting');
    const retryLater = () => {
      if (state.live !== live) return;
      setLive('off');
      const delay = Math.min(30000, 1000 * 2 ** liveRetry++);
      live.retry = setTimeout(() => { if (state.live === live) connectLive(); }, delay);
    };
    // A one-minute signed pass: the API key never goes into the connection address (which can end up in logs).
    let ticket;
    try { ({ ticket } = await api('POST', `/ws-ticket/${live.tenantId}`)); } catch { retryLater(); return; }
    if (state.live !== live) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?tenant=${encodeURIComponent(live.tenantId)}&ticket=${encodeURIComponent(ticket)}`);
    live.ws = ws;
    ws.onopen = () => { liveRetry = 0; setLive('on'); live.ping = setInterval(() => { try { ws.send('ping'); } catch { /* */ } }, 25000); };
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; } // "pong"
      if (msg.event === 'message:new') onLiveMessage(msg.data);
      else if (msg.event === 'message:status') onLiveStatus(msg.data);
      else if (msg.event === 'lead:update') onLeadUpdate(msg.data.lead);
      else if (msg.event === 'alert') onLiveAlert(msg.data);
    };
    ws.onclose = () => { clearInterval(live.ping); retryLater(); };
  }

  function onLiveMessage({ message, lead }) {
    if (!message || String(message.tenantId) !== String(state.tenantId)) return;
    if (lead) onLeadUpdate(lead);
    const ib = state.inbox;
    if (ib && state.route.page === 'inbox' && ib.active === message.phone) {
      appendMessages([message]);
      if (message.direction === 'in' && document.visibilityState === 'visible') markRead(message.phone);
    }
    if (message.direction === 'in') {
      refreshUnread();
      const viewing = state.route.page === 'inbox' && ib?.active === message.phone && document.visibilityState === 'visible';
      if (!viewing && !state.push?.on) toast(displayName(lead || { phone: message.phone }), message.text || 'New message', { kind: 'chat', onClick: () => { location.hash = `#/inbox/${message.phone}`; } });
      if (!state.push?.on) notifyDesktop(displayName(lead || { phone: message.phone }), message.text || message.meta?.label || 'New message', message.phone);
    }
    if (state.route.page === 'overview') refreshOverview();
  }
  // Desktop notification + chime for customer messages when this tab is in the background.
  let chimeCtx = null;
  function chime() {
    try {
      chimeCtx = chimeCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = chimeCtx.createOscillator(); const g = chimeCtx.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(0.0001, chimeCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, chimeCtx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, chimeCtx.currentTime + 0.35);
      o.connect(g).connect(chimeCtx.destination); o.start(); o.stop(chimeCtx.currentTime + 0.4);
    } catch { /* sound is optional */ }
  }
  function notifyDesktop(title, body, phone) {
    chime();
    if (state.push?.on || document.visibilityState === 'visible' || !('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body: String(body).slice(0, 140), tag: `chat-${phone}` });
    n.onclick = () => { window.focus(); location.hash = `#/inbox/${phone}`; n.close(); };
  }
  function onLiveAlert(a) {
    if (!a?.phone || state.push?.on) return; // phone notifications on: the system notification is the alert
    const who = a.name || fmtPhone(a.phone);
    const booking = a.kind === 'booking';
    chime();
    toast(booking ? `New booking · ${who}` : `${who} needs a person`, a.details || '', {
      kind: booking ? 'ok' : 'warn', timeout: 9000,
      onClick: () => { location.hash = booking ? '#/confirmed' : `#/inbox/${a.phone}`; },
    });
  }
  function onLiveStatus({ id, status, error, phone }) {
    const ib = state.inbox;
    if (!ib || ib.active !== phone) return;
    const m = ib.messages.find((x) => String(x._id) === String(id));
    if (!m) return;
    m.status = status; m.error = error;
    const el = $(`.msg[data-id="${id}"] .meta`);
    if (el) el.outerHTML = metaHtml(m);
  }
  function onLeadUpdate(lead) {
    if (!lead || String(lead.tenantId) !== String(state.tenantId)) return;
    const ib = state.inbox;
    if (ib) {
      const had = ib.chats.get(lead.phone);
      if (had || lead.lastMessageAt) {
        ib.chats.set(lead.phone, { ...(had || {}), ...lead });
        if (state.route.page === 'inbox') renderChatList({ flash: lead.phone });
      }
      if (ib.active === lead.phone) {
        ib.lead = { ...(ib.lead || {}), ...lead };
        if (state.route.page === 'inbox') { renderConvHead(); renderComposer(); renderDetails(); }
      }
    }
    if (state.route.page === 'overview') refreshOverview();
    if (state.route.page === 'leads') refreshLeads();
    if (state.route.page === 'confirmed') refreshConfirmed();
  }

  // ============================================================
  // Navigation & routing
  // ============================================================
  const PAGES = {
    overview: { title: 'Overview', icon: 'grid', render: renderOverview },
    inbox: { title: 'Inbox', icon: 'chat', render: renderInbox, flush: true },
    leads: { title: 'Leads', icon: 'users', render: renderLeads },
    confirmed: { title: 'Confirmed', icon: 'check', render: renderConfirmed },
    broadcast: { title: 'Broadcast', icon: 'megaphone', render: renderBroadcast },
    pricing: { title: 'Bulk broadcast & pricing', icon: 'wallet', render: renderPricing },
    flow: { title: 'Flow Builder', icon: 'layers', render: renderBuilder },
    catalog: { title: 'Products & Services', icon: 'image', render: () => { catState.category = ''; renderCatalog(); } },
    ai: { title: 'AI Assistant', icon: 'sparkle', render: renderAi },
    profile: { title: 'Business Profile', icon: 'building', render: renderProfile },
    settings: { title: 'Settings', icon: 'sliders', render: renderSettings },
    clients: { title: 'Businesses', icon: 'key', render: renderClients, admin: true },
    activity: { title: 'Activity log', icon: 'activity', render: renderActivity },
    team: { title: 'Team & security', icon: 'shield', render: renderTeam },
  };
  function renderNav() {
    const link = (p, extra = '') => `<a href="#/${p}" data-page="${p}" title="${esc(PAGES[p].title)}">${icon(PAGES[p].icon)}<span>${PAGES[p].title}</span>${extra}</a>`;
    $('#nav').innerHTML = `
      <div class="nav-label">Workspace</div>
      ${link('overview')}${link('inbox', `<span class="badge" id="nav-unread" ${state.unreadChats ? '' : 'hidden'}>${state.unreadChats}</span>`)}${link('leads')}${link('confirmed')}${link('broadcast')}${link('pricing')}
      <div class="nav-label">Configure</div>
      ${link('flow')}${link('catalog')}${link('ai')}${link('profile')}${link('settings')}${link('team')}
      ${isAdmin() ? `<div class="nav-label">Admin</div>${link('clients')}` : ''}
      ${link('activity')}`;
    $$('#nav a').forEach((a) => a.addEventListener('click', () => $('#shell').classList.remove('nav-open')));
    // Phone: app-style tab bar. "More" opens the full menu as a drawer.
    const tab = (p, label, extra = '') => `<a href="#/${p}" data-page="${p}">${icon(PAGES[p].icon)}<span>${label}</span>${extra}</a>`;
    $('#tabbar').innerHTML = `${tab('overview', 'Home')}${tab('inbox', 'Inbox', `<span class="badge nav-unread" ${state.unreadChats ? '' : 'hidden'}>${state.unreadChats}</span>`)}${tab('leads', 'Leads')}${tab('broadcast', 'Broadcast')}
      <button type="button" id="tab-more">${icon('menu')}<span>More</span></button>`;
    $('#tab-more').addEventListener('click', () => $('#shell').classList.add('nav-open'));
    markActiveTab();
  }
  const TAB_PAGES = ['overview', 'inbox', 'leads', 'broadcast'];
  function markActiveTab() {
    const p = state.route?.page;
    $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.page === p));
    $('#tab-more')?.classList.toggle('active', !!p && !TAB_PAGES.includes(p));
  }

  // Phones show table rows as cards; CSS prints each cell's column name from data-label.
  function labelTables(root) {
    for (const table of root.querySelectorAll('table.table:not([data-labelled])')) {
      const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      if (!heads.length) continue;
      for (const tr of table.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => {
        if (heads[i] && !td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i]);
        if (i > 0 && /^[—-]?$/.test(td.textContent.trim()) && !td.querySelector('input, button, a, img')) td.classList.add('cell-empty');
      });
      table.setAttribute('data-labelled', '');
    }
  }
  new MutationObserver(() => labelTables(document.body)).observe(document.body, { childList: true, subtree: true });
  // Swipe the menu drawer left to close it; Escape closes it too.
  (() => {
    let x0 = null;
    document.addEventListener('touchstart', (e) => { x0 = $('#shell')?.classList.contains('nav-open') ? e.touches[0].clientX : null; }, { passive: true });
    document.addEventListener('touchend', (e) => { if (x0 !== null && x0 - e.changedTouches[0].clientX > 60) $('#shell').classList.remove('nav-open'); x0 = null; }, { passive: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#shell')?.classList.remove('nav-open'); });
  })();

  let skipNextRoute = false;
  let lastHash = location.hash;
  const isDirty = () => (state.route.page === 'flow' && state.builder?.dirty) || (state.route.page === 'profile' && state.profileDraft?.dirty) || (state.route.page === 'ai' && state.aiDraft?.dirty);
  function confirmLeave() { return !isDirty() || confirm('You have unsaved changes. Leave without saving?'); }
  window.addEventListener('hashchange', () => {
    if (skipNextRoute) { skipNextRoute = false; return; }
    if (!confirmLeave()) { skipNextRoute = true; location.hash = lastHash; return; }
    route();
  });
  window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  function route() {
    lastHash = location.hash;
    if (!state.auth) return;
    const [, page = 'overview', arg = null] = (location.hash || '#/overview').split('/');
    let p = PAGES[page] ? page : 'overview';
    if (PAGES[p].admin && !isAdmin()) p = 'overview';
    const prev = state.route.page;
    state.route = { page: p, arg: arg ? decodeURIComponent(arg) : null };
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === p));
    markActiveTab();
    document.body.classList.toggle('in-chat', p === 'inbox' && !!state.route.arg);
    $('#shell').classList.remove('nav-open');
    $('#page-title').textContent = PAGES[p].title;
    const pageEl = $('#page');
    pageEl.className = `page ${PAGES[p].flush ? 'flush' : ''}`;
    if (p !== prev) pageEl.scrollTop = 0;
    if (p === 'inbox' && prev === 'inbox' && state.inbox && $('#inbox')) { openChat(state.route.arg); return; }
    if (!state.tenant && !['clients', 'activity'].includes(p)) { pageEl.innerHTML = noTenantHtml(); hydrateIcons(pageEl); return; }
    PAGES[p].render();
    hydrateIcons(pageEl);
  }
  const noTenantHtml = () => `<div class="page-inner"><div class="card"><div class="empty">
    <span class="section-icon">${icon('building', 'lg')}</span><h3>No business yet</h3>
    <p>${isAdmin() ? 'Add your first business to start.' : 'Your account is not set up yet. Please contact your administrator.'}</p>
    ${isAdmin() ? '<a class="btn primary" href="#/clients">Add a business</a>' : ''}</div></div></div>`;

  // ============================================================
  // Overview
  // ============================================================
  async function renderOverview() {
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>${greet}, ${esc(state.tenant.businessName)}</h1><p>Here's how your WhatsApp is doing.</p></div>
        <span class="spacer"></span><a class="btn" href="#/broadcast">${icon('megaphone')}New broadcast</a><a class="btn primary" href="#/inbox">${icon('chat')}Open inbox</a></div>
      <div id="ov-attention"></div>
      <div class="kpis" id="ov-kpis">${'<div class="card kpi"><div class="skeleton" style="height:64px"></div></div>'.repeat(5)}</div>
      <div class="overview-grid">
        <div class="stack">
          <div class="card"><div class="card-head"><span class="section-icon">${icon('fire')}</span><div><h2>Funnel</h2><p>How far customers get in your WhatsApp flow</p></div></div><div class="card-body" id="ov-funnel"></div></div>
          <div class="card"><div class="card-head"><span class="section-icon blue">${icon('send')}</span><div><h2>Broadcast delivery</h2><p>Latest broadcast per customer, from WhatsApp</p></div></div><div class="card-body" id="ov-delivery"></div></div>
        </div>
        <div class="card"><div class="card-head"><span class="section-icon amber">${icon('calendar')}</span><div><h2>Upcoming bookings</h2><p>Times customers picked on WhatsApp</p></div></div><div id="ov-visits" class="list-rows"></div></div>
      </div></div>`;
    await loadOverview();
  }
  async function loadOverview() {
    if (!$('#ov-kpis')) return;
    let s;
    try { ({ data: s } = await api('GET', `/leads/${state.tenantId}/stats`)); } catch (err) { toast('Could not load stats', err.message, { kind: 'error' }); return; }
    const st = s.status;
    const kpi = (label, value, ic, cls, sub) => `<div class="card kpi"><div class="row"><span class="label">${label}</span><span class="section-icon ${cls}">${icon(ic, 'sm')}</span></div><div class="value">${value.toLocaleString()}</div><div class="sub">${sub}</div></div>`;
    const pct = (n) => (s.total ? `${Math.round((n / s.total) * 100)}% of customers` : '—');
    $('#ov-kpis').innerHTML = [
      kpi('Customers', s.total, 'users', 'indigo', `${s.newToday} new in the last 24h`),
      kpi('Engaged', st.ENGAGED, 'chat', 'amber', pct(st.ENGAGED)),
      kpi('Qualified', st.QUALIFIED, 'sparkle', 'blue', pct(st.QUALIFIED)),
      kpi('Converted', st.CONVERTED, 'check', '', pct(st.CONVERTED)),
      kpi('Opted out', st.COLD, 'x', 'red', pct(st.COLD)),
    ].join('');
    const reached = {
      'Reached': s.total - st.COLD,
      'Replied': st.ENGAGED + st.QUALIFIED + st.CONVERTED,
      'Qualified': st.QUALIFIED + st.CONVERTED,
      'Converted': st.CONVERTED,
    };
    const top = Math.max(1, reached.Reached);
    $('#ov-funnel').innerHTML = `<div class="funnel">${Object.entries(reached).map(([name, n]) => `
      <div class="funnel-row"><span class="name">${name}</span><div class="bar"><i style="width:${Math.max(n ? 3 : 0, (n / top) * 100)}%"></i></div><span class="num">${n.toLocaleString()}<small>${Math.round((n / top) * 100)}%</small></span></div>`).join('')}</div>`;
    const d = s.delivery; const dT = d.SENT + d.DELIVERED + d.READ + d.FAILED;
    const colors = { READ: '#10b981', DELIVERED: '#3b82f6', SENT: '#94a3b8', FAILED: '#e5484d' };
    $('#ov-delivery').innerHTML = dT ? `
      <div class="stacked">${['READ', 'DELIVERED', 'SENT', 'FAILED'].filter((k) => d[k]).map((k) => `<i style="width:${(d[k] / dT) * 100}%;background:${colors[k]}" title="${k}: ${d[k]}"></i>`).join('')}</div>
      <div class="legend">${['READ', 'DELIVERED', 'SENT', 'FAILED'].map((k) => `<span><i style="background:${colors[k]}"></i>${k[0] + k.slice(1).toLowerCase()} <b>${d[k].toLocaleString()}</b></span>`).join('')}</div>`
      : '<div class="empty" style="padding:16px"><p>No broadcasts tracked yet. <a href="#/broadcast">Send your first one</a>.</p></div>';
    $('#ov-visits').innerHTML = s.upcoming.length ? s.upcoming.map((v) => {
      const at = new Date(v.bookedAt);
      const detail = state.fields.filter((f) => f.type !== 'slots' && v.data?.[f.field]).slice(0, 2).map((f) => v.data[f.field]).join(' · ');
      return `<a class="list-row" href="#/inbox/${esc(v.phone)}" style="color:inherit;text-decoration:none">
        <span class="date-chip"><small>${at.toLocaleDateString([], { month: 'short' })}</small><b>${at.getDate()}</b></span>
        <div class="grow"><div class="title">${esc(displayName(v))}</div><div class="sub">${esc(at.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}${detail ? ` · ${esc(detail)}` : ''}</div></div>${icon('chat', 'sm')}</a>`;
    }).join('') : `<div class="empty"><span class="section-icon amber">${icon('calendar', 'lg')}</span><h3>No bookings yet</h3><p>When a customer picks a time slot on WhatsApp it shows up here.</p></div>`;
    const att = [];
    if (s.unreadChats) att.push(`<div class="banner green">${icon('chat')}<div><strong>${s.unreadChats} unread conversation${s.unreadChats > 1 ? 's' : ''}.</strong> <a href="#/inbox">Open inbox →</a></div></div>`);
    if (s.needsReply) att.push(`<div class="banner">${icon('pause')}<div><strong>${s.needsReply} chat${s.needsReply > 1 ? 's' : ''} waiting on your team</strong> — the bot is paused there and the customer wrote last.</div></div>`);
    if (!state.tenant.ai?.enabled) att.push(`<div class="banner blue">${icon('sparkle')}<div><strong>Turn on the AI assistant</strong> so customers get instant answers about prices, timings and FAQs. <a href="#/ai">Set it up →</a></div></div>`);
    $('#ov-attention').innerHTML = att.length ? `<div class="stack" style="gap:10px">${att.join('')}</div>` : '';
  }
  const refreshOverview = debounce(loadOverview, 600);

  // ============================================================
  // Inbox
  // ============================================================
  function renderInbox() {
    state.inbox = state.inbox || { chats: new Map(), filter: 'all', search: '', hasMore: false, active: null, lead: null, messages: [], hasOlder: false, detailsOpen: window.innerWidth > 1280 };
    const ib = state.inbox;
    $('#page').innerHTML = `<div class="inbox-wrap" style="height:100%"><div class="inbox ${ib.detailsOpen ? '' : 'no-details'}" id="inbox">
      <aside class="chat-list">
        <div class="chat-list-head">
          <div class="search">${icon('search', 'sm')}<input class="input" id="chat-search" placeholder="Search name or number" value="${esc(ib.search)}" /></div>
          <div class="tabs"><button data-filter="all" class="${ib.filter === 'all' ? 'active' : ''}">All chats</button><button data-filter="unread" class="${ib.filter === 'unread' ? 'active' : ''}">Unread</button></div>
        </div>
        <div class="chats" id="chats"></div>
      </aside>
      <section class="conversation" id="conversation"></section>
      <aside class="details" id="details"></aside>
    </div></div>`;
    $('#chat-search').addEventListener('input', debounce((e) => { ib.search = e.target.value.trim(); loadChats(true); }, 300));
    $$('.tabs button', $('#page')).forEach((b) => b.addEventListener('click', () => {
      ib.filter = b.dataset.filter;
      $$('.tabs button', $('#page')).forEach((x) => x.classList.toggle('active', x === b));
      loadChats(true);
    }));
    $('#chats').addEventListener('scroll', (e) => { const el = e.target; if (ib.hasMore && !ib.loading && el.scrollTop + el.clientHeight > el.scrollHeight - 120) loadChats(false); });
    loadChats(true);
    openChat(state.route.arg);
  }
  async function loadChats(reset) {
    const ib = state.inbox; if (!ib) return;
    ib.loading = true;
    if (reset) { ib.chats = new Map(); $('#chats').innerHTML = '<div style="padding:16px;display:grid;gap:12px">' + '<div class="skeleton" style="height:48px"></div>'.repeat(6) + '</div>'; }
    const last = reset ? null : [...ib.chats.values()].sort((a, b) => new Date(a.lastMessageAt) - new Date(b.lastMessageAt))[0];
    const q = new URLSearchParams({ limit: '30' });
    if (ib.search) q.set('search', ib.search);
    if (ib.filter === 'unread') q.set('unread', 'true');
    if (last?.lastMessageAt) q.set('before', last.lastMessageAt);
    try {
      const res = await api('GET', `/chats/${state.tenantId}?${q}`);
      res.data.forEach((l) => ib.chats.set(l.phone, l));
      ib.hasMore = res.hasMore; state.unreadChats = res.unreadChats;
      refreshUnread(); renderChatList();
    } catch (err) { $('#chats').innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`; } finally { ib.loading = false; }
  }
  function renderChatList({ flash } = {}) {
    const ib = state.inbox; const el = $('#chats');
    if (!ib || !el) return;
    let list = [...ib.chats.values()].filter((l) => l.lastMessageAt).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    if (ib.filter === 'unread') list = list.filter((l) => l.unreadCount > 0 || l.phone === ib.active);
    if (ib.search) { const s = ib.search.toLowerCase(); const dg = s.replace(/\D/g, ''); list = list.filter((l) => (l.name || '').toLowerCase().includes(s) || (dg && l.phone.includes(dg))); }
    if (!list.length) {
      el.innerHTML = `<div class="empty"><span class="section-icon">${icon('chat', 'lg')}</span><h3>${ib.search || ib.filter === 'unread' ? 'Nothing here' : 'No conversations yet'}</h3><p>${ib.search ? 'No chat matches your search.' : ib.filter === 'unread' ? "You're all caught up." : 'Chats appear here as soon as a customer messages you.'}</p></div>`;
      return;
    }
    el.innerHTML = list.map((l) => {
      const by = { bot: 'Bot', ai: 'AI', agent: 'You', broadcast: 'Broadcast' }[l.lastMessageSentBy] || '';
      const plain = String(l.lastMessagePreview || '').replace(/\*([^*\n]+)\*/g, '$1').replace(/~([^~\n]+)~/g, '$1');
      return `<div class="chat-item ${l.unreadCount ? 'unread' : ''} ${l.phone === ib.active ? 'active' : ''} ${flash === l.phone ? 'flash' : ''}" data-phone="${esc(l.phone)}" role="button" tabindex="0">
        ${avatar(l.name, l.phone)}
        <div class="grow">
          <div class="top"><span class="name">${esc(displayName(l))}</span><span class="time">${shortWhen(l.lastMessageAt)}</span></div>
          <div class="bottom"><span class="preview">${by ? `<span style="opacity:.7">${by}: </span>` : ''}${esc(plain)}</span>${l.unreadCount ? `<span class="badge">${l.unreadCount}</span>` : ''}</div>
          <div class="tags">${statusPill(l.status)}${l.language === 'te' ? '<span class="pill plain" title="Talks in Telugu">తె</span>' : ''}${l.botPaused ? `<span class="pill plain" title="Bot paused — your team is handling this chat">${icon('pause', 'sm')}Team</span>` : ''}</div>
        </div></div>`;
    }).join('') + (ib.hasMore ? '<div style="padding:12px;text-align:center" class="muted small">Scroll for more…</div>' : '');
    $$('.chat-item', el).forEach((item) => {
      const go = () => { location.hash = `#/inbox/${item.dataset.phone}`; };
      item.addEventListener('click', go);
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  }
  async function openChat(phone) {
    const ib = state.inbox; if (!ib) return;
    ib.active = phone || null;
    $('#inbox')?.classList.toggle('chat-open', !!phone);
    renderChatList();
    if (!phone) {
      ib.lead = null; ib.messages = [];
      $('#conversation').innerHTML = `<div class="no-chat"><div class="card">
        <span class="section-icon" style="margin:0 auto 12px;width:52px;height:52px;border-radius:16px">${icon('chat', 'lg')}</span>
        <h2>Your WhatsApp inbox</h2><p class="muted" style="margin-top:6px">Pick a conversation to see the full chat with the bot and AI, reply yourself, or pause the bot.</p></div></div>`;
      $('#details').innerHTML = '';
      return;
    }
    $('#conversation').innerHTML = `<div class="conv-head"><div class="skeleton" style="width:40px;height:40px;border-radius:50%"></div><div class="grow"><div class="skeleton" style="width:160px;height:14px"></div></div></div><div class="messages"></div>`;
    try {
      const res = await api('GET', `/chats/${state.tenantId}/${phone}/messages?limit=60`);
      if (ib.active !== phone) return;
      ib.lead = res.lead; ib.messages = res.data; ib.hasOlder = res.hasMore;
      if (!ib.chats.has(phone)) ib.chats.set(phone, res.lead);
    } catch (err) {
      $('#conversation').innerHTML = `<div class="no-chat"><div class="card"><h2>Chat not found</h2><p class="muted">${esc(err.message)}</p></div></div>`;
      return;
    }
    $('#conversation').innerHTML = '<div class="conv-head" id="conv-head"></div><div class="messages" id="messages"></div><div class="composer" id="composer"></div>';
    renderConvHead(); renderMessages(); renderComposer(); renderDetails();
    requestAnimationFrame(() => { const m = $('#messages'); if (m) m.scrollTop = m.scrollHeight; });
    if (ib.lead.unreadCount) markRead(phone);
  }
  const markRead = debounce(async (phone) => {
    try { const { lead } = await api('POST', `/chats/${state.tenantId}/${phone}/read`); onLeadUpdate(lead); refreshUnread(); } catch { /* ignore */ }
  }, 250);
  function renderConvHead() {
    const ib = state.inbox; const l = ib?.lead; const el = $('#conv-head');
    if (!l || !el) return;
    el.innerHTML = `
      <button class="btn icon ghost back" aria-label="Back to chats" id="conv-back">${icon('back')}</button>
      ${avatar(l.name, l.phone)}
      <div class="grow"><div class="name">${esc(displayName(l))}</div><div class="sub"><span>${esc(fmtPhone(l.phone))}</span>${statusPill(l.status)}</div></div>
      <select id="lang-pick" class="lang-pick" title="Language the bot uses with this customer (set automatically from what they write)">
        <option value="" ${!l.language ? 'selected' : ''}>🌐 Auto</option><option value="en" ${l.language === 'en' ? 'selected' : ''}>English</option><option value="te" ${l.language === 'te' ? 'selected' : ''}>తెలుగు</option></select>
      <label class="switch bot-toggle" title="When the bot is off, only your team replies in this chat">
        <input type="checkbox" id="bot-toggle" ${l.botPaused ? '' : 'checked'} /><span class="track"></span><span class="lbl">${l.botPaused ? 'Bot paused' : 'Bot on'}</span></label>
      <button class="btn icon ghost" id="details-toggle" title="Customer details" aria-label="Customer details">${icon('panel')}</button>`;
    $('#conv-back').addEventListener('click', () => { location.hash = '#/inbox'; });
    $('#details-toggle').addEventListener('click', () => { ib.detailsOpen = !ib.detailsOpen; $('#inbox').classList.toggle('no-details', !ib.detailsOpen); });
    $('#details').addEventListener('click', (e) => { if (e.target.closest('#details-close')) { ib.detailsOpen = false; $('#inbox').classList.add('no-details'); } });
    $('#lang-pick').addEventListener('change', async (e) => {
      try {
        const { lead } = await api('PATCH', `/chats/${state.tenantId}/${l.phone}`, { language: e.target.value || null });
        onLeadUpdate(lead);
        toast('Language updated', e.target.value === 'te' ? 'The bot will reply to this customer in Telugu.' : e.target.value === 'en' ? 'The bot will reply to this customer in English.' : 'The bot will pick the language from what the customer writes.');
      } catch (err) { toast('Could not change the language', err.message, { kind: 'error' }); }
    });
    $('#bot-toggle').addEventListener('change', async (e) => {
      const botPaused = !e.target.checked;
      try {
        const { lead } = await api('PATCH', `/chats/${state.tenantId}/${l.phone}`, { botPaused });
        onLeadUpdate(lead);
        toast(botPaused ? 'Bot paused for this chat' : 'Bot is back on', botPaused ? 'Only your team will reply to this customer.' : 'The bot will answer this customer’s next message.');
        log(`${botPaused ? 'Paused' : 'Resumed'} bot for +${l.phone}.`);
      } catch (err) { e.target.checked = !e.target.checked; toast('Could not change the bot', err.message, { kind: 'error' }); }
    });
  }
  const SENDER = { bot: ['bot', 'Bot'], ai: ['sparkle', 'AI assistant'], agent: ['user', 'You'], broadcast: ['megaphone', 'Broadcast'] };
  function metaHtml(m) {
    let ticks = '';
    if (m.direction === 'out') {
      if (m.status === 'failed') ticks = `<span title="${esc(m.error || 'Not delivered')}">${icon('alert', 'tick failed')}</span>`;
      else if (m.status === 'read') ticks = TICK2('read');
      else if (m.status === 'delivered') ticks = TICK2('');
      else ticks = TICK1;
    }
    return `<span class="meta">${m.createdAt ? timeOf(m.createdAt) : ''}${ticks}</span>`;
  }
  function messageHtml(m, prev) {
    const out = m.direction === 'out';
    const gap = !prev || prev.direction !== m.direction || prev.sentBy !== m.sentBy || new Date(m.createdAt) - new Date(prev.createdAt) > 5 * 60e3;
    const [ic, who] = SENDER[m.sentBy] || [];
    const whoHtml = out && gap && who ? `<div class="who ${m.sentBy}">${icon(ic, 'sm')}${who}</div>` : '';
    const meta = m.meta || {};
    let inner = ''; let after = '';
    const textHtml = (t) => (t ? `<div class="text">${wa(t)}</div>` : '');
    const photo = (src) => `<a href="${esc(src)}" target="_blank" rel="noopener" class="bubble-photo"><img src="${esc(src)}" alt="" loading="lazy" /></a>`;
    // Customer media saved in R2: loaded with the API key (see hydrateMedia), so it is never public.
    const file = meta.media ? esc(meta.media) : '';
    const missing = (what) => `<div class="tapped">${esc(meta.label || m.type)}</div>${textHtml(m.text)}<div class="text muted small">${meta.tooLarge ? 'File is too large to show here.' : `This ${what} could not be loaded.`}</div>`;
    switch (m.type) {
      case 'image':
      case 'sticker':
        if (meta.link) inner = `${photo(meta.link)}${textHtml(m.text)}`;
        else if (file) inner = `<a class="bubble-photo media-slot ${m.type}" data-media="${file}" data-kind="image" target="_blank" rel="noopener"><img alt="Photo from customer" /></a>${textHtml(m.text)}`;
        else inner = missing('photo');
        break;
      case 'audio':
      case 'voice':
        inner = file
          ? `<div class="tapped">${icon('mic', 'sm')}Voice message</div><audio class="media-slot" data-media="${file}" data-kind="audio" controls preload="none"></audio>${m.text ? `<div class="transcript"><span>${meta.transcript ? 'Transcript' : 'Caption'}</span>${wa(m.text)}</div>` : ''}`
          : missing('voice message');
        break;
      case 'video':
        inner = file ? `<video class="media-slot bubble-video" data-media="${file}" data-kind="video" controls preload="none"></video>${textHtml(m.text)}` : missing('video');
        break;
      case 'unsupported':
        inner = `<div class="tapped">${icon('alert', 'sm')}${esc(meta.label || 'Unsupported message')}</div>
          <dl class="unsup">
            <dt>From</dt><dd>${esc(fmtPhone(m.phone))}</dd>
            <dt>Kind</dt><dd>${esc(meta.kindLabel || 'Not told by Meta')}</dd>
            ${meta.code ? `<dt>Meta code</dt><dd>${esc(meta.code)}${meta.title ? ` · ${esc(meta.title)}` : ''}</dd>` : ''}
            <dt>Meta says</dt><dd>${esc(meta.details || meta.note || 'Message type is currently not supported.')}</dd></dl>
          <div class="text muted small">Meta does not send the content of this message to any app. Ask the customer to send it again as text, a photo, a voice note or a document.</div>`;
        break;
      case 'buttons':
        inner = `${meta.image ? photo(meta.image) : ''}${textHtml(m.text)}`;
        after = `<div class="chips">${(meta.buttons || []).map((b) => `<div class="chip">${icon('reply', 'sm')}${esc(b)}</div>`).join('')}</div>`;
        break;
      case 'list':
        inner = `${meta.header ? `<div style="font-weight:700;margin-bottom:2px">${esc(meta.header)}</div>` : ''}${textHtml(m.text)}
          <div class="list-rows-preview">${(meta.rows || []).map((r) => `<div>• ${esc(r.title)}${r.description ? `<small>${esc(r.description)}</small>` : ''}</div>`).join('')}</div>`;
        after = `<div class="chips"><div class="chip">${icon('list', 'sm')}${esc(meta.button || 'Options')}</div></div>`;
        break;
      case 'document':
        if (!meta.link && file) { inner = `<a class="attach media-slot" data-media="${file}" data-kind="file" download="${esc(meta.filename || 'document')}" target="_blank" rel="noopener"><span class="file-ico">${esc((meta.filename || '').split('.').pop().slice(0, 4).toUpperCase() || 'FILE')}</span><div class="grow"><strong>${esc(meta.filename || 'Document')}</strong><small>${meta.size ? `${Math.max(1, Math.round(meta.size / 1024))} KB · ` : ''}Open</small></div></a>${textHtml(m.text)}`; break; }
        if (!meta.link && m.direction === 'in') { inner = missing('document'); break; }
        inner = `<a class="attach" href="${esc(meta.link || '#')}" target="_blank" rel="noopener"><span class="file-ico">PDF</span><div class="grow"><strong>${esc(meta.filename || 'Document')}</strong><small>Open document</small></div></a>${textHtml(m.text)}`;
        break;
      case 'location': {
        const href = meta.latitude != null ? `https://www.google.com/maps?q=${encodeURIComponent(`${meta.latitude},${meta.longitude}`)}` : '#';
        inner = `<a class="attach" href="${href}" target="_blank" rel="noopener"><span class="file-ico map">${icon('pin', 'sm')}</span><div class="grow"><strong>${esc(meta.name || m.text || 'Location')}</strong><small>${esc(meta.address || 'Open in Maps')}</small></div></a>`;
        break;
      }
      case 'template':
        inner = `<div class="attach" style="margin-bottom:2px"><span class="file-ico" style="background:#d97706">${icon('template', 'sm')}</span><div class="grow"><strong>${esc(meta.name || 'Template')}</strong><small>${(meta.params || []).length ? esc(meta.params.join(' · ')) : 'Approved WhatsApp template'}</small></div></div>`;
        break;
      case 'reply': inner = `<div class="tapped">${icon('reply', 'sm')}Tapped</div>${textHtml(m.text)}`; break;
      case 'reaction': inner = `<div class="reaction">${esc(m.text)}</div>`; break;
      case 'text': inner = textHtml(m.text); break;
      default: inner = `<div class="tapped">${esc(meta.label || m.type)}</div>${textHtml(m.text)}${!m.text ? '<div class="text muted small">This message could not be shown here.</div>' : ''}`;
    }
    return `<div class="msg ${out ? 'out' : 'in'} ${gap ? 'gap' : ''}" data-id="${esc(m._id)}"><div class="bubble">${whoHtml}${inner}${metaHtml(m)}</div>${after}</div>`;
  }
  function messagesHtml(list, prevBefore = null) {
    let html = ''; let prev = prevBefore;
    for (const m of list) {
      if (!prev || !sameDay(new Date(prev.createdAt), new Date(m.createdAt))) { html += `<div class="day-sep">${esc(dayLabel(m.createdAt))}</div>`; prev = null; }
      html += messageHtml(m, prev); prev = m;
    }
    return html;
  }
  function renderMessages() {
    const ib = state.inbox; const el = $('#messages'); if (!el) return;
    el.innerHTML = (ib.hasOlder ? '<button class="btn sm load-older" id="load-older">Load earlier messages</button>' : '') + (ib.messages.length ? messagesHtml(ib.messages) : '<div class="empty"><p>No messages yet.</p></div>');
    $('#load-older')?.addEventListener('click', loadOlder);
    el.scrollTop = el.scrollHeight;
  }
  async function loadOlder() {
    const ib = state.inbox; const el = $('#messages'); const first = ib.messages[0]; if (!first) return;
    const h = el.scrollHeight;
    try {
      const res = await api('GET', `/chats/${state.tenantId}/${ib.active}/messages?limit=60&before=${encodeURIComponent(first.createdAt)}`);
      ib.messages = [...res.data, ...ib.messages]; ib.hasOlder = res.hasMore;
      renderMessages(); el.scrollTop = el.scrollHeight - h;
    } catch (err) { toast('Could not load older messages', err.message, { kind: 'error' }); }
  }
  function appendMessages(list) {
    const ib = state.inbox; const el = $('#messages');
    const fresh = list.filter((m) => !ib.messages.some((x) => String(x._id) === String(m._id)));
    if (!fresh.length) return;
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    const prev = ib.messages[ib.messages.length - 1] || null;
    ib.messages.push(...fresh);
    if (!el) return;
    $('.empty', el)?.remove();
    el.insertAdjacentHTML('beforeend', messagesHtml(fresh, prev));
    if (nearBottom || fresh.some((m) => m.sentBy === 'agent')) el.scrollTop = el.scrollHeight;
  }
  function windowInfo(lead) {
    if (!lead?.lastInboundAt) return { open: false, left: 0 };
    const left = 24 * 3600e3 - (Date.now() - new Date(lead.lastInboundAt));
    return { open: left > 0, left };
  }
  function renderComposer() {
    const ib = state.inbox; const l = ib?.lead; const el = $('#composer');
    if (!l || !el) return;
    const draft = $('#reply-text')?.value || '';
    if (l.status === 'COLD') { el.innerHTML = `<div class="banner red">${icon('x')}<div><strong>This customer opted out.</strong> WhatsApp policy doesn't allow messaging them again unless they write to you first.</div></div>`; return; }
    const w = windowInfo(l);
    if (!w.open) { el.innerHTML = `<div class="banner">${icon('clock')}<div><strong>The 24-hour reply window is closed.</strong> WhatsApp only lets you reply within 24 hours of the customer's last message. Re-engage them with a <a href="#/broadcast">broadcast template</a>.</div></div>`; return; }
    const hours = Math.floor(w.left / 3600e3); const mins = Math.floor((w.left % 3600e3) / 60e3);
    el.innerHTML = `
      <div class="row"><textarea id="reply-text" rows="1" placeholder="Type a reply…" aria-label="Reply">${esc(draft)}</textarea>
        <button class="btn primary" id="send-btn" aria-label="Send" title="Send (Enter)">${icon('send')}</button></div>
      <div class="composer-note">${icon('clock', 'sm')}Reply window closes in ${hours ? `${hours}h ` : ''}${mins}m${l.botPaused ? '' : ' · Sending pauses the bot for this chat'}<span class="spacer"></span><span class="hide-sm">Enter to send · Shift+Enter for a new line</span></div>`;
    const ta = $('#reply-text');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(160, ta.scrollHeight)}px`; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } });
    $('#send-btn').addEventListener('click', sendReply);
    grow();
  }
  async function sendReply() {
    const ib = state.inbox; const ta = $('#reply-text'); const btn = $('#send-btn');
    const text = ta.value.trim(); if (!text) return;
    btn.disabled = true; ta.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const res = await api('POST', `/chats/${state.tenantId}/${ib.active}/messages`, { text });
      ta.value = '';
      if (res.data) appendMessages([res.data]);
      if (res.lead) onLeadUpdate(res.lead);
      log(`Replied to +${ib.active}.`, 'success');
    } catch (err) {
      toast('Message not sent', err.message, { kind: 'error', timeout: 7000 });
      if (err.data?.code === 'WINDOW_CLOSED') renderComposer();
    } finally {
      const b = $('#send-btn'); const t = $('#reply-text');
      if (b) { b.disabled = false; b.innerHTML = icon('send'); }
      if (t) { t.disabled = false; t.focus(); t.dispatchEvent(new Event('input')); }
    }
  }
  function renderDetails() {
    const l = state.inbox?.lead; const el = $('#details');
    if (!l || !el) return;
    const answers = state.fields.filter((f) => l.data?.[f.field]);
    el.innerHTML = `
      <div class="details-bar"><button type="button" class="btn icon ghost" id="details-close" aria-label="Close customer details">${icon('x')}</button><strong>Customer details</strong></div>
      <div class="details-head">${avatar(l.name, l.phone)}<div class="name">${esc(displayName(l))}</div>
        <a href="tel:+${esc(l.phone)}" class="small">${icon('phone', 'sm')} ${esc(fmtPhone(l.phone))}</a>${statusPill(l.status)}</div>
      <div class="details-section"><h4>Answers</h4>${answers.length ? `<dl class="kv">${answers.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(l.data[f.field])}</dd>`).join('')}</dl>` : '<p class="muted small">No answers yet.</p>'}</div>
      ${l.bookedAt && new Date(l.bookedAt) > new Date() ? `<div class="details-section"><div class="banner green">${icon('calendar')}<div><strong>Booked</strong><br>${esc(bookedLabel(l))}</div></div></div>` : ''}
      <div class="details-section"><h4>Broadcast</h4><dl class="kv">
        <dt>Delivery</dt><dd>${deliveryPill(l)}</dd><dt>Last sent</dt><dd>${l.lastBroadcastAt ? esc(new Date(l.lastBroadcastAt).toLocaleString()) : '—'}</dd>
        ${l.broadcastError ? `<dt>Error</dt><dd style="color:var(--danger)">${esc(l.broadcastError)}</dd>` : ''}</dl></div>
      <div class="details-section"><h4>Team alert</h4><dl class="kv">
        <dt>Alert</dt><dd>${l.adminAlertStatus ? `<span class="pill ${l.adminAlertStatus === 'FAILED' ? 'd-FAILED' : 'd-READ'}">${esc(l.adminAlertStatus.toLowerCase())}</span>` : '<span class="muted">None yet</span>'}</dd>
        ${l.adminAlertError ? `<dt>Why</dt><dd style="color:var(--danger)">${esc(l.adminAlertError)}</dd>` : ''}</dl></div>
      <div class="details-section"><h4>Timeline</h4><dl class="kv"><dt>First seen</dt><dd>${esc(new Date(l.createdAt).toLocaleString())}</dd><dt>Last message</dt><dd>${relTime(l.lastMessageAt)}</dd></dl></div>
      <div class="details-section"><h4>Privacy</h4><p class="muted small" style="margin:0 0 8px">Chats and customer files are kept for 1 year. If this customer asks to be forgotten:</p>
        <button type="button" class="btn sm danger" id="forget-customer">${icon('trash', 'sm')}Delete this customer's data</button></div>`;
    hydrateIcons(el);
    $('#forget-customer')?.addEventListener('click', async (e) => {
      if (!confirm(`Delete everything about ${displayName(l)} (+${l.phone})?\n\nThis removes their messages, photos, voice notes, answers and booking. It cannot be undone.`)) return;
      const b = e.currentTarget; b.disabled = true;
      try {
        const { removed } = await api('DELETE', `/chats/${state.tenantId}/${l.phone}`);
        toast('Customer data deleted', `${removed.messages} messages and ${removed.files} files removed.`);
        state.inbox?.chats?.delete(l.phone);
        location.hash = '#/inbox';
      } catch (x) { toast('Could not delete', x.message, { kind: 'error' }); b.disabled = false; }
    });
  }

  // ============================================================
  // Leads
  // ============================================================
  const leadsState = { page: 1, status: '', search: '' };
  function renderLeads() {
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Leads</h1><p>Everyone you've broadcast to or who has messaged ${esc(bizName())}.</p></div><span class="spacer"></span>
        <a class="btn primary" href="#/broadcast">${icon('upload')}Import & broadcast</a></div>
      <div class="row wrap"><div class="filters" id="lead-filters"></div><span class="spacer"></span>
        <div class="search" style="width:min(280px,100%)">${icon('search', 'sm')}<input class="input" id="lead-search" placeholder="Search name or number" value="${esc(leadsState.search)}" /></div></div>
      <div class="card"><div class="table-wrap" id="leads-table"><div style="padding:20px;display:grid;gap:12px">${'<div class="skeleton" style="height:36px"></div>'.repeat(6)}</div></div><div id="leads-pager"></div></div></div>`;
    $('#lead-search').addEventListener('input', debounce((e) => { leadsState.search = e.target.value.trim(); leadsState.page = 1; loadLeads(); }, 300));
    loadLeads();
  }
  const refreshLeads = debounce(() => { if ($('#leads-table')) loadLeads(); }, 1500);
  async function loadLeads() {
    const q = new URLSearchParams({ page: leadsState.page, limit: 50 });
    if (leadsState.status) q.set('status', leadsState.status);
    if (leadsState.search) q.set('search', leadsState.search);
    let res; let stats;
    try { [res, { data: stats }] = await Promise.all([api('GET', `/leads/${state.tenantId}?${q}`), api('GET', `/leads/${state.tenantId}/stats`)]); }
    catch (err) { $('#leads-table').innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`; return; }
    if (!$('#lead-filters')) return;
    const filters = [['', 'All', stats.total], ...Object.keys(STATUS_LABELS).map((s) => [s, STATUS_LABELS[s], stats.status[s]])];
    $('#lead-filters').innerHTML = filters.map(([v, label, n]) => `<button class="filter ${leadsState.status === v ? 'active' : ''}" data-v="${v}">${label}<span class="n">${(n || 0).toLocaleString()}</span></button>`).join('');
    $$('#lead-filters .filter').forEach((b) => b.addEventListener('click', () => { leadsState.status = b.dataset.v; leadsState.page = 1; loadLeads(); }));
    if (!res.data.length) {
      $('#leads-table').innerHTML = `<div class="empty"><span class="section-icon indigo">${icon('users', 'lg')}</span><h3>No leads here</h3><p>${leadsState.status || leadsState.search ? 'Nothing matches these filters.' : 'Import a CSV on the Broadcast page, or wait for customers to message you.'}</p></div>`;
      $('#leads-pager').innerHTML = '';
      return;
    }
    const cols = state.fields.filter((f) => f.type !== 'slots').slice(0, 3);
    const hasSlots = state.fields.some((f) => f.type === 'slots');
    $('#leads-table').innerHTML = `<table class="table"><thead><tr><th>Customer</th>${cols.map((f) => `<th>${esc(f.label)}</th>`).join('')}${hasSlots ? '<th>Booking</th>' : ''}<th>Delivery</th><th>Status</th><th>Last activity</th><th></th></tr></thead><tbody>
      ${res.data.map((l) => `<tr>
        <td><div class="person">${avatar(l.name, l.phone)}<div><strong>${esc(displayName(l))}</strong><small>${esc(fmtPhone(l.phone))}</small></div></div></td>
        ${cols.map((f) => `<td>${l.data?.[f.field] ? esc(l.data[f.field]) : '<span class="muted">—</span>'}</td>`).join('')}
        ${hasSlots ? `<td>${l.bookedAt ? esc(bookedLabel(l)) : '<span class="muted">—</span>'}</td>` : ''}
        <td>${deliveryPill(l)}</td>
        <td>${statusPill(l.status)}${l.adminAlertStatus === 'FAILED' ? ` <span class="pill d-FAILED" title="${esc(l.adminAlertError || 'The WhatsApp alert to your team could not be delivered')}">alert failed</span>` : ''}</td>
        <td class="muted">${relTime(l.lastMessageAt || l.updatedAt)}</td>
        <td>${l.lastMessageAt ? `<a class="btn sm" href="#/inbox/${esc(l.phone)}">${icon('chat', 'sm')}Chat</a>` : ''}</td></tr>`).join('')}
      </tbody></table>`;
    const from = (res.page - 1) * res.limit + 1;
    $('#leads-pager').innerHTML = `<div class="pager"><span>Showing ${from}–${from + res.data.length - 1} of ${res.total.toLocaleString()}</span><span class="spacer"></span>
      <button class="btn sm" id="pg-prev" ${res.page <= 1 ? 'disabled' : ''}>${icon('back', 'sm')}Prev</button><span>Page ${res.page} of ${res.pages}</span>
      <button class="btn sm" id="pg-next" ${res.page >= res.pages ? 'disabled' : ''}>Next</button></div>`;
    $('#pg-prev').addEventListener('click', () => { leadsState.page -= 1; loadLeads(); });
    $('#pg-next').addEventListener('click', () => { leadsState.page += 1; loadLeads(); });
  }

  // ============================================================
  // Confirmed: customers who finished the flow (bookings / orders), kept apart from other leads
  // ============================================================
  const confState = { tab: 'upcoming', search: '', rows: null };
  const fieldLabel = (key) => state.fields.find((f) => f.field === key)?.label || key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  /** Everything the customer answered, in flow order, then any older answers. */
  const leadDetails = (l) => {
    const d = l.data || {}; const order = state.fields.map((f) => f.field);
    const slotFields = new Set(state.fields.filter((f) => f.type === 'slots').map((f) => f.field)); // shown as "Booked for"
    return Object.keys(d).filter((k) => d[k] !== '' && d[k] != null && typeof d[k] !== 'object' && !(l.bookedAt && slotFields.has(k)))
      .sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)).map((k) => [fieldLabel(k), String(d[k])]);
  };
  function renderConfirmed() {
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Confirmed</h1><p>Customers who completed your flow — bookings, appointments and orders — with everything they told the bot.</p></div><span class="spacer"></span>
        <button class="btn" id="conf-export">${icon('download')}Export CSV</button></div>
      <div class="row wrap"><div class="filters" id="conf-tabs"></div><span class="spacer"></span>
        <div class="search" style="width:min(280px,100%)">${icon('search', 'sm')}<input class="input" id="conf-search" placeholder="Search name, number or detail" value="${esc(confState.search)}" /></div></div>
      <div class="card"><div class="table-wrap" id="conf-table"><div style="padding:20px;display:grid;gap:12px">${'<div class="skeleton" style="height:36px"></div>'.repeat(5)}</div></div></div></div>`;
    $('#conf-search').addEventListener('input', debounce((e) => { confState.search = e.target.value.trim().toLowerCase(); drawConfirmed(); }, 200));
    $('#conf-export').addEventListener('click', exportConfirmed);
    loadConfirmed();
  }
  const refreshConfirmed = debounce(() => { if ($('#conf-table')) loadConfirmed(); }, 1500);
  async function loadConfirmed() {
    try {
      const rows = []; let page = 1; let pages = 1;
      do { const r = await api('GET', `/leads/${state.tenantId}?status=CONVERTED&limit=500&page=${page}`); rows.push(...r.data); pages = r.pages; page += 1; } while (page <= pages && page <= 10);
      confState.rows = rows;
    } catch (err) { if ($('#conf-table')) $('#conf-table').innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`; return; }
    drawConfirmed();
  }
  function confirmedList() {
    const now = Date.now(); const all = confState.rows || [];
    const tabs = {
      upcoming: all.filter((l) => l.bookedAt && new Date(l.bookedAt).getTime() >= now).sort((a, b) => new Date(a.bookedAt) - new Date(b.bookedAt)),
      past: all.filter((l) => l.bookedAt && new Date(l.bookedAt).getTime() < now).sort((a, b) => new Date(b.bookedAt) - new Date(a.bookedAt)),
      nodate: all.filter((l) => !l.bookedAt),
      all: [...all].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    };
    return tabs;
  }
  function drawConfirmed() {
    if (!$('#conf-table')) return;
    const tabs = confirmedList();
    const labels = [['upcoming', 'Upcoming'], ['past', 'Past'], ['nodate', 'No time picked'], ['all', 'All confirmed']].filter(([k]) => k !== 'nodate' || tabs.nodate.length);
    if (!labels.some(([k]) => k === confState.tab)) confState.tab = 'all';
    $('#conf-tabs').innerHTML = labels.map(([k, l]) => `<button class="filter ${confState.tab === k ? 'active' : ''}" data-tab="${k}">${l}<span class="n">${tabs[k].length}</span></button>`).join('');
    $$('#conf-tabs .filter').forEach((b) => b.addEventListener('click', () => { confState.tab = b.dataset.tab; drawConfirmed(); }));
    const q = confState.search;
    const rows = tabs[confState.tab].filter((l) => !q || `${l.name || ''} ${l.phone} ${leadDetails(l).map((x) => x[1]).join(' ')}`.toLowerCase().includes(q));
    if (!rows.length) {
      $('#conf-table').innerHTML = `<div class="empty"><span class="section-icon">${icon('check', 'lg')}</span><h3>${(confState.rows || []).length ? 'Nothing here' : 'No confirmed customers yet'}</h3><p>${(confState.rows || []).length ? (q ? 'Nothing matches your search.' : 'Try another tab.') : 'When a customer reaches the last step of your flow, they appear here.'}</p></div>`;
      return;
    }
    $('#conf-table').innerHTML = `<table class="table"><thead><tr><th>Customer</th><th>Booked for</th><th>Details</th><th>Team alert</th><th>Confirmed</th><th></th></tr></thead><tbody>
      ${rows.map((l) => `<tr>
        <td><div class="person">${avatar(l.name, l.phone)}<div><strong>${esc(displayName(l))}</strong><small>${esc(fmtPhone(l.phone))}</small></div></div></td>
        <td>${l.bookedAt ? `<strong>${esc(bookedLabel(l))}</strong>` : '<span class="muted">—</span>'}${l.data?.booking_note ? ` <span class="pill ${l.data.booking_note === 'Cancelled' ? 'd-FAILED' : 'plain'}">${esc(l.data.booking_note)}</span>` : ''}</td>
        <td><div class="conf-details">${leadDetails(l).map(([k, v]) => `<span class="pill plain" title="${esc(k)}"><span class="muted">${esc(k)}:</span>&nbsp;${esc(v)}</span>`).join('') || '<span class="muted">—</span>'}</div></td>
        <td>${l.adminAlertStatus === 'SENT' ? '<span class="pill d-READ">sent</span>' : l.adminAlertStatus === 'FAILED' ? `<span class="pill d-FAILED" title="${esc(l.adminAlertError || '')}">failed</span>` : '<span class="muted">—</span>'}</td>
        <td class="muted">${relTime(l.adminAlertAt || l.updatedAt)}</td>
        <td><a class="btn sm" href="#/inbox/${esc(l.phone)}">${icon('chat', 'sm')}Chat</a></td></tr>`).join('')}
      </tbody></table>`;
  }
  function exportConfirmed() {
    const rows = confirmedList()[confState.tab] || [];
    if (!rows.length) { toast('Nothing to export'); return; }
    const keys = [...new Set(rows.flatMap((l) => leadDetails(l).map((x) => x[0])))];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Name', 'Phone', 'Booked for', ...keys, 'Confirmed at'].map(cell).join(',')];
    for (const l of rows) {
      const d = Object.fromEntries(leadDetails(l));
      lines.push([l.name || '', `+${l.phone}`, bookedLabel(l), ...keys.map((k) => d[k] || ''), l.adminAlertAt || l.updatedAt].map(cell).join(','));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
    a.download = `confirmed-${confState.tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ============================================================
  // Broadcast
  // ============================================================
  // ---------- Broadcast: daily limit, message (template + blanks + project), campaigns ----------
  const inr = (n) => `₹${(Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const atLabel = (d) => (d ? new Date(d).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  const hourLabel = (h) => (h === 0 || h === 24 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`);
  const bcData = { limit: null, reasons: {}, campaigns: [], templates: null, tplError: '', msg: null };
  let bcTimer = null;

  function drawLimit() {
    const el = $('#bc-limit'); const L = bcData.limit; if (!el || !L) return;
    const cap = L.unlimited ? 'Unlimited' : L.limit.toLocaleString('en-IN');
    const pct = L.unlimited ? 0 : Math.min(100, Math.round((L.used / Math.max(L.limit, 1)) * 100));
    const meta = L.metaLimit == null ? 'not checked yet' : L.metaLimit === 'unlimited' ? 'Unlimited' : `${Number(L.metaLimit).toLocaleString('en-IN')} a day`;
    const q = String(L.quality || '').toUpperCase();
    el.innerHTML = `
      <div class="stat-chips"><div class="stat-chip"><b>${cap}</b><span>Daily limit${L.mode === 'manual' ? ' (yours)' : ' (Meta)'}</span></div>
        <div class="stat-chip"><b>${L.used.toLocaleString('en-IN')}</b><span>Used, last 24 h</span></div>
        <div class="stat-chip"><b>${L.unlimited ? '∞' : L.room.toLocaleString('en-IN')}</b><span>Left right now</span></div></div>
      ${L.unlimited ? '' : `<div class="bar" title="${pct}% used"><i style="width:${pct}%"></i></div>`}
      ${!L.unlimited && L.room === 0 && L.freesAt ? `<p class="hint">More room from about <strong>${esc(atLabel(L.freesAt))}</strong> (Meta counts the last 24 hours).</p>` : ''}
      <p class="hint">Meta's limit for your number: <strong>${esc(meta)}</strong>${q ? ` · quality <span class="pill ${q === 'GREEN' ? 'd-READ' : q === 'YELLOW' ? 'd-QUEUED' : 'd-FAILED'}">${q === 'GREEN' ? 'High' : q === 'YELLOW' ? 'Medium' : q === 'RED' ? 'Low' : esc(q)}</span>` : ''}${L.metaCheckedAt ? ` · checked ${esc(relTime(L.metaCheckedAt))}` : ''}
        <button type="button" class="btn sm ghost" id="bc-limit-check">${icon('refresh', 'sm')}Check now</button></p>
      ${L.aboveMeta ? `<div class="banner red">${icon('alert')}<div>Your number (${L.limit.toLocaleString('en-IN')}) is higher than Meta's limit (${esc(meta)}). WhatsApp will refuse the extra messages — use Auto, or a number up to Meta's limit.</div></div>` : ''}
      ${['YELLOW', 'RED'].includes(q) ? `<div class="banner amber">${icon('alert')}<div>Your number's quality is ${q === 'RED' ? 'low' : 'medium'}. Send only to people who know you, and fewer per day, until it is back to High.</div></div>` : ''}
      <form class="stack" id="bc-limit-form" style="gap:10px">
        <div class="row wrap" style="gap:14px">
          <label class="row" style="gap:6px"><input type="radio" name="mode" value="auto" ${L.mode !== 'manual' ? 'checked' : ''} />Auto — follow Meta (250 → 2,000 → 10,000 … by itself)</label>
          <label class="row" style="gap:6px"><input type="radio" name="mode" value="manual" ${L.mode === 'manual' ? 'checked' : ''} />My own number</label>
          <input class="input" type="number" name="manual" min="1" max="1000000" placeholder="e.g. 2000" value="${esc(L.manualLimit ?? '')}" style="width:130px" ${L.mode === 'manual' ? '' : 'hidden'} /></div>
        <div class="row wrap" style="gap:8px"><span class="muted small">Send only between</span>
          <select class="input" name="start" style="width:auto">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === L.startHour ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}</select>
          <span class="muted small">and</span>
          <select class="input" name="end" style="width:auto">${Array.from({ length: 24 }, (_, i) => i + 1).map((h) => `<option value="${h}" ${h === L.endHour ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}</select>
          <span class="muted small">(India time — never at night)</span></div>
        <details><summary class="small">Price per message (for the cost shown before sending)</summary>
          <div class="row wrap" style="gap:8px;margin-top:8px"><label class="field" style="margin:0"><span>Marketing ₹</span><input class="input" type="number" step="0.01" min="0" name="costM" value="${esc(L.costMarketing)}" style="width:110px" /></label>
          <label class="field" style="margin:0"><span>Utility ₹</span><input class="input" type="number" step="0.01" min="0" name="costU" value="${esc(L.costUtility)}" style="width:110px" /></label></div>
          <p class="hint">Your Meta bill: 10 marketing messages cost ₹8.63 (about ₹0.86 each). Check WhatsApp Manager → Insights → Message pricing.</p></details>
        <div class="row" style="gap:8px"><button class="btn sm primary" type="submit">Save</button><span id="bc-limit-msg" class="small"></span></div>
      </form>`;
    hydrateIcons(el);
    const f = $('#bc-limit-form');
    f.addEventListener('change', (e) => { if (e.target.name === 'mode') f.manual.hidden = f.mode.value !== 'manual'; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#bc-limit-msg'); msg.textContent = 'Saving…'; msg.className = 'small muted';
      try {
        const res = await api('PUT', `/tenants/${state.tenantId}/sending`, { limitMode: f.mode.value, manualLimit: f.mode.value === 'manual' ? f.manual.value : null,
          startHour: Number(f.start.value), endHour: Number(f.end.value), costMarketing: Number(f.costM.value), costUtility: Number(f.costU.value) });
        bcData.limit = res.limit; drawLimit(); drawSendSummary(); toast('Saved', 'Daily limit and sending hours updated.');
      } catch (err) { msg.textContent = err.message; msg.className = 'small'; msg.style.color = 'var(--danger)'; }
    });
    $('#bc-limit-check').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
      try { bcData.limit = (await api('POST', `/tenants/${state.tenantId}/sending/refresh`)).limit; drawLimit(); drawSendSummary(); }
      catch (err) { toast('Could not check', err.message, { kind: 'error' }); b.disabled = false; b.innerHTML = `${icon('refresh', 'sm')}Check now`; hydrateIcons(b.parentElement); }
    });
  }

  // The message: template, what fills each blank, the project, a photo, Telugu, when to start.
  const SRC_LABELS = { name: 'Customer name', business: 'Business name', project: 'Project name', price: 'Project price', column: 'A CSV column…', text: 'Fixed text…' };
  const tplKey = (t) => `${t.name}|${t.language}`;
  function defaultParams(t) {
    const out = {};
    t.vars.forEach((k, i) => {
      const n = k.toLowerCase();
      out[k] = /name|customer/.test(n) && !/business|project/.test(n) ? { src: 'name' } : /business|company/.test(n) ? { src: 'business' } : /project|property/.test(n) ? { src: 'project' }
        : /price|cost/.test(n) ? { src: 'price' } : t.vars.length <= 2 ? { src: i === 0 ? 'name' : 'business' } : { src: 'text', arg: '' };
    });
    return out;
  }
  async function loadTemplates() {
    if (bcData.templates) return;
    try {
      const res = await api('GET', `/campaigns/${state.tenantId}/templates`);
      bcData.templates = res.data; bcData.tplError = '';
      const first = res.data.find((t) => t.name === res.defaultName && !t.unsupported) || res.data.find((t) => !t.unsupported);
      if (!bcData.msg && first) bcData.msg = { key: tplKey(first), params: defaultParams(first), itemId: '', image: 'project', imageUrl: '', telugu: false, when: 'now', startAt: '', name: '' };
    } catch (err) { bcData.templates = []; bcData.tplError = err.message; }
  }
  const currentTpl = () => (bcData.templates || []).find((t) => tplKey(t) === bcData.msg?.key) || null;
  const projectOf = (id) => (state.catalogAll || []).find((x) => x._id === id) || null;
  function previewValues(t, m, sample) {
    const it = projectOf(m.itemId); const biz = state.tenant.profile?.displayName || state.tenant.businessName;
    return t.vars.map((k) => {
      const p = m.params[k] || {};
      const v = p.src === 'name' ? (sample?.name || 'there') : p.src === 'business' ? biz : p.src === 'project' ? (it?.name || '[project]') : p.src === 'price' ? (it?.price || '[price]')
        : p.src === 'column' ? `[${p.arg || 'column'}]` : p.src === 'text' ? (p.arg || '[text]') : '';
      return { key: k, text: v };
    });
  }
  function drawMsg() {
    const el = $('#bc-msg'); if (!el) return;
    if (bcData.templates === null) { el.innerHTML = '<div class="skeleton" style="height:120px"></div>'; return; }
    if (bcData.tplError) { el.innerHTML = `<div class="banner red">${icon('alert')}<div>${esc(bcData.tplError)}</div></div>`; hydrateIcons(el); return; }
    if (!bcData.templates.length) { el.innerHTML = `<div class="banner amber">${icon('info')}<div>No approved templates yet. Create one in WhatsApp Manager → Message templates; it shows here once Meta approves it.</div></div>`; hydrateIcons(el); return; }
    const m = bcData.msg; const t = currentTpl();
    const cols = bc?.summary?.columns || [];
    const items = (state.catalogAll || []).filter((x) => x.active);
    const hasTe = t && bcData.templates.some((x) => x.name === t.name && x.language === 'te' && t.language !== 'te');
    const sample = [...(bc?.sel || [])].map((p) => bc.contacts?.find((x) => x.phone === p)).find(Boolean);
    const preview = t ? t.body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (x, k) => previewValues(t, m, sample).find((v) => v.key === k)?.text ?? x) : '';
    el.innerHTML = `
      <label class="field" style="margin:0"><span>Template (approved by Meta)</span><select class="input" id="bc-tpl">${bcData.templates.map((x) => `<option value="${esc(tplKey(x))}" ${tplKey(x) === m.key ? 'selected' : ''} ${x.unsupported ? 'disabled' : ''}>${esc(x.name)} · ${esc(x.language)} · ${esc(String(x.category || '').toLowerCase())}${x.unsupported ? ` — has ${esc(x.unsupported)}` : ''}</option>`).join('')}</select></label>
      <label class="field" style="margin:0"><span>Project / product this message is about</span><select class="input" id="bc-item"><option value="">None — replies start the normal flow</option>${items.map((x) => `<option value="${esc(x._id)}" ${x._id === m.itemId ? 'selected' : ''}>${esc(x.name)}${x.price ? ` · ${esc(x.price)}` : ''}</option>`).join('')}</select>
        <span class="hint">With a project, a reply ("Hi", "Price?", a voice note) gets its photo and goes straight to booking the site visit.</span></label>
      ${t?.header?.format === 'IMAGE' ? `<div class="stack" style="gap:6px"><strong class="small">Photo at the top</strong><div class="row wrap" style="gap:12px">
        <label class="row" style="gap:6px"><input type="radio" name="bc-img" value="project" ${m.image === 'project' ? 'checked' : ''} />The project's photo</label>
        <label class="row" style="gap:6px"><input type="radio" name="bc-img" value="url" ${m.image === 'url' ? 'checked' : ''} />A photo link</label>
        ${m.image === 'url' ? `<input class="input grow" id="bc-img-url" placeholder="https://…jpg" value="${esc(m.imageUrl)}" />` : ''}</div></div>` : ''}
      ${t?.vars.length ? `<div class="stack" style="gap:6px"><strong class="small">Fill the blanks</strong>${t.vars.map((k) => { const p = m.params[k] || {}; return `<div class="row wrap" style="gap:8px;align-items:center">
        <code style="min-width:54px">{{${esc(k)}}}</code>
        <select class="input" data-src="${esc(k)}" style="width:auto">${Object.entries(SRC_LABELS).map(([v, l]) => `<option value="${v}" ${p.src === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${p.src === 'column' ? (cols.length ? `<select class="input" data-arg="${esc(k)}" style="width:auto"><option value="">Choose a column</option>${cols.map((c2) => `<option ${c2 === p.arg ? 'selected' : ''}>${esc(c2)}</option>`).join('')}</select>` : '<span class="hint">Import a CSV first — its columns show here.</span>') : ''}
        ${p.src === 'text' ? `<input class="input grow" data-arg="${esc(k)}" maxlength="200" placeholder="Text for everyone" value="${esc(p.arg || '')}" />` : ''}</div>`; }).join('')}</div>` : ''}
      ${t ? `<div class="stack" style="gap:4px"><strong class="small">Preview${sample ? ` (for ${esc(sample.name || '+' + sample.phone)})` : ''}</strong><div class="wa-bubble" style="background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:10px 12px;white-space:pre-wrap">${wa(preview)}</div>
        ${t.buttons?.length ? `<div class="row wrap" style="gap:6px">${t.buttons.map((b) => `<span class="pill plain">${esc(b.text)}</span>`).join('')}</div>` : ''}</div>` : ''}
      ${hasTe ? `<label class="row" style="gap:6px"><input type="checkbox" id="bc-te" ${m.telugu ? 'checked' : ''} />Telugu customers get the Telugu version of this template</label>` : ''}
      <div class="row wrap" style="gap:12px;align-items:center"><strong class="small">Start</strong>
        <label class="row" style="gap:6px"><input type="radio" name="bc-when" value="now" ${m.when !== 'later' ? 'checked' : ''} />Now</label>
        <label class="row" style="gap:6px"><input type="radio" name="bc-when" value="later" ${m.when === 'later' ? 'checked' : ''} />Later</label>
        ${m.when === 'later' ? `<input class="input" type="datetime-local" id="bc-start" value="${esc(m.startAt)}" style="width:auto" />` : ''}</div>
      <label class="field" style="margin:0"><span>Campaign name <span class="muted">(optional)</span></span><input class="input" id="bc-name" maxlength="80" placeholder="e.g. Skyline weekend offer" value="${esc(m.name)}" /></label>`;
    hydrateIcons(el);
  }
  function wireMsg() {
    const el = $('#bc-msg'); if (!el || el.dataset.wired) return; el.dataset.wired = '1';
    const redraw = () => { drawMsg(); drawSendSummary(); };
    el.addEventListener('change', (e) => {
      const m = bcData.msg; const x = e.target; if (!m) return;
      if (x.id === 'bc-tpl') { m.key = x.value; const t = currentTpl(); if (t) m.params = defaultParams(t); m.telugu = false; return redraw(); }
      if (x.id === 'bc-item') { m.itemId = x.value; return redraw(); }
      if (x.name === 'bc-img') { m.image = x.value; return redraw(); }
      if (x.name === 'bc-when') { m.when = x.value; return redraw(); }
      if (x.id === 'bc-te') { m.telugu = x.checked; return; }
      if (x.dataset.src) { m.params[x.dataset.src] = { src: x.value, arg: '' }; return redraw(); }
      if (x.dataset.arg && x.tagName === 'SELECT') { m.params[x.dataset.arg].arg = x.value; return redraw(); }
    });
    el.addEventListener('input', (e) => {
      const m = bcData.msg; const x = e.target; if (!m) return;
      if (x.dataset.arg) m.params[x.dataset.arg].arg = x.value;
      if (x.id === 'bc-img-url') m.imageUrl = x.value.trim();
      if (x.id === 'bc-start') m.startAt = x.value;
      if (x.id === 'bc-name') m.name = x.value;
    });
    el.addEventListener('focusout', (e) => { if (e.target.dataset?.arg && e.target.tagName === 'INPUT') { drawMsg(); } });
  }
  /** The campaign settings for the server, or { error } with what to fix. */
  function campaignSpec() {
    const m = bcData.msg; const t = currentTpl();
    if (!m || !t) return { error: 'Choose a template.' };
    for (const k of t.vars) {
      const p = m.params[k];
      if (!p?.src) return { error: `Choose what goes into {{${k}}}.` };
      if ((p.src === 'column' || p.src === 'text') && !String(p.arg || '').trim()) return { error: `{{${k}}}: ${p.src === 'column' ? 'choose the CSV column' : 'type the text'}.` };
      if (['project', 'price'].includes(p.src) && !m.itemId) return { error: `{{${k}}} uses the project: choose the project.` };
    }
    let headerImage;
    if (t.header?.format === 'IMAGE') {
      if (m.image === 'url') { if (!/^https:\/\/\S{8,}$/.test(m.imageUrl)) return { error: 'Paste a photo link starting with https://' }; headerImage = m.imageUrl; }
      else { if (!projectOf(m.itemId)?.imageUrl) return { error: 'This template shows a photo: choose a project that has one (or paste a photo link).' }; headerImage = 'project'; }
    }
    let startAt;
    if (m.when === 'later') { const d = new Date(m.startAt); if (!m.startAt || Number.isNaN(d.getTime())) return { error: 'Choose the start date and time.' }; startAt = d.toISOString(); }
    return { templateName: t.name, templateLang: t.language, params: t.vars.map((k) => ({ key: k, src: m.params[k].src, arg: m.params[k].arg || '' })),
      itemId: m.itemId || null, headerImage, telugu: !!m.telugu, startAt, name: m.name.trim() };
  }
  /** "1,000 people · about ₹860 · about 4 days at 250 a day" under the Send button. */
  function drawSendSummary() {
    const el = $('#bc-summary'); if (!el) return;
    const n = bc?.sel?.size || 0; const L = bcData.limit; const t = currentTpl();
    if (!n || !L) { el.innerHTML = ''; return; }
    const each = String(t?.category || 'MARKETING').toUpperCase() === 'MARKETING' ? L.costMarketing : L.costUtility;
    const days = L.unlimited ? 1 : (n <= L.room ? 1 : (L.room > 0 ? 1 : 0) + Math.ceil((n - L.room) / Math.max(L.limit, 1)));
    el.innerHTML = `<div class="banner ${days > 1 ? 'amber' : 'green'}">${icon(days > 1 ? 'calendar' : 'check')}<div><strong>${n.toLocaleString('en-IN')} people · about ${inr(n * each)}</strong>${t ? ` (${inr(each)} each, ${esc(String(t.category || '').toLowerCase())})` : ''}<br>
      ${days > 1 ? `Daily limit ${L.limit.toLocaleString('en-IN')}: <strong>${Math.min(n, L.room).toLocaleString('en-IN')} today</strong>, the rest continue by themselves — about <strong>${days} days</strong>. Keep enough money in Meta for about ${inr(Math.min(n, L.limit) * each)} a day.` : 'All of them today.'}
      ${L.open ? '' : ` Sending starts at ${hourLabel(L.startHour)} (outside sending hours now).`}</div></div>`;
    hydrateIcons(el);
  }

  // Campaign list: live counts, pause / resume / cancel, who got what.
  const CAMP_STATUS = { sending: ['Sending', 'd-DELIVERED'], waiting_limit: ['Daily limit reached — continues by itself', 'd-QUEUED'], waiting_hours: ['Waiting for sending hours', 'd-QUEUED'],
    scheduled: ['Scheduled', 'd-QUEUED'], paused: ['Paused', 'd-FAILED'], done: ['Finished', 'd-READ'], cancelled: ['Cancelled', 'plain'] };
  function campaignHtml(c) {
    const s = c.stats; const [label, cls] = CAMP_STATUS[c.status] || [c.status, 'plain'];
    const fails = s.failed + s.invalid + s.capped;
    const finished = s.accepted + fails + s.skipped + s.cancelled;
    const pct = s.total ? Math.round((finished / s.total) * 100) : 0;
    const L = bcData.limit;
    const when = c.status === 'scheduled' ? ` · ${esc(atLabel(c.startAt))}` : c.status === 'waiting_limit' && L?.freesAt ? ` · next from ${esc(atLabel(L.freesAt))}` : c.status === 'waiting_hours' && L?.nextOpenAt ? ` · ${esc(atLabel(L.nextOpenAt))}` : '';
    const live = ['sending', 'waiting_limit', 'waiting_hours', 'scheduled'].includes(c.status);
    return `<div class="stack" style="gap:8px;padding:12px;border:1px solid var(--border);border-radius:12px" data-camp="${esc(c._id)}">
      <div class="row wrap" style="gap:8px"><strong class="grow">${esc(c.name)}</strong><span class="pill ${cls}">${esc(label)}${when}</span></div>
      <div class="hint">${esc(c.templateName)} · ${esc(c.templateLang)}${c.itemId && projectOf(c.itemId) ? ` · ${esc(projectOf(c.itemId).name)}` : ''} · started ${esc(relTime(c.createdAt))}</div>
      ${c.status === 'paused' && c.pausedReason ? `<div class="banner ${c.pausedReason === 'user' ? 'amber' : 'red'}">${icon('alert')}<div>${esc(bcData.reasons[c.pausedReason] || c.pausedReason)}</div></div>` : ''}
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="stat-chips">${[['Sent', s.accepted], ['Delivered', s.delivered + s.read], ['Read', s.read], ['Replied', s.replied], ['Visits booked', s.booked], ['Waiting', s.waiting], ['Failed', fails], ['Skipped', s.skipped]]
        .filter(([k, v]) => v || ['Sent', 'Waiting'].includes(k)).map(([k, v]) => `<div class="stat-chip"><b>${(v || 0).toLocaleString('en-IN')}</b><span>${k}</span></div>`).join('')}</div>
      <div class="row wrap" style="gap:8px"><span class="muted small">${s.total.toLocaleString('en-IN')} people · cost so far about ${inr(c.costSoFar)}</span><span class="spacer"></span>
        <button class="btn sm" data-cpeople="${esc(c._id)}">${icon('users', 'sm')}People</button>
        ${live ? `<button class="btn sm" data-cact="pause" data-cid="${esc(c._id)}">Pause</button>` : ''}
        ${c.status === 'paused' ? `<button class="btn sm primary" data-cact="resume" data-cid="${esc(c._id)}">Resume</button>` : ''}
        ${live || c.status === 'paused' ? `<button class="btn sm ghost" data-cact="cancel" data-cid="${esc(c._id)}">Cancel</button>` : ''}</div></div>`;
  }
  function drawCampaigns() {
    const el = $('#bc-campaigns'); if (!el) return;
    el.innerHTML = bcData.campaigns.length ? bcData.campaigns.map(campaignHtml).join('')
      : `<div class="empty" style="padding:20px 8px"><span class="section-icon indigo">${icon('megaphone', 'lg')}</span><h3>No campaigns yet</h3><p>Your broadcasts show here with live delivered, read and replied counts.</p></div>`;
    hydrateIcons(el);
  }
  async function loadCampaigns() {
    if (!$('#bc-campaigns')) return;
    try {
      const res = await api('GET', `/campaigns/${state.tenantId}`);
      bcData.campaigns = res.data; bcData.limit = res.limit; bcData.reasons = res.reasons || {};
      drawCampaigns();
      if (!$('#bc-limit-form') || !document.activeElement?.closest?.('#bc-limit')) drawLimit();
      drawSendSummary();
    } catch (err) { const el = $('#bc-campaigns'); if (el) el.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
  }
  function wireCampaigns() {
    const el = $('#bc-campaigns'); if (!el) return;
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cpeople) return showCampaignPeople(bcData.campaigns.find((c) => c._id === b.dataset.cpeople));
      if (!b.dataset.cact) return;
      if (b.dataset.cact === 'cancel' && !confirm('Cancel this campaign? People who have not got it yet will not get it.')) return;
      b.disabled = true;
      try { await api('POST', `/campaigns/${state.tenantId}/${b.dataset.cid}/${b.dataset.cact}`); await loadCampaigns(); }
      catch (err) { toast('Could not update', err.message, { kind: 'error' }); b.disabled = false; }
    });
    clearInterval(bcTimer);
    bcTimer = setInterval(() => {
      if (!['broadcast', 'pricing'].includes(state.route.page) || !$('#bc-campaigns')) { clearInterval(bcTimer); return; }
      if (document.visibilityState === 'visible') loadCampaigns();
    }, 15000);
  }
  const RECIPIENT_STATUS = { waiting: ['Waiting', 'd-QUEUED'], sent: ['Sent', 'd-DELIVERED'], delivered: ['Delivered', 'd-DELIVERED'], read: ['Read', 'd-READ'], failed: ['Failed', 'd-FAILED'],
    capped: ['Held by WhatsApp', 'd-FAILED'], invalid: ['Not on WhatsApp', 'd-FAILED'], skipped: ['Skipped', 'plain'], cancelled: ['Cancelled', 'plain'] };
  function showCampaignPeople(c) {
    if (!c) return;
    let filter = '';
    modal(`<div class="card-head"><span class="section-icon">${icon('users')}</span><div><h2>${esc(c.name)}</h2><p>${c.stats.total.toLocaleString('en-IN')} people</p></div></div>
      <div class="card-body stack"><div class="filters" id="cp-f">${[['', 'All'], ['waiting', 'Waiting'], ['read', 'Read'], ['replied', 'Replied'], ['delivered', 'Delivered'], ['sent', 'Sent'], ['failed', 'Failed'], ['invalid', 'Not on WhatsApp'], ['capped', 'Held'], ['skipped', 'Skipped']]
        .map(([k, l]) => `<button type="button" class="filter ${k === '' ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      <div id="cp-list" style="max-height:55vh;overflow:auto"><div class="skeleton" style="height:120px"></div></div></div>
      <div class="modal-foot"><button class="btn" data-close>Close</button></div>`, { wide: true, onMount: (root) => {
      const load = async () => {
        const list = $('#cp-list', root);
        try {
          const { data } = await api('GET', `/campaigns/${state.tenantId}/${c._id}/recipients${filter ? `?status=${filter}` : ''}`);
          list.innerHTML = data.length ? `<table class="table"><thead><tr><th>Contact</th><th>Status</th><th>When</th></tr></thead><tbody>${data.map((r) => {
            const [l, k] = RECIPIENT_STATUS[r.status] || [r.status, 'plain'];
            return `<tr><td><strong>${esc(r.name || '—')}</strong><div class="hint">+${esc(r.phone)}</div></td><td><span class="pill ${k}" ${r.error ? `title="${esc(r.error)}"` : ''}>${esc(l)}</span>${r.repliedAt ? ' <span class="pill d-READ">Replied</span>' : ''}${r.error && r.status !== 'read' ? `<div class="hint">${esc(r.error)}</div>` : ''}</td>
              <td class="small">${r.sentAt ? esc(atLabel(r.sentAt)) : r.nextAt ? `after ${esc(atLabel(r.nextAt))}` : '—'}</td></tr>`;
          }).join('')}</tbody></table>${data.length >= 100 ? '<p class="hint">Showing the first 100.</p>' : ''}` : '<p class="hint" style="padding:12px">Nobody here.</p>';
        } catch (err) { list.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
      };
      $('#cp-f', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-f]'); if (!b) return;
        filter = b.dataset.f; $$('#cp-f .filter', root).forEach((x) => x.classList.toggle('active', x === b)); load();
      });
      load();
    } });
  }
  let bc = null;

  // ============================================================
  // Bulk broadcast & pricing: what WhatsApp costs (from Meta), top-up link, daily limit, live campaigns
  // ============================================================
  let spendData = null;
  const money = (n, cur) => { try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || 'INR', maximumFractionDigits: 2 }).format(n || 0); } catch { return `${cur || '₹'} ${(n || 0).toFixed(2)}`; } };
  function renderPricing() {
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Bulk broadcast & pricing</h1><p>What WhatsApp messages cost this business, where to top up, your daily sending limit and live campaigns.</p></div>
        <span class="spacer"></span><button class="btn" id="sp-refresh">${icon('refresh')}Refresh</button><a class="btn primary" href="#/broadcast">${icon('megaphone')}New bulk broadcast</a></div>
      <div id="sp-banners"></div>
      <div class="kpis" id="sp-kpis">${'<div class="card kpi"><div class="skeleton" style="height:64px"></div></div>'.repeat(4)}</div>
      <div class="overview-grid">
        <div class="stack">
          <div class="card"><div class="card-head"><span class="section-icon blue">${icon('activity')}</span><div><h2>Spending, last 30 days</h2><p>From Meta's pricing report (Meta's figures can be a few hours behind)</p></div></div><div class="card-body" id="sp-chart"><div class="skeleton" style="height:140px"></div></div></div>
          <div class="card"><div class="card-head"><span class="section-icon indigo">${icon('template')}</span><div><h2>This month by message type</h2><p>Marketing and utility are paid; service replies (customer wrote first) are free</p></div></div><div class="card-body" id="sp-cats"></div></div>
          <div class="card"><div class="card-head"><span class="section-icon">${icon('phone')}</span><div><h2>This month by phone number</h2><p>Every WhatsApp number on this business's account</p></div></div><div class="card-body" id="sp-phones"></div></div>
          <div class="card"><div class="card-head"><span class="section-icon blue">${icon('megaphone')}</span><div><h2>Campaigns</h2><p>Live: sent, delivered, read, replied and visits booked</p></div><span class="spacer"></span><button class="btn sm" id="q-refresh">${icon('refresh', 'sm')}Refresh</button></div><div class="card-body stack" id="bc-campaigns"><div class="skeleton" style="height:120px"></div></div></div>
        </div>
        <div class="stack">
          <div class="card"><div class="card-head"><span class="section-icon amber">${icon('wallet')}</span><div><h2>Balance & top up</h2><p>Money for WhatsApp messages is paid to Meta</p></div></div><div class="card-body stack" id="sp-pay"><div class="skeleton" style="height:120px"></div></div></div>
          <div class="card"><div class="card-head"><span class="section-icon amber">${icon('activity')}</span><div><h2>Daily sending limit</h2><p>People you can message first in 24 hours. Big lists continue by themselves the next day.</p></div></div>
            <div class="card-body stack" id="bc-limit"><div class="skeleton" style="height:90px"></div></div></div>
        </div>
      </div></div>`;
    $('#sp-refresh').addEventListener('click', () => { spendData = null; loadSpending(true); loadCampaigns(); });
    $('#q-refresh').addEventListener('click', loadCampaigns);
    wireCampaigns();
    if (spendData && spendData.tenantId === state.tenantId) drawSpending(); else loadSpending();
    loadCampaigns();
  }
  async function loadSpending(force) {
    const tid = state.tenantId;
    const btn = $('#sp-refresh'); if (force && btn) { btn.disabled = true; }
    try {
      const { data } = await api('GET', `/spending/${tid}`);
      spendData = { ...data, tenantId: tid };
      if (state.route.page === 'pricing' && state.tenantId === tid) drawSpending();
    } catch (err) {
      const el = $('#sp-banners'); if (el) { el.innerHTML = `<div class="banner red">${icon('alert')}<div>${esc(err.message)}</div></div>`; hydrateIcons(el); }
    } finally { if (btn) btn.disabled = false; }
  }
  function drawSpending() {
    const d = spendData; if (!d || !$('#sp-kpis')) return;
    const cur = d.currency || 'INR'; const est = d.estimate || {};
    // banners
    const bn = [];
    if (est.paymentProblem) bn.push(`<div class="banner red">${icon('alert')}<div><strong>Meta refused messages because of a payment problem.</strong> Campaigns are paused. Add funds or fix the card in Meta Billing, then tap Resume on the campaign. <a href="${esc(d.billingUrl)}" target="_blank" rel="noopener">Open Meta Billing →</a></div></div>`);
    if (d.demo) bn.push(`<div class="banner blue">${icon('info')}<div>This is the test copy: the numbers below are <strong>samples</strong>. The live app shows your real Meta figures.</div></div>`);
    if (d.error) bn.push(`<div class="banner amber">${icon('alert')}<div><strong>Meta's pricing report is not available right now:</strong> ${esc(d.error)} The estimate from your campaigns is still shown.</div></div>`);
    $('#sp-banners').innerHTML = bn.length ? `<div class="stack" style="gap:10px;margin-bottom:16px">${bn.join('')}</div>` : '';
    // KPIs
    const T = d.totals || {}; const V = d.volume || {};
    const kpi = (label, key, sub) => `<div class="card kpi"><div class="row"><span class="label">${label}</span><span class="section-icon amber">${icon('wallet', 'sm')}</span></div><div class="value">${d.available ? money(T[key], cur) : '—'}</div><div class="sub">${d.available ? `${(V[key] || 0).toLocaleString('en-IN')} messages${sub ? ` · ${sub}` : ''}` : 'waiting for Meta'}</div></div>`;
    $('#sp-kpis').innerHTML = [kpi('Today', 'today'), kpi('Last 7 days', 'week'), kpi('This month', 'month', d.freeMonth ? `${d.freeMonth.toLocaleString('en-IN')} free` : ''), kpi('Last 30 days', 'last30')].join('');
    // chart
    const days = d.days || []; const top = Math.max(...days.map((x) => x.cost), 0.01);
    $('#sp-chart').innerHTML = d.available && days.some((x) => x.cost || x.volume) ? `
      <div style="display:flex;align-items:flex-end;gap:3px;height:140px">${days.map((x) => `<div title="${esc(new Date(x.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}: ${esc(money(x.cost, cur))} · ${x.volume} messages" style="flex:1;min-width:4px;height:${Math.max(x.cost ? 3 : 1, (x.cost / top) * 100)}%;background:${x.cost ? 'var(--accent, #6366f1)' : 'var(--line, #e5e7eb)'};border-radius:3px 3px 0 0"></div>`).join('')}</div>
      <div class="row small muted" style="justify-content:space-between;margin-top:6px"><span>${esc(new Date(days[0].date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</span><span>Highest day ${esc(money(top, cur))}</span><span>Today</span></div>`
      : '<div class="empty" style="padding:16px"><p>No paid messages in the last 30 days.</p></div>';
    // categories
    const cats = d.byCategory || [];
    $('#sp-cats').innerHTML = cats.length ? `<table class="table"><thead><tr><th>Type</th><th>Messages</th><th>Cost</th><th>Per message</th></tr></thead><tbody>${cats.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.volume.toLocaleString('en-IN')}</td><td><strong>${esc(money(x.cost, cur))}</strong></td><td>${x.volume && x.cost ? esc(money(x.cost / x.volume, cur)) : 'free'}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted">${d.available ? 'No messages this month yet.' : 'Shown once Meta\'s report is available.'}</p>`;
    // phones
    const ph = d.byPhone || []; const Q = { GREEN: ['High', 'd-READ'], YELLOW: ['Medium', 'd-QUEUED'], RED: ['Low', 'd-FAILED'] };
    $('#sp-phones').innerHTML = ph.length ? `<table class="table"><thead><tr><th>Number</th><th>Name</th><th>Quality</th><th>Messages</th><th>Cost</th></tr></thead><tbody>${ph.map((x) => {
      const q = Q[String(x.quality || '').toUpperCase()];
      return `<tr><td>${esc(x.display || fmtPhone(x.phone))}</td><td>${esc(x.name || '—')}</td><td>${q ? `<span class="pill ${q[1]}">${q[0]}</span>` : '—'}</td><td>${x.volume.toLocaleString('en-IN')}</td><td><strong>${esc(money(x.cost, cur))}</strong></td></tr>`;
    }).join('')}</tbody></table>` : '<p class="muted">No numbers found on this account.</p>';
    // balance & top up
    const L = d.limit || {};
    $('#sp-pay').innerHTML = `
      <dl class="kv"><dt>Meta account</dt><dd>${esc(d.accountName || '—')}</dd>
        <dt>Currency</dt><dd>${esc(cur)}</dd>
        <dt>Payment method</dt><dd>${d.fundingLinked === true ? '<span class="pill d-READ">Linked</span>' : d.fundingLinked === false ? '<span class="pill d-FAILED">Not added</span>' : '<span class="muted">See Meta Billing</span>'}</dd>
        <dt>Payment status</dt><dd>${est.paymentProblem ? '<span class="pill d-FAILED">Problem — top up</span>' : '<span class="pill d-READ">OK</span>'}</dd>
        <dt>Daily limit</dt><dd>${L.unlimited ? 'Unlimited' : (L.limit ?? '—').toLocaleString?.('en-IN') ?? '—'} people${L.quality ? ` · quality ${esc(({ GREEN: 'High', YELLOW: 'Medium', RED: 'Low' })[String(L.quality).toUpperCase()] || L.quality)}` : ''}</dd></dl>
      <div class="stat-chips"><div class="stat-chip"><b>${esc(money(est.waitingCost, cur))}</b><span>Still to send · ${(est.waitingPeople || 0).toLocaleString('en-IN')} people waiting</span></div>
        <div class="stat-chip"><b>${esc(money(est.sentCostThisMonth, cur))}</b><span>Campaigns this month · ${(est.sentThisMonth || 0).toLocaleString('en-IN')} sent (our estimate)</span></div></div>
      ${est.waitingCost ? `<p class="hint">Keep at least <strong>${esc(money(est.waitingCost, cur))}</strong> in Meta so the waiting campaign messages can go.</p>` : ''}
      <a class="btn primary" href="${esc(d.billingUrl)}" target="_blank" rel="noopener" style="justify-content:center">${icon('wallet')}Top up in Meta Billing</a>
      <p class="hint">Meta does not let other apps read your balance or add money. The button opens this account's Meta Billing page, where the owner adds funds or a card. ${d.checkedAt ? `Checked ${esc(relTime(d.checkedAt))}.` : ''}</p>`;
    hydrateIcons($('#page'));
  }

  function renderBroadcast() {
    const t = state.tenant; const tp = t.templates || {};
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Broadcast</h1><p>Add numbers by hand or upload a contact list, then send your approved WhatsApp template. Replies flow straight into your flow, the AI and your inbox.</p></div></div>
      <div class="overview-grid bc-grid">
        <div class="stack">
          <div class="card"><div class="card-head"><span class="section-icon">${icon('plus')}</span><div><h2>Add contacts</h2><p>Type numbers in directly, or import a CSV with a <code>phone</code> column (and optionally <code>name</code>)</p></div></div>
            <div class="card-body stack">
              <form class="stack" id="bc-manual-form" autocomplete="off" style="gap:8px"><strong>Add a number</strong>
                <div class="row wrap" style="gap:8px;align-items:flex-end">
                  <label class="field grow" style="min-width:140px;margin:0"><span>Name</span><input class="input" id="bc-m-name" maxlength="80" placeholder="Ravi Kumar" /></label>
                  <label class="field grow" style="min-width:160px;margin:0"><span>WhatsApp number</span><textarea class="input" id="bc-m-phone" rows="1" inputmode="tel" placeholder="98765 43210" style="resize:vertical;min-height:42px;padding-top:10px"></textarea></label>
                  <button class="btn primary" type="submit" style="height:42px">${icon('plus')}Add</button></div>
                <span class="hint">Press Enter to add. 10-digit numbers get +91. To add many at once, paste lines like <code>Ravi, 9876543210</code> into the number box.</span>
                <div id="bc-m-error"></div></form>
              <div class="row" style="gap:10px;color:var(--text-3)"><span style="flex:1;height:1px;background:var(--border)"></span><span class="small">or import a CSV</span><span style="flex:1;height:1px;background:var(--border)"></span></div>
              <label class="dropzone" id="csv-drop"><input type="file" id="csv-file" accept=".csv,text/csv" />
                <span class="section-icon">${icon('upload', 'lg')}</span><strong>Drop your CSV here or click to choose</strong><span class="hint">10-digit Indian numbers get +91 automatically · you choose who gets it before sending</span></label>
              <div id="csv-picked"></div></div></div>
          <div class="card"><div class="card-head"><span class="section-icon indigo">${icon('template')}</span><div><h2>Message</h2><p>Your approved WhatsApp template, what fills its blanks, and the project it is about</p></div></div>
            <div class="card-body stack" id="bc-msg"><div class="skeleton" style="height:120px"></div></div></div>
          <div class="card"><div class="card-head"><span class="section-icon amber">${icon('activity')}</span><div><h2>Daily sending limit</h2><p>People you can message first in 24 hours. Big lists continue by themselves the next day.</p></div></div>
            <div class="card-body stack" id="bc-limit"><div class="skeleton" style="height:90px"></div></div></div>
        </div>
        <div class="stack bc-side">
          <div class="card"><div class="card-head"><span class="section-icon">${icon('users')}</span><div><h2>Send list</h2><p>Everyone you added. Untick anyone you don't want to send to.</p></div></div>
            <div class="card-body stack">
              <div id="bc-m-list" class="row wrap" style="gap:6px"></div>
              <div id="bc-empty" class="empty" style="padding:20px 8px"><span class="section-icon indigo">${icon('users', 'lg')}</span><h3>No contacts yet</h3><p>Add a number or import a CSV on the left. They'll show up here.</p></div>
              <div id="csv-contacts"></div>
              <div id="bc-summary"></div>
              <button class="btn primary" id="send-broadcast" disabled style="height:42px">${icon('send')}Send broadcast</button>
              <div id="broadcast-result"></div></div></div>
          <div class="card"><div class="card-head"><span class="section-icon blue">${icon('megaphone')}</span><div><h2>Campaigns</h2><p>Live: sent, delivered, read, replied and visits booked</p></div><span class="spacer"></span><button class="btn sm" id="q-refresh">${icon('refresh', 'sm')}Refresh</button></div><div class="card-body stack" id="bc-campaigns"><div class="skeleton" style="height:120px"></div></div></div>
        </div></div></div>`;
    let file = null;
    const blocked = (x) => x.state === 'optedOut' || x.state === 'invalid';
    const manual = []; // [{ name, phone }] typed in by hand
    let previewSeq = 0;
    bc = { contacts: null, sel: new Set(), filter: 'all', search: '', summary: null };
    const hasInput = () => !!file || manual.length > 0;
    const manualField = () => (manual.length ? { manual: JSON.stringify(manual) } : {});
    const toDigits = (p) => { let d = String(p).replace(/\D/g, ''); if (d.length === 10) d = '91' + d; else if (d.length === 11 && d[0] === '0') d = '91' + d.slice(1); return d.length >= 11 && d.length <= 15 ? d : null; };
    const drawManual = () => {
      const el = $('#bc-m-list'); if (!el) return;
      el.innerHTML = manual.map((m, i) => `<span class="pill d-READ" style="gap:4px;padding-right:4px">${esc(m.name || 'No name')} · ${esc(m.phone)}<button type="button" class="btn icon sm ghost" data-mrm="${i}" aria-label="Remove ${esc(m.name || m.phone)}" style="height:20px;width:20px;min-width:20px">${icon('x', 'sm')}</button></span>`).join('')
        + (manual.length > 1 ? '<button type="button" class="btn sm ghost" data-mrm="all">Remove all</button>' : '');
      hydrateIcons(el);
    };
    const addManual = () => {
      const nameIn = $('#bc-m-name'); const phoneIn = $('#bc-m-phone'); const errEl = $('#bc-m-error');
      const raw = phoneIn.value.trim(); errEl.innerHTML = '';
      if (!raw) { phoneIn.focus(); return; }
      // One number, or many pasted lines like "Name, number" / "number, Name" / "number"
      const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const parsed = lines.length === 1 && !/[a-z]/i.test(raw)
        ? [{ name: nameIn.value.trim(), phone: raw }]
        : lines.map((l) => {
          const parts = l.split(/[,;\t]/).map((x) => x.trim()).filter(Boolean);
          const ph = parts.find((x) => toDigits(x)) || parts.find((x) => /\d{6,}/.test(x)) || l;
          return { name: parts.filter((x) => x !== ph).join(' ').trim() || (lines.length === 1 ? nameIn.value.trim() : ''), phone: ph };
        });
      const bad = []; let added = 0;
      for (const m of parsed) {
        const d = toDigits(m.phone);
        if (!d) { bad.push(m.phone); continue; }
        const existing = manual.find((x) => toDigits(x.phone) === d);
        if (existing) { if (m.name) existing.name = m.name.slice(0, 80); added++; continue; }
        if (manual.length >= 500) { bad.push(`${m.phone} (500 max, use a CSV)`); continue; }
        manual.push({ name: m.name.slice(0, 80), phone: '+' + d }); added++;
      }
      if (bad.length) errEl.innerHTML = `<div class="banner red">${icon('alert')}<div>Not a valid number: ${bad.slice(0, 5).map(esc).join(', ')}${bad.length > 5 ? ` and ${bad.length - 5} more` : ''}</div></div>`;
      if (added) { nameIn.value = ''; phoneIn.value = ''; }
      (bad.length && !added ? phoneIn : nameIn).focus();
      if (added) { drawManual(); refreshPreview(); }
    };
    $('#bc-manual-form').addEventListener('submit', (e) => { e.preventDefault(); addManual(); });
    $('#bc-m-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if ($('#bc-m-phone').value.trim()) addManual(); else $('#bc-m-phone').focus(); } });
    $('#bc-m-phone').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addManual(); } });
    $('#bc-m-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mrm]'); if (!b) return;
      if (b.dataset.mrm === 'all') { manual.length = 0; } else { const [m] = manual.splice(Number(b.dataset.mrm), 1); if (m) bc.sel.delete(toDigits(m.phone)); }
      drawManual(); refreshPreview();
    });
    // Re-reads who is in the list (typed + CSV), keeping the ticks the user already made.
    const refreshPreview = async () => {
      const seq = ++previewSeq; const prevSel = bc.sel; const prevKnown = new Set((bc.contacts || []).map((x) => x.phone));
      $('#broadcast-result').innerHTML = '';
      if (!hasInput()) { bc.contacts = null; bc.sel = new Set(); $('#csv-contacts').innerHTML = ''; updateSendButton(); return; }
      if (!bc.contacts) $('#csv-contacts').innerHTML = '<div class="skeleton" style="height:160px"></div>';
      try {
        const res = await uploadFile(`/leads/${state.tenantId}/preview`, file, manualField());
        if (seq !== previewSeq) return; // a newer change is loading
        bc.contacts = res.data; bc.summary = res.summary; if (res.limit) bcData.limit = res.limit;
        // Keep earlier ticks; anyone new to the list is ticked only if they never got a broadcast.
        bc.sel = new Set(res.data.filter((x) => !blocked(x) && (prevKnown.has(x.phone) ? prevSel.has(x.phone) : x.state === 'new')).map((x) => x.phone));
        drawMsg(); drawContacts();
      } catch (err) {
        if (seq !== previewSeq) return;
        bc.contacts = null; $('#csv-contacts').innerHTML = `<div class="banner red">${icon('alert')}<div>${esc(err.message)}</div></div>`; updateSendButton();
      }
    };
    const pick = async (f) => {
      file = f || null; bc.contacts = null; bc.sel = new Set();
      $('#csv-picked').innerHTML = file ? `<div class="file-picked">${icon('file')}<div class="grow" style="min-width:0"><strong>${esc(file.name)}</strong><div class="hint">${(file.size / 1024).toFixed(1)} KB</div></div><button class="btn icon sm ghost" id="csv-clear" aria-label="Remove file">${icon('x', 'sm')}</button></div>` : '';
      $('#csv-clear')?.addEventListener('click', (e) => { e.preventDefault(); $('#csv-file').value = ''; pick(null); });
      bc.filter = 'all'; bc.search = '';
      updateSendButton();
      // Everyone new is ticked; people who already got a broadcast are not, to avoid sending twice.
      await refreshPreview();
    };
    const updateSendButton = () => {
      const btn = $('#send-broadcast'); if (!btn || btn.querySelector('.spinner')) return;
      const n = bc.sel.size;
      const empty = $('#bc-empty'); if (empty) empty.hidden = hasInput();
      btn.disabled = !hasInput() || !bc.contacts || !n;
      btn.innerHTML = `${icon('send')}${bc.contacts ? `${bcData.msg?.when === 'later' ? 'Schedule for' : 'Send to'} ${n.toLocaleString()} selected` : 'Send broadcast'}`;
      drawSendSummary();
    };
    const visibleContacts = () => {
      const q = bc.search.toLowerCase(); const qd = q.replace(/\D/g, '');
      return (bc.contacts || []).filter((x) => (bc.filter === 'all' || x.state === bc.filter) && (!q || (x.name || '').toLowerCase().includes(q) || (qd && x.phone.includes(qd))));
    };
    const sentLabel = (x) => {
      const when = relTime(x.lastBroadcastAt);
      const how = x.replied ? 'replied' : (x.broadcastStatus || 'sent').toLowerCase();
      return `<span class="pill ${how === 'failed' ? 'd-FAILED' : 'd-QUEUED'}" title="${esc(x.broadcastError || `Last broadcast ${new Date(x.lastBroadcastAt).toLocaleString()}`)}">Already sent ${esc(when)} · ${esc(how)}</span>`;
    };
    function drawContacts() {
      const el = $('#csv-contacts'); if (!el || !bc.contacts) return;
      const all = bc.contacts; const s = bc.summary || {};
      const count = (st) => all.filter((x) => x.state === st).length;
      const sentCount = count('sent'); const sentPicked = all.filter((x) => x.state === 'sent' && bc.sel.has(x.phone)).length;
      const vis = visibleContacts(); const pickable = vis.filter((x) => !blocked(x));
      const allOn = pickable.length > 0 && pickable.every((x) => bc.sel.has(x.phone));
      const shown = vis.slice(0, 300);
      el.innerHTML = `<div class="bc-picker stack">
        <div class="row wrap" style="gap:8px"><strong>${all.length.toLocaleString()} contacts</strong><span class="muted small">${[s.duplicates ? `${s.duplicates} duplicate rows merged` : '', s.invalid ? `${s.invalid} invalid numbers skipped` : ''].filter(Boolean).join(' · ')}</span></div>
        ${sentCount ? `<div class="banner amber">${icon('info')}<div><strong>${sentCount} already got a broadcast before.</strong> ${sentPicked ? `${sentPicked} of them are selected: they get it again and the bot starts over from the first question for them.` : 'They are not selected, so nobody gets it twice.'} Tick them if you want to send again — WhatsApp may block repeated marketing messages to the same person.</div></div>` : ''}
        <div class="row wrap" style="gap:8px"><div class="filters">${[['all', 'All', all.length], ['new', 'New', count('new')], ['sent', 'Already sent', sentCount], ['optedOut', 'Opted out', count('optedOut')], ['invalid', 'Not on WhatsApp', count('invalid')]].filter(([k, , n]) => k === 'all' || n).map(([k, l, n]) => `<button type="button" class="filter ${bc.filter === k ? 'active' : ''}" data-bcf="${k}">${l}<span class="n">${n}</span></button>`).join('')}</div>
          <span class="spacer"></span><div class="search" style="width:min(220px,100%)">${icon('search', 'sm')}<input class="input" id="bc-search" placeholder="Search" value="${esc(bc.search)}" /></div></div>
        <div class="bc-list"><table class="table"><thead><tr><th style="width:36px"><input type="checkbox" id="bc-all" ${allOn ? 'checked' : ''} ${pickable.length ? '' : 'disabled'} aria-label="Select all shown" /></th><th>Contact</th><th>Status</th></tr></thead><tbody>
          ${shown.map((x) => `<tr class="${blocked(x) ? 'muted-row' : ''}"><td><input type="checkbox" data-ph="${esc(x.phone)}" ${bc.sel.has(x.phone) ? 'checked' : ''} ${blocked(x) ? 'disabled' : ''} aria-label="Select ${esc(x.name || x.phone)}" /></td>
            <td><strong>${esc(x.name || '—')}</strong><div class="hint">+${esc(x.phone)}</div></td>
            <td>${x.state === 'new' ? '<span class="pill d-READ">New</span>' : x.state === 'invalid' ? '<span class="pill d-FAILED">Not on WhatsApp · skipped</span>' : blocked(x) ? '<span class="pill d-FAILED">Opted out · never sent</span>' : sentLabel(x)}</td></tr>`).join('')}
          </tbody></table>${vis.length > shown.length ? `<p class="hint" style="padding:8px 12px">Showing 300 of ${vis.length.toLocaleString()} — search to find others. The top checkbox covers all ${vis.length.toLocaleString()}.</p>` : ''}${vis.length ? '' : '<p class="hint" style="padding:12px">Nothing matches.</p>'}</div>
        <div class="row wrap" style="gap:8px"><span class="muted small"><strong>${bc.sel.size.toLocaleString()}</strong> selected</span><span class="spacer"></span>
          <button type="button" class="btn sm" data-bcq="new">Only new</button><button type="button" class="btn sm" data-bcq="all">Everyone</button><button type="button" class="btn sm" data-bcq="none">Clear</button></div>
      </div>`;
      hydrateIcons(el);
      $('#bc-search').addEventListener('input', debounce((e) => { bc.search = e.target.value.trim(); drawContacts(); const i = $('#bc-search'); i.focus(); i.setSelectionRange(99, 99); }, 200));
      updateSendButton();
    }
    $('#csv-contacts').addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'bc-all') { for (const x of visibleContacts()) if (!blocked(x)) { if (t.checked) bc.sel.add(x.phone); else bc.sel.delete(x.phone); } drawContacts(); }
      else if (t.dataset.ph) { if (t.checked) bc.sel.add(t.dataset.ph); else bc.sel.delete(t.dataset.ph); drawContacts(); }
    });
    $('#csv-contacts').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.bcf) { bc.filter = b.dataset.bcf; drawContacts(); }
      if (b.dataset.bcq) {
        const ok = (bc.contacts || []).filter((x) => !blocked(x));
        bc.sel = new Set(b.dataset.bcq === 'none' ? [] : ok.filter((x) => b.dataset.bcq === 'all' || x.state === 'new').map((x) => x.phone));
        drawContacts();
      }
    });
    wireDropzone($('#csv-drop'), $('#csv-file'), pick);
    $('#send-broadcast').addEventListener('click', async () => {
      if (!hasInput() || !bc.sel.size) return;
      const spec = campaignSpec();
      if (spec.error) { $('#broadcast-result').innerHTML = `<div class="banner red">${icon('alert')}<div>${esc(spec.error)}</div></div>`; hydrateIcons($('#broadcast-result')); $('#bc-msg')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      const btn = $('#send-broadcast');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Starting…';
      try {
        const data = await uploadFile(`/campaigns/${state.tenantId}`, file, { ...manualField(), phones: JSON.stringify([...bc.sel]), campaign: JSON.stringify(spec) });
        const s = data.summary || {};
        $('#broadcast-result').innerHTML = `<div class="banner green">${icon('check')}<div><strong>${esc(data.message)}</strong> Follow it under Campaigns.</div></div>
          <div class="stat-chips" style="margin-top:12px">
            ${[['In the campaign', s.enqueued], ['Not selected', s.notSelected], ['Duplicates', s.duplicatesSkipped], ['Invalid numbers', s.invalidSkipped], ['Opted out', s.optedOutSkipped], ['Not on WhatsApp', s.notOnWhatsappSkipped]]
              .filter(([, v]) => v).map(([k, v]) => `<div class="stat-chip"><b>${(v ?? 0).toLocaleString()}</b><span>${k}</span></div>`).join('')}</div>`;
        hydrateIcons($('#broadcast-result'));
        toast('Campaign started', data.message);
        log(`Campaign started: ${s.enqueued} people.`, 'success');
        $('#csv-file').value = ''; file = null; manual.length = 0; drawManual(); bc.contacts = null; bc.sel = new Set(); bc.summary = null; $('#csv-picked').innerHTML = ''; $('#csv-contacts').innerHTML = '';
        if (bcData.msg) { bcData.msg.name = ''; bcData.msg.when = 'now'; bcData.msg.startAt = ''; }
        drawMsg(); await loadCampaigns();
      } catch (err) {
        $('#broadcast-result').innerHTML = `<div class="banner red">${icon('alert')}<div>${esc(err.message)}</div></div>`;
        hydrateIcons($('#broadcast-result'));
        log(`Broadcast failed: ${err.message}`, 'error');
      } finally { btn.innerHTML = `${icon('send')}Send broadcast`; updateSendButton(); }
    });
    $('#q-refresh').addEventListener('click', loadCampaigns);
    wireMsg(); wireCampaigns();
    loadCampaigns();
    loadTemplates().then(() => { drawMsg(); drawSendSummary(); });
  }
  function wireDropzone(zone, input, onFile) {
    input.addEventListener('change', () => onFile(input.files[0]));
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
    zone.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) onFile(f); });
  }

  // ============================================================
  // Flow Builder
  // ============================================================
  const STEP_TYPES = {
    choice: { label: 'Buttons / list', icon: 'list', hint: 'Customer taps one option' },
    question: { label: 'Question', icon: 'question', hint: 'Customer types an answer' },
    slots: { label: 'Time slots', icon: 'calendar', hint: 'Customer picks a date & time' },
    send: { label: 'Send', icon: 'send', hint: 'PDF, location or a message' },
    finish: { label: 'Finish', icon: 'flag', hint: 'Confirm & alert your team' },
  };
  const INPUTS = [['text', 'Any text'], ['name', 'Name'], ['email', 'Email'], ['phone', 'Phone number'], ['number', 'Number'], ['date', 'Date'], ['location', 'Location — "Send location" button, area name or pincode']];
  const DAYS = [['TOMORROW', 'Tomorrow'], ['MON', 'Monday'], ['TUE', 'Tuesday'], ['WED', 'Wednesday'], ['THU', 'Thursday'], ['FRI', 'Friday'], ['SAT', 'Saturday'], ['SUN', 'Sunday']];
  const MESSAGE_LABELS = {
    completed: ['After the flow is finished', 'Reply to later messages (when the AI is off or can’t answer).'],
    nudge: ['When they type instead of tapping', 'Sent before the question is asked again (twice at most).'],
    invalidInput: ['When a typed answer is wrong', 'e.g. letters where a number is expected.'],
    handoff: ['Handing over to your team', 'Sent after the third wrong reply; the bot pauses and your team is alerted.'],
    slotPassed: ['Time slot already passed', ''],
    optOut: ['Opt-out confirmation', 'Sent when someone replies STOP or taps "Not interested".'],
    error: ['Something went wrong', ''],
  };

  function newStep(type) {
    const id = `step_${rid()}`;
    const f = `${type}_${rid().slice(0, 3)}`;
    switch (type) {
      case 'choice': return { id, type, field: f, label: 'Choice', text: 'Please choose one:', options: [{ id: `OPT_${rid().toUpperCase()}`, title: 'Option 1', label: 'Option 1', description: '' }, { id: `OPT_${rid().toUpperCase()}`, title: 'Option 2', label: 'Option 2', description: '' }], listHeader: 'Choose an option', listButton: 'View options', listSection: 'Options', setStatus: null, next: null };
      case 'question': return { id, type, field: f, label: 'Answer', text: 'Please type your answer.', input: 'text', setStatus: null, next: null };
      case 'slots': return { id, type, field: f, label: 'Booking', text: 'Pick a convenient time:', plan: [{ day: 'TOMORROW', time: '11:00' }, { day: 'SAT', time: '16:00' }], setStatus: null, next: null };
      case 'send': return { id, type, kind: 'document', text: '', next: null };
      default: return { id, type: 'finish', text: '✅ All done, {name}! Our team at {business} will be in touch.', alertTeam: true };
    }
  }
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  function setPath(obj, path, value) {
    const keys = path.split('.'); const last = keys.pop();
    const target = keys.reduce((o, k) => o[k], obj);
    target[last] = value;
  }

  function renderBuilder() {
    if (!state.builder) state.builder = { draft: clone(state.tenant.flow || { steps: [] }), dirty: false, open: new Set() };
    const b = state.builder; const d = b.draft;
    useLayout(d.template || savedLayout()); // photo pickers show the products of the layout being edited
    d.steps = d.steps || []; d.messages = d.messages || {};
    if (!b.open.size && d.steps[0]) b.open.add(d.steps[0].id);
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Flow Builder</h1><p>Design the WhatsApp conversation for ${esc(bizName())}. The AI assistant fills the gaps when customers type questions.</p></div><span class="spacer"></span>
        <label class="switch"><input type="checkbox" data-path="enabled" ${d.enabled !== false ? 'checked' : ''} /><span class="track"></span>Flow on</label></div>
      <div class="studio">
        <div class="stack" id="builder">
          <div class="card"><div class="card-head"><span class="section-icon indigo">${icon('template')}</span><div><h2>Start from a template</h2><p>Click one to open it below — nothing changes for customers until you save</p></div></div>
            <div class="card-body"><div class="templates-grid">${state.templates.map((t) => `
              <button type="button" class="tpl-card ${d.template === t.key ? 'active' : ''}" data-template="${t.key}"><span class="row">${icon(t.icon)}<strong>${esc(t.name)}</strong></span><small>${esc(t.description)}</small></button>`).join('')}</div></div></div>
          ${b.previewing ? `<div class="banner blue">${icon('info')}<div><strong>Showing the ${esc(b.previewing)} template.</strong> ${b.own ? `Its questions list <strong>your own ${esc(catalogWords().title.toLowerCase())}</strong> (each sends its photo when picked). ` : ''}Customers still get your current flow until you press <strong>Save & publish</strong>. Press <strong>Discard</strong> to go back.</div></div>` : ''}
          <div class="steps" id="steps">${d.steps.map((s, i) => stepCardHtml(s, i)).join('')}</div>
          <div class="add-step"><span>Add a step:</span>${Object.entries(STEP_TYPES).map(([k, v]) => `<button type="button" class="btn sm" data-add="${k}" title="${esc(v.hint)}">${icon(v.icon, 'sm')}${v.label}</button>`).join('')}</div>
          <div class="card"><div class="card-head"><span class="section-icon red">${icon('reply')}</span><div><h2>Other replies</h2><p>Edge cases the bot handles for you</p></div></div>
            <div class="card-body stack">${Object.entries(MESSAGE_LABELS).map(([k, [label, hint]]) => `
              <label class="field"><span>${label}</span><textarea rows="2" data-path="messages.${k}" maxlength="4096">${esc(d.messages[k] || '')}</textarea>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`).join('')}</div></div>
          <div class="card" id="te-card"></div>
          <div id="builder-errors"></div>
          <div class="save-bar" id="save-bar" ${b.dirty ? '' : 'hidden'}><span>${icon('info')}</span><strong>You have unsaved changes</strong><span class="spacer"></span>
            <button class="btn ghost" id="b-discard">Discard</button><button class="btn primary" id="b-save">${icon('check')}Save & publish</button></div>
        </div>
        <div class="studio-preview"><div class="phone"><div class="phone-screen">
          <div class="phone-top">${avatar(bizName(), 'biz')}<div><strong>${esc(bizName())}</strong><small>Preview · first option each time</small></div></div>
          <div class="phone-body" id="preview"></div></div></div></div>
      </div></div>`;
    hydrateIcons($('#page'));
    updateCounters();
    renderFlowPreview();
    const root = $('#builder');
    root.addEventListener('input', onBuilderInput);
    root.addEventListener('change', onBuilderChange);
    root.addEventListener('click', onBuilderClick);
    renderTeluguCard();
  }

  // ---- Telugu wording: customers who write or speak Telugu get these texts (empty = the English is used) ----
  /** The flow's customer-facing texts with their WhatsApp limits — same keys as the server (lang.flowStrings). */
  function teluguKeys(d) {
    const out = [];
    (d.steps || []).forEach((s, i) => {
      const where = `Step ${i + 1}`;
      const textMax = s.type === 'finish' || s.type === 'send' ? 4096 : 1024;
      if (s.text) out.push({ key: `s.${s.id}.text`, en: s.text, label: `${where} · message`, max: textMax, long: true });
      if (s.type === 'choice') {
        const asList = s.forceList || (s.options || []).length > 3;
        (s.options || []).forEach((o, j) => {
          if (o.title) out.push({ key: `o.${s.id}.${o.id}.title`, en: o.title, label: `${where} · option ${j + 1}`, max: asList ? 24 : 20 });
          if (o.description) out.push({ key: `o.${s.id}.${o.id}.description`, en: o.description, label: `${where} · option ${j + 1} description`, max: 72 });
        });
        for (const [k, max, l] of [['listHeader', 60, 'list title'], ['listButton', 20, 'list button'], ['listSection', 24, 'list section']]) if (s[k]) out.push({ key: `s.${s.id}.${k}`, en: s[k], label: `${where} · ${l}`, max });
      }
    });
    for (const [k, v] of Object.entries(d.messages || {})) if (v) out.push({ key: `m.${k}`, en: v, label: `Reply · ${(MESSAGE_LABELS[k] || [k])[0]}`, max: 4096, long: true });
    return out;
  }
  function renderTeluguCard() {
    const card = $('#te-card'); if (!card) return;
    const d = state.builder.draft; const te = d.i18n?.te || {};
    const keys = teluguKeys(d); const done = keys.filter((k) => te[k.key]).length;
    card.innerHTML = `<div class="card-head"><span class="section-icon" style="background:#fef3c7;color:#b45309">${icon('chat')}</span><div><h2>తెలుగు · Telugu wording</h2>
        <p>Customers who write or speak Telugu get these texts. An empty box uses the English. ${done}/${keys.length} translated.</p></div><span class="spacer"></span>
        <button type="button" class="btn sm primary" id="te-auto">${icon('sparkle', 'sm')}${done ? 'Translate the empty ones' : 'Auto-translate to Telugu'}</button></div>
      <details class="card-body" ${done ? '' : 'open'}><summary class="muted small" style="cursor:pointer">Show / edit the Telugu texts</summary>
        <div class="stack" style="margin-top:12px">${keys.map((k) => `
          <label class="field"><span>${esc(k.label)} <span class="muted small">— ${esc(k.en.replace(/\s+/g, ' ').slice(0, 70))}${k.en.length > 70 ? '…' : ''}</span></span>
            ${k.long ? `<textarea rows="2" data-te="${esc(k.key)}" maxlength="${k.max}" placeholder="${esc(k.en)}">${esc(te[k.key] || '')}</textarea>`
              : `<input class="input" data-te="${esc(k.key)}" maxlength="${k.max}" placeholder="${esc(k.en)}" value="${esc(te[k.key] || '')}" />`}</label>`).join('')}</div></details>`;
    hydrateIcons(card);
    card.querySelectorAll('[data-te]').forEach((el) => el.addEventListener('input', () => {
      d.i18n = d.i18n || {}; d.i18n.te = d.i18n.te || {};
      if (el.value.trim()) d.i18n.te[el.dataset.te] = el.value; else delete d.i18n.te[el.dataset.te];
      markBuilderDirty();
    }));
    $('#te-auto').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Translating…';
      try {
        const res = await api('POST', `/tenants/${state.tenantId}/translate`, { flow: d, onlyMissing: !!done });
        d.i18n = { te: res.te }; markBuilderDirty(); renderTeluguCard();
        toast('Telugu ready — check it, then Save & publish', res.skipped?.length ? `${res.skipped.length} text(s) were too long for WhatsApp or lost a {placeholder} — they stay in English; you can type them in.` : 'Every text was translated.', { timeout: 9000 });
      } catch (x) { toast('Could not translate', x.message, { kind: 'error' }); b.disabled = false; b.textContent = 'Auto-translate to Telugu'; }
    });
  }

  /** <option>s for picking a product/service (only ones with photos when photosOnly). */
  const itemOptions = (selected, photosOnly = false) => `<option value="">None</option>${state.catalog.filter((it) => !photosOnly || it.imageUrl)
    .map((it) => `<option value="${esc(it._id)}" ${selected === it._id ? 'selected' : ''}>${esc(it.name)}${it.price ? ` — ${esc(it.price)}` : ''}${it.imageUrl ? '' : ' (no photo)'}</option>`).join('')}`;
  const placeholdersFor = (i) => ['business', 'name', 'address', 'adminPhone', ...state.builder.draft.steps.slice(0, i).filter((s) => s.field).map((s) => s.field)];
  const stepSummary = (s) => (s.type === 'send' ? ({ document: '📄 Send the PDF from Business Profile', location: '📍 Send the location pin', catalog: `🖼️ Send photos${s.itemIds?.length ? ` (${s.itemIds.length} chosen)` : s.category ? ` — ${s.category}` : ' — all'}`, text: s.text || 'Send a message' })[s.kind] : (s.text || '').replace(/\s+/g, ' '));
  const nextOptions = (cur, value, allowDefault = true) => {
    const steps = state.builder.draft.steps;
    return `${allowDefault ? `<option value="" ${!value ? 'selected' : ''}>Next step</option>` : ''}${steps.filter((x) => x.id !== cur.id).map((x) => `<option value="${esc(x.id)}" ${value === x.id ? 'selected' : ''}>Step ${steps.indexOf(x) + 1}: ${esc(stepSummary(x).slice(0, 30))}</option>`).join('')}<option value="END" ${value === 'END' ? 'selected' : ''}>End conversation</option>`;
  };

  function stepCardHtml(s, i) {
    const open = state.builder.open.has(s.id);
    const n = state.builder.draft.steps.length;
    const p = `steps.${i}`;
    const T = STEP_TYPES[s.type] || STEP_TYPES.send;
    const ta = (path, label, max, rows = 3, hint = '') => `<label class="field"><span>${label}</span><textarea rows="${rows}" data-path="${path}" maxlength="${max}">${esc(getPath(state.builder.draft, path) || '')}</textarea>
      <div class="row"><div class="placeholders">${placeholdersFor(i).map((ph) => `<button type="button" class="ph" data-insert="${path}" data-ph="${ph}">{${ph}}</button>`).join('')}</div><span class="spacer"></span><span class="counter" data-count="${path}" data-max="${max}"></span></div>
      ${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
    const inp = (path, label, max, extra = '') => `<label class="field"><span>${label}</span><input class="input" data-path="${path}" maxlength="${max}" value="${esc(getPath(state.builder.draft, path) ?? '')}" ${extra} /><span class="counter" data-count="${path}" data-max="${max}"></span></label>`;
    const saves = () => `<div class="grid-3">${inp(`${p}.label`, 'Column name', 40)}${inp(`${p}.field`, 'Saved as (placeholder)', 31, 'pattern="[a-z][a-z0-9_]*"')}
      <label class="field"><span>Customer status after answer</span><select data-path="${p}.setStatus">${[['', 'No change'], ['ENGAGED', 'Engaged'], ['QUALIFIED', 'Qualified'], ['CONVERTED', 'Converted']].map(([v, l]) => `<option value="${v}" ${(s.setStatus || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`;
    let body = '';
    if (s.type === 'choice') {
      const asList = s.forceList || s.options.length > 3;
      const max = asList ? 24 : 20;
      body = `${ta(`${p}.text`, 'Question', 1024)}
        <div class="field"><span>Options</span><span class="hint">${asList ? 'Sent as a list (up to 10 options, 24 characters).' : 'Up to 3 options are sent as buttons (20 characters); 4 or more become a list.'} "Saved as" is what you see on the customer.</span></div>
        <div class="option-rows">${s.options.map((o, j) => `
          <div class="option-row opt5"><span class="num">${j + 1}</span>
            <label class="field"><span>Button text</span><input class="input" data-path="${p}.options.${j}.title" maxlength="${max}" value="${esc(o.title)}" /><span class="counter" data-count="${p}.options.${j}.title" data-max="${max}"></span></label>
            <label class="field"><span>Saved as</span><input class="input" data-path="${p}.options.${j}.label" maxlength="60" value="${esc(o.label)}" /></label>
            <label class="field"><span>Then</span><select data-path="${p}.options.${j}.next" class="branch">${nextOptions(s, o.next)}</select></label>
            <button type="button" class="btn icon sm ghost danger" data-remove-opt="${i}.${j}" aria-label="Remove option" style="margin-top:24px" ${s.options.length <= 1 ? 'disabled' : ''}>${icon('trash', 'sm')}</button>
            ${asList ? `<label class="field" style="grid-column:2/-2"><span>Description (optional)</span><input class="input" data-path="${p}.options.${j}.description" maxlength="72" value="${esc(o.description || '')}" /></label>` : ''}
            ${state.catalog.length ? `<label class="field" style="grid-column:2/-2"><span>Send a photo when picked</span><select data-path="${p}.options.${j}.itemId">${itemOptions(o.itemId)}</select></label>` : ''}
          </div>`).join('')}</div>
        ${state.catalog.length ? `<label class="field" style="max-width:420px"><span>Photo with this question</span><select data-path="${p}.imageItemId">${itemOptions(s.imageItemId, true)}</select><span class="hint">${asList ? 'Lists can’t hold a photo, so it is sent just before the list.' : 'Shown above the buttons.'}</span></label>` : ''}
        <div class="row wrap"><button type="button" class="btn sm" data-add-opt="${i}" ${s.options.length >= 10 ? 'disabled' : ''}>${icon('plus', 'sm')}Add option</button>
          ${state.catalog.length ? `<button type="button" class="btn sm" data-fill-opt="${i}" title="Replace the options with your products/services (first 10), each sending its photo">${icon('image', 'sm')}Options from ${esc(catalogWords().title.toLowerCase())}</button>` : ''}
          <label class="switch small"><input type="checkbox" data-path="${p}.forceList" ${s.forceList ? 'checked' : ''} /><span class="track"></span>Always show as a list</label></div>
        ${asList ? `<div class="grid-3">${inp(`${p}.listHeader`, 'List title', 60)}${inp(`${p}.listButton`, 'List button', 20)}${inp(`${p}.listSection`, 'Section name', 24)}</div>` : ''}
        ${saves()}`;
    } else if (s.type === 'question') {
      body = `${ta(`${p}.text`, 'Question', 1024)}
        <label class="field" style="max-width:260px"><span>Expected answer</span><select data-path="${p}.input">${INPUTS.map(([v, l]) => `<option value="${v}" ${s.input === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="hint">Wrong formats get the "wrong answer" reply. A Name answer also becomes the customer's name.</span></label>
        ${saves()}`;
    } else if (s.type === 'slots') {
      body = `${ta(`${p}.text`, 'Question', 1024)}
        <div class="field"><span>Time slots</span><span class="hint">Real dates are filled in automatically, e.g. "Sat 28 Nov, 4 PM". Up to 3.</span></div>
        <div class="option-rows">${s.plan.map((x, j) => `<div class="slot-row"><span class="num">${j + 1}</span>
          <select data-path="${p}.plan.${j}.day" aria-label="Day">${DAYS.map(([v, l]) => `<option value="${v}" ${x.day === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input class="input" type="time" data-path="${p}.plan.${j}.time" value="${esc(x.time)}" aria-label="Time" />
          <button type="button" class="btn icon sm ghost danger" data-remove-slot="${i}.${j}" aria-label="Remove slot" ${s.plan.length <= 1 ? 'disabled' : ''}>${icon('trash', 'sm')}</button></div>`).join('')}</div>
        <button type="button" class="btn sm" data-add-slot="${i}" style="align-self:flex-start" ${s.plan.length >= 3 ? 'disabled' : ''}>${icon('plus', 'sm')}Add slot</button>
        ${saves()}`;
    } else if (s.type === 'send') {
      const cats = [...new Set(state.catalog.map((x) => x.category).filter(Boolean))];
      const mode = s.itemIds?.length ? 'chosen' : s.category ? 'category' : 'all';
      body = `<label class="field" style="max-width:260px"><span>What to send</span><select data-path="${p}.kind">${[['catalog', `Photos — ${catalogWords().title}`], ['document', 'PDF document'], ['location', 'Location pin'], ['text', 'Message']].map(([v, l]) => `<option value="${v}" ${s.kind === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        ${s.kind === 'catalog' ? (state.catalog.length ? `
          <div class="grid-2"><label class="field"><span>Which ones</span><select data-catmode="${i}">${[['all', 'All (up to 10)'], ['category', 'One category'], ['chosen', 'Let me choose']].map(([v, l]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            ${mode === 'category' ? `<label class="field"><span>Category</span><select data-path="${p}.category">${cats.map((c) => `<option value="${esc(c)}" ${s.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : ''}</div>
          <label class="field"><span>How to show them</span><select data-path="${p}.display">${[['list', 'One list — customer taps to see a photo (1 message)'], ['photos', 'Every photo at once (1 message per photo)']].map(([v, l]) => `<option value="${v}" ${(s.display || 'list') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="hint">WhatsApp bills every message the bot sends, so a list is the cheapest way to show several. One item is always sent as its photo.</span></label>
          ${mode === 'chosen' ? `<div class="item-pick">${state.catalog.map((it) => `<label><input type="checkbox" data-pick="${i}" value="${esc(it._id)}" ${s.itemIds.includes(it._id) ? 'checked' : ''} hidden />${it.imageUrl ? `<img src="${esc(it.imageUrl)}" alt="" />` : '<span class="noimg"></span>'}<span>${esc(it.name)}</span></label>`).join('')}</div><span class="hint">Up to 10. Each photo goes with its name, price and description.</span>` : ''}
          ${ta(`${p}.text`, (s.display || 'list') === 'list' ? 'List message (optional)' : 'Message before the photos (optional)', 1024, 2)}`
          : `<div class="banner">${icon('info')}<div>No ${esc(catalogWords().title.toLowerCase())} yet — <a href="#/catalog">add some with photos</a>. Until then this step is skipped.</div></div>`) : ''}
        ${s.kind === 'location' ? `<div class="banner blue">${icon('pin')}<div>Sends the pin from your <a href="#/profile">Business Profile</a>${state.tenant.profile?.latitude == null ? ' — <strong>no location set yet</strong>, so this step is skipped' : ''}.</div></div>` : ''}
        ${s.kind === 'document' ? `<div class="banner blue">${icon('file')}<div>Sends the PDF from your <a href="#/profile">Business Profile</a>${state.tenant.profile?.documentUrl ? '' : ' — <strong>none uploaded yet</strong>, so this step is skipped'}.</div></div>${ta(`${p}.text`, 'Caption (optional)', 1024, 2)}` : ''}
        ${s.kind === 'text' ? ta(`${p}.text`, 'Message', 4096, 3) : ''}`;
    } else {
      body = `${ta(`${p}.text`, 'Confirmation message', 4096, 6)}
        <label class="switch"><input type="checkbox" data-path="${p}.alertTeam" ${s.alertTeam !== false ? 'checked' : ''} /><span class="track"></span>Alert my team on WhatsApp with the answers</label>
        <span class="hint">The customer is marked Converted.</span>`;
    }
    const then = s.type !== 'finish' && s.type !== 'choice'
      ? `<label class="field" style="max-width:320px"><span>Then go to</span><select data-path="${p}.next">${nextOptions(s, s.next)}</select></label>`
      : s.type === 'choice' ? `<label class="field" style="max-width:320px"><span>After any option without its own "Then"</span><select data-path="${p}.next">${nextOptions(s, s.next)}</select></label>` : '';
    return `<div class="step-card ${open ? 'open' : ''}" data-step="${i}">
      <div class="step-head" data-toggle="${esc(s.id)}"><span class="step-num">${i + 1}</span><span class="step-type ${s.type}">${icon(T.icon, 'sm')}${T.label}</span>
        <span class="summary" data-summary="${i}">${esc(stepSummary(s))}</span>
        <span class="tools"><button type="button" class="btn icon sm ghost" data-move="${i}:-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up', 'sm')}</button>
          <button type="button" class="btn icon sm ghost" data-move="${i}:1" aria-label="Move down" ${i === n - 1 ? 'disabled' : ''}>${icon('down', 'sm')}</button>
          <button type="button" class="btn icon sm ghost danger" data-del="${i}" aria-label="Delete step">${icon('trash', 'sm')}</button></span></div>
      ${open ? `<div class="step-body">${body}${then}</div>` : ''}</div>`;
  }

  function markBuilderDirty() { state.builder.dirty = true; const bar = $('#save-bar'); if (bar) bar.hidden = false; }
  function rerenderSteps() {
    const d = state.builder.draft;
    $('#steps').innerHTML = d.steps.map((s, i) => stepCardHtml(s, i)).join('');
    hydrateIcons($('#steps'));
    updateCounters(); renderFlowPreview();
  }
  function updateCounters() {
    $$('[data-count]').forEach((c) => { const v = String(getPath(state.builder.draft, c.dataset.count) ?? ''); c.textContent = `${v.length}/${c.dataset.max}`; c.classList.toggle('over', v.length > Number(c.dataset.max)); });
  }
  function onBuilderInput(e) {
    const path = e.target.dataset.path; if (!path || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') return;
    setPath(state.builder.draft, path, path.endsWith('.field') ? e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') : e.target.value);
    if (path.endsWith('.field') && e.target.value !== getPath(state.builder.draft, path)) e.target.value = getPath(state.builder.draft, path);
    markBuilderDirty(); updateCounters();
    const m = path.match(/^steps\.(\d+)\.text$/);
    if (m) { const el = $(`[data-summary="${m[1]}"]`); if (el) el.textContent = stepSummary(state.builder.draft.steps[m[1]]); }
    renderFlowPreview();
  }
  function onBuilderChange(e) {
    const d = state.builder.draft;
    if (e.target.dataset.catmode !== undefined) {
      const s = d.steps[Number(e.target.dataset.catmode)]; const m = e.target.value;
      s.itemIds = m === 'chosen' ? state.catalog.slice(0, 3).map((x) => x._id) : [];
      s.category = m === 'category' ? ([...new Set(state.catalog.map((x) => x.category).filter(Boolean))][0] || '') : '';
      markBuilderDirty(); rerenderSteps(); return;
    }
    if (e.target.dataset.pick !== undefined) {
      const s = d.steps[Number(e.target.dataset.pick)];
      const set = new Set(s.itemIds || []);
      if (e.target.checked) { if (set.size >= 10) { e.target.checked = false; toast('Up to 10 photos per step', '', { kind: 'warn' }); return; } set.add(e.target.value); } else set.delete(e.target.value);
      s.itemIds = state.catalog.map((x) => x._id).filter((id) => set.has(id)); // keep catalog order
      markBuilderDirty(); rerenderSteps(); return;
    }
    const path = e.target.dataset.path; if (!path) return;
    if (e.target.type === 'checkbox') setPath(state.builder.draft, path, e.target.checked);
    else if (e.target.tagName === 'SELECT') setPath(state.builder.draft, path, e.target.value || null);
    else return;
    // Linking a product to an option that still has a placeholder name ("Option 2") names it after the product.
    const m = /^steps\.(\d+)\.options\.(\d+)\.itemId$/.exec(path);
    if (m && e.target.value) {
      const s = state.builder.draft.steps[+m[1]]; const o = s.options[+m[2]];
      const it = state.catalog.find((x) => x._id === e.target.value);
      if (it && (!o.title || /^option \d+$/i.test(o.title.trim()))) {
        const max = s.forceList || s.options.length > 3 ? 24 : 20;
        o.title = it.name.length > max ? `${it.name.slice(0, max - 1).trim()}…` : it.name;
        o.label = it.name;
        if (!o.description && it.price && (s.forceList || s.options.length > 3)) o.description = it.price.slice(0, 72);
      }
    }
    markBuilderDirty();
    if (path === 'enabled') { renderFlowPreview(); return; }
    rerenderSteps(); // layout can change (list vs buttons, send kind…)
  }
  async function onBuilderClick(e) {
    const b = state.builder; const d = b.draft; const t = e.target.closest('button, [data-toggle]');
    if (!t) return;
    if (t.dataset.template) {
      // Opens the template in the editor as a draft; customers only see it after "Save & publish".
      const key = t.dataset.template;
      const saved = state.tenant.flow || {};
      if (key === saved.template && !b.dirty) return;
      if (key === saved.template) { state.builder = null; renderBuilder(); return; } // back to the live flow
      try {
        if (!state.templateFlows) state.templateFlows = (await api('GET', '/templates')).data;
        const tpl = state.templateFlows.find((x) => x.key === key);
        if (!tpl) return;
        // The template comes back with its main question listing this business's own products/services.
        const own = state.catalogAll.some((x) => x.active && x.layout === key) ? (await api('GET', `/tenants/${state.tenant._id}/templates/${key}`)).data : tpl.flow;
        const draft = { ...clone(own), enabled: d.enabled !== false, template: key };
        state.builder = { draft, dirty: true, open: new Set(draft.steps[0] ? [draft.steps[0].id] : []), previewing: tpl.name, own: own !== tpl.flow };
        renderBuilder();
        $('.studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) { toast('Could not open template', err.message, { kind: 'error' }); }
      return;
    }
    if (t.dataset.insert) {
      const ta = $(`textarea[data-path="${t.dataset.insert}"]`); const token = `{${t.dataset.ph}}`;
      const [s, en] = [ta.selectionStart ?? ta.value.length, ta.selectionEnd ?? ta.value.length];
      ta.value = ta.value.slice(0, s) + token + ta.value.slice(en); ta.focus(); ta.selectionStart = ta.selectionEnd = s + token.length;
      setPath(d, t.dataset.insert, ta.value); markBuilderDirty(); updateCounters(); renderFlowPreview();
      return;
    }
    if (t.dataset.toggle && !e.target.closest('.tools')) { const id = t.dataset.toggle; b.open.has(id) ? b.open.delete(id) : b.open.add(id); rerenderSteps(); return; }
    if (t.dataset.add) { const s = newStep(t.dataset.add); d.steps.push(s); b.open.add(s.id); markBuilderDirty(); rerenderSteps(); $(`[data-step="${d.steps.length - 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (t.dataset.move) { const [i, dir] = t.dataset.move.split(':').map(Number); const j = i + dir; [d.steps[i], d.steps[j]] = [d.steps[j], d.steps[i]]; markBuilderDirty(); rerenderSteps(); return; }
    if (t.dataset.del) { d.steps.splice(Number(t.dataset.del), 1); markBuilderDirty(); rerenderSteps(); toast('Step removed', 'Press Discard to undo, or Save & publish to keep it.', { kind: 'info' }); return; }
    if (t.dataset.fillOpt) {
      const s = d.steps[Number(t.dataset.fillOpt)]; const items = state.catalog.filter((x) => x.active).slice(0, 10);
      const max = items.length > 3 || s.forceList ? 24 : 20;
      s.options = items.map((it) => ({ id: `OPT_${rid().toUpperCase()}`, title: it.name.slice(0, max), label: it.name, description: (it.price || '').slice(0, 72), itemId: it._id }));
      markBuilderDirty(); rerenderSteps(); toast(`${items.length} options created`, 'Each sends its photo when picked.', { kind: 'info' }); return;
    }
    if (t.dataset.addOpt) { const s = d.steps[Number(t.dataset.addOpt)]; s.options.push({ id: `OPT_${rid().toUpperCase()}`, title: `Option ${s.options.length + 1}`, label: `Option ${s.options.length + 1}`, description: '' }); markBuilderDirty(); rerenderSteps(); return; }
    if (t.dataset.removeOpt) { const [i, j] = t.dataset.removeOpt.split('.').map(Number); d.steps[i].options.splice(j, 1); markBuilderDirty(); rerenderSteps(); return; }
    if (t.dataset.addSlot) { d.steps[Number(t.dataset.addSlot)].plan.push({ day: 'SAT', time: '11:00' }); markBuilderDirty(); rerenderSteps(); return; }
    if (t.dataset.removeSlot) { const [i, j] = t.dataset.removeSlot.split('.').map(Number); d.steps[i].plan.splice(j, 1); markBuilderDirty(); rerenderSteps(); return; }
    if (t.id === 'b-discard') { state.builder = null; renderBuilder(); return; }
    if (t.id === 'b-save') saveBuilder();
  }
  async function saveBuilder() {
    const btn = $('#b-save'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…';
    try {
      const res = await api('PATCH', `/tenants/${state.tenantId}`, { flow: state.builder.draft });
      applyTenantPayload(res);
      const open = state.builder.open;
      state.builder = { draft: clone(res.data.flow), dirty: false, open };
      renderBuilder();
      toast('Flow published', 'New conversations use it right away.');
      log('Flow Builder saved.', 'success');
    } catch (err) {
      $('#builder-errors').innerHTML = errorList(err);
      $('#builder-errors').scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.disabled = false; btn.innerHTML = `${icon('check')}Save & publish`;
    }
  }

  /** Same slot logic as the server, in the browser's time zone, for the preview only. */
  function previewSlots(plan) {
    const out = []; const now = new Date(); const idx = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
    for (let i = 1; out.length < plan.length && i <= 21; i++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      for (const r of plan) {
        if (out.length >= plan.length) break;
        if (r.day === 'TOMORROW' ? i !== 1 : idx[r.day] !== day.getDay()) continue;
        const [h, m] = String(r.time || '11:00').split(':').map(Number);
        const at = new Date(day); at.setHours(h || 0, m || 0, 0, 0);
        if (!out.some((x) => x.getTime() === at.getTime())) out.push(at);
      }
    }
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return out.sort((a, b) => a - b).map((at) => { const t = at.toLocaleTimeString([], { hour: 'numeric', minute: at.getMinutes() ? '2-digit' : undefined }); return sameDay(at, tomorrow) ? `Tomorrow, ${t}` : `${at.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${t}`; });
  }
  const SAMPLE = { name: 'Priya Sharma', email: 'priya@example.com', phone: '+91 98765 43210', number: '29', date: '15 Dec', text: 'I would like to know more.', location: '📍 Kokapet, Hyderabad 500075' };
  function renderFlowPreview() {
    const el = $('#preview'); if (!el) return;
    const d = state.builder.draft; const p = state.tenant.profile || {};
    const vars = { business: p.displayName || state.tenant.businessName, name: 'Priya', address: p.address || '', adminPhone: state.tenant.adminNotificationPhone };
    const fill = (t) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] ? vars[k] : m));
    const now = new Date().toISOString();
    const bot = (type, text, meta) => messageHtml({ _id: Math.random(), direction: 'out', sentBy: 'bot', type, text, meta, status: 'read', createdAt: now }, { direction: 'out', sentBy: 'bot', createdAt: now });
    const user = (text, tapped = true) => messageHtml({ _id: Math.random(), direction: 'in', sentBy: 'customer', type: tapped ? 'reply' : 'text', text, createdAt: now }, null);
    const label = (t) => `<div class="step-label">${t}</div>`;
    const itemById = (id) => (id ? state.catalog.find((x) => x._id === id && x.active) : null);
    const itemBubble = (it, lead = '') => bot(it.imageUrl ? 'image' : 'text', `${lead ? `${lead}\n\n` : ''}*${it.name}*${it.price ? ` — ${it.price}` : ''}${itemDetailPairs(it).map(([k, v]) => `\n${k}: ${v}`).join('')}${it.description ? `\n${it.description}` : ''}${itemLocationText(it) ? `\n\n${itemLocationText(it)}` : ''}`, it.imageUrl ? { link: it.imageUrl } : null);
    if (d.enabled === false || !d.steps.length) { el.innerHTML = label(d.enabled === false ? 'Flow is off — only the AI and your team reply' : 'Add a step to start'); return; }
    const html = [label('Customer replies to your broadcast'), user('Hi', false)];
    let s = d.steps[0]; let guard = 0;
    const after = (cur, explicit) => { const nx = explicit || cur.next; if (nx === 'END') return null; if (nx) return d.steps.find((x) => x.id === nx) || null; return d.steps[d.steps.indexOf(cur) + 1] || null; };
    while (s && guard++ < 25) {
      if (s.type === 'choice') {
        const asList = s.forceList || s.options.length > 3;
        const head = itemById(s.imageItemId)?.imageUrl || null;
        if (asList && head) html.push(bot('image', '', { link: head }));
        html.push(asList ? bot('list', fill(s.text), { header: fill(s.listHeader), button: fill(s.listButton), rows: s.options.map((o) => ({ title: o.title, description: o.description })) }) : bot('buttons', fill(s.text), { buttons: s.options.map((o) => o.title), image: head }));
        const o = s.options[0]; if (!o) break;
        html.push(user(o.title)); vars[s.field] = o.label;
        const linked = itemById(o.itemId); if (linked) html.push(itemBubble(linked));
        s = after(s, o.next);
      } else if (s.type === 'question') {
        const areas = s.input === 'location' ? [...new Map(state.catalog.filter((x) => x.active && (x.details?.address || x.details?.pincode)).map((x) => { const n = String(x.details.address || x.details.pincode).trim(); return [n.toLowerCase(), n]; })).values()].slice(0, 9) : [];
        html.push(s.input !== 'location' ? bot('text', fill(s.text)) : areas.length
          ? bot('list', fill(s.text), { header: 'Our locations', button: 'Choose area', rows: [...areas.map((n) => ({ title: n, description: `${state.catalog.filter((x) => String(x.details?.address || x.details?.pincode || '').trim().toLowerCase() === n.toLowerCase()).length} projects` })), { title: '📍 Other location', description: 'Share your location or type a pincode' }] })
          : bot('buttons', fill(s.text), { buttons: ['📍 Send location'] }));
        const a = s.input === 'location' && areas.length ? areas[0] : SAMPLE[s.input] || SAMPLE.text; html.push(user(a, false));
        vars[s.field] = a; if (s.input === 'name') vars.name = a; s = after(s);
      } else if (s.type === 'slots') {
        const sl = previewSlots(s.plan); html.push(bot('buttons', fill(s.text), { buttons: sl })); html.push(user(sl[0] || ''));
        vars[s.field] = sl[0] || ''; s = after(s);
      } else if (s.type === 'send') {
        if (s.kind === 'document') html.push(p.documentUrl ? bot('document', fill(s.text), { filename: `${p.documentName || vars.business}.pdf`, link: p.documentUrl }) : label('No PDF uploaded — step skipped'));
        else if (s.kind === 'location') html.push(p.latitude != null ? bot('location', vars.business, { name: vars.business, address: p.address, latitude: p.latitude, longitude: p.longitude }) : label('No location set — step skipped'));
        else if (s.kind === 'catalog') {
          const act = state.catalog.filter((x) => x.active);
          const items = s.itemIds?.length ? s.itemIds.map(itemById).filter(Boolean) : act.filter((x) => !s.category || x.category === s.category);
          if (!items.length) html.push(label('No products/services yet — step skipped'));
          else if (s.display === 'photos') { if (s.text) html.push(bot('text', fill(s.text))); items.slice(0, 10).forEach((it) => html.push(itemBubble(it))); }
          else if (items.length === 1) html.push(itemBubble(items[0], fill(s.text || '')));
          else { html.push(bot('list', fill(s.text || '') || 'Tap below to see photos and prices 👇', { button: 'View photos', rows: items.slice(0, 10).map((it) => ({ title: it.name, description: [it.price, it.description].filter(Boolean).join(' · ') })) })); html.push(user(items[0].name)); html.push(itemBubble(items[0])); }
        }
        else html.push(bot('text', fill(s.text)));
        s = after(s);
      } else { html.push(bot('text', fill(s.text))); html.push(label(s.alertTeam !== false ? 'Your team gets a WhatsApp alert' : 'Conversation complete')); s = null; }
    }
    el.innerHTML = html.join('');
  }

  // ============================================================
  // Products & Services (photos the bot and AI send on WhatsApp)
  // ============================================================
  const CATALOG_WORDS = {
    real_estate: { title: 'Projects & units', one: 'unit', ex: ['3 BHK Lake View', '₹1.45 Cr', 'Tower A', '1,850 sq.ft, east facing, 12th floor, 2 car parks'] },
    clinic: { title: 'Services & treatments', one: 'service', ex: ['Dental cleaning', '₹1,200', 'Dental', 'Scaling and polishing, 30 minutes'] },
    salon: { title: 'Services & packages', one: 'service', ex: ['Bridal makeup', '₹15,000', 'Bridal', 'HD makeup, hairstyle and draping'] },
    restaurant: { title: 'Menu', one: 'dish', ex: ['Paneer Tikka', '₹280', 'Starters', 'Chargrilled cottage cheese, mint chutney'] },
    coaching: { title: 'Courses', one: 'course', ex: ['JEE Foundation', '₹45,000 / year', 'Class 9–10', 'Weekend batches, online or at the centre'] },
    retail: { title: 'Products', one: 'product', ex: ['Cotton Kurta', '₹899', 'Women', 'Sizes S–XXL, 5 colours'] },
    software: { title: 'Services & packages', one: 'service', ex: ['Custom MVP / Web Portal', 'from ₹5 Lakh', 'Fixed scope', 'UI/UX, full-stack build, deployment, 100% source ownership'] },
    general: { title: 'Products & services', one: 'item', ex: ['Website design', 'from ₹15,000', 'Services', '5 pages, mobile friendly, 2 weeks'] },
  };
  // Products & services belong to one layout (flow template). Customers see the selected layout's items.
  const savedLayout = () => state.tenant?.flow?.template || state.tenant?.industry || 'general';
  function useLayout(key) { state.catLayout = key; state.catalog = (state.catalogAll || []).filter((x) => x.layout === key); }
  const layoutName = (k) => state.templates.find((t) => t.key === k)?.name || k.replace(/_/g, ' ');
  const catalogWords = () => CATALOG_WORDS[state.catLayout || savedLayout()] || CATALOG_WORDS.general;
  const itemFieldsOf = (layout) => state.templates.find((t) => t.key === layout)?.itemFields || state.templates.find((t) => t.key === 'general')?.itemFields || [];
  const LOCATION_KEYS = ['address', 'pincode', 'map'];
  const itemDetailPairs = (it) => itemFieldsOf(it.layout).filter((f) => !LOCATION_KEYS.includes(f.key) && it.details?.[f.key]).map((f) => [f.label, it.details[f.key]]);
  const itemMapUrl = (it) => (Number.isFinite(it.details?.lat) ? `https://www.google.com/maps/search/?api=1&query=${it.details.lat},${it.details.lng}` : it.details?.map || '');
  const itemLocationText = (it) => [(it.details?.address || it.details?.pincode) && `📍 ${[it.details?.address, it.details?.pincode].filter(Boolean).join(' ')}`, itemMapUrl(it)].filter(Boolean).join('\n');
  const catState = { search: '', category: '' };

  /** Converts any photo to a WhatsApp-friendly JPEG (max 1600 px, under 5 MB). PNG/JPEG already small enough pass through. */
  async function prepareImage(file) {
    const okType = file.type === 'image/jpeg' || file.type === 'image/png';
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch { /* unreadable format, e.g. HEIC */ }
    if (!bmp) {
      if (okType && file.size <= 5 * 1024 * 1024) return file;
      throw new Error("This photo format can't be read. Please use JPEG, PNG or WebP.");
    }
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (okType && scale === 1 && file.size <= 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // transparent PNGs get a white background
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.72, 0.6]) {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= 5 * 1024 * 1024) return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    }
    throw new Error('This photo is too large even after compressing. Try a smaller one.');
  }

  async function reloadCatalog() { state.catalogAll = (await api('GET', `/catalog/${state.tenantId}`)).data; useLayout(state.catLayout || savedLayout()); }

  function renderCatalog() {
    // Only the selected layout's list is shown; other layouts' items stay saved for when they are selected again.
    const live = savedLayout();
    useLayout(live);
    const w = catalogWords();
    const cats = [...new Set(state.catalog.map((x) => x.category).filter(Boolean))].sort();
    const s = catState.search.toLowerCase();
    const list = state.catalog.filter((x) => (!catState.category || x.category === catState.category) && (!s || `${x.name} ${x.description} ${x.category}`.toLowerCase().includes(s)));
    const withPhoto = state.catalog.filter((x) => x.imageUrl).length;
    $('#page').innerHTML = `<div class="page-inner" id="cat-root">
      <div class="page-head"><div><h1>${esc(w.title)}</h1><p>Add photos with names and prices. The bot sends them in your flow, and the AI shows the right photo when customers ask.</p></div><span class="spacer"></span>
        <button class="btn primary" id="cat-add">${icon('plus')}Add ${esc(w.one)}</button></div>
      <div class="banner blue">${icon('info')}<div>For your <strong>${esc(layoutName(live))}</strong> layout. To use a different layout, change it in the <a href="#/flow">Flow Builder</a>.</div></div>
      <div class="row wrap"><div class="filters">${['', ...cats].map((c) => `<button class="filter ${catState.category === c ? 'active' : ''}" data-cat="${esc(c)}">${c ? esc(c) : 'All'}<span class="n">${c ? state.catalog.filter((x) => x.category === c).length : state.catalog.length}</span></button>`).join('')}</div>
        <span class="spacer"></span><div class="search" style="width:min(260px,100%)">${icon('search', 'sm')}<input class="input" id="cat-search" placeholder="Search" value="${esc(catState.search)}" /></div></div>
      ${state.catalog.length ? `<div class="catalog-grid">${list.map((it) => `
        <div class="card cat-card ${it.active ? '' : 'inactive'}" data-id="${esc(it._id)}">
          <div class="cat-photo">${it.imageUrl ? `<img src="${esc(it.imageUrl)}" alt="${esc(it.name)}" loading="lazy" />` : `<span>${icon('image', 'lg')}<small>No photo</small></span>`}
            ${it.active ? '' : '<span class="pill d-QUEUED cat-flag">Hidden</span>'}</div>
          <div class="cat-body"><div class="row"><strong class="grow">${esc(it.name)}</strong>${it.price ? `<span class="cat-price">${esc(it.price)}</span>` : ''}</div>
            ${it.category ? `<span class="pill plain">${esc(it.category)}</span>` : ''}
            ${itemDetailPairs(it).length ? `<div class="cat-details">${itemDetailPairs(it).map(([k, v]) => `<span class="pill plain ${/sold out|out of stock|batch full|not available/i.test(v) ? 'd-FAILED' : ''}" title="${esc(k)}">${esc(v)}</span>`).join('')}</div>` : ''}
            ${it.description ? `<p class="muted small cat-desc">${esc(it.description)}</p>` : ''}
            ${it.details?.address || itemMapUrl(it) ? `<p class="small cat-loc">${icon('pin', 'sm')}<span>${esc([it.details?.address, it.details?.pincode].filter(Boolean).join(' ') || 'Location')}</span>${itemMapUrl(it) ? ` <a href="${esc(itemMapUrl(it))}" target="_blank" rel="noopener">Map</a>` : ''}${it.details?.map && !Number.isFinite(it.details?.lat) ? ' <span class="muted" title="The link has no exact point, so the flow sends your business pin instead">(no exact pin)</span>' : ''}</p>` : ''}</div>
          <div class="cat-tools">
            <button class="btn icon sm ghost" data-up="${esc(it._id)}" aria-label="Move earlier" title="Move earlier">${icon('back', 'sm')}</button>
            <button class="btn icon sm ghost" data-down="${esc(it._id)}" aria-label="Move later" title="Move later" style="transform:scaleX(-1)">${icon('back', 'sm')}</button>
            <span class="spacer"></span>
            <button class="btn sm" data-edit="${esc(it._id)}">${icon('edit', 'sm')}Edit</button>
            <button class="btn icon sm ghost danger" data-del="${esc(it._id)}" aria-label="Delete">${icon('trash', 'sm')}</button></div>
        </div>`).join('')}</div>${list.length ? '' : '<div class="card"><div class="empty"><p>Nothing matches.</p></div></div>'}`
      : `<div class="card"><div class="empty"><span class="section-icon">${icon('image', 'lg')}</span><h3>No ${esc(w.title.toLowerCase())} yet</h3>
          <p>Add your first ${esc(w.one)} with a photo — e.g. “${esc(w.ex[0])} · ${esc(w.ex[1])}”.</p><button class="btn primary" id="cat-add-empty">${icon('plus')}Add ${esc(w.one)}</button></div></div>`}
      <div class="card card-pad stack"><div class="row"><span class="section-icon blue">${icon('info')}</span><h2>How photos reach customers</h2><span class="spacer"></span><span class="muted small">${withPhoto} of ${state.catalog.length} have photos</span></div>
        <ul style="margin:0;padding-left:18px;color:var(--text-2);display:grid;gap:6px">
          <li><strong>Flow Builder → Send → Photos</strong>: send all, one category, or chosen ${esc(w.title.toLowerCase())} with name and price.</li>
          <li><strong>Flow Builder → Buttons</strong>: show a photo with the question, or send an ${esc(w.one)}'s photo when that option is picked.</li>
          <li><strong>AI assistant</strong>: when a customer asks about something here, the AI answers and sends its photo.</li>
          <li>Photos are converted to JPEG and shrunk automatically to fit WhatsApp's 5 MB limit.</li></ul></div>
    </div>`;
    hydrateIcons($('#page'));
    $('#cat-search').addEventListener('input', debounce((e) => { catState.search = e.target.value.trim(); renderCatalog(); $('#cat-search').focus(); $('#cat-search').setSelectionRange(99, 99); }, 250));
    $$('[data-cat]').forEach((b) => b.addEventListener('click', () => { catState.category = b.dataset.cat; renderCatalog(); }));    [$('#cat-add'), $('#cat-add-empty')].forEach((b) => b?.addEventListener('click', () => itemModal(null)));
    $('#cat-root').addEventListener('click', async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.edit) itemModal(state.catalog.find((x) => x._id === t.dataset.edit));
      if (t.dataset.del) {
        const it = state.catalog.find((x) => x._id === t.dataset.del);
        if (!t.classList.contains('confirming')) { t.classList.add('confirming'); t.innerHTML = 'Delete?'; t.classList.remove('icon'); setTimeout(() => { if (t.isConnected) renderCatalog(); }, 3000); return; }
        try { await api('DELETE', `/catalog/${state.tenantId}/${it._id}`); await reloadCatalog(); renderCatalog(); toast(`${it.name} deleted`); log(`Deleted ${it.name}.`, 'warn'); } catch (err) { toast('Could not delete', err.message, { kind: 'error' }); }
      }
      if (t.dataset.up || t.dataset.down) {
        const ids = state.catalog.map((x) => x._id); const id = t.dataset.up || t.dataset.down;
        const i = ids.indexOf(id); const j = i + (t.dataset.up ? -1 : 1);
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        try { state.catalogAll = (await api('POST', `/catalog/${state.tenantId}/reorder`, { ids })).data; renderCatalog(); } catch (err) { toast('Could not reorder', err.message, { kind: 'error' }); }
      }
    });
  }

  // ---------- map picker (OpenStreetMap tiles via Leaflet; place search goes through /api/geocode, cached) ----------
  const mapFieldHtml = (fd, item) => `<div class="field span-2 map-field"><span>Site location <span class="muted">(optional)</span></span>
      <div class="row" style="gap:8px"><div class="search grow">${icon('search', 'sm')}<input class="input" id="map-q" placeholder="Search a pincode or area, e.g. 500075 or Kokapet" /></div><button type="button" class="btn" id="map-find">${icon('pin', 'sm')}Find</button></div>
      <div id="item-map" class="item-map"><span class="muted small">Loading map…</span></div>
      <span class="hint" id="map-hint">Search, then drag the pin or tap the exact spot — or paste the Google Maps link below.</span>
      <label class="field"><span>Google Maps link</span>
        <div class="row" style="gap:8px"><input class="input grow" name="d_${fd.key}" maxlength="500" inputmode="url" value="${esc(item?.details?.[fd.key] || '')}" placeholder="${esc(fd.placeholder || 'https://maps.app.goo.gl/…')}" />
        <a class="btn" id="map-open" target="_blank" rel="noopener" href="${esc(item?.details?.[fd.key] && /^https:/.test(item.details[fd.key]) ? item.details[fd.key] : itemMapUrl(item || {}) || 'https://www.google.com/maps')}">${icon('pin', 'sm')}Open</a></div>
        <span class="hint">In Google Maps: open the site → <strong>Share</strong> → <strong>Copy link</strong> → paste here. Customers get this link in the photo caption.</span></label></div>`;
  let leafletLoading = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!leafletLoading) leafletLoading = new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; css.crossOrigin = '';
      css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='; document.head.appendChild(css);
      const js = document.createElement('script'); js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; js.crossOrigin = '';
      js.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      js.onload = () => resolve(window.L); js.onerror = () => { leafletLoading = null; reject(new Error('Map could not load')); };
      document.head.appendChild(js);
    });
    return leafletLoading;
  }
  async function setupMapPicker(root, item) {
    const box = $('#item-map', root); const linkIn = $('[name="d_map"]', root); const addrIn = $('[name="d_address"]', root); const pinIn = $('[name="d_pincode"]', root); const hint = $('#map-hint', root); const openA = $('#map-open', root);
    linkIn.addEventListener('input', () => { if (/^https:\/\//.test(linkIn.value.trim())) openA.href = linkIn.value.trim(); });
    const p = state.tenant.profile || {};
    const start = Number.isFinite(item?.details?.lat) ? [item.details.lat, item.details.lng] : p.latitude != null ? [p.latitude, p.longitude] : [20.59, 78.96];
    let L; try { L = await loadLeaflet(); } catch { box.innerHTML = '<span class="muted small">Map could not load — paste a Google Maps link below instead.</span>'; return; }
    if (!box.isConnected) return;
    box.innerHTML = '';
    const map = L.map(box, { scrollWheelZoom: false }).setView(start, Number.isFinite(item?.details?.lat) ? 15 : p.latitude != null ? 12 : 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    let marker = null;
    const place = async (lat, lng, label, keepLink = false) => {
      lat = +lat.toFixed(6); lng = +lng.toFixed(6);
      if (!marker) { marker = L.marker([lat, lng], { draggable: true }).addTo(map); marker.on('dragend', () => { const q = marker.getLatLng(); place(q.lat, q.lng); }); }
      else marker.setLatLng([lat, lng]);
      if (!keepLink) { linkIn.value = `${lat}, ${lng}`; openA.href = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`; }
      hint.textContent = 'Pin set — customers get a map link to this exact spot.';
      if (!label) { try { label = (await api('GET', `/geocode?lat=${lat}&lng=${lng}`)).data.label; } catch { /* keep as is */ } }
      if (label && addrIn && !addrIn.value.trim()) addrIn.value = label.replace(/\s*\b\d{6}\b\s*$/, '').split(',')[0].trim().slice(0, 80);
      const pc = /\b(\d{6})\b/.exec(label || '')?.[1]; if (pc && pinIn && !pinIn.value.trim()) pinIn.value = pc;
      if (label) hint.textContent = `Pin set at ${label}.`;
    };
    if (Number.isFinite(item?.details?.lat)) place(item.details.lat, item.details.lng, item.details.address || ' ', true);
    map.on('click', (e) => place(e.latlng.lat, e.latlng.lng));
    const find = async () => {
      const q = $('#map-q', root).value.trim(); if (!q) return;
      const btn = $('#map-find', root); btn.disabled = true;
      try { const { data } = await api('GET', `/geocode?q=${encodeURIComponent(q)}`); map.setView([data.lat, data.lng], /^\d{6}$/.test(q) ? 14 : 15); await place(data.lat, data.lng, data.label); }
      catch (err) { hint.textContent = err.message; }
      finally { btn.disabled = false; }
    };
    $('#map-find', root).addEventListener('click', find);
    $('#map-q', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
    // A pasted link or "lat, lng" moves the pin too.
    linkIn.addEventListener('change', () => {
      const m = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(decodeURIComponent(linkIn.value)) || /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(linkIn.value);
      if (m) { map.setView([+m[1], +m[2]], 15); const v = linkIn.value; place(+m[1], +m[2]).then(() => { linkIn.value = v; }); }
    });
    setTimeout(() => map.invalidateSize(), 200);
  }

  function itemModal(item) {
    const w = catalogWords(); const isNew = !item; const layout = item?.layout || savedLayout();
    const cats = [...new Set(state.catalog.map((x) => x.category).filter(Boolean))];
    let photo = null; let removePhoto = false;
    modal(`<form id="item-form"><div class="card-head"><span class="section-icon">${icon('image')}</span><div><h2>${isNew ? `Add ${esc(w.one)}` : `Edit ${esc(item.name)}`}</h2><p>Shown to customers on WhatsApp</p></div><span class="spacer"></span><button type="button" class="btn icon ghost" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="card-body stack">
        <label class="dropzone item-drop" id="item-drop"><input type="file" id="item-file" accept="image/*" />
          <div id="item-preview">${item?.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="" />` : `<span class="section-icon">${icon('upload', 'lg')}</span><strong>Add a photo</strong><span class="hint">Drop or click · JPEG, PNG or WebP · resized automatically</span>`}</div></label>
        ${item?.imageUrl ? '<button type="button" class="btn sm danger" id="item-photo-remove" style="align-self:flex-start">' + icon('trash', 'sm') + 'Remove photo</button>' : ''}
        <div class="grid-2">
          <label class="field"><span>Name</span><input class="input" name="name" required maxlength="60" value="${esc(item?.name || '')}" placeholder="${esc(w.ex[0])}" /></label>
          <label class="field"><span>Price <span class="muted">(optional)</span></span><input class="input" name="price" maxlength="40" value="${esc(item?.price || '')}" placeholder="${esc(w.ex[1])}" /></label>
          <label class="field"><span>Category <span class="muted">(optional)</span></span><input class="input" name="category" maxlength="40" list="cat-list" value="${esc(item?.category || '')}" placeholder="${esc(w.ex[2])}" />
            <datalist id="cat-list">${cats.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist></label>
          <label class="field"><span>Show to customers</span><label class="switch" style="margin-top:8px"><input type="checkbox" name="active" ${item?.active === false ? '' : 'checked'} /><span class="track"></span>Visible to the bot and AI</label></label>
          ${itemFieldsOf(layout).map((fd) => fd.type === 'map' ? mapFieldHtml(fd, item) : `<label class="field"><span>${esc(fd.label)} <span class="muted">(optional)</span></span>${fd.type === 'select'
            ? `<select name="d_${fd.key}"><option value="">—</option>${fd.options.map((o) => `<option ${item?.details?.[fd.key] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
            : fd.type === 'map' ? `<input class="input" name="d_${fd.key}" maxlength="500" inputmode="url" value="${esc(item?.details?.[fd.key] || '')}" placeholder="${esc(fd.placeholder || '')}" /><span class="hint">In Google Maps: open the site → Share → Copy link. Customers get it in the photo caption, and the flow's location step sends this pin.</span>`
            : `<input class="input" name="d_${fd.key}" maxlength="80" ${fd.key === 'pincode' ? 'inputmode="numeric" pattern="\\d{6}"' : ''} value="${esc(item?.details?.[fd.key] || '')}" placeholder="${esc(fd.placeholder || '')}" />`}</label>`).join('')}
          <label class="field span-2"><span>Description <span class="muted">(optional)</span></span><textarea name="description" rows="3" maxlength="500" placeholder="${esc(w.ex[3])}">${esc(item?.description || '')}</textarea><span class="hint">Sent in the photo caption with the name, price and details above. The AI uses all of it to answer questions.</span></label>
          <label class="field span-2"><span>Description in Telugu <span class="muted">(optional — filled in automatically)</span></span><textarea name="d_te_description" rows="3" maxlength="700" placeholder="Telugu customers see this. Leave empty and it is translated for you within a few minutes.">${esc(item?.details?.te_description || '')}</textarea></label>
        </div><p class="form-error" id="item-error"></p></div>
      <div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${icon('check')}${isNew ? 'Add' : 'Save'}</button></div></form>`, {
      wide: true,
      onMount: (root, close) => {
        const show = (src) => { $('#item-preview', root).innerHTML = `<img src="${esc(src)}" alt="" />`; };
        if ($('#item-map', root)) setupMapPicker(root, item);
        wireDropzone($('#item-drop', root), $('#item-file', root), async (f) => {
          if (!f) return;
          $('#item-error', root).textContent = '';
          try { photo = await prepareImage(f); removePhoto = false; show(URL.createObjectURL(photo)); }
          catch (err) { $('#item-error', root).textContent = err.message; }
        });
        $('#item-photo-remove', root)?.addEventListener('click', (e) => { removePhoto = true; photo = null; e.target.closest('button').remove(); $('#item-preview', root).innerHTML = `<span class="section-icon">${icon('upload', 'lg')}</span><strong>Add a photo</strong>`; });
        $('#item-form', root).addEventListener('submit', async (e) => {
          e.preventDefault(); const f = e.target; const btn = $('button[type=submit]', f); btn.disabled = true;
          const fd = new FormData();
          for (const k of ['name', 'price', 'category', 'description']) fd.append(k, f[k].value);
          const teDesc = f.d_te_description?.value.trim() || '';
          fd.append('details', JSON.stringify({ ...Object.fromEntries(itemFieldsOf(layout).map((x) => [x.key, f[`d_${x.key}`]?.value || ''])),
            ...(teDesc ? { te_description: teDesc, te_src: teDesc === (item?.details?.te_description || '') ? (item?.details?.te_src ?? f.description.value.trim()) : f.description.value.trim() } : {}) }));
          fd.append('active', f.active.checked ? 'true' : 'false');
          if (isNew) fd.append('layout', savedLayout());
          if (photo) fd.append('image', photo);
          if (removePhoto) fd.append('removeImage', 'true');
          try {
            const res = await authFetch(`${API}/catalog/${state.tenantId}${isNew ? '' : `/${item._id}`}`, { method: isNew ? 'POST' : 'PATCH', body: fd });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error((data.errors || [data.error || 'Save failed']).join(' · '));
            close(); await reloadCatalog(); renderCatalog();
            toast(isNew ? `${data.data.name} added` : 'Saved', photo ? 'Photo uploaded.' : ''); log(`${isNew ? 'Added' : 'Updated'} ${data.data.name}.`, 'success');
          } catch (err) { $('#item-error', root).textContent = err.message; btn.disabled = false; }
        });
      },
    });
  }

  // ============================================================
  // AI Assistant
  // ============================================================
  function renderAi() {
    if (!state.aiDraft) state.aiDraft = { draft: clone(state.tenant.ai || {}), dirty: false };
    const a = state.aiDraft.draft; const p = state.tenant.profile || {};
    useLayout(savedLayout()); // the AI uses the live layout's products
    const act = state.catalog.filter((x) => x.active);
    const knows = [['About', p.about], ['Services & prices', p.services], [catalogWords().title, act.length ? `${act.length} items, ${act.filter((x) => x.imageUrl).length} with photos — the AI can send these photos` : ''], ['Opening hours', p.hours], ['Address', p.address], ['FAQ', (p.faq || []).length ? `${p.faq.length} questions` : '']];
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>AI Assistant</h1><p>Answers customers' typed questions on WhatsApp using only your Business Profile, then guides them back into your flow.</p></div><span class="spacer"></span>
        <label class="switch"><input type="checkbox" id="ai-enabled" ${a.enabled ? 'checked' : ''} /><span class="track"></span>${a.enabled ? 'On' : 'Off'}</label></div>
      <div class="overview-grid">
        <div class="stack">
          <form class="card" id="ai-form"><div class="card-head"><span class="section-icon" style="background:#fce7f3;color:#db2777">${icon('sparkle')}</span><div><h2>How it behaves</h2><p>Powered by Cloudflare Workers AI</p></div></div>
            <div class="card-body stack">
              <label class="field"><span>Tone</span><input class="input" name="tone" maxlength="200" value="${esc(a.tone || 'Friendly, polite and concise')}" /><span class="hint">e.g. "Warm and professional", "Short and casual, use emojis".</span></label>
              <label class="field"><span>Extra instructions <span class="muted">(optional)</span></span><textarea name="instructions" rows="4" maxlength="2000" placeholder="e.g. Always mention our free parking. Never discuss discounts — hand over to the team instead.">${esc(a.instructions || '')}</textarea></label>
              <div class="grid-2"><label class="field"><span>Max AI replies per day</span><input class="input" name="dailyLimit" type="number" min="0" max="20000" value="${esc(a.dailyLimit ?? 300)}" /><span class="hint">Controls cost. After this the bot uses its normal replies.</span></label>
                <label class="field"><span>After the flow is finished</span><label class="switch" style="margin-top:8px"><input type="checkbox" name="answerAfterFlow" ${a.answerAfterFlow !== false ? 'checked' : ''} /><span class="track"></span>Keep answering questions</label></label></div>
              <label class="field"><span>Language your customers speak in voice notes</span>
                <select name="voiceLanguage">${[['te', 'Telugu'], ['ta', 'Tamil'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['bn', 'Bengali'], ['pa', 'Punjabi'], ['or', 'Odia'], ['ur', 'Urdu'], ['hi', 'Hindi only'], ['en', 'English only'], ['auto', 'Detect automatically']].map(([v, l]) => `<option value="${v}" ${(a.voiceLanguage || 'te') === v ? 'selected' : ''}>${l}${v.length === 2 && !['hi', 'en'].includes(v) ? ' (plus English & Hindi)' : ''}</option>`).join('')}</select>
                <span class="hint">Voice notes are written down in this language. Indian languages sound alike to the speech engine, so this stops Telugu being written as Tamil or Gujarati.</span></label>
              <div class="field"><span>When the AI answers</span>
                <div class="seg" role="radiogroup" style="display:flex;gap:16px;margin-top:6px">
                  <label class="row" style="gap:6px"><input type="radio" name="schedule" value="always" ${a.schedule !== 'hours' ? 'checked' : ''} />24/7 (always)</label>
                  <label class="row" style="gap:6px"><input type="radio" name="schedule" value="hours" ${a.schedule === 'hours' ? 'checked' : ''} />Only at set hours</label></div>
                <div id="ai-hours" class="stack" style="margin-top:10px;gap:10px" ${a.schedule === 'hours' ? '' : 'hidden'}>
                  <div class="grid-2"><label class="field"><span>From</span><input class="input" type="time" name="hoursFrom" value="${esc(a.hoursFrom || '09:00')}" /></label>
                    <label class="field"><span>To</span><input class="input" type="time" name="hoursTo" value="${esc(a.hoursTo || '21:00')}" /></label></div>
                  <div class="ai-days">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<label><input type="checkbox" name="days" value="${i}" ${(a.days || [0, 1, 2, 3, 4, 5, 6]).includes(i) ? 'checked' : ''} />${d}</label>`).join('')}</div>
                  <span class="hint">Business time (IST). Outside these hours the bot still runs your flow and buttons, only the AI is off. "To" earlier than "From" means overnight, e.g. 21:00 to 09:00.</span></div></div>
              <div class="banner blue">${icon('info')}<div>The AI never invents prices or details. If something isn't in your profile, or the customer asks for a person, it hands over: the bot pauses for that chat and your team gets a WhatsApp alert.</div></div>
              <div id="ai-errors"></div>
              <div class="row"><span class="spacer"></span><button class="btn primary" type="submit">${icon('check')}Save</button></div></div></form>
        </div>
        <div class="stack">
          <div class="card"><div class="card-head"><span class="section-icon indigo">${icon('book')}</span><div><h2>What the AI knows</h2><p>From your <a href="#/profile">Business Profile</a></p></div></div>
            <div class="list-rows">${knows.map(([k, v]) => `<div class="list-row"><span class="section-icon ${v ? '' : 'amber'}" style="width:28px;height:28px">${icon(v ? 'check' : 'alert', 'sm')}</span><div class="grow"><div class="title">${k}</div><div class="sub">${v ? esc(String(v).slice(0, 80)) : 'Not filled in yet'}</div></div></div>`).join('')}</div></div>
          <div class="card"><div class="card-head"><span class="section-icon blue">${icon('chat')}</span><div><h2>Try it</h2><p>Ask what a customer might ask — nothing is sent</p></div></div>
            <div class="card-body ai-test"><div class="row"><input class="input" id="ai-q" placeholder="e.g. What are your timings on Sunday?" maxlength="500" /><button class="btn primary" id="ai-try">${icon('send')}Ask</button></div>
              <div id="ai-a"></div></div></div>
        </div></div></div>`;
    const form = $('#ai-form');
    const readForm = () => ({ enabled: $('#ai-enabled').checked, tone: form.tone.value, instructions: form.instructions.value, dailyLimit: Number(form.dailyLimit.value), answerAfterFlow: form.answerAfterFlow.checked, voiceLanguage: form.voiceLanguage.value, schedule: form.querySelector('[name=schedule]:checked')?.value || 'always', hoursFrom: form.hoursFrom.value, hoursTo: form.hoursTo.value, days: [...form.querySelectorAll('[name=days]:checked')].map((x) => Number(x.value)) });
    form.addEventListener('input', () => { state.aiDraft.draft = readForm(); state.aiDraft.dirty = true; });
    form.addEventListener('change', (e) => { if (e.target.name === 'schedule') $('#ai-hours').hidden = e.target.value !== 'hours'; });
    const save = async (okMsg) => {
      try {
        const res = await api('PATCH', `/tenants/${state.tenantId}`, { ai: readForm() });
        applyTenantPayload(res); state.aiDraft = null; renderAi(); hydrateIcons($('#page'));
        toast(okMsg); log(okMsg, 'success');
      } catch (err) { $('#ai-errors').innerHTML = errorList(err); }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); save('AI settings saved'); });
    $('#ai-enabled').addEventListener('change', (e) => save(e.target.checked ? 'AI assistant is on' : 'AI assistant is off'));
    const ask = async () => {
      const q = $('#ai-q').value.trim(); if (!q) return;
      const btn = $('#ai-try'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      $('#ai-a').innerHTML = `<div class="ai-answer">${messageHtml({ _id: 'q', direction: 'in', sentBy: 'customer', type: 'text', text: q, createdAt: new Date().toISOString() }, null)}</div>`;
      try {
        const { data } = await api('POST', `/tenants/${state.tenantId}/ai-test`, { message: q, ai: readForm() });
        const now = new Date().toISOString();
        const items = data.items || []; const cap = (it) => `*${it.name}*${it.price ? ` — ${it.price}` : ''}${it.description ? `\n${it.description}` : ''}`;
        const m = (o) => messageHtml({ _id: Math.random(), direction: 'out', sentBy: 'ai', status: 'read', createdAt: now, ...o }, null);
        $('#ai-a .ai-answer').insertAdjacentHTML('beforeend', (items.length === 1
          ? m(items[0].imageUrl ? { type: 'image', text: `${data.reply}\n\n${cap(items[0])}`, meta: { link: items[0].imageUrl } } : { type: 'text', text: `${data.reply}\n\n${cap(items[0])}` })
          : items.length > 1 ? m({ type: 'list', text: data.reply, meta: { button: 'View photos', rows: items.map((it) => ({ title: it.name, description: [it.price, it.description].filter(Boolean).join(' · ') })) } })
          : m({ type: 'text', text: data.reply }))
          + (data.action === 'handoff' ? `<div class="step-label">Would hand over to your team</div>` : ''));
      } catch (err) { $('#ai-a').innerHTML = `<div class="banner red">${icon('alert')}<div>${esc(err.message)}</div></div>`; }
      finally { btn.disabled = false; btn.innerHTML = `${icon('send')}Ask`; }
    };
    $('#ai-try').addEventListener('click', ask);
    $('#ai-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } });
  }

  // ============================================================
  // Business Profile
  // ============================================================
  function renderProfile() {
    if (!state.profileDraft) state.profileDraft = { draft: clone(state.tenant.profile || {}), dirty: false };
    const p = state.profileDraft.draft; p.faq = p.faq || [];
    const mapSrc = (lat, lng) => `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&z=15&output=embed`;
    const f = (k, label, max, hint = '', type = 'text') => `<label class="field"><span>${label}</span><input class="input" data-k="${k}" type="${type}" maxlength="${max}" value="${esc(p[k] ?? '')}" />${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
    const ta = (k, label, max, rows, hint = '', ph = '') => `<label class="field"><span>${label}</span><textarea data-k="${k}" rows="${rows}" maxlength="${max}" placeholder="${esc(ph)}">${esc(p[k] ?? '')}</textarea>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Business Profile</h1><p>What customers see and what the AI assistant knows about you.</p></div></div>
      <div class="overview-grid" id="profile-form">
        <div class="stack">
          <div class="card"><div class="card-head"><span class="section-icon">${icon('building')}</span><div><h2>About your business</h2><p>Use simple, factual sentences — the AI answers from these</p></div></div>
            <div class="card-body stack">
              ${f('displayName', 'Name shown to customers', 120, 'Used as {business} in messages.')}
              ${ta('about', 'About', 2000, 3, '', 'e.g. Family dental clinic since 2009 with 4 specialists.')}
              ${ta('services', 'Services, products & prices', 4000, 6, 'One per line works best.', 'Dental cleaning – ₹1,200\nRoot canal – from ₹6,000\nConsultation – ₹500')}
              ${f('hours', 'Opening hours', 600, '', 'text')}
              <div class="grid-2">${f('contactPhone', 'Contact number', 20)}${f('website', 'Website', 200)}</div></div></div>
          <div class="card"><div class="card-head"><span class="section-icon blue">${icon('question')}</span><div><h2>Frequently asked questions</h2><p>The AI uses these word for word</p></div><span class="spacer"></span><button type="button" class="btn sm" id="faq-add">${icon('plus', 'sm')}Add</button></div>
            <div class="card-body stack" id="faq-rows"></div></div>
        </div>
        <div class="stack">
          <div class="card"><div class="card-head"><span class="section-icon amber">${icon('pin')}</span><div><h2>Location</h2><p>Sent as a map pin by "Send → Location" steps</p></div></div>
            <div class="card-body stack">
              ${ta('address', 'Address', 300, 2)}
              <label class="field"><span>Paste a Google Maps link <span class="muted">(optional)</span></span><input class="input" id="maps-link" placeholder="https://maps.google.com/…@17.4435,78.3772…" /></label>
              <div class="grid-2">${f('latitude', 'Latitude', 20, '', 'number')}${f('longitude', 'Longitude', 20, '', 'number')}</div>
              ${p.latitude != null && p.latitude !== '' ? `<iframe class="map-frame" id="map" title="Location" loading="lazy" referrerpolicy="no-referrer" src="${mapSrc(p.latitude, p.longitude)}"></iframe>` : '<div class="banner">' + icon('info') + '<div>No location yet — location steps are skipped until you add one.</div></div>'}</div></div>
          <div class="card"><div class="card-head"><span class="section-icon red">${icon('file')}</span><div><h2>Document</h2><p>Brochure, menu, catalogue or price list (PDF, up to 20 MB)</p></div></div>
            <div class="card-body stack" id="doc-box"></div></div>
        </div>
      </div>
      <div id="profile-errors"></div>
      <div class="save-bar" id="p-save-bar" ${state.profileDraft.dirty ? '' : 'hidden'}><span>${icon('info')}</span><strong>You have unsaved changes</strong><span class="spacer"></span>
        <button class="btn ghost" id="p-discard">Discard</button><button class="btn primary" id="p-save">${icon('check')}Save profile</button></div></div>`;
    const dirty = () => { state.profileDraft.dirty = true; $('#p-save-bar').hidden = false; };
    const renderFaq = () => {
      $('#faq-rows').innerHTML = p.faq.length ? p.faq.map((x, i) => `<div class="faq-row">
        <label class="field"><span>Question</span><input class="input" data-faq="${i}.q" maxlength="200" value="${esc(x.q)}" /></label>
        <label class="field"><span>Answer</span><textarea data-faq="${i}.a" rows="2" maxlength="1000">${esc(x.a)}</textarea></label>
        <button type="button" class="btn icon sm ghost danger" data-faq-del="${i}" aria-label="Remove" style="margin-top:24px">${icon('trash', 'sm')}</button></div>`).join('') : '<p class="muted small">No questions yet. Add the ones customers ask most.</p>';
    };
    renderFaq();
    const root = $('#profile-form');
    root.addEventListener('input', (e) => {
      const k = e.target.dataset.k; const fq = e.target.dataset.faq;
      if (k) { p[k] = e.target.value; dirty(); }
      if (fq) { const [i, key] = fq.split('.'); p.faq[i][key] = e.target.value; dirty(); }
    });
    root.addEventListener('click', (e) => {
      const del = e.target.closest('[data-faq-del]');
      if (del) { p.faq.splice(Number(del.dataset.faqDel), 1); renderFaq(); dirty(); }
    });
    $('#faq-add').addEventListener('click', () => { if (p.faq.length >= 40) return toast('Up to 40 questions', '', { kind: 'warn' }); p.faq.push({ q: '', a: '' }); renderFaq(); dirty(); $$('[data-faq]').at(-2)?.focus(); });
    $('#maps-link').addEventListener('input', (e) => {
      const v = e.target.value;
      const m = v.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || v.match(/[?&](?:q|ll|query)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || v.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
      if (m) { p.latitude = m[1]; p.longitude = m[2]; $('[data-k="latitude"]').value = m[1]; $('[data-k="longitude"]').value = m[2]; dirty(); toast('Coordinates found', `${m[1]}, ${m[2]}`, { kind: 'info' }); }
    });
    $('#p-discard').addEventListener('click', () => { state.profileDraft = null; renderProfile(); hydrateIcons($('#page')); });
    $('#p-save').addEventListener('click', async () => {
      const btn = $('#p-save'); btn.disabled = true;
      try {
        const res = await api('PATCH', `/tenants/${state.tenantId}`, { profile: p });
        applyTenantPayload(res); state.profileDraft = null; renderProfile(); hydrateIcons($('#page'));
        toast('Profile saved', 'The bot and AI use the new details right away.'); log('Business Profile saved.', 'success');
      } catch (err) { $('#profile-errors').innerHTML = errorList(err); btn.disabled = false; }
    });
    renderDoc();
  }
  function renderDoc() {
    const p = state.tenant.profile || {}; const box = $('#doc-box'); if (!box) return;
    const name = p.documentUrl ? decodeURIComponent(p.documentUrl.split('/').pop().replace(/^\d+_/, '')) : '';
    box.innerHTML = `${p.documentUrl ? `<div class="brochure-card"><span class="file-ico">PDF</span><div class="grow" style="min-width:0"><strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</strong><span class="hint">Sent by "Send → PDF" steps</span></div>
        <a class="btn sm" href="${esc(p.documentUrl)}" target="_blank" rel="noopener">${icon('external', 'sm')}Open</a><button class="btn sm danger" id="doc-remove" aria-label="Remove document">${icon('trash', 'sm')}</button></div>`
      : `<div class="banner">${icon('info')}<div>No document yet — PDF steps are skipped until you upload one.</div></div>`}
      <label class="field"><span>File name customers see</span><input class="input" id="doc-name" maxlength="60" value="${esc(p.documentName || '')}" placeholder="${esc(bizName())} Brochure" /><span class="hint">".pdf" is added automatically. Saved with the profile.</span></label>
      <label class="dropzone" id="pdf-drop"><input type="file" id="pdf-file" accept="application/pdf,.pdf" /><span class="section-icon red">${icon('upload', 'lg')}</span>
        <strong>${p.documentUrl ? 'Replace PDF' : 'Upload PDF'}</strong><span class="hint">Drop a PDF here or click to choose</span></label>
      <div id="pdf-progress"></div>`;
    $('#doc-name').addEventListener('input', (e) => { state.profileDraft.draft.documentName = e.target.value; state.profileDraft.dirty = true; $('#p-save-bar').hidden = false; });
    wireDropzone($('#pdf-drop'), $('#pdf-file'), async (file) => {
      if (!file) return;
      if (!/\.pdf$/i.test(file.name)) return toast('Please choose a PDF', '', { kind: 'warn' });
      $('#pdf-progress').innerHTML = `<div class="banner blue"><span class="spinner"></span><div>Uploading ${esc(file.name)}…</div></div>`;
      try {
        const res = await uploadFile(`/uploads/document/${state.tenantId}`, file);
        state.tenant = res.tenant; state.profileDraft.draft.documentUrl = res.data.documentUrl;
        toast('PDF uploaded', 'Customers get this file from now on.'); log('Document uploaded.', 'success');
        renderDoc();
      } catch (err) { $('#pdf-progress').innerHTML = `<div class="banner red">${icon('alert')}<div>${esc(err.message)}</div></div>`; }
    });
    $('#doc-remove')?.addEventListener('click', async () => {
      if (!confirm('Stop sending this PDF to customers?')) return;
      try {
        const res = await api('PATCH', `/tenants/${state.tenantId}`, { profile: { ...state.profileDraft.draft, documentUrl: null } });
        applyTenantPayload(res); state.profileDraft.draft.documentUrl = null; renderDoc(); toast('Document removed');
      } catch (err) { toast('Could not remove', err.message, { kind: 'error' }); }
    });
  }

  // ============================================================
  // Settings
  // ============================================================
  function renderSettings() {
    const t = state.tenant; const tp = t.templates || {};
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Settings</h1><p>Account details, team alerts and WhatsApp templates.</p></div></div>
      <div class="overview-grid">
        <div class="stack">
          <form class="card" id="biz-form"><div class="card-head"><span class="section-icon">${icon('building')}</span><div><h2>Account</h2><p>Your business account on Agent Desk</p></div></div>
            <div class="card-body stack">
              <label class="field"><span>Business name</span><input class="input" name="businessName" required maxlength="120" value="${esc(t.businessName)}" /></label>
              <label class="field"><span>Team alert number</span><input class="input" name="adminNotificationPhone" required value="${esc(t.adminNotificationPhone)}" inputmode="tel" />
                <span class="hint">Gets a WhatsApp alert when a flow finishes and when a customer needs a person. Include the country code.</span></label>
              <div class="row"><span class="spacer"></span><button class="btn primary" type="submit">${icon('check')}Save</button></div></div></form>
          <form class="card" id="tpl-form"><div class="card-head"><span class="section-icon indigo">${icon('template')}</span><div><h2>WhatsApp templates</h2><p>Names approved in your Meta Business account</p></div></div>
            <div class="card-body stack">
              <div class="grid-2"><label class="field"><span>Broadcast template</span><input class="input" name="broadcastName" placeholder="my_offer_v1" value="${esc(tp.broadcastName || '')}" /></label>
                <label class="field"><span>Language</span><input class="input" name="broadcastLanguage" placeholder="en" value="${esc(tp.broadcastLanguage || '')}" /></label></div>
              <label class="switch"><input type="checkbox" name="broadcastHasParams" ${tp.broadcastHasParams === false ? '' : 'checked'} /><span class="track"></span>Template uses {{1}} customer name and {{2}} business name</label>
              <div class="grid-2"><label class="field"><span>Team alert template</span><input class="input" name="adminAlertName" placeholder="admin_lead_alert" value="${esc(tp.adminAlertName || '')}" /></label>
                <label class="field"><span>Language</span><input class="input" name="adminAlertLanguage" placeholder="en" value="${esc(tp.adminAlertLanguage || '')}" /></label></div>
              <div class="banner blue">${icon('info')}<div>Without an alert template, alerts are plain messages that WhatsApp only delivers if your alert number messaged the business number in the last 24 hours. Alert template variables: {{1}} headline, {{2}} name, {{3}} phone, {{4}} details.</div></div>
              <div class="row"><span class="spacer"></span><button class="btn primary" type="submit">${icon('check')}Save templates</button></div></div></form>
        </div>
        <div class="stack">
          <div class="card card-pad stack"><div class="row"><span class="section-icon blue">${icon('phone')}</span><h2>WhatsApp account</h2></div>
            <dl class="kv"><dt>Phone ID</dt><dd><code>${esc(t.phoneNumberId)}</code></dd><dt>WABA ID</dt><dd><code>${esc(t.wabaId || '—')}</code></dd><dt>Tier</dt><dd>Tier ${t.tier ?? 0}</dd><dt>Status</dt><dd>${t.isActive ? '<span class="pill d-READ">Active</span>' : '<span class="pill d-FAILED">Paused</span>'}</dd></dl>
            ${isAdmin() ? '' : '<span class="hint">Ask your administrator to change these.</span>'}</div>
          ${isAdmin() ? `<form class="card" id="admin-form"><div class="card-head"><span class="section-icon red">${icon('key')}</span><div><h2>Admin controls</h2><p>Only visible to administrators</p></div></div>
            <div class="card-body stack">
              <div class="grid-2"><label class="field"><span>Tier</span><select name="tier">${[0, 1, 2, 3].map((n) => `<option value="${n}" ${Number(t.tier) === n ? 'selected' : ''}>Tier ${n}</option>`).join('')}</select></label>
                <label class="field"><span>WABA ID</span><input class="input" name="wabaId" value="${esc(t.wabaId || '')}" /></label></div>
              <label class="field"><span>Phone number ID</span><input class="input" name="phoneNumberId" value="${esc(t.phoneNumberId)}" /><span class="hint">Change this when moving from Meta's test number to your real business number.</span></label>
              <label class="field"><span>New access token</span><input class="input" name="accessToken" type="password" autocomplete="off" placeholder="Leave empty to keep the current token" /></label>
              <label class="switch"><input type="checkbox" name="isActive" ${t.isActive ? 'checked' : ''} /><span class="track"></span>Account active</label>
              <div class="row"><button class="btn danger" type="button" id="rotate-key">${icon('key')}New API key</button><span class="spacer"></span><button class="btn primary" type="submit">${icon('check')}Save</button></div></div></form>` : ''}
        </div></div></div>`;
    const save = async (form, body, okMsg) => {
      const btn = $('button[type=submit]', form); btn.disabled = true;
      try { applyTenantPayload(await api('PATCH', `/tenants/${state.tenantId}`, body)); toast(okMsg); log(okMsg, 'success'); return true; }
      catch (err) { toast('Could not save', err.message, { kind: 'error', timeout: 7000 }); return false; } finally { btn.disabled = false; }
    };
    $('#biz-form').addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; save(f, { businessName: f.businessName.value, adminNotificationPhone: f.adminNotificationPhone.value }, 'Account saved'); });
    $('#tpl-form').addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; save(f, { templates: { broadcastName: f.broadcastName.value, broadcastLanguage: f.broadcastLanguage.value, broadcastHasParams: f.broadcastHasParams.checked, adminAlertName: f.adminAlertName.value, adminAlertLanguage: f.adminAlertLanguage.value } }, 'Templates saved'); });
    if (isAdmin()) {
      $('#admin-form').addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target;
        const body = { tier: Number(f.tier.value), wabaId: f.wabaId.value, isActive: f.isActive.checked, phoneNumberId: f.phoneNumberId.value.trim() };
        if (f.accessToken.value.trim()) body.accessToken = f.accessToken.value.trim();
        if (await save(f, body, 'Account settings saved')) f.accessToken.value = '';
      });
      $('#rotate-key').addEventListener('click', () => rotateKey(state.tenant));
    }
  }
  async function rotateKey(t) {
    if (!confirm(`Create a new API key for ${t.businessName}? Their current key stops working immediately.`)) return;
    try { const { apiKey } = await api('POST', `/tenants/${t._id}/rotate-key`); showKey(`New key for ${t.businessName}`, apiKey); log(`API key rotated for ${t.businessName}.`, 'warn'); }
    catch (err) { toast('Could not rotate key', err.message, { kind: 'error' }); }
  }
  function showKey(title, key) {
    modal(`<div class="card-head"><span class="section-icon">${icon('key')}</span><div><h2>${esc(title)}</h2><p>Copy it now — it will not be shown again.</p></div></div>
      <div class="card-body stack"><div class="key-reveal"><code>${esc(key)}</code><button class="btn sm" id="copy-key">${icon('copy', 'sm')}Copy</button></div>
      <span class="hint">Share it privately with the business. They sign in to this dashboard with it.</span></div>
      <div class="modal-foot"><button class="btn primary" data-close>Done</button></div>`, {
      onMount: (root) => $('#copy-key', root).addEventListener('click', async () => { try { await navigator.clipboard.writeText(key); toast('Key copied'); } catch { toast('Copy failed — select the key and copy it manually', '', { kind: 'warn' }); } }),
    });
  }

  // ============================================================
  // Businesses (admin)
  // ============================================================
  async function renderClients() {
    if (!state.templates.length) { try { state.templates = (await api('GET', '/templates')).data; } catch { /* */ } }
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Businesses</h1><p>Every business connected to Bluxury WhatsApp AI.</p></div><span class="spacer"></span><button class="btn primary" id="new-client">${icon('plus')}New business</button></div>
      <div class="clients" id="client-list"></div></div>`;
    const list = $('#client-list');
    const tplName = (k) => state.templates.find((t) => t.key === k)?.name || k;
    list.innerHTML = state.tenants.length ? state.tenants.map((t) => `
      <div class="card client">
        <div class="row">${avatar(t.businessName, t._id)}<div style="min-width:0"><strong>${esc(t.businessName)}</strong><div class="muted small">${esc(tplName(t.industry))}</div></div><span class="spacer"></span>${t.isActive ? '<span class="pill d-READ">Active</span>' : '<span class="pill d-FAILED">Paused</span>'}</div>
        <dl class="kv"><dt>Phone ID</dt><dd><code>${esc(t.phoneNumberId)}</code></dd><dt>Tier</dt><dd>${t.tier ?? 0}</dd><dt>AI</dt><dd>${t.ai?.enabled ? 'On' : '<span class="muted">Off</span>'}</dd><dt>Steps</dt><dd>${(t.flow?.steps || []).length}</dd></dl>
        <div class="row"><button class="btn sm" data-open="${t._id}">${icon('grid', 'sm')}Open dashboard</button><span class="spacer"></span><button class="btn sm ghost" data-rotate="${t._id}">${icon('key', 'sm')}New key</button></div>
      </div>`).join('') : `<div class="card" style="grid-column:1/-1"><div class="empty"><span class="section-icon">${icon('building', 'lg')}</span><h3>No businesses yet</h3><p>Add your first business to start.</p></div></div>`;
    $$('[data-open]', list).forEach((b) => b.addEventListener('click', async () => { await selectTenant(b.dataset.open, { silent: true }); location.hash = '#/overview'; }));
    $$('[data-rotate]', list).forEach((b) => b.addEventListener('click', () => rotateKey(state.tenants.find((t) => t._id === b.dataset.rotate))));
    $('#new-client').addEventListener('click', newClientModal);
    hydrateIcons($('#page'));
  }
  function newClientModal() {
    modal(`<form id="client-form"><div class="card-head"><span class="section-icon">${icon('plus')}</span><div><h2>New business</h2><p>Connect a WhatsApp Business number</p></div><span class="spacer"></span><button type="button" class="btn icon ghost" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="card-body stack">
        <div class="field"><span>Industry</span><span class="hint">Starts with a ready-made flow you can edit.</span></div>
        <div class="templates-grid" id="ind-grid">${state.templates.map((t, i) => `<button type="button" class="tpl-card ${i === state.templates.length - 1 ? 'active' : ''}" data-ind="${t.key}"><span class="row">${icon(t.icon)}<strong>${esc(t.name)}</strong></span><small>${esc(t.description)}</small></button>`).join('')}</div>
        <div class="grid-2">
          <label class="field"><span>Business name</span><input class="input" name="businessName" required /></label>
          <label class="field"><span>Name shown to customers</span><input class="input" name="displayName" placeholder="Same as business name" /></label>
          <label class="field"><span>Phone number ID</span><input class="input" name="phoneNumberId" required inputmode="numeric" /></label>
          <label class="field"><span>WABA ID</span><input class="input" name="wabaId" /></label>
          <label class="field span-2"><span>Access token</span><input class="input" name="accessToken" type="password" autocomplete="off" required placeholder="EAA…" /><span class="hint">Stored encrypted.</span></label>
          <label class="field"><span>Team alert number</span><input class="input" name="adminNotificationPhone" required placeholder="919876543210" /></label>
          <label class="field"><span>Tier</span><select name="tier">${[0, 1, 2, 3].map((n) => `<option value="${n}">Tier ${n}</option>`).join('')}</select></label>
          <label class="field span-2"><span>Address <span class="muted">(optional)</span></span><input class="input" name="address" /></label>
        </div><p class="form-error" id="client-error"></p></div>
      <div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${icon('check')}Create business</button></div></form>`, {
      wide: true,
      onMount: (root, close) => {
        let industry = state.templates[state.templates.length - 1]?.key || 'general';
        $$('[data-ind]', root).forEach((b) => b.addEventListener('click', () => { industry = b.dataset.ind; $$('[data-ind]', root).forEach((x) => x.classList.toggle('active', x === b)); }));
        $('#client-form', root).addEventListener('submit', async (e) => {
          e.preventDefault(); const f = e.target; const btn = $('button[type=submit]', f);
          btn.disabled = true; $('#client-error', root).textContent = '';
          try {
            const res = await api('POST', '/tenants', {
              businessName: f.businessName.value, displayName: f.displayName.value || f.businessName.value, industry, phoneNumberId: f.phoneNumberId.value.trim(), wabaId: f.wabaId.value,
              accessToken: f.accessToken.value, adminNotificationPhone: f.adminNotificationPhone.value, tier: Number(f.tier.value), address: f.address.value,
            });
            close(); log(`Business ${res.tenant.businessName} created.`, 'success');
            await loadTenants(); await selectTenant(res.tenant._id, { silent: true }); renderNav(); route();
            showKey(`API key for ${res.tenant.businessName}`, res.apiKey);
          } catch (err) { $('#client-error', root).textContent = (err.data?.errors || [err.message]).join(' · '); btn.disabled = false; }
        });
      },
    });
  }

  // ============================================================
  // Activity log
  // ============================================================
  // ============================================================
  // Team & security: one key per person, roles, 2-step sign-in, who did what
  // ============================================================
  const teamState = { scope: null };
  async function renderTeam() {
    const scope = teamState.scope || (isAdmin() && !state.tenantId ? 'admin' : state.tenantId);
    teamState.scope = scope;
    $('#page').innerHTML = `<div class="page-inner"><div class="page-head"><div><h1>Team & security</h1><p>One key per person, 2-step sign-in, and a record of who did what.</p></div></div>
      <div id="team-body"><div class="skeleton" style="height:200px"></div></div></div>`;
    let d;
    try { d = await api('GET', `/team/${scope}`); }
    catch (x) { $('#team-body').innerHTML = `<div class="banner amber">${icon('info')}<div>${esc(x.message)}</div></div>`; return; }
    const me = d.me || state.auth;
    const when = (t) => (t ? new Date(t).toLocaleString() : '—');
    const people = d.members.filter((m) => !m.revokedAt);
    $('#team-body').innerHTML = `
      ${isAdmin() ? `<div class="row wrap" style="gap:8px;margin-bottom:12px"><span class="muted small">Team of</span>
        <select id="team-scope" style="width:auto">${state.tenantId ? `<option value="${esc(state.tenantId)}" ${scope === state.tenantId ? 'selected' : ''}>${esc(bizName())}</option>` : ''}<option value="admin" ${scope === 'admin' ? 'selected' : ''}>Bluxury staff (all businesses)</option></select></div>` : ''}
      <div class="overview-grid"><div class="stack">
        <div class="card"><div class="card-head"><span class="section-icon">${icon('users')}</span><div><h2>People</h2><p>Each person signs in with their own key. Removing someone signs them out everywhere at once.</p></div></div>
          <div class="card-body stack">
            ${people.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>2-step</th><th>Last active</th><th></th></tr></thead><tbody>
              ${people.map((m) => `<tr><td data-label="Name"><strong>${esc(m.name)}</strong>${m.id === me.memberId ? ' <span class="pill plain">You</span>' : ''}</td><td data-label="Role">${m.role === 'agent' ? 'Agent' : 'Owner'}</td>
                <td data-label="2-step">${m.twoStep ? '<span class="pill d-READ">On</span>' : '<span class="pill plain">Off</span>'}</td><td data-label="Last active">${esc(when(m.lastUsedAt))}</td>
                <td>${m.id === me.memberId ? '' : `<button class="btn sm ghost danger" data-revoke="${esc(m.id)}">${icon('trash', 'sm')}Remove</button>`}</td></tr>`).join('')}
            </tbody></table></div>` : '<p class="muted">No personal keys yet — everyone uses the shared key. Add each person below.</p>'}
            <form id="team-add" class="row wrap" style="gap:8px;align-items:flex-end">
              <label class="field" style="flex:1;min-width:160px"><span>Name</span><input class="input" name="name" maxlength="60" required placeholder="e.g. Ravi (sales)" /></label>
              <label class="field" style="width:auto"><span>Role</span><select name="role" style="width:auto"><option value="agent">Agent — inbox, leads, bookings</option><option value="owner">Owner — everything</option></select></label>
              <button class="btn primary">${icon('plus', 'sm')}Add person</button></form>
            <div id="team-new-key"></div>
          </div></div>
        ${scope !== 'admin' ? `<div class="card"><div class="card-head"><span class="section-icon amber">${icon('key')}</span><div><h2>Shared business key</h2><p>${d.sharedKeyOn ? 'On — anyone with it can sign in. Turn it off once everyone has a personal key.' : 'Off — only personal keys work.'}</p></div></div>
          ${d.sharedKeyOn ? `<div class="card-body"><button class="btn danger" id="shared-off">${icon('key', 'sm')}Turn off the shared key</button><p class="hint">Needs at least one owner with a personal key. You can create a new shared key later in Settings.</p></div>` : ''}</div>` : ''}
      </div><div class="stack">
        <div class="card"><div class="card-head"><span class="section-icon green">${icon('shield')}</span><div><h2>Your 2-step sign-in</h2><p>A 6-digit code from an authenticator app (Google or Microsoft Authenticator) is needed to sign in, so a stolen key alone is useless.</p></div></div>
          <div class="card-body stack" id="twostep">${!me.memberId ? '<p class="muted">You are signed in with a shared key. Ask an owner to add you here, sign in with your personal key, then turn this on.</p>'
            : me.twoStep ? `<div class="banner green">${icon('check')}<div><strong>On</strong> for ${esc(me.memberName)}.</div></div><div class="row wrap" style="gap:8px"><input class="input" id="tfa-off-code" inputmode="numeric" maxlength="6" placeholder="Code to turn off" style="max-width:180px" /><button class="btn" id="tfa-off">Turn off</button></div>`
            : `<button class="btn primary" id="tfa-start">${icon('shield', 'sm')}Turn on 2-step sign-in</button>`}</div></div>
        <div class="card"><div class="card-head"><span class="section-icon">${icon('activity')}</span><div><h2>Who did what</h2><p>Sign-ins and every change, newest first.</p></div></div>
          <div class="card-body">${d.activity.length ? `<ul class="activity-list" style="list-style:none;margin:0;padding:0;display:grid;gap:8px">${d.activity.map((a) => `<li><strong>${esc(a.actor)}</strong> — ${esc(a.action)}${a.detail ? ` <span class="muted small">(${esc(a.detail)})</span>` : ''}<br><span class="muted small">${esc(when(a.at))}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing yet.</p>'}</div></div>
      </div></div>`;
    hydrateIcons($('#team-body'));
    $('#team-scope')?.addEventListener('change', (e) => { teamState.scope = e.target.value; renderTeam(); });
    $('#team-add').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.currentTarget;
      try {
        const { key, member } = await api('POST', `/team/${scope}`, { name: f.name.value.trim(), role: f.role.value });
        $('#team-new-key').innerHTML = `<div class="banner green">${icon('key')}<div><strong>Key for ${esc(member.name)} — copy it now, it is shown only once.</strong>
          <div class="row" style="gap:8px;margin-top:8px"><input class="input" readonly value="${esc(key)}" id="new-key" /><button class="btn" id="copy-key" type="button">${icon('copy', 'sm')}Copy</button></div>
          <span class="hint">Send it to them privately. They sign in with it and can then turn on 2-step sign-in.</span></div></div>`;
        hydrateIcons($('#team-new-key'));
        $('#copy-key').addEventListener('click', () => { navigator.clipboard?.writeText(key); toast('Key copied'); });
        f.reset();
      } catch (x) { toast('Could not add', x.message, { kind: 'error' }); }
    });
    $$('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this person? Their key stops working and they are signed out everywhere.')) return;
      try { await api('DELETE', `/team/${scope}/${b.dataset.revoke}`); toast('Removed'); renderTeam(); } catch (x) { toast('Could not remove', x.message, { kind: 'error' }); }
    }));
    $('#shared-off')?.addEventListener('click', async () => {
      if (!confirm('Turn off the shared key? Only personal keys will work. Anyone signed in with the shared key is signed out within 12 hours (or 30 days if they chose to stay signed in).')) return;
      try { await api('POST', `/tenants/${scope}/shared-key/off`); toast('Shared key turned off'); renderTeam(); } catch (x) { toast('Could not turn off', x.message, { kind: 'error' }); }
    });
    $('#tfa-start')?.addEventListener('click', async () => {
      try {
        const { secret, uri } = await api('POST', '/me/2fa/start');
        const box = $('#twostep');
        box.innerHTML = `<ol style="margin:0;padding-left:18px;display:grid;gap:6px"><li>Open <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong> on your phone.</li>
          <li>Scan this code, or add an account with the key <code style="word-break:break-all">${esc(secret)}</code> (on this phone: <a href="${esc(uri)}">open in the app</a>).</li><li>Type the 6-digit code it shows:</li></ol>
          <div id="tfa-qr" style="margin:6px 0"></div>
          <div class="row wrap" style="gap:8px"><input class="input" id="tfa-code" inputmode="numeric" maxlength="6" placeholder="123456" style="max-width:160px" /><button class="btn primary" id="tfa-confirm">Turn on</button></div>`;
        try {
          if (!window.qrcode) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
          const q = window.qrcode(0, 'M'); q.addData(uri); q.make(); $('#tfa-qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 2 });
        } catch { /* the key and link above still work */ }
        $('#tfa-confirm').addEventListener('click', async () => {
          try { await api('POST', '/me/2fa/confirm', { code: $('#tfa-code').value.trim() }); state.auth.twoStep = true; toast('2-step sign-in is on', 'Next time you sign in you will be asked for a code.'); renderTeam(); }
          catch (x) { toast('Not turned on', x.message, { kind: 'error' }); }
        });
      } catch (x) { toast('Could not start', x.message, { kind: 'error' }); }
    });
    $('#tfa-off')?.addEventListener('click', async () => {
      try { await api('POST', '/me/2fa/disable', { code: $('#tfa-off-code').value.trim() }); state.auth.twoStep = false; toast('2-step sign-in is off'); renderTeam(); }
      catch (x) { toast('Not turned off', x.message, { kind: 'error' }); }
    });
  }

  function renderActivity() {
    let logs = [];
    try { logs = JSON.parse(store.get(LOG_KEY)) || []; } catch { logs = []; }
    $('#page').innerHTML = `<div class="page-inner"><div class="page-head"><div><h1>Activity log</h1><p>What you did in this browser. Stored only on this device.</p></div><span class="spacer"></span><button class="btn" id="clear-logs">${icon('trash')}Clear</button></div>
      <div class="card"><div class="console" id="console">${logs.length ? logs.map((l) => `<div class="${esc(l.type)}"><span class="t">${esc(l.time)}</span>${esc(l.message)}</div>`).join('') : '<div class="debug">No activity yet.</div>'}</div></div></div>`;
    const c = $('#console'); c.scrollTop = c.scrollHeight;
    $('#clear-logs').addEventListener('click', () => { store.set(LOG_KEY, null); renderActivity(); });
    hydrateIcons($('#page'));
  }

  // ============================================================
  // Boot
  // ============================================================
  hydrateIcons();
  document.addEventListener('visibilitychange', () => {
    const ib = state.inbox;
    if (document.visibilityState === 'visible' && state.route.page === 'inbox' && ib?.active && ib.chats.get(ib.active)?.unreadCount) markRead(ib.active);
  });
  setInterval(() => { if (state.route.page === 'inbox' && state.inbox?.lead && !$('#reply-text')?.value) renderComposer(); }, 60e3);
  if (getKey()) startSession(); else showLogin();

  // New release while this tab is open: say so with a Reload button (checked every 5 minutes and when the tab comes back).
  (() => {
    let first = null; let shown = false;
    const check = async () => {
      if (shown || document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/app.js', { method: 'HEAD', cache: 'no-store' });
        const tag = r.headers.get('etag'); if (!tag) return;
        if (first === null) { first = tag; return; }
        if (tag === first) return;
        shown = true;
        const bar = document.createElement('div');
        bar.setAttribute('role', 'status');
        bar.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:9999;display:flex;gap:12px;align-items:center;padding:10px 14px;border-radius:12px;background:#111827;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);font-size:14px;max-width:92vw';
        bar.innerHTML = '<span>A new version of the app is ready.</span><button class="btn sm primary" type="button">Reload</button>';
        bar.querySelector('button').addEventListener('click', () => { if (confirmLeave()) location.reload(); });
        document.body.appendChild(bar);
      } catch { /* offline: try later */ }
    };
    check();
    setInterval(check, 5 * 60e3);
    document.addEventListener('visibilitychange', check);
  })();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js?v=7', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
})();
