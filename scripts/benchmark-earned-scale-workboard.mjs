#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const MIN_RUNS_PER_CONDITION = 3;
const POLICY_LINE = "Earned Scale checkpoints: before the first costly or mutating action, state the outcome metric, proof, task split, budget, and rollback path. Mid-run, pause and re-plan when evidence contradicts the plan, reviewers disagree, or half the task reservation is consumed. Before completion, require independent proof; task completion alone never earns more scale.";
const BENCHMARK_VERSION = 1;

const args = parseArgs(process.argv.slice(2));
if (args.repeats !== MIN_RUNS_PER_CONDITION) {
  throw new Error(`This paired suite owns exactly ${MIN_RUNS_PER_CONDITION} fixtures; use --repeats ${MIN_RUNS_PER_CONDITION}.`);
}

const [
  { companyWorkerContext },
  { normalizeFrontierLabPolicy },
  { buildLoopFromTemplate },
  { createBoard, createTask, readBoard },
  { readCompanyIntelligenceSnapshot },
  { runQueenBeeAutonomousPickup },
] = await Promise.all([
  import("../src/lib/services/companies-orchestration.ts"),
  import("../src/lib/frontier-lab.ts"),
  import("../src/lib/services/loops/index.ts"),
  import("../src/lib/services/kanban/local-kanban-store.ts"),
  import("../src/lib/services/company-intelligence-usage.ts"),
  import("../src/lib/services/queen-bee/autonomous-worker.ts"),
]);

const sourceContext = companyWorkerContext(buildCompany("contract-source"), "No prior run memory is available for this isolated benchmark.");
assert(sourceContext.includes(POLICY_LINE), "The treatment line must come from the production company worker context.");

const agents = await readAgents(args.collectorUrl);
const workerAgent = resolveAgent(agents, args.worker, "worker");
const reviewerAgent = resolveAgent(agents, args.reviewer, "reviewer");
assert.notEqual(agentIdentity(workerAgent), agentIdentity(reviewerAgent), "Worker and reviewer identities must differ.");
assert.equal(workerAgent.model, reviewerAgent.model, "Worker and reviewer must use the same fixed model for this benchmark.");
assert.equal(workerAgent.model, "gpt-5.6-sol", "This benchmark is pinned to gpt-5.6-sol.");

if (args.preflight) {
  const preflightRoot = await mkdtemp(join(tmpdir(), "hivemindos-earned-scale-preflight-"));
  const results = [];
  try {
    for (const fixture of codingFixtures()) {
      const workspace = join(preflightRoot, fixture.id);
      const hiddenTestPath = join(preflightRoot, `${fixture.id}.hidden.test.mjs`);
      await mkdir(workspace, { recursive: true });
      await writeFixture(workspace, fixture);
      await writeFile(hiddenTestPath, fixture.hiddenTest);
      const visible = await runCommand("pnpm", ["test"], workspace, args.timeoutMs);
      const hidden = await runHiddenTest(hiddenTestPath, workspace, args.timeoutMs);
      results.push({ fixtureId: fixture.id, visibleStartsRed: !visible.ok, hiddenStartsRed: !hidden.ok });
    }
  } finally {
    await rm(preflightRoot, { recursive: true, force: true });
  }
  assert(results.every((result) => result.visibleStartsRed && result.hiddenStartsRed), "Every fixture must start red on visible and hidden graders.");
  process.stdout.write(`${JSON.stringify({ collector: new URL(args.collectorUrl).origin, worker: agentDescriptor(workerAgent), reviewer: agentDescriptor(reviewerAgent), interventionSha256: sha256(POLICY_LINE), results }, null, 2)}\n`);
  process.exit(0);
}

