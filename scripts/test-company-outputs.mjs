#!/usr/bin/env node
// Hermetic coverage for the per-company OUTPUT SPEC: the layer that decides what
// a company's real deliverables are (its sites / books / clips) versus the
// RESULT.md / trackers / scratch that only evidence the work (→ collapsed work
// log). This is the fix for "why do we have 80 dumb deliverables" — the board no
// longer treats every scraped path as a deliverable; it promotes the business
// output declared by the company's purpose and demotes the rest.
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { classifyDeliverable } = await import(
  "../src/features/dashboard/views/zero-human-companies/deliverables-model.ts"
);
const { outputSpecForCompany, isWorkNote } = await import(
  "../src/features/dashboard/views/zero-human-companies/company-output-spec.ts"
);

const d = (o) => ({ id: o.id ?? Math.random().toString(36).slice(2), kind: o.kind ?? "file", label: o.label, path: o.path, url: o.url });
const classOf = (spec, o) => spec.classOf(classifyDeliverable(d(o)));

// ── website agency: sites are the deliverable, everything else is work log ───
const web = outputSpecForCompany({
  sector: "Website agency",
  name: "Sarasota Sites",
  blurb: "generate websites for local businesses and email outreach offers",
  apexTitle: "Weekly Revenue",
  apexMetric: "revenue",
});
assert.equal(web.primaryLabel, "Deliverables");
assert.equal(web.comms, true, "an agency that emails outreach shows the Comms tab");
assert.equal(classOf(web, { kind: "url", label: "live Ginza preview", url: "https://sarasota-demo-pipeline.hivemindos.workers.dev/preview/ginza" }), "primary");
assert.equal(classOf(web, { kind: "url", label: "ops", url: "https://sarasota-demo-pipeline.hivemindos.workers.dev/ops" }), "worklog", "ops/status link is infra, not a deliverable");
assert.equal(classOf(web, { kind: "url", label: "pay", url: "https://buy.stripe.com/test_abc" }), "worklog", "a payment link is sales infra for a website agency, not its product");
assert.equal(classOf(web, { kind: "document", label: "RESULT.md", path: "/root/Documents/Obsidian/hivemindos-vault/Operations/Work Board/artifacts/t_x/RESULT.md" }), "worklog", "RESULT.md is the write-up, never a deliverable");
assert.equal(classOf(web, { kind: "document", label: "top25-tracker.csv", path: "/Users/liam/Documents/Obsidian/hivemindos-vault/Operations/Brain Services/top25-tracker.csv" }), "worklog", "a tracker CSV is work log");

// ── regression: task titles must NOT change the product kind (caught live) ───
// A website agency whose TASKS mention "social media" / "booking system" must
// still read as a website agency ("Deliverables"), not "Produced media", and must
// not promote its (dead) booking link to a headline output. On real maps-agency
// data, folding task titles into the product signal mislabeled the company and
// surfaced the dead cal.com link as a deliverable.
const webNoisy = outputSpecForCompany({
  sector: "Web Development",
  name: "Website Outreach Agency",
  blurb: "Autonomous web agency: finds businesses with weak websites, builds and pitches new ones.",
  apexTitle: "Earn $250k/yr shipping websites for Sarasota businesses",
  apexMetric: "Weekly Revenue",
  activityText: "engagement metrics social media analysis automated booking system nonresponder followup dispatch",
});
assert.equal(webNoisy.primaryLabel, "Deliverables", "noisy task titles (social media / booking) must not relabel a website agency");
assert.equal(webNoisy.comms, true, "an outreach agency still shows the Comms tab");
assert.equal(classOf(webNoisy, { kind: "url", label: "preview", url: "https://x.workers.dev/preview/ginza" }), "primary");
assert.equal(classOf(webNoisy, { kind: "url", label: "kickoff", url: "https://cal.com/sarasota-sites/website-kickoff" }), "worklog", "a booking link is not a website deliverable, even when tasks mention booking");

// ── ebook publisher: the chapters / books are the deliverable ────────────────
const pub = outputSpecForCompany({ sector: "Ebook publishing", name: "Quill House", blurb: "writes and publishes original books and chapters" });
assert.equal(pub.primaryLabel, "Published work");
assert.equal(pub.comms, false, "a publisher with no outreach has no Comms tab");
assert.equal(classOf(pub, { kind: "document", label: "chapter-01.md", path: "/Users/liam/Books/quill/chapter-01.md" }), "primary", "a chapter is the product for a publisher");
assert.equal(classOf(pub, { kind: "document", label: "the-full-book.pdf", path: "/Users/liam/Books/quill/the-full-book.pdf" }), "primary");
assert.equal(classOf(pub, { kind: "document", label: "outline-notes.md", path: "/Users/liam/Books/quill/outline-notes.md" }), "worklog", "notes are work log even for a publisher");
assert.equal(classOf(pub, { kind: "document", label: "RESULT.md", path: "/Users/liam/Books/quill/RESULT.md" }), "worklog");

// ── video clipper: the clips + the post links are the deliverable ────────────
const clip = outputSpecForCompany({ sector: "Video clipper", name: "ClipFarm", blurb: "auto-clips podcasts into shorts and posts them" });
assert.equal(clip.primaryLabel, "Produced media");
assert.equal(classOf(clip, { kind: "video", label: "clip-01.mp4", path: "/Users/liam/clips/clip-01.mp4" }), "primary");
assert.equal(classOf(clip, { kind: "url", label: "posted short", url: "https://youtube.com/shorts/abc123" }), "primary", "the link to where a clip went live is a deliverable for a clipper");
assert.equal(classOf(clip, { kind: "url", label: "ops", url: "https://clipfarm.example.workers.dev/status" }), "worklog", "status link stays work log even for a clipper");
assert.equal(classOf(clip, { kind: "document", label: "RESULT.md", path: "/Users/liam/clips/RESULT.md" }), "worklog");

// ── unknown company: conservative defaults ───────────────────────────────────
const misc = outputSpecForCompany({ sector: "Consulting", name: "Generic Co", blurb: "does stuff" });
assert.equal(misc.primaryLabel, "Deliverables");
assert.equal(misc.comms, false);
assert.equal(classOf(misc, { kind: "url", label: "a preview", url: "https://x.workers.dev/preview/lead" }), "primary", "a per-lead customer preview is always a headline output");
assert.equal(classOf(misc, { kind: "document", label: "RESULT.md", path: "/Users/liam/x/RESULT.md" }), "worklog");

// ── work-note guard is company-independent ───────────────────────────────────
assert.equal(isWorkNote(classifyDeliverable(d({ kind: "document", label: "RESULT.md", path: "/x/RESULT.md" }))), true);
assert.equal(isWorkNote(classifyDeliverable(d({ kind: "document", label: "chapter-02.md", path: "/x/chapter-02.md" }))), false);

console.log("company output spec suite passed");
process.exit(0);
