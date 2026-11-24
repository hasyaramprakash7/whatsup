// Lets the dashboard be installed as an app. It caches nothing, so every visit gets the latest
// dashboard and live data; it only shows a friendly page when the phone has no internet.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Agent Desk</title>'
    + '<body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0b1220;color:#e2e8f0;text-align:center;padding:24px">'
    + '<div><h1 style="font-size:20px">You\'re offline</h1><p style="color:#94a3b8">Check your internet connection, then try again.</p>'
    + '<button onclick="location.reload()" style="margin-top:12px;height:44px;padding:0 20px;border:0;border-radius:12px;background:#10b981;color:#fff;font:inherit;font-weight:600">Try again</button></div></body>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )));
});
