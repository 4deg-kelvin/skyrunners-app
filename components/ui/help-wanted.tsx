"use client";

import { useState } from "react";
import Link from "next/link";
import { HelpCircle, MessageSquare } from "lucide-react";

import {
  DeleteAskButton,
  ReplyForm,
  ResolveForm,
} from "@/components/forms/help-request-actions";
import { Badge } from "./badge";
import { ContactLink } from "./contact-link";
import type { BlockerItem } from "@/lib/data/blockers";

/**
 * Open "I need help" asks, collapsed, at the top of the projects page.
 *
 * ---------------------------------------------------------------------------
 * What happened to the blocker board
 * ---------------------------------------------------------------------------
 *
 * `/blockers` merged three sources: blocked deliverables, blockers written
 * into check-ins, and free-form asks. Two of those now surface where they
 * belong — the project row already carries a "N blocked" badge, and
 * `DivisionExtras` lists them per division. Those were always facts ABOUT a
 * project, and a separate page asked people to go elsewhere to read them.
 *
 * The free-form ask is the one that had nowhere else to live, and it's the one
 * that matters most: membership is RE-controlled, so a member waiting on a
 * join request otherwise has exactly one route to being useful and it depends
 * on one person answering their inbox.
 *
 * So it stays, as a strip rather than a destination. Collapsed by default and
 * absent entirely when nobody is stuck — which is the common case, and a
 * permanent empty panel is how a page teaches you to skip a section.
 */
export function HelpWanted({ asks }: { asks: BlockerItem[] }) {
  const [open, setOpen] = useState(false);

  if (asks.length === 0) return null;

  const stale = asks.filter((a) => a.stale).length;

  return (
    <div className="rounded-card border border-line bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-6 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-[15px] font-bold text-ink">
          <HelpCircle className="size-4 text-cardinal-600" />
          {asks.length} {asks.length === 1 ? "person needs" : "people need"} help
          {stale > 0 ? (
            <Badge tone="risk">{stale} waiting 3+ days</Badge>
          ) : null}
        </span>
        <span className="text-sm font-semibold text-cardinal-600">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open ? (
        <div className="space-y-2.5 px-6 pb-5">
          <p className="text-sm text-ink-soft">
            Anyone can answer — you don&apos;t have to be on the project. That&apos;s
            the point: it&apos;s the route to being useful that doesn&apos;t wait on
            one person&apos;s inbox.
          </p>

          {asks.map((item) => {
            const request = item.request;
            if (!request) return null;

            return (
              <div
                key={item.key}
                className={`rounded-tile border px-4 py-3 ${
                  item.stale ? "border-warn-fg/30 bg-warn-bg/40" : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold text-ink">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {item.member?.fullName ?? "Unknown member"}
                      {item.project ? (
                        <>
                          {" · "}
                          <Link
                            href={`/projects/${item.project.slug}`}
                            className="font-semibold text-cardinal-600 hover:text-cardinal-700"
                          >
                            {item.project.name}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {/* Age, not a count. It's what makes somebody act. */}
                  <Badge tone={item.stale ? "risk" : "warn"}>
                    {item.ageDays === 0 ? "Today" : `${item.ageDays}d waiting`}
                  </Badge>
                </div>

                {item.detail ? (
                  <p className="mt-2 text-sm text-ink-soft">{item.detail}</p>
                ) : null}

                {item.member ? (
                  <ContactLink
                    member={item.member}
                    showLabel={false}
                    className="mt-2"
                  />
                ) : null}

                {request.replies.length > 0 ? (
                  <div className="mt-3 space-y-2 border-l-2 border-line pl-3">
                    {request.replies.map((reply, i) => (
                      <div key={reply.id}>
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
                          <MessageSquare className="size-3" />
                          {item.repliers[i]?.fullName ?? "Someone"}
                        </p>
                        <p className="mt-0.5 text-sm text-ink-soft">
                          {reply.body}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <ReplyForm requestId={request.id} />
                  {item.canClose ? (
                    <ResolveForm requestId={request.id} />
                  ) : null}
                  {item.canDelete ? (
                    <DeleteAskButton requestId={request.id} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
