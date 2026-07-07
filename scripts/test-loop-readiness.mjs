#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const execFileAsync = promisify(execFile);

const {
  buildLoopFromTemplate,
  buildLoopReadinessReport,
  listLoopPatterns,
  renderLoopEngineeringArtifacts,
} = await import("../src/lib/services/loops/index.ts");
const { claimTask, completeTask, createTask, readBoard } = await import("../src/lib/services/kanban/local-kanban-store.ts");

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-loop-readiness-"));
const options = { vaultPath, kanbanFolder: "Operations/Work Board" };
const boardSlug = "readiness";
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

try {
  const patterns = listLoopPatterns();
  assert.equal(patterns.length, 7, "registry should expose every built-in loop pattern");
  assert(patterns.some((pattern) => pattern.id === "app-build-harness"), "registry should include app-build-harness");

  const loop = buildLoopFromTemplate({
    templateId: "app-build-harness",
    goal: "Build a tiny receipt viewer.",
    optionalVerifierIds: ["human:approval"],
    maxAttempts: 2,
    maxTokens: 250000,
    maxCostUsd: 3,
    now: 1_800_000_000_000,
  });

  const created = await createTask(boardSlug, {
    title: "Loop readiness fixture",
    body: "Build and verify a tiny receipt viewer.",
    status: "ready",
    priority: "high",
    workspace: "worktree",
    source: "queen-bee:test",
    loop,
  }, options);

  await claimTask(boardSlug, created.task.id, {
    assignee: "Test Agent",
    claimer: "loop-readiness-claim",
    runtime: "test",
  }, options);

  const requiredGateIds = created.task.loop.evalGates.filter((gate) => gate.required).map((gate) => gate.id);
  const receipts = requiredGateIds.map((gateId, index) => ({
    gateId,
    status: "passed",
    summary: `Gate ${gateId} passed in fixture`,
    evidence: [`fixture evidence ${index}`],
    createdAt: 1_800_000_000_001 + index,
  }));

  await completeTask(boardSlug, created.task.id, {
    summary: "Fixture completed.",
    result: "Deliverable: /tmp/loop-readiness-fixture.txt",
    loopReceipts: receipts,
  }, options);

  const board = await readBoard(boardSlug, options);
  const report = buildLoopReadinessReport({ board, now: Date.now() });
  assert.equal(report.level, "L3", "a fully evidenced, budgeted loop fixture should be L3");
  assert(report.score >= 78, "L3 report should score in the L3 band");
  assert.equal(report.totals.loopTasks, 1);
  assert.equal(report.totals.receipts, requiredGateIds.length);
  assert.equal(report.totals.worktreeLoopTasks, 1);
  assert.equal(report.totals.queenBeeTasks, 1);
  assert(report.signals.find((signal) => signal.id === "human-gates")?.present, "optional human gate should count as a human handoff signal");

  const artifacts = renderLoopEngineeringArtifacts(report, { title: "Fixture Project" });
  assert(artifacts.loopMd.includes("Fixture Project"));
  assert(artifacts.stateMd.includes("Readiness: L3"));
  assert(artifacts.budgetMd.includes("Pattern Caps"));
  assert(artifacts.contractMd.includes("Evaluator Pushback"));
  assert(artifacts.contractMd.includes("Design"));
  assert(artifacts.runLogMd.includes("Signal Log"));
  assert(artifacts.registryYaml.includes("app-build-harness"));

  const cli = await execFileAsync(process.execPath, [
    "scripts/hive-loop",
    "audit",
    "--json",
    "--board",
    boardSlug,
    "--vaultPath",
    vaultPath,
    "--kanbanFolder",
    "Operations/Work Board",
  ], { cwd: repoRoot, timeout: 30_000 });
  const parsed = JSON.parse(cli.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.readiness.level, "L3");

  const reorderedCli = await execFileAsync(process.execPath, [
    "scripts/hive-loop",
    "--json",
    "--board",
    boardSlug,
    "--vaultPath",
    vaultPath,
    "--kanbanFolder",
    "Operations/Work Board",
    "audit",
  ], { cwd: repoRoot, timeout: 30_000 });
  const reorderedParsed = JSON.parse(reorderedCli.stdout);
  assert.equal(reorderedParsed.ok, true);
  assert.equal(reorderedParsed.readiness.level, "L3");

  const exportDir = await mkdtemp(join(tmpdir(), "hivemind-loop-export-"));
  await execFileAsync(process.execPath, [
    "scripts/hive-loop",
    "export",
    "--write",
    exportDir,
    "--title",
    "Fixture Project",
    "--board",
    boardSlug,
    "--vaultPath",
    vaultPath,
    "--kanbanFolder",
    "Operations/Work Board",
  ], { cwd: repoRoot, timeout: 30_000 });
  const contractMd = await readFile(join(exportDir, "contract.md"), "utf8");
  assert(contractMd.includes("Fixture Project"), "hive-loop export should write contract.md");
  await rm(exportDir, { recursive: true, force: true });

  console.log("loop readiness tests passed");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}
