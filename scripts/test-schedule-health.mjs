// Hermetic suite for src/features/dashboard/schedule-health.ts — the
// brain-loop guard that flags duplicate enabled schedules and
// enabled-but-dead loops (2026-07-05 automation audit: Daily Hive Pulse
// double-fired daily for weeks; Weekly Synthesis sat enabled with no runs
// for six weeks; both were invisible).
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { computeScheduleHealthWarnings, scheduleCadenceMs, normalizedLoopKey } = await import(
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

console.log("schedule-health: all assertions green");
