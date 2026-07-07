// Hermetic suite for src/features/dashboard/schedule-health.ts — the
// brain-loop guard that flags duplicate enabled schedules and
// enabled-but-dead loops (2026-07-05 automation audit: Daily Hive Pulse
// double-fired daily for weeks; Weekly Synthesis sat enabled with no runs
// for six weeks; both were invisible).
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { computeScheduleHealthWarnings, scheduleCadenceMs, normalizedLoopKey, scheduleLoopSignature, dedupeSchedulesByLoop, scheduleHealthWarningKey, visibleScheduleHealthWarnings, scheduleOwnerId, dropOrphanScheduleRows, collapseAllMachinesReplicas, reconcileReachedOwners } = await import(
  "../src/features/dashboard/schedule-health.ts"
);

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function schedule(overrides) {
  return {
    id: overrides.id ?? overrides.name,
    name: "Loop",
    agentId: "a1",
    enabled: true,
    every: "daily 08:00",
    mode: "prompt",
    prompt: "",
    skills: [],
    paths: [],
    steps: [],
    createdAt: NOW - 90 * DAY,
    updatedAt: NOW - 90 * DAY,
    ...overrides,
  };
}

// --- cadence parsing -------------------------------------------------------
assert.equal(scheduleCadenceMs("daily 06:00"), DAY);
assert.equal(scheduleCadenceMs("weekly Sunday 20:00"), 7 * DAY);
assert.equal(scheduleCadenceMs("monthly first Sunday 19:00"), 30 * DAY);
assert.equal(scheduleCadenceMs("every 15 minutes"), 15 * 60_000);
assert.equal(scheduleCadenceMs("every 2 hours"), 2 * 3_600_000);
assert.equal(scheduleCadenceMs("0 8 * * *"), DAY, "daily cron");
assert.equal(scheduleCadenceMs("30 5 * * 1"), 7 * DAY, "weekly cron");
assert.equal(scheduleCadenceMs("manual"), null);
assert.equal(scheduleCadenceMs(""), null);
console.log("PASS cadence parsing");

// --- duplicate detection ----------------------------------------------------
const dupWarnings = computeScheduleHealthWarnings([
  schedule({ id: "a", name: "Daily Hive Pulse", lastRunAt: NOW - DAY / 2 }),
  schedule({ id: "b", name: "Daily-Hive-Pulse — Base & AI Agents", lastRunAt: NOW - DAY / 2 }),
  schedule({ id: "c", name: "Weekly Synthesis", every: "weekly Monday 05:30", lastRunAt: NOW - DAY }),
], NOW);
const dup = dupWarnings.find((w) => w.kind === "duplicate");
assert.ok(dup, "prefix-related enabled loops flagged as duplicates");
assert.deepEqual([...dup.scheduleIds].sort(), ["a", "b"]);
assert.ok(!dupWarnings.some((w) => w.kind === "duplicate" && w.scheduleIds.includes("c")), "unrelated loop not grouped");
console.log("PASS duplicate detection");

// disabled twins are not duplicates
const disabledTwin = computeScheduleHealthWarnings([
  schedule({ id: "a", name: "Daily Hive Pulse", lastRunAt: NOW - DAY / 2 }),
  schedule({ id: "b", name: "Daily Hive Pulse", enabled: false }),
], NOW);
assert.ok(!disabledTwin.some((w) => w.kind === "duplicate"), "disabled twin ignored");
console.log("PASS disabled twin ignored");

