"use client";

import { useState } from "react";
import { HandHelping } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import { Badge } from "@/components/ui/badge";
import {
  createMemberRequestAction,
  withdrawMemberRequestAction,
} from "@/lib/actions";
import { formatMoment } from "@/lib/dates";
import type { MemberRequest } from "@/lib/types";

/**
 * "Ask {name} for something" — on a Lead's profile.
 *
 * ---------------------------------------------------------------------------
 * Why this is on a profile and not a form somewhere central
 * ---------------------------------------------------------------------------
 *
 * The app never has to know who owns the Fusion drive. A central "request
 * access" page would need a list of grantable things and a mapping from each
 * one to a person — a second catalogue to keep current, and wrong the first
 * time somebody hands the keys over.
 *
 * Putting the button on a person instead makes the routing free: you ask
 * whoever the documentation says to ask, and the request lands on exactly that
 * person's dashboard. The cost is that the member has to know who — which is
 * why the new-member guide says so, and why it's a sentence in a doc rather
 * than a table in a database.
 *
 * ---------------------------------------------------------------------------
 * Not for doors and machines
 * ---------------------------------------------------------------------------
 *
 * Anything that needs TRAINING is a catalogue item and goes through the
 * trainings flow on your own profile: the laser cutter, the mill, the robotics
 * room. That flow records who is cleared on what, expires, and shows up on the
 * roster. This is for everything that just needs somebody to say yes.
 */
export function MemberRequestForm({
  leadId,
  leadName,
  existing,
}: {
  leadId: string;
  leadName: string;
  /**
   * The viewer's own most recent request to this person, if any.
   *
   * Shown rather than hidden. An ask that vanishes the moment you send it is
   * the "email the RE" dead end wearing a different hat — you can't tell
   * whether it arrived, and the only move left is to send it again.
   */
  existing?: MemberRequest;
}) {
  const [open, setOpen] = useState(false);
  const firstName = leadName.split(" ")[0];

  if (existing?.status === "pending") {
    return (
      <div className="border-line mt-4 border-t pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warn">Request pending</Badge>
          <span className="text-ink-muted text-xs">
            sent {formatMoment(existing.createdAt)}
          </span>
        </div>
        <p className="text-ink-soft mt-2 text-sm">
          &ldquo;{existing.body}&rdquo;
        </p>
        <p className="text-ink-muted mt-1.5 text-xs">
          It&apos;s on {firstName}&apos;s dashboard. You&apos;ll get a Discord
          message when they answer.
        </p>
        {/*
          Withdrawing exists so "I asked for the wrong thing" has a move other
          than asking again. The operation refuses a second open request to the
          same person, so without this the only way to correct an ask would be
          to wait for it to be answered first.
        */}
        <div className="mt-2.5">
          <ActionButton
            action={withdrawMemberRequestAction}
            fields={{ requestId: existing.id }}
            label="Withdraw it"
            pendingLabel="Withdrawing…"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="border-line mt-4 border-t pt-4">
      {/*
        The last answer, if there was one. Kept visible because "did I already
        ask about this?" is the question somebody has right before asking twice.
      */}
      {existing ? (
        <div className="mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={existing.status === "granted" ? "ok" : "neutral"}>
              {existing.status === "granted" ? "Granted" : "Declined"}
            </Badge>
            <span className="text-ink-muted text-xs">
              {existing.respondedAt ? formatMoment(existing.respondedAt) : null}
            </span>
          </div>
          <p className="text-ink-soft mt-1.5 text-sm">
            &ldquo;{existing.body}&rdquo;
          </p>
          {existing.response ? (
            <p className="text-ink mt-1 text-sm">
              <span className="font-semibold">{firstName}:</span>{" "}
              {existing.response}
            </p>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <ActionForm
          action={createMemberRequestAction}
          submitLabel={`Send to ${firstName}`}
          submittingLabel="Sending…"
          onSuccess={() => setOpen(false)}
        >
          <input type="hidden" name="leadId" value={leadId} />
          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              What do you need?
            </span>
            <textarea
              name="body"
              rows={3}
              required
              maxLength={1000}
              placeholder="Access to the Fusion team drive — I'm doing the CAD for the SkyBeta frames."
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
            />
          </label>
          <p className="text-ink-muted mt-1 mb-2.5 text-xs">
            Saying what it&apos;s for is what makes this a two-second yes rather
            than a reply asking why.{" "}
            <span className="text-ink font-semibold">
              Room and machine access goes through Trainings on your own profile
            </span>{" "}
            — those need a safety check, not just permission.
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-ink-muted hover:text-ink ml-5 text-sm font-semibold"
          >
            Cancel
          </button>
        </ActionForm>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-tile border-line text-ink hover:bg-surface inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold"
        >
          <HandHelping className="size-3.5" strokeWidth={2.5} />
          Ask {firstName} for something
        </button>
      )}
    </div>
  );
}
