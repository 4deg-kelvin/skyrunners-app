"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  LifeBuoy,
  LogOut,
  Settings,
  ShieldCheck,
  User,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { useRouter } from "next/navigation";

export function AccountMenu({
  memberId,
  userName,
  isDemo,
  showLeadingGuide = false,
  photoUrl,
}: {
  memberId: string;
  userName: string;
  isDemo: boolean;
  /**
   * Their actual face, when they've set one.
   *
   * This drew initials unconditionally — the one place in the app that showed
   * YOU your own identity was the one place that ignored the photo you'd
   * uploaded. `Avatar` already handles the fallback, the Google
   * referrer-policy quirk, and a broken image URL.
   */
  photoUrl?: string;
  /**
   * Whether to offer the leadership guide.
   *
   * True for Leads, Co-Leads AND plain members who are an RE of something —
   * the RE role carries real authority and is the one most likely to surprise
   * whoever holds it. Gating on `globalRole` alone would hide it from exactly
   * those people.
   */
  showLeadingGuide?: boolean;
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
        <Avatar
          name={userName}
          photoUrl={photoUrl}
          className="size-8 text-xs"
        />
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
          {/*
            First, and visually separated.

            The club loses people to disorganisation, and a new member who
            can't tell what the app wants from them in the first five minutes
            is exactly the person who drifts. It's here rather than in the nav
            because the nav has six items and that ceiling is deliberate — this
            is read once and then never again.
          */}
          <Link
            href="/getting-started"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="text-ink hover:bg-surface flex items-center gap-2.5 px-4 py-3 text-[15px] font-semibold transition-colors"
          >
            <LifeBuoy className="text-cardinal-600 size-4" />
            New here? Start here
          </Link>

          {showLeadingGuide ? (
            <Link
              href="/leading"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="text-ink hover:bg-surface flex items-center gap-2.5 px-4 py-3 text-[15px] font-semibold transition-colors"
            >
              <ShieldCheck className="text-cardinal-600 size-4" />
              What I can do as a lead
            </Link>
          ) : null}

          <div className="bg-line-soft h-px" />

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
            Settings
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
