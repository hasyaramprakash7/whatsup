// Validation for the Flow Builder, Business Profile and AI settings, plus small flow helpers.
import { DEFAULT_MESSAGES } from './templates.js';

export const STEP_TYPES = ['choice', 'question', 'slots', 'send', 'finish'];
export const QUESTION_INPUTS = ['text', 'name', 'email', 'phone', 'number', 'date', 'location'];
export const SEND_KINDS = ['text', 'document', 'location', 'catalog'];
const ITEM_ID_RE = /^[0-9a-f-]{36}$/i;
const itemId = (v) => (ITEM_ID_RE.test(String(v || '')) ? String(v) : null);
export const STEP_STATUSES = ['ENGAGED', 'QUALIFIED', 'CONVERTED'];
const SLOT_DAYS = ['TOMORROW', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase().slice(0, 6);

/** Validates a flow from the builder. Returns { value, errors } with ids filled in. */
export function validateFlow(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { value: null, errors: ['Flow must be an object.'] };
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (rawSteps.length < 1 || rawSteps.length > 30) errors.push('Add between 1 and 30 steps.');

  const stepIds = new Set();
  const fields = new Set();
  const optionIds = new Set();
  const steps = rawSteps.map((s, i) => {
    const n = `Step ${i + 1}`;
    const type = STEP_TYPES.includes(s?.type) ? s.type : null;
    if (!type) errors.push(`${n}: choose a step type.`);
    let id = str(s?.id);
    if (!/^[a-z0-9_]{1,40}$/i.test(id) || stepIds.has(id)) id = `step_${rand().toLowerCase()}`;
    stepIds.add(id);
    const step = { id, type };
    const text = str(s?.text);
    const textMax = type === 'finish' || (type === 'send' && s?.kind === 'text') ? 4096 : 1024;
    if (type !== 'send' || s?.kind === 'text') { if (!text) errors.push(`${n}: write the message.`); }
    if (text.length > textMax) errors.push(`${n}: the message must be ${textMax} characters or fewer.`);
    step.text = text;

    if (['choice', 'question', 'slots'].includes(type)) {
      const field = str(s?.field).toLowerCase();
      if (!/^[a-z][a-z0-9_]{0,30}$/.test(field)) errors.push(`${n}: the saved field name must start with a letter and use only a-z, 0-9 and _.`);
      else if (fields.has(field)) errors.push(`${n}: another step already saves to "${field}".`);
      fields.add(field);
      step.field = field;
      step.label = str(s?.label) || field;
      if (step.label.length > 40) errors.push(`${n}: the column name must be 40 characters or fewer.`);
    }
    if (type !== 'finish' && type !== 'send') {
      const st = str(s?.setStatus);
      step.setStatus = STEP_STATUSES.includes(st) ? st : null;
    }

    if (type === 'choice') {
      const opts = Array.isArray(s?.options) ? s.options : [];
      if (opts.length < 1 || opts.length > 10) errors.push(`${n}: add between 1 and 10 options.`);
      step.forceList = !!s?.forceList;
      const asList = step.forceList || opts.length > 3;
      const titleMax = asList ? 24 : 20;
      step.options = opts.map((o, j) => {
        const title = str(o?.title);
        const label = str(o?.label) || title;
        if (!title) errors.push(`${n}, option ${j + 1}: the button text is required.`);
        if (title.length > titleMax) errors.push(`${n}, option ${j + 1}: "${title}" is longer than WhatsApp's ${titleMax}-character limit.`);
        if (label.length > 60) errors.push(`${n}, option ${j + 1}: "saved as" must be 60 characters or fewer.`);
        const description = str(o?.description);
        if (description.length > 72) errors.push(`${n}, option ${j + 1}: the description must be 72 characters or fewer.`);
        let oid = str(o?.id).toUpperCase();
        if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(oid) || optionIds.has(oid)) oid = `OPT_${rand()}`;
        optionIds.add(oid);
        // itemId: a product/service whose photo is sent when the customer picks this option.
        return { id: oid, title, label, description, next: str(o?.next) || null, itemId: itemId(o?.itemId) };
      });
      // A product photo shown with the question (above the buttons, or just before a list).
      step.imageItemId = itemId(s?.imageItemId);
      for (const [k, max, def] of [['listHeader', 60, 'Choose an option'], ['listButton', 20, 'View options'], ['listSection', 24, 'Options']]) {
        const v = str(s?.[k]) || def;
        if (v.length > max) errors.push(`${n}: list ${k.replace('list', '').toLowerCase()} must be ${max} characters or fewer.`);
        step[k] = v;
      }
    } else if (type === 'question') {
      step.input = QUESTION_INPUTS.includes(s?.input) ? s.input : 'text';
    } else if (type === 'slots') {
      const plan = Array.isArray(s?.plan) ? s.plan : [];
      if (plan.length < 1 || plan.length > 3) errors.push(`${n}: choose between 1 and 3 time slots.`);
      step.plan = plan.map((p, j) => {
        const day = str(p?.day).toUpperCase(); const time = str(p?.time);
        if (!SLOT_DAYS.includes(day)) errors.push(`${n}, slot ${j + 1}: pick a day.`);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.push(`${n}, slot ${j + 1}: time must look like 11:00.`);
        return { day, time };
      });
    } else if (type === 'send') {
      step.kind = SEND_KINDS.includes(s?.kind) ? s.kind : 'text';
      if (step.kind === 'catalog') {
        // Which products/services to send as photos: chosen ones, one category, or all (max 10).
        step.itemIds = (Array.isArray(s?.itemIds) ? s.itemIds : []).map(itemId).filter(Boolean).slice(0, 10);
        step.category = str(s?.category).slice(0, 40);
        // 'list' (default): one tap-to-open list message; 'photos': every photo at once (one billed message each).
        step.display = s?.display === 'photos' ? 'photos' : 'list';
      }
    } else if (type === 'finish') {
      step.alertTeam = s?.alertTeam !== false;
      step.setStatus = 'CONVERTED';
    }
    step.next = str(s?.next) || null;
    return step;
  });

  // Branches must point at real steps.
  const ids = new Set(steps.map((s) => s.id));
  for (const [i, s] of steps.entries()) {
    if (s.next && s.next !== 'END' && !ids.has(s.next)) errors.push(`Step ${i + 1}: "go to" points at a step that doesn't exist.`);
    for (const o of s.options || []) if (o.next && o.next !== 'END' && !ids.has(o.next)) errors.push(`Step ${i + 1}: option "${o.title}" points at a step that doesn't exist.`);
  }

  const messages = {};
  for (const [k, def] of Object.entries(DEFAULT_MESSAGES)) {
    const v = str(input.messages?.[k]) || def;
    if (v.length > 4096) errors.push(`Message "${k}" must be 4096 characters or fewer.`);
    messages[k] = v;
  }
  return { value: { enabled: input.enabled !== false, template: str(input.template) || null, steps, messages }, errors };
}