// --- staleness --------------------------------------------------------------
const staleWarnings = computeScheduleHealthWarnings([
  schedule({ id: "fresh", name: "Fresh Daily", lastRunAt: NOW - DAY / 2 }),
  schedule({ id: "stale", name: "Dead Weekly", every: "weekly Monday 05:30", lastRunAt: NOW - 45 * DAY }),
  schedule({ id: "never", name: "Zombie Import", every: "every 15 minutes", lastRunAt: undefined, updatedAt: NOW - 30 * DAY }),
  schedule({ id: "manual", name: "Manual Thing", every: "manual", lastRunAt: undefined }),
  schedule({ id: "off", name: "Disabled Dead", enabled: false, lastRunAt: NOW - 60 * DAY }),
], NOW);
assert.ok(staleWarnings.some((w) => w.kind === "stale" && w.scheduleIds.includes("stale")), "45d-old weekly flagged");
assert.ok(staleWarnings.some((w) => w.kind === "never-ran" && w.scheduleIds.includes("never")), "run-less 15m loop flagged");
assert.ok(!staleWarnings.some((w) => w.scheduleIds.includes("fresh")), "fresh loop clean");
assert.ok(!staleWarnings.some((w) => w.scheduleIds.includes("manual")), "manual cadence skipped");
assert.ok(!staleWarnings.some((w) => w.scheduleIds.includes("off")), "disabled loop skipped");
console.log("PASS staleness detection");

// --- normalization ----------------------------------------------------------
assert.equal(normalizedLoopKey("Daily Hive Pulse — Base & AI Agents"), "daily-hive-pulse-base-ai-agents");
console.log("PASS normalization");

// --- loop signature ---------------------------------------------------------
// The machine-identity segment in externalJobId differs across hostname renames
// but the trailing job id + name are stable, so the signature collapses forks.
assert.equal(
  scheduleLoopSignature(schedule({
    name: "Mac memory pressure watchdog",
    externalSource: "hermes",
    externalJobId: "hermes:hermes-liams-macbook-pro-nyc:jobs.json:567853dca5a5",
  })),
  scheduleLoopSignature(schedule({
    name: "Mac memory pressure watchdog",
    externalSource: "hermes",
    externalJobId: "hermes:hermes-liamsmbp481146-lan:jobs.json:567853dca5a5",
  })),
  "hostname-forked rows of the same cron share a signature",
);
assert.notEqual(
  scheduleLoopSignature(schedule({ name: "Daily Hive Pulse", externalSource: "hermes", externalJobId: "hermes:x:jobs.json:be00d36360d6" })),
  scheduleLoopSignature(schedule({ name: "Daily Hive Pulse", externalSource: "hermes", externalJobId: "hermes:x:jobs.json:6ad8903df25a" })),
  "genuinely different jobs (different job ids) keep distinct signatures",
);
// dashboard-native schedules (no externalJobId) are never collapsed together
assert.notEqual(
  scheduleLoopSignature(schedule({ id: "n1", name: "Native", externalJobId: undefined })),
  scheduleLoopSignature(schedule({ id: "n2", name: "Native", externalJobId: undefined })),
  "native schedules without a job id fall back to their own id",
);
console.log("PASS loop signature");

// --- dedupe by loop ---------------------------------------------------------
// Reproduces the real state: 5 enabled watchdog rows, same underlying job
// 567853dca5a5, forked across machine identities, none with a recorded run
// except one — the survivor keeps the newest run stamp and there's only one row.
const watchdogForks = [9602, 333970, 390104, 481146, "nyc"].map((seg, index) => schedule({
  id: `wd-${seg}`,
  name: "Mac memory pressure watchdog",
  every: "every 15m",
  externalSource: "hermes",
  externalJobId: `hermes:hermes-liams-macbook-pro-${seg}:jobs.json:567853dca5a5`,
  updatedAt: NOW - (5 - index) * DAY, // "nyc" is freshest
  lastRunAt: seg === 481146 ? NOW - DAY : undefined, // a non-freshest fork holds the only run stamp
}));
const dedupedWatchdog = dedupeSchedulesByLoop(watchdogForks);
assert.equal(dedupedWatchdog.length, 1, "5 forked watchdog rows collapse to 1");
assert.equal(dedupedWatchdog[0].id, "wd-nyc", "freshest (live) identity wins");
assert.equal(dedupedWatchdog[0].lastRunAt, NOW - DAY, "newest run stamp carried onto the survivor");

