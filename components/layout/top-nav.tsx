"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plane } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";

const NAV_ITEMS = [
  { href: "/my-work", label: "My Work" },
  // High in the nav on purpose: "I have nothing to do" is the club's biggest
  // retention problem, and this page is the answer to it.
  { href: "/find-work", label: "Find Work" },
  // Next to Find Work because they're the same problem from opposite ends:
  // "I have nothing to do" and "I can't get unstuck". Both used to require
  // asking a Co-Lead, which is the thing this app exists to remove.
  { href: "/blockers", label: "Blockers" },
  { href: "/dashboard", label: "Dashboard", leadershipOnly: true },
  { href: "/projects", label: "Projects" },
  { href: "/members", label: "Members" },
  { href: "/trainings", label: "Trainings" },
  { href: "/deadlines", label: "Deadlines" },
  { href: "/calendar", label: "Calendar" },
];

export function TopNav({
  memberId,
  userName,
  isLeadership,
  isDemo,
  alertCount = 0,
}: {
  memberId: string;
  userName: string;
  isLeadership: boolean;
  isDemo: boolean;
  /** Real count of things needing attention — drives the nav dot. */
  alertCount?: number;
}) {
  const pathname = usePathname();

  const items = NAV_ITEMS.filter(
    (item) => !item.leadershipOnly || isLeadership
  );

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-card">
      <div className="mx-auto flex h-[68px] max-w-[1400px] items-center gap-6 px-5 sm:px-8">
        {/* Wordmark — goes to the member's own home, same as "/" */}
        <Link href="/my-work" className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-cardinal-600 text-white">
            <Plane className="size-4" strokeWidth={2.5} />
          </span>
          <span className="text-lg font-bold tracking-tight text-cardinal-600">
            SkyRunners HQ
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
                  "flex items-center gap-1.5 rounded-tile px-3 py-2 text-[15px] transition-colors",
                  active
                    ? "font-semibold text-cardinal-600"
                    : "text-ink-soft hover:text-ink"
                )}
              >
                {item.label}
                {showAlert ? (
                  <span
                    className="size-2 rounded-full bg-cardinal-600"
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
        />
      </div>

      {/* Mobile nav — hours get logged in the lab, on phones */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-line px-5 py-2 md:hidden">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "shrink-0 rounded-tile px-3 py-1.5 text-sm transition-colors",
                active
                  ? "font-semibold text-cardinal-600"
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
