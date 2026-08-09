"use client";

import { Moon, Sun } from "lucide-react";

import { ActionButton } from "./action-form";
import { setThemeAction } from "@/lib/actions";

/**
 * Switch the whole app between light and dark.
 *
 * A server round-trip rather than a class flipped in the browser, which looks
 * like the slower choice and isn't the wrong one: the class lives on `<html>`
 * and is rendered from a cookie, so the server has to know about the change
 * anyway or the next page load would revert it. Flipping it client-side too
 * would mean two sources of truth for one boolean, and they'd disagree the
 * first time somebody opened a second tab.
 *
 * Deliberately not a switch component. It's one button that names the state
 * you'd be moving to, which is unambiguous — a switch leaves you working out
 * whether "on" means dark or means the switch is on.
 */
export function ThemeToggle({ theme }: { theme: "light" | "dark" }) {
  const goingDark = theme === "light";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-ink-soft inline-flex items-center gap-2 text-sm">
        {goingDark ? (
          <Sun className="size-4" strokeWidth={2.5} />
        ) : (
          <Moon className="size-4" strokeWidth={2.5} />
        )}
        Currently {theme}
      </span>
      <ActionButton
        action={setThemeAction}
        fields={{ theme: goingDark ? "dark" : "light" }}
        label={goingDark ? "Switch to dark" : "Switch to light"}
        pendingLabel="Switching…"
        tone="primary"
      />
      <span className="text-ink-muted text-sm">
        Saved on this device — set it again on your phone.
      </span>
    </div>
  );
}
