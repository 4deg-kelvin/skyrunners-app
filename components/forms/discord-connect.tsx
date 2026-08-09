"use client";

import Link from "next/link";
import { CheckCircle2, CircleAlert } from "lucide-react";

import { ActionButton } from "./action-form";
import { verifyDiscordAction } from "@/lib/actions";

/**
 * Connect state, and the one button that proves it.
 *
 * The status line is doing the real work here. An ID that has never delivered
 * anything looks exactly like one that has — same digits, same field — and
 * that false confidence is worse than an empty box, because both the member
 * and the app stop worrying about it. So the app refuses to call anything
 * connected until a message has actually arrived.
 *
 * The ID itself is edited on the profile form above; this only tests it. Two
 * fields for one value would invite them disagreeing.
 */
export function DiscordConnect({
  discordUserId,
  verifiedAt,
}: {
  discordUserId?: string;
  /** ISO timestamp of the last successful delivery. Undefined = unproven. */
  verifiedAt?: string;
}) {
  if (verifiedAt) {
    return (
      <div className="mt-3">
        <p className="text-ok-fg flex items-center gap-2 text-[15px] font-semibold">
          <CheckCircle2 className="size-4.5" strokeWidth={2.5} />
          Connected
        </p>
        <p className="text-ink-soft mt-1 text-[15px]">
          The bot reached you on{" "}
          {new Date(verifiedAt).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
          })}
          . You&apos;ll get a DM when you&apos;re added to a project, when an
          ask of yours is answered, and — if you lead people — when one of them
          checks in.
        </p>
        <div className="mt-3">
          <ActionButton
            action={verifyDiscordAction}
            fields={{}}
            label="Send another test message"
            pendingLabel="Sending…"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-warn-fg flex items-center gap-2 text-[15px] font-semibold">
        <CircleAlert className="size-4.5" strokeWidth={2.5} />
        {discordUserId ? "Not confirmed yet" : "Not connected"}
      </p>

      {discordUserId ? (
        <p className="text-ink-soft mt-1 max-w-2xl text-[15px]">
          Your ID is saved but we haven&apos;t proved it reaches you. Press the
          button — if a message arrives in Discord, you&apos;re done. If it
          doesn&apos;t, you&apos;ll get told exactly why.
        </p>
      ) : (
        <p className="text-ink-soft mt-1 max-w-2xl text-[15px]">
          All club communication runs through Discord — install it if you
          haven&apos;t, join the club server, then add your Discord ID in{" "}
          <span className="text-ink font-semibold">My Profile</span> above. It
          takes about two minutes and you only do it once.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {discordUserId ? (
          <ActionButton
            action={verifyDiscordAction}
            fields={{}}
            label="Send a test message"
            pendingLabel="Sending…"
            tone="primary"
          />
        ) : null}
        <Link
          href="/getting-started#discord"
          className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
        >
          How to find your Discord ID →
        </Link>
      </div>
    </div>
  );
}
