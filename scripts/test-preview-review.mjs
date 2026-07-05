#!/usr/bin/env node
// Hermetic coverage for the preview-review helper: a `/preview/<lead>` mockup is
// detected as a reviewable deliverable, and the Work Board `answer` text stamped
// on approve / request-changes carries the operator's intent AND the "don't treat
// the human mark as proof — re-check before sending" guard. This locks the
// contract the Company Cockpit review controls ride on.
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { issueReviewablePreviews, issuePreviewUrl, previewReviewAnswer } = await import(
  "../src/features/dashboard/views/zero-human-companies/preview-review.ts"
);

const PREVIEW_URL = "https://sarasota-demo-pipeline.hivemindos.workers.dev/preview/ginza";

const issue = {
  title: "Ginza restaurant preview site",
  agent: "emerson",
  work: {
    taskId: "t_ginza_preview_1",
    status: "needs-human",
    deliverables: [
      { id: "d1", kind: "url", label: "preview", url: PREVIEW_URL },
      { id: "d2", kind: "url", label: "booking", url: "https://cal.com/ginza/kickoff" },
      { id: "d3", kind: "file", label: "notes.md", path: "/tmp/notes.md" },
    ],
  },
};

// ── detection: only the /preview/ link is a reviewable preview ───────────────
const previews = issueReviewablePreviews(issue);
assert.equal(previews.length, 1, `exactly one reviewable preview, got ${previews.length}`);
assert.equal(previews[0].url, PREVIEW_URL, "the reviewable preview is the /preview/ link");
assert.equal(issuePreviewUrl(issue), PREVIEW_URL, "issuePreviewUrl returns the preview URL");

// An issue with no preview deliverable has nothing reviewable.
assert.equal(
  issueReviewablePreviews({ work: { deliverables: [{ id: "x", kind: "url", label: "booking", url: "https://cal.com/x" }] } }).length,
  0,
  "a booking-only issue has no reviewable preview",
);
assert.equal(issuePreviewUrl({ work: undefined }), undefined, "no work → no preview URL");

// ── approve: intent + URL + task + the anti-shortcut guard ───────────────────
const approve = previewReviewAnswer(issue, "approve", "", PREVIEW_URL);
assert.match(approve, /APPROVED/, "approve text says APPROVED");
assert.match(approve, /sarasota-demo-pipeline\.hivemindos\.workers\.dev\/preview\/ginza/, "approve text carries the preview URL");
assert.match(approve, /t_ginza_preview_1/, "approve text carries the task id");
assert.match(approve, /do not treat the approval as proof/i, "approve text keeps the re-check-before-send guard");

// An operator note on approve is threaded through.
assert.match(previewReviewAnswer(issue, "approve", "ship it, looks great"), /ship it, looks great/, "approve threads the operator note");

// ── changes: the notes are the payload, and it loops back for review ─────────
const changes = previewReviewAnswer(issue, "changes", "warmer tone; feature the lunch specials", PREVIEW_URL);
assert.match(changes, /requested CHANGES/i, "changes text says CHANGES");
assert.match(changes, /warmer tone; feature the lunch specials/, "changes text carries the operator's notes verbatim");
assert.match(changes, /re-submit it for human review/i, "changes text loops the preview back for another review");
assert.match(changes, /Do not send anything to the lead/i, "changes text holds the send until re-approval");

console.log("preview-review: all assertions passed");
