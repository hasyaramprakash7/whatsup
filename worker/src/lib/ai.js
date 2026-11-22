import { detailPairs } from './itemfields.js';
const where = (it) => (it.details?.address ? ` | location: ${it.details.address}` : '') + (it.km != null ? ` | distance from customer: ${it.km < 1 ? '<1' : Math.round(it.km)} km` : '');
// Workers AI assistant: answers from the business's own profile, maps typed replies to options,
// and hands over to a person when it can't help. Always returns structured JSON.

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['answer', 'select', 'handoff'] },
    option_id: { type: ['string', 'null'] },
    reply: { type: 'string' },
    item_ids: { type: 'array', items: { type: 'string' } },
    send_document: { type: 'boolean' },
  },
  required: ['action', 'reply'],
};

/** Products/services list for the prompt; short ids keep it compact. */
function catalogFacts(catalog) {
  if (!catalog?.length) return '';
  return 'PRODUCTS & SERVICES (id | name | price | category | details | description | has photo):\n'
    + catalog.slice(0, 80).map((it, i) => `P${i + 1} | ${it.name} | ${it.price || '-'} | ${it.category || '-'} | ${detailPairs(it).map(([k, v]) => `${k}: ${v}`).join(', ') || '-'} | ${(it.description || '-').replace(/\s+/g, ' ').slice(0, 160)} | ${it.imageUrl ? 'yes' : 'no'}${where(it)}`).join('\n')
    + '\nIf a detail says sold out / out of stock / batch full, tell the customer it is not available.'
    + '\nIf they ask where a product/project is, give its location and put its id in item_ids: its photo is sent with a map link.';
}

