/**
 * Who signs off each training, and which ones a member can tick themselves.
 *
 * ===========================================================================
 * What this replaces
 * ===========================================================================
 *
 * Until 2026-08-24, a training was verified by the member's Lead chain. There is
 * no chain, so the club chose a per-ITEM answer instead, which is the RE pattern
 * applied to a machine: accountability sits with a named person rather than with
 * a rank.
 *
 * Each catalogue item is configured one of two ways:
 *
 *   - **A named verifier.** One person signs off requests for it. "Tyler
 *     verifies the mill" is a sentence a new member can act on; "ask your Lead"
 *     is not, and was the thing being removed.
 *   - **Self-verify.** The member ticks it and nobody is asked. Right for
 *     anything where the honest answer is "did you read this" — a shop induction
 *     video, a document — and it removes the queue entirely for those, which is
 *     most of what was clogging it.
 *
 * Co-Leads can always verify anything. Unconfigured items fall back to the
 * interim rule in `can.verifyTraining`: any Lead. That fallback is deliberate
 * rather than a gap — a catalogue of thirty machines cannot be assigned in one
 * sitting, and "nobody can verify this yet" would lock people out of the shop.
 *
 * ===========================================================================
 * Why a separate table, and why that is a compromise
 * ===========================================================================
 *
 * The obvious schema is two columns on `catalogue_items`: `verifier_id` and
 * `self_verify`. That is what `docs/REPORTING_REMOVAL_PLAN.md` proposed and it
 * is still the right long-term shape.
 *
 * It is not what shipped, for one reason: `catalogue_items` is read by the
 * per-request snapshot with an EXPLICIT column list, so the moment this code
 * selects a column that does not exist yet, EVERY page in the club 500s until
 * the SQL is applied. The database password is currently rejected and cannot be
 * applied, so two columns would have meant either shipping nothing or shipping
 * an outage.
 *
 * A side table read by its own fail-soft query has neither problem: it works in
 * demo mode today, it is harmless in live mode before the migration, and it
 * switches itself on the moment migration 0046 lands with no second deploy.
 * Same pattern and justification as `lib/advisors/store.ts` and
 * `lib/worklog/replies.ts`.
 *
 * **Worth folding into `catalogue_items` once the database is reachable.** Two
 * scalar settings on an item belong on the item, and a one-row-per-item side
 * table is a wart that will outlive the reason for it. It is a mechanical change:
 * this module's two functions and one migration.
 *
 * ===========================================================================
 * The lock-out safeguard
 * ===========================================================================
 *
 * You cannot demote or deactivate somebody who is still the named verifier for
 * a training. That guard is `verifierLockOut` in `lib/store/operations.ts`, not
 * here, and deliberately: it runs INSIDE the write, where an async read would be
 * a query in a transaction, so it reads the store synchronously instead.
 *
 * The refusal has to NAME what is blocking it. A bare "not allowed" on an
 * org-chart edit is the kind of message people work around by deleting something
 * else, and what they would delete here is a safety record.
 */

import { createClient } from "@/lib/supabase/server";
import { readStore, mutate } from "@/lib/store/disk";
import type { CatalogueVerifier } from "@/lib/types";

// The type lives in `lib/types.ts` beside `CatalogueItem`, not here, so the disk
// store can name it without importing from a feature directory. Re-exported for
// callers that already import this module.
export type { CatalogueVerifier };

const COLUMNS = "item_id, verifier_id, self_verify";

interface Row {
  item_id: string;
  verifier_id: string | null;
  self_verify: boolean | null;
}

function fromRow(row: Row): CatalogueVerifier {
  return {
    itemId: row.item_id,
    ...(row.verifier_id ? { verifierId: row.verifier_id } : {}),
    selfVerify: !!row.self_verify,
  };
}

/**
 * Every configured item, keyed by item id.
 *
 * One query, not one per item: the catalogue page renders every item and a query
 * inside that loop is the round-trip-per-row mistake `lib/data/*` exists to
 * prevent.
 *
 * An empty map covers three cases on purpose — nothing configured, the migration
 * not applied, and demo mode with no config yet — because every caller treats
 * all three the same way: fall back to the interim rule.
 */
