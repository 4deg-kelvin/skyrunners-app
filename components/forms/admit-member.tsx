"use client";

import { ActionForm } from "./action-form";
import { admitMemberAction } from "@/lib/actions";

/**
 * Let somebody into the club.
 *
 * One press, and that is the whole feature. It used to also pick who they
 * report to, because a member with no Lead was invisible to the half of the app
 * that ran on the reporting chain -- nobody read their check-ins and nothing
 * escalated when they went quiet. That half of the app is gone as of
 * 2026-08-24, so there is nothing to assign and no second step to skip.
 *
 * A member with no PROJECT is the shape of that problem now, and it is a much
 * better one: it is visible on Find Work, it is visible on the roster, and the
 * member can fix it themselves by asking to join something.
 *
 * `admitMemberAction`, not `setMemberStatusAction`. Admitting is open to any
 * Lead; deactivating somebody is Co-Lead only. One action serving both acts is
 * what forced the old code to guess which one it was from the row.
 */
export function AdmitMemberForm({
  memberId,
  memberName,
}: {
  memberId: string;
  /** Used in the confirmation copy, so it names a person rather than "them". */
  memberName: string;
}) {
  const firstName = memberName.split(" ")[0];

  return (
    <ActionForm
      action={admitMemberAction}
      className="flex flex-wrap items-center justify-end gap-2"
      renderSubmit={(pending) => (
        <button
          type="submit"
          disabled={pending}
          className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 px-3 py-1.5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
          title={`Give ${firstName} access to the club's pages.`}
        >
          {pending ? "Admitting…" : "Admit"}
        </button>
      )}
    >
      <input type="hidden" name="memberId" value={memberId} />
    </ActionForm>
  );
}
