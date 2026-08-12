/**
 * Tests for link reading — kind detection and permanence.
 *
 * Run with:  npm test
 *
 * The rule being protected: the engineering record freezes when a project
 * completes, so a link that expires is a hole in the club's history that nobody
 * will be around to patch.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { checkLinkPermanence, detectArtifactKind } from "./artifacts.ts";

describe("detectArtifactKind", () => {
  test("reads the Google product from the path, not the domain", () => {
    // docs.google.com alone is ambiguous — slides, docs and sheets share it.
    assert.equal(
      detectArtifactKind("https://docs.google.com/presentation/d/abc/edit"),
      "presentation"
    );
    assert.equal(
      detectArtifactKind("https://docs.google.com/spreadsheets/d/abc/edit"),
      "analysis"
    );
    assert.equal(
      detectArtifactKind("https://docs.google.com/document/d/abc/edit"),
      "doc"
    );
  });

  test("recognises the tools this club actually uses", () => {
    assert.equal(
      detectArtifactKind("https://github.com/stanford-uav/avionics"),
      "github"
    );
    assert.equal(
      detectArtifactKind("https://cad.onshape.com/documents/abc/w/def"),
      "cad"
    );
    assert.equal(
      detectArtifactKind("https://drive.google.com/drive/folders/abc"),
      "doc"
    );
  });

  test("falls back to the extension when the host says nothing", () => {
    assert.equal(
      detectArtifactKind("https://example.com/files/wing-spar.step"),
      "cad"
    );
    assert.equal(
      detectArtifactKind("https://example.com/files/review.pptx"),
      "presentation"
    );
    assert.equal(
      detectArtifactKind("https://example.com/files/loads.xlsx"),
      "analysis"
    );
    assert.equal(
      detectArtifactKind("https://example.com/files/bracket.dxf"),
      "drawing"
    );
    assert.equal(
      detectArtifactKind("https://example.com/reports/flight-3.pdf"),
      "doc"
    );
  });

  test("host beats extension — a PDF on GitHub is still code", () => {
    assert.equal(
      detectArtifactKind("https://github.com/stanford-uav/docs/spec.pdf"),
      "github"
    );
  });

  test("is case-insensitive about both host and extension", () => {
    assert.equal(
      detectArtifactKind("https://GitHub.com/stanford-uav/avionics"),
      "github"
    );
    assert.equal(
      detectArtifactKind("https://example.com/WING-SPAR.STEP"),
      "cad"
    );
  });

  test("falls back to `link` rather than guessing", () => {
    assert.equal(detectArtifactKind("https://example.com/some/page"), "link");
    assert.equal(detectArtifactKind("not a url at all"), "link");
    assert.equal(detectArtifactKind(""), "link");
  });

  test("never guesses requirements or test_report", () => {
    /*
      Both are claims about what a document says, and every plausible URL for
      them is a PDF or a Doc. Detecting them would mean filing a spec as a test
      report about as often as it got it right.
    */
    const urls = [
      "https://example.com/requirements.pdf",
      "https://example.com/test-report.pdf",
      "https://docs.google.com/document/d/reqs/edit",
    ];
    for (const url of urls) {
      const kind = detectArtifactKind(url);
      assert.notEqual(kind, "requirements");
      assert.notEqual(kind, "test_report");
    }
  });
});

describe("checkLinkPermanence", () => {
  test("accepts the ordinary permanent links", () => {
    const good = [
      "https://github.com/stanford-uav/avionics",
      "https://cad.onshape.com/documents/abc/w/def/e/ghi",
      "https://docs.google.com/presentation/d/abc/edit?usp=sharing",
      "https://drive.google.com/file/d/abc/view",
      "http://example.edu/archive/report.pdf",
    ];
    for (const url of good) {
      assert.equal(checkLinkPermanence(url), null, url);
    }
  });

  test("refuses presigned S3 and GCS download links", () => {
    const signed =
      "https://bucket.s3.amazonaws.com/spar.step?X-Amz-Signature=deadbeef&X-Amz-Expires=3600";
    const problem = checkLinkPermanence(signed);
    assert.ok(problem, "a presigned URL must be refused");
    assert.match(problem.reason, /temporary/i);
  });

  test("refuses an Azure SAS link, which needs both halves to be one", () => {
    assert.ok(
      checkLinkPermanence("https://x.blob.core.windows.net/a?sig=b&se=c")
    );
    // `sig` alone is not proof — plenty of permanent links carry one.
    assert.equal(checkLinkPermanence("https://example.com/a?sig=b"), null);
  });

  test("refuses Supabase's own signed storage URLs", () => {
    const problem = checkLinkPermanence(
      "https://abc.supabase.co/storage/v1/object/sign/docs/report.pdf?token=xyz"
    );
    assert.ok(problem);
    assert.match(problem.reason, /expires/i);
  });

  test("refuses addresses nobody else can reach", () => {
    const unreachable = [
      "http://localhost:3000/report.pdf",
      "http://127.0.0.1/report.pdf",
      "http://192.168.1.40/nas/spar.step",
      "http://10.0.0.5/share",
      "http://172.16.4.2/share",
      "http://lab-nas.local/spar.step",
    ];
    for (const url of unreachable) {
      const problem = checkLinkPermanence(url);
      assert.ok(problem, `${url} must be refused`);
      assert.match(problem.reason, /nobody else can open it/i);
    }
  });

  test("refuses non-web protocols", () => {
    assert.ok(checkLinkPermanence("file:///C:/Users/anish/spar.step"));
    assert.ok(checkLinkPermanence("ftp://example.com/spar.step"));
  });

  test("refuses text that isn't a URL, and says so plainly", () => {
    const problem = checkLinkPermanence("the drive folder");
    assert.ok(problem);
    assert.match(problem.reason, /https:\/\//);
  });

  test("does not block `token` on its own", () => {
    /*
      Guarding against over-eager validation. A validator that refuses a good
      link teaches people to route around the feature, which costs more than
      the occasional rotted link the checkbox was there to catch.
    */
    assert.equal(
      checkLinkPermanence("https://example.com/share?token=abc123"),
      null
    );
  });
});
