const redis = require('../config/redis');
const Lead = require('../models/Lead');
const MetaApiClient = require('./metaApiClient');
const logger = require('../utils/logger');
const { buildVisitSlots, parseSlotId, formatSlotLong } = require('../utils/visitSlots');

const SESSION_TTL = 86400;
// Re-ask a question this many times when the lead types instead of tapping, then hand off to a human.
const MAX_UNEXPECTED_REPLIES = 2;

// Free-form texts only reach the admin if they messaged the business number in the last 24h.
// An approved template is delivered at any time. Expected body variables (no line breaks allowed in values):
//   {{1}} alert headline, {{2}} lead name, {{3}} lead phone, {{4}} details
const ADMIN_ALERT_TEMPLATE = process.env.ADMIN_ALERT_TEMPLATE_NAME || '';
const ADMIN_ALERT_TEMPLATE_LANG = process.env.ADMIN_ALERT_TEMPLATE_LANG || 'en';
if (!ADMIN_ALERT_TEMPLATE) {
  logger.warn('[Admin Alerts] ADMIN_ALERT_TEMPLATE_NAME is not set — admin alerts go out as plain text, which WhatsApp only delivers if the admin messaged the business number in the last 24h.');
}

const CONFIG_OPTIONS = {
  CONF_2BHK: { label: '2 BHK', title: '2 BHK (1250 sq.ft)' },
  CONF_3BHK: { label: '3 BHK', title: '3 BHK (1850 sq.ft)' },
  CONF_VILLA: { label: '4 BHK / Villa', title: '4 BHK / Villa' },
};

const BUDGET_OPTIONS = {
  BUDGET_TIER_1: { label: '₹85 Lakh - ₹1.2 Cr', description: 'Standard Floors' },
  BUDGET_TIER_2: { label: '₹1.2 Cr - ₹1.8 Cr', description: 'Lake Facing & High Floors' },
  BUDGET_TIER_3: { label: '₹1.8 Cr+', description: 'Corner Units & Penthouses' },
};

const OPT_OUT_TEXTS = ['stop', 'unsubscribe', 'opt out', 'optout', 'not interested'];

class ConversationEngine {
  constructor(tenant) {
    this.tenant = tenant;
    this.client = new MetaApiClient(tenant.accessToken, tenant.phoneNumberId);
  }

  sessionKey(phone) {
    return `session:${this.tenant._id}:${phone}`;
  }

  unexpectedKey(sessionKey) {
    return `${sessionKey}:unexpected`;
  }

