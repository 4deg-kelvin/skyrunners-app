"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";

import { ActionButton } from "./action-form";
import { purgeEmptyProjectsAction } from "@/lib/actions";
import type { BulkCreationRow } from "@/lib/data/settings";

/**
 * Clean up projects a bulk write left behind.
 *
 * ---------------------------------------------------------------------------
 * Why this control exists at all
 * ---------------------------------------------------------------------------
 *
 * A member connected an assistant to the MCP server and it created ~4,000 empty
 * projects. Every individual call was legitimate — he could create projects in
 * his own division — so nothing refused, nothing alerted, and there was no way
 * to undo it from the website. A Co-Lead's only option was a per-project delete
 * button, four thousand times.
 *
 * ---------------------------------------------------------------------------
 * Why it is deliberately not a nicer button
 * ---------------------------------------------------------------------------
 *
 * This deletes rows in bulk, so the design is about making the blast radius
 * legible BEFORE the press rather than smooth afterwards:
 *
 *   - It lists people and counts, so nothing happens until a Co-Lead has read a
 *     number. There is no "clean everything" affordance.
 *   - It names the sample projects, because "247 projects" is a number and
 *     "Project ABCX, Project ABDG…" is a decision.
 *   - It sends back the count it displayed, and the server refuses if the real
 *     count has moved. A tab left open during an incident is otherwise a way to
 *     delete a set nobody looked at.
 *   - It works in batches and says how many remain, because one press cannot
 *     outlive a serverless function.
 *
 * The candidate list is computed by `emptyProjectsCreatedBy`, which only ever
 * offers projects carrying NO deliverables, documents, log entries, sessions,
 * join requests or other members. That is what keeps this from being able to
 * destroy anybody's history — a shell has none.
 */
export function PurgeProjects({ rows }: { rows: BulkCreationRow[] }) {
  /*
    Which row is armed. Nothing is deletable until it has been picked, so a
    mis-click on a dense list can't remove anything.
  */
  const [armed, setArmed] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-ink-soft text-sm">
        Nothing to clean up — no member has a pile of projects with no work on
        them. This appears by itself if that ever changes.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-tile border-warn-fg/40 bg-warn-bg/40 flex items-start gap-2.5 border px-3.5 py-3">
        <TriangleAlert className="text-warn-fg mt-0.5 size-4 shrink-0" />
        <p className="text-ink-soft text-sm">
          These are projects with{" "}
          <span className="text-ink font-semibold">
            no deliverables, documents, log entries, sessions or other members
          </span>
          . Anything with a trace of real work on it is never listed here and
          cannot be removed this way — delete those one at a time from the
          project itself, where you can see what you&apos;re losing.
        </p>
      </div>

      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.memberId}
            className="rounded-tile border-line border px-3.5 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-ink text-[15px] font-semibold">
                  {row.fullName}{" "}
                  <span className="text-ink-muted font-normal">
                    · {row.emptyCount} empty project
                    {row.emptyCount === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="text-ink-muted mt-0.5 text-sm">
                  {row.sample.join(", ")}
                  {row.emptyCount > row.sample.length ? ", …" : ""}
                </p>
              </div>

              {armed === row.memberId ? (
                <div className="flex shrink-0 items-center gap-2">
                  <ActionButton
                    action={purgeEmptyProjectsAction}
                    /*
                      `expected` is the count this page rendered. The server
                      compares it with the live count and refuses on a mismatch,
                      so a stale tab can't delete a set nobody read.
                    */
                    fields={{
                      creatorId: row.memberId,
                      expected: String(row.emptyCount),
                      limit: "250",
                    }}
                    label={`Delete ${Math.min(row.emptyCount, 250)} now`}
                    pendingLabel="Deleting…"
                    tone="danger"
                  />
                  <button
                    onClick={() => setArmed(null)}
                    className="text-ink-muted hover:text-ink text-sm font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setArmed(row.memberId)}
                  className="rounded-tile border-line hover:bg-surface text-ink shrink-0 border px-3 py-1.5 text-sm font-semibold transition-colors"
                >
                  Clean up…
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="text-ink-muted text-xs">
        Deletes up to 250 at a time and tells you how many are left, because one
        request can only run for so long. Press again until it says none.
      </p>
    </div>
  );
}