export async function catalogueVerifiers(): Promise<
  Map<string, CatalogueVerifier>
> {
  const supabase = await createClient();

  // Demo mode. The disk store carries this collection but the LIVE snapshot
  // deliberately does not — see the header on why the snapshot must not name it.
  if (!supabase) {
    const rows = readStore().catalogueVerifiers ?? [];
    return new Map(rows.map((r) => [r.itemId, r]));
  }

  const { data, error } = await supabase
    .from("catalogue_verifiers")
    .select(COLUMNS);

  if (error) {
    // Logged, not thrown. A missing table is the expected pre-migration state,
    // and an empty map means "fall back to any Lead" rather than "nobody".
    console.error("[trainings] verifier read failed", error.message);
    return new Map();
  }

  return new Map(
    (data as unknown as Row[]).map((r) => {
      const v = fromRow(r);
      return [v.itemId, v];
    })
  );
}

export type SaveVerifierResult = { ok: true } | { ok: false; error: string };

/**
 * Configure one item: a named verifier, self-verify, or neither.
 *
 * The three states are distinct and all reachable, which is why this takes both
 * fields rather than a single mode:
 *
 *   - `verifierId` set, `selfVerify` false — one person signs it off.
 *   - `selfVerify` true — the member ticks it. Any `verifierId` is cleared,
 *     because keeping one would leave a person named as accountable for a
 *     sign-off that never reaches them.
 *   - neither — unconfigured, falls back to any Lead.
 *
 * A failed write is REPORTED, unlike the read. A Co-Lead pressed a button and is
 * waiting to be told whether it worked; silence there is the one-time-secret trap
 * in a different costume.
 */
export async function saveCatalogueVerifier(input: {
  itemId: string;
  verifierId?: string;
  selfVerify: boolean;
}): Promise<SaveVerifierResult> {
  const verifierId = input.selfVerify ? undefined : input.verifierId;
  const row: CatalogueVerifier = {
    itemId: input.itemId,
    ...(verifierId ? { verifierId } : {}),
    selfVerify: input.selfVerify,
  };

  const supabase = await createClient();

  if (!supabase) {
    await mutate((store) => {
      const rows = (store.catalogueVerifiers ??= []);
      const existing = rows.findIndex((r) => r.itemId === input.itemId);
      if (existing >= 0) rows[existing] = row;
      else rows.push(row);
    });
    return { ok: true };
  }

  const { error } = await supabase.from("catalogue_verifiers").upsert({
    item_id: input.itemId,
    verifier_id: verifierId ?? null,
    self_verify: input.selfVerify,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * May this person verify this item? Pure, so both the page and the operation can
 * ask without a second query.
 *
 * `fallbackAllowed` is the answer from `can.verifyTraining` — the interim "any
 * Lead" rule. It applies only to UNCONFIGURED items: once somebody is named, a
 * different Lead signing off the mill defeats the point of naming them.
 *
 * Co-Leads pass `isCoLead` and skip all of it, which is what stops a graduated
 * verifier stranding a machine before anyone notices.
 */
export function mayVerifyItem(input: {
  actorId: string;
  isCoLead: boolean;
  subjectId: string;
  config?: CatalogueVerifier;
  fallbackAllowed: boolean;
}): boolean {
  if (input.isCoLead) return true;

  const config = input.config;

  if (config?.selfVerify) {
    /*
      Self-verify means the MEMBER ticks it, and nobody else needs to.
      Deliberately not "anybody can tick it for anybody": a clearance somebody
      else claimed on your behalf is a record you did not make, and the whole
      value of self-verify is that the person attesting is the person who read
      the thing.
    */
    return input.actorId === input.subjectId;
  }

  if (config?.verifierId) {
    // Named verifier, and never for themselves. Two people sign off a safety
    // clearance and one of them is never the person being cleared.
    return (
      config.verifierId === input.actorId && input.actorId !== input.subjectId
    );
  }

  return input.fallbackAllowed;
}
