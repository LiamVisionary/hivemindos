#!/usr/bin/env node
// Hermetic coverage for the human deliverable model: junk gets hidden, real
// artifacts get categorized with human labels, links are typed, and the whole
// firehose dedupes into display buckets. These are the exact failure cases the
// live board produced (command strings, fabricated URLs, extension-less paths,
// brain-memory notes) — so this guards the "deliverables must be human-readable"
// contract at the source.
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { classifyDeliverable, bucketDeliverables, deliverableOpenKind } = await import(
  "../src/features/dashboard/views/zero-human-companies/deliverables-model.ts"
);

const d = (o) => ({ id: o.id ?? Math.random().toString(36).slice(2), kind: o.kind ?? "file", label: o.label, path: o.path, url: o.url });

// ── junk / broken → hidden (internal) ──────────────────────────────────────
const junk = [
  d({ kind: "file", label: "hivemind_bridge.py --resolve esc_c4c approve", path: "/Users/liam/Documents/code/projects/maps-agency/scripts/hivemind_bridge.py --resolve esc_c4c approve" }),
  d({ kind: "file", label: "orchestrate", path: "/Users/liam/Documents/code/projects/maps-agency/scripts/orchestrate" }),
  d({ kind: "file", label: "escalations", path: "/Users/liam/Documents/code/projects/maps-agency/state/escalations" }),
  d({ kind: "file", label: "BASE=https", path: "//sarasota-demo-pipeline.hivemindos.workers.dev" }),
  d({ kind: "file", label: "https", path: "//sarasota-demo-pipeline.hivemindos.workers.dev" }),
  d({ kind: "url", label: "paid", url: "https://demo.sarasota-sites.example/paid?session_id=mock_1782974571939&lead=ginza" }),
  d({ kind: "document", label: "Shared Brain learning note", path: "/root/Documents/Obsidian/hivemindos-vault/Memory/Distillations/Agent Memory/decision/x.md" }),
];
for (const item of junk) {
  const c = classifyDeliverable(item);
  assert.equal(c.category, "internal", `expected internal for ${item.label} — got ${c.category} (${c.internalReason})`);
}

// ── real artifacts → categorized with human labels ──────────────────────────
const report = classifyDeliverable(d({ kind: "document", label: "objection follow-up RESULT.md", path: "/root/Documents/Obsidian/hivemindos-vault/Operations/Work Board/artifacts/t_x/RESULT.md" }));
assert.equal(report.category, "report");
assert.equal(report.action, "open");

const sheet = classifyDeliverable(d({ kind: "document", label: "top25-tracker.csv", path: "/Users/liam/Documents/Obsidian/hivemindos-vault/Operations/Brain Services/top25-tracker.csv" }));
assert.equal(sheet.category, "data");
assert.equal(sheet.icon, "sheet");

const vaultSpaces = classifyDeliverable(d({ kind: "file", label: "preview-verification.json", path: "/root/Documents/Obsidian/hivemindos-vault/Operations/Brain Services/Queen Bee/t_x/preview-verification.json" }));
assert.equal(vaultSpaces.category, "data", "vault path with spaces in dir names is still an openable data file");
assert.equal(deliverableOpenKind(vaultSpaces.deliverable), "file");

// ── links → typed + preview flagged reviewable ──────────────────────────────
const preview = classifyDeliverable(d({ kind: "url", label: "live Ginza preview", url: "https://sarasota-demo-pipeline.hivemindos.workers.dev/preview/ginza" }));
assert.equal(preview.category, "link");
assert.equal(preview.icon, "site");
assert.equal(preview.reviewable, true, "a per-lead preview is a reviewable, customer-facing output");
assert.match(preview.title, /ginza/i);

const ops = classifyDeliverable(d({ kind: "url", label: "live pipeline ops status", url: "https://sarasota-demo-pipeline.hivemindos.workers.dev/ops" }));
assert.equal(ops.icon, "status");
assert.equal(ops.reviewable ?? false, false);

// ── buckets: dedupe + ordering + review surfacing ───────────────────────────
const buckets = bucketDeliverables([...junk, report.deliverable, sheet.deliverable, preview.deliverable, ops.deliverable, preview.deliverable]);
assert.ok(buckets.internal.length >= junk.length - 1, "junk lands in the collapsed internal bucket");
assert.ok(buckets.visible.some((c) => c.category === "link"), "links are visible");
assert.equal(buckets.visible[0].category, "link", "links sort first");
assert.equal(buckets.reviewable.length, 1, "the ginza preview surfaces once as reviewable (deduped)");

console.log("company deliverables model suite passed");
process.exit(0);
