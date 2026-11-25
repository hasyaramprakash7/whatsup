// Spam guard: one chat sending a flood of messages (a bot, a stuck phone, someone testing) would burn AI and
// WhatsApp sends. Past FLOOD_LIMIT messages in a minute the bot goes quiet on that chat for FLOOD_QUIET_MS.
export const FLOOD_LIMIT = 30;
export const FLOOD_QUIET_MS = 10 * 60000;

/**
 * Counts this message. `storage` has get/put (Durable Object storage).
 * Returns { quiet: false } | { quiet: true, started: boolean, count } — `started` only on the message that tripped it.
 */
export async function floodCheck(storage, now = Date.now()) {
  const recent = ((await storage.get('recent')) || []).filter((t) => now - t < 60000);
  recent.push(now);
  await storage.put('recent', recent.slice(-(FLOOD_LIMIT + 10)));
  const mutedUntil = (await storage.get('mutedUntil')) || 0;
  if (now < mutedUntil) return { quiet: true, started: false, count: recent.length };
  if (recent.length <= FLOOD_LIMIT) return { quiet: false };
  await storage.put('mutedUntil', now + FLOOD_QUIET_MS);
  return { quiet: true, started: true, count: recent.length };
}
