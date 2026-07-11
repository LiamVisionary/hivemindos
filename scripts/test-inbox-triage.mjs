// Hermetic suite for src/lib/services/brain/inbox-triage.ts — the report-only
// Inbox Triage brain service. Exercises the pure classifier, the self-gating
// run (disabled / already-reported / no-folders), report + audit + service-note
// writes into a throwaway tmp vault, new-item detection across runs, and the
// hard guarantees: captured files are never modified and Synthesis/ is never
// written.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  classifyInboxNote,
  runInboxTriage,
  getInboxTriageStatus,
  readInboxTriageNoteConfig,
  writeInboxTriageNoteConfig,
  INBOX_TRIAGE_RAIL_LABELS,
} = await import("../src/lib/services/brain/inbox-triage.ts");

// --- classifier -------------------------------------------------------------

{
  const task = classifyInboxNote("Inbox/hive to do.md", "- [ ] ship it\n- [x] test it\n- [ ] doc it\n");
  assert.equal(task.category, "task");

  const source = classifyInboxNote(
    "Intake/Great Article.md",
    "---\nsource: https://example.com/post\n---\n" + "long body ".repeat(500),
  );
  assert.equal(source.category, "source");
  assert.equal(source.confidence, "high");

  const idea = classifyInboxNote("Inbox/monetization strategy.md", "We could sell the report layer as a hosted add-on for teams.");
  assert.equal(idea.category, "idea");

  const memory = classifyInboxNote(
    "Intake/API budget rule.md",
    "Always consult the company budget before making paid API calls, and stop gracefully when the daily cap is reached.",
  );
  assert.equal(memory.category, "memory");

  const tiny = classifyInboxNote("Inbox/stub.md", "later");
  assert.equal(tiny.category, "review");
  assert.equal(tiny.confidence, "low");

  const binary = classifyInboxNote("Inbox/photo.png", "");
  assert.equal(binary.category, "review");

  const vague = classifyInboxNote("Inbox/notes from call.md", "Talked about the roadmap. ".repeat(60));
  assert.ok(vague.category === "review" || vague.confidence !== "high", "ambiguous note must not be high-confidence");

  assert.equal(Object.keys(INBOX_TRIAGE_RAIL_LABELS).length, 5);
  console.log("PASS classifier");
}

// --- vault fixture ----------------------------------------------------------

