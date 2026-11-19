const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const logger = require('../utils/logger');

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
    this.endpoint = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
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

  sendTemplate(toPhone, templateName, customerName, projectName) {
    return this._post({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: toPhone, type: 'template',
      template: {
        name: templateName, language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: customerName }, { type: 'text', text: projectName }] }],
      },
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