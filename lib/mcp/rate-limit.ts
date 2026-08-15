/**
 * A write budget per token, so one looping assistant can't fill the database.
 *
 * ===========================================================================
 * Why this exists, and what it is honestly worth
 * ===========================================================================
 *
 * A member connected an assistant to this server and it created ~4,000 empty
 * projects. Nothing was bypassed — he was entitled to create projects in his own
 * division and each call was legitimate. The gap was that there was no ceiling
 * anywhere, and an agent in a loop writes at a rate no person does.
 *
 * `createProject` now has a durable per-day ceiling, which is the strong control:
 * it lives in the database's own data, so it holds across every serverless
 * instance and every entry point. But there are sixteen write tools, and most of
 * the collections they write have no creator or created-at column to count — a
 * `Deliverable` records neither — so a per-day rule like that one cannot be built
 * for them without a migration.
 *
 * This is the cheap general defence that needs no schema: a sliding window per
 * token, held in memory.
 *
 * ---------------------------------------------------------------------------
 * It is NOT a security boundary, and it should not be described as one
 * ---------------------------------------------------------------------------
 *
 * Vercel runs many instances and this state is per-instance, so a determined
 * caller spreading requests around gets a multiple of these limits, and a cold
 * start forgets everything. So:
 *
 *   - As **abuse prevention against a hostile actor**, it is close to worthless.
 *     A hostile actor with a write token is already inside the permission model
 *     and the answer is to revoke the token.
 *   - As **protection against the accident that actually happened**, it is
 *     effective, because a client in a tight loop keeps hitting the same warm
 *     instance and gets stopped within seconds rather than after four thousand
 *     rows.
 *
 * That asymmetry is the whole design. Belt and braces with the durable ceiling,
 * not a replacement for it, and never a reason to skip a per-collection limit
 * where the data supports one.
 */

/** Writes allowed in the short window. Generous for a person, instant for a loop. */
export const WRITES_PER_MINUTE = 30;

/**
 * And in the long one, because a loop paced just under the per-minute limit is
 * still a loop — 30/min sustained is 43,000 a day.
 */
export const WRITES_PER_HOUR = 200;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Write timestamps per token id, newest last.
 *
 * Module scope, so it survives between requests on a warm instance and dies with
 * a cold one — which is the accepted limitation described above. Keyed by token
 * id rather than member id so revoking and reissuing gives a clean slate, and so
 * one member's runaway laptop doesn't stop the assistant on their phone.
 */
const writes = new Map<string, number[]>();

/**
 * How many distinct tokens to track before dropping the least recently used.
 *
 * A bound is required: without one, this map is a slow memory leak that grows
 * with every token that has ever written to a given instance. The club has ~40
 * members, so 500 is far beyond real use and small enough to be free.
 */
const MAX_TRACKED_TOKENS = 500;

export interface BudgetVerdict {
  ok: boolean;
  /** Populated on refusal: what to tell the model, in a sentence it can relay. */
  message?: string;
}

/**
 * Record a write and say whether it was allowed.
 *
 * Counts the attempt whether or not it is permitted, deliberately: a client that
 * ignores refusals and keeps hammering should stay refused rather than get one
 * request through per window boundary.
 *
 * @param now Injected so this is testable without waiting a minute.
 */
export function checkWriteBudget(
  tokenId: string,
  now: number = Date.now()
): BudgetVerdict {
  // Bound the map before inserting anything new.
  if (!writes.has(tokenId) && writes.size >= MAX_TRACKED_TOKENS) {
    const oldest = writes.keys().next();
    if (!oldest.done) writes.delete(oldest.value);
  }

  const recent = (writes.get(tokenId) ?? []).filter((at) => now - at < HOUR_MS);
  recent.push(now);
  writes.set(tokenId, recent);

  const lastMinute = recent.filter((at) => now - at <= MINUTE_MS).length;
  if (lastMinute > WRITES_PER_MINUTE) {
    return {
      ok: false,
      message:
        `That's ${lastMinute} changes in a minute, which is past the limit of ${WRITES_PER_MINUTE}. ` +
        `Stop and tell the member what you were trying to do — this ceiling exists because an assistant ` +
        `once created four thousand projects in a loop. If the batch is genuinely wanted, do it on the website.`,
    };
  }

  if (recent.length > WRITES_PER_HOUR) {
    return {
      ok: false,
      message:
        `That's ${recent.length} changes in an hour, past the limit of ${WRITES_PER_HOUR}. ` +
        `Stop and check with the member before continuing.`,
    };
  }

  return { ok: true };
}

/** Test-only reset, so one test's writes can't leak into the next. */
export function resetWriteBudgets(): void {
  writes.clear();
}
