/**
 * The persona switcher bar.
 *
 * A Server Component with no client JavaScript at all: collapse is a native
 * `<details>`, and switching is a plain `<form>` whose buttons carry the persona
 * id as their own `name`/`value`. Browsers submit the clicked button's value, so
 * six buttons need one form and no handler.
 *
 * That's not minimalism for its own sake — it's why this file doesn't need
 * `"use client"`, and therefore can't trip the "Functions cannot be passed
 * directly to Client Components" trap described in CLAUDE.md.
 *
 * Renders `null` unless the test environment is on, so it's safe to mount
 * unconditionally in the layout.
 */

import { getMember } from "@/lib/mock-data";
import { isTestEnvEnabled } from "@/lib/env";
import { TEST_PERSONAS, readTestPersonaId } from "./index";
import { RESET_VALUE } from "./personas";
import { switchPersona } from "./actions";

export async function TestEnvBar() {
  if (!isTestEnvEnabled()) return null;

  const activeId = await readTestPersonaId();
  const active = TEST_PERSONAS.find((p) => p.id === activeId);
  const activeName = activeId ? getMember(activeId)?.fullName : undefined;

  return (
    <details className="fixed bottom-3 left-3 z-[100] max-w-[calc(100vw-1.5rem)] text-card sm:bottom-4 sm:left-4">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-tile bg-ink px-3 py-2 text-xs font-semibold shadow-sm">
        <span aria-hidden className="size-2 rounded-full bg-warn-bg" />
        Test env
        <span className="font-normal text-neutral-bg">
          {active ? `· ${active.label}` : "· default (Co-Lead)"}
        </span>
      </summary>

      <div className="mt-2 w-[min(30rem,calc(100vw-1.5rem))] overflow-hidden rounded-card bg-ink shadow-sm">
        <div className="border-b border-ink-soft px-4 py-3">
          <p className="text-sm font-semibold">Browse as</p>
          <p className="mt-1 text-xs text-neutral-bg">
            Switches identity in mock data — not just the role badge, but the
            whole reporting chain and RE list, so permissions behave the way they
            will for a real person.
          </p>
        </div>

        <form className="max-h-[60vh] overflow-y-auto">
          {TEST_PERSONAS.map((persona) => {
            const isActive = persona.id === activeId;
            const member = getMember(persona.id);

            return (
              <button
                key={persona.id}
                // Bound, not `name`/`value` — React owns those on a button with
                // a function formAction. See the note in `actions.ts`.
                formAction={switchPersona.bind(null, persona.id)}
                aria-current={isActive ? "true" : undefined}
                className={
                  isActive
                    ? "block w-full border-b border-ink-soft bg-ink-soft px-4 py-3 text-left"
                    : "block w-full border-b border-ink-soft px-4 py-3 text-left hover:bg-ink-soft"
                }
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{persona.label}</span>
                  <span className="text-xs text-neutral-bg">
                    {member?.fullName ?? "⚠ missing from mock-data"}
                  </span>
                  {isActive ? (
                    <span className="ml-auto shrink-0 rounded-full bg-card px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">
                      Active
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-neutral-bg">
                  {persona.exercises}
                </span>
              </button>
            );
          })}

          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="text-xs text-neutral-bg">
              {activeName
                ? `Signed in as ${activeName}.`
                : "No override — using CURRENT_USER_ID."}
            </p>
            <button
              formAction={switchPersona.bind(null, RESET_VALUE)}
              className="shrink-0 rounded-tile border border-ink-soft px-3 py-1.5 text-xs font-semibold hover:bg-ink-soft"
            >
              Reset
            </button>
          </div>
        </form>
      </div>
    </details>
  );
}