function businessFacts(tenant) {
  const p = tenant.profile || {};
  const lines = [
    `Business name: ${p.displayName || tenant.businessName}`,
    p.about && `About: ${p.about}`,
    p.services && `Services, products and prices:\n${p.services}`,
    p.hours && `Opening hours: ${p.hours}`,
    p.address && `Address: ${p.address}`,
    p.contactPhone && `Phone: +${String(p.contactPhone).replace(/^\+/, '')}`,
    p.website && `Website: ${p.website}`,
    p.documentUrl && `Brochure PDF: "${p.documentName || 'brochure'}". You cannot see what is inside it. To send it again, set "send_document": true (never write a link to it).`,
  ].filter(Boolean);
  if (Array.isArray(p.faq) && p.faq.length) lines.push('FAQ:\n' + p.faq.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n'));
  return lines.join('\n');
}

function systemPrompt(tenant, aiCfg, pending, catalog, customerPlace = null) {
  const name = tenant.profile?.displayName || tenant.businessName;
  const items = catalogFacts(catalog);
  return [
    `You are the WhatsApp assistant for "${name}". Tone: ${aiCfg.tone || 'friendly and concise'}.`,
    '',
    'BUSINESS INFORMATION (the only facts you may use):',
    businessFacts(tenant),
    items,
    customerPlace ? `CUSTOMER'S LOCATION: ${customerPlace}. The list above is sorted nearest first; when they ask what is near them or what you have, suggest the nearest ones and mention the distance.` : '',
    items ? '- When your reply is about specific products/services, put their ids (e.g. "P2") in "item_ids" — never write these ids in your reply text. One id: its photo is sent with your reply. Several (at most 10, e.g. when they ask what you have): they get a list to tap for photos, so just introduce them briefly and do not list every price. Use [] otherwise.' : '',
    '',
    'RULES:',
    '- Answer ONLY from the business information above. Never invent prices, availability, offers, addresses or policies.',
    '- If the answer is not in the information, or the customer asks for a person, a call, a complaint or anything sensitive, use action "handoff" and say a team member will contact them.',
    '- Reply in the same language the customer writes in. Keep replies short: 1–3 sentences, plain WhatsApp text (you may use *bold*).',
    '- Never ask for payment details, passwords or ID numbers.',
    '- Never write a web link unless it appears exactly in the business information above. Never make up links (no example.com or placeholders).',
    '- Do not point to the brochure instead of answering. If the answer is not in the information, use "handoff". If the customer asks for the brochure, set "send_document": true with a short reply.',
    aiCfg.instructions ? `- Extra instructions from the business: ${aiCfg.instructions}` : '',
    '',
    pending
      ? `CURRENT STEP: the customer was asked: "${pending.question}"\nThe valid options are:\n${pending.options.map((o) => `- ${o.id}: ${o.title}`).join('\n')}\n`
        + 'If the customer\'s message clearly picks one of these options (in any wording or language), use action "select" with that option_id and a short acknowledgement as reply. '
        + 'If they ask a question instead, use action "answer" (the original question will be repeated to them after your reply, so do not repeat the options).'
      : 'The customer has finished the guided conversation. Answer their questions with action "answer".',
    '',
    'Respond with JSON only: {"action": "answer" | "select" | "handoff", "option_id": string or null, "reply": string, "item_ids": string[], "send_document": boolean}.',
  ].filter((l) => l !== '').join('\n');
}

const turnText = (t) => {
  if (t.sent_by === 'customer') return t.text || `[${t.type}]`;
  return t.text || (t.type === 'template' ? '[template message]' : `[${t.type}]`);
};

/**
 * Asks the model what to do with a customer's typed message.
 * pending: { question, options: [{ id, title }] } while a step waits for an answer, else null.
 * Returns { action, optionId, reply } or null if the AI is unavailable or returned nonsense.
 */
export async function aiDecide(env, { tenant, aiCfg, pending, history, catalog = [], customerPlace = null }) {
  if (!env.AI) return null;
  const messages = [{ role: 'system', content: systemPrompt(tenant, aiCfg, pending, catalog, customerPlace) }];
  for (const t of history) messages.push({ role: t.direction === 'in' ? 'user' : 'assistant', content: turnText(t).slice(0, 1500) });
  if (messages[messages.length - 1].role !== 'user') return null;

  let out;
  try {
    const res = await env.AI.run(env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages,
      response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
      max_tokens: 400,
      temperature: 0.2,
    });
    out = typeof res?.response === 'string' ? JSON.parse(res.response.replace(/^```(?:json)?\s*|\s*```$/g, '')) : res?.response;
  } catch (err) {
    console.warn('[AI] call failed:', err.message);
    return null;
  }
  if (!out || !['answer', 'select', 'handoff'].includes(out.action)) return null;
  // Drop any link the business didn't give us (the model sometimes invents placeholder URLs).
  const known = messages[0].content;
  const reply = String(out.reply || '')
    .replace(/(?:https?:\/\/|www\.)[^\s)]+/gi, (url) => (known.includes(url.replace(/[.,!?]+$/, '')) ? url : ''))
    .replace(/\s*\(\s*P\d{1,3}\s*\)|\bP\d{1,3}\b\s*[:\-–]?\s*/g, ' ') // internal product ids are never shown
    .replace(/\s+([.,!?])/g, '$1').replace(/:\s*$/, '.').replace(/[ \t]{2,}/g, ' ').trim().slice(0, 1000);
  const sendDocument = out.send_document === true && !!tenant.profile?.documentUrl;
  const optionId = out.option_id ? String(out.option_id) : null;
  if (out.action === 'select' && !(pending && pending.options.some((o) => o.id === optionId))) {
    return reply ? { action: 'answer', optionId: null, reply } : null;
  }
  if (out.action !== 'select' && !reply && !sendDocument) return null;
  // "P2" → the real item id; ignore anything that isn't in the list.
  const itemIds = (Array.isArray(out.item_ids) ? out.item_ids : [])
    .map((x) => catalog[Number(String(x).replace(/\D/g, '')) - 1]?._id).filter(Boolean).slice(0, 10);
  return { action: out.action, optionId, reply, itemIds: [...new Set(itemIds)], sendDocument };
}
