#!/usr/bin/env node
// Hermetic coverage for the company task watchdog (stopped-subtree verification):
// - a company with ready/working tasks is live, never reviewed
// - a freshly created task holds the company live through the first-run grace window
// - an all-clean stop (evidence-backed done + operator-parked asks) settles without a review
// - a done task with NO evidence makes the stop suspicious and reviewable
// - an unanswered Needs You ask is ordinary backpressure inside the grace window and
//   suspicious past it (the watchdog must not nag on every question a company asks)
// - an ideas task whose parents all finished is a promotion failure, and one with an
//   unfinished parent is not
// - the stop fingerprint is stable across re-evaluation and suppresses a repeat review,
//   but a CHANGED rest set produces a new fingerprint and a fresh review
// - the review ledger round-trips and survives a corrupt file
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-watchdog-home-"));
process.env.HOME = tempHome;

const {
  classifyCompanyStopState,
  computeStopFingerprint,
  hasCompletionEvidence,
  buildStopVerificationBrief,
  isWatchdogOriginTask,
  watchdogTaskSource,
  DEFAULT_UNANSWERED_ASK_GRACE_MS,
} = await import("../src/lib/services/company-task-watchdog.ts");

const store = await import("../src/lib/services/company-task-watchdog-store.ts");

const COMPANY = "c_test";
const NOW = 1_800_000_000_000;
// Comfortably older than the first-run grace window so tasks are not held live.
const OLD = NOW - 86_400_000;

function task(overrides) {
  return {
    id: "t_1",
    title: "Task",
    body: "",
    status: "done",
    priority: "normal",
    workspace: "scratch",
    skills: [],
    source: `company:${COMPANY}:run1`,
    createdAt: OLD,
    updatedAt: OLD,
    ...overrides,
  };
}

// ---------------------------------------------------------------- liveness
{
  const live = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [task({ id: "a", status: "working" }), task({ id: "b", status: "done", result: "shipped" })],
    now: NOW,
  });
  assert.equal(live.state, "live", "a working task keeps the company live");

  const ready = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [task({ id: "a", status: "ready" })],
    now: NOW,
  });
  assert.equal(ready.state, "live", "a ready task keeps the company live");
}

// Tasks belonging to ANOTHER company must not make this one look live.
{
  const result = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [
      task({ id: "a", status: "done", result: "shipped" }),
      task({ id: "b", status: "working", source: "company:c_other:run1" }),
    ],
    now: NOW,
  });
  assert.notEqual(result.state, "live", "another company's working task must not count as our live work");
}

{
  const none = classifyCompanyStopState({ companyId: COMPANY, tasks: [], now: NOW });
  assert.equal(none.state, "not_applicable", "no company tasks means nothing to watch");
}

// --------------------------------------------------------- first-run grace
{
  const fresh = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [task({ id: "a", status: "ideas", createdAt: NOW - 1_000 })],
    now: NOW,
  });
  assert.equal(fresh.state, "live", "a just-created task holds the company live through the grace window");
}

// ------------------------------------------------------------- clean stops
{
  const settled = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [
      task({ id: "a", status: "done", result: "Shipped the landing page." }),
      task({ id: "b", status: "archived", deliverables: [{ id: "d1", label: "site", kind: "url", createdAt: OLD }] }),
      task({ id: "c", status: "needs-human", held: { at: OLD, by: "liam" } }),
    ],
    now: NOW,
  });
  assert.equal(settled.state, "settled", "evidence-backed finishes plus a parked ask is a clean stop");
  assert.ok(settled.stopFingerprint, "a settled stop still carries a fingerprint");
}

// -------------------------------------------------- done without evidence
{
  const stopped = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [task({ id: "a", status: "done" })],
    now: NOW,
  });
  assert.equal(stopped.state, "stopped", "a done task with no evidence is worth verifying");
  assert.equal(stopped.suspiciousLeaves.length, 1);
  assert.equal(stopped.suspiciousLeaves[0].reason, "completed-without-evidence");
}

assert.equal(hasCompletionEvidence({ result: "  " }), false, "whitespace is not evidence");
assert.equal(hasCompletionEvidence({ result: "done" }), true);
assert.equal(hasCompletionEvidence({ proofs: [{}] }), true);
assert.equal(hasCompletionEvidence({ evaluation: { ok: true } }), true);
assert.equal(hasCompletionEvidence({ deliverables: [] }), false, "an empty deliverable list is not evidence");

// ------------------------------------------------- unanswered human asks
{
  const recentAsk = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [
      task({ id: "a", status: "done", result: "ok" }),
      task({ id: "b", status: "needs-human", updatedAt: NOW - 60_000 }),
    ],
    now: NOW,
  });
  assert.equal(recentAsk.state, "settled", "a fresh unanswered ask is backpressure, not a defect");

  const staleAsk = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [
      task({ id: "a", status: "done", result: "ok" }),
      task({ id: "b", status: "needs-human", updatedAt: NOW - DEFAULT_UNANSWERED_ASK_GRACE_MS - 1 }),
    ],
    now: NOW,
  });
  assert.equal(staleAsk.state, "stopped", "an ask left unanswered past the grace window is worth verifying");
  assert.equal(staleAsk.suspiciousLeaves[0].reason, "awaiting-human-stale");
}

