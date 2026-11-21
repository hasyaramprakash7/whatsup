const redis = require('../config/redis');
const Lead = require('../models/Lead');
const MetaApiClient = require('./metaApiClient');
const logger = require('../utils/logger');
const { buildVisitSlots, parseSlotId, formatSlotLong } = require('../utils/visitSlots');
const { getBotContent, fill } = require('./botContent');
const { outboundRecorder } = require('./chatLog');
const { publish } = require('./realtime');

const SESSION_TTL = 86400;
// Re-ask a question this many times when the lead types instead of tapping, then hand off to a human.
const MAX_UNEXPECTED_REPLIES = 2;

// Free-form texts only reach the admin if they messaged the business number in the last 24h.
// An approved template is delivered at any time. Expected body variables (no line breaks allowed in values):
//   {{1}} alert headline, {{2}} lead name, {{3}} lead phone, {{4}} details
// Each vendor can set their own template in the dashboard; these .env values are the fallback.
const ENV_ADMIN_TEMPLATE = process.env.ADMIN_ALERT_TEMPLATE_NAME || '';
const ENV_ADMIN_TEMPLATE_LANG = process.env.ADMIN_ALERT_TEMPLATE_LANG || 'en';
if (!ENV_ADMIN_TEMPLATE) {
  logger.warn('[Admin Alerts] ADMIN_ALERT_TEMPLATE_NAME is not set — vendors without their own alert template get plain-text alerts, which WhatsApp only delivers if the admin messaged the business number in the last 24h.');
}

const OPT_OUT_TEXTS = ['stop', 'unsubscribe', 'opt out', 'optout', 'not interested'];