  async upsertLead(phone, patch) {
    try {
      return await Lead.findOneAndUpdate(
        { tenantId: this.tenant._id, phone },
        { $set: patch },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (err) {
      if (err.code === 11000) {
        return Lead.findOneAndUpdate({ tenantId: this.tenant._id, phone }, { $set: patch }, { new: true });
      }
      throw err;
    }
  }

  async handleInboundMessage(fromPhone, message) {
    const key = this.sessionKey(fromPhone);
    let state = (await redis.get(key)) || 'INIT';
    logger.info(`[State Machine] +${fromPhone} | Current State: ${state} | Message Type: ${message.type}`);

    let interactiveId = null;
    if (message.type === 'interactive') {
      if (message.interactive?.type === 'button_reply') interactiveId = message.interactive.button_reply.id;
      else if (message.interactive?.type === 'list_reply') interactiveId = message.interactive.list_reply.id;
    } else if (message.type === 'button') {
      interactiveId = message.button?.payload || null;
    }

    const textBody = (message.text?.body || '').trim().toLowerCase();
    const isOptOutText = OPT_OUT_TEXTS.includes(textBody);

    if (interactiveId === 'NOT_INTERESTED' || isOptOutText) {
      logger.info(`[State Machine] +${fromPhone} opted out (Payload: ${interactiveId}, Text: ${textBody})`);
      await this.upsertLead(fromPhone, { status: 'COLD' });
      await redis.del(key, this.unexpectedKey(key));
      try {
        await this.client.sendTextMessage(fromPhone, 'Understood. We have opted you out of further updates for this project. Have a great day! 🙏');
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
          return await this.client.sendTextMessage(fromPhone, `Our Property Consultant is reviewing your visit file for *${this.tenant.projectDetails.projectName}*. For immediate help, call: +${this.tenant.adminNotificationPhone}.`);
        default:
          logger.warn(`[State Machine] +${fromPhone} hit unknown state '${state}'. Resetting to INIT.`);
          await redis.del(key);
          return await this.stepStart(fromPhone, key);
      }
    } catch (err) {
      logger.error(`[State Machine] Error during step execution for +${fromPhone}: ${err.message}`);
      try {
        await this.client.sendTextMessage(fromPhone, 'We hit a small snag. Please reply *Hi* to restart, or our team will reach out shortly.');
      } catch (_) {}
    }
  }

  // ---- Questions (sent fresh, or re-sent after an unexpected reply) ----

  askConfiguration(fromPhone) {
    const { projectName } = this.tenant.projectDetails;
    return this.client.sendQuickReplies(fromPhone, `Welcome to *${projectName}*! Which residential configuration are you interested in?`,
      Object.entries(CONFIG_OPTIONS).map(([id, o]) => ({ id, title: o.title })));
  }

  async askBudget(fromPhone, configLabel) {
    const intro = configLabel ? `You selected *${configLabel}*. ` : '';
    return this.client.sendListMenu(fromPhone, 'Select Your Budget', `${intro}Please select your comfortable investment range:`, 'View Budget Tiers', [
      { title: 'Investment Bracket', rows: Object.entries(BUDGET_OPTIONS).map(([id, o]) => ({ id, title: o.label, description: o.description })) },
    ]);
  }

  askVisitSlot(fromPhone) {
    const slots = buildVisitSlots();
    return this.client.sendQuickReplies(fromPhone, 'Early-bird pricing is locked via an in-person Experience Centre visit. Select a convenient time slot:',
      slots.map((s) => ({ id: s.id, title: s.title })));
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
    const option = CONFIG_OPTIONS[interactiveId];
    if (!option) return this.handleUnexpectedReply(fromPhone, key, message, () => this.askConfiguration(fromPhone));

    logger.info(`[State Machine] +${fromPhone} selected config: ${option.label}. Transitioning to AWAITING_BUDGET.`);
    await redis.del(this.unexpectedKey(key));
    await this.upsertLead(fromPhone, { configuration: option.label, status: 'ENGAGED' });
    await this.askBudget(fromPhone, option.label);
    await redis.set(key, 'AWAITING_BUDGET', 'EX', SESSION_TTL);
  }

  async stepHandleBudget(fromPhone, interactiveId, key, message) {
    const option = BUDGET_OPTIONS[interactiveId];
    if (!option) {
      return this.handleUnexpectedReply(fromPhone, key, message, async () => {
        const lead = await Lead.findOne({ tenantId: this.tenant._id, phone: fromPhone }).select('configuration').lean();
        const configLabel = lead?.configuration && lead.configuration !== 'Unspecified' ? lead.configuration : null;
        return this.askBudget(fromPhone, configLabel);
      });
    }

    logger.info(`[State Machine] +${fromPhone} selected budget: ${option.label}. Transitioning to AWAITING_SLOT.`);
    await redis.del(this.unexpectedKey(key));
    await this.upsertLead(fromPhone, { budget: option.label, status: 'QUALIFIED' });

    if (this.tenant.projectDetails.brochurePdfUrl) {
      logger.debug(`[State Machine] Sending brochure document to +${fromPhone} from R2 URL.`);
      try {
        await this.client.sendDocument(fromPhone, this.tenant.projectDetails.brochurePdfUrl, `${this.tenant.projectDetails.projectName.replace(/\s+/g, '_')}_Masterplan.pdf`, `Here is the verified master plan and floor blueprint for *${this.tenant.projectDetails.projectName}*.`);
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
      await this.client.sendTextMessage(fromPhone, 'That time slot has already passed. Here are the next available slots:');
      return this.askVisitSlot(fromPhone);
    }

    const visitSlot = formatSlotLong(visitAt);
    logger.info(`[State Machine] +${fromPhone} booked slot: ${visitSlot} (${visitAt.toISOString()}). Finalizing deal.`);
    await redis.del(this.unexpectedKey(key));

    const updated = await this.upsertLead(fromPhone, { visitSlot, visitAt, status: 'VISIT_CONFIRMED' });

    try {
      logger.debug(`[State Machine] Sending location pin to +${fromPhone}.`);
      await this.client.sendLocation(fromPhone, this.tenant.projectDetails.latitude, this.tenant.projectDetails.longitude, this.tenant.projectDetails.projectName, this.tenant.projectDetails.siteAddress);
    } catch (err) {
      logger.warn(`[Location send failed] +${fromPhone}: ${err.message}`);
    }

    await this.client.sendTextMessage(fromPhone, `✅ *VIP Site Visit Pass Confirmed!*\n\n• *Project:* ${this.tenant.projectDetails.projectName}\n• *Configuration:* ${updated.configuration}\n• *Scheduled Slot:* ${visitSlot}\n• *Site Address:* ${this.tenant.projectDetails.siteAddress}\n\nOur Senior Property Advisor will welcome you at the reception. Show this message at the security gate for reserved parking.`);

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
      await this.client.sendTextMessage(fromPhone, 'Please tap one of the options below so we can help you faster 👇');
      return reask();
    }

    if (count === MAX_UNEXPECTED_REPLIES + 1) {
      logger.info(`[State Machine] +${fromPhone} still not choosing an option. Handing off to a human.`);
      const { projectName } = this.tenant.projectDetails;
      await this.client.sendTextMessage(fromPhone, `No problem! A property consultant from *${projectName}* will contact you shortly. You can also call us on +${this.tenant.adminNotificationPhone}, or tap any option above whenever you're ready.`);

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
    let sent = false;
    try {
      if (ADMIN_ALERT_TEMPLATE) {
        logger.info(`[Admin Alert] Sending '${headline}' to +${to} via template '${ADMIN_ALERT_TEMPLATE}'.`);
        // Template values may not be empty or contain line breaks.
        const params = [headline, lead.name, `+${lead.phone}`, details].map((v) => String(v || '-').replace(/\s+/g, ' ').trim() || '-');
        await this.client.sendTemplate(to, ADMIN_ALERT_TEMPLATE, params, ADMIN_ALERT_TEMPLATE_LANG);
      } else {
        logger.info(`[Admin Alert] Sending '${headline}' to +${to} as plain text.`);
        await this.client.sendTextMessage(to, text);
      }
      sent = true;
    } catch (err) {
      logger.error(`[Admin Alert] '${headline}' for +${lead.phone} could not be sent to +${to}: ${err.response?.data?.error?.message || err.message}`);
    }

    await Lead.updateOne({ _id: lead._id }, { $set: { adminAlertStatus: sent ? 'SENT' : 'FAILED', adminAlertAt: new Date() } })
      .catch((err) => logger.warn(`[Admin Alert] Could not record alert status: ${err.message}`));
    return sent;
  }
}

module.exports = ConversationEngine;