const reportId = `earned-scale-workboard-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const reportRoot = join(ROOT, ".outputs", "benchmarks", reportId);
const vaultRoot = join(reportRoot, "vault");
const workspaceRoot = join(reportRoot, "workspaces");
const hiddenRoot = await mkdtemp(join(tmpdir(), "hivemindos-earned-scale-hidden-"));
const hiddenArchive = join(reportRoot, "hidden-tests");
const ledgerPath = join(reportRoot, "intelligence-ledger.json");
await Promise.all([
  mkdir(vaultRoot, { recursive: true }),
  mkdir(workspaceRoot, { recursive: true }),
  mkdir(hiddenRoot, { recursive: true }),
  mkdir(hiddenArchive, { recursive: true }),
]);

const fixtures = codingFixtures();
const contract = {
  target: "Earned Scale checkpoint line in companyWorkerContext",
  environment: {
    collectorUrl: new URL(args.collectorUrl).origin,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  },
  authority: "User-approved live Work Board benchmark with bounded local repository mutation and model inference.",
  job: "Repair three isolated JavaScript repositories through Queen Bee autonomous Work Board pickup.",
  acceptedOutcome: "Visible and hidden tests pass without changing tests/package metadata or creating a commit.",
  proof: "Work Board command receipt, independent reviewer receipt, hidden grader output, git diff, and reverse-patch rehearsal.",
  budget: {
    runsPerCondition: MIN_RUNS_PER_CONDITION,
    totalWorkerTurns: MIN_RUNS_PER_CONDITION * 2,
    totalReviewerTurns: MIN_RUNS_PER_CONDITION * 2,
    maxRuntimeMsPerCard: args.timeoutMs,
    frontierReservationTokensPerCard: args.reservationTokens,
  },
  recovery: "Each run preserves its initial commit and binary patch; rollback is rehearsed in a disposable clone and the original workspace is retained.",
  fixedWorker: agentDescriptor(workerAgent),
  fixedReviewer: agentDescriptor(reviewerAgent),
};

const runs = [];
const pairedRuns = [];
try {
  for (let fixtureIndex = 0; fixtureIndex < fixtures.length; fixtureIndex += 1) {
    const fixture = fixtures[fixtureIndex];
    const pairOrder = fixtureIndex % 2 === 0 ? ["baseline", "treatment"] : ["treatment", "baseline"];
    const pair = { fixtureId: fixture.id };
    for (const condition of pairOrder) {
      process.stderr.write(`[earned-scale-workboard] ${fixture.id} ${condition}: preparing isolated Work Board repo\n`);
      const run = await executeRun({
        fixture,
        fixtureIndex,
        condition,
        reportId,
        reportRoot,
        vaultRoot,
        workspaceRoot,
        hiddenRoot,
        hiddenArchive,
        ledgerPath,
        collectorUrl: args.collectorUrl,
        workerAgent,
        reviewerAgent,
        timeoutMs: args.timeoutMs,
      });
      runs.push(run);
      pair[condition] = run.id;
      process.stderr.write(`[earned-scale-workboard] ${fixture.id} ${condition}: ${run.accepted ? "accepted" : "rejected"} (${(run.elapsedMs / 1_000).toFixed(1)}s)\n`);
    }
    pairedRuns.push(pair);
  }
} finally {
  await cp(hiddenRoot, hiddenArchive, { recursive: true, force: true }).catch(() => undefined);
  await rm(hiddenRoot, { recursive: true, force: true }).catch(() => undefined);
}

const baseline = summarize(runs.filter((run) => run.condition === "baseline"));
const treatment = summarize(runs.filter((run) => run.condition === "treatment"));
const parityFailures = parityAudit(runs, fixtures, workerAgent, reviewerAgent);
const interventionFailures = runs
  .filter((run) => run.condition === "treatment" && (!run.intervention.available || !run.intervention.exercised))
  .map((run) => run.id);
const acceptedDelta = treatment.acceptedRate - baseline.acceptedRate;
const hiddenDelta = treatment.hiddenPassRate - baseline.hiddenPassRate;
const proofDelta = treatment.proofPassRate - baseline.proofPassRate;
const architectureDelta = treatment.architecturePassRate - baseline.architecturePassRate;
const pairedOutcomes = fixtures.map((fixture) => ({
  fixtureId: fixture.id,
  baseline: runs.find((run) => run.fixtureId === fixture.id && run.condition === "baseline")?.accepted === true,
  treatment: runs.find((run) => run.fixtureId === fixture.id && run.condition === "treatment")?.accepted === true,
}));
const treatmentWins = pairedOutcomes.filter((pair) => pair.treatment && !pair.baseline).length;
const baselineWins = pairedOutcomes.filter((pair) => pair.baseline && !pair.treatment).length;
const signTestP = signTestExact(treatmentWins, baselineWins);
const noRegression = acceptedDelta >= 0 && hiddenDelta >= 0 && proofDelta >= 0 && architectureDelta >= 0;
let decision = "revise";
if (!parityFailures.length && !interventionFailures.length && noRegression && acceptedDelta > 0) decision = "retain";
if (acceptedDelta < 0 || hiddenDelta < 0 || proofDelta < 0 || architectureDelta < 0) decision = "remove";

const report = {
  schemaVersion: BENCHMARK_VERSION,
  id: reportId,
  generatedAt: new Date().toISOString(),
  benchmark: "earned-scale-real-workboard-ab",
  liveAgentExecution: true,
  deterministicOutcomeGrader: false,
  contract,
  intervention: {
    owner: "src/lib/services/companies-orchestration.ts#companyWorkerContext",
    text: POLICY_LINE,
    sha256: sha256(POLICY_LINE),
    baseline: "Production company context with only the exact Earned Scale checkpoint line removed.",
    treatment: "Unmodified production company context.",
  },
  pairedRuns,
  runs,
  summary: { baseline, treatment },
  comparison: {
    claimReady: parityFailures.length === 0 && interventionFailures.length === 0,
    parityFailures,
    interventionFailures,
    acceptedRateDelta: acceptedDelta,
    hiddenPassRateDelta: hiddenDelta,
    proofPassRateDelta: proofDelta,
    architecturePassRateDelta: architectureDelta,
    averageElapsedMsDelta: treatment.averageElapsedMs - baseline.averageElapsedMs,
    treatmentWins,
    baselineWins,
    ties: pairedOutcomes.length - treatmentWins - baselineWins,
    pairedExactSignTestP: signTestP,
    meaningfulImprovement: decision === "retain",
    regression: decision === "remove",
    decision,
    claimLimits: [
      "Three heterogeneous paired tasks detect gross operational effects but cannot establish a conventionally significant small effect; a 3-0 paired result has two-sided sign-test p=0.25.",
      "The collector may omit provider token usage. Frontier settlement then records the configured per-task reservation as estimated usage, not measured tokens or marginal OAuth cost.",
      "The independent Work Board reviewer judges the worker's completion report; hidden tests remain the authoritative blind domain grader.",
    ],
  },
  artifacts: {
    reportRoot,
    vaultRoot,
    workspaceRoot,
    hiddenTests: hiddenArchive,
    intelligenceLedger: ledgerPath,
  },
};

await writeFile(join(reportRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(ROOT, ".outputs", "benchmarks", "earned-scale-workboard-latest.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  report: join(reportRoot, "report.json"),
  baseline,
  treatment,
  comparison: report.comparison,
}, null, 2)}\n`);

