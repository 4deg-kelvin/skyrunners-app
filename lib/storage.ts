/**
 * What may be uploaded, and where it goes.
 *
 * Pure functions and constants only — no Supabase import — so the form can
 * check a file before sending it and the Server Action can check the same file
 * again on arrival, from one definition. A client-side size check is a courtesy
 * that saves someone a slow upload and a confusing error; it is not a control,
 * because anyone can post to a Server Action directly. The real ceiling is
 * `file_size_limit` on the bucket itself (migration 0035), which Supabase
 * enforces at the storage API and nothing in this app can talk past.
 *
 * Three layers agreeing on 512 KB is deliberate redundancy. They fail in
 * different places and produce different messages, and the one that actually
 * holds is the one furthest from the user.
 */

/**
 * 512 KB.
 *
 * Chosen against Vercel, not against disk. A Server Action body is capped at
 * 1 MB by Next and 4.5 MB by Vercel's serverless runtime — the second one
 * cannot be raised on any plan. Half a megabyte leaves room for the rest of the
 * multipart body and keeps uploads inside a single action, which is what lets
 * this be an ordinary form instead of a signed-upload-URL dance.
 *
 * Real CAD does not fit, and is not supposed to: that belongs in Onshape with
 * a link here. This is for the small end — a scanned sign-off, a test-report
 * PDF, a photo of a failed part.
 */
export const MAX_UPLOAD_BYTES = 524_288;

export const PROJECT_DOCS_BUCKET = "project-docs";
export const AVATARS_BUCKET = "avatars";

/**
 * How long a signed document URL lasts.
 *
 * Ten minutes: long enough to click through and read, short enough that a URL
 * pasted into Discord stops working before it becomes a way around the login.
 * The bucket is private precisely so that link isn't permanent — see 0035.
 */
export const SIGNED_URL_TTL_SECONDS = 600;

/** What a project document may be. Mirrors `allowed_mime_types` in 0035. */
export const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  /*
    STEP, IGES and most CAD exports have no registered MIME type, so browsers
    send `application/octet-stream` for them. Excluding it would reject the
    exact format this feature was asked for — but it also matches every
    unknown binary, so the extension check below is what actually narrows it.
  */
  "application/octet-stream",
] as const;

export const PHOTO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Extensions allowed for a document.
 *
 * Needed *because* `application/octet-stream` is allowed. Without this, "any
 * unknown binary" would be the real rule and the MIME list would be decoration.
 */
export const DOCUMENT_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "txt",
  "csv",
  "md",
  "docx",
  "pptx",
  "xlsx",
  "step",
  "stp",
  "iges",
  "igs",
  "stl",
  "dxf",
];

export const PHOTO_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

/** The `accept` attribute for a file input, so the picker filters for you. */
export const DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(
  ","
);
export const PHOTO_ACCEPT = PHOTO_EXTENSIONS.map((e) => `.${e}`).join(",");

export function extensionOf(filename: string): string {
  const bare = filename.split(/[\\/]/).pop() ?? "";
  const dot = bare.lastIndexOf(".");
  return dot === -1 ? "" : bare.slice(dot + 1).toLowerCase();
}

/** Human-readable size, for error messages people can act on. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type UploadProblem = { reason: string };

/**
 * Is this file allowed?
 *
 * Takes the three fields rather than a `File`, so it runs identically in the
 * browser (where a `File` exists) and in a Server Action (where the value off
 * `FormData` is a `File`-shaped thing that isn't the DOM class).
 *
 * Returns `null` when the file is fine.
 */
export function checkUpload(
  file: { name: string; size: number; type: string },
  kind: "document" | "photo"
): UploadProblem | null {
  const extensions = kind === "photo" ? PHOTO_EXTENSIONS : DOCUMENT_EXTENSIONS;
  const label = kind === "photo" ? "photo" : "file";

  if (file.size === 0) {
    return { reason: `That ${label} is empty.` };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      reason:
        `That ${label} is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}. ` +
        (kind === "photo"
          ? "Crop or shrink it and try again."
          : "Put it in Drive or Onshape and paste the link instead — that's the better home for anything big anyway."),
    };
  }

  const extension = extensionOf(file.name);
  if (!extension) {
    return {
      reason: `That ${label} has no extension, so we can't tell what it is.`,
    };
  }
  if (!extensions.includes(extension)) {
    return {
      reason:
        kind === "photo"
          ? `Photos have to be PNG, JPG or WebP — that one is .${extension}.`
          : `.${extension} isn't a file type we store. Link it instead.`,
    };
  }

  return null;
}

/**
 * Strip a filename down to something safe for an object key.
 *
 * Supabase object names are mostly permissive, but spaces and non-ASCII turn
 * into percent-encoding that makes a path unreadable in the dashboard, and a
 * leading dot or a `..` segment is worth refusing on principle.
 */
export function safeFilename(filename: string): string {
  const bare = (filename.split(/[\\/]/).pop() ?? "file").normalize("NFKD");
  const cleaned = bare
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\-]+/, "")
    .slice(0, 80);
  return cleaned || "file";
}

/**
 * Where a project document lives: `<project_id>/<unique_id>-<filename>`.
 *
 * The FIRST segment is load-bearing. `storage_project_id()` in 0035 reads it to
 * decide who may write here, so this shape is not cosmetic — change it and the
 * storage policies stop matching.
 *
 * `uniqueId` is only there to stop two people attaching `report.pdf` from
 * colliding. It is generated before the artifact row exists, because the upload
 * has to succeed first: a failed upload after the row is written leaves a
 * broken link on a page people trust, whereas a failed row after the upload
 * leaves an orphaned object nobody can reach. One of those is recoverable by
 * pressing the button again.
 */
export function documentPath(
  projectId: string,
  uniqueId: string,
  filename: string
): string {
  return `${projectId}/${uniqueId}-${safeFilename(filename)}`;
}

/**
 * Where a profile photo lives: `<member_id>/<filename>`.
 *
 * Same deal — the `avatars` policies compare the first segment to
 * `auth.uid()`, which is what stops anyone writing into someone else's folder.
 */
export function photoPath(memberId: string, filename: string): string {
  return `${memberId}/${safeFilename(filename)}`;
}
