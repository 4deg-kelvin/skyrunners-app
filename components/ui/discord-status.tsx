import { BadgeCheck, MessageSquareOff } from "lucide-react";

import { formatMoment } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Whether the club's bot can actually reach this person.
 *
 * ---------------------------------------------------------------------------
 * Public, for the same reason trainings are
 * ---------------------------------------------------------------------------
 *
 * It answers a question other people have about you, not one you have about
 * yourself. A Lead wondering why their DM went nowhere, an RE about to add
 * somebody to a project and expecting the bot to tell them — both need to know
 * before they rely on it, and neither can find out by asking the app anywhere
 * else. Same shape as "cleared on the laser cutter": a fact about capability
 * that other people plan around.
 *
 * What is deliberately NOT shown is the Discord ID itself. Knowing somebody is
 * reachable is the useful half; the raw snowflake helps nobody read the page
 * and is the sort of thing that ends up copied into a spreadsheet.
 *
 * ---------------------------------------------------------------------------
 * "Verified" means a message actually arrived
 * ---------------------------------------------------------------------------
 *
 * A saved ID and a working one look identical, and that false confidence is
 * the whole reason verification exists — so an unproven ID reads as NOT
 * connected here, exactly as it does on the member's own settings page. There
 * is no third state on the profile: from the outside, "they typed something in
 * once" and "nothing" are the same amount of reachable.
 */
export function DiscordStatus({
  verifiedAt,
  className,
}: {
  /** ISO instant of the last delivery that landed. Undefined = unproven. */
  verifiedAt?: string;
  className?: string;
}) {
  const base = cn(
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
    className
  );

  if (verifiedAt) {
    return (
      <span
        className={cn(base, "bg-ok-bg text-ok-fg")}
        title={`The club bot reached them on ${formatMoment(verifiedAt, {
          month: "long",
          day: "numeric",
        })}`}
      >
        <BadgeCheck className="size-3.5 shrink-0" strokeWidth={2.5} />
        Discord verified
      </span>
    );
  }

  return (
    <span
      className={cn(base, "bg-surface text-ink-muted")}
      title="No Discord message has been delivered to them yet, so the bot can't reach them."
    >
      <MessageSquareOff className="size-3.5 shrink-0" strokeWidth={2.5} />
      Discord not connected
    </span>
  );
}
