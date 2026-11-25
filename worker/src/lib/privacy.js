// Personal data: how long it is kept, and deleting one customer on request (India's DPDP Act: erasure on request,
// no keeping data longer than needed). Leads and bookings stay; chat messages and customers' files expire.
const fileKey = (tenantId, meta) => {
  try { const m = typeof meta === 'string' ? JSON.parse(meta) : meta; return m?.media ? `inbound/${tenantId}/${m.media}` : null; } catch { return null; }
};
async function deleteFiles(env, keys) {
  for (const k of keys) {
    await env.PRIVATE_MEDIA?.delete(k).catch(() => {});
    await env.MEDIA?.delete(k).catch(() => {});
  }
}

/**
 * Deletes everything about one customer of one business: chat messages, their photos/voice notes/documents,
 * the lead (name, answers, booking) and the bot's memory of the chat. Returns what was removed.
 */
export async function forgetCustomer(env, tenantId, phone) {
  const { results } = await env.DB.prepare('SELECT meta FROM messages WHERE tenant_id = ? AND phone = ? AND meta IS NOT NULL').bind(tenantId, phone).all();
  const files = results.map((r) => fileKey(tenantId, r.meta)).filter(Boolean);
  await deleteFiles(env, files);
  const msgs = await env.DB.prepare('DELETE FROM messages WHERE tenant_id = ? AND phone = ?').bind(tenantId, phone).run();
  const lead = await env.DB.prepare('DELETE FROM leads WHERE tenant_id = ? AND phone = ?').bind(tenantId, phone).run();
  try { await env.CONVERSATION?.get(env.CONVERSATION.idFromName(`${tenantId}:${phone}`)).forget(); } catch { /* nothing stored */ }
  return { messages: msgs.meta?.changes ?? 0, files: files.length, lead: (lead.meta?.changes ?? 0) > 0 };
}

/** Deletes chat messages (and their files) older than `days`, a batch at a time. Returns how many messages. */
export async function applyRetention(env, days = 365, batch = 500) {
  const cutoff = new Date(Date.now() - days * 24 * 3600e3).toISOString();
  const { results } = await env.DB.prepare('SELECT id, tenant_id, meta FROM messages WHERE created_at < ? LIMIT ?').bind(cutoff, batch).all();
  if (!results.length) return 0;
  await deleteFiles(env, results.map((r) => fileKey(r.tenant_id, r.meta)).filter(Boolean));
  for (let i = 0; i < results.length; i += 50) {
    const ids = results.slice(i, i + 50).map((r) => r.id);
    await env.DB.prepare(`DELETE FROM messages WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
  }
  console.log(`[Privacy] removed ${results.length} message(s) older than ${days} days`);
  return results.length;
}
