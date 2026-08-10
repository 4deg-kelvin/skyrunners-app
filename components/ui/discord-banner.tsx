"use client";

import Link from "next/link";
import { MessageSquareWarning } from "lucide-react";

/**
 * "You haven't connected Discord yet", on every page until they have.
 *
 * ---------------------------------------------------------------------------
 * Why a banner and not a gate
 * ---------------------------------------------------------------------------
 *
 * Connecting is required — all club communication runs through Discord — but
 * blocking the app until it's done would be the wrong trade. The bot can fail
 * for reasons the member cannot fix from inside the app (it isn't in the
 * server, Discord is down, their privacy settings), and a hard gate turns
 * every one of those into somebody locked out of the tool entirely on the day
 * they joined. A banner they cannot dismiss is nearly as loud and fails safe.
 *
 * Only rendered when the club has actually configured a bot. Nagging people to
 * connect to something that doesn't exist yet is how a banner teaches everyone
 * to ignore banners.
 */
export function DiscordBanner({
  hasId,
  botLive,
}: {
  hasId: boolean;
  /** Whether the club has a bot yet — decides whose move it is. */
  botLive: boolean;
}) {
  /*
    Three states, because the reader's next action is different in each. The
    banner only ever clears on a verified delivery, so the third one — ID
    saved, no bot to prove it against — has to say plainly that it's waiting on
    the club rather than on them.
  */
  const waitingOnUs = hasId && !botLive;

  return (
    <div
      className={
        waitingOnUs
          ? "border-line bg-surface border-b"
          : "border-warn-fg/30 bg-warn-bg/60 border-b"
      }
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5 sm:px-8">
        <MessageSquareWarning
          className={`size-4 shrink-0 ${waitingOnUs ? "text-ink-muted" : "text-warn-fg"}`}
        />
        <p className="text-ink min-w-0 text-sm">
          <span className="font-semibold">
            {!hasId
              ? "You haven't connected Discord yet."
              : waitingOnUs
                ? "Discord ID saved — waiting on the club."
                : "Your Discord ID isn't confirmed yet."}
          </span>{" "}
          <span className="text-ink-soft">
            {!hasId
              ? "All club communication runs through Discord, and it's how you'll hear that you've been added to something. If you don't have it, install it first."
              : waitingOnUs
                ? "Nothing for you to do. The club's bot isn't switched on yet, so we can't send the test message that confirms it works."
                : "We haven't proved a message actually reaches you — one click does it."}
          </span>
        </p>
        {/*
          The invite link is deliberately NOT here.

          This banner renders on every page, so putting it here would publish
          the server link club-wide, permanently, to everybody — including the
          thirty people already in the server who don't need it. It lives in
          exactly two places instead: the new-member guide, which is where
          somebody who has to join is reading, and Settings, which is where
          somebody who has lost it goes looking. Both are one click from here.
        */}
        {waitingOnUs ? null : (
          <Link
            href="/settings"
            className="text-cardinal-600 hover:text-cardinal-700 text-sm font-bold whitespace-nowrap"
          >
            {hasId ? "Confirm it now →" : "Connect it →"}
          </Link>
        )}
      </div>
    </div>
  );
}
