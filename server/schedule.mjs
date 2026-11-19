// Pure scheduling rules, shared by the Node server (store.mjs) and the Cloudflare Worker.

/** Grace for clock drift and slow clicks: a go-live time this far in the past still counts as "now". */
export const SCHEDULE_GRACE_MS = 2 * 60_000;

/**
 * A Push must say when it goes live: an ISO time no earlier than now (minus the grace). Returns the errors, if any.
 * @param {unknown} effectiveAt
 * @param {number} [now]
 */
export function scheduleErrors(effectiveAt, now = Date.now()) {
  if (effectiveAt == null || effectiveAt === "") return ["Choose when this release goes live (mm/dd/yy hh:mm)."];
  const t = Date.parse(String(effectiveAt));
  if (!Number.isFinite(t)) return ["The go-live time is not a valid date and time."];
  if (t < now - SCHEDULE_GRACE_MS) return ["The go-live time is in the past. Pick now or a later time."];
  return [];
}
