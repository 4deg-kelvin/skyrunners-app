"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Plane } from "lucide-react";
import { cn, initials } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/my-work", label: "My Work", hasAlert: true },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/members", label: "Members" },
  { href: "/calendar", label: "Calendar" },
];

export function TopNav({ userName }: { userName: string }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-card">
      <div className="mx-auto flex h-[68px] max-w-[1400px] items-center gap-6 px-5 sm:px-8">
        {/* Wordmark */}
        <Link href="/dashboard" className="flex items-center gap-2.5">
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
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href);
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
                {item.hasAlert ? (
                  <span
                    className="size-2 rounded-full bg-cardinal-600"
                    aria-label="needs attention"
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Account chip */}
        <button className="flex items-center gap-2.5 rounded-full border border-line py-1.5 pl-1.5 pr-3 transition-colors hover:bg-surface">
          <span className="flex size-8 items-center justify-center rounded-full bg-neutral-bg text-xs font-bold text-ink-soft">
            {initials(userName)}
          </span>
          <span className="hidden text-[15px] font-medium text-ink sm:inline">
            {userName}
          </span>
          <ChevronDown className="size-4 text-ink-muted" />
        </button>
      </div>
    </header>
  );
}
