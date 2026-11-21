const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const logger = require('../utils/logger');

// Meta retires Graph API versions roughly two years after release; override via .env when bumping.
const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v25.0';

const http = axios.create({ timeout: 15000 });

axiosRetry(http, {
  retries: 3,
  retryDelay: (retryCount) => {
    logger.warn(`[MetaAPI] Retrying request (attempt ${retryCount})...`);
    return retryCount * 500;
  },
  retryCondition: (error) =>
    axiosRetry.isNetworkOrIdempotentRequestError(error) ||
    error.response?.status === 429 ||
    error.response?.status >= 500,
});

class MetaApiClient {
  constructor(accessToken, phoneNumberId) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.endpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  }

  headers() {
    return { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' };
  }

  async _post(payload, context = '') {
    try {
      logger.debug(`[MetaAPI] Sending ${context} to ${payload.to}...`);
      const res = await http.post(this.endpoint, payload, { headers: this.headers() });
      logger.info(`[MetaAPI] ${context} sent successfully to ${payload.to}. MsgID: ${res.data?.messages?.[0]?.id || 'N/A'}`);
      return res.data;
    } catch (err) {
      const detail = err.response?.data?.error?.message || err.message;
      logger.error(`[MetaAPI] ${context} FAILED for ${payload.to}: ${detail}`);
      throw err;
    }
  }

  // bodyParams: array of strings for {{1}}, {{2}}...; pass [] for templates without variables (e.g. hello_world).
  sendTemplate(toPhone, templateName, bodyParams = [], languageCode = 'en') {
    const template = { name: templateName, language: { code: languageCode } };
    if (bodyParams.length) {
      template.components = [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })) }];
    }
    return this._post({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: toPhone, type: 'template', template,
    }, 'sendTemplate');
  }

  sendQuickReplies(toPhone, bodyText, buttons) {
    return this._post({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: toPhone, type: 'interactive',
      interactive: {
        type: 'button', body: { text: bodyText },
        action: { buttons: buttons.map((btn) => ({ type: 'reply', reply: { id: btn.id, title: btn.title } })) },
      },
    }, 'sendQuickReplies');
  }

  sendListMenu(toPhone, headerText, bodyText, buttonLabel, sections) {
    return this._post({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: toPhone, type: 'interactive',
      interactive: {
        type: 'list', header: { type: 'text', text: headerText }, body: { text: bodyText },
        action: { button: buttonLabel, sections },
      },
    }, 'sendListMenu');
  }

  sendDocument(toPhone, documentUrl, fileName, caption) {
    return this._post({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: toPhone, type: 'document',
      document: { link: documentUrl, filename: fileName, caption },
    }, 'sendDocument');
  }

  sendLocation(toPhone, latitude, longitude, name, address) {
    return this._post({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: toPhone, type: 'location',
      location: { latitude, longitude, name, address },
    }, 'sendLocation');
  }

  sendTextMessage(toPhone, textBody) {
    return this._post({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: toPhone, type: 'text',
      text: { preview_url: false, body: textBody },
    }, 'sendTextMessage');
  }
}

module.exports = MetaApiClient;