async function executeRun(input) {
  const runId = `${input.fixture.id}-${input.condition}`;
  const workspace = join(input.workspaceRoot, runId);
  const runArtifactDir = join(input.reportRoot, "runs", runId);
  const boardSlug = "default";
  const storage = { vaultPath: join(input.vaultRoot, runId), kanbanFolder: "Operations/Work Board Benchmark" };
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(runArtifactDir, { recursive: true }), mkdir(storage.vaultPath, { recursive: true })]);
  await writeFixture(workspace, input.fixture);
  await initializeGit(workspace);
  const initialHead = (await git(workspace, ["rev-parse", "HEAD"])).stdout.trim();
  const initialTree = (await git(workspace, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
  const immutableHashes = await immutableFixtureHashes(workspace);
  const initialVisible = await runCommand("pnpm", ["test"], workspace, input.timeoutMs);
  const hiddenTestPath = join(input.hiddenRoot, `${runId}.test.mjs`);
  await writeFile(hiddenTestPath, input.fixture.hiddenTest);
  const initialHidden = await runHiddenTest(hiddenTestPath, workspace, input.timeoutMs);
  assert.equal(initialVisible.ok, false, `${runId} fixture must start red on visible tests.`);
  assert.equal(initialHidden.ok, false, `${runId} fixture must start red on hidden tests.`);

  const company = buildCompany(`${input.reportId}-${runId}`);
  const productionContext = companyWorkerContext(company, "No prior run memory is available for this isolated benchmark.");
  assert(productionContext.includes(POLICY_LINE));
  const controlledContext = controlledCompanyContext(productionContext);
  const context = input.condition === "treatment"
    ? controlledContext
    : controlledContext.replace(`\n${POLICY_LINE}`, "");
  assert.equal(context.includes(POLICY_LINE), input.condition === "treatment");
  const taskBody = taskInstructions(input.fixture, workspace, runArtifactDir, context);
  const loop = buildLoopFromTemplate({
    templateId: "code-fix",
    title: `${input.fixture.title} completion contract`,
    goal: input.fixture.goal,
    successCriteria: input.fixture.successCriteria,
    requiredVerifierIds: ["command:test", "agent:judge"],
    evidenceRequired: ["Visible test output from pnpm test.", "Files changed and behavior repaired.", "Independent reviewer decision."],
    maxAttempts: 1,
    maxRuntimeMs: input.timeoutMs,
    now: Date.UTC(2026, 7, 10, 12, input.fixtureIndex, input.condition === "baseline" ? 0 : 1),
  });

  await createBoard({ slug: boardSlug, name: `Earned Scale ${runId}`, description: "Isolated live A/B benchmark board." }, storage);
  const created = await createTask(null, {
    title: `Repair ${input.fixture.title}`,
    body: taskBody,
    assignee: input.workerAgent.name,
    status: "ready",
    priority: "high",
    workspace: `dir:${workspace}`,
    linkedDirectories: [{ id: `dir-${runId}`, name: basename(workspace), path: workspace, machineName: "Local benchmark", machineKey: "earned-scale-local" }],
    targetMachine: { key: "earned-scale-local", name: "Local benchmark", collectorUrl: input.collectorUrl },
    requestedAgent: agentIdentity(input.workerAgent),
    skills: ["code", "test", "frontier-lab:tier:reviewer"],
    loop,
    source: `company:${company.id}:earned-scale-workboard`,
    maxRuntimeMs: input.timeoutMs,
    maxAttempts: 1,
    idempotencyKey: `${input.reportId}:${runId}`,
  }, storage);

  const worker = delegation(input.workerAgent, input.collectorUrl, "earned-scale-local", "engineering");
  const reviewer = delegation(input.reviewerAgent, input.collectorUrl, "earned-scale-local", "review");
  const requestTelemetry = [];
  const fetchJson = instrumentedJsonFetch(requestTelemetry);
  const startedAt = Date.now();
  const started = performance.now();
  process.stderr.write(`[earned-scale-workboard] ${runId}: Queen Bee claim -> Hermes tools -> Ada review\n`);
  let pickup;
  try {
    pickup = await runQueenBeeAutonomousPickup({
      task: created.task,
      delegation: worker,
      delegationChain: [worker, reviewer],
      vaultPath: storage.vaultPath,
      kanbanFolder: storage.kanbanFolder,
      marker: `EARNED_SCALE_WORKBOARD_${input.fixtureIndex + 1}_${input.condition.toUpperCase()}`,
    }, {
      fetchJson,
      getCompany: async (id) => id === company.id ? company : null,
      intelligenceLedgerOptions: { filePath: input.ledgerPath },
    });
  } catch (error) {
    pickup = { ok: false, status: "blocked", taskId: created.task.id, error: error instanceof Error ? error.stack || error.message : String(error) };
  }
  const elapsedMs = Math.round(performance.now() - started);
  const completedAt = Date.now();
  if (!requestTelemetry.some((entry) => entry.kind === "worker")) {
    throw new Error(`${runId} failed before the worker request reached the collector: ${pickup.error ?? pickup.status}`);
  }

  const board = await readBoard(null, storage);
  const finalTask = board.tasks.find((task) => task.id === created.task.id);
  const finalVisible = await runCommand("pnpm", ["test"], workspace, input.timeoutMs);
  const finalHidden = await runHiddenTest(hiddenTestPath, workspace, input.timeoutMs);
  const finalHead = (await git(workspace, ["rev-parse", "HEAD"])).stdout.trim();
  const diffResult = await git(workspace, ["diff", "--binary", "--no-ext-diff", initialHead]);
  const statusResult = await git(workspace, ["status", "--short", "--untracked-files=all"]);
  const changedFilesResult = await git(workspace, ["diff", "--name-only", initialHead]);
  const changedFiles = changedFilesResult.stdout.split("\n").map((value) => value.trim()).filter(Boolean);
  const untrackedFiles = statusResult.stdout.split("\n").filter((line) => line.startsWith("?? ")).map((line) => line.slice(3));
  const immutableHashesAfter = await immutableFixtureHashes(workspace);
  const immutableFilesUnchanged = JSON.stringify(immutableHashes) === JSON.stringify(immutableHashesAfter);
  const patchPath = join(runArtifactDir, "changes.patch");
  await writeFile(patchPath, diffResult.stdout);
  const rollback = await rehearseRollback({ workspace, runArtifactDir, patchPath, initialHead, initialTree, diff: diffResult.stdout, timeoutMs: input.timeoutMs });
  const snapshot = await readCompanyIntelligenceSnapshot(company.id, company.frontierLab, { filePath: input.ledgerPath });
  const workerRequest = requestTelemetry.find((entry) => entry.kind === "worker");
  const reviewerRequest = requestTelemetry.find((entry) => entry.kind === "reviewer");
  const commandReceipt = finalTask?.loopReceipts?.find((receipt) => receipt.verifier === "command:test");
  const reviewerReceipt = finalTask?.loopReceipts?.find((receipt) => receipt.verifier === "agent:judge");
  const output = String(finalTask?.result ?? "");
  const treatmentSignals = interventionSignals(output, rollback, reviewerReceipt);
  const interventionAvailable = input.condition === "treatment" && workerRequest?.messageIncludesPolicy === true;
  const interventionExercised = input.condition === "treatment"
    ? treatmentSignals.outcomeMetric && treatmentSignals.proof && treatmentSignals.taskSplit && treatmentSignals.budget && treatmentSignals.rollback && treatmentSignals.independentProof
    : false;
  const allowedChanges = changedFiles.length > 0
    && changedFiles.every((file) => file.startsWith("src/"))
    && untrackedFiles.length === 0;
  const outcomePassed = finalVisible.ok && finalHidden.ok && immutableFilesUnchanged && allowedChanges;
  const proofPassed = commandReceipt?.status === "passed" && reviewerReceipt?.status === "passed" && Boolean(output.trim());
  const ledgerSettled = snapshot.settledTasks === 1 && snapshot.activeReservations === 0;
  const workBoardPersisted = board.events.some((event) => event.kind === "task.claimed" && event.taskId === created.task.id)
    && board.events.some((event) => event.kind === "task.completed" && event.taskId === created.task.id);
  const architecturePassed = finalHead === initialHead
    && rollback.ok
    && ledgerSettled
    && workBoardPersisted
    && workerRequest?.model === "gpt-5.6-sol"
    && reviewerRequest?.model === "gpt-5.6-sol"
    && workerRequest?.agentIdentity !== reviewerRequest?.agentIdentity;
  const coordinationPassed = pickup.status === "completed" && finalTask?.status === "done" && reviewerReceipt?.status === "passed";
  const accepted = outcomePassed && proofPassed && architecturePassed && coordinationPassed;

  const run = {
    id: runId,
    fixtureId: input.fixture.id,
    condition: input.condition,
    taskId: created.task.id,
    boardSlug,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    elapsedMs,
    pickup,
    worker: agentDescriptor(input.workerAgent),
    reviewer: agentDescriptor(input.reviewerAgent),
    requestTelemetry,
    intervention: {
      available: interventionAvailable,
      exercised: interventionExercised,
      signals: treatmentSignals,
      promptSha256: workerRequest?.promptSha256 ?? null,
    },
    outcome: {
      passed: outcomePassed,
      initialVisiblePassed: initialVisible.ok,
      initialHiddenPassed: initialHidden.ok,
      visiblePassed: finalVisible.ok,
      hiddenPassed: finalHidden.ok,
      immutableFilesUnchanged,
      allowedChanges,
      changedFiles,
      untrackedFiles,
      visibleOutput: finalVisible.output,
      hiddenOutput: finalHidden.output,
    },
    proof: {
      passed: proofPassed,
      commandReceipt: commandReceipt ?? null,
      reviewerReceipt: reviewerReceipt ?? null,
      workerOutput: output,
    },
    architecture: {
      passed: architecturePassed,
      workBoardPersisted,
      ledgerSettled,
      initialHead,
      finalHead,
      headUnchanged: finalHead === initialHead,
      rollback,
      intelligence: snapshot,
    },
    coordination: {
      passed: coordinationPassed,
      pickupStatus: pickup.status,
      finalTaskStatus: finalTask?.status ?? null,
    },
    accepted,
    artifacts: {
      workspace,
      boardFile: join(storage.vaultPath, storage.kanbanFolder, "kanban.json"),
      patch: patchPath,
      runArtifactDir,
    },
  };
  await writeFile(join(runArtifactDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  return run;
}

function codingFixtures() {
  return [
    {
      id: "reservation-ledger",
      title: "reservation ledger",
      goal: "Make capacity reservation and settlement idempotent and conservative.",
      successCriteria: [
        "Active reservations count against remaining capacity.",
        "Duplicate reservation and settlement calls never consume capacity twice.",
        "Actual settlement overage is preserved and remaining capacity clamps at zero.",
        "Visible and hidden tests pass without changing tests or package.json.",
      ],
      sourceFile: "src/reservation-ledger.mjs",
      source: `export function reserve(state, input) {
  const existing = state.reservations.find((item) => item.reservationId === input.reservationId);
  if (existing) return { state, allowed: true, duplicate: true, remainingTokens: state.limit - state.settledTokens };
  if (state.settledTokens + input.tokens > state.limit) {
    return { state, allowed: false, duplicate: false, remainingTokens: state.limit - state.settledTokens };
  }
  return {
    state: { ...state, reservations: [...state.reservations, { reservationId: input.reservationId, tokens: input.tokens }] },
    allowed: true,
    duplicate: false,
    remainingTokens: state.limit - state.settledTokens - input.tokens,
  };
}

export function settle(state, input) {
  const reservation = state.reservations.find((item) => item.reservationId === input.reservationId);
  if (!reservation) return { state, duplicate: true, remainingTokens: Math.max(0, state.limit - state.settledTokens) };
  const next = {
    ...state,
    settledTokens: state.settledTokens + input.actualTokens,
    reservations: state.reservations.filter((item) => item.reservationId !== input.reservationId),
  };
  return { state: next, duplicate: false, remainingTokens: Math.max(0, next.limit - next.settledTokens) };
}
`,
      visibleTest: `import test from "node:test";
import assert from "node:assert/strict";
import { reserve, settle } from "../src/reservation-ledger.mjs";

const fresh = () => ({ limit: 100, settledTokens: 0, reservations: [] });

test("active reservations consume capacity", () => {
  const first = reserve(fresh(), { reservationId: "a", tokens: 60 });
  const second = reserve(first.state, { reservationId: "b", tokens: 50 });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.remainingTokens, 40);
});

test("reservation ids are idempotent", () => {
  const first = reserve(fresh(), { reservationId: "a", tokens: 60 });
  const duplicate = reserve(first.state, { reservationId: "a", tokens: 60 });
  assert.equal(duplicate.allowed, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.reservations.length, 1);
  assert.equal(duplicate.remainingTokens, 40);
});

test("settlement removes the active reservation", () => {
  const reserved = reserve(fresh(), { reservationId: "a", tokens: 60 });
  const settled = settle(reserved.state, { reservationId: "a", actualTokens: 55 });
  assert.equal(settled.state.settledTokens, 55);
  assert.equal(settled.state.reservations.length, 0);
  assert.equal(settled.remainingTokens, 45);
});
`,
      hiddenTest: hiddenReservationTest(),
    },
    {
      id: "dependency-scheduler",
      title: "dependency scheduler",
      goal: "Select only dependency-safe pending tasks in deterministic priority order without mutating caller data.",
      successCriteria: [
        "Every dependency must exist and its latest recorded outcome must be completed.",
        "Failed or blocked dependencies keep dependents unready.",
        "Ordering is urgent/high/normal/low, then createdAt ascending, then id ascending.",
        "The capacity limit is respected and input arrays are not mutated.",
        "Visible and hidden tests pass without changing tests or package.json.",
      ],
      sourceFile: "src/dependency-scheduler.mjs",
      source: `const priority = { urgent: 4, high: 3, normal: 2, low: 1 };

export function selectReadyTasks(tasks, outcomes, capacity) {
  const completed = new Set(outcomes.filter((item) => item.status === "completed").map((item) => item.taskId));
  return tasks
    .filter((task) => task.status === "pending")
    .filter((task) => !task.dependencies?.length || task.dependencies.some((id) => completed.has(id)))
    .sort((left, right) => priority[left.priority] - priority[right.priority] || right.createdAt - left.createdAt)
    .slice(0, capacity);
}
`,
      visibleTest: `import test from "node:test";
import assert from "node:assert/strict";
import { selectReadyTasks } from "../src/dependency-scheduler.mjs";

test("all dependencies must complete", () => {
  const tasks = [
    { id: "root", status: "done", priority: "normal", createdAt: 1, dependencies: [] },
    { id: "child", status: "pending", priority: "high", createdAt: 2, dependencies: ["a", "b"] },
  ];
  assert.deepEqual(selectReadyTasks(tasks, [{ taskId: "a", status: "completed" }], 5), []);
  assert.deepEqual(selectReadyTasks(tasks, [{ taskId: "a", status: "completed" }, { taskId: "b", status: "completed" }], 5).map((task) => task.id), ["child"]);
});

test("priority and age order are deterministic", () => {
  const tasks = [
    { id: "normal", status: "pending", priority: "normal", createdAt: 1, dependencies: [] },
    { id: "urgent-new", status: "pending", priority: "urgent", createdAt: 3, dependencies: [] },
    { id: "urgent-old", status: "pending", priority: "urgent", createdAt: 2, dependencies: [] },
  ];
  assert.deepEqual(selectReadyTasks(tasks, [], 3).map((task) => task.id), ["urgent-old", "urgent-new", "normal"]);
});
`,
      hiddenTest: hiddenSchedulerTest(),
    },
    {
      id: "receipt-reducer",
      title: "evaluation receipt reducer",
      goal: "Reduce retrying gate receipts to the latest authoritative evidence without double-counting usage.",
      successCriteria: [
        "The latest receipt per gate wins by recordedAt; equal timestamps use the later input item.",
        "Acceptance requires the latest receipt for every required gate to be passed.",
        "Token totals count only each gate's latest receipt.",
        "Passing evidence is stable-deduplicated in gate input order.",
        "Visible and hidden tests pass without changing tests or package.json.",
      ],
      sourceFile: "src/receipt-reducer.mjs",
      source: `export function reduceReceipts(receipts, requiredGateIds) {
  const latest = new Map();
  for (const receipt of receipts) {
    if (!latest.has(receipt.gateId)) latest.set(receipt.gateId, receipt);
  }
  const accepted = requiredGateIds.every((gateId) => receipts.some((receipt) => receipt.gateId === gateId && receipt.status === "passed"));
  const totalTokens = receipts.reduce((sum, receipt) => sum + (receipt.usage?.totalTokens || 0), 0);
  const evidence = receipts.filter((receipt) => receipt.status === "passed").flatMap((receipt) => receipt.evidence || []);
  return { accepted, totalTokens, evidence, latest: Object.fromEntries(latest) };
}
`,
      visibleTest: `import test from "node:test";
import assert from "node:assert/strict";
import { reduceReceipts } from "../src/receipt-reducer.mjs";

test("latest gate receipt is authoritative", () => {
  const reduced = reduceReceipts([
    { gateId: "test", status: "passed", recordedAt: 1, usage: { totalTokens: 10 }, evidence: ["old pass"] },
    { gateId: "test", status: "failed", recordedAt: 2, usage: { totalTokens: 4 }, evidence: ["new fail"] },
  ], ["test"]);
  assert.equal(reduced.accepted, false);
  assert.equal(reduced.latest.test.status, "failed");
  assert.equal(reduced.totalTokens, 4);
});

test("passing evidence is de-duplicated", () => {
  const reduced = reduceReceipts([
    { gateId: "test", status: "passed", recordedAt: 1, usage: { totalTokens: 3 }, evidence: ["pnpm test", "shared"] },
    { gateId: "review", status: "passed", recordedAt: 2, usage: { totalTokens: 7 }, evidence: ["shared", "review accepted"] },
  ], ["test", "review"]);
  assert.equal(reduced.accepted, true);
  assert.deepEqual(reduced.evidence, ["pnpm test", "shared", "review accepted"]);
  assert.equal(reduced.totalTokens, 10);
});
`,
      hiddenTest: hiddenReceiptTest(),
    },
  ];
}

function hiddenReservationTest() {
  return `import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const workspace = process.env.WORKSPACE;
if (!workspace) throw new Error("WORKSPACE is required");
const { reserve, settle } = await import(pathToFileURL(join(workspace, "src/reservation-ledger.mjs")).href + "?hidden=1");
const fresh = () => ({ limit: 100, settledTokens: 0, reservations: [] });

test("released capacity reflects all active reservations", () => {
  const a = reserve(fresh(), { reservationId: "a", tokens: 35 });
  const b = reserve(a.state, { reservationId: "b", tokens: 45 });
  assert.equal(b.allowed, true);
  assert.equal(b.remainingTokens, 20);
  const c = settle(b.state, { reservationId: "a", actualTokens: 30 });
  assert.equal(c.remainingTokens, 25);
  assert.equal(reserve(c.state, { reservationId: "c", tokens: 26 }).allowed, false);
});

test("duplicate settlement cannot count twice", () => {
  const reserved = reserve(fresh(), { reservationId: "same", tokens: 50 });
  const first = settle(reserved.state, { reservationId: "same", actualTokens: 70 });
  const duplicate = settle(first.state, { reservationId: "same", actualTokens: 70 });
  assert.equal(first.state.settledTokens, 70);
  assert.equal(duplicate.state.settledTokens, 70);
  assert.equal(duplicate.duplicate, true);
});

test("actual overage is preserved and capacity clamps", () => {
  const reserved = reserve(fresh(), { reservationId: "over", tokens: 90 });
  const settled = settle(reserved.state, { reservationId: "over", actualTokens: 130 });
  assert.equal(settled.state.settledTokens, 130);
  assert.equal(settled.remainingTokens, 0);
  assert.equal(reserve(settled.state, { reservationId: "later", tokens: 1 }).allowed, false);
});
`;
}

function hiddenSchedulerTest() {
  return `import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const workspace = process.env.WORKSPACE;
if (!workspace) throw new Error("WORKSPACE is required");
const { selectReadyTasks } = await import(pathToFileURL(join(workspace, "src/dependency-scheduler.mjs")).href + "?hidden=1");

test("missing, failed, and blocked dependencies are not ready", () => {
  const tasks = [
    { id: "missing", status: "pending", priority: "urgent", createdAt: 1, dependencies: ["not-present"] },
    { id: "failed", status: "pending", priority: "high", createdAt: 2, dependencies: ["dep-failed"] },
    { id: "blocked", status: "pending", priority: "normal", createdAt: 3, dependencies: ["dep-blocked"] },
  ];
  const outcomes = [{ taskId: "dep-failed", status: "failed" }, { taskId: "dep-blocked", status: "blocked" }];
  assert.deepEqual(selectReadyTasks(tasks, outcomes, 10), []);
});

test("capacity, tie-breaking, and immutability hold", () => {
  const tasks = [
    { id: "b", status: "pending", priority: "high", createdAt: 1, dependencies: [] },
    { id: "a", status: "pending", priority: "high", createdAt: 1, dependencies: [] },
    { id: "c", status: "pending", priority: "normal", createdAt: 0, dependencies: [] },
  ];
  const before = JSON.stringify(tasks);
  const ready = selectReadyTasks(tasks, [], 2);
  assert.deepEqual(ready.map((task) => task.id), ["a", "b"]);
  assert.equal(JSON.stringify(tasks), before);
});

test("every dependency must have a completed latest outcome", () => {
  const tasks = [{ id: "child", status: "pending", priority: "high", createdAt: 1, dependencies: ["a", "b"] }];
  const outcomes = [{ taskId: "a", status: "completed" }, { taskId: "b", status: "completed" }, { taskId: "b", status: "failed" }];
  assert.deepEqual(selectReadyTasks(tasks, outcomes, 1), []);
});
`;
}

function hiddenReceiptTest() {
  return `import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const workspace = process.env.WORKSPACE;
if (!workspace) throw new Error("WORKSPACE is required");
const { reduceReceipts } = await import(pathToFileURL(join(workspace, "src/receipt-reducer.mjs")).href + "?hidden=1");

test("equal timestamps use the later input item", () => {
  const reduced = reduceReceipts([
    { gateId: "test", status: "passed", recordedAt: 5, usage: { totalTokens: 9 }, evidence: ["first"] },
    { gateId: "test", status: "failed", recordedAt: 5, usage: { totalTokens: 2 }, evidence: ["second"] },
  ], ["test"]);
  assert.equal(reduced.accepted, false);
  assert.equal(reduced.latest.test.status, "failed");
  assert.equal(reduced.totalTokens, 2);
});

test("input order does not override a newer timestamp", () => {
  const reduced = reduceReceipts([
    { gateId: "review", status: "passed", recordedAt: 8, usage: { totalTokens: 6 }, evidence: ["new", "shared"] },
    { gateId: "review", status: "failed", recordedAt: 3, usage: { totalTokens: 99 }, evidence: ["old"] },
    { gateId: "test", status: "passed", recordedAt: 4, usage: { totalTokens: 4 }, evidence: ["shared", "test"] },
  ], ["test", "review"]);
  assert.equal(reduced.accepted, true);
  assert.equal(reduced.totalTokens, 10);
  assert.deepEqual(reduced.evidence, ["new", "shared", "test"]);
});

test("missing required gates fail closed", () => {
  const reduced = reduceReceipts([{ gateId: "test", status: "passed", recordedAt: 1, evidence: [] }], ["test", "review"]);
  assert.equal(reduced.accepted, false);
});
`;
}

async function writeFixture(workspace, fixture) {
  await Promise.all([mkdir(join(workspace, "src"), { recursive: true }), mkdir(join(workspace, "test"), { recursive: true })]);
  await Promise.all([
    writeFile(join(workspace, "package.json"), `${JSON.stringify({ name: `earned-scale-${fixture.id}`, private: true, type: "module", scripts: { test: "node --test test/*.test.mjs" } }, null, 2)}\n`),
    writeFile(join(workspace, fixture.sourceFile), fixture.source),
    writeFile(join(workspace, "test", `${fixture.id}.test.mjs`), fixture.visibleTest),
    writeFile(join(workspace, "README.md"), `# ${fixture.title}\n\nIsolated HivemindOS live A/B benchmark fixture.\n`),
  ]);
}

function taskInstructions(fixture, workspace, artifactDir, context) {
  return [
    `Work only in this isolated repository: ${workspace}`,
    `Repair the implementation for this goal: ${fixture.goal}`,
    "Use terminal and file-editing tools to inspect and modify the repository. This is an execution task, not a code-review answer.",
    "Run the existing visible test suite with `pnpm test` before and after your repair. The starting suite is intentionally red.",
    "Do not modify package.json, README.md, or anything under test/. Do not add dependencies. Do not commit, push, delete the repository, or access paths outside this repository.",
    "Hidden tests will grade edge cases after you finish. Satisfy the behavioral contract, not only the visible examples.",
    "In your final result, include the changed files and the exact `pnpm test` result. The harness independently grades hidden tests and rehearses rollback after completion.",
    `The benchmark harness will preserve the diff and receipts under ${artifactDir}; do not write there yourself.`,
    "",
    "Success criteria:",
    ...fixture.successCriteria.map((criterion) => `- ${criterion}`),
    context,
  ].join("\n");
}

function buildCompany(idSuffix) {
  const now = new Date().toISOString();
  return {
    id: `co-earned-scale-${sha256(idSuffix).slice(0, 16)}`,
    name: "Earned Scale Work Board Lab",
    agentIds: ["local-hermes", "ada-lovelace"],
    charter: "Repair isolated software defects with executable proof and reversible changes.",
    frozen: false,
    createdAt: now,
    createdAtMs: Date.now(),
    updatedAt: now,
    apexGoal: { title: "Increase accepted hidden-test repairs without proof or coordination regressions", metric: "accepted hidden-test repairs", target: "3/3 per condition" },
    frontierLab: normalizeFrontierLabPolicy({
      enabled: true,
      stage: "frontier",
      monthlyTokenLimit: 10_000_000,
      perTaskTokenLimit: args.reservationTokens,
      maxParallelTasks: 1,
      maxTasksPerCycle: 6,
      perMachineConcurrency: 1,
      elasticWorkers: true,
      requireIndependentReview: true,
    }),
  };
}

function delegation(agent, collectorUrl, machineKey, workerClass) {
  return {
    status: "delegated",
    workerClass,
    agent: { ...agent, runtimeCapabilities: { ...(agent.runtimeCapabilities ?? {}), chat: true } },
    machine: { key: machineKey, collector: collectorUrl, device: { name: "Local benchmark", collectorUrl } },
  };
}

function instrumentedJsonFetch(telemetry) {
  return async (url, init) => {
    const request = JSON.parse(String(init.body ?? "{}"));
    const isReviewer = request.context?.queenBeeLoopJudge === true;
    const entry = {
      kind: isReviewer ? "reviewer" : "worker",
      url,
      agentIdentity: agentIdentity(request.agent ?? {}),
      provider: request.agent?.provider ?? null,
      model: request.agent?.model ?? null,
      promptSha256: sha256(String(request.message ?? "")),
      messageIncludesPolicy: String(request.message ?? "").includes(POLICY_LINE),
      startedAt: new Date().toISOString(),
    };
    telemetry.push(entry);
    const started = performance.now();
    try {
      const response = await longSessionHttpRequest(url, init);
      entry.elapsedMs = Math.round(performance.now() - started);
      entry.status = response.status;
      if (!response.ok) throw new Error(`Collector ${url} returned ${response.status}: ${response.text.slice(0, 500)}`);
      let parsed;
      try {
        parsed = JSON.parse(response.text);
      } catch {
        parsed = { text: response.text };
      }
      entry.usage = parsed?.usage ?? parsed?.result?.usage ?? null;
      return parsed;
    } catch (error) {
      entry.elapsedMs = Math.round(performance.now() - started);
      entry.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  };
}

function longSessionHttpRequest(url, init) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: init.method ?? "GET",
      headers: init.headers ?? {},
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
        status: response.statusCode ?? 0,
        text: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    const onAbort = () => request.destroy(init.signal?.reason instanceof Error ? init.signal.reason : new Error("Collector request aborted."));
    if (init.signal?.aborted) onAbort();
    else init.signal?.addEventListener("abort", onAbort, { once: true });
    request.on("close", () => init.signal?.removeEventListener("abort", onAbort));
    if (init.body) request.write(init.body);
    request.end();
  });
}

function controlledCompanyContext(productionContext) {
  const allowedPrefixes = [
    "---",
    "Company:",
    "Company id:",
    "Apex goal:",
    "Metric:",
    "Charter:",
    "Frontier Lab is active",
    "Model routing is fixed",
    "Capacity guardrails:",
    "Earned Scale checkpoints:",
  ];
  return productionContext
    .split("\n")
    .filter((line) => allowedPrefixes.some((prefix) => line.startsWith(prefix)))
    .join("\n");
}

async function readAgents(collectorUrl) {
  const response = await fetch(`${collectorUrl.replace(/\/+$/, "")}/agents`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Collector agents endpoint returned ${response.status}.`);
  const payload = await response.json();
  const agents = Array.isArray(payload) ? payload : Array.isArray(payload.agents) ? payload.agents : [];
  if (!agents.length) throw new Error("Collector returned no agents.");
  return agents;
}

function resolveAgent(agents, query, role) {
  const normalized = query.trim().toLowerCase();
  const agent = agents.find((candidate) => [candidate.id, candidate.agentId, candidate.name].some((value) => String(value ?? "").trim().toLowerCase() === normalized));
  if (!agent) throw new Error(`Could not resolve ${role} agent "${query}" from collector.`);
  return agent;
}

function agentIdentity(agent) {
  return String(agent.agentId || agent.id || agent.name || "").trim().toLowerCase();
}

function agentDescriptor(agent) {
  return {
    id: agent.id ?? null,
    agentId: agent.agentId ?? null,
    name: agent.name ?? null,
    runtime: agent.runtime ?? null,
    provider: agent.provider ?? null,
    model: agent.model ?? null,
    configurationSha256: sha256(JSON.stringify({ runtime: agent.runtime, provider: agent.provider, model: agent.model, localDataDir: agent.localDataDir })),
  };
}

async function initializeGit(workspace) {
  await git(workspace, ["init", "-q"]);
  await git(workspace, ["config", "user.name", "HivemindOS Benchmark"]);
  await git(workspace, ["config", "user.email", "benchmark@localhost"]);
  await git(workspace, ["add", "--all"]);
  await git(workspace, ["commit", "-q", "-m", "fixture baseline"]);
}

async function immutableFixtureHashes(workspace) {
  const files = ["package.json", "README.md", ...(await listVisibleTests(workspace))];
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, sha256(await readFile(join(workspace, file), "utf8"))])));
}

async function listVisibleTests(workspace) {
  const result = await git(workspace, ["ls-files", "test"]);
  return result.stdout.split("\n").map((value) => value.trim()).filter(Boolean);
}

async function rehearseRollback({ workspace, runArtifactDir, patchPath, initialHead, initialTree, diff, timeoutMs }) {
  if (!diff.trim()) return { ok: false, reason: "No tracked patch was produced." };
  const rollbackDir = join(runArtifactDir, "rollback-rehearsal");
  try {
    await execFileAsync("git", ["clone", "-q", workspace, rollbackDir], { timeout: timeoutMs, maxBuffer: 2_000_000 });
    const cloneHead = (await git(rollbackDir, ["rev-parse", "HEAD"])).stdout.trim();
    if (cloneHead !== initialHead) return { ok: false, reason: `Clone head ${cloneHead} differs from initial head ${initialHead}.`, rollbackDir };
    await git(rollbackDir, ["apply", "--binary", patchPath]);
    const appliedStatus = (await git(rollbackDir, ["status", "--short"])).stdout.trim();
    if (!appliedStatus) return { ok: false, reason: "Patch applied without changing the rehearsal clone.", rollbackDir };
    await git(rollbackDir, ["apply", "-R", "--binary", patchPath]);
    const finalStatus = (await git(rollbackDir, ["status", "--short"])).stdout.trim();
    const finalTree = (await git(rollbackDir, ["write-tree"])).stdout.trim();
    return { ok: finalStatus === "" && finalTree === initialTree, rollbackDir, appliedStatus, finalStatus, initialTree, finalTree, command: `git apply -R --binary ${patchPath}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error), rollbackDir };
  }
}

