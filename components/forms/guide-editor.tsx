"use client";

import { useState } from "react";
import { Link2, Pencil, Plus, StickyNote } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  moveGuideBlockAction,
  removeGuideBlockAction,
  saveGuideBlockAction,
} from "@/lib/actions";
import { checkLinkPermanence } from "@/lib/artifacts";
import { formatDay } from "@/lib/dates";
import type { GuideBlock, GuidePage } from "@/lib/types";

const FIELD =
  "rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]";

/**
 * Co-Lead editing for one guide page.
 *
 * Adds links (a Google Doc explaining the Fusion setup, a Drive folder of
 * templates) and short notes, groups them under headings the club invents, and
 * orders them.
 *
 * The same permanence check the engineering record uses runs as you type. A
 * guide is read by somebody in their first week; a link that has already
 * expired teaches them the app is unreliable before they have used any of it.
 */
export function GuideEditor({
  page,
  rows,
}: {
  page: GuidePage;
  rows: { block: GuideBlock; updatedBy?: { fullName: string } }[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className="text-ink-soft text-sm">
          Nothing added yet. Members see only the built-in material on this page
          until you add something.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ block, updatedBy }, index) => (
            <li
              key={block.id}
              className="rounded-tile border-line border px-3 py-2.5"
            >
              {editing === block.id ? (
                <BlockForm
                  page={page}
                  block={block}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-ink flex items-center gap-2 text-[15px] font-semibold">
                      {block.kind === "link" ? (
                        <Link2 className="text-ink-muted size-3.5 shrink-0" />
                      ) : (
                        <StickyNote className="text-ink-muted size-3.5 shrink-0" />
                      )}
                      {block.title}
                    </p>
                    {block.category ? (
                      <p className="text-cardinal-600 mt-0.5 text-xs font-semibold">
                        {block.category}
                      </p>
                    ) : null}
                    {block.body ? (
                      <p className="text-ink-soft mt-1 text-sm">{block.body}</p>
                    ) : null}
                    {block.url ? (
                      <p className="text-ink-muted mt-1 text-xs break-all">
                        {block.url}
                      </p>
                    ) : null}
                    <p className="text-ink-muted mt-1 text-xs">
                      Updated {formatDay(block.updatedAt)}
                      {updatedBy ? ` by ${updatedBy.fullName}` : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {index > 0 ? (
                      <ActionButton
                        action={moveGuideBlockAction}
                        fields={{ blockId: block.id, direction: "up" }}
                        label="↑"
                        pendingLabel="…"
                      />
                    ) : null}
                    {index < rows.length - 1 ? (
                      <ActionButton
                        action={moveGuideBlockAction}
                        fields={{ blockId: block.id, direction: "down" }}
                        label="↓"
                        pendingLabel="…"
                      />
                    ) : null}
                    <button
                      onClick={() => setEditing(block.id)}
                      className="rounded-tile border-line hover:bg-surface text-ink inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-sm font-semibold"
                    >
                      <Pencil className="size-3" />
                      Edit
                    </button>
                    <ActionButton
                      action={removeGuideBlockAction}
                      fields={{ blockId: block.id }}
                      label="Remove"
                      pendingLabel="Removing…"
                      tone="danger"
                    />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <BlockForm page={page} onDone={() => setAdding(false)} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="rounded-tile border-line hover:bg-surface text-ink inline-flex items-center gap-2 border px-3 py-1.5 text-sm font-semibold transition-colors"
        >
          <Plus className="size-3.5" strokeWidth={2.5} />
          Add to this page
        </button>
      )}
    </div>
  );
}

/** Also used for editing, since the fields are identical. */
function BlockForm({
  page,
  block,
  onDone,
}: {
  page: GuidePage;
  block?: GuideBlock;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<GuideBlock["kind"]>(block?.kind ?? "link");
  const [url, setUrl] = useState(block?.url ?? "");

  const problem =
    kind === "link" && url.trim() ? checkLinkPermanence(url) : null;

  return (
    <ActionForm
      action={saveGuideBlockAction}
      submitLabel={block ? "Save changes" : "Add it"}
      submittingLabel="Saving…"
      disabled={!!problem}
      resetOnSuccess={!block}
      onSuccess={onDone}
      className="rounded-card border-line bg-card border p-4"
    >
      <input type="hidden" name="page" value={page} />
      {block ? <input type="hidden" name="blockId" value={block.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            What is it?
          </span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as GuideBlock["kind"])}
            className={FIELD}
          >
            <option value="link">
              A link — Google Doc, Drive folder, video
            </option>
            <option value="note">A note — something to say on the page</option>
          </select>
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Heading{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="text"
            name="category"
            defaultValue={block?.category ?? ""}
            placeholder="Software setup"
            className={FIELD}
          />
          <span className="text-ink-muted mt-1 block text-xs">
            Groups it with anything else under the same heading.
          </span>
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-ink mb-1 block text-sm font-semibold">Title</span>
        <input
          type="text"
          name="title"
          required
          defaultValue={block?.title ?? ""}
          placeholder="Installing Fusion 360 with the Stanford licence"
          className={FIELD}
        />
      </label>

      {kind === "link" ? (
        <label className="mt-3 block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Link
          </span>
          <input
            type="url"
            name="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/document/d/…"
            className={FIELD}
          />
          {problem ? (
            <span className="text-risk-fg mt-1 block text-sm">
              {problem.reason}
            </span>
          ) : (
            <span className="text-ink-muted mt-1 block text-xs">
              Make sure it&apos;s shared with the club, not just you — a new
              member hitting a permission wall is worse than no link.
            </span>
          )}
        </label>
      ) : null}

      <label className="mt-3 block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          {kind === "link" ? (
            <>
              One line of context{" "}
              <span className="text-ink-muted font-normal">(optional)</span>
            </>
          ) : (
            "What it says"
          )}
        </span>
        <textarea
          name="body"
          rows={kind === "link" ? 2 : 5}
          defaultValue={block?.body ?? ""}
          placeholder={
            kind === "link"
              ? "Read this before your first CAD session."
              : "Anything the club wants new members to know that the app itself doesn't explain."
          }
          className={FIELD}
        />
      </label>

      <button
        type="button"
        onClick={onDone}
        className="text-ink-muted hover:text-ink mt-3 text-sm font-medium"
      >
        Cancel
      </button>
    </ActionForm>
  );
}
