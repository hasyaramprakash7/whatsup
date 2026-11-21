/* Estate Connect — vendor dashboard (vanilla JS, no build step). */
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
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const store = {
    get(k, storage = localStorage) { try { return storage.getItem(k); } catch { return null; } },
    set(k, v, storage = localStorage) { try { v === null ? storage.removeItem(k) : storage.setItem(k, v); } catch { /* private mode */ } },
  };

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
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
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
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
    restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  };
  const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const hydrateIcons = (root = document) => $$('[data-icon]', root).forEach((el) => { if (!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)); });
  const TICK1 = '<svg class="tick" viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l3 3 7-7"/></svg>';
  const TICK2 = (cls) => `<svg class="tick ${cls}" viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6l3 3 7-7"/><path d="M7 8.5l.5.5 7-7"/></svg>`;

  const AVATAR_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16'];
  const colorFor = (seed) => { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length]; };
  const initials = (name) => {
    const n = String(name || '').trim();
    if (!n || n === 'Valued Customer') return '';
    const parts = n.split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  };
  const avatar = (name, seed, cls = '') => {
    const ini = initials(name);
    return `<span class="avatar ${cls}" style="background:${colorFor(seed || name)}">${ini ? esc(ini) : icon('user', 'sm')}</span>`;
  };
  const displayName = (lead) => (lead?.name && lead.name !== 'Valued Customer' ? lead.name : `+${lead?.phone || ''}`);
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

  /** WhatsApp formatting: *bold* _italic_ ~strike~ ```mono``` (text is escaped first). */
  const wa = (text) => esc(text)
    .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>');

  const STATUS_LABELS = { BROADCAST_SENT: 'Broadcast sent', ENGAGED: 'Engaged', QUALIFIED: 'Qualified', VISIT_CONFIRMED: 'Visit booked', COLD: 'Opted out' };
  const statusPill = (s) => `<span class="pill s-${esc(s)}">${esc(STATUS_LABELS[s] || s)}</span>`;
  const deliveryPill = (lead) => {
    if (lead.broadcastStatus) return `<span class="pill d-${esc(lead.broadcastStatus)}" ${lead.broadcastError ? `title="${esc(lead.broadcastError)}"` : ''}>${esc(lead.broadcastStatus[0] + lead.broadcastStatus.slice(1).toLowerCase())}</span>`;
    return lead.lastBroadcastAt ? '<span class="pill d-QUEUED">Queued</span>' : '<span class="muted">—</span>';
  };

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

  const LOG_KEY = 'whatsapp_engine_logs';
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
  const KEY_STORAGE = 'whatsapp_engine_api_key';
  const state = {
    auth: null,
    tenants: [],
    tenantId: null,
    tenant: null,
    botContent: null,
    botDefaults: null,
    unreadChats: 0,
    socket: null,
    route: { page: 'overview', arg: null },
    inbox: null,
    studio: null,
  };
  const isAdmin = () => state.auth?.role === 'admin';
  const getKey = () => store.get(KEY_STORAGE, sessionStorage);

  async function authFetch(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${getKey()}` } });
    if (res.status === 401) {
      signOut('Your session expired or the key is no longer valid. Please sign in again.');
      throw new Error('Not signed in');
    }
    return res;
  }
  async function api(method, url, body) {
    const opts = { method };
    if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers = { 'Content-Type': 'application/json' }; }
    const res = await authFetch(API + url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.data = data; err.status = res.status; throw err; }
    return data;
  }
  async function uploadFile(url, file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await authFetch(API + url, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data;
  }

  // ============================================================
  // Theme
  // ============================================================
  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
    const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const btn = $('#theme-btn');
    btn.innerHTML = icon(dark ? 'sun' : 'moon');
  }
  $('#theme-btn').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    store.set('theme', next);
    applyTheme(next);
  });
  applyTheme(store.get('theme'));

  // ============================================================
  // Session
  // ============================================================
  function showLogin(message = '') {
    $('#shell').hidden = true;
    $('#login').hidden = false;
    $('#login-error').textContent = message;
    setTimeout(() => $('#api-key').focus(), 50);
  }
  function signOut(message = '') {
    store.set(KEY_STORAGE, null, sessionStorage);
    state.auth = null;
    state.socket?.disconnect();
    state.socket = null;
    showLogin(message);
  }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('#api-key').value.trim();
    if (!key) return;
    store.set(KEY_STORAGE, key, sessionStorage);
    $('#api-key').value = '';
    $('#login-error').textContent = '';
    await startSession();
  });
  $('#logout').addEventListener('click', () => { log('Signed out.'); signOut(); });
  $('#menu-btn').addEventListener('click', () => $('#shell').classList.toggle('nav-open'));
  $('#shell').addEventListener('click', (e) => { if (e.target === $('#shell')) $('#shell').classList.remove('nav-open'); });

  async function startSession() {
    try {
      ({ auth: state.auth } = await api('GET', '/tenants/me'));
    } catch (err) {
      if (err.message !== 'Not signed in') showLogin(err.message);
      return;
    }
    $('#login').hidden = true;
    $('#shell').hidden = false;
    $('#me-name').textContent = isAdmin() ? 'Administrator' : state.auth.businessName;
    $('#me-role').textContent = isAdmin() ? 'All clients' : 'Vendor account';
    $('#me-avatar').outerHTML = avatar(isAdmin() ? 'Admin' : state.auth.businessName, 'me').replace('class="avatar ', 'id="me-avatar" class="avatar ');
    log(`Signed in as ${isAdmin() ? 'admin' : state.auth.businessName}.`, 'success');
    await loadTenants();
    connectSocket();
    renderNav();
    route();
  }

  async function loadTenants() {
    const { data } = await api('GET', '/tenants');
    state.tenants = data;
    const sw = $('#tenant-switch');
    sw.hidden = !isAdmin() || !data.length;
    if (isAdmin()) {
      $('#tenant-select').innerHTML = data.map((t) => `<option value="${t._id}">${esc(t.businessName)} · ${esc(t.projectDetails?.projectName || '')}</option>`).join('');
    }
    const saved = store.get('tenantId');
    const preferred = isAdmin() ? (data.find((t) => t._id === saved) || data[0]) : data.find((t) => t._id === state.auth.tenantId);
    if (preferred) await selectTenant(preferred._id, { silent: true });
    else { state.tenantId = null; state.tenant = null; }
  }

  async function selectTenant(id, { silent } = {}) {
    state.tenantId = id;
    if (isAdmin()) { store.set('tenantId', id); $('#tenant-select').value = id; }
    const res = await api('GET', `/tenants/${id}`);
    state.tenant = res.data;
    state.botContent = res.botContent;
    state.botDefaults = res.botDefaults;
    state.inbox = null;
    state.studio = null;
    if (isAdmin() && state.socket?.connected) state.socket.emit('watch-tenant', id);
    refreshUnread();
    if (!silent) route();
  }
  $('#tenant-select').addEventListener('change', (e) => {
    if (!confirmLeaveStudio()) { e.target.value = state.tenantId; return; }
    selectTenant(e.target.value);
  });

  const refreshUnread = debounce(async () => {
    if (!state.tenantId) return;
    try {
      const { unreadChats } = await api('GET', `/chats/${state.tenantId}?limit=1`);
      state.unreadChats = unreadChats;
      const b = $('#nav-unread');
      if (b) { b.textContent = unreadChats; b.hidden = !unreadChats; }
      document.title = `${unreadChats ? `(${unreadChats}) ` : ''}Estate Connect · WhatsApp Lead Desk`;
    } catch { /* ignore */ }
  }, 300);

  // ============================================================
  // Realtime (Socket.IO)
  // ============================================================
  function setLive(status) {
    const el = $('#live');
    el.className = `live ${status === 'on' ? 'on' : status === 'off' ? 'off' : ''}`;
    el.innerHTML = `<span>${status === 'on' ? 'Live' : status === 'off' ? 'Offline' : 'Connecting…'}</span>`;
  }
  function connectSocket() {
    if (typeof io !== 'function') { setLive('off'); return; }
    state.socket?.disconnect();
    const socket = io({ auth: { token: getKey() }, transports: ['websocket', 'polling'] });
    state.socket = socket;
    setLive('connecting');
    socket.on('connect', () => {
      setLive('on');
      if (isAdmin() && state.tenantId) socket.emit('watch-tenant', state.tenantId);
      log('Live updates connected.', 'success');
    });
    socket.on('disconnect', () => setLive('off'));
    socket.on('connect_error', (err) => { setLive('off'); if (err.message === 'unauthorized') log('Live updates: key rejected.', 'error'); });
    socket.on('message:new', onSocketMessage);
    socket.on('message:status', onSocketStatus);
    socket.on('lead:update', ({ lead }) => onLeadUpdate(lead));
  }

  function onSocketMessage({ message, lead }) {
    if (!message || String(message.tenantId) !== String(state.tenantId)) return;
    if (lead) onLeadUpdate(lead, { fromMessage: true });
    const ib = state.inbox;
    if (ib && state.route.page === 'inbox' && ib.active === message.phone) {
      appendMessages([message]);
      if (message.direction === 'in' && document.visibilityState === 'visible') markRead(message.phone);
    }
    if (message.direction === 'in') {
      refreshUnread();
      const viewing = state.route.page === 'inbox' && ib?.active === message.phone && document.visibilityState === 'visible';
      if (!viewing) {
        toast(displayName(lead || { phone: message.phone }), message.text || 'New message', { kind: 'chat', onClick: () => { location.hash = `#/inbox/${message.phone}`; } });
      }
    }
    if (state.route.page === 'overview') refreshOverview();
  }

  function onSocketStatus({ id, status, error, phone }) {
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
  }

  // ============================================================
  // Navigation & routing
  // ============================================================
  const PAGES = {
    overview: { title: 'Overview', icon: 'grid', render: renderOverview },
    inbox: { title: 'Inbox', icon: 'chat', render: renderInbox, flush: true },
    leads: { title: 'Leads', icon: 'users', render: renderLeads },
    broadcast: { title: 'Broadcast', icon: 'megaphone', render: renderBroadcast },
    bot: { title: 'Bot Studio', icon: 'bot', render: renderStudio },
    project: { title: 'Project & Brochure', icon: 'building', render: renderProject },
    settings: { title: 'Settings', icon: 'sliders', render: renderSettings },
    clients: { title: 'Clients', icon: 'key', render: renderClients, admin: true },
    activity: { title: 'Activity log', icon: 'activity', render: renderActivity },
  };

  function renderNav() {
    const link = (p, extra = '') => `<a href="#/${p}" data-page="${p}">${icon(PAGES[p].icon)}<span>${PAGES[p].title}</span>${extra}</a>`;
    $('#nav').innerHTML = `
      <div class="nav-label">Workspace</div>
      ${link('overview')}
      ${link('inbox', `<span class="badge" id="nav-unread" ${state.unreadChats ? '' : 'hidden'}>${state.unreadChats}</span>`)}
      ${link('leads')}
      ${link('broadcast')}
      <div class="nav-label">Configure</div>
      ${link('bot')}
      ${link('project')}
      ${link('settings')}
      ${isAdmin() ? `<div class="nav-label">Admin</div>${link('clients')}` : ''}
      ${link('activity')}`;
    $$('#nav a').forEach((a) => a.addEventListener('click', () => $('#shell').classList.remove('nav-open')));
  }

  let skipNextRoute = false;
  let lastHash = location.hash;
  function confirmLeaveStudio() {
    if (state.route.page === 'bot' && state.studio?.dirty) return confirm('You have unsaved changes in Bot Studio. Leave without saving?');
    return true;
  }
  window.addEventListener('hashchange', () => {
    if (skipNextRoute) { skipNextRoute = false; return; }
    if (!confirmLeaveStudio()) { skipNextRoute = true; location.hash = lastHash; return; }
    route();
  });
  window.addEventListener('beforeunload', (e) => { if (state.studio?.dirty) { e.preventDefault(); e.returnValue = ''; } });

  function route() {
    lastHash = location.hash;
    if (!state.auth) return;
    const [, page = 'overview', arg = null] = (location.hash || '#/overview').split('/');
    let p = PAGES[page] ? page : 'overview';
    if (PAGES[p].admin && !isAdmin()) p = 'overview';
    const prev = state.route.page;
    state.route = { page: p, arg: arg ? decodeURIComponent(arg) : null };
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === p));
    $('#page-title').textContent = PAGES[p].title;
    const pageEl = $('#page');
    pageEl.className = `page ${PAGES[p].flush ? 'flush' : ''}`;
    // The inbox keeps its layout when only the open chat changes.
    if (p === 'inbox' && prev === 'inbox' && state.inbox && $('#inbox')) { openChat(state.route.arg); return; }
    if (!state.tenant && !['clients', 'activity'].includes(p)) { pageEl.innerHTML = noTenantHtml(); hydrateIcons(pageEl); return; }
    PAGES[p].render();
    hydrateIcons(pageEl);
  }

  const noTenantHtml = () => `<div class="page-inner"><div class="card"><div class="empty">
    <span class="section-icon">${icon('building', 'lg')}</span><h3>No client yet</h3>
    <p>${isAdmin() ? 'Create your first client to start broadcasting and chatting.' : 'Your account is not set up yet. Please contact your administrator.'}</p>
    ${isAdmin() ? '<a class="btn primary" href="#/clients">Add a client</a>' : ''}</div></div></div>`;

  // ============================================================
  // Overview
  // ============================================================
  async function renderOverview() {
    const t = state.tenant;
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>${greet}, ${esc(t.businessName)}</h1><p>Here's how <strong>${esc(t.projectDetails.projectName)}</strong> is doing.</p></div>
        <span class="spacer"></span><a class="btn" href="#/broadcast">${icon('megaphone')}New broadcast</a><a class="btn primary" href="#/inbox">${icon('chat')}Open inbox</a></div>
      <div id="ov-attention"></div>
      <div class="kpis" id="ov-kpis">${'<div class="card kpi"><div class="skeleton" style="height:64px"></div></div>'.repeat(5)}</div>
      <div class="overview-grid">
        <div class="stack">
          <div class="card"><div class="card-head"><span class="section-icon">${icon('fire')}</span><div><h2>Lead funnel</h2><p>How far your leads have got in the bot conversation</p></div></div><div class="card-body" id="ov-funnel"></div></div>
          <div class="card"><div class="card-head"><span class="section-icon blue">${icon('send')}</span><div><h2>Broadcast delivery</h2><p>Latest broadcast status per lead, from WhatsApp</p></div></div><div class="card-body" id="ov-delivery"></div></div>
        </div>
        <div class="card"><div class="card-head"><span class="section-icon amber">${icon('calendar')}</span><div><h2>Upcoming site visits</h2><p>Booked through WhatsApp</p></div></div><div id="ov-visits" class="list-rows"></div></div>
      </div></div>`;
    await refreshOverview.now();
  }

  async function loadOverview() {
    if (!$('#ov-kpis')) return;
    let s;
    try { ({ data: s } = await api('GET', `/leads/${state.tenantId}/stats`)); } catch (err) { toast('Could not load stats', err.message, { kind: 'error' }); return; }
    const st = s.status;
    const kpi = (label, value, ic, cls, sub) => `<div class="card kpi"><div class="row"><span class="label">${label}</span><span class="section-icon ${cls}">${icon(ic, 'sm')}</span></div><div class="value">${value.toLocaleString()}</div><div class="sub">${sub}</div></div>`;
    const pct = (n) => (s.total ? `${Math.round((n / s.total) * 100)}% of leads` : '—');
    $('#ov-kpis').innerHTML = [
      kpi('Total leads', s.total, 'users', 'indigo', `${s.newToday} new in the last 24h`),
      kpi('Engaged', st.ENGAGED, 'chat', 'amber', pct(st.ENGAGED)),
      kpi('Qualified', st.QUALIFIED, 'sparkle', 'blue', pct(st.QUALIFIED)),
      kpi('Visits booked', st.VISIT_CONFIRMED, 'calendar', '', pct(st.VISIT_CONFIRMED)),
      kpi('Opted out', st.COLD, 'x', 'red', pct(st.COLD)),
    ].join('');

    const reached = {
      'Broadcast': s.total - st.COLD,
      'Replied': st.ENGAGED + st.QUALIFIED + st.VISIT_CONFIRMED,
      'Shared budget': st.QUALIFIED + st.VISIT_CONFIRMED,
      'Booked a visit': st.VISIT_CONFIRMED,
    };
    const top = Math.max(1, reached.Broadcast);
    $('#ov-funnel').innerHTML = `<div class="funnel">${Object.entries(reached).map(([name, n]) => `
      <div class="funnel-row"><span class="name">${name}</span><div class="bar"><i style="width:${Math.max(n ? 3 : 0, (n / top) * 100)}%"></i></div><span class="num">${n.toLocaleString()}<small>${Math.round((n / top) * 100)}%</small></span></div>`).join('')}</div>`;

    const d = s.delivery;
    const dTotal = d.SENT + d.DELIVERED + d.READ + d.FAILED;
    const colors = { READ: '#10b981', DELIVERED: '#3b82f6', SENT: '#94a3b8', FAILED: '#e5484d' };
    $('#ov-delivery').innerHTML = dTotal ? `
      <div class="stacked">${['READ', 'DELIVERED', 'SENT', 'FAILED'].filter((k) => d[k]).map((k) => `<i style="width:${(d[k] / dTotal) * 100}%;background:${colors[k]}" title="${k}: ${d[k]}"></i>`).join('')}</div>
      <div class="legend">${['READ', 'DELIVERED', 'SENT', 'FAILED'].map((k) => `<span><i style="background:${colors[k]}"></i>${k[0] + k.slice(1).toLowerCase()} <b>${d[k].toLocaleString()}</b></span>`).join('')}</div>`
      : `<div class="empty" style="padding:16px"><p>No broadcasts tracked yet. <a href="#/broadcast">Send your first one</a>.</p></div>`;

    $('#ov-visits').innerHTML = s.upcomingVisits.length ? s.upcomingVisits.map((v) => {
      const at = new Date(v.visitAt);
      return `<a class="list-row" href="#/inbox/${esc(v.phone)}" style="color:inherit;text-decoration:none">
        <span class="date-chip"><small>${at.toLocaleDateString([], { month: 'short' })}</small><b>${at.getDate()}</b></span>
        <div class="grow"><div class="title">${esc(displayName(v))}</div><div class="sub">${esc(at.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))} · ${esc(v.configuration)} · ${esc(v.budget)}</div></div>${icon('chat', 'sm')}</a>`;
    }).join('') : `<div class="empty"><span class="section-icon amber">${icon('calendar', 'lg')}</span><h3>No visits booked yet</h3><p>When a buyer books a slot on WhatsApp it shows up here.</p></div>`;

    const attention = [];
    if (s.unreadChats) attention.push(`<div class="banner green">${icon('chat')}<div><strong>${s.unreadChats} unread conversation${s.unreadChats > 1 ? 's' : ''}.</strong> <a href="#/inbox">Open inbox →</a></div></div>`);
    if (s.needsReply) attention.push(`<div class="banner">${icon('pause')}<div><strong>${s.needsReply} chat${s.needsReply > 1 ? 's' : ''} waiting on your team</strong> — the bot is paused there and the customer wrote last.</div></div>`);
    $('#ov-attention').innerHTML = attention.length ? `<div class="stack" style="gap:10px">${attention.join('')}</div>` : '';
  }
  const refreshOverview = debounce(loadOverview, 600);
  refreshOverview.now = loadOverview;

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
    $('#chats').addEventListener('scroll', (e) => {
      const el = e.target;
      if (ib.hasMore && !ib.loading && el.scrollTop + el.clientHeight > el.scrollHeight - 120) loadChats(false);
    });
    loadChats(true);
    openChat(state.route.arg);
  }

  async function loadChats(reset) {
    const ib = state.inbox;
    if (!ib) return;
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
      ib.hasMore = res.hasMore;
      state.unreadChats = res.unreadChats;
      refreshUnread();
      renderChatList();
    } catch (err) {
      $('#chats').innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`;
    } finally { ib.loading = false; }
  }

  function renderChatList({ flash } = {}) {
    const ib = state.inbox;
    const el = $('#chats');
    if (!ib || !el) return;
    let list = [...ib.chats.values()].filter((l) => l.lastMessageAt).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    if (ib.filter === 'unread') list = list.filter((l) => l.unreadCount > 0 || l.phone === ib.active);
    if (ib.search) {
      const s = ib.search.toLowerCase(); const digits = s.replace(/\D/g, '');
      list = list.filter((l) => (l.name || '').toLowerCase().includes(s) || (digits && l.phone.includes(digits)));
    }
    if (!list.length) {
      el.innerHTML = `<div class="empty"><span class="section-icon">${icon('chat', 'lg')}</span><h3>${ib.search || ib.filter === 'unread' ? 'Nothing here' : 'No conversations yet'}</h3><p>${ib.search ? 'No chat matches your search.' : ib.filter === 'unread' ? "You're all caught up." : 'Chats appear here as soon as a customer messages you.'}</p></div>`;
      return;
    }
    el.innerHTML = list.map((l) => {
      const by = { bot: 'Bot', agent: 'You', broadcast: 'Broadcast' }[l.lastMessageSentBy] || (l.lastMessageDirection === 'out' ? 'Sent' : '');
      // Drop WhatsApp bold/strike markers, but keep underscores (template names use them).
      const plain = String(l.lastMessagePreview || '').replace(/\*([^*\n]+)\*/g, '$1').replace(/~([^~\n]+)~/g, '$1');
      const preview = `${by ? `<span style="opacity:.7">${by}: </span>` : ''}${esc(plain)}`;
      return `<div class="chat-item ${l.unreadCount ? 'unread' : ''} ${l.phone === ib.active ? 'active' : ''} ${flash === l.phone ? 'flash' : ''}" data-phone="${esc(l.phone)}" role="button" tabindex="0">
        ${avatar(l.name, l.phone)}
        <div class="grow">
          <div class="top"><span class="name">${esc(displayName(l))}</span><span class="time">${shortWhen(l.lastMessageAt)}</span></div>
          <div class="bottom"><span class="preview">${preview}</span>${l.unreadCount ? `<span class="badge">${l.unreadCount}</span>` : ''}</div>
          <div class="tags">${statusPill(l.status)}${l.botPaused ? `<span class="pill plain" title="Bot paused — your team is handling this chat">${icon('pause', 'sm')}Team</span>` : ''}</div>
        </div></div>`;
    }).join('') + (ib.hasMore ? '<div style="padding:12px;text-align:center" class="muted small">Scroll for more…</div>' : '');
    $$('.chat-item', el).forEach((item) => {
      const go = () => { location.hash = `#/inbox/${item.dataset.phone}`; };
      item.addEventListener('click', go);
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  }

  async function openChat(phone) {
    const ib = state.inbox;
    if (!ib) return;
    ib.active = phone || null;
    $('#inbox')?.classList.toggle('chat-open', !!phone);
    renderChatList();
    if (!phone) {
      ib.lead = null; ib.messages = [];
      $('#conversation').innerHTML = `<div class="no-chat"><div class="card">
        <span class="section-icon" style="margin:0 auto 12px;width:52px;height:52px;border-radius:16px">${icon('chat', 'lg')}</span>
        <h2>Your WhatsApp inbox</h2><p class="muted" style="margin-top:6px">Pick a conversation to see the full chat with the bot, reply yourself, or pause the bot.</p></div></div>`;
      $('#details').innerHTML = '';
      return;
    }
    $('#conversation').innerHTML = `<div class="conv-head"><div class="skeleton" style="width:40px;height:40px;border-radius:50%"></div><div class="grow"><div class="skeleton" style="width:160px;height:14px"></div></div></div><div class="messages"></div>`;
    try {
      const res = await api('GET', `/chats/${state.tenantId}/${phone}/messages?limit=60`);
      if (ib.active !== phone) return;
      ib.lead = res.lead;
      ib.messages = res.data;
      ib.hasOlder = res.hasMore;
      if (!ib.chats.has(phone)) ib.chats.set(phone, res.lead);
    } catch (err) {
      $('#conversation').innerHTML = `<div class="no-chat"><div class="card"><h2>Chat not found</h2><p class="muted">${esc(err.message)}</p></div></div>`;
      return;
    }
    $('#conversation').innerHTML = `<div class="conv-head" id="conv-head"></div><div class="messages" id="messages"></div><div class="composer" id="composer"></div>`;
    renderConvHead();
    renderMessages();
    renderComposer();
    renderDetails();
    // The composer changes the message pane's height, so jump to the newest message once laid out.
    requestAnimationFrame(() => { const m = $('#messages'); if (m) m.scrollTop = m.scrollHeight; });
    if (ib.lead.unreadCount) markRead(phone);
  }

  const markRead = debounce(async (phone) => {
    try {
      const { lead } = await api('POST', `/chats/${state.tenantId}/${phone}/read`);
      onLeadUpdate(lead);
      refreshUnread();
    } catch { /* ignore */ }
  }, 250);

  function renderConvHead() {
    const ib = state.inbox; const l = ib?.lead;
    const el = $('#conv-head');
    if (!l || !el) return;
    el.innerHTML = `
      <button class="btn icon ghost back" aria-label="Back to chats" id="conv-back">${icon('back')}</button>
      ${avatar(l.name, l.phone)}
      <div class="grow"><div class="name">${esc(displayName(l))}</div><div class="sub"><span>${esc(fmtPhone(l.phone))}</span>${statusPill(l.status)}</div></div>
      <label class="switch bot-toggle" title="When the bot is off, only your team replies in this chat">
        <input type="checkbox" id="bot-toggle" ${l.botPaused ? '' : 'checked'} /><span class="track"></span><span class="lbl">${l.botPaused ? 'Bot paused' : 'Bot on'}</span></label>
      <button class="btn icon ghost" id="details-toggle" title="Lead details" aria-label="Lead details">${icon('panel')}</button>`;
    $('#conv-back').addEventListener('click', () => { location.hash = '#/inbox'; });
    $('#details-toggle').addEventListener('click', () => { ib.detailsOpen = !ib.detailsOpen; $('#inbox').classList.toggle('no-details', !ib.detailsOpen); });
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

  const SENDER = { bot: ['bot', 'Bot'], agent: ['user', 'You'], broadcast: ['megaphone', 'Broadcast'] };
  function metaHtml(m) {
    let ticks = '';
    if (m.direction === 'out') {
      if (m.status === 'failed') ticks = `<span title="${esc(m.error || 'Not delivered')}">${icon('alert', 'tick failed')}</span>`;
      else if (m.status === 'read') ticks = TICK2('read');
      else if (m.status === 'delivered') ticks = TICK2('');
      else ticks = TICK1;
    }
    return `<span class="meta">${timeOf(m.createdAt)}${ticks}</span>`;
  }

  function messageHtml(m, prev) {
    const out = m.direction === 'out';
    const gap = !prev || prev.direction !== m.direction || prev.sentBy !== m.sentBy || new Date(m.createdAt) - new Date(prev.createdAt) > 5 * 60e3;
    const [ic, who] = SENDER[m.sentBy] || [];
    const whoHtml = out && gap && who ? `<div class="who ${m.sentBy}">${icon(ic, 'sm')}${who}</div>` : '';
    const meta = m.meta || {};
    let inner = ''; let after = '';
    const textHtml = (t) => (t ? `<div class="text">${wa(t)}</div>` : '');
    switch (m.type) {
      case 'buttons':
        inner = textHtml(m.text);
        after = `<div class="chips">${(meta.buttons || []).map((b) => `<div class="chip">${icon('reply', 'sm')}${esc(b)}</div>`).join('')}</div>`;
        break;
      case 'list':
        inner = `${meta.header ? `<div style="font-weight:700;margin-bottom:2px">${esc(meta.header)}</div>` : ''}${textHtml(m.text)}
          <div class="list-rows-preview">${(meta.rows || []).map((r) => `<div>• ${esc(r.title)}${r.description ? `<small>${esc(r.description)}</small>` : ''}</div>`).join('')}</div>`;
        after = `<div class="chips"><div class="chip">${icon('list', 'sm')}${esc(meta.button || 'Options')}</div></div>`;
        break;
      case 'document':
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
      case 'reply':
        inner = `<div class="tapped">${icon('reply', 'sm')}Tapped</div>${textHtml(m.text)}`;
        break;
      case 'reaction':
        inner = `<div class="reaction">${esc(m.text)}</div>`;
        break;
      case 'text':
        inner = textHtml(m.text);
        break;
      default:
        inner = `<div class="tapped">${esc(meta.label || m.type)}</div>${textHtml(m.text)}${!m.text ? '<div class="text muted small">Media is shown in WhatsApp</div>' : ''}`;
    }
    return `<div class="msg ${out ? 'out' : 'in'} ${gap ? 'gap' : ''}" data-id="${esc(m._id)}"><div class="bubble">${whoHtml}${inner}${metaHtml(m)}</div>${after}</div>`;
  }

  function messagesHtml(list, prevBefore = null) {
    let html = '';
    let prev = prevBefore;
    for (const m of list) {
      if (!prev || !sameDay(new Date(prev.createdAt), new Date(m.createdAt))) { html += `<div class="day-sep">${esc(dayLabel(m.createdAt))}</div>`; prev = null; }
      html += messageHtml(m, prev);
      prev = m;
    }
    return html;
  }

  function renderMessages() {
    const ib = state.inbox; const el = $('#messages');
    if (!el) return;
    el.innerHTML = (ib.hasOlder ? '<button class="btn sm load-older" id="load-older">Load earlier messages</button>' : '')
      + (ib.messages.length ? messagesHtml(ib.messages) : `<div class="empty"><p>No messages yet.</p></div>`);
    $('#load-older')?.addEventListener('click', loadOlder);
    el.scrollTop = el.scrollHeight;
  }

  async function loadOlder() {
    const ib = state.inbox; const el = $('#messages');
    const first = ib.messages[0];
    if (!first) return;
    const h = el.scrollHeight;
    try {
      const res = await api('GET', `/chats/${state.tenantId}/${ib.active}/messages?limit=60&before=${encodeURIComponent(first.createdAt)}`);
      ib.messages = [...res.data, ...ib.messages];
      ib.hasOlder = res.hasMore;
      renderMessages();
      el.scrollTop = el.scrollHeight - h;
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
    if (l.status === 'COLD') {
      el.innerHTML = `<div class="banner red">${icon('x')}<div><strong>This customer opted out.</strong> WhatsApp policy doesn't allow messaging them again unless they write to you first.</div></div>`;
      return;
    }
    const w = windowInfo(l);
    if (!w.open) {
      el.innerHTML = `<div class="banner">${icon('clock')}<div><strong>The 24-hour reply window is closed.</strong> WhatsApp only lets you reply within 24 hours of the customer's last message. Re-engage them with a <a href="#/broadcast">broadcast template</a>.</div></div>`;
      return;
    }
    const hours = Math.floor(w.left / 3600e3); const mins = Math.floor((w.left % 3600e3) / 60e3);
    el.innerHTML = `
      <div class="row">
        <textarea id="reply-text" rows="1" placeholder="Type a reply…" aria-label="Reply">${esc(draft)}</textarea>
        <button class="btn primary" id="send-btn" aria-label="Send" title="Send (Enter)">${icon('send')}</button>
      </div>
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
    const text = ta.value.trim();
    if (!text) return;
    btn.disabled = true; ta.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
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
    const visit = l.visitAt ? new Date(l.visitAt) : null;
    el.innerHTML = `
      <div class="details-head">${avatar(l.name, l.phone)}<div class="name">${esc(displayName(l))}</div>
        <a href="tel:+${esc(l.phone)}" class="small">${icon('phone', 'sm')} ${esc(fmtPhone(l.phone))}</a>${statusPill(l.status)}</div>
      <div class="details-section"><h4>Requirement</h4><dl class="kv">
        <dt>Home</dt><dd>${esc(l.configuration)}</dd><dt>Budget</dt><dd>${esc(l.budget)}</dd>
        <dt>Site visit</dt><dd>${visit ? `${esc(l.visitSlot)}${visit < new Date() ? ' <span class="muted">(past)</span>' : ''}` : '<span class="muted">Not booked</span>'}</dd></dl></div>
      ${l.visitAt && visit > new Date() ? `<div class="details-section"><div class="banner green">${icon('calendar')}<div><strong>Visit booked</strong><br>${esc(l.visitSlot)}</div></div></div>` : ''}
      <div class="details-section"><h4>Broadcast</h4><dl class="kv">
        <dt>Delivery</dt><dd>${deliveryPill(l)}</dd><dt>Last sent</dt><dd>${l.lastBroadcastAt ? esc(new Date(l.lastBroadcastAt).toLocaleString()) : '—'}</dd>
        ${l.broadcastError ? `<dt>Error</dt><dd style="color:var(--danger)">${esc(l.broadcastError)}</dd>` : ''}</dl></div>
      <div class="details-section"><h4>Team alert</h4><dl class="kv">
        <dt>Alert</dt><dd>${l.adminAlertStatus ? `<span class="pill ${l.adminAlertStatus === 'FAILED' ? 'd-FAILED' : 'd-READ'}">${esc(l.adminAlertStatus.toLowerCase())}</span>` : '<span class="muted">None yet</span>'}</dd>
        ${l.adminAlertError ? `<dt>Why</dt><dd style="color:var(--danger)">${esc(l.adminAlertError)}</dd>` : ''}</dl></div>
      <div class="details-section"><h4>Timeline</h4><dl class="kv">
        <dt>First seen</dt><dd>${esc(new Date(l.createdAt).toLocaleString())}</dd><dt>Last message</dt><dd>${relTime(l.lastMessageAt)}</dd></dl></div>`;
  }

  // ============================================================
  // Leads
  // ============================================================
  const leadsState = { page: 1, status: '' };
  async function renderLeads() {
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Leads</h1><p>Everyone you've broadcast to or who has messaged ${esc(state.tenant.projectDetails.projectName)}.</p></div><span class="spacer"></span>
        <a class="btn primary" href="#/broadcast">${icon('upload')}Import & broadcast</a></div>
      <div class="filters" id="lead-filters"></div>
      <div class="card"><div class="table-wrap" id="leads-table"><div style="padding:20px;display:grid;gap:12px">${'<div class="skeleton" style="height:36px"></div>'.repeat(6)}</div></div><div id="leads-pager"></div></div></div>`;
    loadLeads();
  }

  async function loadLeads() {
    const q = new URLSearchParams({ page: leadsState.page, limit: 50 });
    if (leadsState.status) q.set('status', leadsState.status);
    let res; let stats;
    try {
      [res, { data: stats }] = await Promise.all([api('GET', `/leads/${state.tenantId}?${q}`), api('GET', `/leads/${state.tenantId}/stats`)]);
    } catch (err) { $('#leads-table').innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`; return; }
    const filters = [['', 'All', stats.total], ...Object.keys(STATUS_LABELS).map((s) => [s, STATUS_LABELS[s], stats.status[s]])];
    $('#lead-filters').innerHTML = filters.map(([v, label, n]) => `<button class="filter ${leadsState.status === v ? 'active' : ''}" data-v="${v}">${label}<span class="n">${(n || 0).toLocaleString()}</span></button>`).join('');
    $$('#lead-filters .filter').forEach((b) => b.addEventListener('click', () => { leadsState.status = b.dataset.v; leadsState.page = 1; loadLeads(); }));

    if (!res.data.length) {
      $('#leads-table').innerHTML = `<div class="empty"><span class="section-icon indigo">${icon('users', 'lg')}</span><h3>No leads here</h3><p>${leadsState.status ? 'No leads with this status.' : 'Import a CSV on the Broadcast page to get started.'}</p></div>`;
      $('#leads-pager').innerHTML = '';
      return;
    }
    $('#leads-table').innerHTML = `<table class="table"><thead><tr><th>Lead</th><th>Home</th><th>Budget</th><th>Site visit</th><th>Delivery</th><th>Status</th><th>Last activity</th><th></th></tr></thead><tbody>
      ${res.data.map((l) => `<tr>
        <td><div class="person">${avatar(l.name, l.phone)}<div><strong>${esc(displayName(l))}</strong><small>${esc(fmtPhone(l.phone))}</small></div></div></td>
        <td>${esc(l.configuration === 'Unspecified' ? '—' : l.configuration)}</td><td>${esc(l.budget === 'Unspecified' ? '—' : l.budget)}</td>
        <td>${l.visitSlot ? esc(l.visitSlot) : '<span class="muted">—</span>'}</td><td>${deliveryPill(l)}</td>
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
  // Broadcast
  // ============================================================
  function renderBroadcast() {
    const t = state.tenant;
    const tpl = t.templates?.broadcastName;
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Broadcast</h1><p>Upload a contact list and send your approved WhatsApp template. Replies flow straight into the bot and your inbox.</p></div></div>
      <div class="overview-grid">
        <div class="card"><div class="card-head"><span class="section-icon">${icon('upload')}</span><div><h2>Import contacts</h2><p>CSV with a <code>phone</code> column (and optionally <code>name</code>)</p></div></div>
          <div class="card-body stack">
            <label class="dropzone" id="csv-drop"><input type="file" id="csv-file" accept=".csv,text/csv" />
              <span class="section-icon">${icon('upload', 'lg')}</span><strong>Drop your CSV here or click to choose</strong><span class="hint">10-digit Indian numbers get +91 automatically · duplicates and opted-out numbers are skipped</span></label>
            <div id="csv-picked"></div>
            <button class="btn primary" id="send-broadcast" disabled style="height:42px">${icon('send')}Send broadcast</button>
            <div id="broadcast-result"></div>
          </div></div>
        <div class="stack">
          <div class="card card-pad stack"><div class="row"><span class="section-icon indigo">${icon('template')}</span><div><h2>Template</h2><p class="muted small">Change it in <a href="#/settings">Settings</a></p></div></div>
            <dl class="kv"><dt>Name</dt><dd><code>${esc(tpl || 'Server default')}</code></dd><dt>Language</dt><dd>${esc(t.templates?.broadcastLanguage || 'Server default')}</dd>
            <dt>Variables</dt><dd>${tpl ? (t.templates?.broadcastHasParams === false ? 'None' : '{{1}} customer name · {{2}} project name') : 'Server default'}</dd></dl></div>
          <div class="card card-pad stack"><div class="row"><span class="section-icon amber">${icon('info')}</span><h2>Good to know</h2></div>
            <ul style="margin:0;padding-left:18px;color:var(--text-2);display:grid;gap:6px">
              <li>Daily sending limit follows your WhatsApp tier (Tier ${t.tier ?? 0}).</li>
              <li>Leads who opted out are never messaged again.</li>
              <li>Delivery and read ticks appear live on the Leads page and in each chat.</li></ul></div>
          ${isAdmin() ? `<div class="card"><div class="card-head"><span class="section-icon blue">${icon('activity')}</span><div><h2>Sending queue</h2><p>All clients</p></div><span class="spacer"></span><button class="btn sm" id="q-refresh">${icon('refresh', 'sm')}Refresh</button></div><div class="card-body" id="queue-stats"></div></div>` : ''}
        </div></div></div>`;
    let file = null;
    const pick = (f) => {
      file = f || null;
      $('#csv-picked').innerHTML = file ? `<div class="file-picked">${icon('file')}<div class="grow" style="min-width:0"><strong>${esc(file.name)}</strong><div class="hint">${(file.size / 1024).toFixed(1)} KB</div></div><button class="btn icon sm ghost" id="csv-clear" aria-label="Remove file">${icon('x', 'sm')}</button></div>` : '';
      $('#csv-clear')?.addEventListener('click', (e) => { e.preventDefault(); $('#csv-file').value = ''; pick(null); });
      $('#send-broadcast').disabled = !file;
    };
    wireDropzone($('#csv-drop'), $('#csv-file'), pick);
    $('#send-broadcast').addEventListener('click', async () => {
      if (!file) return;
      const btn = $('#send-broadcast');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
      try {
        const data = await uploadFile(`/leads/upload/${state.tenantId}`, file);
        const s = data.summary || {};
        $('#broadcast-result').innerHTML = `<div class="banner green">${icon('check')}<div><strong>${esc(data.message)}</strong></div></div>
          <div class="stat-chips" style="margin-top:12px">
            ${[['Queued', s.enqueued], ['Rows in file', s.total], ['Duplicates', s.duplicatesSkipped], ['Invalid numbers', s.invalidSkipped], ['Opted out', s.optedOutSkipped], ['Recently contacted', s.recentlyContactedSkipped], ['Quota left today', s.quotaRemaining]]
              .filter(([, v]) => v !== undefined).map(([k, v]) => `<div class="stat-chip"><b>${(v ?? 0).toLocaleString()}</b><span>${k}</span></div>`).join('')}</div>
          ${data.invalidSamples?.length ? `<p class="hint" style="margin-top:8px">Invalid examples: ${data.invalidSamples.map(esc).join(', ')}</p>` : ''}`;
        toast('Broadcast queued', `${s.enqueued} messages are on their way.`);
        log(`Broadcast queued: ${s.enqueued} messages.`, 'success');
        $('#csv-file').value = ''; pick(null);
        if (isAdmin()) loadQueueStats();
      } catch (err) {
        $('#broadcast-result').innerHTML = `<div class="banner red">${icon('alert')}<div>${esc(err.message)}</div></div>`;
        log(`Broadcast failed: ${err.message}`, 'error');
      } finally { btn.innerHTML = `${icon('send')}Send broadcast`; btn.disabled = !file; }
    });
    if (isAdmin()) { $('#q-refresh').addEventListener('click', loadQueueStats); loadQueueStats(); }
  }

  async function loadQueueStats() {
    const el = $('#queue-stats'); if (!el) return;
    try {
      const { stats } = await api('GET', '/leads/queue/stats');
      el.innerHTML = `<div class="stat-chips">${Object.entries(stats).map(([k, v]) => `<div class="stat-chip"><b>${v.toLocaleString()}</b><span>${k[0].toUpperCase() + k.slice(1)}</span></div>`).join('')}</div>`;
    } catch (err) { el.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
  }

  function wireDropzone(zone, input, onFile) {
    input.addEventListener('change', () => onFile(input.files[0]));
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
    zone.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) onFile(f); });
  }

  // ============================================================
  // Bot Studio
  // ============================================================
  const PLACEHOLDERS = {
    welcomeText: ['project'], budgetText: ['configuration', 'project'], brochureCaption: ['project', 'name', 'configuration', 'budget'],
    slotText: ['project'], confirmationText: ['project', 'name', 'configuration', 'budget', 'slot', 'address'],
    completedText: ['project', 'adminPhone'], optOutText: ['project'], nudgeText: ['project'], handoffText: ['project', 'adminPhone'],
    slotPassedText: ['project'], errorText: ['project', 'adminPhone'],
  };
  const DAYS = [['TOMORROW', 'Tomorrow'], ['MON', 'Monday'], ['TUE', 'Tuesday'], ['WED', 'Wednesday'], ['THU', 'Thursday'], ['FRI', 'Friday'], ['SAT', 'Saturday'], ['SUN', 'Sunday']];

  function renderStudio() {
    if (!state.studio) state.studio = { draft: clone(state.botContent), dirty: false, errors: [] };
    const d = state.studio.draft;
    const textField = (key, label, hint = '', rows = 3, max = 1024) => `
      <label class="field"><span>${label}</span>
        <textarea data-key="${key}" rows="${rows}" maxlength="${max}">${esc(d[key])}</textarea>
        <div class="row"><div class="placeholders">${(PLACEHOLDERS[key] || []).map((p) => `<button type="button" class="ph" data-insert="${key}" data-ph="${p}">{${p}}</button>`).join('')}</div><span class="spacer"></span><span class="counter" data-count="${key}" data-max="${max}"></span></div>
        ${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
    const labelField = (key, label, max, hint = '') => `
      <label class="field"><span>${label}</span><input class="input" data-key="${key}" maxlength="${max}" value="${esc(d[key])}" />
        <div class="row">${hint ? `<span class="hint">${hint}</span>` : ''}<span class="spacer"></span><span class="counter" data-count="${key}" data-max="${max}"></span></div></label>`;
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Bot Studio</h1><p>Write exactly what your WhatsApp bot says. Changes go live for new messages as soon as you save.</p></div><span class="spacer"></span>
        <button class="btn" id="studio-reset">${icon('restore')}Restore defaults</button></div>
      <div class="studio">
        <div class="stack" id="studio-form">
          <div class="card"><div class="card-head"><span class="section-icon">${icon('chat')}</span><div><h2>1 · Welcome & home type</h2><p>First reply after the customer responds to your broadcast</p></div></div>
            <div class="card-body stack">${textField('welcomeText', 'Welcome message', '', 3)}
              <div class="field"><span>Home options</span><span class="hint">Up to 3 show as buttons (20 characters); 4–10 show as a list (24 characters). "Saved as" is what you see on the lead.</span></div>
              <div class="option-rows" id="config-rows"></div>
              <button class="btn sm" id="add-config" style="align-self:flex-start">${icon('plus', 'sm')}Add option</button>
              <div class="field" id="config-list-labels"><span>When there are 4 or more options (sent as a list)</span>
                <div class="grid-3">${labelField('configListHeader', 'List title', 60)}${labelField('configListButton', 'List button', 20)}${labelField('configSectionTitle', 'Section name', 24)}</div></div></div></div>
          <div class="card"><div class="card-head"><span class="section-icon blue">${icon('list')}</span><div><h2>2 · Budget</h2><p>Sent as a list after they pick a home type</p></div></div>
            <div class="card-body stack">${textField('budgetText', 'Budget question', '', 3)}
              <div class="grid-3">${labelField('budgetHeader', 'List title', 60)}${labelField('budgetButtonLabel', 'List button', 20)}${labelField('budgetSectionTitle', 'Section name', 24)}</div>
              <div class="field"><span>Budget ranges</span><span class="hint">Up to 10 ranges · title max 24 characters · description max 72</span></div>
              <div class="option-rows" id="budget-rows"></div>
              <button class="btn sm" id="add-budget" style="align-self:flex-start">${icon('plus', 'sm')}Add range</button></div></div>
          <div class="card"><div class="card-head"><span class="section-icon indigo">${icon('file')}</span><div><h2>3 · Brochure</h2><p>Sent with your brochure PDF (upload it under <a href="#/project">Project</a>)</p></div></div>
            <div class="card-body stack">${labelField('brochureFileName', 'File name buyers see', 60, '".pdf" is added automatically · {project} works here')}${textField('brochureCaption', 'Brochure caption', '', 2)}</div></div>
          <div class="card"><div class="card-head"><span class="section-icon amber">${icon('calendar')}</span><div><h2>4 · Site visit</h2><p>Buyers pick one of up to 3 upcoming slots</p></div></div>
            <div class="card-body stack">${textField('slotText', 'Visit question', '', 3)}
              <div class="field"><span>Visit slots</span><span class="hint">Real dates are filled in automatically, e.g. "Sat 28 Nov, 4 PM".</span></div>
              <div class="option-rows" id="slot-rows"></div>
              <button class="btn sm" id="add-slot" style="align-self:flex-start">${icon('plus', 'sm')}Add slot</button>
              ${textField('confirmationText', 'Booking confirmation', 'Sent with the location pin once a slot is booked.', 7, 4096)}</div></div>
          <div class="card"><div class="card-head"><span class="section-icon red">${icon('reply')}</span><div><h2>5 · Other replies</h2><p>Edge cases the bot handles for you</p></div></div>
            <div class="card-body stack">
              ${textField('nudgeText', 'When they type instead of tapping', 'Sent before the question is asked again (twice at most).', 2, 4096)}
              ${textField('handoffText', 'Handing over to your team', 'Sent after the third typed reply; your team gets an alert.', 3, 4096)}
              ${textField('completedText', 'After the visit is booked', 'Reply to any later message from a customer who already booked.', 2, 4096)}
              ${textField('slotPassedText', 'Slot already passed', '', 2, 4096)}
              ${textField('optOutText', 'Opt-out confirmation', 'Sent when someone replies STOP or taps "Not interested".', 2, 4096)}
              ${textField('errorText', 'Something went wrong', '', 2, 4096)}</div></div>
          <div id="studio-errors"></div>
          <div class="save-bar" id="save-bar" hidden><span>${icon('info')}</span><strong>You have unsaved changes</strong><span class="spacer"></span>
            <button class="btn ghost" id="studio-discard">Discard</button><button class="btn primary" id="studio-save">${icon('check')}Save & publish</button></div>
        </div>
        <div class="studio-preview"><div class="phone"><div class="phone-screen">
          <div class="phone-top">${avatar(state.tenant.businessName, 'biz')}<div><strong>${esc(state.tenant.businessName)}</strong><small>Live preview</small></div></div>
          <div class="phone-body" id="preview"></div></div></div></div>
      </div></div>`;

    renderOptionRows();
    updateStudio(false);
    $('#studio-form').addEventListener('input', (e) => {
      const key = e.target.dataset.key;
      if (key) { d[key] = e.target.value; markDirty(); }
      const opt = e.target.dataset.opt;
      if (opt) {
        const [list, i, field] = opt.split(':');
        d[list][Number(i)][field] = e.target.value;
        markDirty();
      }
    });
    $('#studio-form').addEventListener('click', (e) => {
      const ph = e.target.closest('[data-insert]');
      if (ph) {
        const ta = $(`textarea[data-key="${ph.dataset.insert}"]`);
        const token = `{${ph.dataset.ph}}`;
        const [s, en] = [ta.selectionStart ?? ta.value.length, ta.selectionEnd ?? ta.value.length];
        ta.value = ta.value.slice(0, s) + token + ta.value.slice(en);
        ta.focus(); ta.selectionStart = ta.selectionEnd = s + token.length;
        d[ph.dataset.insert] = ta.value; markDirty();
      }
      const rm = e.target.closest('[data-remove]');
      if (rm) { const [list, i] = rm.dataset.remove.split(':'); d[list].splice(Number(i), 1); renderOptionRows(); markDirty(); }
    });
    $('#add-config').addEventListener('click', () => { if (d.configOptions.length >= 10) return toast('Up to 10 options', '', { kind: 'warn' }); d.configOptions.push({ id: '', label: '', title: '' }); renderOptionRows(); markDirty(); });
    $('#add-budget').addEventListener('click', () => { if (d.budgetOptions.length >= 10) return toast('Up to 10 ranges', '', { kind: 'warn' }); d.budgetOptions.push({ id: '', label: '', description: '' }); renderOptionRows(); markDirty(); });
    $('#add-slot').addEventListener('click', () => { if (d.slotPlan.length >= 3) return toast('Up to 3 slots', 'WhatsApp shows at most 3 buttons.', { kind: 'warn' }); d.slotPlan.push({ day: 'SAT', time: '11:00' }); renderOptionRows(); markDirty(); });
    $('#studio-discard').addEventListener('click', () => { state.studio = null; renderStudio(); hydrateIcons($('#page')); });
    $('#studio-reset').addEventListener('click', () => {
      if (!confirm('Replace all bot messages with the original defaults? You can still discard before saving.')) return;
      state.studio.draft = clone(state.botDefaults); renderStudio(); hydrateIcons($('#page')); markDirty();
    });
    $('#studio-save').addEventListener('click', saveStudio);
  }

  function renderOptionRows() {
    const d = state.studio.draft;
    const configMax = d.configOptions.length > 3 ? 24 : 20;
    $('#config-rows').innerHTML = d.configOptions.map((o, i) => `
      <div class="option-row"><span class="num">${i + 1}</span>
        <label class="field"><span>Button text</span><input class="input" data-opt="configOptions:${i}:title" maxlength="${configMax}" value="${esc(o.title)}" placeholder="3 BHK (1850 sq.ft)" /><span class="counter" data-optcount="configOptions:${i}:title" data-max="${configMax}"></span></label>
        <label class="field"><span>Saved as</span><input class="input" data-opt="configOptions:${i}:label" maxlength="60" value="${esc(o.label)}" placeholder="3 BHK" /></label>
        <button class="btn icon sm ghost danger" data-remove="configOptions:${i}" aria-label="Remove" style="margin-top:24px" ${d.configOptions.length <= 1 ? 'disabled' : ''}>${icon('trash', 'sm')}</button></div>`).join('');
    $('#budget-rows').innerHTML = d.budgetOptions.map((o, i) => `
      <div class="option-row"><span class="num">${i + 1}</span>
        <label class="field"><span>Range</span><input class="input" data-opt="budgetOptions:${i}:label" maxlength="24" value="${esc(o.label)}" placeholder="₹1.2 Cr - ₹1.8 Cr" /><span class="counter" data-optcount="budgetOptions:${i}:label" data-max="24"></span></label>
        <label class="field"><span>Description</span><input class="input" data-opt="budgetOptions:${i}:description" maxlength="72" value="${esc(o.description || '')}" placeholder="Lake facing & high floors" /></label>
        <button class="btn icon sm ghost danger" data-remove="budgetOptions:${i}" aria-label="Remove" style="margin-top:24px" ${d.budgetOptions.length <= 1 ? 'disabled' : ''}>${icon('trash', 'sm')}</button></div>`).join('');
    $('#slot-rows').innerHTML = d.slotPlan.map((s, i) => `
      <div class="slot-row"><span class="num">${i + 1}</span>
        <select data-opt="slotPlan:${i}:day" aria-label="Day">${DAYS.map(([v, l]) => `<option value="${v}" ${s.day === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input class="input" type="time" data-opt="slotPlan:${i}:time" value="${esc(s.time)}" aria-label="Time" />
        <button class="btn icon sm ghost danger" data-remove="slotPlan:${i}" aria-label="Remove" ${d.slotPlan.length <= 1 ? 'disabled' : ''}>${icon('trash', 'sm')}</button></div>`).join('');
    updateStudio(false);
  }

  function markDirty() { state.studio.dirty = true; updateStudio(true); }

  function updateStudio(dirty) {
    const d = state.studio.draft;
    $$('[data-count]').forEach((c) => { const v = d[c.dataset.count] || ''; c.textContent = `${v.length}/${c.dataset.max}`; c.classList.toggle('over', v.length > Number(c.dataset.max)); });
    $$('[data-optcount]').forEach((c) => { const [list, i, f] = c.dataset.optcount.split(':'); const v = d[list][i]?.[f] || ''; c.textContent = `${v.length}/${c.dataset.max}`; c.classList.toggle('over', v.length > Number(c.dataset.max)); });
    if (dirty !== false || state.studio.dirty) $('#save-bar').hidden = !state.studio.dirty;
    renderPreview();
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
    return out.sort((a, b) => a - b).map((at) => {
      const t = at.toLocaleTimeString([], { hour: 'numeric', minute: at.getMinutes() ? '2-digit' : undefined });
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return sameDay(at, tomorrow) ? `Tomorrow, ${t}` : `${at.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${t}`;
    });
  }

  function renderPreview() {
    const el = $('#preview'); if (!el) return;
    const d = state.studio.draft; const p = state.tenant.projectDetails;
    const config = d.configOptions[0]?.label || '3 BHK'; const budget = d.budgetOptions[0]?.label || '';
    const slots = previewSlots(d.slotPlan);
    const vars = { project: p.projectName, name: 'Priya', configuration: config, budget, slot: slots[0] || 'Tomorrow, 11 AM', address: p.siteAddress, adminPhone: state.tenant.adminNotificationPhone };
    const fill = (t) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] ? vars[k] : m));
    const now = new Date().toISOString();
    const bot = (type, text, meta) => messageHtml({ _id: Math.random(), direction: 'out', sentBy: 'bot', type, text, meta, status: 'read', createdAt: now }, { direction: 'out', sentBy: 'bot', createdAt: now });
    const user = (text) => messageHtml({ _id: Math.random(), direction: 'in', sentBy: 'customer', type: 'reply', text, createdAt: now }, null);
    const step = (t) => `<div class="step-label">${t}</div>`;
    const configList = d.configOptions.length > 3;
    el.innerHTML = [
      step('Customer replies to broadcast'), user('Yes, interested'),
      configList ? bot('list', fill(d.welcomeText), { header: fill(d.configListHeader), button: fill(d.configListButton), rows: d.configOptions.map((o) => ({ title: o.title || o.label })) })
        : bot('buttons', fill(d.welcomeText), { buttons: d.configOptions.map((o) => o.title || o.label) }),
      user(d.configOptions[0]?.title || config),
      bot('list', fill(d.budgetText), { header: fill(d.budgetHeader), button: fill(d.budgetButtonLabel), rows: d.budgetOptions.map((o) => ({ title: o.label, description: o.description })) }),
      user(budget),
      p.brochurePdfUrl ? bot('document', fill(d.brochureCaption), { filename: `${fill(d.brochureFileName).replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '').trim() || p.projectName}.pdf`, link: p.brochurePdfUrl }) : step('No brochure uploaded yet'),
      bot('buttons', fill(d.slotText), { buttons: slots }),
      user(slots[0] || ''),
      bot('location', p.projectName, { name: p.projectName, address: p.siteAddress, latitude: p.latitude, longitude: p.longitude }),
      bot('text', fill(d.confirmationText)),
    ].join('');
  }

  async function saveStudio() {
    const btn = $('#studio-save');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…';
    try {
      const res = await api('PATCH', `/tenants/${state.tenantId}`, { botContent: state.studio.draft });
      state.tenant = res.data; state.botContent = res.botContent;
      state.studio = { draft: clone(res.botContent), dirty: false, errors: [] };
      renderStudio(); hydrateIcons($('#page'));
      toast('Bot updated', 'New conversations use your new messages right away.');
      log('Bot Studio saved.', 'success');
    } catch (err) {
      const errors = err.data?.errors || [err.message];
      $('#studio-errors').innerHTML = `<div class="banner red">${icon('alert')}<div><strong>Please fix these before saving:</strong><ul class="errors">${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>`;
      $('#studio-errors').scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.disabled = false; btn.innerHTML = `${icon('check')}Save & publish`;
    }
  }

  // ============================================================
  // Project & brochure
  // ============================================================
  function renderProject() {
    const t = state.tenant; const p = t.projectDetails;
    const mapSrc = (lat, lng) => `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&z=15&output=embed`;
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Project & Brochure</h1><p>What buyers receive: the project name, site location pin and your brochure PDF.</p></div></div>
      <div class="overview-grid">
        <form class="card" id="project-form"><div class="card-head"><span class="section-icon">${icon('building')}</span><div><h2>Project details</h2><p>Used in bot messages and the location pin</p></div></div>
          <div class="card-body stack">
            <label class="field"><span>Project name</span><input class="input" name="projectName" required maxlength="120" value="${esc(p.projectName)}" /></label>
            <label class="field"><span>Site address</span><textarea name="siteAddress" rows="2" required maxlength="300">${esc(p.siteAddress)}</textarea></label>
            <label class="field"><span>Paste a Google Maps link <span class="muted">(optional)</span></span><input class="input" id="maps-link" placeholder="https://maps.google.com/…@17.4435,78.3772…" /><span class="hint">We'll read the coordinates from it.</span></label>
            <div class="grid-2"><label class="field"><span>Latitude</span><input class="input" name="latitude" type="number" step="any" required value="${esc(p.latitude)}" /></label>
              <label class="field"><span>Longitude</span><input class="input" name="longitude" type="number" step="any" required value="${esc(p.longitude)}" /></label></div>
            <iframe class="map-frame" id="map" title="Site location" loading="lazy" referrerpolicy="no-referrer" src="${mapSrc(p.latitude, p.longitude)}"></iframe>
            <div class="row"><span class="spacer"></span><button class="btn primary" type="submit">${icon('check')}Save project</button></div>
          </div></form>
        <div class="card"><div class="card-head"><span class="section-icon red">${icon('file')}</span><div><h2>Brochure</h2><p>PDF up to 20 MB, sent after the budget question</p></div></div>
          <div class="card-body stack" id="brochure-box"></div></div>
      </div></div>`;
    const form = $('#project-form');
    const updateMap = debounce(() => {
      const lat = Number(form.latitude.value); const lng = Number(form.longitude.value);
      if (Number.isFinite(lat) && Number.isFinite(lng)) $('#map').src = mapSrc(lat, lng);
    }, 600);
    form.latitude.addEventListener('input', updateMap);
    form.longitude.addEventListener('input', updateMap);
    $('#maps-link').addEventListener('input', (e) => {
      const v = e.target.value;
      const m = v.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || v.match(/[?&](?:q|ll|query)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || v.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
      if (m) { form.latitude.value = m[1]; form.longitude.value = m[2]; updateMap(); toast('Coordinates found', `${m[1]}, ${m[2]}`, { kind: 'info' }); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        const res = await api('PATCH', `/tenants/${state.tenantId}`, { projectDetails: { projectName: form.projectName.value, siteAddress: form.siteAddress.value, latitude: form.latitude.value, longitude: form.longitude.value } });
        state.tenant = res.data;
        updateTenantInList(res.data);
        toast('Project saved', 'Buyers get the updated details from their next message.');
        log('Project details saved.', 'success');
      } catch (err) { toast('Could not save', err.message, { kind: 'error' }); } finally { btn.disabled = false; }
    });
    renderBrochure();
  }

  function renderBrochure() {
    const p = state.tenant.projectDetails; const box = $('#brochure-box');
    const name = p.brochurePdfUrl ? decodeURIComponent(p.brochurePdfUrl.split('/').pop().replace(/^\d+_/, '')) : '';
    box.innerHTML = `${p.brochurePdfUrl ? `<div class="brochure-card"><span class="file-ico">PDF</span><div class="grow" style="min-width:0"><strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</strong><span class="hint">Currently sent to buyers</span></div>
        <a class="btn sm" href="${esc(p.brochurePdfUrl)}" target="_blank" rel="noopener">${icon('external', 'sm')}Open</a><button class="btn sm danger" id="brochure-remove">${icon('trash', 'sm')}</button></div>`
      : `<div class="banner">${icon('info')}<div>No brochure yet — the bot will skip it until you upload one.</div></div>`}
      <label class="dropzone" id="pdf-drop"><input type="file" id="pdf-file" accept="application/pdf,.pdf" /><span class="section-icon red">${icon('upload', 'lg')}</span>
        <strong>${p.brochurePdfUrl ? 'Replace brochure' : 'Upload brochure'}</strong><span class="hint">Drop a PDF here or click to choose</span></label>
      <div id="pdf-progress"></div>`;
    wireDropzone($('#pdf-drop'), $('#pdf-file'), async (file) => {
      if (!file) return;
      if (!/\.pdf$/i.test(file.name)) return toast('Please choose a PDF', '', { kind: 'warn' });
      $('#pdf-progress').innerHTML = `<div class="banner blue"><span class="spinner"></span><div>Uploading ${esc(file.name)}…</div></div>`;
      try {
        const res = await uploadFile(`/uploads/brochure/${state.tenantId}`, file);
        state.tenant.projectDetails.brochurePdfUrl = res.data.brochurePdfUrl;
        toast('Brochure uploaded', 'New buyers get this PDF from now on.');
        log('Brochure uploaded.', 'success');
        renderBrochure(); hydrateIcons(box);
      } catch (err) { $('#pdf-progress').innerHTML = `<div class="banner red">${icon('alert')}<div>${esc(err.message)}</div></div>`; }
    });
    $('#brochure-remove')?.addEventListener('click', async () => {
      if (!confirm('Stop sending the brochure to buyers?')) return;
      try {
        const res = await api('PATCH', `/tenants/${state.tenantId}`, { projectDetails: { brochurePdfUrl: null } });
        state.tenant = res.data; renderBrochure(); hydrateIcons(box); toast('Brochure removed');
      } catch (err) { toast('Could not remove', err.message, { kind: 'error' }); }
    });
  }

  function updateTenantInList(t) {
    const i = state.tenants.findIndex((x) => x._id === t._id);
    if (i >= 0) state.tenants[i] = t;
    if (isAdmin()) $('#tenant-select').innerHTML = state.tenants.map((x) => `<option value="${x._id}" ${x._id === state.tenantId ? 'selected' : ''}>${esc(x.businessName)} · ${esc(x.projectDetails?.projectName || '')}</option>`).join('');
  }

  // ============================================================
  // Settings
  // ============================================================
  function renderSettings() {
    const t = state.tenant; const tp = t.templates || {};
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Settings</h1><p>Your business details, team alerts and WhatsApp templates.</p></div></div>
      <div class="overview-grid">
        <div class="stack">
          <form class="card" id="biz-form"><div class="card-head"><span class="section-icon">${icon('building')}</span><div><h2>Business</h2><p>Shown to your team and in bot messages</p></div></div>
            <div class="card-body stack">
              <label class="field"><span>Business name</span><input class="input" name="businessName" required maxlength="120" value="${esc(t.businessName)}" /></label>
              <label class="field"><span>Team alert number</span><input class="input" name="adminNotificationPhone" required value="${esc(t.adminNotificationPhone)}" inputmode="tel" />
                <span class="hint">Gets a WhatsApp alert for every booked visit and every lead that needs a call. Include the country code.</span></label>
              <div class="row"><span class="spacer"></span><button class="btn primary" type="submit">${icon('check')}Save</button></div></div></form>
          <form class="card" id="tpl-form"><div class="card-head"><span class="section-icon indigo">${icon('template')}</span><div><h2>WhatsApp templates</h2><p>Names of templates approved in your Meta Business account</p></div></div>
            <div class="card-body stack">
              <div class="grid-2"><label class="field"><span>Broadcast template</span><input class="input" name="broadcastName" placeholder="realestate_reengage_v1" value="${esc(tp.broadcastName || '')}" /></label>
                <label class="field"><span>Language</span><input class="input" name="broadcastLanguage" placeholder="en" value="${esc(tp.broadcastLanguage || '')}" /></label></div>
              <label class="switch"><input type="checkbox" name="broadcastHasParams" ${tp.broadcastHasParams === false ? '' : 'checked'} /><span class="track"></span>Template uses {{1}} customer name and {{2}} project name</label>
              <div class="grid-2"><label class="field"><span>Team alert template</span><input class="input" name="adminAlertName" placeholder="admin_lead_alert" value="${esc(tp.adminAlertName || '')}" /></label>
                <label class="field"><span>Language</span><input class="input" name="adminAlertLanguage" placeholder="en" value="${esc(tp.adminAlertLanguage || '')}" /></label></div>
              <div class="banner blue">${icon('info')}<div>Without an alert template, alerts are plain messages that WhatsApp only delivers if your alert number messaged the business number in the last 24 hours. Alert template variables: {{1}} headline, {{2}} lead name, {{3}} phone, {{4}} details.</div></div>
              <span class="hint">Leave a name empty to use the server default.</span>
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
              <label class="field"><span>New access token</span><input class="input" name="accessToken" type="password" autocomplete="off" placeholder="Leave empty to keep the current token" /></label>
              <label class="switch"><input type="checkbox" name="isActive" ${t.isActive ? 'checked' : ''} /><span class="track"></span>Account active</label>
              <div class="row"><button class="btn danger" type="button" id="rotate-key">${icon('key')}New API key</button><span class="spacer"></span><button class="btn primary" type="submit">${icon('check')}Save</button></div></div></form>` : ''}
        </div></div></div>`;

    const save = async (form, body, okMsg) => {
      const btn = $('button[type=submit]', form); btn.disabled = true;
      try {
        const res = await api('PATCH', `/tenants/${state.tenantId}`, body);
        state.tenant = res.data; updateTenantInList(res.data);
        toast(okMsg); log(okMsg, 'success');
        return true;
      } catch (err) { toast('Could not save', err.message, { kind: 'error', timeout: 7000 }); return false; } finally { btn.disabled = false; }
    };
    $('#biz-form').addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; save(f, { businessName: f.businessName.value, adminNotificationPhone: f.adminNotificationPhone.value }, 'Business details saved'); });
    $('#tpl-form').addEventListener('submit', (e) => {
      e.preventDefault(); const f = e.target;
      save(f, { templates: { broadcastName: f.broadcastName.value, broadcastLanguage: f.broadcastLanguage.value, broadcastHasParams: f.broadcastHasParams.checked, adminAlertName: f.adminAlertName.value, adminAlertLanguage: f.adminAlertLanguage.value } }, 'Templates saved');
    });
    if (isAdmin()) {
      $('#admin-form').addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target;
        const body = { tier: Number(f.tier.value), wabaId: f.wabaId.value, isActive: f.isActive.checked };
        if (f.accessToken.value.trim()) body.accessToken = f.accessToken.value.trim();
        if (await save(f, body, 'Account settings saved')) f.accessToken.value = '';
      });
      $('#rotate-key').addEventListener('click', () => rotateKey(state.tenant));
    }
  }

  async function rotateKey(t) {
    if (!confirm(`Create a new API key for ${t.businessName}? Their current key stops working immediately.`)) return;
    try {
      const { apiKey } = await api('POST', `/tenants/${t._id}/rotate-key`);
      showKey(`New key for ${t.businessName}`, apiKey);
      log(`API key rotated for ${t.businessName}.`, 'warn');
    } catch (err) { toast('Could not rotate key', err.message, { kind: 'error' }); }
  }

  function showKey(title, key) {
    modal(`<div class="card-head"><span class="section-icon">${icon('key')}</span><div><h2>${esc(title)}</h2><p>Copy it now — it will not be shown again.</p></div></div>
      <div class="card-body stack"><div class="key-reveal"><code id="key-text">${esc(key)}</code><button class="btn sm" id="copy-key">${icon('copy', 'sm')}Copy</button></div>
      <span class="hint">Share it privately with the client. They sign in to this dashboard with it.</span></div>
      <div class="modal-foot"><button class="btn primary" data-close>Done</button></div>`, {
      onMount: (root) => $('#copy-key', root).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(key); toast('Key copied'); } catch { toast('Copy failed — select the key and copy it manually', '', { kind: 'warn' }); }
      }),
    });
  }

  // ============================================================
  // Clients (admin)
  // ============================================================
  function renderClients() {
    $('#page').innerHTML = `<div class="page-inner">
      <div class="page-head"><div><h1>Clients</h1><p>Every vendor account on this server.</p></div><span class="spacer"></span><button class="btn primary" id="new-client">${icon('plus')}New client</button></div>
      <div class="clients" id="client-list"></div></div>`;
    const list = $('#client-list');
    list.innerHTML = state.tenants.length ? state.tenants.map((t) => `
      <div class="card client">
        <div class="row">${avatar(t.businessName, t._id)}<div style="min-width:0"><strong>${esc(t.businessName)}</strong><div class="muted small">${esc(t.projectDetails?.projectName || '')}</div></div><span class="spacer"></span>${t.isActive ? '<span class="pill d-READ">Active</span>' : '<span class="pill d-FAILED">Paused</span>'}</div>
        <dl class="kv"><dt>Phone ID</dt><dd><code>${esc(t.phoneNumberId)}</code></dd><dt>Tier</dt><dd>${t.tier ?? 0}</dd><dt>Brochure</dt><dd>${t.projectDetails?.brochurePdfUrl ? 'Uploaded' : '<span class="muted">None</span>'}</dd></dl>
        <div class="row"><button class="btn sm" data-open="${t._id}">${icon('grid', 'sm')}Open dashboard</button><span class="spacer"></span><button class="btn sm ghost" data-rotate="${t._id}">${icon('key', 'sm')}New key</button></div>
      </div>`).join('') : `<div class="card" style="grid-column:1/-1"><div class="empty"><span class="section-icon">${icon('building', 'lg')}</span><h3>No clients yet</h3><p>Add your first vendor to start.</p></div></div>`;
    $$('[data-open]', list).forEach((b) => b.addEventListener('click', async () => { await selectTenant(b.dataset.open, { silent: true }); location.hash = '#/overview'; }));
    $$('[data-rotate]', list).forEach((b) => b.addEventListener('click', () => rotateKey(state.tenants.find((t) => t._id === b.dataset.rotate))));
    $('#new-client').addEventListener('click', newClientModal);
  }

  function newClientModal() {
    modal(`<form id="client-form"><div class="card-head"><span class="section-icon">${icon('plus')}</span><div><h2>New client</h2><p>Connect a vendor's WhatsApp Business number</p></div><span class="spacer"></span><button type="button" class="btn icon ghost" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="card-body stack">
        <div class="grid-2">
          <label class="field"><span>Business name</span><input class="input" name="businessName" required /></label>
          <label class="field"><span>Project name</span><input class="input" name="projectName" required /></label>
          <label class="field"><span>Phone number ID</span><input class="input" name="phoneNumberId" required /></label>
          <label class="field"><span>WABA ID</span><input class="input" name="wabaId" required /></label>
          <label class="field span-2"><span>Access token</span><input class="input" name="accessToken" type="password" autocomplete="off" required placeholder="EAA…" /></label>
          <label class="field"><span>Team alert number</span><input class="input" name="adminNotificationPhone" required placeholder="919876543210" /></label>
          <label class="field"><span>Tier</span><select name="tier">${[0, 1, 2, 3].map((n) => `<option value="${n}">Tier ${n}</option>`).join('')}</select></label>
          <label class="field span-2"><span>Site address</span><input class="input" name="siteAddress" required /></label>
          <label class="field"><span>Latitude</span><input class="input" name="latitude" type="number" step="any" required /></label>
          <label class="field"><span>Longitude</span><input class="input" name="longitude" type="number" step="any" required /></label>
          <label class="field span-2"><span>Brochure PDF <span class="muted">(optional)</span></span><input class="input" name="brochure" type="file" accept="application/pdf" style="padding-top:7px" /></label>
        </div><p class="form-error" id="client-error"></p></div>
      <div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${icon('check')}Create client</button></div></form>`, {
      wide: true,
      onMount: (root, close) => {
        $('#client-form', root).addEventListener('submit', async (e) => {
          e.preventDefault(); const f = e.target; const btn = $('button[type=submit]', f);
          btn.disabled = true; $('#client-error', root).textContent = '';
          try {
            const res = await api('POST', '/tenants', {
              businessName: f.businessName.value, phoneNumberId: f.phoneNumberId.value, wabaId: f.wabaId.value, accessToken: f.accessToken.value,
              adminNotificationPhone: f.adminNotificationPhone.value, tier: Number(f.tier.value),
              projectDetails: { projectName: f.projectName.value, latitude: Number(f.latitude.value), longitude: Number(f.longitude.value), siteAddress: f.siteAddress.value },
            });
            const file = f.brochure.files[0];
            if (file) { try { await uploadFile(`/uploads/brochure/${res.tenant._id}`, file); } catch (err) { toast('Client created, brochure failed', err.message, { kind: 'warn' }); } }
            close();
            log(`Client ${res.tenant.businessName} created.`, 'success');
            await loadTenants();
            renderNav(); route();
            showKey(`API key for ${res.tenant.businessName}`, res.apiKey);
          } catch (err) {
            $('#client-error', root).textContent = err.data?.errors ? err.data.errors.map((x) => `${x.path}: ${x.msg}`).join(' · ') : err.message;
            btn.disabled = false;
          }
        });
      },
    });
  }

  // ============================================================
  // Activity log
  // ============================================================
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
  // Keep "reply window closes in…" fresh.
  setInterval(() => { if (state.route.page === 'inbox' && state.inbox?.lead && !$('#reply-text')?.value) renderComposer(); }, 60e3);
  if (getKey()) startSession(); else showLogin();
})();
