"use client";

import { useState } from "react";
import { CalendarPlus, Check, Copy, TriangleAlert } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  createCalendarFeedAction,
  revokeCalendarFeedAction,
} from "@/lib/actions";
import { formatDay, formatMoment } from "@/lib/dates";
import { CALENDAR_CLIENT_LABELS } from "@/lib/labels";
import type { FeedSummary } from "@/lib/calendar/store";
import type { CalendarClient } from "@/lib/calendar/feed-token";
import type { FeedPreviewRow } from "@/lib/data/settings";
import { feedHealth } from "@/lib/calendar/health";

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
/**
 * How to actually subscribe, per platform.
 *
 * Shown BEFORE the link is generated as well as after, which is the fix to a real
 * complaint: these steps used to live inside the `{url ? ... }` block, so a member
 * who wanted to know what they were committing to saw a heading, a sentence and a
 * button — and nothing about how it works on their phone. "There is no tutorial"
 * was the accurate reading of that.
 *
 * One component rather than two copies, because the pre- and post-link versions
 * have to say the same thing. The only difference is that afterwards there is a
 * link to paste.
 */
function SetupSteps({ compact = false }: { compact?: boolean }) {
  return (
    <ol
      className={`text-ink-soft space-y-1.5 ${compact ? "text-xs" : "text-sm"}`}
    >
      <li>
        <span className="text-ink font-semibold">iPhone, iPad or Mac:</span>{" "}
        open the link — Calendar asks you to subscribe. Say yes.
      </li>
      <li>
        <span className="text-ink font-semibold">Google Calendar:</span> on a
        computer, Other calendars → <em>From URL</em>, and paste the{" "}
        <code className="text-xs">https://</code> version. Google rejects{" "}
        <code className="text-xs">webcal://</code>, and its phone app can&apos;t
        add subscriptions — but once added on a computer it shows on your phone.
      </li>
      <li>
        <span className="text-ink font-semibold">Outlook:</span> Add calendar →
        Subscribe from web, and paste either form.
      </li>
    </ol>
  );
}

