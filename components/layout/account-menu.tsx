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
        className="border-line hover:bg-surface flex items-center gap-2.5 rounded-full border py-1.5 pr-3 pl-1.5 transition-colors"
      >
        <span className="bg-neutral-bg text-ink-soft flex size-8 items-center justify-center rounded-full text-xs font-bold">
          {initials(userName)}
        </span>
        <span className="text-ink hidden text-[15px] font-medium sm:inline">
          {userName}
        </span>
        <ChevronDown
          className={cn(
            "text-ink-muted size-4 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="rounded-card border-line bg-card absolute right-0 z-50 mt-2 w-60 overflow-hidden border shadow-sm"
        >
          <Link
            href={`/members/${memberId}`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="text-ink hover:bg-surface flex items-center gap-2.5 px-4 py-3 text-[15px] transition-colors"
          >
            <User className="text-ink-muted size-4" />
            My profile
          </Link>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="text-ink hover:bg-surface flex items-center gap-2.5 px-4 py-3 text-[15px] transition-colors"
          >
            <Settings className="text-ink-muted size-4" />
            Update schedule
          </Link>

          <div className="bg-line-soft h-px" />

          {isDemo ? (
            <p className="text-ink-muted px-4 py-3 text-sm">
              Demo mode — no account to sign out of.
            </p>
          ) : (
            <button
              role="menuitem"
              onClick={signOut}
              className="text-ink hover:bg-surface flex w-full items-center gap-2.5 px-4 py-3 text-left text-[15px] transition-colors"
            >
              <LogOut className="text-ink-muted size-4" />
              Sign out
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
