"use client";

import { useState } from "react";
import { CalendarPlus, Check, Copy } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  createCalendarFeedAction,
  revokeCalendarFeedAction,
} from "@/lib/actions";
import { formatMoment } from "@/lib/dates";
import { CALENDAR_CLIENT_LABELS } from "@/lib/labels";
import type { FeedSummary } from "@/lib/calendar/store";
import type { CalendarClient } from "@/lib/calendar/feed-token";

/**
 * Subscribe your own calendar to the club's.
 *
 * The whole feature is one URL, so this box is the entire setup. It sits in
 * Settings beside "Connect your AI" for the same reason that one does: the point
 * of the feature is that the member stops having to open this website, so the
 * single visit it costs them has to be enough on its own.
 *
 * ---------------------------------------------------------------------------
 * Why the URL can be shown again, unlike an MCP token
 * ---------------------------------------------------------------------------
 *
 * An MCP token is shown once and never again. This is the opposite, and the
 * difference is real: a calendar URL has to be pasted into every device a member
 * owns, and they will buy a new phone. "Shown once" would mean rotating just to
 * add an iPad — which silently breaks the phone.
 *
 * So pressing the button again is how you get it back, and it MINTS A NEW ONE.
 * That is a genuine trade rather than an oversight, and the copy says so plainly:
 * a member who reconnects their laptop and finds their phone blank three days
 * later would otherwise have no way to work out why.
 */
export function CalendarFeed({
  feed,
  clients,
  syncedAt,
  canUse,
}: {
  feed: FeedSummary | null;
  /**
   * Calendar apps observed fetching, from `profiles` rather than from the feed.
   *
   * The observation is public and the credential is not — see migration 0041 —
   * so these arrive on the member row, exactly like `discordVerifiedAt`.
   */
  clients: CalendarClient[];
  /** When a calendar app last collected it. Undefined = never. */
  syncedAt?: string;
  /** False in demo mode, where there's no database to subscribe to. */
  canUse: boolean;
}) {
  /*
    The plaintext URL exists ONLY in the action's response — only its hash is
    stored — so it lives in component state and is lost on navigation. That is
    the correct behaviour, and it is why the button that produces it says what it
    does rather than looking like a "view" button.
  */
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!canUse) {
    return (
      <p className="text-ink-soft text-sm">
        Calendar subscriptions need a real database, and this is demo mode.
      </p>
    );
  }

  /*
    `webcal://` rather than `https://` — the same URL, a different scheme, and it
    matters more than it looks.

    `webcal` is registered to the calendar app on macOS, iOS and Windows, so
    tapping the link opens "Subscribe to calendar" directly. An `https` link opens
    a browser, which downloads a file the member then has to find and open — and
    that is the step where most people give up. Google Calendar is the exception:
    it needs the https form pasted into a box and rejects webcal outright, which
    is why both are offered rather than one.
  */
  const webcal = url ? url.replace(/^https?:\/\//, "webcal://") : null;

  const captureUrl = (result: { ok: boolean; message?: string }) => {
    // Only a create returns a URL; a revoke returns a sentence. Guarding on the
    // shape rather than on which button was pressed keeps this in one place.
    if (result.ok && result.message?.includes("/api/calendar/")) {
      setUrl(result.message);
      setCopied(false);
    }
  };

  return (
    <div>
      {feed ? (
        <div className="rounded-tile border-line bg-surface border px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-ink text-sm font-bold">
              Your calendar is connected
            </p>
            {/*
              What has ACTUALLY fetched, not what the member says they use.

              A calendar subscription has no handshake — the server only ever sees
              a GET — so this is read from the User-Agent of real fetches. Same
              principle as the Discord badge recording which id was proven: it
              cannot claim a calendar that never connected.
            */}
            {clients.length > 0 ? (
              <span className="text-ok-fg bg-ok-bg rounded-full px-2 py-0.5 text-xs font-bold">
                {clients.map((c) => CALENDAR_CLIENT_LABELS[c]).join(", ")}
              </span>
            ) : (
              <span className="text-ink-muted text-xs">
                waiting for your calendar app to check in
              </span>
            )}
          </div>

          <p className="text-ink-soft mt-1.5 text-sm">
            {syncedAt ? (
              <>
                Last picked up {formatMoment(syncedAt)}. Your calendar app
                decides how often to check — Apple every few minutes, Outlook
                every few hours, Google slowest of all.
              </>
            ) : (
              <>
                Nothing has fetched it yet. If you have already subscribed, give
                it a few minutes — and if it stays like this, the link probably
                did not paste in full.
              </>
            )}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ActionForm
              action={createCalendarFeedAction}
              onResult={captureUrl}
              renderSubmit={(pending) => (
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-tile border-line hover:bg-card text-ink border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {pending ? "Making a new link…" : "Show me the link again"}
                </button>
              )}
            />
            <ActionButton
              action={revokeCalendarFeedAction}
              // Nothing to identify the feed with: RLS scopes the update to
              // `auth.uid()`, so it can only ever reach this member's own row.
              fields={{}}
              label="Turn it off"
              pendingLabel="Turning off…"
              tone="danger"
            />
          </div>

          <p className="text-ink-muted mt-2 text-xs">
            Showing the link again creates a new one and disconnects every
            device using the old one. Fine if this is your only device;
            otherwise you will need to re-add it everywhere.
          </p>
        </div>
      ) : (
        <ActionForm
          action={createCalendarFeedAction}
          onResult={captureUrl}
          renderSubmit={(pending) => (
            <button
              type="submit"
              disabled={pending}
              className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 inline-flex items-center gap-2 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors disabled:opacity-60"
            >
              <CalendarPlus className="size-4" strokeWidth={2.5} />
              {pending ? "Setting it up…" : "Connect my calendar"}
            </button>
          )}
        />
      )}

      {url && webcal ? (
        <div className="rounded-tile border-cardinal-600/30 bg-cardinal-50 mt-4 border px-4 py-3.5">
          <p className="text-ink text-sm font-bold">
            Your personal calendar link
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-tile border-line bg-card text-ink min-w-0 flex-1 overflow-x-auto border px-3 py-2 text-xs">
              {webcal}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(webcal);
                setCopied(true);
              }}
              className="rounded-tile border-line hover:bg-card text-ink inline-flex shrink-0 items-center gap-1.5 border px-3 py-2 text-sm font-semibold transition-colors"
            >
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <ol className="text-ink-soft mt-3 space-y-1.5 text-sm">
            <li>
              <span className="text-ink font-semibold">
                iPhone, iPad or Mac:
              </span>{" "}
              open the link above — Calendar asks you to subscribe. Say yes.
            </li>
            <li>
              <span className="text-ink font-semibold">Google Calendar:</span>{" "}
              Other calendars → <em>From URL</em>, and paste the{" "}
              <code className="text-xs">https://</code> version below. Google
              rejects <code className="text-xs">webcal://</code>.
            </li>
            <li>
              <span className="text-ink font-semibold">Outlook:</span> Add
              calendar → Subscribe from web, and paste either form.
            </li>
          </ol>

          <p className="text-ink-muted mt-3 text-xs break-all">
            https version: {url}
          </p>

          <p className="text-ink-muted mt-2 text-xs">
            Treat it like a password — anyone with the link can see which club
            sessions you are on. It can do nothing else: it changes nothing, and
            shows nothing about anybody else.
          </p>
        </div>
      ) : null}
    </div>
  );
}
