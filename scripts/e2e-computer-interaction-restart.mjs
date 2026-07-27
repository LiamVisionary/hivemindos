#!/usr/bin/env node
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";

const sourceRoot = process.cwd();
const fixtureRoot = await mkdtemp(join(tmpdir(), "hivemindos-computer-restart-"));
const appRoot = join(fixtureRoot, "app");
const fixtureHome = join(fixtureRoot, "home");
const authSecret = "computer-interaction-restart-secret".padEnd(64, "-");
const deviceToken = "computer-interaction-restart-device".padEnd(64, "-");
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
let child = null;
let output = "";

try {
  await copyCurrentWorkspace();
  await symlink(join(sourceRoot, "node_modules"), join(appRoot, "node_modules"), "dir");

  child = startServer();
  await waitForServer();
  const started = await request({
    action: "start",
    goal: "Isolated process restart and durable resume E2E",
    adapters: ["page-agent"],
    policy: {
      allowedDomains: ["127.0.0.1"],
      allowedApps: ["hivemindos-dashboard"],
      requireConfirmationForConsequences: true,
      pauseOnPromptInjection: true,
    },
    limits: { maxSteps: 3, maxRuntimeMs: 300_000, maxCostUsd: 1 },
    observation: observation(1, "Before process restart"),
  });
  const runId = started.run.id;
  const paused = await request({ action: "pause", runId, reason: "Restart checkpoint" });
  assert.equal(paused.run.status, "paused");

  const approvalStarted = await request({
    action: "start",
    goal: "Recover an exact reported-action approval after process restart",
    adapters: ["hive-action"],
    policy: {
      allowedDomains: ["127.0.0.1"],
      allowedApps: ["hivemindos-dashboard"],
      requireConfirmationForConsequences: true,
      pauseOnPromptInjection: true,
    },
    limits: { maxSteps: 3, maxRuntimeMs: 300_000, maxCostUsd: 1 },
    observation: hiveActionObservation(1, "Before exact-action approval"),
  });
  const approvalRunId = approvalStarted.run.id;
  const approvedInteractionAction = {
    kind: "hive-action",
    adapter: "hive-action",
    observationId: approvalStarted.run.latestObservation.id,
    params: { hiveActionId: "restart-e2e.local-read", hiveActionInputJson: "{}" },
    description: "Report the restart E2E local read",
  };
  const awaitingApproval = await request({
    action: "step",
    runId: approvalRunId,
    interactionAction: approvedInteractionAction,
  });
  assert.equal(awaitingApproval.run.status, "awaiting-approval");
  const approvalFingerprint = awaitingApproval.run.pendingApproval.actionFingerprint;
  const approvedBeforeRestart = await request({
    action: "approve",
    runId: approvalRunId,
    approvalId: awaitingApproval.run.pendingApproval.id,
  });
  assert.equal(approvedBeforeRestart.run.status, "running");
  assert.equal(approvedBeforeRestart.run.stepCount, 0);
  assert.equal(approvedBeforeRestart.run.approvedAction.actionFingerprint, approvalFingerprint);

  await stopServer();
  output = "";
  child = startServer();
  await waitForServer();

  const recovered = await getRun(runId);
  assert.equal(recovered.run.status, "paused", "the relaunched process must recover the paused run from disk");
  assert(recovered.events.some((event) => event.type === "paused"));
  const resumed = await request({ action: "resume", runId });
  assert.equal(resumed.run.status, "running");
  const completed = await request({
    action: "step",
    runId,
    interactionAction: {
      kind: "complete",
      adapter: "page-agent",
      observationId: resumed.run.latestObservation.id,
      params: {},
      description: "Complete after the isolated server restart",
    },
    observation: observation(2, "After process restart"),
    reportedResult: { ok: true, summary: "Recovered and completed after process restart.", model: "restart-e2e" },
  });
  assert.equal(completed.run.status, "completed");

  const recoveredApproval = await getRun(approvalRunId);
  assert.equal(recoveredApproval.run.status, "running");
  assert.equal(recoveredApproval.run.stepCount, 0);
  assert.equal(recoveredApproval.run.approvedAction.actionFingerprint, approvalFingerprint);
  assert(recoveredApproval.events.some((event) => event.type === "approved"));
  const reportedAfterRestart = await request({
    action: "step",
    runId: approvalRunId,
    interactionAction: approvedInteractionAction,
    observation: hiveActionObservation(2, "After exact reported-action execution"),
    reportedResult: {
      ok: true,
      summary: "The exact approved local action was reported after process restart.",
      model: "restart-e2e-reported",
    },
  });
  assert.equal(reportedAfterRestart.run.status, "running");
  assert.equal(reportedAfterRestart.run.stepCount, 1);
  assert.equal(reportedAfterRestart.run.approvedAction, undefined);
  assert.equal(reportedAfterRestart.run.receipts.at(-1).policy.reason, "The human approved this exact pending action.");
  await request({ action: "stop", runId: approvalRunId, reason: "Exact-action restart E2E complete" });

  const runPath = join(fixtureHome, ".hivemindos", "runtime-runs", "computer-interaction", `${runId}.json`);
  const diskRun = JSON.parse(await readFile(runPath, "utf8"));
  assert.equal(diskRun.status, "completed");
  assert.equal(diskRun.receipts.length, 1);
  const approvalRunPath = join(fixtureHome, ".hivemindos", "runtime-runs", "computer-interaction", `${approvalRunId}.json`);
  const diskApprovalRun = JSON.parse(await readFile(approvalRunPath, "utf8"));
  assert.equal(diskApprovalRun.status, "stopped");
  assert.equal(diskApprovalRun.stepCount, 1);
  assert.equal(diskApprovalRun.approvedAction, undefined);
  console.log(JSON.stringify({
    ok: true,
    pausedRun: { runId, status: diskRun.status, receipts: diskRun.receipts.length },
    approvedActionRun: {
      runId: approvalRunId,
      status: diskApprovalRun.status,
      stepCount: diskApprovalRun.stepCount,
      exactApprovalRecoveredAndConsumed: true,
    },
    processRestarts: 1,
  }, null, 2));
} catch (error) {
  if (output.trim()) console.error(output.slice(-12_000));
  throw error;
} finally {
  await stopServer();
  await rm(fixtureRoot, { recursive: true, force: true });
}

