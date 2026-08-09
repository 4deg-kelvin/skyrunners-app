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
export function DiscordBanner({ hasId }: { hasId: boolean }) {
  return (
    <div className="border-warn-fg/30 bg-warn-bg/60 border-b">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5 sm:px-8">
        <MessageSquareWarning className="text-warn-fg size-4 shrink-0" />
        <p className="text-ink min-w-0 text-sm">
          <span className="font-semibold">
            {hasId
              ? "Your Discord ID isn't confirmed yet."
              : "You haven't connected Discord yet."}
          </span>{" "}
          <span className="text-ink-soft">
            {hasId
              ? "We haven't been able to reach you on it — one click confirms it works."
              : "All club communication runs through Discord, and it's how you'll hear that you've been added to something. If you don't have it, install it first."}
          </span>
        </p>
        <Link
          href="/settings"
          className="text-cardinal-600 hover:text-cardinal-700 text-sm font-bold whitespace-nowrap"
        >
          {hasId ? "Confirm it now →" : "Connect it →"}
        </Link>
      </div>
    </div>
  );
}
