#!/usr/bin/env node
// Hermetic coverage for the fleet watchdog's escalation path — the guard
// against the 2026-07-03 NYC incident, where the watchdog kickstart-looped a
// machine-wide MLX synth deadlock for hours without telling anyone. Policy is
// tested behaviorally via scripts/lib/fleet-watchdog-escalation.mjs; the
// watchdog's wiring is guarded by source-contract checks (importing the
// watchdog would start its probe loop, so it is read, not run).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createEscalationTracker, formatEscalationAlert } from "./lib/fleet-watchdog-escalation.mjs";

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${label}`);
}

check("no escalation before the failure threshold", () => {
  const tracker = createEscalationTracker({ threshold: 3, repeatMs: 100 });
  tracker.recordSevereFailure("tts", "synth returned 0B");
  tracker.recordRemediationAttempt("tts");
  assert.equal(tracker.escalationDue("tts", 1_000), null);
  tracker.recordSevereFailure("tts", "synth returned 0B");
  tracker.recordRemediationAttempt("tts");
  assert.equal(tracker.escalationDue("tts", 1_010), null);
});

check("no escalation without at least one remediation attempt", () => {
  const tracker = createEscalationTracker({ threshold: 2, repeatMs: 100 });
  tracker.recordSevereFailure("tts", "synth failed: timeout");
  tracker.recordSevereFailure("tts", "synth failed: timeout");
  assert.equal(tracker.escalationDue("tts", 1_000), null);
  tracker.recordRemediationAttempt("tts");
  assert.ok(tracker.escalationDue("tts", 1_010), "escalates once a restart has been tried and failed to fix it");
});

check("escalates at the threshold with streak, attempts, and the latest error", () => {
  const tracker = createEscalationTracker({ threshold: 3, repeatMs: 100 });
  tracker.recordSevereFailure("tts", "first error");
  tracker.recordRemediationAttempt("tts");
  tracker.recordSevereFailure("tts", "second error");
  tracker.recordRemediationAttempt("tts");
  tracker.recordSevereFailure("tts", "synth returned 44B (backend wedged)");
  tracker.recordRemediationAttempt("tts");
  const due = tracker.escalationDue("tts", 1_000);
  assert.deepEqual(due, { streak: 3, remediations: 3, reason: "synth returned 44B (backend wedged)" });
});

check("repeat escalations are time-gated while the target stays wedged", () => {
  const tracker = createEscalationTracker({ threshold: 2, repeatMs: 100 });
  tracker.recordSevereFailure("tts", "wedged");
  tracker.recordRemediationAttempt("tts");
  tracker.recordSevereFailure("tts", "wedged");
  tracker.recordRemediationAttempt("tts");
  assert.ok(tracker.escalationDue("tts", 1_000), "first escalation fires at the threshold");
  tracker.recordSevereFailure("tts", "still wedged");
  assert.equal(tracker.escalationDue("tts", 1_050), null, "inside the repeat window: stay quiet");
  tracker.recordSevereFailure("tts", "still wedged");
  const repeat = tracker.escalationDue("tts", 1_100);
  assert.ok(repeat, "re-escalates after the repeat window while still failing");
  assert.equal(repeat.streak, 4, "streak keeps counting across escalations");
});

check("keys are independent — one wedged machine does not escalate another", () => {
  const tracker = createEscalationTracker({ threshold: 2, repeatMs: 100 });
  tracker.recordSevereFailure("tts:nyc", "wedged");
  tracker.recordRemediationAttempt("tts:nyc");
  tracker.recordSevereFailure("tts:nyc", "wedged");
  tracker.recordSevereFailure("tts:vps", "one blip");
  assert.ok(tracker.escalationDue("tts:nyc", 1_000));
  assert.equal(tracker.escalationDue("tts:vps", 1_000), null);
});

check("deep recovery clears the streak and reports whether it had escalated", () => {
  const tracker = createEscalationTracker({ threshold: 2, repeatMs: 100 });
  tracker.recordSevereFailure("tts", "wedged");
  tracker.recordRemediationAttempt("tts");
  tracker.recordSevereFailure("tts", "wedged");
  assert.ok(tracker.escalationDue("tts", 1_000));
  const recovery = tracker.recordDeepRecovery("tts");
  assert.deepEqual(recovery, { wasEscalated: true, streak: 2 });
  assert.deepEqual(tracker.recordDeepRecovery("tts"), { wasEscalated: false, streak: 0 }, "already clean is a no-op");
  tracker.recordSevereFailure("tts", "wedged again");
  tracker.recordRemediationAttempt("tts");
  assert.equal(tracker.escalationDue("tts", 2_000), null, "a fresh streak starts from 1 after recovery");
});

check("alert text names the machine, service, counts, and probe error", () => {
  const text = formatEscalationAlert({
    name: "hivemindos-liams-macbook-pro-1 TTS",
    kind: "tts",
    streak: 3,
    remediations: 3,
    reason: "synth returned 44B (backend wedged)",
  });
  assert.match(text, /hivemindos-liams-macbook-pro-1 TTS/);
  assert.match(text, /failed 3 consecutive checks/);
  assert.match(text, /3 restart attempts/);
  assert.match(text, /synth returned 44B \(backend wedged\)/);
  assert.match(formatEscalationAlert({ name: "m", kind: "tts", streak: 3, remediations: 1, reason: "r" }), /1 restart attempt[^s]/);
});

// --- Watchdog wiring contract (source-anchored; the script cannot be imported
// without starting its probe loop) ---
const watchdog = readFileSync(new URL("./fleet-health-watchdog.mjs", import.meta.url), "utf8");

check("watchdog wires the tracker through failure, remediation, recovery, and escalation", () => {
  assert.match(watchdog, /createEscalationTracker\(\{ threshold: ESCALATE_AFTER, repeatMs: ESCALATE_REPEAT_MS \}\)/);
  assert.match(watchdog, /escalations\.recordSevereFailure\(target\.key, result\.reason\)/);
  assert.match(watchdog, /escalations\.recordRemediationAttempt\(target\.key\)/);
  assert.match(watchdog, /escalations\.escalationDue\(target\.key, Date\.now\(\)\)/);
});

check("deep recovery is only recorded on deep cycles (cheap probes lie through a wedge)", () => {
  assert.match(watchdog, /if \(deep\) \{\s*\n\s*const recovery = escalations\.recordDeepRecovery\(target\.key\)/);
});

check("escalations land in the dashboard notifications feed as urgent alerts", () => {
  assert.match(watchdog, /\/api\/notifications/);
  assert.match(watchdog, /priority: "urgent"/);
  assert.match(watchdog, /kind: "alert"/);
  assert.match(watchdog, /source: "fleet-health-watchdog"/);
});

check("local dashboard calls carry the device token so auth-enabled dashboards accept them", () => {
  assert.match(watchdog, /x-hivemindos-device-token/);
  assert.match(watchdog, /HIVEMINDOS_DASHBOARD_DEVICE_TOKEN/);
  assert.match(watchdog, /api\/fleet\/discover`, \{ headers: dashboardHeaders\(\) \}/);
  assert.match(watchdog, /api\/fleet\/apps\?fast=1`, \{ headers: dashboardHeaders\(\) \}/);
});

check("package script exposes the regression test", () => {
  const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  assert.match(pkg, /"test:fleet-watchdog-escalation":\s*"node scripts\/test-fleet-watchdog-escalation\.mjs"/);
});

console.log(`\nfleet watchdog escalation: ${passed} checks passed.`);