export function validateProfile(input) {
  const errors = [];
  const p = input && typeof input === 'object' ? input : {};
  const lim = { displayName: 120, about: 2000, services: 4000, hours: 600, address: 300, contactPhone: 20, website: 200, documentName: 60 };
  const value = {};
  for (const [k, max] of Object.entries(lim)) {
    value[k] = str(p[k]);
    if (value[k].length > max) errors.push(`${k}: must be ${max} characters or fewer.`);
  }
  if (!value.displayName) errors.push('Name shown to customers is required.');
  for (const k of ['latitude', 'longitude']) {
    if (p[k] === '' || p[k] === null || p[k] === undefined) { value[k] = null; continue; }
    const v = Number(p[k]); const max = k === 'latitude' ? 90 : 180;
    if (!Number.isFinite(v) || Math.abs(v) > max) errors.push(`${k} must be between -${max} and ${max}.`);
    value[k] = v;
  }
  value.documentUrl = p.documentUrl ? str(p.documentUrl) : null;
  const faq = Array.isArray(p.faq) ? p.faq : [];
  if (faq.length > 40) errors.push('Up to 40 FAQ entries.');
  value.faq = faq.map((f, i) => {
    const q = str(f?.q); const a = str(f?.a);
    if (!q || !a) errors.push(`FAQ ${i + 1}: write both the question and the answer.`);
    if (q.length > 200 || a.length > 1000) errors.push(`FAQ ${i + 1}: question up to 200 and answer up to 1000 characters.`);
    return { q, a };
  }).slice(0, 40);
  return { value, errors };
}

export function validateAi(input) {
  const errors = [];
  const a = input && typeof input === 'object' ? input : {};
  const value = {
    enabled: !!a.enabled,
    tone: str(a.tone) || 'Friendly, polite and concise',
    instructions: str(a.instructions),
    dailyLimit: Math.round(Number(a.dailyLimit ?? 300)),
    answerAfterFlow: a.answerAfterFlow !== false,
  };
  if (value.tone.length > 200) errors.push('Tone: up to 200 characters.');
  if (value.instructions.length > 2000) errors.push('Extra instructions: up to 2000 characters.');
  if (!Number.isFinite(value.dailyLimit) || value.dailyLimit < 0 || value.dailyLimit > 20000) errors.push('Daily AI reply limit must be 0–20000.');
  return { value, errors };
}

// ---------- helpers used by the engine ----------
export const stepById = (flow, id) => (flow.steps || []).find((s) => s.id === id) || null;
/** The step that follows `step` (explicit `next`, else the next one in the list). null = end of flow. */
export function stepAfter(flow, step, explicitNext = null) {
  const next = explicitNext || step.next;
  if (next === 'END') return null;
  if (next) return stepById(flow, next);
  const i = flow.steps.findIndex((s) => s.id === step.id);
  return flow.steps[i + 1] || null;
}
/** Columns for the Leads table / lead details: one per step that saves an answer. */
export const flowFields = (flow) => (flow?.steps || []).filter((s) => s.field).map((s) => ({ field: s.field, label: s.label || s.field, type: s.type }));
