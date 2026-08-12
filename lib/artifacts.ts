/**
 * Reading a link: what kind of thing is it, and will it still work next year?
 *
 * Both questions are answered from the URL alone, with no network call. That's
 * deliberate — this runs in the browser as you type (to pre-select the kind) and
 * again on the server (to refuse a bad link), and a fetch in either place would
 * make the form laggy and the action slow, while telling us almost nothing: a
 * link that resolves today is exactly the link that rots in March.
 *
 * Pure functions, no imports beyond types, so the same code runs on both sides
 * and the client can't drift from what the server will accept.
 */

import type { ArtifactKind } from "./types.ts";

// ---------------------------------------------------------------------------
// What kind of document is this?
// ---------------------------------------------------------------------------

/**
 * Extensions that name a format unambiguously.
 *
 * Note what is NOT here: `requirements` and `test_report`. Those are facts about
 * what a document *says*, not what it *is* — a requirements spec and a test
 * report are both PDFs. The URL cannot tell them apart and guessing would be
 * worse than not guessing, so they stay manual.
 */
const EXTENSION_KINDS: Record<string, ArtifactKind> = {
  // Slides
  ppt: "presentation",
  pptx: "presentation",
  key: "presentation",
  odp: "presentation",

  // CAD and mesh
  step: "cad",
  stp: "cad",
  iges: "cad",
  igs: "cad",
  sldprt: "cad",
  sldasm: "cad",
  ipt: "cad",
  iam: "cad",
  catpart: "cad",
  f3d: "cad",
  stl: "cad",
  "3mf": "cad",
  obj: "cad",

  // Technical drawings
  dwg: "drawing",
  dxf: "drawing",

  // Numbers
  xls: "analysis",
  xlsx: "analysis",
  csv: "analysis",
  ipynb: "analysis",
  mat: "analysis",

  // Everything readable
  pdf: "doc",
  doc: "doc",
  docx: "doc",
  odt: "doc",
  rtf: "doc",
  txt: "doc",
  md: "doc",

  /*
    Photos land in `doc` because there is no `photo` kind in the enum. It's the
    generic bucket, not a claim that a flight-test picture is a document — and
    the detected kind is only ever a default the uploader can change. If the
    club ends up attaching photos often enough that "Document" reads wrong,
    that's an argument for a new enum value and a migration, not for bending
    one of the existing eight.
  */
  png: "doc",
  jpg: "doc",
  jpeg: "doc",
  gif: "doc",
  webp: "doc",
  heic: "doc",
  svg: "drawing",
};

/** Hosts where the domain alone settles it. Checked as suffixes. */
const HOST_KINDS: [string, ArtifactKind][] = [
  ["github.com", "github"],
  ["gitlab.com", "github"],
  ["bitbucket.org", "github"],
  ["onshape.com", "cad"],
  ["grabcad.com", "cad"],
  ["autodesk.com", "cad"],
  ["a360.co", "cad"],
  ["figma.com", "drawing"],
  ["overleaf.com", "doc"],
  ["notion.so", "doc"],
  ["ansys.com", "analysis"],
];

/**
 * Guess what kind of artifact a URL points at.
 *
 * A GUESS, and always overridable in the form. The point is that the common
 * cases — a GitHub repo, an Onshape document, a Drive slide deck — are right
 * without anyone thinking about it, so the dropdown stops being a chore that
 * gets left on whatever was first in the list.
 *
 * Falls back to `link`, which is the honest answer for a URL we can't read.
 */
export function detectArtifactKind(rawUrl: string): ArtifactKind {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return "link";
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  /*
    Google Docs before the generic host list: the product is identified by the
    first path segment, not the domain, so `docs.google.com` on its own is
    ambiguous between slides, a document and a spreadsheet.
  */
  if (host.endsWith("docs.google.com")) {
    if (path.startsWith("/presentation")) return "presentation";
    if (path.startsWith("/spreadsheets")) return "analysis";
    if (path.startsWith("/document")) return "doc";
    return "doc";
  }
  if (host.endsWith("drive.google.com")) return "doc";

  for (const [suffix, kind] of HOST_KINDS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return kind;
  }

  // Extension last: a link to a PDF *on* GitHub is still best filed as code,
  // and the host list already ran.
  const extension = path.includes(".")
    ? path.slice(path.lastIndexOf(".") + 1)
    : "";
  if (extension && EXTENSION_KINDS[extension])
    return EXTENSION_KINDS[extension];

  return "link";
}

// ---------------------------------------------------------------------------
// Will this link still work next year?
// ---------------------------------------------------------------------------

/**
 * Query parameters that prove a URL is temporary.
 *
 * Deliberately a short list of things that are *only* ever produced by a
 * signing process. `token` and `key` are not here despite looking suspicious —
 * plenty of permanent share links carry them, and a validator that blocks a
 * good link is worse than one that misses a bad one. The human confirmation is
 * what covers the rest; this catches the cases we can actually prove.
 */
const SIGNATURE_PARAMS = [
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-expires",
  "x-goog-signature",
  "x-goog-credential",
];

/** Hosts that only resolve on one person's machine or one private network. */
function isUnreachableHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;

  // RFC1918 private ranges — a link to the lab NAS that dies off the network.
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;

  return false;
}

export type PermanenceProblem = {
  /** A complete sentence naming what's wrong and what to do instead. */
  reason: string;
};

/**
 * Refuse links that are provably temporary.
 *
 * This exists because of what the engineering record is FOR: once a project
 * completes, the record freezes and nobody is maintaining it. A signed S3 URL
 * pasted in today is a dead link by the time the next cohort reads it, and by
 * then the person who pasted it has graduated.
 *
 * A machine check plus a human confirmation, doing different jobs. This catches
 * the links that are *certainly* temporary; the checkbox in the form covers the
 * ones only a person can judge — a Drive file shared to one address, a doc in a
 * personal folder that gets deprovisioned at graduation.
 *
 * Returns `null` when the link is fine.
 */
export function checkLinkPermanence(rawUrl: string): PermanenceProblem | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { reason: "Paste a link first." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      reason:
        "That doesn't look like a full web address — it needs to start with https://.",
    };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      reason: `A ${url.protocol.replace(":", "")} link only works on the machine it was made on. Paste a web address starting with https://.`,
    };
  }

  const host = url.hostname.toLowerCase();
  if (isUnreachableHost(host)) {
    return {
      reason:
        "That address only resolves on your own machine or the lab network, so nobody else can open it.",
    };
  }

  const params = new Set(
    [...url.searchParams.keys()].map((k) => k.toLowerCase())
  );

  for (const param of SIGNATURE_PARAMS) {
    if (params.has(param)) {
      return {
        reason:
          "That's a temporary download link — it carries an expiry signature and will stop working, usually within hours. Open the file in its home (Drive, Onshape, GitHub) and copy the share link from there.",
      };
    }
  }

  // Azure SAS: a signature plus an expiry, and it needs both to be one.
  if (params.has("sig") && params.has("se")) {
    return {
      reason:
        "That's a temporary download link with an expiry attached. Copy the permanent share link from wherever the file actually lives.",
    };
  }

  // Supabase's own signed URLs, which we'd otherwise happily store.
  if (url.pathname.includes("/storage/v1/object/sign/")) {
    return {
      reason:
        "That's a signed storage link and it expires. Use the public or share URL instead.",
    };
  }

  return null;
}
