import Link from "next/link";
import { TriangleAlert, UserCheck, UserX } from "lucide-react";

import { AdmitMemberForm } from "@/components/forms/admit-member";
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
    <div className="rounded-card border-warn-fg/25 bg-warn-bg border">
      <div className="p-6 sm:p-7">
        <SectionLabel tone="muted">Access</SectionLabel>

        {waitingForActivation.length > 0 ? (
          <div className="mt-3">
            <p className="text-warn-fg flex items-start gap-2 text-[15px] font-semibold">
              <UserCheck className="mt-0.5 size-4 shrink-0" />
              {waitingForActivation.length}{" "}
              {waitingForActivation.length === 1 ? "person has" : "people have"}{" "}
              signed in and can&apos;t do anything yet
            </p>
            <p className="text-ink-soft mt-1 text-sm">
              They&apos;re stuck on the &ldquo;account inactive&rdquo; screen.
              One click gives them the whole app. Any Lead can do this, not just
              a Co-Lead — you sent them the link, you can finish the job.
            </p>

            <div className="mt-3 space-y-2">
              {waitingForActivation.map((m) => (
                <div
                  key={m.id}
                  className="rounded-tile border-line bg-card flex flex-wrap items-center justify-between gap-3 border px-4 py-2.5"
                >
                  <span className="min-w-0">
                    <Link
                      href={`/members/${m.id}`}
                      className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                    >
                      {m.fullName}
                    </Link>
                    <span className="text-ink-muted ml-2 text-sm">
                      {m.email}
                    </span>
                  </span>
                  <AdmitMemberForm memberId={m.id} memberName={m.fullName} />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {neverSignedIn.length > 0 ? (
          <div className={waitingForActivation.length > 0 ? "mt-5" : "mt-3"}>
            <p className="text-ink flex items-start gap-2 text-[15px] font-semibold">
              <UserX className="text-ink-muted mt-0.5 size-4 shrink-0" />
              {neverSignedIn.length} invited{" "}
              {neverSignedIn.length === 1 ? "person has" : "people have"} never
              signed in
            </p>
            <p className="text-ink-soft mt-1 flex items-start gap-2 text-sm">
              <TriangleAlert className="text-warn-fg mt-0.5 size-3.5 shrink-0" />
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
                  className="rounded-tile border-line bg-card flex flex-wrap items-center justify-between gap-3 border px-4 py-2.5"
                >
                  <span className="min-w-0">
                    <Link
                      href={`/members/${m.id}`}
                      className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                    >
                      {m.fullName}
                    </Link>
                    {/*
                      The email is the whole diagnostic, so it's shown in full
                      and in a monospace-ish weight rather than truncated.
                    */}
                    <span className="text-ink-soft ml-2 text-sm font-semibold">
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
