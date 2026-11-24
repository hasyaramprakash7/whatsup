// Minimal WhatsApp Cloud API client (fetch-based) with retries for rate limits and server errors.

export class WhatsAppError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
  /** 4xx errors (other than rate limits) won't succeed on retry, e.g. #131030 number not allowed. */
  get permanent() { return this.status >= 400 && this.status < 500 && this.status !== 429 && this.code !== 130429 && this.code !== 131056; }
  get text() { return `${this.code ? `${this.code}: ` : ''}${this.details || this.message}`; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class WhatsAppClient {
  /** onSent(payload, response) runs after each successful send (e.g. to log it to the Inbox). */
  constructor(env, { accessToken, phoneNumberId }, { onSent } = {}) {
    const base = String(env.GRAPH_BASE_URL || 'https://graph.facebook.com').replace(/\/$/, '');
    this.endpoint = `${base}/${env.GRAPH_API_VERSION || 'v25.0'}/${phoneNumberId}/messages`;
    this.accessToken = accessToken;
    this.onSent = onSent || null;
  }

  async post(payload) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await sleep(attempt * 600);
      let res;
      try {
        res = await fetch(this.endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
        });
      } catch (err) {
        lastErr = new WhatsAppError(`Network error: ${err.message}`, { status: 0 });
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (this.onSent) await Promise.resolve(this.onSent(payload, data)).catch((e) => console.warn('[WhatsApp] onSent hook failed', e.message));
        return data;
      }
      const e = data?.error || {};
      lastErr = new WhatsAppError(e.message || `HTTP ${res.status}`, { status: res.status, code: e.code, details: e.error_data?.details || e.message });
      if (lastErr.permanent) break;
    }
    throw lastErr;
  }

  text(to, body) { return this.post({ to, type: 'text', text: { preview_url: false, body } }); }

  /** Reply buttons; `headerImage` (public JPEG/PNG URL) shows a photo above the question. */
  buttons(to, body, buttons, headerImage = null) {
    return this.post({ to, type: 'interactive', interactive: {
      type: 'button', ...(headerImage ? { header: { type: 'image', image: { link: headerImage } } } : {}),
      body: { text: body }, action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
    } });
  }

  /** A photo with an optional caption (JPEG/PNG, ≤ 5 MB, caption ≤ 1024 characters). */
  /** Message with a "Send location" button; the customer's reply arrives as a normal location message. */
  locationRequest(to, body) { return this.post({ to, type: 'interactive', interactive: { type: 'location_request_message', body: { text: body.slice(0, 1024) }, action: { name: 'send_location' } } }); }

  image(to, link, caption) { return this.post({ to, type: 'image', image: { link, ...(caption ? { caption: caption.slice(0, 1024) } : {}) } }); }

  list(to, { header, body, button, sections }) {
    return this.post({ to, type: 'interactive', interactive: { type: 'list', ...(header ? { header: { type: 'text', text: header } } : {}), body: { text: body }, action: { button, sections } } });
  }

  document(to, link, filename, caption) { return this.post({ to, type: 'document', document: { link, filename, ...(caption ? { caption } : {}) } }); }

  location(to, { latitude, longitude, name, address }) { return this.post({ to, type: 'location', location: { latitude, longitude, name, address } }); }

  template(to, name, params = [], language = 'en') {
    const template = { name, language: { code: language } };
    if (params.length) template.components = [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t) })) }];
    return this.post({ to, type: 'template', template });
  }
}
