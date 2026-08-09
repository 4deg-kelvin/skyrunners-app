"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * "Hide completed projects" — one switch, applied everywhere on the page.
 *
 * The projects page already sorts finished work below live work per division,
 * which helps until the club has a few years behind it. Then the finished
 * sections are most of the page and the live work is scattered between them.
 *
 * A preference rather than a filter, so it lives in `localStorage` and not the
 * URL: it's about how one person likes to read the page, and it should still be
 * off — or still on — the next time they open it. A query param would have to be
 * carried through every link on the page and would follow anyone they shared a
 * link with, which is a different thing entirely.
 *
 * Deliberately available to everyone. Hiding history from your own view costs
 * nothing and reverses in one click; the archive and the completed sections are
 * still there when the switch is off.
 */

const STORAGE_KEY = "skyrunners.hideCompletedProjects";

const HideCompletedContext = createContext<{
  hidden: boolean;
  setHidden: (value: boolean) => void;
}>({ hidden: false, setHidden: () => {} });

export function HideCompletedProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
    Starts false on the server AND on the first client render, then the effect
    applies the stored preference. Reading localStorage during render would
    produce markup the server can't have generated, and React discards the whole
    tree on a hydration mismatch — a much worse outcome than one frame of
    completed projects appearing before they're hidden.
  */
  const [hidden, setHiddenState] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") {
        setHiddenState(true);
      }
    } catch {
      // Private browsing, or storage disabled. The switch still works for the
      // session; it just won't be remembered.
    }
  }, []);

  const setHidden = useCallback((value: boolean) => {
    setHiddenState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      /* see above */
    }
  }, []);

  return (
    <HideCompletedContext.Provider value={{ hidden, setHidden }}>
      {children}
    </HideCompletedContext.Provider>
  );
}

export function useHideCompleted(): boolean {
  return useContext(HideCompletedContext).hidden;
}

/**
 * The switch itself.
 *
 * `count` is how many projects it would hide. Without it the control is a
 * mystery toggle — with it, "Hide 12 completed" says exactly what pressing it
 * does, and its absence says there's nothing to hide.
 */
/**
 * A self-contained "Completed · N" block with its own show/hide.
 *
 * For pages with exactly one completed list — My Work — where the context
 * provider and a separate header control would be three moving parts for one
 * switch. `/projects` still uses the provider, because the switch there has to
 * reach nested sub-projects across several division cards.
 *
 * Collapsed by default, and not remembered. Different from the projects page
 * on purpose: this list is your own finished work, you look at it
 * deliberately, and a preference that persisted would mean opening My Work one
 * day to a wall of things you already did.
 */
export function CompletedProjectsSection({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-line mt-6 border-t pt-5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] uppercase transition-colors"
      >
        {open ? (
          <EyeOff className="size-3.5" strokeWidth={2.5} />
        ) : (
          <Eye className="size-3.5" strokeWidth={2.5} />
        )}
        Completed · {count}
        <span className="text-ink-muted font-normal tracking-normal normal-case">
          {open ? "(hide)" : "(show)"}
        </span>
      </button>

      {open ? children : null}
    </div>
  );
}

export function HideCompletedToggle({ count }: { count: number }) {
  const { hidden, setHidden } = useContext(HideCompletedContext);

  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={() => setHidden(!hidden)}
      aria-pressed={hidden}
      className="rounded-tile border-line text-ink hover:bg-surface inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold transition-colors"
    >
      {hidden ? (
        <Eye className="size-3.5" strokeWidth={2.5} />
      ) : (
        <EyeOff className="size-3.5" strokeWidth={2.5} />
      )}
      {hidden ? `Show ${count} completed` : `Hide ${count} completed`}
    </button>
  );
}
