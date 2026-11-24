// Everything the bot says, editable per vendor from the dashboard ("Bot Studio").
// Text supports placeholders: {project} {name} {configuration} {budget} {slot} {address} {adminPhone}
const crypto = require('crypto');

const DEFAULT_BOT_CONTENT = Object.freeze({
  welcomeText: 'Welcome to *{project}*! Which residential configuration are you interested in?',
  configOptions: [
    { id: 'CONF_2BHK', label: '2 BHK', title: '2 BHK (1250 sq.ft)' },
    { id: 'CONF_3BHK', label: '3 BHK', title: '3 BHK (1850 sq.ft)' },
    { id: 'CONF_VILLA', label: '4 BHK / Villa', title: '4 BHK / Villa' },
  ],
  // Used only when there are more than 3 home options (sent as a list instead of buttons).
  configListHeader: 'Choose a home',
  configListButton: 'View options',
  configSectionTitle: 'Configurations',
  budgetHeader: 'Select Your Budget',
  budgetText: 'You selected *{configuration}*. Please select your comfortable investment range:',
  budgetButtonLabel: 'View Budget Tiers',
  budgetSectionTitle: 'Investment Bracket',
  brochureFileName: '{project} Masterplan',
  budgetOptions: [
    { id: 'BUDGET_TIER_1', label: '₹85 Lakh - ₹1.2 Cr', description: 'Standard Floors' },
    { id: 'BUDGET_TIER_2', label: '₹1.2 Cr - ₹1.8 Cr', description: 'Lake Facing & High Floors' },
    { id: 'BUDGET_TIER_3', label: '₹1.8 Cr+', description: 'Corner Units & Penthouses' },
  ],
  brochureCaption: 'Here is the verified master plan and floor blueprint for *{project}*.',
  slotText: 'Early-bird pricing is locked via an in-person Experience Centre visit. Select a convenient time slot:',
  slotPlan: [
    { day: 'TOMORROW', time: '11:00' },
    { day: 'SAT', time: '16:00' },
    { day: 'SUN', time: '11:00' },
  ],
  confirmationText: '✅ *VIP Site Visit Pass Confirmed!*\n\n• *Project:* {project}\n• *Configuration:* {configuration}\n• *Scheduled Slot:* {slot}\n• *Site Address:* {address}\n\nOur Senior Property Advisor will welcome you at the reception. Show this message at the security gate for reserved parking.',
  completedText: 'Our Property Consultant is reviewing your visit file for *{project}*. For immediate help, call: +{adminPhone}.',
  optOutText: 'Understood. We have opted you out of further updates for this project. Have a great day! 🙏',
  nudgeText: 'Please tap one of the options below so we can help you faster 👇',
  handoffText: "No problem! A property consultant from *{project}* will contact you shortly. You can also call us on +{adminPhone}, or tap any option above whenever you're ready.",
  slotPassedText: 'That time slot has already passed. Here are the next available slots:',
  errorText: 'We hit a small snag. Please reply *Hi* to restart, or our team will reach out shortly.',
});

// Field name -> max length (WhatsApp limits: interactive body 1024, text message 4096).
const TEXT_FIELDS = {
  welcomeText: 1024, budgetText: 1024, slotText: 1024, brochureCaption: 1024,
  confirmationText: 4096, completedText: 4096, optOutText: 4096, nudgeText: 4096,
  handoffText: 4096, slotPassedText: 4096, errorText: 4096,
};
// Short labels -> WhatsApp limit (list header 60, list button 20, section title 24).
const LABEL_FIELDS = {
  configListHeader: 60, configListButton: 20, configSectionTitle: 24,
  budgetHeader: 60, budgetButtonLabel: 20, budgetSectionTitle: 24, brochureFileName: 60,
};
const SLOT_DAYS = ['TOMORROW', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const clone = (v) => JSON.parse(JSON.stringify(v));

/** The vendor's saved content merged over the defaults (missing fields fall back). */
function getBotContent(tenant) {
  const saved = tenant?.botContent || {};
  const out = clone(DEFAULT_BOT_CONTENT);
  for (const key of Object.keys(out)) {
    const v = saved[key];
    if (Array.isArray(out[key])) { if (Array.isArray(v) && v.length) out[key] = v; }
    else if (typeof v === 'string' && v.trim()) out[key] = v;
  }
  return out;
}

/** Replaces {placeholders}; unknown ones are left as typed so the vendor can spot them. */
function fill(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null && vars[k] !== '' ? String(vars[k]) : m));
}

