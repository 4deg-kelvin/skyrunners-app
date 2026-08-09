import Link from "next/link";
import { TriangleAlert, UserCheck, UserX } from "lucide-react";

import { ActionButton } from "@/components/forms/action-form";
import { setMemberStatusAction } from "@/lib/actions";
import { Badge } from "./badge";
import { SectionLabel } from "./section-label";
import type { Member } from "@/lib/types";

/**
 * People who can't get in, and why.
 *
 * ---------------------------------------------------------------------------
 * The problem this solves
 * ---------------------------------------------------------------------------
 *
 * "I can't add Julia to the website, even though she's logging in with her
 * Stanford ID." Two completely different situations produce that sentence, and
 * the roster showed them identically:
 *
 * **She signed in and is waiting to be activated.** The trigger in migration
 * 0005 creates an INACTIVE profile for anyone who signs in with no matching
 * invite — deliberately, because a missing row would strand them at
 * `/auth/no-profile` with nowhere to go. So she's sitting at `/auth/inactive`
 * and needs one click. Nothing anywhere told a Co-Lead that click was owed.
 *
 * **The invite email doesn't match the address Google returns.** Invited as
 * `jhale@stanford.edu`, signs in as `juliahale@stanford.edu` — the lookup
 * misses, and now there are two rows for one person: an invite that will never
 * link, and an inactive auto-created profile. Inviting her *again* makes it
 * worse. The fix is to correct or delete the stale invite, and the only way to
 * see which case you're in is whether the row has ever signed in.
 *
 * `lastActiveAt` is what separates them, which is why it now reaches the app.
 */
export function AccessIssues({
  waitingForActivation,
  neverSignedIn,
}: {
  /** Signed in at least once, but not active. One click away. */
  waitingForActivation: Member[];
  /** A row that has never been signed in to. Usually a wrong email. */
  neverSignedIn: Member[];
}) {
  if (waitingForActivation.length === 0 && neverSignedIn.length === 0) {
    return null;
  }

  return (
    <div className="rounded-card border border-warn-fg/25 bg-warn-bg">
      <div className="p-6 sm:p-7">
        <SectionLabel tone="muted">Access</SectionLabel>

        {waitingForActivation.length > 0 ? (
          <div className="mt-3">
            <p className="flex items-start gap-2 text-[15px] font-semibold text-warn-fg">
              <UserCheck className="mt-0.5 size-4 shrink-0" />
              {waitingForActivation.length}{" "}
              {waitingForActivation.length === 1 ? "person has" : "people have"}{" "}
              signed in and can&apos;t do anything yet
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              They&apos;re stuck on the &ldquo;account inactive&rdquo; screen.
              Activating takes one click and gives them the whole app.
            </p>

            <div className="mt-3 space-y-2">
              {waitingForActivation.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-tile border border-line bg-card px-4 py-2.5"
                >
                  <span className="min-w-0">
                    <Link
                      href={`/members/${m.id}`}
                      className="text-[15px] font-bold text-ink hover:text-cardinal-600"
                    >
                      {m.fullName}
                    </Link>
                    <span className="ml-2 text-sm text-ink-muted">
                      {m.email}
                    </span>
                  </span>
                  <ActionButton
                    action={setMemberStatusAction}
                    fields={{ memberId: m.id, status: "active" }}
                    label="Activate"
                    pendingLabel="Activating…"
                    tone="primary"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {neverSignedIn.length > 0 ? (
          <div className={waitingForActivation.length > 0 ? "mt-5" : "mt-3"}>
            <p className="flex items-start gap-2 text-[15px] font-semibold text-ink">
              <UserX className="mt-0.5 size-4 shrink-0 text-ink-muted" />
              {neverSignedIn.length} invited{" "}
              {neverSignedIn.length === 1 ? "person has" : "people have"} never
              signed in
            </p>
            <p className="mt-1 flex items-start gap-2 text-sm text-ink-soft">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn-fg" />
              <span>
                If they say they <em>have</em> signed in, the address below
                isn&apos;t the one Google gave back — check it character for
                character. Inviting them again makes it worse: you get a second
                row that also never links. Fix the email on their profile, or
                delete this record and activate the one their sign-in created.
              </span>
            </p>

            <div className="mt-3 space-y-2">
              {neverSignedIn.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-tile border border-line bg-card px-4 py-2.5"
                >
                  <span className="min-w-0">
                    <Link
                      href={`/members/${m.id}`}
                      className="text-[15px] font-bold text-ink hover:text-cardinal-600"
                    >
                      {m.fullName}
                    </Link>
                    {/*
                      The email is the whole diagnostic, so it's shown in full
                      and in a monospace-ish weight rather than truncated.
                    */}
                    <span className="ml-2 text-sm font-semibold text-ink-soft">
                      {m.email}
                    </span>
                  </span>
                  <Badge tone="neutral">Invited, never arrived</Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
