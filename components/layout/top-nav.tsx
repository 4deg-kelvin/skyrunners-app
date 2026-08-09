"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DroneMark } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";

const NAV_ITEMS = [
  { href: "/my-work", label: "My Work" },
  // High in the nav on purpose: "I have nothing to do" is the club's biggest
  // retention problem, and this page is the answer to it.
  { href: "/find-work", label: "Find Work" },
  { href: "/dashboard", label: "Dashboard", leadershipOnly: true },
  { href: "/projects", label: "Projects" },
  { href: "/members", label: "Members" },
  { href: "/calendar", label: "Calendar" },
];

export function TopNav({
  memberId,
  userName,
  isLeadership,
  isDemo,
  showLeadingGuide,
  clubName,
  alertCount = 0,
}: {
  memberId: string;
  userName: string;
  isLeadership: boolean;
  isDemo: boolean;
  /** Leads, Co-Leads, and anyone who is an RE of something. */
  showLeadingGuide: boolean;
  /**
   * What the club calls itself, from `club_settings`.
   *
   * Hard-coded here until somebody renamed the club in Settings, saw the
   * card update, and the header carry on saying something else. A rename that
   * doesn't reach the one piece of text on every single page isn't a rename.
   */
  clubName: string;
  /** Real count of things needing attention — drives the nav dot. */
  alertCount?: number;
}) {
  const pathname = usePathname();

  const items = NAV_ITEMS.filter(
    (item) => !item.leadershipOnly || isLeadership
  );

  return (
    <header className="border-line bg-card sticky top-0 z-50 border-b">
      <div className="mx-auto flex h-[68px] max-w-[1400px] items-center gap-6 px-5 sm:px-8">
        {/* Wordmark — goes to the member's own home, same as "/" */}
        <Link href="/my-work" className="flex items-center gap-2.5">
          <span className="bg-cardinal-600 flex size-8 items-center justify-center rounded-full text-white">
            <DroneMark className="size-5" />
          </span>
          <span className="text-cardinal-600 text-lg font-bold tracking-tight">
            {clubName}
          </span>
        </Link>

        <div className="flex-1" />

        {/* Primary navigation */}
        <nav className="hidden items-center gap-1 md:flex">
          {items.map((item) => {
            const active = pathname.startsWith(item.href);
            const showAlert = item.href === "/my-work" && alertCount > 0;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-tile flex items-center gap-1.5 px-3 py-2 text-[15px] transition-colors",
                  active
                    ? "text-cardinal-600 font-semibold"
                    : "text-ink-soft hover:text-ink"
                )}
              >
                {item.label}
                {showAlert ? (
                  <span
                    className="bg-cardinal-600 size-2 rounded-full"
                    aria-label={`${alertCount} item${alertCount === 1 ? "" : "s"} need attention`}
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <AccountMenu
          memberId={memberId}
          userName={userName}
          isDemo={isDemo}
          showLeadingGuide={showLeadingGuide}
        />
      </div>

      {/* Mobile nav — hours get logged in the lab, on phones */}
      <nav className="border-line flex items-center gap-1 overflow-x-auto border-t px-5 py-2 md:hidden">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-tile shrink-0 px-3 py-1.5 text-sm transition-colors",
                active
                  ? "text-cardinal-600 font-semibold"
                  : "text-ink-soft hover:text-ink"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
