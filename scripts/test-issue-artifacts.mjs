#!/usr/bin/env node
// Hermetic tests for issueReferencedArtifacts: the openable artifacts a
// needs-human issue references are derived from BOTH the structured
// `deliverables` array AND the result prose (a "Deliverables:" block of bare
// URLs, an "Artifacts:" block of file paths). Motivated by real Work Board task
// t_mramyzox_pxxm8, whose structured deliverables array was empty while the
// drafts + offer pages lived only in the result text.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { issueReferencedArtifacts } = await import(
  "../src/features/dashboard/views/zero-human-companies/issue-artifacts.ts"
);

const RESULT = `Claimed and recorded Work Board task as needs-human with approval-ready close replies.

Result:
- Drafted 4 payment-oriented replies for warm prospects.

Deliverables:
https://liamvisionary.com/offer/sarasota-ginza-mr8rstmp
https://liamvisionary.com/offer/sarasota-abel-s-ice-cream-mr8rstmp
https://cal.com/liamvisionary/discovery

Artifacts:
- /root/Documents/Obsidian/hivemindos-vault/Operations/Work Board/artifacts/t_mramyzox_pxxm8-rebuild-close-asks/APPROVAL_PACKET.md
- /root/Documents/Obsidian/hivemindos-vault/Operations/Work Board/artifacts/t_mramyzox_pxxm8-rebuild-close-asks/payment_oriented_close_replies.json
- /root/Documents/Obsidian/hivemindos-vault/Memory/Distillations/Agent Memory/artifact/2026-07-07-close-ask-rule.md

ACTION NEEDED:
Approve sending the four drafted close replies, or choose the smaller send set to approve.
OPTIONS: send all 4 | send Ginza + Abel only | hold all
NEEDS: approval

\`\`\`loop-receipts
[{"gateId":"g","status":"passed","evidence":["/root/Documents/Obsidian/hivemindos-vault/Operations/Brain Services/Queen Bee/t_x/internal_receipt.json"]}]
\`\`\``;

const issue = { work: { taskId: "t_x", status: "needs-human", result: RESULT, deliverables: [] } };
const artifacts = issueReferencedArtifacts(issue);
const byUrlOrPath = (a) => a.url || a.deliverable.path || "";

// 1. Referenced artifacts are derived from the prose even with an empty deliverables array.
assert.ok(artifacts.length >= 5, `expected the prose artifacts to be surfaced, got ${artifacts.length}`);

// 2. The drafts (Artifacts: file paths) are surfaced and openable.
const packet = artifacts.find((a) => byUrlOrPath(a).endsWith("APPROVAL_PACKET.md"));
assert.ok(packet, "APPROVAL_PACKET.md is surfaced");
assert.equal(packet.category, "report");
assert.equal(packet.action, "open");
const replies = artifacts.find((a) => byUrlOrPath(a).endsWith("payment_oriented_close_replies.json"));
assert.ok(replies, "payment_oriented_close_replies.json is surfaced");
assert.equal(replies.category, "data");
// The humanizeLabel task-hash stripper must not mangle "paymenT_oriented" into "Paymen".
assert.match(replies.title, /payment oriented close replies/i, `draft title should be readable, got "${replies.title}"`);

// 3. The Deliverables: URLs become openable links (offer pages are reviewable).
const ginza = artifacts.find((a) => a.url === "https://liamvisionary.com/offer/sarasota-ginza-mr8rstmp");
assert.ok(ginza, "the Ginza offer page is surfaced");
assert.equal(ginza.category, "link");
assert.equal(ginza.action, "visit");
assert.equal(ginza.reviewable, true);
assert.ok(artifacts.some((a) => a.url === "https://cal.com/liamvisionary/discovery"), "the booking link is surfaced");

// 4. Junk is filtered: the brain-memory note and the fenced-block internal receipt path are NOT surfaced.
assert.ok(!artifacts.some((a) => byUrlOrPath(a).includes("/Memory/Distillations/")), "brain-memory notes are hidden");
assert.ok(!artifacts.some((a) => byUrlOrPath(a).includes("internal_receipt.json")), "fenced-block gate-evidence paths are not surfaced");

// 5. Ordering: the drafts/reports come before the customer-facing links.
const firstLink = artifacts.findIndex((a) => a.category === "link");
const lastDoc = artifacts.map((a) => a.category).lastIndexOf("data");
assert.ok(firstLink === -1 || lastDoc < firstLink, "reports/data are ordered before links");

// 6. No work → no artifacts (graceful).
assert.deepEqual(issueReferencedArtifacts({ work: undefined }), []);
assert.deepEqual(issueReferencedArtifacts({ work: { result: "", deliverables: [] } }), []);

console.log("issue referenced-artifacts suite passed");
