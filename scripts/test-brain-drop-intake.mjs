#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { captureObsidianNote } = await import("../src/lib/services/obsidian/note-capture.ts");
const { readBoard } = await import("../src/lib/services/kanban/local-kanban-store.ts");
const {
  BRAIN_DROP_ROUTE_MATRIX,
  classifyBrainDropCapture,
  processBrainDropCapture,
  processPendingBrainDropInbox,
} = await import("../src/lib/services/brain/brain-drop-intake.ts");

const noteRouteSource = await readFile(new URL("../src/app/api/obsidian/note/route.ts", import.meta.url), "utf8");
assert.match(noteRouteSource, /processBrainDropCapture/);
assert.match(noteRouteSource, /processing/);
const triageDriverSource = await readFile(new URL("../src/lib/services/inbox-triage-driver.ts", import.meta.url), "utf8");
assert.match(triageDriverSource, /processPendingBrainDropInbox/);

assert.deepEqual(Object.keys(BRAIN_DROP_ROUTE_MATRIX), [
  "task",
  "reminder",
  "idea",
  "project",
  "resource",
  "note",
  "review",
]);
assert.deepEqual(classifyBrainDropCapture("Add tomatoes to my grocery list."), {
  category: "task",
  confidence: "high",
  reason: "action-language",
});
assert.equal(classifyBrainDropCapture("Project idea: launch a weekly research digest.").category, "project");
assert.equal(classifyBrainDropCapture("Save https://example.com/guide as a resource.").category, "resource");
assert.equal(classifyBrainDropCapture("Add launch ideas to the planning list.").category, "task");
assert.equal(classifyBrainDropCapture("Idea: make a video about local models.").category, "idea");

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-brain-drop-"));

