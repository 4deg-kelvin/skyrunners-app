"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { BadgeCheck, CircleAlert, Loader2 } from "lucide-react";

import { verifyDiscordAction } from "@/lib/actions";
import { formatMoment } from "@/lib/dates";

/**
 * The Discord ID input, with proof attached to it.
 *
 * ---------------------------------------------------------------------------
 * Why the button is HERE and not in its own section
 * ---------------------------------------------------------------------------
 *
 * It used to be: the field lived on the profile form and a separate "Discord"
 * card below it held the status and the test button. Two places for one value,
 * which is the arrangement that produces "I typed it in, why does it still say
 * I'm not connected?" — the answer was two inches further down the page and
 * nobody scrolled to find it.
 *
 * One field, one badge, one button, all on the same line. The state of the
 * connection is never more than a glance away from the thing that sets it.
 *
 * ---------------------------------------------------------------------------
 * Verified means a message actually arrived
 * ---------------------------------------------------------------------------
 *
 * A saved ID and a working one look identical — same digits, same box — and
 * that false confidence is worse than an empty field, because both the member
 * and the app stop worrying about it. So the badge is only earned by a real
 * delivery, and it is withdrawn the moment the ID changes: `updateProfile`
 * clears `discordVerifiedAt` server-side whenever the value moves, and the
 * club-wide banner comes back with it.
 *
 * Editing the box without saving doesn't clear anything — it just stops
 * claiming the badge applies, because it doesn't yet apply to what's on screen.
 */
export function DiscordIdField({
  discordUserId,
  verifiedAt,
  botLive,
  /**
   * A Co-Lead fixing somebody else's profile.
   *
   * They can set the ID but never verify it: the test message goes to whoever
   * is signed in, so pressing it here would prove the wrong person's Discord
   * works and stamp the badge on a member who never received anything.
   */
  editingSomeoneElse = false,
}: {
  discordUserId?: string;
  /** ISO timestamp of the last delivery that actually landed. */
  verifiedAt?: string;
  /** Whether the club has a bot yet. Without one there's nothing to test. */
  botLive: boolean;
  editingSomeoneElse?: boolean;
}) {
  const saved = (discordUserId ?? "").trim();

  const [value, setValue] = useState(saved);
  /*
    The ID the badge was earned by — not a boolean.

    A boolean would survive the member changing their ID and saving: the server
    clears verification, the new props say unverified, but a local `true` would
    keep the tick on screen. Storing WHICH id was proven makes that impossible,
    because the comparison fails as soon as the value moves.
  */
  const [provenFor, setProvenFor] = useState(verifiedAt ? saved : "");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const current = value.trim();
  const unsaved = current !== saved;
  const verified = current !== "" && current === saved && current === provenFor;

  function verify() {
    setNote(null);
    startTransition(async () => {
      // Takes no input; the action reads the signed-in member's saved ID.
      const result = await verifyDiscordAction(new FormData());
      if (result.ok) setProvenFor(current);
      setNote({
        ok: result.ok,
        text: result.ok
          ? (result.message ?? "Sent — check Discord.")
          : (result.error ?? "That didn't go through. Try again in a minute."),
      });
    });
  }

  return (
    <div className="mt-3">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-ink text-sm font-semibold">Discord ID</span>
        {verified ? (
          <span
            className="bg-ok-bg text-ok-fg inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold"
            title={
              verifiedAt
                ? `Last message delivered ${formatMoment(verifiedAt, {
                    month: "long",
                    day: "numeric",
                  })}`
                : undefined
            }
          >
            <BadgeCheck className="size-3.5" strokeWidth={2.5} />
            Verified
          </span>
        ) : current !== "" ? (
          <span className="bg-warn-bg text-warn-fg inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold">
            <CircleAlert className="size-3.5" strokeWidth={2.5} />
            {unsaved ? "Unsaved" : "Not verified"}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          name="discordUserId"
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setNote(null);
          }}
          placeholder="461208577118896129"
          className="rounded-tile border-line bg-card text-ink min-w-[16rem] flex-1 border px-3 py-2 text-[15px]"
        />

        {/*
          `type="button"` matters: this sits inside the profile <form>, and the
          default submit type would save the profile instead of sending
          anything — a dead control that looks like it worked.
        */}
        {editingSomeoneElse || !botLive || current === "" ? null : (
          <button
            type="button"
            onClick={verify}
            disabled={pending || unsaved}
            title={
              unsaved ? "Save your profile first, then verify." : undefined
            }
            className={
              verified
                ? "rounded-tile border-line bg-card text-ink hover:bg-surface inline-flex items-center gap-1.5 border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
                : "rounded-tile bg-cardinal-600 hover:bg-cardinal-700 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60"
            }
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {pending
              ? "Sending…"
              : verified
                ? "Send another test"
                : "Verify now"}
          </button>
        )}
      </div>

      {note ? (
        <p
          role={note.ok ? "status" : "alert"}
          className={`mt-2 text-sm font-medium ${note.ok ? "text-ok-fg" : "text-risk-fg"}`}
        >
          {note.text}
        </p>
      ) : null}

      <p className="text-ink-muted mt-1 text-xs">
        {unsaved && current !== "" ? (
          <span className="text-warn-fg font-semibold">
            Save your profile, then press Verify now.{" "}
          </span>
        ) : null}
        {!botLive ? (
          <span>
            The club&apos;s bot isn&apos;t switched on yet, so there&apos;s
            nothing to test against — having the ID saved is your whole job, and
            notifications start the day it goes live.{" "}
          </span>
        ) : (
          <span>
            Verifying sends you a real DM. If it doesn&apos;t arrive you&apos;ll
            be told exactly why.{" "}
          </span>
        )}
        It&apos;s a long number, not your username: in Discord turn on{" "}
        <span className="text-ink font-semibold">
          Settings → Advanced → Developer Mode
        </span>
        , then right-click your own name and{" "}
        <span className="text-ink font-semibold">Copy User ID</span>.{" "}
        <Link
          href="/getting-started#discord"
          className="text-cardinal-600 hover:text-cardinal-700 font-semibold"
        >
          Walk me through it →
        </Link>
      </p>
    </div>
  );
}
