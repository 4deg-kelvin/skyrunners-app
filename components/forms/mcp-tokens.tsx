"use client";

import { useState } from "react";
import { Bot, Check, Copy, Plus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import { createMcpTokenAction, revokeMcpTokenAction } from "@/lib/actions";
import { formatDay } from "@/lib/dates";
import type { TokenSummary } from "@/lib/mcp/store";

const FIELD =
  "rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]";

/**
 * Connect your own AI.
 *
 * The whole point of the MCP server is that somebody can stop opening this
 * website — so this page is the one visit it costs them, and it has to be
 * enough on its own. That's why the server URL is printed here in full rather
 * than living in a doc: the setup is "copy two things from this box".
 */
export function McpTokens({
  tokens,
  serverUrl,
  canUse,
}: {
  tokens: TokenSummary[];
  /** Absolute, so it can be pasted straight into a client. */
  serverUrl: string;
  /** False in demo mode, where there's no database to connect to. */
  canUse: boolean;
}) {
  const [open, setOpen] = useState(false);

  /*
    The minted token, held HERE rather than left inside the form.

    This is a bug fix, and the bug made the whole feature unusable: the token
    arrives as the first line of the action's success message, `ActionForm`
    renders that message inside itself, and this component used to pass
    `onSuccess={() => setOpen(false)}` — which unmounted the form in the same
    tick the token appeared. Anish's report was exactly right: "I can never see
    the token when it is made, it never shows for me." It rendered and was
    destroyed before paint.

    Only the hash is stored, so there is no second chance to show it. Lifting it
    into state that OUTLIVES the form is the fix, which is what
    `components/forms/calendar-feed.tsx` already does with the feed URL — worth
    noting that the two are the same pattern, since a third one-time secret would
    otherwise arrive at the same trap.
  */
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState<
    "token" | "command" | "connector" | null
  >(null);

  if (!canUse) {
    return (
      <p className="text-ink-soft text-sm">
        Connecting an AI needs a real database, and this is demo mode.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-tile border-line bg-surface border p-3">
        <p className="text-ink-muted text-[11px] font-semibold tracking-[0.09em] uppercase">
          Server URL
        </p>
        <code className="text-ink mt-1 block text-sm break-all">
          {serverUrl}
        </code>
        <p className="text-ink-soft mt-2 text-sm">
          Add this as an HTTP MCP server in Claude, with a token below as the
          bearer credential. Your AI then sees exactly what you can see and can
          do exactly what you can do — no more.
        </p>
      </div>

      {tokens.length > 0 ? (
        <ul className="space-y-2">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="rounded-tile border-line flex flex-wrap items-center justify-between gap-3 border px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-ink text-[15px] font-semibold">
                  {t.name}{" "}
                  <span className="text-ink-muted text-sm font-normal">
                    · {t.scope === "write" ? "read + write" : "read-only"}
                  </span>
                </p>
                <p className="text-ink-muted text-sm">
                  Created {formatDay(t.createdAt)} · expires{" "}
                  {formatDay(t.expiresAt)} ·{" "}
                  {t.lastUsedAt
                    ? `last used ${formatDay(t.lastUsedAt)}`
                    : "never used"}
                </p>
              </div>
              <ActionButton
                action={revokeMcpTokenAction}
                fields={{ tokenId: t.id }}
                label="Revoke"
                pendingLabel="Revoking…"
                tone="danger"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-soft text-sm">
          No tokens yet. Make one to connect an assistant.
        </p>
      )}

      {open ? (
        <ActionForm
          action={createMcpTokenAction}
          submitLabel="Create token"
          submittingLabel="Creating…"
          className="rounded-card border-line bg-card border p-4"
          /*
            `onResult`, not `onSuccess` — the difference is the whole fix.

            The token is the first line of the message; the rest is the warning
            that it won't be shown again. Guarded on the `skr_` prefix so a
            future change to that copy can't silently start storing a sentence
            in place of a credential.
          */
          onResult={(result) => {
            if (!result.ok || !result.message) return;
            const token = result.message.split("\n")[0].trim();
            if (!token.startsWith("skr_")) return;
            setMinted(token);
            setCopied(null);
            setOpen(false);
          }}
        >
          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              What is it for?
            </span>
            <input
              type="text"
              name="name"
              required
              placeholder="Claude on my laptop"
              className={FIELD}
            />
            <span className="text-ink-muted mt-1 block text-xs">
              You&apos;ll see this next to the revoke button, so name it after
              the thing you&apos;re connecting.
            </span>
          </label>

          <label className="mt-3 block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              What may it do?
            </span>
            <select name="scope" defaultValue="read" className={FIELD}>
              <option value="read">
                Read only — ask questions, change nothing
              </option>
              <option value="write">
                Read and write — assign work, update projects, log what you did
              </option>
            </select>
            <span className="text-ink-muted mt-1 block text-xs">
              Start read-only. An assistant that can only answer questions
              can&apos;t get anything wrong, and you can make a second token
              later.
            </span>
          </label>

          <p className="text-ink-muted mt-3 text-xs">
            Tokens last 180 days. The token is shown once when it&apos;s created
            and never again — only a hash is stored.
          </p>
        </ActionForm>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-tile border-line hover:bg-surface text-ink inline-flex items-center gap-2 border px-3 py-1.5 text-sm font-semibold transition-colors"
        >
          <Plus className="size-3.5" strokeWidth={2.5} />
          New token
        </button>
      )}

      {/*
        The token, and the command that uses it.

        Both, because "here is a secret" left Anish with a token and no idea what
        to do with it — "I'm not sure how to link the mcp, and where to get the
        token I made". The command has the token and the URL already in it, so
        connecting is one paste into a terminal rather than a trip to a doc and
        two substitutions.
      */}
      {minted ? (
        <div className="rounded-tile border-cardinal-600/30 bg-cardinal-50 border px-4 py-3.5">
          <p className="text-ink text-sm font-bold">Your token — copy it now</p>
          <p className="text-ink-soft mt-1 text-sm">
            This is the only time it is shown. If you lose it, revoke it above
            and make another; nothing can print it again.
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-tile border-line bg-card text-ink min-w-0 flex-1 overflow-x-auto border px-3 py-2 text-xs">
              {minted}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(minted);
                setCopied("token");
              }}
              className="rounded-tile border-line hover:bg-card text-ink inline-flex shrink-0 items-center gap-1.5 border px-3 py-2 text-sm font-semibold transition-colors"
            >
              {copied === "token" ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied === "token" ? "Copied" : "Copy"}
            </button>
          </div>

          <p className="text-ink mt-4 text-sm font-bold">
            Claude Code — paste this in a terminal
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-tile border-line bg-card text-ink min-w-0 flex-1 overflow-x-auto border px-3 py-2 text-xs whitespace-pre">
              {`claude mcp add --transport http skyrunners ${serverUrl} --header "Authorization: Bearer ${minted}"`}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(
                  `claude mcp add --transport http skyrunners ${serverUrl} --header "Authorization: Bearer ${minted}"`
                );
                setCopied("command");
              }}
              className="rounded-tile border-line hover:bg-card text-ink inline-flex shrink-0 items-center gap-1.5 border px-3 py-2 text-sm font-semibold transition-colors"
            >
              {copied === "command" ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied === "command" ? "Copied" : "Copy"}
            </button>
          </div>

          {/*
            The claude.ai path, and it needs a DIFFERENT URL rather than the same
            one plus a header.

            This paragraph used to say "paste the server URL and put Bearer <token>
            in the Authorization header", which is not a thing that dialog can do —
            it takes a URL and nothing else. So the instruction was impossible to
            follow, and Anish's report that the MCP only worked in Claude Code was
            exactly right.

            The personal URL carries the token in the path, which is why it is
            read-only: Vercel logs request paths, so a credential that could change
            the club's data does not belong in one. See `lib/mcp/handler.ts`.
          */}
          <p className="text-ink mt-4 text-sm font-bold">
            claude.ai or the Claude app — paste this URL
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-tile border-line bg-card text-ink min-w-0 flex-1 overflow-x-auto border px-3 py-2 text-xs">
              {`${serverUrl}/${minted}`}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(`${serverUrl}/${minted}`);
                setCopied("connector");
              }}
              className="rounded-tile border-line hover:bg-card text-ink inline-flex shrink-0 items-center gap-1.5 border px-3 py-2 text-sm font-semibold transition-colors"
            >
              {copied === "connector" ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied === "connector" ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-ink-muted mt-1.5 text-xs">
            Settings → Connectors → Add custom connector, and paste that. It can
            answer anything about the club but{" "}
            <span className="text-ink font-semibold">
              cannot change anything
            </span>{" "}
            — the token is in the URL, and URLs end up in server logs, so this
            one deliberately can&apos;t write. Use the Claude Code command above
            for that.
          </p>
        </div>
      ) : null}

      <p className="text-ink-muted flex items-start gap-2 text-xs">
        <Bot className="mt-0.5 size-3.5 shrink-0" />
        Risky and rare things stay on the website — deleting anything, changing
        roles, archiving a division, or reading someone else&apos;s personal
        record. Your AI will tell you to come here for those.
      </p>
    </div>
  );
}