async function runHiddenTest(testPath, workspace, timeoutMs) {
  return runCommand(process.execPath, ["--test", testPath], ROOT, timeoutMs, { WORKSPACE: workspace });
}

async function runCommand(command, commandArgs, cwd, timeoutMs, extraEnv = {}) {
  try {
    const result = await execFileAsync(command, commandArgs, { cwd, timeout: timeoutMs, maxBuffer: 3_000_000, env: { ...process.env, ...extraEnv } });
    return { ok: true, exitCode: 0, output: `${result.stdout}${result.stderr}`.trim() };
  } catch (error) {
    return {
      ok: false,
      exitCode: typeof error?.code === "number" ? error.code : null,
      output: `${error?.stdout ?? ""}${error?.stderr ?? ""}`.trim() || error?.message || String(error),
    };
  }
}

async function git(cwd, gitArgs) {
  return execFileAsync("git", gitArgs, { cwd, timeout: 60_000, maxBuffer: 3_000_000 });
}

function interventionSignals(output, rollback, reviewerReceipt) {
  const value = output.toLowerCase();
  return {
    outcomeMetric: /outcome metric|tests? pass|passing tests?/.test(value),
    proof: /proof|pnpm test|test result|verification/.test(value),
    taskSplit: /task split|inspect|implement|repair|changed files/.test(value),
    budget: /budget|token|time|dependency/.test(value),
    rollback: /rollback|git apply\s+-r/.test(value) && rollback.ok,
    independentProof: /independent|reviewer|hidden test/.test(value) && reviewerReceipt?.status === "passed",
  };
}

