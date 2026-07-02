#!/usr/bin/env node
// The repo's single test gate: `pnpm test` runs typecheck, static guards, the
// size ratchet, and every fast hermetic test suite, sequentially. This is what
// CI gates PRs on (.github/workflows/ci.yml) and what "run the tests" means.
//
// Membership rules:
// - Included suites must be fast (<10s each), deterministic, and hermetic —
//   no live app/collector/fleet, no network to real services, no fixed ports,
//   no writes outside tmp dirs. See the 2026-07-02 audit in CHANGELOG.md.
// - Excluded on purpose (not hermetic): test:kanban, test:fleet-local,
//   test:aeon-brain, test:api-auth, test:fleet-app-icons, test:e2e:*,
//   test:mcp-email(:real), test:buy-stock, test:neo4j-api,
//   test:agent-memory-api, test:tauri-runtime-bundle (needs staged bundle).
// - Known-broken suites are listed in PENDING with the reason; fix and promote
//   them instead of deleting entries.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PER_TEST_TIMEOUT_MS = 180_000;

const CHECKS = [
  "typecheck",
  "check-sizes",
  "check:tauri-acl",
  "guard:commercial-trust-boundary",
  "guard:hive-action-route-drift",
];

// Hermetic and passing as of 2026-07-02. Keep alphabetized.
const TESTS = [
  "test:acting-wallet-context",
  "test:agent-flow",
  "test:agent-mailboxes",
  "test:agent-memory-evolution",
  "test:agent-providers",
  "test:bankr-actions",
  "test:clawbank",
  "test:code-intelligence",
  "test:compiled-knowledge",
  "test:context-index:loop-readiness",
  "test:context-index:swarm-goal",
  "test:copy-trading",
  "test:crypto-gaps",
  "test:crypto-practice-book",
  "test:dashboard-auth",
  "test:dashboard-nav",
  "test:dashboard-state-snapshot",
  "test:dev-warm-routes",
  "test:fleet-agent-suppression",
  "test:fleet-discovery-merge",
  "test:fleet-windows-visibility",
  "test:fusion",
  "test:fusion-blind-compare",
  "test:gbrain-foundation",
  "test:hive-env-remove",
  "test:hive-staking",
  "test:hive-transfer",
  "test:honey-economics",
  "test:hyperliquid",
  "test:json-render",
  "test:kanban:concurrency",
  "test:loop-blocking",
  "test:loop-kanban-real-tasks",
  "test:loop-readiness",
  "test:loop-runner",
  "test:loops",
  "test:mcp-client",
  "test:native-first-launch-privacy",
  "test:neo4j-brain-service",
  "test:okf-export",
  "test:packaged-agents",
  "test:qmd-brain-service",
  "test:queen-bee:autonomous",
  "test:queen-bee:redispatch",
  "test:queen-bee:router",
  "test:queen-clap",
  "test:queen-echo",
  "test:queen-voice-events",
  "test:runtime-portable-state",
  "test:shared-brain-index",
  "test:skill-loop-guard",
  "test:swarm-goal",
  "test:system-cockpit",
  "test:system-health",
  "test:tauri-dev-resilience",
  "test:tauri-release-mode",
  "test:untrusted-context",
  "test:vault-structure",
  "test:veil-auto-send",
  "test:wallet-paid-models",
  "test:wallet-vault",
  "test:work-events",
];

// Hermetic but currently failing (stale source anchors / moved docs) or owned
// by in-flight work. Fix, verify locally, then move into TESTS.
const PENDING = [
  ["test:queen-voice-prefs", "anchors agent-runtime route internals (extraction in flight)"],
  ["test:personal-wallet-grouping", "WalletPanel helper boundary anchor drifted (helpers moved)"],
  ["test:agent-memory-upgrade", "agent-memory refactor in flight (concurrent session)"],
  ["test:wallet-real-tabs", "personal-wallets import anchor drifted (wallet typing in flight)"],
];

const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
const results = [];
let failed = 0;

function run(name) {
  const command = scripts[name];
  if (!command) {
    results.push({ name, status: "MISSING", ms: 0 });
    failed++;
    return;
  }
  const startedAt = Date.now();
  const result = spawnSync(command, {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: PER_TEST_TIMEOUT_MS,
    env: { ...process.env, CI: process.env.CI ?? "" },
  });
  const ms = Date.now() - startedAt;
  const timedOut = result.error?.code === "ETIMEDOUT";
  const ok = !timedOut && result.status === 0;
  results.push({ name, status: ok ? "PASS" : timedOut ? "TIMEOUT" : "FAIL", ms });
  if (!ok) {
    failed++;
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().split("\n").slice(-15).join("\n");
    console.error(`\n--- ${name} ${timedOut ? "timed out" : `failed (exit ${result.status})`} ---\n${output}\n`);
  } else {
    console.log(`PASS ${name} (${ms}ms)`);
  }
}

console.log(`test gate: ${CHECKS.length} checks + ${TESTS.length} suites (skipping ${PENDING.length} pending)`);
for (const name of [...CHECKS, ...TESTS]) run(name);

const passed = results.filter((entry) => entry.status === "PASS").length;
const totalMs = results.reduce((sum, entry) => sum + entry.ms, 0);
console.log(`\ngate summary: ${passed}/${results.length} passed in ${(totalMs / 1000).toFixed(1)}s`);
if (PENDING.length) {
  console.log(`pending (not run): ${PENDING.map(([name]) => name).join(", ")}`);
}
if (failed) {
  console.error(`gate FAILED: ${failed} step(s) red`);
  process.exit(1);
}
console.log("gate PASSED");
