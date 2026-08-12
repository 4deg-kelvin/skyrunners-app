"use client";

import { useState } from "react";
import { AlertTriangle, Paperclip, Sparkles } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import { attachArtifactAction, removeArtifactAction } from "@/lib/actions";
import { checkLinkPermanence, detectArtifactKind } from "@/lib/artifacts";
import { ARTIFACT_KIND_LABELS, ARTIFACT_KIND_ORDER } from "@/lib/labels";
import type { ArtifactKind } from "@/lib/types";

const FIELD =
  "rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]";

/**
 * Attach a document to a project's engineering record.
 *
 * Two things here are doing real work beyond collecting fields.
 *
 * **The kind auto-detects from the URL.** A GitHub repo, an Onshape document
 * and a Drive deck are all recognisable from the address alone, and a dropdown
 * nobody thinks about is a dropdown that stays on whatever sits first in the
 * list — which would quietly wreck the grouping this list is built around. It
 * is a DEFAULT, never a lock: touch the select once and detection stops
 * overriding you, because a PDF could be requirements or a test report and the
 * URL genuinely cannot tell.
 *
 * **The permanence check runs as you type.** The same function the server uses
 * (`lib/artifacts.ts`), so the warning you see is exactly what will refuse you
 * on submit — no round trip to find out, and no way for the two to disagree.
 */
export function AttachArtifactForm({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<ArtifactKind>("link");
  /*
    Once you pick a kind by hand, detection stops touching it. Without this the
    field would silently revert while you kept typing the URL, which reads as
    the form fighting you.
  */
  const [kindTouched, setKindTouched] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile border-line hover:bg-surface text-ink inline-flex items-center gap-2 border px-3 py-1.5 text-sm font-semibold transition-colors"
      >
        <Paperclip className="size-3.5" />
        Attach a document
      </button>
    );
  }

  const trimmed = url.trim();
  const problem = trimmed ? checkLinkPermanence(trimmed) : null;
  const detected = trimmed ? detectArtifactKind(trimmed) : null;
  const autoDetected = !kindTouched && detected !== null && detected !== "link";

  function onUrlChange(next: string) {
    setUrl(next);
    if (!kindTouched) setKind(detectArtifactKind(next));
  }

  return (
    <ActionForm
      action={attachArtifactAction}
      submitLabel="Attach"
      submittingLabel="Attaching…"
      resetOnSuccess
      // Belt and braces with the server: the action refuses an unconfirmed or
      // expiring link anyway, this just means you find out before pressing.
      disabled={!confirmed || !!problem || !trimmed}
      onSuccess={() => {
        setUrl("");
        setKind("link");
        setKindTouched(false);
        setConfirmed(false);
      }}
      className="rounded-card border-line bg-card w-full border p-4 text-left"
    >
      <input type="hidden" name="projectId" value={projectId} />

      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">Link</span>
        <input
          type="url"
          name="url"
          required
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://cad.onshape.com/documents/…"
          className={FIELD}
        />
      </label>

      {problem ? (
        <p
          role="alert"
          className="text-risk-fg mt-2 flex items-start gap-2 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {problem.reason}
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Title
          </span>
          <input
            type="text"
            name="title"
            required
            placeholder="Spar layup drawing"
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Kind
          </span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ArtifactKind);
              setKindTouched(true);
            }}
            className={FIELD}
          >
            {ARTIFACT_KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {ARTIFACT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          {autoDetected ? (
            <span className="text-ink-muted mt-1 flex items-center gap-1.5 text-xs">
              <Sparkles className="size-3" />
              Read from the link — change it if that&apos;s wrong.
            </span>
          ) : null}
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            What is it?{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="text"
            name="description"
            placeholder="Ply schedule and cure cycle for the v2 spar"
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Version{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="text"
            name="version"
            placeholder="Rev C"
            className={`${FIELD} sm:w-28`}
          />
        </label>
      </div>

      {/*
        The half of the permanence rule a machine can't check. `checkLinkPermanence`
        catches signed URLs and unreachable hosts; it cannot tell that a Drive
        file is shared to one address, or sits in a personal folder that gets
        deprovisioned at graduation. Only the person pasting it knows that.
      */}
      <label className="rounded-tile border-line bg-surface mt-4 flex items-start gap-2.5 border p-3">
        <input
          type="checkbox"
          name="confirmedPermanent"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span className="text-ink-soft text-sm">
          <span className="text-ink font-semibold">
            This link won&apos;t expire.
          </span>{" "}
          Anyone in the club can open it, and it isn&apos;t a temporary download
          or a file in a personal folder. Once this project is complete the
          record freezes — a dead link can&apos;t be fixed then.
        </span>
      </label>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink mt-3 text-sm font-medium"
      >
        Cancel
      </button>
    </ActionForm>
  );
}

/**
 * Take a document out of the record.
 *
 * Rendered only where `can.manageArtifact` passed, which already excludes
 * everyone but a Co-Lead once the project is complete.
 */
export function RemoveArtifactButton({
  artifactId,
  projectId,
}: {
  artifactId: string;
  projectId: string;
}) {
  return (
    <ActionButton
      action={removeArtifactAction}
      fields={{ artifactId, projectId }}
      label="Remove"
      pendingLabel="Removing…"
      tone="danger"
      className="shrink-0"
    />
  );
}