// dedupe is applied inside computeScheduleHealthWarnings' caller, but verify the
// warning set on deduped input no longer double-counts.
const cleaned = dedupeSchedulesByLoop([
  schedule({ id: "p1", name: "Daily Hive Pulse — Base & AI Agents", externalSource: "hermes", externalJobId: "hermes:a:jobs.json:6ad8903df25a", updatedAt: NOW - DAY }),
  schedule({ id: "p2", name: "Daily Hive Pulse — Base & AI Agents", externalSource: "hermes", externalJobId: "hermes:b:jobs.json:6ad8903df25a", updatedAt: NOW - 3 * DAY }),
]);
assert.equal(cleaned.length, 1, "2 forked pulse rows collapse to 1");
assert.equal(cleaned[0].id, "p1", "fresher pulse row kept");
console.log("PASS dedupe by loop");

// --- dismiss (banner) ------------------------------------------------------
// The banner dismiss stores a warning's key; a dismissed warning stays hidden
// while a genuinely different one still surfaces.
const bannerWarnings = computeScheduleHealthWarnings([
  schedule({ id: "d1", name: "Daily Hive Pulse", lastRunAt: NOW - DAY / 2 }),
  schedule({ id: "d2", name: "Daily Hive Pulse — Base & AI Agents", lastRunAt: NOW - DAY / 2 }),
  schedule({ id: "z1", name: "Zombie Import", every: "every 15 minutes", lastRunAt: undefined, updatedAt: NOW - 30 * DAY }),
], NOW);
const dupWarn = bannerWarnings.find((w) => w.kind === "duplicate");
const neverWarn = bannerWarnings.find((w) => w.kind === "never-ran");
assert.ok(dupWarn && neverWarn, "banner has both a duplicate and a never-ran warning");
// key is stable and matches the React key format
assert.equal(scheduleHealthWarningKey(neverWarn), `never-ran-${neverWarn.scheduleIds.join("-")}`);
// dismissing the never-ran warning hides exactly it
const dismissed = new Set([scheduleHealthWarningKey(neverWarn)]);
const visible = visibleScheduleHealthWarnings(bannerWarnings, dismissed);
assert.ok(!visible.some((w) => scheduleHealthWarningKey(w) === scheduleHealthWarningKey(neverWarn)), "dismissed warning hidden");
assert.ok(visible.some((w) => w.kind === "duplicate"), "undismissed warning still shows");
assert.equal(bannerWarnings.length - visible.length, 1, "exactly one hidden");
// empty dismissed set shows everything; unknown keys are ignored
assert.equal(visibleScheduleHealthWarnings(bannerWarnings, new Set()).length, bannerWarnings.length);
assert.equal(visibleScheduleHealthWarnings(bannerWarnings, new Set(["nope"])).length, bannerWarnings.length);
console.log("PASS dismiss filtering");

// --- owner parsing + orphan purge ------------------------------------------
assert.equal(
  scheduleOwnerId(schedule({ externalJobId: "hermes:hermes-liams-macbook-pro-333970-local:jobs.json:231a093bddfc" })),
  "hermes-liams-macbook-pro-333970-local",
);
assert.equal(scheduleOwnerId(schedule({ id: "native", externalJobId: undefined })), null, "dashboard-native has no owner");
// resume-anima's dead identity is dropped; the live This-Mac + emerson pulses survive
const orphanInput = [
  schedule({ id: "o1", name: "resume-anima", externalSource: "hermes", externalJobId: "hermes:hermes-liams-macbook-pro-333970-local:jobs.json:231a093bddfc" }),
  schedule({ id: "o2", name: "Daily Hive Pulse — Base & AI Agents", externalSource: "hermes", externalJobId: "hermes:hermes-liams-macbook-pro:jobs.json:6ad8903df25a" }),
  schedule({ id: "o3", name: "Daily Hive Pulse", externalSource: "hermes", externalJobId: "hermes:hermes-emerson-c023b7:jobs.json:be00d36360d6" }),
  schedule({ id: "o4", name: "Native loop", externalJobId: undefined }),
];
const known = new Set(["hermes-liams-macbook-pro", "hermes-emerson-c023b7"]);
const purged = dropOrphanScheduleRows(orphanInput, known);
assert.deepEqual(purged.map((s) => s.id).sort(), ["o2", "o3", "o4"], "dead-owner row dropped, live + native kept");
// safety: empty known set never prunes (unpopulated fleet snapshot)
assert.equal(dropOrphanScheduleRows(orphanInput, new Set()).length, orphanInput.length, "empty fleet never prunes");
console.log("PASS orphan purge");