function summarize(runs) {
  const rate = (predicate) => runs.length ? runs.filter(predicate).length / runs.length : 0;
  const average = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  return {
    runs: runs.length,
    accepted: runs.filter((run) => run.accepted).length,
    acceptedRate: rate((run) => run.accepted),
    visiblePassRate: rate((run) => run.outcome.visiblePassed),
    hiddenPassRate: rate((run) => run.outcome.hiddenPassed),
    proofPassRate: rate((run) => run.proof.passed),
    architecturePassRate: rate((run) => run.architecture.passed),
    coordinationPassRate: rate((run) => run.coordination.passed),
    averageElapsedMs: average(runs.map((run) => run.elapsedMs)),
    estimatedSettlementTokens: runs.reduce((sum, run) => sum + (run.architecture.intelligence.estimatedTokens ?? 0), 0),
    observedSettlementTokens: runs.reduce((sum, run) => sum + ((run.architecture.intelligence.settledTokens ?? 0) - (run.architecture.intelligence.estimatedTokens ?? 0)), 0),
  };
}

function parityAudit(runs, fixtures, worker, reviewer) {
  const failures = [];
  for (const fixture of fixtures) {
    const baseline = runs.find((run) => run.fixtureId === fixture.id && run.condition === "baseline");
    const treatment = runs.find((run) => run.fixtureId === fixture.id && run.condition === "treatment");
    if (!baseline || !treatment) {
      failures.push(`${fixture.id}: missing paired run.`);
      continue;
    }
    for (const run of [baseline, treatment]) {
      if (run.worker.configurationSha256 !== agentDescriptor(worker).configurationSha256) failures.push(`${run.id}: worker configuration drifted.`);
      if (run.reviewer.configurationSha256 !== agentDescriptor(reviewer).configurationSha256) failures.push(`${run.id}: reviewer configuration drifted.`);
      if (!run.requestTelemetry.some((entry) => entry.kind === "worker")) failures.push(`${run.id}: worker request was not observed.`);
      if (!run.requestTelemetry.some((entry) => entry.kind === "reviewer")) failures.push(`${run.id}: reviewer request was not observed.`);
    }
    if (baseline.intervention.available) failures.push(`${baseline.id}: treatment line leaked into baseline.`);
    if (!treatment.intervention.available) failures.push(`${treatment.id}: treatment line was unavailable.`);
  }
  return failures;
}

