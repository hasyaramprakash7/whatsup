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

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Bluxury WhatsApp AI', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // The open dashboard already shows new messages on screen; skip the duplicate (Apple requires one every time).
    const onScreen = wins.some((w) => w.focused && w.visibilityState === 'visible');
    if (onScreen && d.kind === 'message' && !isApple) {
      wins.forEach((w) => w.postMessage({ type: 'push', data: d }));
      return;
    }
    if (self.navigator.setAppBadge && d.kind === 'message') self.navigator.setAppBadge().catch(() => {});
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

// The browser rotated this device's push keys: tell the app to save the new ones next time it opens.
self.addEventListener('pushsubscriptionchange', () => {});