const vault = await mkdtemp(join(tmpdir(), "inbox-triage-vault-"));
const input = { vaultPath: vault };
try {
  await mkdir(join(vault, "Inbox"), { recursive: true });
  await mkdir(join(vault, "Intake", "Audio Transcripts"), { recursive: true });
  await mkdir(join(vault, "Synthesis", "raw"), { recursive: true });
  await writeFile(join(vault, "Inbox", "hive to do.md"), "- [ ] ship the triage service\n- [ ] write docs\n");
  await writeFile(join(vault, "Inbox", "monetization strategy.md"), "We could sell the compiled wiki as a paid tier for fleets.");
  await writeFile(join(vault, "Intake", "Cluster Article.md"), "---\nurl: https://example.com/a\n---\n" + "body ".repeat(1200));
  await writeFile(join(vault, "Intake", "Audio Transcripts", "standup.md"), "transcript body ".repeat(40));
  await writeFile(join(vault, "Inbox", "conflict sync-conflict-20260101.md"), "should be ignored entirely");
  const inboxBefore = await readFile(join(vault, "Inbox", "hive to do.md"), "utf8");

  // force run: writes report, audit, and service note
  const first = await runInboxTriage({ ...input, force: true });
  assert.equal(first.ran, true);
  assert.equal(first.itemCount, 4, "sync-conflict file must be skipped");
  assert.equal(first.newCount, 4);
  const reportDir = join(vault, "Operations", "Brain Services", "Inbox Triage");
  const report = await readFile(join(reportDir, `${first.reportDate}.md`), "utf8");
  assert.match(report, /report-only/);
  assert.match(report, /hive to do\.md/);
  assert.match(report, /Syntho candidate/);
  const audit = JSON.parse(await readFile(join(reportDir, `${first.reportDate}.json`), "utf8"));
  assert.equal(audit.itemCount, 4);
  assert.ok(audit.items.every((item) => item.rail && item.confidence && item.path), "audit items carry rail + confidence");
  const note = await readInboxTriageNoteConfig(vault);
  assert.equal(note.enabled, true);
  assert.equal(note.lastReportDate, first.reportDate);
  console.log("PASS force run writes report + audit + service note");

  // guarantees: captures untouched, Synthesis untouched
  assert.equal(await readFile(join(vault, "Inbox", "hive to do.md"), "utf8"), inboxBefore, "captured notes must never be modified");
  assert.deepEqual(await readdir(join(vault, "Synthesis", "raw")), [], "Synthesis/raw must never be written");
  console.log("PASS never modifies captures or Synthesis");

  // unforced run same day: already-reported
  const repeat = await runInboxTriage(input);
  assert.equal(repeat.ran, false);
  assert.equal(repeat.reason, "already-reported");
  console.log("PASS same-day unforced run skips (already-reported)");

  // new-item detection on a same-day forced re-run
  await writeFile(
    join(vault, "Inbox", "fresh capture.md"),
    "A brand new capture that arrived after the first report was generated, so it should be the only new item.",
  );
  const second = await runInboxTriage({ ...input, force: true });
  assert.equal(second.itemCount, 5);
  assert.equal(second.newCount, 1, "only the added file is new relative to the previous audit");
  console.log("PASS new-item detection vs previous audit");

  // disable via service note gates unforced runs
  await writeInboxTriageNoteConfig(input, { enabled: false });
  const disabled = await runInboxTriage(input);
  assert.equal(disabled.ran, false);
  assert.equal(disabled.reason, "disabled");
  const status = await getInboxTriageStatus(input);
  assert.equal(status.enabled, false);
  assert.deepEqual(status.folders, ["Inbox", "Intake"]);
  assert.equal(status.lastItemCount, 5);
  await writeInboxTriageNoteConfig(input, { enabled: true });
  console.log("PASS service-note toggle gates the run and drives status");

  // hour gate (only assertable before 23:00 local; the surrounding gates are
  // time-independent and always covered above)
  const now = new Date();
  if (now.getHours() < 23) {
    await rm(join(reportDir, `${first.reportDate}.md`));
    await writeInboxTriageNoteConfig(input, { reportHour: now.getHours() + 1 });
    const early = await runInboxTriage(input);
    assert.equal(early.ran, false);
    assert.equal(early.reason, "before-report-hour");
    console.log("PASS report-hour gate");
  } else {
    console.log("SKIP report-hour gate (local hour is 23)");
  }

  // traversal guard
  await assert.rejects(
    () => runInboxTriage({ ...input, brainServicesFolder: "../outside", force: true }),
    /relative paths inside the shared vault/,
  );
  console.log("PASS folder traversal guard");

  // vault without capture folders: quiet no-op, nothing written
  const bare = await mkdtemp(join(tmpdir(), "inbox-triage-bare-"));
  try {
    // force so the (time-dependent) hour gate can't fire first; the folders
    // check still applies in force mode.
    const none = await runInboxTriage({ vaultPath: bare, force: true });
    assert.equal(none.ran, false);
    assert.equal(none.reason, "no-inbox-folders");
    const written = await stat(join(bare, "Operations")).catch(() => null);
    assert.equal(written, null, "no-op run must not create folders");
    console.log("PASS vault without capture folders is a quiet no-op");
  } finally {
    await rm(bare, { recursive: true, force: true });
  }
} finally {
  await rm(vault, { recursive: true, force: true });
}

console.log("inbox-triage: all sections passed");