// --- machine-aware duplicates (run-on-all-machines) ------------------------
// Two machine-copies of a run-on-all-machines loop collapse to one → NOT a duplicate.
const replicaWarnings = computeScheduleHealthWarnings([
  schedule({ id: "r1", name: "Fleet Heartbeat", runOnAllMachines: true, lastRunAt: NOW - DAY / 2 }),
  schedule({ id: "r2", name: "Fleet Heartbeat", runOnAllMachines: true, lastRunAt: NOW - DAY / 2 }),
  schedule({ id: "r3", name: "Fleet Heartbeat", runOnAllMachines: true, lastRunAt: NOW - DAY / 2 }),
], NOW);
assert.ok(!replicaWarnings.some((w) => w.kind === "duplicate"), "run-on-all-machines replicas are not duplicates");
// Two machine-PINNED copies of the same name still surface as a duplicate.
const pinnedWarnings = computeScheduleHealthWarnings([
  schedule({ id: "p1", name: "Fleet Heartbeat", lastRunAt: NOW - DAY / 2 }),
  schedule({ id: "p2", name: "Fleet Heartbeat", lastRunAt: NOW - DAY / 2 }),
], NOW);
assert.ok(pinnedWarnings.some((w) => w.kind === "duplicate"), "pinned same-name copies still flagged");
assert.equal(collapseAllMachinesReplicas([
  schedule({ id: "a", name: "X", runOnAllMachines: true }),
  schedule({ id: "b", name: "X", runOnAllMachines: true }),
]).length, 1, "collapse keeps one representative");
console.log("PASS machine-aware duplicates");

// --- reconcile against a reached collector ---------------------------------
// The emerson ghost: a live owner (emerson-c023b7) whose cron was deleted. When
// that owner is reached but doesn't report the job, drop it; leave unreached
// owners and native schedules alone.
const reconInput = [
  schedule({ id: "g1", name: "Daily Hive Pulse", externalSource: "hermes", externalJobId: "hermes:hermes-emerson-c023b7:jobs.json:be00d36360d6" }),
  schedule({ id: "g2", name: "Obsidian Briefing", externalSource: "hermes", externalJobId: "hermes:hermes-emerson-c023b7:jobs.json:0d380e1ba5ac" }),
  schedule({ id: "g3", name: "On Offline Box", externalSource: "hermes", externalJobId: "hermes:hermes-nyc:jobs.json:aaa111" }),
  schedule({ id: "g4", name: "Native", externalJobId: undefined }),
];
const reached = new Set(["hermes-emerson-c023b7"]); // only emerson's collector answered
const fresh = new Set(["hermes:hermes:hermes-emerson-c023b7:jobs.json:0d380e1ba5ac"]); // it reported only the briefing
const reconciled = reconcileReachedOwners(reconInput, reached, fresh);
assert.deepEqual(reconciled.map((s) => s.id).sort(), ["g2", "g3", "g4"], "deleted emerson cron dropped; live one, offline-box row, native kept");
assert.equal(reconcileReachedOwners(reconInput, new Set(), fresh).length, reconInput.length, "no reached owners → no pruning");
console.log("PASS reconcile reached owners");

console.log("schedule-health: all assertions green");