// ------------------------------------------------------ backlog promotion
{
  const links = [{ parentId: "p", childId: "c", createdAt: OLD }];
  const unpromoted = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [task({ id: "p", status: "done", result: "ok" }), task({ id: "c", status: "ideas" })],
    links,
    now: NOW,
  });
  assert.equal(unpromoted.state, "stopped", "a backlog item whose parents all finished should have been promoted");
  assert.equal(unpromoted.suspiciousLeaves[0].reason, "unpromoted-backlog");

  const stillBlocked = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [task({ id: "p", status: "needs-human", held: { at: OLD, by: "liam" } }), task({ id: "c", status: "ideas" })],
    links,
    now: NOW,
  });
  assert.equal(stillBlocked.state, "settled", "a backlog item with an unfinished parent is genuinely blocked");
}

// -------------------------------------------- watchdog tasks are not watched
// Without this the watchdog feeds itself: its own verification task finishes,
// joins the rest set, changes the fingerprint, and triggers another review.
{
  const watchdogSource = watchdogTaskSource(COMPANY, "fp-abc");
  assert.ok(isWatchdogOriginTask({ source: watchdogSource }), "watchdog source is recognised");
  assert.equal(isWatchdogOriginTask({ source: `company:${COMPANY}:run1` }), false);

  const live = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [
      task({ id: "a", status: "done" }),
      task({ id: "w", status: "working", source: watchdogSource }),
    ],
    now: NOW,
  });
  assert.equal(live.state, "live", "a running verification task keeps the company live");

  const finished = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [
      task({ id: "a", status: "done", result: "shipped" }),
      task({ id: "w", status: "done", source: watchdogSource }),
    ],
    now: NOW,
  });
  assert.equal(
    finished.state,
    "settled",
    "a finished verification task with no evidence must NOT itself become a suspicious leaf",
  );

  const onlyWatchdog = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [task({ id: "w", status: "done", source: watchdogSource })],
    now: NOW,
  });
  assert.equal(onlyWatchdog.state, "not_applicable", "a company whose only resting task is a watchdog has nothing to watch");
}

// -------------------------------------------------------- fingerprinting
{
  const tasks = [task({ id: "a", status: "done" })];
  const first = classifyCompanyStopState({ companyId: COMPANY, tasks, now: NOW });
  const again = classifyCompanyStopState({ companyId: COMPANY, tasks, now: NOW + 5_000 });
  assert.equal(first.stopFingerprint, again.stopFingerprint, "the same rest set fingerprints identically over time");

  const suppressed = classifyCompanyStopState({
    companyId: COMPANY,
    tasks,
    now: NOW,
    reviewedFingerprint: first.stopFingerprint,
  });
  assert.equal(suppressed.state, "reviewed", "an already-reviewed stop is not re-reviewed");

  const changed = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [...tasks, task({ id: "b", status: "done" })],
    now: NOW,
    reviewedFingerprint: first.stopFingerprint,
  });
  assert.equal(changed.state, "stopped", "a changed rest set is a new stop and gets a fresh review");
  assert.notEqual(changed.stopFingerprint, first.stopFingerprint);
}

// Fingerprint must not depend on leaf ordering.
{
  const a = { taskId: "1", status: "done", reason: "completed-without-evidence", suspicious: true };
  const b = { taskId: "2", status: "needs-human", reason: "awaiting-human-stale", suspicious: true };
  assert.equal(computeStopFingerprint([a, b]), computeStopFingerprint([b, a]), "fingerprint is order-independent");
}

// ---------------------------------------------------------------- brief
{
  const stopped = classifyCompanyStopState({
    companyId: COMPANY,
    tasks: [task({ id: "a", status: "done", title: "Publish site" })],
    now: NOW,
  });
  const brief = buildStopVerificationBrief({
    companyName: "Acme",
    apexGoal: "10 paying customers",
    classification: stopped,
  });
  assert.match(brief, /Acme has stopped/);
  assert.match(brief, /Publish site/);
  assert.match(brief, /Verify, do not execute/, "the brief must forbid the verifier doing the work itself");
  assert.match(brief, /not evidence/, "the brief must forbid rubber-stamping an unevidenced completion");
}

// ---------------------------------------------------------------- ledger
{
  assert.equal(await store.readCompanyWatchdogReview(COMPANY), null, "no review recorded yet");

  const first = await store.recordCompanyWatchdogReview(COMPANY, {
    stopFingerprint: "fp1",
    verificationTaskId: "t_v1",
  });
  assert.equal(first.reviewCount, 1);
  assert.equal((await store.readCompanyWatchdogReview(COMPANY)).stopFingerprint, "fp1");

  const second = await store.recordCompanyWatchdogReview(COMPANY, { stopFingerprint: "fp2" });
  assert.equal(second.reviewCount, 2, "review count accumulates across distinct stops");

  // Concurrent writes in one tick must not clobber each other.
  await Promise.all([
    store.recordCompanyWatchdogReview("c_a", { stopFingerprint: "a" }),
    store.recordCompanyWatchdogReview("c_b", { stopFingerprint: "b" }),
  ]);
  assert.ok(await store.readCompanyWatchdogReview("c_a"), "concurrent write c_a survived");
  assert.ok(await store.readCompanyWatchdogReview("c_b"), "concurrent write c_b survived");

  await store.clearCompanyWatchdogReview(COMPANY);
  assert.equal(await store.readCompanyWatchdogReview(COMPANY), null, "cleared review is gone");

  // A corrupt ledger must read as "nothing reviewed", never throw — failing closed
  // here would permanently suppress the watchdog.
  await writeFile(store.COMPANY_WATCHDOG_PATH, "{not json", "utf8");
  assert.equal(await store.readCompanyWatchdogReview(COMPANY), null, "corrupt ledger degrades to empty");
}

console.log("PASS test-company-task-watchdog");
