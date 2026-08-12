"use client";

import { useState } from "react";
import { AlertTriangle, Paperclip, Sparkles } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import { attachArtifactAction, removeArtifactAction } from "@/lib/actions";
import { checkLinkPermanence, detectArtifactKind } from "@/lib/artifacts";
import {
  DOCUMENT_ACCEPT,
  MAX_UPLOAD_BYTES,
  checkUpload,
  formatBytes,
} from "@/lib/storage";
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
export function AttachArtifactForm({
  projectId,
  /**
   * Demo mode has no Supabase, so there is nowhere to put a file.
   *
   * The upload half is hidden rather than disabled: a control that can only
   * fail is worse than one that isn't there, and links work perfectly in demo
   * mode so the form is still fully usable.
   */
  canUpload,
}: {
  projectId: string;
  canUpload?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"link" | "file">("link");
  const [file, setFile] = useState<{
    name: string;
    size: number;
    type: string;
  } | null>(null);
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

  const linking = mode === "link";
  const trimmed = url.trim();

  const linkProblem = linking && trimmed ? checkLinkPermanence(trimmed) : null;
  const fileProblem = !linking && file ? checkUpload(file, "document") : null;
  const problem = linkProblem ?? fileProblem;

  const detected = trimmed ? detectArtifactKind(trimmed) : null;
  const autoDetected =
    linking && !kindTouched && detected !== null && detected !== "link";

  // Nothing to submit yet: a link that's empty, or a file nobody picked.
  const incomplete = linking ? !trimmed : !file;

  // The permanence promise is about LINKS. An uploaded file is held by this
  // app, so there is nothing for a person to vouch for — see `addProjectArtifact`.
  const needsConfirmation = linking;

  function onUrlChange(next: string) {
    setUrl(next);
    if (!kindTouched) setKind(detectArtifactKind(next));
  }

  function onFileChange(picked: File | null) {
    setFile(
      picked
        ? { name: picked.name, size: picked.size, type: picked.type }
        : null
    );
    if (picked && !kindTouched)
      setKind(detectArtifactKind(`file:///${picked.name}`));
  }

  function switchMode(next: "link" | "file") {
    setMode(next);
    // Clearing the other side is what keeps "a file or a link, never both"
    // true by the time it reaches the action.
    if (next === "link") setFile(null);
    else setUrl("");
  }

  return (
    <ActionForm
      action={attachArtifactAction}
      submitLabel="Attach"
      submittingLabel="Attaching…"
      resetOnSuccess
      // Belt and braces with the server: the action refuses an unconfirmed or
      // expiring link anyway, this just means you find out before pressing.
      disabled={incomplete || !!problem || (needsConfirmation && !confirmed)}
      onSuccess={() => {
        setUrl("");
        setFile(null);
        setKind("link");
        setKindTouched(false);
        setConfirmed(false);
      }}
      className="rounded-card border-line bg-card w-full border p-4 text-left"
    >
      <input type="hidden" name="projectId" value={projectId} />

      {canUpload ? (
        <div className="border-line mb-4 inline-flex rounded-full border p-0.5">
          {(["link", "file"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => switchMode(option)}
              className={
                mode === option
                  ? "bg-cardinal-600 rounded-full px-3 py-1 text-sm font-semibold text-white"
                  : "text-ink-soft hover:text-ink rounded-full px-3 py-1 text-sm font-semibold"
              }
            >
              {option === "link" ? "Paste a link" : "Upload a file"}
            </button>
          ))}
        </div>
      ) : null}

      {linking ? (
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Link
          </span>
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
      ) : (
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            File
          </span>
          <input
            type="file"
            name="file"
            required
            accept={DOCUMENT_ACCEPT}
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            className="text-ink-soft file:rounded-tile file:border-line file:bg-surface file:text-ink w-full text-sm file:mr-3 file:border file:px-3 file:py-1.5 file:text-sm file:font-semibold"
          />
          <span className="text-ink-muted mt-1 block text-xs">
            Up to {formatBytes(MAX_UPLOAD_BYTES)}. Anything bigger belongs in
            Drive or Onshape — paste a link to it instead.
            {file ? ` · ${file.name} (${formatBytes(file.size)})` : ""}
          </span>
        </label>
      )}

      {problem ? (
        <p
          role="alert"
          className="text-risk-fg mt-2 flex items-start gap-2 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {"reason" in problem ? problem.reason : ""}
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

        Absent for uploads on purpose. The file is ours; asking someone to
        promise it won't expire would be a box with no meaning, and a box with
        no meaning teaches people to tick boxes without reading them.
      */}
      {needsConfirmation ? (
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
            Anyone in the club can open it, and it isn&apos;t a temporary
            download or a file in a personal folder. Once this project is
            complete the record freezes — a dead link can&apos;t be fixed then.
          </span>
        </label>
      ) : null}

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
