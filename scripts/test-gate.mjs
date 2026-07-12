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
  "guard:ui-typography",
];

// Hermetic and passing as of 2026-07-02. Keep alphabetized.
const TESTS = [
  "test:acting-wallet-context",
  "test:agent-chat-readiness",
  "test:agent-flow",
  "test:agent-mailboxes",
  "test:agent-memory-evolution",
  "test:agent-memory-pattern-review",
  "test:agent-memory-routing",
  "test:agent-memory-upgrade",
  "test:agent-providers",
  "test:app-builder",
  "test:bankr-actions",
  "test:clawbank",
  "test:code-intelligence",
  "test:collector-chat-abort",
  "test:collector-reserved-profile-snapshots",
  "test:collector-ssrf-guard",
  "test:chat-capability-preflight",
  "test:chat-command-permissions",
  "test:chat-folder-reference-attachments",
  "test:chat-image-format-support",
  "test:chat-issue-notifications",
  "test:chat-leaked-tool-call-markup",
  "test:chat-maintenance-safety",
  "test:chat-message-feedback",
  "test:chat-message-visible-attachments",
  "test:chat-new-chat-agent",
  "test:chat-process-history-isolation",
  "test:chat-preview-targets",
  "test:chat-reasoning-effort",
  "test:chat-thread-actions",
  "test:chat-thread-telemetry-delete",
  "test:chat-thread-usage",
  "test:chat-thread-vault-purge",
  "test:chat-reload-resume",
  "test:chat-runtime-concurrency",
  "test:chat-slash-command-badge",
  "test:chat-video-runtime-routing",
  "test:chat-video-card-lifecycle",
  "test:chat-video-follow-up",
  "test:approval-hold",
  "test:approval-consolidation",
  "test:company-autonomy",
  "test:company-deliverables",
  "test:company-issues",
  "test:company-outputs",
  "test:company-revenue-share",
  "test:company-task-dedup",
  "test:company-vault-store",
  "test:evaluation",
  "test:compiled-knowledge",
  "test:connected-app-capabilities",
  "test:context-index:loop-readiness",
  "test:context-index:swarm-goal",
  "test:copy-trading",
  "test:crypto-gaps",
  "test:crypto-practice-book",
  "test:dashboard-auth",
  "test:deliverable-acceptance",
  "test:dashboard-nav",
  "test:dashboard-note",
  "test:dashboard-state-snapshot",
  "test:dev-warm-routes",
  "test:engineering-discipline",
  "test:fleet-agent-suppression",
  "test:fleet-apps-tailnet-url",
  "test:fleet-discovery-merge",
  "test:fleet-search",
  "test:fleet-stt",
  "test:fleet-watchdog-escalation",
  "test:fleet-windows-visibility",
  "test:founder-mode",
  "test:fusion",
  "test:fusion-blind-compare",
  "test:fusion-skill-selection",
  "test:gbrain-foundation",
  "test:gcp-budget-admin",
  "test:hive-compute-input-artifact-spool",
  "test:hive-compute-job-key-vault",
  "test:hive-compute-marketplace",
  "test:hive-compute-pricing",
  "test:hive-compute-remote-host",
  "test:hive-compute-worker",
  "test:hive-compute-workloads",
  "test:hive-env-remove",
  "test:hive-env-roundtrip",
  "test:hive-staking",
  "test:hive-transfer",
  "test:honey-economics",
  "test:hosted-media-generation",
  "test:hyperliquid",
  "test:inbox-triage",
  "test:issue-artifacts",
  "test:json-render",
  "test:kanban:concurrency",
  "test:kanban:result-format",
  "test:kanban:shards",
  "test:legal-policies",
  "test:linkd-staleness",
  "test:local-tts-robustness",
  "test:loop-blocking",
  "test:loop-kanban-real-tasks",
  "test:loop-readiness",
  "test:loop-runner",
  "test:loops",
  "test:spend-ledger-integrity",
  "test:company-goal-planner",
  "test:machine-delegation-health",
  "test:machine-identity-drift",
  "test:openai-oauth-preference",
  "test:mcp-client",
  "test:native-first-launch-privacy",
  "test:neo4j-brain-service",
  "test:notification-actions",
  "test:notification-clustering",
  "test:notification-resolution",
  "test:okf-export",
  "test:packaged-agents",
  "test:paid-agent-gateway",
  "test:personal-wallet-grouping",
  "test:preview-review",
  "test:qmd-brain-service",
  "test:queen-bee:autonomous",
  "test:queen-bee:infra-rescue",
  "test:queen-bee:redispatch",
  "test:queen-bee:router",
  "test:queen-chat-stream",
  "test:queen-clap",
  "test:queen-echo",
  "test:queen-slash-commands",
  "test:queen-voice-events",
  "test:queen-voice-stt",
  "test:queen-voice-prefs",
  "test:queen-voice-working",
  "test:runtime-portable-state",
  "test:runtime-setup-resilience",
  "test:schedule-health",
  "test:schedule-replication",
  "test:hermes-api-cache-routing",
  "test:hermes-cron-doc",
  "test:scheduled-runs-machine-key",
  "test:shared-brain-index",
  "test:skill-loop-guard",
  "test:standard-memory-benchmark",
  "test:status-chat-transcript-job",
  "test:swarm-goal",
  "test:system-cockpit",
  "test:system-health",
  "test:tauri-dev-resilience",
  "test:tauri-release-mode",
  "test:transcript-card",
  "test:ui-typography-guard",
  "test:untrusted-context",
  "test:vault-structure",
  "test:veil-auto-send",
  "test:video-app-routing",
  "test:wallet-add-chain",
  "test:wallet-paid-models",
  "test:wallet-real-tabs",
  "test:wallet-vault",
  "test:work-events",
  "test:worker-output-failure",
  "test:x-latest-post",
  "test:x-transcript-job",
  "test:x-url",
  "test:xai-oauth-inference",
  "test:xai-oauth-provider-setup",
  "test:xai-oauth-token-broker",
];

// Hermetic but currently failing (stale source anchors / moved docs) or owned
// by in-flight work. Fix, verify locally, then move into TESTS.
const PENDING = [];

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
