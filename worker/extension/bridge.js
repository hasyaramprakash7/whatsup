// On the Bluxury dashboard only: passes the page's requests to the extension and the answers back.
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.bx !== 'req') return;
    const { id, msg } = e.data;
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        const err = chrome.runtime.lastError;
        window.postMessage({ bx: 'res', id, res: err ? { ok: false, error: err.message } : res }, location.origin);
      });
    } catch (err) {
      window.postMessage({ bx: 'res', id, res: { ok: false, error: 'The helper extension was updated. Reload this page.' } }, location.origin);
    }
  });
  const hello = () => window.postMessage({ bx: 'hello', version: VERSION }, location.origin);
  hello(); document.addEventListener('DOMContentLoaded', hello);
  window.addEventListener('message', (e) => { if (e.source === window && e.data?.bx === 'who') hello(); });
})();
