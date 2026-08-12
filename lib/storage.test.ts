/**
 * Tests for what may be uploaded, and where it lands.
 *
 * Run with:  npm test
 *
 * The rule being protected: the FIRST path segment decides who is allowed to
 * write the object. `storage_project_id()` and the `avatars` policies in
 * migration 0035 both read it, so a change to these path shapes silently
 * detaches the storage policies from the app's permission rules — the writes
 * keep succeeding, just for the wrong people.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  MAX_UPLOAD_BYTES,
  checkUpload,
  documentPath,
  extensionOf,
  formatBytes,
  photoPath,
  safeFilename,
} from "./storage.ts";

const file = (name: string, size = 1000, type = "application/pdf") => ({
  name,
  size,
  type,
});

describe("checkUpload", () => {
  test("accepts an ordinary small document", () => {
    assert.equal(checkUpload(file("report.pdf"), "document"), null);
  });

  test("accepts the CAD formats this was asked for", () => {
    for (const name of ["spar.step", "spar.STP", "bracket.dxf", "part.stl"]) {
      assert.equal(checkUpload(file(name), "document"), null, name);
    }
  });

  test("refuses anything over 512 KB, and says what to do instead", () => {
    const problem = checkUpload(
      file("huge.pdf", MAX_UPLOAD_BYTES + 1),
      "document"
    );
    assert.ok(problem);
    // The advice matters as much as the refusal — a size error with no next
    // step just leaves someone stuck with a file they can't attach.
    assert.match(problem.reason, /paste the link instead/i);
  });

  test("accepts a file exactly at the limit", () => {
    // Off-by-one here means the documented number is a lie.
    assert.equal(
      checkUpload(file("exact.pdf", MAX_UPLOAD_BYTES), "document"),
      null
    );
  });

  test("refuses an empty file", () => {
    assert.ok(checkUpload(file("empty.pdf", 0), "document"));
  });

  test("refuses a type we don't store", () => {
    const problem = checkUpload(file("virus.exe"), "document");
    assert.ok(problem);
    assert.match(problem.reason, /\.exe/);
  });

  test("refuses a file with no extension", () => {
    /*
      Load-bearing, because the bucket allows `application/octet-stream` for
      STEP files. Without an extension check, "any unknown binary" would be the
      real rule and the MIME list would be decoration.
    */
    assert.ok(checkUpload(file("README"), "document"));
  });

  test("photos are narrower than documents", () => {
    assert.equal(
      checkUpload(file("face.png", 1000, "image/png"), "photo"),
      null
    );
    // A PDF is a fine document and a nonsense profile picture.
    assert.equal(checkUpload(file("face.pdf"), "document"), null);
    const problem = checkUpload(file("face.pdf"), "photo");
    assert.ok(problem);
    assert.match(problem.reason, /PNG, JPG or WebP/i);
  });

  test("the photo size message says crop, not link", () => {
    // Different advice for a different problem: you can't "link" a face.
    const problem = checkUpload(
      file("big.png", MAX_UPLOAD_BYTES + 1, "image/png"),
      "photo"
    );
    assert.ok(problem);
    assert.match(problem.reason, /crop or shrink/i);
  });
});

describe("path shapes", () => {
  test("a document's FIRST segment is the project id", () => {
    // `storage_project_id()` in 0035 reads exactly this.
    const path = documentPath("proj-1", "uniq-2", "Spar Layup v3.pdf");
    assert.equal(path.split("/")[0], "proj-1");
  });

  test("a photo's FIRST segment is the member id", () => {
    // The avatars policies compare exactly this to auth.uid().
    const path = photoPath("mem-1", "me.png");
    assert.equal(path.split("/")[0], "mem-1");
  });

  test("filenames can't escape their folder", () => {
    const path = documentPath("proj-1", "uniq", "../../../etc/passwd");
    assert.equal(path.split("/")[0], "proj-1");
    assert.equal(path.includes(".."), false);
  });

  test("two people attaching report.pdf don't collide", () => {
    assert.notEqual(
      documentPath("proj-1", "a", "report.pdf"),
      documentPath("proj-1", "b", "report.pdf")
    );
  });
});

describe("safeFilename", () => {
  test("spaces and punctuation become hyphens", () => {
    assert.equal(
      safeFilename("Spar Layup v3 (final).pdf"),
      "Spar-Layup-v3-final-.pdf"
    );
  });

  test("strips any directory part", () => {
    assert.equal(safeFilename("C:\\Users\\anish\\spar.step"), "spar.step");
    assert.equal(safeFilename("/tmp/spar.step"), "spar.step");
  });

  test("never returns empty", () => {
    assert.equal(safeFilename("..."), "file");
    assert.equal(safeFilename(""), "file");
  });

  test("caps the length", () => {
    assert.ok(safeFilename(`${"x".repeat(500)}.pdf`).length <= 80);
  });
});

describe("helpers", () => {
  test("extensionOf is case-insensitive and takes the last dot", () => {
    assert.equal(extensionOf("a.b.STEP"), "step");
    assert.equal(extensionOf("noext"), "");
  });

  test("formatBytes reads like a person wrote it", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(MAX_UPLOAD_BYTES), "512 KB");
    assert.equal(formatBytes(1_600_000), "1.5 MB");
  });
});