export function CalendarFeed({
  feed,
  clients,
  syncedAt,
  canUse,
  preview,
}: {
  /**
   * Exactly what the feed route would serve, from the same selection function.
   *
   * Shown so "my calendar is empty" stops being unfalsifiable — see
   * `getFeedPreview`. A separate query here would defeat the whole point.
   */
  preview: FeedPreviewRow[];
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
  /*
    WHICH form was copied, not just "something was".

    Two links are offered now — see the panel below — and a single boolean put the
    tick on both buttons at once, which reads as "you already did this" next to
    the one the member has not pressed.
  */
  const [copied, setCopied] = useState<"webcal" | "https" | null>(null);

  /*
    Computed at render, not passed in: it is a function of the clock, and a
    boolean baked on the server goes stale the moment the page is cached.
  */
  const health = feedHealth(syncedAt);

  if (!canUse) {
    /*
      Demo mode still shows the STEPS, just not the button.

      They're static text and they're the informative half — somebody evaluating a
      fresh clone learns what the feature does, and a bare "needs a real database"
      teaches them nothing. It also means the tutorial is verifiable without live
      credentials, which is how the missing-tutorial bug got confirmed.
    */
    return (
      <div>
        <p className="text-ink-soft text-sm">
          Connecting a calendar needs a real database, and this is demo mode.
          Here&apos;s what it looks like:
        </p>
        <div className="mt-3">
          <SetupSteps compact />
        </div>
      </div>
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
      setCopied(null);
    }
  };

  /*
    What the feed is serving, shown whether or not a subscription exists.

    Deliberately ABOVE the connect button and outside the `feed ?` branch: the
    question "why is my calendar empty" gets asked by people who have connected
    one and by people who think they have, and the answer is the same list.
  */
  const previewPanel = (
    <div className="rounded-tile border-line mb-3 border px-4 py-3">
      <p className="text-ink-muted text-[11px] font-semibold tracking-[0.09em] uppercase">
        What your calendar app is sent
      </p>
      {preview.length === 0 ? (
        <p className="text-ink-soft mt-1.5 text-sm">
          Nothing yet — you are not on any sessions in the next year. Say
          you&apos;re coming to something on the calendar, or create a session,
          and it appears here immediately. If this list is empty, an empty
          calendar on your phone is correct rather than broken.
        </p>
      ) : (
        <>
          <ul className="mt-1.5 space-y-1">
            {preview.slice(0, 6).map((row) => (
              <li key={`${row.title}-${row.startsAt}`} className="text-sm">
                <span className="text-ink font-semibold">
                  {formatDay(row.startsAt)}
                </span>{" "}
                <span className="text-ink-soft">
                  {row.title}
                  {row.repeats ? " · repeats" : ""}
                </span>
              </li>
            ))}
          </ul>
          {preview.length > 6 ? (
            <p className="text-ink-muted mt-1 text-xs">
              and {preview.length - 6} more
            </p>
          ) : null}
          <p className="text-ink-muted mt-2 text-xs">
            {preview.length} event{preview.length === 1 ? "" : "s"} are in your
            feed right now. If one of these is missing from your calendar app,
            the app hasn&apos;t refreshed — the club&apos;s side is working.
          </p>
        </>
      )}
    </div>
  );

  return (
    <div>
      {previewPanel}
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
                Last picked up {formatMoment(syncedAt)}. If that is before you
                added the event you are looking for, your calendar app
                hasn&apos;t collected it yet — on iPhone, Calendar → Calendars →
                ⓘ next to SkyRunners →{" "}
                <span className="font-semibold">Refresh</span>, which iOS
                sometimes sets to Weekly or Manually. Apple normally checks
                every few minutes, Outlook every few hours, Google slowest of
                all.
              </>
            ) : (
              <>
                Nothing has fetched it yet. If you have already subscribed, give
                it a few minutes — and if it stays like this, the link probably
                did not paste in full.
              </>
            )}
          </p>

          {/*
            Silence, said out loud.

            The failure this catches has no error anywhere: the subscription
            breaks and the calendar just stops changing, which looks exactly like
            "the club has nothing on". Anish RSVP'd on a Friday for a Saturday
            event and by Sunday his phone had nothing, while this box said he was
            connected.

            Only past 48 hours — see `STALE_AFTER_HOURS` for why the threshold is
            set by the slowest client rather than the fastest.
          */}
          {health === "stale" ? (
            <p className="text-warn-fg mt-2 flex items-start gap-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="font-semibold">
                  Nothing has collected this in over two days.
                </span>{" "}
                New events will not be reaching you. The usual cause is that
                this link was replaced — pressing{" "}
                <em>Show me the link again</em> makes a new one and stops every
                device using the old one. Get the link below and re-add it on
                each device.
              </span>
            </p>
          ) : null}

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
        <div>
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

          {/*
            The steps, BEFORE pressing anything.

            They used to live only inside the "here is your link" panel, so this
            whole card was a heading, one sentence and a button — and Anish's
            reading of it, "there is no tutorial", was exactly right. Somebody
            deciding whether to bother needs to know it is three taps on an iPhone
            and a trip to a computer on Google.

            Numbered and phrased identically to the post-link version, because it is
            the same component. `compact` only shrinks the type, since here it is
            preview rather than instruction.
          */}
          <div className="border-line mt-4 border-t pt-3">
            <p className="text-ink-muted mb-2 text-xs font-semibold tracking-wide uppercase">
              What happens next
            </p>
            <SetupSteps compact />
          </div>
        </div>
      )}

      {url && webcal ? (
        <div className="rounded-tile border-cardinal-600/30 bg-cardinal-50 mt-4 border px-4 py-3.5">
          <p className="text-ink text-sm font-bold">
            Your personal calendar link
          </p>

          {/*
            BOTH forms, each with its own copy button, each labelled with what it
            is for.

            This is a bug fix and the bug was mine. The webcal form used to be the
            only thing with a copy button and the https form was a line of grey
            text at the bottom — while the instructions two inches below said
            Google needs the https one. So the obvious path (press Copy, paste
            into Google) produced "Validation failed, please edit the URL and try
            again", which is Google's message for a URL it will not accept, and
            it names neither the scheme nor the real problem. Anish hit it
            immediately.

            Google is not being difficult: `webcal://` is not a scheme its fetcher
            speaks. Apple and Outlook accept either, and webcal is much nicer
            there because the OS hands it straight to the calendar app, so the
            answer is to offer both and say which is which rather than to pick one.
          */}
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-ink text-xs font-bold">
                Apple Calendar or Outlook — open this on the device
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="rounded-tile border-line bg-card text-ink min-w-0 flex-1 overflow-x-auto border px-3 py-2 text-xs">
                  {webcal}
                </code>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(webcal);
                    setCopied("webcal");
                  }}
                  className="rounded-tile border-line hover:bg-card text-ink inline-flex shrink-0 items-center gap-1.5 border px-3 py-2 text-sm font-semibold transition-colors"
                >
                  {copied === "webcal" ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  {copied === "webcal" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div>
              <p className="text-ink text-xs font-bold">
                Google Calendar — paste this one
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="rounded-tile border-line bg-card text-ink min-w-0 flex-1 overflow-x-auto border px-3 py-2 text-xs">
                  {url}
                </code>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(url);
                    setCopied("https");
                  }}
                  className="rounded-tile border-line hover:bg-card text-ink inline-flex shrink-0 items-center gap-1.5 border px-3 py-2 text-sm font-semibold transition-colors"
                >
                  {copied === "https" ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  {copied === "https" ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-ink-muted mt-1 text-xs">
                Google rejects the <code className="text-xs">webcal://</code>{" "}
                form with &ldquo;Validation failed&rdquo; — if you see that, you
                have the wrong one of these two.
              </p>
            </div>
          </div>

          <div className="mt-3">
            <SetupSteps />
          </div>

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