/** Ignores case, punctuation and extra spaces, so "Stop." or "NOT interested!!" also opt out. */
function isOptOutMessage(message, interactiveId) {
  if (interactiveId === 'NOT_INTERESTED') return true;
  const text = (message?.text?.body || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return OPT_OUT_TEXTS.includes(text);
}

function interactiveIdOf(message) {
  if (message?.type === 'interactive') {
    if (message.interactive?.type === 'button_reply') return message.interactive.button_reply.id;
    if (message.interactive?.type === 'list_reply') return message.interactive.list_reply.id;
  } else if (message?.type === 'button') {
    return message.button?.payload || null;
  }
  return null;
}

class ConversationEngine {
  constructor(tenant) {
    this.tenant = tenant;
    this.content = getBotContent(tenant);
    // Messages to leads are logged to the Inbox; admin alerts are not part of any lead's chat.
    this.client = new MetaApiClient(tenant.accessToken, tenant.phoneNumberId, { onSent: outboundRecorder(tenant._id, 'bot') });
    this.adminClient = new MetaApiClient(tenant.accessToken, tenant.phoneNumberId);
  }

  static isOptOut(message) {
    return isOptOutMessage(message, interactiveIdOf(message));
  }

  sessionKey(phone) {
    return `session:${this.tenant._id}:${phone}`;
  }

  unexpectedKey(sessionKey) {
    return `${sessionKey}:unexpected`;
  }

  /** Placeholder values for bot texts. */
  vars(extra = {}) {
    const p = this.tenant.projectDetails || {};
    return { project: p.projectName, address: p.siteAddress, adminPhone: this.tenant.adminNotificationPhone, ...extra };
  }

  text(key, extra) {
    return fill(this.content[key], this.vars(extra));
  }

  async upsertLead(phone, patch) {
    let lead;
    try {
      lead = await Lead.findOneAndUpdate(
        { tenantId: this.tenant._id, phone },
        { $set: patch },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (err) {
      if (err.code !== 11000) throw err;
      lead = await Lead.findOneAndUpdate({ tenantId: this.tenant._id, phone }, { $set: patch }, { new: true });
    }
    if (lead) publish(this.tenant._id, 'lead:update', { lead: lead.toObject ? lead.toObject() : lead });
    return lead;
  }

  async handleInboundMessage(fromPhone, message) {
    const key = this.sessionKey(fromPhone);
    let state = (await redis.get(key)) || 'INIT';
    logger.info(`[State Machine] +${fromPhone} | Current State: ${state} | Message Type: ${message.type}`);

    const interactiveId = interactiveIdOf(message);

    if (isOptOutMessage(message, interactiveId)) {
      logger.info(`[State Machine] +${fromPhone} opted out (Payload: ${interactiveId}, Text: ${message.text?.body || ''})`);
      await this.upsertLead(fromPhone, { status: 'COLD' });
      await redis.del(key, this.unexpectedKey(key));
      try {
        await this.client.sendTextMessage(fromPhone, this.text('optOutText'));
      } catch (err) {
        logger.warn(`[Opt-Out Ack Failed] +${fromPhone}: ${err.message}`);
      }
      return;
    }

    if (state === 'INIT' && interactiveId && interactiveId.startsWith('CONF_')) {
      logger.info(`[State Machine] +${fromPhone} bypassed INIT via template button payload.`);
      state = 'AWAITING_CONFIG';
    }

    try {
      switch (state) {
        case 'INIT':
          return await this.stepStart(fromPhone, key);
        case 'AWAITING_CONFIG':
          return await this.stepHandleConfig(fromPhone, interactiveId, key, message);
        case 'AWAITING_BUDGET':
          return await this.stepHandleBudget(fromPhone, interactiveId, key, message);
        case 'AWAITING_SLOT':
          return await this.stepHandleSlot(fromPhone, interactiveId, key, message);
        case 'COMPLETED':
          logger.debug(`[State Machine] +${fromPhone} is already COMPLETED. Sending standard reply.`);
          return await this.client.sendTextMessage(fromPhone, this.text('completedText'));
        default:
          logger.warn(`[State Machine] +${fromPhone} hit unknown state '${state}'. Resetting to INIT.`);
          await redis.del(key);
          return await this.stepStart(fromPhone, key);
      }
    } catch (err) {
      logger.error(`[State Machine] Error during step execution for +${fromPhone}: ${err.message}`);
      try {
        await this.client.sendTextMessage(fromPhone, this.text('errorText'));
      } catch (_) {}
    }
  }

  // ---- Questions (sent fresh, or re-sent after an unexpected reply) ----

  askConfiguration(fromPhone) {
    const options = this.content.configOptions;
    const body = this.text('welcomeText');
    // WhatsApp allows at most 3 reply buttons; more options go in a list.
    if (options.length <= 3) {
      return this.client.sendQuickReplies(fromPhone, body, options.map((o) => ({ id: o.id, title: o.title || o.label })));
    }
    return this.client.sendListMenu(fromPhone, this.text('configListHeader'), body, this.text('configListButton'), [
      { title: this.text('configSectionTitle'), rows: options.map((o) => ({ id: o.id, title: o.title || o.label })) },
    ]);
  }

  async askBudget(fromPhone, configLabel) {
    const body = this.text('budgetText', { configuration: configLabel || 'your home' });
    return this.client.sendListMenu(fromPhone, this.text('budgetHeader', { configuration: configLabel || 'your home' }), body, this.text('budgetButtonLabel'), [
      { title: this.text('budgetSectionTitle'), rows: this.content.budgetOptions.map((o) => ({ id: o.id, title: o.title || o.label, ...(o.description ? { description: o.description } : {}) })) },
    ]);
  }

  askVisitSlot(fromPhone) {
    const slots = buildVisitSlots(new Date(), 3, this.content.slotPlan);
    return this.client.sendQuickReplies(fromPhone, this.text('slotText'), slots.map((s) => ({ id: s.id, title: s.title })));
  }

  // ---- Steps ----

  async stepStart(fromPhone, key) {
    logger.info(`[State Machine] Transitioning +${fromPhone} to AWAITING_CONFIG.`);
    await this.askConfiguration(fromPhone);
    await redis.set(key, 'AWAITING_CONFIG', 'EX', SESSION_TTL);
    await redis.del(this.unexpectedKey(key));
    await this.upsertLead(fromPhone, { status: 'ENGAGED' });
  }

  async stepHandleConfig(fromPhone, interactiveId, key, message) {
    const option = this.content.configOptions.find((o) => o.id === interactiveId);
    if (!option) return this.handleUnexpectedReply(fromPhone, key, message, () => this.askConfiguration(fromPhone));

    logger.info(`[State Machine] +${fromPhone} selected config: ${option.label}. Transitioning to AWAITING_BUDGET.`);
    await redis.del(this.unexpectedKey(key));
    await this.upsertLead(fromPhone, { configuration: option.label, status: 'ENGAGED' });
    await this.askBudget(fromPhone, option.label);
    await redis.set(key, 'AWAITING_BUDGET', 'EX', SESSION_TTL);
  }

  async stepHandleBudget(fromPhone, interactiveId, key, message) {
    const option = this.content.budgetOptions.find((o) => o.id === interactiveId);
    if (!option) {
      return this.handleUnexpectedReply(fromPhone, key, message, async () => {
        const lead = await Lead.findOne({ tenantId: this.tenant._id, phone: fromPhone }).select('configuration').lean();
        const configLabel = lead?.configuration && lead.configuration !== 'Unspecified' ? lead.configuration : null;
        return this.askBudget(fromPhone, configLabel);
      });
    }

    logger.info(`[State Machine] +${fromPhone} selected budget: ${option.label}. Transitioning to AWAITING_SLOT.`);
    await redis.del(this.unexpectedKey(key));
    const lead = await this.upsertLead(fromPhone, { budget: option.label, status: 'QUALIFIED' });

    const { brochurePdfUrl, projectName } = this.tenant.projectDetails;
    if (brochurePdfUrl) {
      logger.debug(`[State Machine] Sending brochure document to +${fromPhone} from R2 URL.`);
      try {
        const fileName = `${this.text('brochureFileName').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '').trim() || projectName}.pdf`;
        await this.client.sendDocument(fromPhone, brochurePdfUrl, fileName,
          this.text('brochureCaption', { name: lead?.name, configuration: lead?.configuration, budget: option.label }));
      } catch (err) {
        logger.warn(`[Brochure send failed] +${fromPhone}: ${err.message}`);
      }
    } else {
      logger.warn(`[State Machine] Tenant ${this.tenant._id} has no brochure URL — skipping document.`);
    }

    await this.askVisitSlot(fromPhone);
    await redis.set(key, 'AWAITING_SLOT', 'EX', SESSION_TTL);
  }

  async stepHandleSlot(fromPhone, interactiveId, key, message) {
    const visitAt = parseSlotId(interactiveId);
    if (!visitAt) return this.handleUnexpectedReply(fromPhone, key, message, () => this.askVisitSlot(fromPhone));

    if (visitAt.getTime() <= Date.now()) {
      logger.info(`[State Machine] +${fromPhone} tapped a slot that has passed (${visitAt.toISOString()}). Re-offering slots.`);
      await this.client.sendTextMessage(fromPhone, this.text('slotPassedText'));
      return this.askVisitSlot(fromPhone);
    }

    const visitSlot = formatSlotLong(visitAt);
    logger.info(`[State Machine] +${fromPhone} booked slot: ${visitSlot} (${visitAt.toISOString()}). Finalizing deal.`);
    await redis.del(this.unexpectedKey(key));

    const updated = await this.upsertLead(fromPhone, { visitSlot, visitAt, status: 'VISIT_CONFIRMED' });
    const p = this.tenant.projectDetails;

    try {
      logger.debug(`[State Machine] Sending location pin to +${fromPhone}.`);
      await this.client.sendLocation(fromPhone, p.latitude, p.longitude, p.projectName, p.siteAddress);
    } catch (err) {
      logger.warn(`[Location send failed] +${fromPhone}: ${err.message}`);
    }

    await this.client.sendTextMessage(fromPhone, this.text('confirmationText', {
      name: updated.name, configuration: updated.configuration, budget: updated.budget, slot: visitSlot,
    }));

    await this.notifyAdmin(updated, {
      headline: 'Site visit booked',
      details: `${updated.configuration} · ${updated.budget} · ${visitSlot}`,
      text: `🚨 *HOT REAL ESTATE DEAL GENERATED!*\n\n• *Name:* ${updated.name}\n• *Phone:* +${updated.phone}\n• *Config:* ${updated.configuration}\n• *Budget:* ${updated.budget}\n• *Visit Slot:* ${visitSlot}\n• *Status:* Site Visit Confirmed`,
    });

    await redis.set(key, 'COMPLETED', 'EX', SESSION_TTL);
    logger.info(`[State Machine] Lead +${fromPhone} flow COMPLETED.`);
  }

  // ---- Typed replies and human handoff ----

  /** The lead typed (or sent media) instead of tapping an option: re-ask, then hand off to a human. */
  async handleUnexpectedReply(fromPhone, key, message, reask) {
    const counterKey = this.unexpectedKey(key);
    const count = await redis.incr(counterKey);
    await redis.expire(counterKey, SESSION_TTL);

    if (count <= MAX_UNEXPECTED_REPLIES) {
      logger.info(`[State Machine] +${fromPhone} sent an unexpected ${message.type} reply (${count}/${MAX_UNEXPECTED_REPLIES}). Re-asking.`);
      await this.client.sendTextMessage(fromPhone, this.text('nudgeText'));
      return reask();
    }

    if (count === MAX_UNEXPECTED_REPLIES + 1) {
      logger.info(`[State Machine] +${fromPhone} still not choosing an option. Handing off to a human.`);
      await this.client.sendTextMessage(fromPhone, this.text('handoffText'));

      const lead = (await Lead.findOne({ tenantId: this.tenant._id, phone: fromPhone })) || (await this.upsertLead(fromPhone, { status: 'ENGAGED' }));
      const said = this.describeMessage(message);
      await this.notifyAdmin(lead, {
        headline: 'Lead needs a call',
        details: `Last message: ${said.replace(/\s+/g, ' ').slice(0, 200)}`,
        text: `📞 *LEAD NEEDS A CALL*\n\n• *Name:* ${lead.name}\n• *Phone:* +${lead.phone}\n• *Config:* ${lead.configuration}\n• *Budget:* ${lead.budget}\n• *Their message:* ${said}\n\nThey replied with a message instead of choosing an option. Please call them.`,
      });
      return;
    }

    // Already handed off: stay quiet so the lead isn't spammed; the consultant will follow up.
    logger.info(`[State Machine] +${fromPhone} sent another unexpected reply after handoff. No automatic reply.`);
  }

  describeMessage(message) {
    if (message.type === 'text') return message.text?.body?.trim() || '(empty message)';
    if (message.type === 'interactive' || message.type === 'button') return '(tapped an old or unknown option)';
    return `(sent ${/^[aeiou]/i.test(message.type) ? 'an' : 'a'} ${message.type} message)`;
  }

  // ---- Admin alerts ----

  /** Sends an alert to the tenant's admin phone and records on the lead whether it went out. */
  async notifyAdmin(lead, { headline, details, text }) {
    const to = this.tenant.adminNotificationPhone;
    const templateName = this.tenant.templates?.adminAlertName || ENV_ADMIN_TEMPLATE;
    const templateLang = this.tenant.templates?.adminAlertLanguage || ENV_ADMIN_TEMPLATE_LANG;
    let sent = false;
    let messageId = null;
    let error = null;
    try {
      let response;
      if (templateName) {
        logger.info(`[Admin Alert] Sending '${headline}' to +${to} via template '${templateName}'.`);
        // Template values may not be empty or contain line breaks.
        const params = [headline, lead.name, `+${lead.phone}`, details].map((v) => String(v || '-').replace(/\s+/g, ' ').trim() || '-');
        response = await this.adminClient.sendTemplate(to, templateName, params, templateLang);
      } else {
        logger.info(`[Admin Alert] Sending '${headline}' to +${to} as plain text.`);
        response = await this.adminClient.sendTextMessage(to, text);
      }
      sent = true;
      // Meta can still reject it later (e.g. outside the 24h window); the status webhook uses this id.
      messageId = response?.messages?.[0]?.id || null;
    } catch (err) {
      error = err.response?.data?.error?.message || err.message;
      logger.error(`[Admin Alert] '${headline}' for +${lead.phone} could not be sent to +${to}: ${error}`);
    }

    const updated = await Lead.findOneAndUpdate({ _id: lead._id }, { $set: { adminAlertStatus: sent ? 'SENT' : 'FAILED', adminAlertAt: new Date(), adminAlertMessageId: messageId, adminAlertError: error } }, { new: true })
      .lean()
      .catch((err) => logger.warn(`[Admin Alert] Could not record alert status: ${err.message}`));
    if (updated) publish(this.tenant._id, 'lead:update', { lead: updated });
    return sent;
  }
}

module.exports = ConversationEngine;
