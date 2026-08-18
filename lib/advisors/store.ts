/**
 * Reading and writing `advisor_profiles`.
 *
 * ===========================================================================
 * Every function here FAILS SOFT, and that is the point
 * ===========================================================================
 *
 * This table arrives in migration 0044, and the app is deployed by pushing to
 * main — so there is a window where the code is live and the table is not. On
 * `profiles` that window is fatal: the per-request snapshot selects an explicit
 * column list, so one missing column 500s every page in the club until the SQL
 * lands (docs/HANDOFF.md, and the reason `migration-before-push` exists).
 *
 * Reading its own table with its own query makes that window harmless instead. A
 * missing table is an error on ONE query, which is swallowed here and returns
 * "no advisor profile" — which is also the honest answer, since there isn't one
 * yet. Nothing else on the page notices.
 *
 * So the deploy order stops mattering, and the feature switches itself on the
 * moment the migration is applied, with no second deploy. Same reason
 * `lib/calendar/store.ts` and `lib/mcp/store.ts` bypass the snapshot.
 *
 * The cost is that a genuine database fault also reads as "no profile" rather
 * than shouting. Accepted: this is one optional block on a profile page, and the
 * error is logged.
 */

import { createClient } from "@/lib/supabase/server";
import {
  EMPTY_ADVISOR_PROFILE,
  type AdvisorProfile,
  type Degree,
} from "./profile";

const COLUMNS = "member_id, degrees, job_title, employer";

interface Row {
  member_id: string;
  degrees: unknown;
  job_title: string | null;
  employer: string | null;
}

/**
 * Narrow whatever jsonb holds into `Degree[]`.
 *
 * Validated rather than cast, because jsonb accepts anything: a hand-written SQL
 * update, an older shape, or a future field could all put something here that
 * this build does not expect, and `degree.year.toFixed()` on a string is a
 * crashed page. Anything unrecognisable is dropped.
 */
function toDegrees(value: unknown): Degree[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const degree = typeof row.degree === "string" ? row.degree.trim() : "";
    if (!degree) return [];
    return [
      {
        degree,
        ...(typeof row.school === "string" && row.school.trim()
          ? { school: row.school.trim() }
          : {}),
        ...(typeof row.year === "number" && Number.isInteger(row.year)
          ? { year: row.year }
          : {}),
      },
    ];
  });
}

function fromRow(row: Row): AdvisorProfile {
  return {
    degrees: toDegrees(row.degrees),
    ...(row.job_title ? { jobTitle: row.job_title } : {}),
    ...(row.employer ? { employer: row.employer } : {}),
  };
}

/**
 * One person's advisor background, or null if they have none.
 *
 * Null covers three cases on purpose — not an advisor, an advisor who has not
 * filled it in, and the migration not yet applied — because the page renders
 * nothing in all three.
 */
export async function advisorProfileFor(
  memberId: string
): Promise<AdvisorProfile | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("advisor_profiles")
    .select(COLUMNS)
    .eq("member_id", memberId)
    .maybeSingle();

  if (error) {
    // Logged, not thrown. A missing table is the expected pre-migration state.
    console.error("[advisors] read failed", error.message);
    return null;
  }
  return data ? fromRow(data as unknown as Row) : null;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Write the signed-in advisor's own background.
 *
 * `upsert` on the primary key, so first save and every later edit are one path.
 * RLS scopes both directions to `auth.uid()`, which is why no member id is
 * accepted here — a caller cannot ask to write somebody else's row.
 *
 * Unlike the read, a failed WRITE is reported. The member pressed a button and is
 * waiting to be told whether it worked; silence there would be the one-time-secret
 * trap in a different costume.
 */
export async function saveMyAdvisorProfile(
  profile: AdvisorProfile
): Promise<SaveResult> {
  const supabase = await createClient();
  if (!supabase) {
    return { ok: false, error: "Not available in demo mode." };
  }

  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) return { ok: false, error: "You need to be signed in." };

  const { error } = await supabase.from("advisor_profiles").upsert(
    {
      member_id: id,
      degrees: profile.degrees,
      job_title: profile.jobTitle ?? null,
      employer: profile.employer ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "member_id" }
  );

  if (error) {
    /*
      Named specifically, because there is one likely cause and it has one fix.
      "Could not find the table" before migration 0044 is applied would otherwise
      reach an advisor as raw Postgres text.
    */
    const missing =
      error.message.includes("advisor_profiles") &&
      /does not exist|not find/i.test(error.message);
    return {
      ok: false,
      error: missing
        ? "This needs one database migration that hasn't been applied yet (supabase/migrations/0044_advisor_profiles.sql). Tell whoever runs the site."
        : `Couldn't save that: ${error.message}`,
    };
  }
  return { ok: true };
}

export { EMPTY_ADVISOR_PROFILE };
