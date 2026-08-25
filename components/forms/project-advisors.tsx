"use client";

import { useState } from "react";
import { GraduationCap, Plus, X } from "lucide-react";

import { ActionForm } from "./action-form";
import { Avatar } from "@/components/ui/avatar";
import { ContactLink } from "@/components/ui/contact-link";
import {
  addProjectAdvisorAction,
  removeProjectAdvisorAction,
} from "@/lib/actions";
import type { Member } from "@/lib/types";

/**
 * Faculty and project advisors named on this project.
 *
 * ---------------------------------------------------------------------------
 * Under "Who to ask", and separate from the PLs
 * ---------------------------------------------------------------------------
 *
 * An advisor is not staff and not accountable for anything — the PL still owns
 * the deliverables. But "who do I ask about this?" has two answers on a project
 * that has a professor attached, and the second one is invisible unless the
 * page says it. A student who is stuck on composites layup should not have to
 * find out from a Co-Lead that the club has somebody who teaches it.
 *
 * Deliberately below the PLs and visually quieter. The PL is who you go to
 * first; the advisor is who the PL goes to.
 *
 * ---------------------------------------------------------------------------
 * Naming somebody here grants them nothing
 * ---------------------------------------------------------------------------
 *
 * An advisor can already see and comment on every project in the club. This
 * only changes which projects LIST them, which is why the PL can do it without
 * a Co-Lead — it's the same call as deciding who the project says to contact,
 * not a grant of access.
 *
 * The picker only offers people whose role is already `advisor`. Making
 * somebody an advisor is a Co-Lead's decision on the roster, and the operation
 * refuses a non-advisor with a sentence explaining that rather than letting an
 * PL quietly invent a fifth kind of membership here.
 */
export function ProjectAdvisors({
  projectId,
  advisors,
  choices,
  canManage,
}: {
  projectId: string;
  advisors: Member[];
  /** Active advisors not already named. Empty means nothing left to add. */
  choices: { id: string; fullName: string }[];
  /** A PL of this project or above it, or a Co-Lead. */
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);

  // Nothing named and nobody who could name anyone: the section would be a
  // heading over an empty space explaining a role this club may not use.
  if (advisors.length === 0 && !canManage) return null;

  return (
    <div className="border-line mt-4 border-t pt-4">
      <p className="text-ink-muted flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.09em] uppercase">
        <GraduationCap className="size-3.5" strokeWidth={2.5} />
        Advisors
      </p>

      {advisors.length === 0 ? (
        <p className="text-ink-muted mt-2 text-sm">
          None named. An advisor can already see this project — naming them here
          just tells people they&apos;re available to ask.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {advisors.map((advisor) => (
            <div key={advisor.id} className="flex items-start gap-2.5">
              <Avatar
                name={advisor.fullName}
                photoUrl={advisor.photoUrl}
                className="size-9 shrink-0 text-xs"
              />
              <div className="min-w-0 flex-1">
                <a
                  href={`/members/${advisor.id}`}
                  className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                >
                  {advisor.fullName}
                </a>
                <ContactLink
                  member={advisor}
                  showLabel={false}
                  className="mt-0.5"
                />
              </div>
              {canManage ? (
                <ActionForm
                  action={removeProjectAdvisorAction}
                  className="shrink-0"
                  renderSubmit={(pending) => (
                    <button
                      type="submit"
                      disabled={pending}
                      aria-label={`Remove ${advisor.fullName} as an advisor`}
                      title="Remove as an advisor on this project"
                      className="text-ink-muted hover:text-risk-fg mt-1 disabled:opacity-50"
                    >
                      <X className="size-3.5" strokeWidth={2.5} />
                    </button>
                  )}
                >
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="memberId" value={advisor.id} />
                </ActionForm>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        adding ? (
          <ActionForm
            action={addProjectAdvisorAction}
            submitLabel="Add"
            submittingLabel="Adding…"
            onSuccess={() => setAdding(false)}
            className="mt-3"
          >
            <input type="hidden" name="projectId" value={projectId} />
            <select
              name="memberId"
              required
              className="rounded-tile border-line bg-card text-ink mb-2 w-full border px-2.5 py-1.5 text-sm"
            >
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-ink-muted hover:text-ink ml-3 text-sm font-semibold"
            >
              Cancel
            </button>
          </ActionForm>
        ) : choices.length > 0 ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-ink-soft hover:text-cardinal-600 mt-3 inline-flex items-center gap-1 text-sm font-semibold"
          >
            <Plus className="size-3.5" strokeWidth={2.5} />
            Name an advisor
          </button>
        ) : (
          /*
            No button when there is nobody to pick. A dropdown with no options
            is the dead control this repo keeps finding — it looks like a
            feature and refuses every press. The sentence says where advisors
            come from instead.
          */
          <p className="text-ink-muted mt-3 text-xs">
            {advisors.length > 0
              ? "Everyone with an advisor account is already named here."
              : "Nobody has an advisor account yet. A Co-Lead sets that on the roster."}
          </p>
        )
      ) : null}
    </div>
  );
}
