"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Card, CardBody } from "./card";

/**
 * A card whose body the reader can fold away, remembered per person.
 *
 * Built for "Where You'd Help Most" at the top of `/projects`. That section
 * earns its place for somebody looking for work and is pure noise for somebody
 * who is already on three projects and came to read the tree — and both of
 * those are the same person in different weeks, so a role check would be wrong.
 *
 * `localStorage`, not a URL param, for the same reason as `HideCompletedToggle`:
 * it's how one person likes to read a page, it should survive a reload, and it
 * must not follow anyone they share a link with.
 *
 * ---------------------------------------------------------------------------
 * Why the default is OPEN and the stored value lands after mount
 * ---------------------------------------------------------------------------
 *
 * The server has no idea what's in localStorage, so rendering the stored state
 * directly would mean the server says "open" and the first client render says
 * "closed" — a hydration mismatch, which React resolves by throwing away the
 * server HTML for this subtree. Reading it in an effect instead costs one frame
 * of the section being open before it folds, and that is the cheap direction to
 * be wrong: a section that flickers open is survivable, a hydration error takes
 * out the whole page.
 *
 * The children are server-rendered and passed straight through, so nothing
 * about the ranking or the ask-to-join buttons becomes client code.
 */
export function CollapsibleCard({
  storageKey,
  header,
  summaryWhenClosed,
  children,
  defaultOpen = true,
}: {
  /** Distinct per section, namespaced like the other stored preferences. */
  storageKey: string;
  /** Always visible, next to the toggle. */
  header: React.ReactNode;
  /** One line shown in place of the body when folded, so it isn't a blank. */
  summaryWhenClosed?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored !== null) setOpen(stored === "open");
    } catch {
      // Private browsing, or storage disabled. The default stands.
    }
  }, [storageKey]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? "open" : "closed");
    } catch {
      // Not being able to remember it is not a reason to refuse to fold it.
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">{header}</div>
          <button
            onClick={toggle}
            aria-expanded={open}
            className="rounded-tile border-line hover:bg-surface text-ink-soft hover:text-ink inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-sm font-semibold transition-colors"
          >
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            {open ? "Hide" : "Show"}
          </button>
        </div>

        {open ? (
          children
        ) : summaryWhenClosed ? (
          <p className="text-ink-muted mt-3 text-sm">{summaryWhenClosed}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