const newId = (prefix) => `${prefix}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

function cleanOptions(list, { prefix, field, max, titleMax, withDescription }, errors) {
  if (!Array.isArray(list) || list.length < 1 || list.length > max) {
    errors.push(`${field}: add between 1 and ${max} options.`);
    return [];
  }
  const seen = new Set();
  return list.map((o, i) => {
    const n = i + 1;
    const label = String(o?.label || '').trim();
    const title = String(o?.title || label).trim();
    if (!label) errors.push(`${field} #${n}: the name is required.`);
    if (label.length > 60) errors.push(`${field} #${n}: the name must be 60 characters or fewer.`);
    if (title.length > titleMax) errors.push(`${field} #${n}: "${title}" is longer than WhatsApp's ${titleMax}-character limit.`);
    let id = String(o?.id || '');
    if (!new RegExp(`^${prefix}_[A-Z0-9_]{1,40}$`).test(id) || seen.has(id)) id = newId(prefix);
    seen.add(id);
    const opt = { id, label, title };
    if (withDescription) {
      const description = String(o?.description || '').trim();
      if (description.length > 72) errors.push(`${field} #${n}: the description must be 72 characters or fewer.`);
      opt.description = description;
    }
    return opt;
  });
}

/** Validates content sent from Bot Studio. Returns { value, errors }. */
function validateBotContent(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { value: null, errors: ['botContent must be an object.'] };
  const value = {};

  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    const v = String(input[field] ?? DEFAULT_BOT_CONTENT[field]).trim();
    if (!v) errors.push(`${field}: this message can't be empty.`);
    if (v.length > max) errors.push(`${field}: must be ${max} characters or fewer.`);
    value[field] = v;
  }

  const LABEL_NAMES = {
    configListHeader: 'Home list title', configListButton: 'Home list button', configSectionTitle: 'Home list section',
    budgetHeader: 'Budget list title', budgetButtonLabel: 'Budget list button', budgetSectionTitle: 'Budget list section', brochureFileName: 'Brochure file name',
  };
  for (const [field, max] of Object.entries(LABEL_FIELDS)) {
    const v = String(input[field] ?? DEFAULT_BOT_CONTENT[field]).trim();
    if (!v || v.length > max) errors.push(`${LABEL_NAMES[field]}: 1–${max} characters.`);
    value[field] = v;
  }

  const configCount = Array.isArray(input.configOptions) ? input.configOptions.length : 0;
  // Up to 3 options are sent as buttons (20-char titles); more are sent as a list (24-char titles).
  value.configOptions = cleanOptions(input.configOptions, { prefix: 'CONF', field: 'Configuration option', max: 10, titleMax: configCount > 3 ? 24 : 20 }, errors);
  value.budgetOptions = cleanOptions(input.budgetOptions, { prefix: 'BUDGET', field: 'Budget option', max: 10, titleMax: 24, withDescription: true }, errors);

  if (!Array.isArray(input.slotPlan) || input.slotPlan.length < 1 || input.slotPlan.length > 3) {
    errors.push('Visit slots: choose between 1 and 3 slots.');
    value.slotPlan = [];
  } else {
    value.slotPlan = input.slotPlan.map((s, i) => {
      const day = String(s?.day || '').toUpperCase();
      const time = String(s?.time || '');
      if (!SLOT_DAYS.includes(day)) errors.push(`Visit slot #${i + 1}: pick a day.`);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.push(`Visit slot #${i + 1}: time must look like 11:00.`);
      return { day, time };
    });
  }

  return { value, errors };
}

module.exports = { DEFAULT_BOT_CONTENT, getBotContent, validateBotContent, fill, SLOT_DAYS };
