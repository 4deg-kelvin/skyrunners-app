"use client";

import { useState } from "react";
import { Bot, Plus } from "lucide-react";

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
          onSuccess={() => setOpen(false)}
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
                Read and write — assign work, update projects, log hours
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

      <p className="text-ink-muted flex items-start gap-2 text-xs">
        <Bot className="mt-0.5 size-3.5 shrink-0" />
        Risky and rare things stay on the website — deleting anything, changing
        roles, archiving a division, or reading someone else&apos;s hours. Your
        AI will tell you to come here for those.
      </p>
    </div>
  );
}
