// Bluxury WhatsApp AI — background script.
// Lets the dashboard install as an app and shows phone notifications even when the app is closed.
// It caches nothing, so every visit gets the latest dashboard and live data.
const ICON = '/icon-192.png';
const BADGE = '/badge-96.png';
const isApple = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent) && !/Chrome|Android/.test(self.navigator.userAgent);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Bluxury WhatsApp AI</title>'
    + '<body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:radial-gradient(circle at 50% 20%,#1e967c,#022a21 70%);color:#f3e3b5;text-align:center;padding:24px">'
    + '<div><img src="/brand-logo.png" alt="Bluxury" style="width:180px;max-width:60vw"><p style="letter-spacing:.3em;font-size:13px;margin:8px 0 28px">WHATSAPP AI</p>'
    + '<h1 style="font-size:20px;color:#fff">You\'re offline</h1><p style="color:#cfe7df">Check your internet connection, then try again.</p>'
    + '<button onclick="location.reload()" style="margin-top:12px;height:44px;padding:0 22px;border:0;border-radius:12px;background:linear-gradient(135deg,#f6d77a,#c8962e);color:#2a1d00;font:inherit;font-weight:700">Try again</button></div></body>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )));
});

/** True only if an open dashboard page answers (within 600 ms) that this exact chat is open on screen right now. */
async function chatOnScreen(phone) {
  const wins = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter((w) => w.visibilityState === 'visible');
  if (!wins.length) return false;
  const answers = await Promise.all(wins.map((w) => new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 600);
    ch.port1.onmessage = (ev) => { clearTimeout(timer); resolve(!!(ev.data && ev.data.onScreen)); };
    try { w.postMessage({ type: 'push-check', phone }, [ch.port2]); } catch { clearTimeout(timer); resolve(false); }
  })));
  return answers.some(Boolean);
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Bluxury WhatsApp AI', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // Like WhatsApp: every message notifies, except the chat you are reading right now.
    // Phones keep backgrounded apps "visible" but frozen, so ask the page itself: a frozen page can't answer → notify.
    try {
      const phone = (String(d.url || '').match(/#\/inbox\/(\d+)/) || [])[1];
      if (d.kind === 'message' && phone && !isApple && await chatOnScreen(phone)) return;
    } catch { /* when unsure, notify */ }
    try { if (d.kind === 'message' && self.navigator.setAppBadge) { const p = self.navigator.setAppBadge(); if (p && p.catch) p.catch(() => {}); } } catch { /* badge is optional */ }
    await self.registration.showNotification(d.title || 'Bluxury WhatsApp AI', {
      body: d.body || '',
      icon: ICON,
      badge: BADGE,
      tag: d.tag || d.kind || 'bluxury',
      renotify: true,
      requireInteraction: d.kind === 'handoff' || d.kind === 'booking',
      timestamp: d.at || Date.now(),
      vibrate: [120, 60, 120],
      data: { url: d.url || '/#/overview', kind: d.kind, tenantId: d.tenantId },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { url = '/#/overview', tenantId } = e.notification.data || {};
  const target = new URL(url, self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) {
      win.postMessage({ type: 'open', url, tenantId });
      try { await win.focus(); } catch { /* not allowed */ }
      return;
    }
    // ?t= tells the app which business to show (admins can see several).
    await self.clients.openWindow(tenantId ? target.replace(/\/?#/, `/?t=${encodeURIComponent(tenantId)}#`) : target);
  })());
});

// The browser replaced this device's notification address: save the new one right away, so alerts keep coming
// even if the app is not opened again. (If the browser doesn't say which was the old one, the app fixes it on next open.)
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const old = e.oldSubscription;
    let sub = e.newSubscription;
    if (!sub && old?.options?.applicationServerKey) {
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: old.options.applicationServerKey });
    }
    if (!sub || !old) return;
    await fetch('/push/renew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldEndpoint: old.endpoint, subscription: sub.toJSON() }) });
  })().catch(() => {}));
});