function startServer() {
  const nextBin = join(sourceRoot, "node_modules", "next", "dist", "bin", "next");
  const processHandle = spawn(process.execPath, [
    nextBin,
    "dev",
    "--webpack",
    "--disable-source-maps",
    "-p",
    String(port),
    "-H",
    "127.0.0.1",
  ], {
    cwd: appRoot,
    env: {
      ...process.env,
      HOME: fixtureHome,
      HIVEMINDOS_DASHBOARD_AUTH_SECRET: authSecret,
      HIVEMINDOS_DASHBOARD_DEVICE_TOKEN: deviceToken,
      HIVEMINDOS_TAURI_BUILD: "1",
      HIVEMINDOS_COMPANY_AUTONOMY_DRIVER: "0",
      HIVEMINDOS_HIVE_COMPUTE_RESUME: "0",
      HIVEMINDOS_INBOX_TRIAGE: "0",
      HIVEMINDOS_RESEARCH_SYNC: "0",
      HIVEMINDOS_TELEGRAM_TIP_BOT_AUTOSTART: "0",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  processHandle.stdout.on("data", (chunk) => { output += chunk.toString(); });
  processHandle.stderr.on("data", (chunk) => { output += chunk.toString(); });
  return processHandle;
}

async function stopServer() {
  if (!child || child.exitCode != null || child.signalCode) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (child.exitCode == null && !child.signalCode) child.kill("SIGKILL");
}

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) throw new Error(`Isolated Next server exited early:\n${output}`);
    const response = await fetch(`${baseUrl}/api/computer-interaction`, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
    if (response?.status === 401) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for isolated Next server:\n${output}`);
}

async function request(body) {
  const response = await fetch(`${baseUrl}/api/computer-interaction`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, 200, `${body.action} failed after server restart: ${data?.error ?? response.status}`);
  assert.equal(data.ok, true);
  return data;
}

async function getRun(runId) {
  const response = await fetch(`${baseUrl}/api/computer-interaction?runId=${encodeURIComponent(runId)}`, {
    headers: { "x-hivemindos-device-token": deviceToken, Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  return data;
}

function observation(sequence, content) {
  return {
    adapter: "page-agent",
    sequence,
    url: `${baseUrl}/page-agent-lab`,
    app: "hivemindos-dashboard",
    title: "Restart E2E",
    content,
  };
}

function hiveActionObservation(sequence, content) {
  return {
    adapter: "hive-action",
    sequence,
    url: `${baseUrl}/`,
    app: "hivemindos-dashboard",
    title: "Restart approval E2E",
    content,
  };
}

function authHeaders() {
  return {
    "x-hivemindos-device-token": deviceToken,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function copyCurrentWorkspace() {
  const skippedTopLevel = new Set([
    ".git",
    ".next",
    ".next-tauri",
    ".next-tauri-build",
    ".next-tauri-static-build",
    ".outputs",
    "node_modules",
  ]);
  await cp(sourceRoot, appRoot, {
    recursive: true,
    filter(source) {
      const path = relative(sourceRoot, source);
      if (!path) return true;
      const [top] = path.split(/[\\/]/);
      if (skippedTopLevel.has(top)) return false;
      if (path === "src-tauri/target" || path.startsWith("src-tauri/target/")) return false;
      return true;
    },
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert(address && typeof address === "object");
  return address.port;
}