try {
  await mkdir(join(vaultPath, "Memory"), { recursive: true });
  await writeFile(
    join(vaultPath, "Memory", "Grocery List.md"),
    "---\ntags: [home, groceries]\n---\n\n# Grocery List\n\nFood to buy.\n",
    "utf8",
  );

  const raw = await captureObsidianNote({
    vaultPath,
    content: "Add tomatoes to my grocery list.",
    source: "iphone-shortcut",
    tags: ["hivemindos-note", "voice-input"],
    idempotencyKey: "brain-drop-test-1",
    now: new Date("2026-07-16T14:30:00.000Z"),
  });
  const rawBefore = await readFile(join(vaultPath, raw.notePath), "utf8");
  const processed = await processBrainDropCapture({
    vaultPath,
    capture: raw,
    content: "Add tomatoes to my grocery list.",
    source: "iphone-shortcut",
    inputTags: ["voice-input"],
    now: new Date("2026-07-16T14:31:00.000Z"),
  });

  assert.equal(processed.category, "task");
  assert.equal(processed.confidence, "high");
  assert.equal(processed.created, true);
  assert.match(processed.routedNotePath, /^Intake\/Processed\/2026-07-16\//);
  assert.equal(await readFile(join(vaultPath, raw.notePath), "utf8"), rawBefore, "raw capture must remain immutable");

  const routedTask = await readFile(join(vaultPath, processed.routedNotePath), "utf8");
  assert.match(routedTask, /category: "task"/);
  assert.match(routedTask, /tags: \["brain-drop", "brain-drop\/task", "voice-input"/);
  assert.match(routedTask, /"source\/iphone-shortcut"/);
  assert.match(routedTask, /- \[ \] Add tomatoes to my grocery list\./);
  assert.match(routedTask, /\[\[Memory\/Grocery List\]\]/);
  assert.match(routedTask, /\[\[Intake\/2026-07-16\/2026-07-16-143000-brain-drop-test-1\|Raw capture\]\]/);

  const board = await readBoard(null, { vaultPath });
  assert.equal(board.tasks.length, 1);
  assert.equal(board.tasks[0].title, "Add tomatoes to my grocery list");
  assert.match(board.tasks[0].body, /\[\[Memory\/Grocery List\]\]/);

  const replay = await processBrainDropCapture({
    vaultPath,
    capture: raw,
    content: "Add tomatoes to my grocery list.",
    source: "iphone-shortcut",
    inputTags: ["voice-input"],
    now: new Date("2026-07-16T14:35:00.000Z"),
  });
  assert.equal(replay.created, false);
  assert.equal(replay.routedNotePath, processed.routedNotePath);
  assert.equal((await readBoard(null, { vaultPath })).tasks.length, 1);

  const uncertainRaw = await captureObsidianNote({
    vaultPath,
    content: "There was something interesting about the afternoon light.",
    source: "dashboard",
    idempotencyKey: "brain-drop-test-2",
    now: new Date("2026-07-16T15:00:00.000Z"),
  });
  const uncertain = await processBrainDropCapture({
    vaultPath,
    capture: uncertainRaw,
    content: "There was something interesting about the afternoon light.",
    source: "dashboard",
    now: new Date("2026-07-16T15:01:00.000Z"),
    classifyWithModel: async () => {
      throw new Error("model unavailable");
    },
  });
  assert.equal(uncertain.category, "review");
  assert.equal(uncertain.confidence, "low");
  assert.match(uncertain.routedNotePath, /^Intake\/Review\/2026-07-16\//);
  assert.equal((await readBoard(null, { vaultPath })).tasks.length, 1);

  const projectRaw = await captureObsidianNote({
    vaultPath,
    content: "A recurring format for exploring new tools with the team.",
    source: "dashboard",
    idempotencyKey: "brain-drop-test-3",
    now: new Date("2026-07-16T16:00:00.000Z"),
  });
  const project = await processBrainDropCapture({
    vaultPath,
    capture: projectRaw,
    content: "A recurring format for exploring new tools with the team.",
    source: "dashboard",
    now: new Date("2026-07-16T16:01:00.000Z"),
    classifyWithModel: async () => ({
      category: "project",
      confidence: "high",
      reason: "multi-step-outcome",
      title: "Team tool exploration",
      cleanedContent: "Create a recurring format for exploring new tools with the team.",
      tags: ["team", "tooling", "bad tag!"],
    }),
  });
  assert.match(project.routedNotePath, /^Projects\/2026-07-16-/);
  const projectMarkdown = await readFile(join(vaultPath, project.routedNotePath), "utf8");
  assert.match(projectMarkdown, /# Team tool exploration/);
  assert.match(projectMarkdown, /"team", "tooling"/);
  assert.doesNotMatch(projectMarkdown, /bad tag!/);

  await mkdir(join(vaultPath, "Inbox"), { recursive: true });
  // Routed filenames date from the note's `created:` frontmatter (falling back to
  // file mtime, which is the real wall clock) — pin it so the assertion below
  // stays deterministic on any day the suite runs.
  await writeFile(
    join(vaultPath, "Inbox", "Loose idea.md"),
    "---\ncreated: 2026-07-16T16:59:00.000Z\n---\n# Idea\n\nWhat if we made onboarding visual?\n",
    "utf8",
  );
  const pending = await processPendingBrainDropInbox({
    vaultPath,
    now: new Date("2026-07-16T17:00:00.000Z"),
  });
  assert.equal(pending.processed, 1);
  assert.equal(pending.results[0].category, "idea");
  assert.match(pending.results[0].routedNotePath, /^Ideas\/2026-07-16-/);

  const pendingReplay = await processPendingBrainDropInbox({
    vaultPath,
    now: new Date("2026-07-16T17:05:00.000Z"),
  });
  assert.equal(pendingReplay.processed, 0);
  assert.ok(pendingReplay.skipped >= 1);

  // A prebuilt graph must be used as-is instead of forcing a fresh vault
  // scan: the phantom node below has no backing file, so it can only appear
  // in the related list if the prebuilt graph was consulted.
  const phantomRaw = await captureObsidianNote({
    vaultPath,
    content: "Remember that the phantom signal archive is worth studying.",
    source: "dashboard",
    idempotencyKey: "brain-drop-test-prebuilt",
    now: new Date("2026-07-16T18:00:00.000Z"),
  });
  const phantomProcessed = await processBrainDropCapture({
    vaultPath,
    capture: phantomRaw,
    content: "Remember that the phantom signal archive is worth studying.",
    source: "dashboard",
    now: new Date("2026-07-16T18:01:00.000Z"),
    prebuiltGraph: {
      nodes: [{
        id: "Memory/Phantom Signal Archive.md",
        label: "Phantom Signal Archive",
        tags: [],
        preview: "phantom signal archive of unexplained transmissions",
      }],
      links: [],
    },
  });
  assert.deepEqual(phantomProcessed.relatedNotePaths, ["Memory/Phantom Signal Archive.md"],
    "processBrainDropCapture must honor an injected prebuilt graph");

  // Batch processing builds the graph once up front: a note routed earlier in
  // the same batch must NOT appear in a later capture's related list (a
  // per-capture forced rebuild would have picked it up), while pre-existing
  // vault notes still relate normally.
  await writeFile(
    join(vaultPath, "Memory", "Quantum Observatory.md"),
    "---\ntags: [research]\n---\n\n# Quantum Observatory\n\nQuantum hummingbird telescope research notes.\n",
    "utf8",
  );
  await writeFile(
    join(vaultPath, "Inbox", "Zz quantum first.md"),
    "---\ncreated: 2026-07-16T19:00:00.000Z\n---\n\nIdea: quantum hummingbird telescope prototype.\n",
    "utf8",
  );
  await writeFile(
    join(vaultPath, "Inbox", "Aa quantum second.md"),
    "---\ncreated: 2026-07-16T19:01:00.000Z\n---\n\nIdea: quantum hummingbird telescope shed.\n",
    "utf8",
  );
  const batch = await processPendingBrainDropInbox({
    vaultPath,
    now: new Date("2026-07-16T19:05:00.000Z"),
  });
  assert.equal(batch.processed, 2);
  const [batchFirst, batchSecond] = batch.results;
  assert.match(batchFirst.title, /prototype/);
  assert.match(batchSecond.title, /shed/);
  assert.ok(batchFirst.relatedNotePaths.includes("Memory/Quantum Observatory.md"),
    "batch captures still relate against the shared prebuilt graph");
  assert.ok(batchSecond.relatedNotePaths.includes("Memory/Quantum Observatory.md"));
  assert.ok(!batchSecond.relatedNotePaths.some((path) => path.startsWith("Ideas/") && path.includes("prototype")),
    "one graph serves the whole batch, so intra-batch routed notes are not rebuilt into it");

  console.log("Brain Drop intake classification, cleanup, routing, linking, review, idempotency, and batch-graph checks passed.");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}
