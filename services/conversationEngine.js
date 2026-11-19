const redis = require('../config/redis');
const Lead = require('../models/Lead');
const MetaApiClient = require('./metaApiClient');
const logger = require('../utils/logger');

const SESSION_TTL = 86400;

class ConversationEngine {
  constructor(tenant) {
    this.tenant = tenant;
    this.client = new MetaApiClient(tenant.accessToken, tenant.phoneNumberId);
  }

  sessionKey(phone) {
    return `session:${this.tenant._id}:${phone}`;
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
    const isOptOutText = ['stop', 'unsubscribe', 'opt out', 'optout', 'not interested'].includes(textBody);

    if (interactiveId === 'NOT_INTERESTED' || isOptOutText) {
      logger.info(`[State Machine] +${fromPhone} opted out (Payload: ${interactiveId}, Text: ${textBody})`);
      await this.upsertLead(fromPhone, { status: 'COLD' });
      await redis.del(key);
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
          return await this.stepAskConfiguration(fromPhone, key);
        case 'AWAITING_CONFIG':
          return await this.stepHandleConfigAndAskBudget(fromPhone, interactiveId, key);
        case 'AWAITING_BUDGET':
          return await this.stepHandleBudgetAndOfferVisit(fromPhone, interactiveId, key);
        case 'AWAITING_SLOT':
          return await this.stepConfirmBookingAndCloseDeal(fromPhone, interactiveId, key);
        case 'COMPLETED':
          logger.debug(`[State Machine] +${fromPhone} is already COMPLETED. Sending standard reply.`);
          return await this.client.sendTextMessage(fromPhone, `Our Property Consultant is reviewing your visit file for *${this.tenant.projectDetails.projectName}*. For immediate help, call: +${this.tenant.adminNotificationPhone}.`);
        default:
          logger.warn(`[State Machine] +${fromPhone} hit unknown state '${state}'. Resetting to INIT.`);
          await redis.del(key);
          return await this.stepAskConfiguration(fromPhone, key);
      }
    } catch (err) {
      logger.error(`[State Machine] Error during step execution for +${fromPhone}: ${err.message}`);
      try {
        await this.client.sendTextMessage(fromPhone, 'We hit a small snag. Please reply *Hi* to restart, or our team will reach out shortly.');
      } catch (_) {}
    }
  }

  async stepAskConfiguration(fromPhone, key) {
    logger.info(`[State Machine] Transitioning +${fromPhone} to AWAITING_CONFIG.`);
    const { projectName } = this.tenant.projectDetails;
    await this.client.sendQuickReplies(fromPhone, `Welcome to *${projectName}*! Which residential configuration are you interested in?`, [
      { id: 'CONF_2BHK', title: '2 BHK (1250 sq.ft)' },
      { id: 'CONF_3BHK', title: '3 BHK (1850 sq.ft)' },
      { id: 'CONF_VILLA', title: '4 BHK / Villa' },
    ]);
    await redis.set(key, 'AWAITING_CONFIG', 'EX', SESSION_TTL);
    await this.upsertLead(fromPhone, { status: 'ENGAGED' });
  }

  async stepHandleConfigAndAskBudget(fromPhone, interactiveId, key) {
    const map = { CONF_2BHK: '2 BHK', CONF_3BHK: '3 BHK', CONF_VILLA: '4 BHK / Villa' };
    const chosen = map[interactiveId] || '3 BHK';
    logger.info(`[State Machine] +${fromPhone} selected config: ${chosen}. Transitioning to AWAITING_BUDGET.`);
    
    await this.upsertLead(fromPhone, { configuration: chosen, status: 'ENGAGED' });

    await this.client.sendListMenu(fromPhone, 'Select Your Budget', `You selected *${chosen}*. Please select your comfortable investment range:`, 'View Budget Tiers', [
      { title: 'Investment Bracket', rows: [
          { id: 'BUDGET_TIER_1', title: '₹85 Lakh - ₹1.2 Cr', description: 'Standard Floors' },
          { id: 'BUDGET_TIER_2', title: '₹1.2 Cr - ₹1.8 Cr', description: 'Lake Facing & High Floors' },
          { id: 'BUDGET_TIER_3', title: '₹1.8 Cr+', description: 'Corner Units & Penthouses' },
      ]},
    ]);
    await redis.set(key, 'AWAITING_BUDGET', 'EX', SESSION_TTL);
  }

  async stepHandleBudgetAndOfferVisit(fromPhone, interactiveId, key) {
    const map = { BUDGET_TIER_1: '₹85 Lakh - ₹1.2 Cr', BUDGET_TIER_2: '₹1.2 Cr - ₹1.8 Cr', BUDGET_TIER_3: '₹1.8 Cr+' };
    const chosen = map[interactiveId] || '₹1.2 Cr - ₹1.8 Cr';
    logger.info(`[State Machine] +${fromPhone} selected budget: ${chosen}. Transitioning to AWAITING_SLOT.`);
    
    await this.upsertLead(fromPhone, { budget: chosen, status: 'QUALIFIED' });

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

    await this.client.sendQuickReplies(fromPhone, 'Early-bird pricing is locked via an in-person Experience Centre visit. Select a convenient time slot:', [
      { id: 'SLOT_TOMORROW_11AM', title: 'Tomorrow 11:00 AM' },
      { id: 'SLOT_SATURDAY_4PM', title: 'Saturday 4:00 PM' },
      { id: 'SLOT_SUNDAY_11AM', title: 'Sunday 11:00 AM' },
    ]);
    await redis.set(key, 'AWAITING_SLOT', 'EX', SESSION_TTL);
  }

  async stepConfirmBookingAndCloseDeal(fromPhone, interactiveId, key) {
    const map = { SLOT_TOMORROW_11AM: 'Tomorrow at 11:00 AM', SLOT_SATURDAY_4PM: 'This Saturday at 4:00 PM', SLOT_SUNDAY_11AM: 'This Sunday at 11:00 AM' };
    const booked = map[interactiveId] || 'This Weekend';
    logger.info(`[State Machine] +${fromPhone} booked slot: ${booked}. Finalizing deal.`);

    const updated = await this.upsertLead(fromPhone, { visitSlot: booked, status: 'VISIT_CONFIRMED' });

    try {
      logger.debug(`[State Machine] Sending location pin to +${fromPhone}.`);
      await this.client.sendLocation(fromPhone, this.tenant.projectDetails.latitude, this.tenant.projectDetails.longitude, this.tenant.projectDetails.projectName, this.tenant.projectDetails.siteAddress);
    } catch (err) {
      logger.warn(`[Location send failed] +${fromPhone}: ${err.message}`);
    }

    await this.client.sendTextMessage(fromPhone, `✅ *VIP Site Visit Pass Confirmed!*\n\n• *Project:* ${this.tenant.projectDetails.projectName}\n• *Configuration:* ${updated.configuration}\n• *Scheduled Slot:* ${booked}\n• *Site Address:* ${this.tenant.projectDetails.siteAddress}\n\nOur Senior Property Advisor will welcome you at the reception. Show this message at the security gate for reserved parking.`);

    logger.info(`[State Machine] Sending HOT DEAL alert to admin (+${this.tenant.adminNotificationPhone}).`);
    try {
      await this.client.sendTextMessage(this.tenant.adminNotificationPhone, `🚨 *HOT REAL ESTATE DEAL GENERATED!*\n\n• *Name:* ${updated.name}\n• *Phone:* +${updated.phone}\n• *Config:* ${updated.configuration}\n• *Budget:* ${updated.budget}\n• *Visit Slot:* ${booked}\n• *Status:* Site Visit Confirmed`);
    } catch (err) {
      logger.warn(`[Admin alert failed]: ${err.message}`);
    }

    await redis.set(key, 'COMPLETED', 'EX', SESSION_TTL);
    logger.info(`[State Machine] Lead +${fromPhone} flow COMPLETED.`);
  }
}

module.exports = ConversationEngine;