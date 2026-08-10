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
import {
  collectorHealthBelongsToApp,
  localCollectorPortCandidates,
  selectHealthyLocalCollector,
} from "./lib/fleet-watchdog-local-collector.mjs";
import {
  collectorChatFailureResult,
  collectorChatProbeDecision,
  createMachineCacheSnapshot,
  readFreshMachineCache,
  shouldAttemptRemediation,
} from "./lib/fleet-watchdog-discovery.mjs";

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

check("the active service port outranks stale collector.env metadata", () => {
  const candidates = localCollectorPortCandidates({
    configuredPort: "8797",
    launchAgentText: `
      <key>EnvironmentVariables</key><dict>
        <key>AGENT_TELEMETRY_PORT</key><string>8792</string>
      </dict>
    `,
    scanPorts: [8787, 8792, 8797],
  });
  assert.deepEqual(candidates.slice(0, 3), [
    { port: 8792, source: "launchd", authoritative: true },
    { port: 8797, source: "collector.env", authoritative: false },
    { port: 8787, source: "scan", authoritative: false },
  ]);
});

check("systemd service metadata is authoritative too", () => {
  const candidates = localCollectorPortCandidates({
    configuredPort: "8787",
    systemdUnitText: "Environment=AGENT_TELEMETRY_PORT=9123\n",
    scanPorts: [8787],
  });
  assert.deepEqual(candidates.slice(0, 2), [
    { port: 9123, source: "systemd", authoritative: true },
    { port: 8787, source: "collector.env", authoritative: false },
  ]);
});

check("a scanned collector must prove it belongs to this checkout", () => {
  const matching = { ok: true, version: { appDir: "/opt/hivemindos" } };
  const unrelated = { ok: true, version: { appDir: "/opt/other-checkout" } };
  assert.equal(collectorHealthBelongsToApp(matching, "/opt/hivemindos", false), true);
  assert.equal(collectorHealthBelongsToApp(unrelated, "/opt/hivemindos", false), false);
  assert.equal(collectorHealthBelongsToApp({ ok: true }, "/opt/hivemindos", false), false);
  assert.equal(collectorHealthBelongsToApp({ ok: true }, "/opt/hivemindos", true), true);
});

check("stale metadata cannot hide the healthy owned collector", () => {
  const candidates = localCollectorPortCandidates({
    configuredPort: "8797",
    launchAgentText: "<key>AGENT_TELEMETRY_PORT</key><string>8792</string>",
    scanPorts: [8787, 8792, 8797],
  });
  const selected = selectHealthyLocalCollector(
    candidates.map((candidate) => ({
      candidate,
      health: candidate.port === 8792
        ? { ok: true, version: { appDir: "/opt/hivemindos" } }
        : null,
    })),
    "/opt/hivemindos",
  );
  assert.deepEqual(selected?.candidate, { port: 8792, source: "launchd", authoritative: true });
});

check("fleet cache snapshots preserve only recently confirmed machine state", () => {
  const now = Date.parse("2026-08-10T05:00:00.000Z");
  const machines = [{ name: "worker", online: true, collectorUrl: "http://worker:8787" }];
  const snapshot = createMachineCacheSnapshot(machines, now - 60_000);
  const cached = readFreshMachineCache(JSON.stringify(snapshot), { now, ttlMs: 5 * 60_000 });
  assert.equal(cached.fresh, true);
  assert.equal(cached.ageMs, 60_000);
  assert.deepEqual(cached.machines, machines);
});

check("legacy, stale, and future-dated fleet caches cannot create live watchdog targets", () => {
  const now = Date.parse("2026-08-10T05:00:00.000Z");
  const machines = [{ name: "offline-ghost", online: true, collectorUrl: "http://ghost:8787" }];
  assert.deepEqual(
    readFreshMachineCache(JSON.stringify(machines), { now, ttlMs: 5 * 60_000 }),
    { fresh: false, machines: [], reason: "legacy-cache" },
  );
  assert.equal(
    readFreshMachineCache(
      JSON.stringify(createMachineCacheSnapshot(machines, now - 5 * 60_000 - 1)),
      { now, ttlMs: 5 * 60_000 },
    ).reason,
    "stale-cache",
  );
  assert.equal(
    readFreshMachineCache(
      JSON.stringify(createMachineCacheSnapshot(machines, now + 61_000)),
      { now, ttlMs: 5 * 60_000 },
    ).reason,
    "future-cache",
  );
});

check("an unreachable remote control path is never classified as restartable", () => {
  assert.equal(shouldAttemptRemediation({ local: false }, { unreachable: true }), false);
  assert.equal(shouldAttemptRemediation({ local: false }, { unreachable: false }), true);
  assert.equal(shouldAttemptRemediation({ local: true }, { unreachable: true }), true);
  assert.equal(shouldAttemptRemediation({ local: true }, { remediationProof: true }), false);
});

