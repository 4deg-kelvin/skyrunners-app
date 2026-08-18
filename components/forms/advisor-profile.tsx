"use client";

import { ActionForm } from "./action-form";
import { saveAdvisorProfileAction } from "@/lib/actions";
import { MAX_DEGREES, type AdvisorProfile } from "@/lib/advisors/profile";

const FIELD =
  "rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]";

/**
 * An advisor's own background.
 *
 * ===========================================================================
 * Why an advisor needs a different Settings page from a member
 * ===========================================================================
 *
 * Everything else in Settings assumes the person does engineering work: which
 * days they check in, pausing for exams, the work-log nudge. An advisor has none
 * of those, so their Settings page was a profile form and a list of things that
 * did not apply — and their PUBLIC profile was a name and an email, because the
 * things that make a member's page worth reading are deliverables and a record.
 *
 * This is the replacement: what they know, and what they do now. It is the
 * information a student actually needs in order to decide whether this is the
 * person to ask about a composite layup.
 *
 * ---------------------------------------------------------------------------
 * Fixed rows rather than add/remove buttons
 * ---------------------------------------------------------------------------
 *
 * Six degree rows, always rendered, blanks discarded on save. A dynamic list
 * would need client state, an index to key on, and a story for what happens when
 * somebody deletes the middle row — for a form filled in once, by two people,
 * listing at most a handful of degrees. `normaliseAdvisorProfile` drops the empty
 * rows, which is why this can stay a plain uncontrolled form with no `useState`
 * at all.
 */
export function AdvisorProfileForm({
  bio,
  profile,
  canUse,
}: {
  bio?: string;
  /** Null before the first save, or before migration 0044 is applied. */
  profile: AdvisorProfile | null;
  /** False in demo mode, where there is no database to write to. */
  canUse: boolean;
}) {
  if (!canUse) {
    return (
      <p className="text-ink-soft text-sm">
        Editing this needs a real database, and this is demo mode.
      </p>
    );
  }

  /*
    Padded to a fixed length so every row renders, pre-filled where a degree
    exists. Rendering only the saved ones would leave an advisor with two degrees
    no way to add a third.
  */
  const rows = Array.from({ length: MAX_DEGREES }, (_, i) => ({
    degree: profile?.degrees[i]?.degree ?? "",
    school: profile?.degrees[i]?.school ?? "",
    year: profile?.degrees[i]?.year ? String(profile.degrees[i].year) : "",
  }));

  return (
    <ActionForm
      action={saveAdvisorProfileAction}
      submitLabel="Save"
      submittingLabel="Saving…"
      className="space-y-5"
    >
      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          About you
        </span>
        <textarea
          name="bio"
          rows={4}
          defaultValue={bio ?? ""}
          placeholder="What you work on, and what people should feel free to ask you about."
          className={FIELD}
        />
        <span className="text-ink-muted mt-1 block text-xs">
          Shown on your profile. This is the part members actually read — a line
          about what you can help with is worth more than a full CV.
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Current role
          </span>
          <input
            type="text"
            name="jobTitle"
            defaultValue={profile?.jobTitle ?? ""}
            placeholder="Professor of Aeronautics"
            className={FIELD}
          />
        </label>
        <label className="block min-w-0">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Where
          </span>
          <input
            type="text"
            name="employer"
            defaultValue={profile?.employer ?? ""}
            placeholder="Stanford, or Joby Aviation"
            className={FIELD}
          />
        </label>
      </div>

      <div>
        <span className="text-ink mb-1 block text-sm font-semibold">
          Degrees
        </span>
        <span className="text-ink-muted mb-2 block text-xs">
          As many as you like, most relevant first. Leave the rest blank — empty
          rows are ignored.
        </span>
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[2fr_2fr_1fr]">
              <input
                type="text"
                name={`degree_${i}`}
                defaultValue={row.degree}
                placeholder={i === 0 ? "PhD Aeronautics" : "Degree"}
                aria-label={`Degree ${i + 1}`}
                className={FIELD}
              />
              <input
                type="text"
                name={`school_${i}`}
                defaultValue={row.school}
                placeholder={i === 0 ? "Stanford" : "School"}
                aria-label={`School for degree ${i + 1}`}
                className={FIELD}
              />
              <input
                /*
                  `text`, not `number`. A number input on iOS shows a keypad with
                  a spinner and silently rejects a paste with stray characters;
                  the year is validated on the server either way, where a typo
                  loses the year rather than the whole degree.
                */
                type="text"
                inputMode="numeric"
                name={`year_${i}`}
                defaultValue={row.year}
                placeholder="Year"
                aria-label={`Year for degree ${i + 1}`}
                className={FIELD}
              />
            </div>
          ))}
        </div>
      </div>
    </ActionForm>
  );
}
