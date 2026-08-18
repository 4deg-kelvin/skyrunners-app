/**
 * An advisor's background: degrees, current role, employer.
 *
 * Pure — no Supabase, no `next/*` — so the shape and its validation can be tested
 * without a database and imported from a client component. The queries live in
 * `store.ts` next door, the same split as `lib/calendar/`.
 */

export interface Degree {
  /** "PhD Aeronautics & Astronautics". Required — a year alone says nothing. */
  degree: string;
  school?: string;
  /** Four-digit year. A number, so it can be sorted and sanity-checked. */
  year?: number;
}

export interface AdvisorProfile {
  degrees: Degree[];
  jobTitle?: string;
  employer?: string;
}

export const EMPTY_ADVISOR_PROFILE: AdvisorProfile = { degrees: [] };

/** How many degrees one person may list. */
export const MAX_DEGREES = 6;

/**
 * The earliest year worth accepting.
 *
 * Not a data-integrity rule so much as a typo catch: a mistyped `201` or `20111`
 * renders as a nonsense date on a public page, and an advisor is exactly the
 * person whose profile a prospective member reads first.
 */
export const EARLIEST_DEGREE_YEAR = 1950;

/**
 * Clean up whatever the form sent.
 *
 * ---------------------------------------------------------------------------
 * Why this both validates AND drops silently, which is usually wrong
 * ---------------------------------------------------------------------------
 *
 * The form renders a fixed number of degree rows, so an advisor with two degrees
 * submits four blank ones alongside them. Refusing the whole save because rows
 * three and four are empty would be absurd, so blank rows are dropped without
 * comment — that is not a validation failure, it is the form's shape.
 *
 * A row with a NAME but a nonsense year is different: the year is discarded and
 * the degree kept, because losing the whole entry over a typo in an optional
 * field is the worse outcome. Nothing here can fail; the worst case is a field
 * quietly not saved, which the advisor sees immediately on the page that renders
 * it back to them.
 */
export function normaliseAdvisorProfile(input: {
  degrees?: { degree?: string; school?: string; year?: string | number }[];
  jobTitle?: string;
  employer?: string;
  /** Injected so the upper year bound isn't the machine clock in a test. */
  thisYear?: number;
}): AdvisorProfile {
  const thisYear = input.thisYear ?? new Date().getFullYear();

  const degrees = (input.degrees ?? [])
    .map((row) => {
      const degree = (row.degree ?? "").trim();
      if (!degree) return null;

      const yearNumber =
        typeof row.year === "number" ? row.year : Number(row.year);
      /*
        A year in the future is allowed by one, for somebody finishing this year
        who thinks of it as done. Beyond that it is a typo.
      */
      const year =
        Number.isInteger(yearNumber) &&
        yearNumber >= EARLIEST_DEGREE_YEAR &&
        yearNumber <= thisYear + 1
          ? yearNumber
          : undefined;

      const school = (row.school ?? "").trim();
      return {
        degree,
        ...(school ? { school } : {}),
        ...(year ? { year } : {}),
      };
    })
    .filter((d): d is Degree => d !== null)
    .slice(0, MAX_DEGREES);

  const jobTitle = (input.jobTitle ?? "").trim();
  const employer = (input.employer ?? "").trim();

  return {
    degrees,
    ...(jobTitle ? { jobTitle } : {}),
    ...(employer ? { employer } : {}),
  };
}

/** "Staff Engineer at Joby Aviation", or whichever half exists. */
export function describeRole(profile: AdvisorProfile): string | undefined {
  const { jobTitle, employer } = profile;
  if (jobTitle && employer) return `${jobTitle} at ${employer}`;
  return jobTitle || employer || undefined;
}

/** "PhD Aeronautics, Stanford, 2011" — skipping whatever is missing. */
export function describeDegree(degree: Degree): string {
  return [degree.degree, degree.school, degree.year].filter(Boolean).join(", ");
}
