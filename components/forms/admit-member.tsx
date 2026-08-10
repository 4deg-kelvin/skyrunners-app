"use client";

import { useState } from "react";

import { ActionForm } from "./action-form";
import { setMemberStatusAction } from "@/lib/actions";

/**
 * Let somebody into the club, and give them a Lead in the same click.
 *
 * ---------------------------------------------------------------------------
 * Why the Lead is not a second step
 * ---------------------------------------------------------------------------
 *
 * A member with no Lead is invisible to the half of the app that runs on the
 * reporting chain: nobody reviews their check-ins, nothing escalates when they
 * go quiet, and they appear on no dashboard. Landing in the club that way is
 * worse than not being admitted, because everybody assumes somebody has them.
 *
 * A separate "now assign a Lead" step would be skipped — it's a chore, and the
 * consequence of skipping it is silent for weeks. So it's one press, defaulting
 * to whoever is looking at the page: they sent the link, they know who this is.
 * Reassigning later is one field on the person's profile.
 *
 * ---------------------------------------------------------------------------
 * One click, unless you want two
 * ---------------------------------------------------------------------------
 *
 * The common case is a Lead admitting their own new recruit, so **Admit** on
 * its own does the whole thing. The picker only appears if you ask for it —
 * putting a dropdown in front of every admission would slow down the case that
 * happens thirty times a quarter to serve the one that happens twice.
 */
export function AdmitMemberForm({
  memberId,
  memberName,
  leads,
  defaultLeadId,
}: {
  memberId: string;
  /** Used in the confirmation copy, so it names a person rather than "them". */
  memberName: string;
  leads: { id: string; fullName: string }[];
  defaultLeadId: string;
}) {
  const [choosing, setChoosing] = useState(false);
  const firstName = memberName.split(" ")[0];

  return (
    <ActionForm
      action={setMemberStatusAction}
      className="flex flex-wrap items-center justify-end gap-2"
      renderSubmit={(pending) => (
        <>
          <button
            type="submit"
            disabled={pending}
            className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 px-3 py-1.5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
          >
            {pending ? "Admitting…" : "Admit"}
          </button>
          {choosing ? null : (
            <button
              type="button"
              onClick={() => setChoosing(true)}
              className="text-ink-muted hover:text-ink text-sm font-semibold"
              title={`By default ${firstName} will report to you.`}
            >
              Reports to me
            </button>
          )}
        </>
      )}
    >
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="status" value="active" />

      {choosing ? (
        <label className="flex items-center gap-2">
          <span className="text-ink-muted text-xs font-semibold">
            Reports to
          </span>
          <select
            name="leadId"
            defaultValue={defaultLeadId}
            className="rounded-tile border-line bg-card text-ink border px-2.5 py-1.5 text-sm"
          >
            {leads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.fullName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </ActionForm>
  );
}
