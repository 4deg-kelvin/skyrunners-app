"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Settings, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn, initials } from "@/lib/utils";
import { useRouter } from "next/navigation";

export function AccountMenu({
  memberId,
  userName,
  isDemo,
}: {
  memberId: string;
  userName: string;
  isDemo: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click and on Escape — a menu you can't dismiss is worse
  // than no menu.
  useEffect(() => {
    if (!open) return;

    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    const supabase = createClient();
    await supabase?.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-full border border-line py-1.5 pl-1.5 pr-3 transition-colors hover:bg-surface"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-neutral-bg text-xs font-bold text-ink-soft">
          {initials(userName)}
        </span>
        <span className="hidden text-[15px] font-medium text-ink sm:inline">
          {userName}
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-ink-muted transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-card border border-line bg-card shadow-sm"
        >
          <Link
            href={`/members/${memberId}`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-3 text-[15px] text-ink transition-colors hover:bg-surface"
          >
            <User className="size-4 text-ink-muted" />
            My profile
          </Link>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-3 text-[15px] text-ink transition-colors hover:bg-surface"
          >
            <Settings className="size-4 text-ink-muted" />
            Update schedule
          </Link>

          <div className="h-px bg-line-soft" />

          {isDemo ? (
            <p className="px-4 py-3 text-sm text-ink-muted">
              Demo mode — no account to sign out of.
            </p>
          ) : (
            <button
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[15px] text-ink transition-colors hover:bg-surface"
            >
              <LogOut className="size-4 text-ink-muted" />
              Sign out
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