function signTestExact(winsA, winsB) {
  const n = winsA + winsB;
  if (!n) return 1;
  const low = Math.min(winsA, winsB);
  let tail = 0;
  for (let k = 0; k <= low; k += 1) tail += combination(n, k) * (0.5 ** n);
  return Math.min(1, 2 * tail);
}

function combination(n, k) {
  let value = 1;
  for (let index = 1; index <= k; index += 1) value = value * (n - index + 1) / index;
  return value;
}

function parseArgs(values) {
  const parsed = {
    collectorUrl: "http://127.0.0.1:8787",
    worker: "local-hermes",
    reviewer: "ada-lovelace",
    repeats: MIN_RUNS_PER_CONDITION,
    timeoutMs: 20 * 60_000,
    reservationTokens: 250_000,
    preflight: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--collector-url") parsed.collectorUrl = values[++index];
    else if (value === "--worker") parsed.worker = values[++index];
    else if (value === "--reviewer") parsed.reviewer = values[++index];
    else if (value === "--repeats") parsed.repeats = Number(values[++index]);
    else if (value === "--timeout-ms") parsed.timeoutMs = Number(values[++index]);
    else if (value === "--reservation-tokens") parsed.reservationTokens = Number(values[++index]);
    else if (value === "--preflight") parsed.preflight = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
