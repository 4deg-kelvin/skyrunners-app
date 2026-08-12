/**
 * Reading and writing files, on the server only.
 *
 * Separate from `lib/storage.ts`, which is the pure half — sizes, extensions,
 * path shapes — imported by both the browser form and this module. Everything
 * here touches Supabase and must never reach a Client Component.
 *
 * ---------------------------------------------------------------------------
 * These calls run as the SIGNED-IN USER, never the service role
 * ---------------------------------------------------------------------------
 *
 * `createClient()` carries the session cookie, so the storage policies in
 * migration 0035 actually apply: a member who isn't committed to a project
 * cannot write into its folder, and nobody can write into somebody else's
 * avatar folder. Reaching for `lib/supabase/admin.ts` here would bypass all of
 * that — same mistake as using Prisma for reads, one layer down.
 *
 * ---------------------------------------------------------------------------
 * Demo mode has no storage, and says so
 * ---------------------------------------------------------------------------
 *
 * A fresh clone has no Supabase project, so uploading is impossible rather
 * than merely unconfigured. Every function returns a refusal with a sentence
 * explaining that, and the forms don't render an upload control at all when
 * `viewer.isDemo` — because a control that can only fail is the dead-control
 * bug this repo keeps re-learning.
 */

/*
  No `import "server-only"` guard, deliberately. That package isn't a
  dependency here, and adding it would break `npm test` — the node test runner
  isn't Next, so it can't resolve it, and every suite that reaches
  `lib/data/projects.ts` would die on the import rather than fail a test.

  What keeps this off the client instead: it imports `./server`, which reads
  cookies, so pulling it into a Client Component fails the build anyway.
*/
import { createClient } from "./server";
import {
  AVATARS_BUCKET,
  PROJECT_DOCS_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  documentPath,
  photoPath,
} from "../storage";

export type StorageResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

const NO_STORAGE =
  "File storage isn't available in demo mode — paste a link instead.";

/**
 * The session-scoped client, or null when there is no Supabase project.
 *
 * `createClient()` already returns null in demo mode, so this is the single
 * place that has to notice — checking `isLiveMode()` separately would be a
 * second source of truth for the same fact, and they could disagree.
 */
async function storageClient() {
  return (await createClient()) ?? null;
}

/** Anything with the shape `FormData` hands back for a file input. */
export interface UploadableFile {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Put a document in the private bucket.
 *
 * Returns the object KEY, not a URL — the bucket is private and there is no
 * permanent address. `signDocumentUrl` turns it into something openable, per
 * request, for ten minutes.
 *
 * `upsert: false` is deliberate: the key carries the artifact id, so a
 * collision means two artifacts were somehow minted with the same id, and
 * silently overwriting the first one's file is the worst available response.
 */
export async function uploadDocument(
  projectId: string,
  artifactId: string,
  file: UploadableFile
): Promise<StorageResult<string>> {
  const supabase = await storageClient();
  if (!supabase) return { ok: false, error: NO_STORAGE };

  const key = documentPath(projectId, artifactId, file.name);

  const { error } = await supabase.storage
    .from(PROJECT_DOCS_BUCKET)
    .upload(key, await file.arrayBuffer(), {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (error) {
    return { ok: false, error: uploadMessage(error.message) };
  }
  return { ok: true, value: key };
}

/**
 * Mint a short-lived URL for a stored document.
 *
 * Returns null rather than throwing when signing fails. A document whose file
 * has gone missing should render as an un-openable row, not take the whole
 * project page down with it — the rest of the record is still worth reading.
 */
export async function signDocumentUrl(key: string): Promise<string | null> {
  const supabase = await storageClient();
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from(PROJECT_DOCS_BUCKET)
    .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);

  return error ? null : (data?.signedUrl ?? null);
}

/**
 * Sign several at once.
 *
 * A project page renders its whole record, so signing one at a time would be
 * a round trip per row — the same shape as looking data up inside a render
 * loop, which `lib/data/*` exists to prevent. Supabase has a batch endpoint;
 * this uses it and returns a Map keyed by object key.
 */
export async function signDocumentUrls(
  keys: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (keys.length === 0) return out;

  const supabase = await storageClient();
  if (!supabase) return out;

  const { data, error } = await supabase.storage
    .from(PROJECT_DOCS_BUCKET)
    .createSignedUrls(keys, SIGNED_URL_TTL_SECONDS);

  if (error || !data) return out;

  for (const entry of data) {
    // `path` comes back null for keys that failed; those simply stay absent,
    // and the row renders without a link.
    if (entry.path && entry.signedUrl) out.set(entry.path, entry.signedUrl);
  }
  return out;
}

/**
 * Delete a stored document.
 *
 * Best-effort by design. The caller removes the artifact row first; if this
 * then fails, the club is left with an orphaned object nobody can reach
 * through the app, which is untidy but harmless. The reverse order — file
 * gone, row still listed — is a broken link on a page people trust.
 */
export async function removeDocument(key: string): Promise<void> {
  const supabase = await storageClient();
  if (!supabase) return;

  await supabase.storage.from(PROJECT_DOCS_BUCKET).remove([key]);
}

/**
 * Put a profile photo in the public bucket and return its permanent URL.
 *
 * `upsert: true`, unlike documents: a member replacing their photo should
 * overwrite it rather than accumulate one object per change. The key is
 * `<member_id>/<filename>`, which the avatars policies compare against
 * `auth.uid()`.
 *
 * The URL gets a cache-busting suffix because the object key is stable — every
 * browser and CDN between here and the roster page would otherwise keep
 * serving the old face after an upsert.
 */
export async function uploadPhoto(
  memberId: string,
  file: UploadableFile
): Promise<StorageResult<string>> {
  const supabase = await storageClient();
  if (!supabase) return { ok: false, error: NO_STORAGE };

  const key = photoPath(memberId, file.name);

  const { error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(key, await file.arrayBuffer(), {
      contentType: file.type || "image/jpeg",
      upsert: true,
    });

  if (error) {
    return { ok: false, error: uploadMessage(error.message) };
  }

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(key);
  if (!data?.publicUrl) {
    return { ok: false, error: "Uploaded, but couldn't work out its address." };
  }

  return { ok: true, value: `${data.publicUrl}?v=${Date.now()}` };
}

/**
 * Turn Supabase's storage errors into something a person can act on.
 *
 * The raw messages are written for whoever wrote the request, not whoever
 * pressed the button — "new row violates row-level security policy" tells a
 * student nothing about what to do next.
 */
function uploadMessage(raw: string): string {
  const lower = raw.toLowerCase();

  if (lower.includes("exceeded") || lower.includes("too large")) {
    return "That file is over the 512 KB limit. Link it instead.";
  }
  if (lower.includes("mime") || lower.includes("content type")) {
    return "That file type isn't one we store. Link it instead.";
  }
  if (lower.includes("row-level security") || lower.includes("unauthorized")) {
    return "You don't have permission to add files to this project.";
  }
  if (lower.includes("already exists") || lower.includes("duplicate")) {
    return "A file with that name is already attached here.";
  }
  return `Upload failed: ${raw}`;
}