check("collector deep chat probes honor advertised runtime capabilities", () => {
  assert.deepEqual(
    collectorChatProbeDecision({ capabilities: { chat: false, runtimes: ["openclaw"] } }),
    { supported: false, reason: "collector advertises chat=false" },
  );
  assert.deepEqual(
    collectorChatProbeDecision({ capabilities: { chat: true, runtimes: ["openclaw"] } }),
    { supported: false, reason: "collector does not advertise the hermes runtime" },
  );
  assert.deepEqual(
    collectorChatProbeDecision({ capabilities: { chat: true, runtimes: ["hermes", "openclaw"] } }),
    { supported: true },
  );
  assert.deepEqual(collectorChatProbeDecision({ ok: true }), { supported: true }, "legacy collectors retain deep probes");
});

check("missing Hermes is remediation-proof while other chat failures stay severe", () => {
  const missing = collectorChatFailureResult(502, "spawn hermes ENOENT");
  assert.equal(missing.healthy, false);
  assert.equal(missing.remediationProof, true);
  assert.equal(missing.severe, undefined);
  assert.match(missing.reason, /restarting the collector cannot fix it/);
  assert.equal(shouldAttemptRemediation({ local: false }, missing), false);

  assert.deepEqual(
    collectorChatFailureResult(502, "backend wedged"),
    { healthy: false, severe: true, reason: "chat HTTP 502 backend wedged" },
  );
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

check("the watchdog discovers the owned local collector and rechecks before remediation", () => {
  assert.match(watchdog, /localCollectorPortCandidates/);
  assert.match(watchdog, /selectHealthyLocalCollector/);
  assert.match(watchdog, /async function probeSelfCollector/);
  assert.match(watchdog, /recovered before remediation \(final safety probe passed; no restart\)/);
  const remediationBranch = watchdog.indexOf("if (fails >= threshold");
  const safetyProbe = watchdog.indexOf("const finalProbe =", remediationBranch);
  const remediation = watchdog.indexOf("REMEDIATING — restart", remediationBranch);
  assert.ok(safetyProbe > remediationBranch, "the final safety probe should run inside the remediation branch");
  assert.ok(remediation > safetyProbe, "the watchdog must pass the final safety probe before it can restart a collector");
});

check("stale discovery caches and unreachable peers fail closed without restart spam", () => {
  assert.match(watchdog, /createMachineCacheSnapshot/);
  assert.match(watchdog, /readFreshMachineCache/);
  assert.match(watchdog, /fleet discovery cache .*ignored/i);
  assert.match(watchdog, /shouldAttemptRemediation\(target, result\)/);
  assert.match(watchdog, /restart not attempted because the control path is also unreachable/);
  assert.match(watchdog, /clearAlert\(`unreachable:\$\{target\.key\}`\)/);
  assert.match(watchdog, /unreachable: true, reason: `health unreachable:/);
  assert.match(watchdog, /unreachable: true, reason: `models unreachable:/);

  const unreachableBranch = watchdog.indexOf("if (!shouldAttemptRemediation(target, result))");
  const normalRemediation = watchdog.indexOf("REMEDIATING — restart", unreachableBranch);
  assert.ok(unreachableBranch >= 0, "watchdog classifies unreachable targets before remediation");
  assert.ok(normalRemediation > unreachableBranch, "normal remediation remains after the unreachable-target guard");
});

check("unsupported or missing collector runtimes never enter the restart-escalation loop", () => {
  assert.match(watchdog, /collectorChatProbeDecision\(healthData, "hermes"\)/);
  assert.match(watchdog, /healthy: true, deepProbeSkipped: true/);
  assert.match(watchdog, /collectorChatFailureResult\(chat\.status/);
  assert.match(watchdog, /!result\.deepProbeSkipped && recovery\.wasEscalated/);
  assert.match(watchdog, /result\.remediationProof \? UNREACHABLE_ALERT_REPEAT_MS : ALERT_REPEAT_MS/);

  const capabilityDecision = watchdog.indexOf("collectorChatProbeDecision(healthData");
  const chatDispatch = watchdog.indexOf("const chat = await fetchJson", capabilityDecision);
  assert.ok(capabilityDecision >= 0, "collector capability decision is wired");
  assert.ok(chatDispatch > capabilityDecision, "capability decision runs before chat dispatch");
});

check("collector metadata is published atomically only after live service verification", () => {
  const installer = readFileSync(new URL("./install-telemetry-collector.sh", import.meta.url), "utf8");
  assert.match(installer, /wait_for_installed_collector/);
  assert.match(installer, /collector\.env\.next\.\$\$/);
  assert.match(installer, /mv -f "\$COLLECTOR_ENV_NEXT" "\$COLLECTOR_ENV"/);
  assert.ok(
    installer.indexOf("wait_for_installed_collector") < installer.indexOf("write_collector_env"),
    "the installed collector must be verified before metadata is published",
  );
});

check("macOS linkd repair clears stale daemon processes before rebootstrap", () => {
  const bootout = watchdog.indexOf('launchctl bootout "gui/$U/${label}"');
  const gracefulStop = watchdog.indexOf("pkill -x hivemind-linkd");
  const waitForExit = watchdog.indexOf("pgrep -x hivemind-linkd");
  const forcedStop = watchdog.indexOf("pkill -9 -x hivemind-linkd");
  const bootstrap = watchdog.indexOf('launchctl bootstrap "gui/$U" "$PLIST"');

  assert.ok(bootout >= 0, "repair unloads the managed LaunchAgent first");
  assert.ok(gracefulStop > bootout, "repair terminates an orphaned exact-name linkd process");
  assert.ok(waitForExit > gracefulStop, "repair waits for the stale process to release its listeners");
  assert.ok(forcedStop > waitForExit, "repair force-stops only an exact-name linkd process if graceful exit wedges");
  assert.ok(bootstrap > forcedStop, "repair reboots the LaunchAgent only after stale listeners are gone");
  assert.match(watchdog, /watchdog could not stop stale linkd processes/);
  assert.match(watchdog, /watchdog failed to load linkd LaunchAgent/);
  assert.match(watchdog, /watchdog failed to start linkd LaunchAgent/);
});

check("escalations land in the dashboard notifications feed as urgent alerts", () => {
  assert.match(watchdog, /\/api\/notifications/);
  assert.match(watchdog, /priority: "urgent"/);
  assert.match(watchdog, /kind: "alert"/);
  assert.match(watchdog, /source: "fleet-health-watchdog"/);
});

check("escalations queue a bounded SRE incident after deterministic remediation fails", () => {
  assert.match(watchdog, /\/api\/ops\/investigations/);
  assert.match(watchdog, /source: "fleet-watchdog"/);
  assert.match(watchdog, /consecutiveDeepFailures: due\.streak/);
  assert.match(watchdog, /remediationAttempts: due\.remediations/);
  assert.match(watchdog, /const investigationPosted = await postSreInvestigation\(target, due, message\)/);
});

check("the watchdog never executes SRE recommendations", () => {
  assert.match(watchdog, /No recommendation is executed here/);
  assert.doesNotMatch(watchdog, /diagnosis\.recommendations/);
});

check("local dashboard calls carry the device token so auth-enabled dashboards accept them", () => {
  assert.match(watchdog, /x-hivemindos-device-token/);
  assert.match(watchdog, /HIVEMINDOS_DASHBOARD_DEVICE_TOKEN/);
  assert.match(watchdog, /api\/fleet\/discover`, \{ headers: dashboardHeaders\(\) \}/);
  assert.match(watchdog, /api\/fleet\/apps\?fast=1`, \{ headers: dashboardHeaders\(\) \}/);
});

check("telegram alerts identify the watchdog source machine", () => {
  assert.match(watchdog, /const WATCHDOG_SOURCE =/);
  assert.match(watchdog, /fleet-watchdog \(\$\{WATCHDOG_SOURCE\}\):/);
  assert.match(watchdog, /fleet-health-watchdog up — source=\$\{WATCHDOG_SOURCE\}/);
});

check("alert throttling is persisted across watchdog restarts", () => {
  assert.match(watchdog, /fleet-health-watchdog-alerts\.json/);
  assert.match(watchdog, /readAlertState/);
  assert.match(watchdog, /writeAlertState/);
  assert.match(watchdog, /const sourceKey = `\$\{WATCHDOG_SOURCE\}:\$\{key\}`/);
  assert.match(watchdog, /lastSentAt \+ repeatMs > now/);
  assert.match(watchdog, /async function clearAlert\(key\)/);
});

check("company-driver alerts are suppressed when disk state has nothing local to drive", () => {
  assert.match(watchdog, /readCompanyDriverNeedFromDisk/);
  assert.match(watchdog, /Operations", "Companies", "companies\.json/);
  assert.match(watchdog, /need\.available && need\.localActiveCount === 0/);
  assert.match(watchdog, /no launched companies for \$\{WATCHDOG_SOURCE\}/);
});

check("company-driver need honors home machine identity and unclaimed companies", () => {
  assert.match(watchdog, /function sameMachineIdentity/);
  assert.match(watchdog, /function companyNeedsThisDriver/);
  assert.match(watchdog, /if \(!home\) return true/);
  assert.match(watchdog, /sameMachineIdentity\(home, WATCHDOG_SOURCE\)/);
});

check("package script exposes the regression test", () => {
  const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  assert.match(pkg, /"test:fleet-watchdog-escalation":\s*"node scripts\/test-fleet-watchdog-escalation\.mjs"/);
});

console.log(`\nfleet watchdog escalation: ${passed} checks passed.`);
