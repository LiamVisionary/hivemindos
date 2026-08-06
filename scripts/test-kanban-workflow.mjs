#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.KANBAN_TEST_BASE_URL || "http://127.0.0.1:5020";

// Dashboard /api routes 401 tokenless since the API auth gate moved to
// src/proxy.ts (same resolution order as scripts/fleet-health-watchdog.mjs).
function envFileValue(path, key) {
  if (!existsSync(path)) return "";
  const match = readFileSync(path, "utf8").match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.+)\\s*$`, "m"));
  let value = match?.[1]?.trim() ?? "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value.trim();
}

const deviceToken = (
  process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || envFileValue(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
  || envFileValue(join(homedir(), ".hivemindos", ".env"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
).trim();

function dashboardHeaders(extra = {}) {
  return deviceToken ? { ...extra, "x-hivemindos-device-token": deviceToken } : extra;
}
const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const vaultPath = join(tmpdir(), `hivemindos-kanban-workflow-${runId}`);
const kanbanFolder = "Projects/Test/Kanban";
const board = `workflow-${runId}`.replace(/[^a-z0-9_-]/g, "-").slice(0, 63);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(method, body = {}, params = {}) {
  const url = new URL(`/api/kanban`, baseUrl);
  url.searchParams.set("board", board);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: dashboardHeaders({ "Content-Type": "application/json" }),
    body: method === "GET" ? undefined : JSON.stringify({ vaultPath, kanbanFolder, ...body }),
  });
  const data = await response.json().catch(() => null);
  assert(response.ok && data?.ok, `${method} ${url.pathname} failed: ${data?.error ?? response.status}`);
  return data;
}

async function projectRequest(path, body = {}, params = {}) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: "POST",
    headers: dashboardHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ vaultPath, ...body }),
  });
  const data = await response.json().catch(() => null);
  assert(response.ok && data?.ok, `POST ${url.pathname} failed: ${data?.error ?? response.status}`);
  return data;
}

async function createTask(title, status, extra = {}) {
  const data = await request("POST", {
    title,
    body: "",
    status,
    priority: "normal",
    ...extra,
  });
  assert(data.task?.title === title, `Expected task ${title} to be created.`);
  return data.task;
}

async function moveTask(task, status) {
  const data = await request("PATCH", { taskId: task.id, status });
  assert(data.task?.status === status, `Expected ${task.title} to move to ${status}, got ${data.task?.status}.`);
  return data.task;
}

async function patchTask(task, patch) {
  const data = await request("PATCH", { taskId: task.id, patch });
  return data.task;
}

async function main() {
  await mkdir(vaultPath, { recursive: true });
  try {
    let lifecycle = await createTask("workflow lifecycle", "ideas");
    assert(lifecycle.status === "ideas", "New idea should stay in Ideas.");
    lifecycle = await moveTask(lifecycle, "ready");
    assert(!lifecycle.assignee, "Moving an idea to Ready should not invent an assignee.");
    lifecycle = await patchTask(lifecycle, {
      status: "working",
      assignee: "Hermes on Test Machine",
      tenant: "code-worker",
      agentSession: {
        agentId: "hermes-test",
        agentName: "Hermes on Test Machine",
        telemetryUrl: "http://127.0.0.1:8787",
        sessionId: "api-test-session",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        lastMessageCount: 1,
      },
      result: "Accepted and streaming.",
    });
    assert(lifecycle.status === "working" && lifecycle.agentSession?.sessionId, "Assigned work should keep its pollable session.");
    lifecycle = await patchTask(lifecycle, {
      status: "done",
      result: "Finished with evidence.",
      agentSession: null,
    });
    assert(lifecycle.status === "done" && lifecycle.completedAt, "Working task should finish with completedAt.");

    let needsHumanAssigned = await createTask("needs human assigned resume", "needs-human", {
      assignee: "Hermes on Test Machine",
      tenant: "code-worker",
      result: "Need a decision.",
    });
    needsHumanAssigned = await moveTask(needsHumanAssigned, "working");
    assert(needsHumanAssigned.assignee === "Hermes on Test Machine", "Assigned Needs Human task should keep its assignee when resumed to Working.");

    let needsHumanUnassigned = await createTask("needs human unassigned resume", "needs-human", {
      result: "No agent was assigned.",
    });
    needsHumanUnassigned = await moveTask(needsHumanUnassigned, "ready");
    assert(!needsHumanUnassigned.assignee, "Unassigned Needs Human task should go back to Ready for assignment.");
    await moveTask(needsHumanUnassigned, "archived");

    const parent = await createTask("dependency parent", "ready");
    let child = await createTask("dependency child", "ready", { parents: [parent.id] });
    assert(child.status === "ideas", "Child with unfinished parents should wait inertly even if created as Ready.");
    child = await request("POST", { action: "promote", taskId: child.id }).then((data) => data.task).catch((error) => {
      assert(/unfinished parent/i.test(String(error?.message ?? error)), "Promote should report unfinished parent dependencies.");
      return child;
    });
    assert(child.status === "ideas", "Child with unfinished parents should not promote.");
    await request("POST", { action: "complete", taskId: parent.id, summary: "parent done", metadata: { verification: ["api workflow"] } });
    const afterParentDone = await request("GET", {}, { vaultPath, kanbanFolder, include_archived: "true" });
    child = afterParentDone.board.tasks.find((task) => task.id === child.id);
    assert(child?.status === "ready", "Completing a parent should promote ready children.");
    await moveTask(child, "archived");

    // Park-for-approval gate: an agent (MCP work_board) can't promote a Needs-You card
    // back to Ready and self-resume; a human release still works.
    const parkedApproval = await createTask("parked approval needs a human", "needs-human", { result: "Waiting on approval." });
    let agentPromoteBlocked = false;
    try {
      await request("POST", { action: "promote", taskId: parkedApproval.id, actor: "agent" });
    } catch (error) {
      agentPromoteBlocked = /waiting on a human decision/i.test(String(error?.message ?? error));
    }
    assert(agentPromoteBlocked, "An agent must not promote a Needs-You task back to Ready.");
    const afterAgentPromote = await request("GET", {}, { vaultPath, kanbanFolder, include_archived: "true" });
    assert(
      afterAgentPromote.board.tasks.find((task) => task.id === parkedApproval.id)?.status === "needs-human",
      "The parked task stays in Needs You after a blocked agent promote.",
    );
    const humanPromoted = await request("POST", { action: "promote", taskId: parkedApproval.id });
    assert(humanPromoted.task?.status === "ready", "A human can still promote a Needs-You task to Ready.");
    await moveTask(humanPromoted.task, "archived");

    let claimable = await createTask("structured worker verbs", "ready");
    const claimed = await request("POST", {
      action: "claim",
      taskId: claimable.id,
      assignee: "OpenClaw on Test Machine",
      runtime: "openclaw",
      ttlMs: 60_000,
    });
    claimable = claimed.task;
    assert(claimable.status === "working" && claimable.currentRunId && claimed.run?.status === "running", "Claim should create a running task run.");
    const heartbeat = await request("POST", { action: "heartbeat", taskId: claimable.id, note: "still working" });
    assert(heartbeat.task?.lastHeartbeatAt, "Heartbeat should touch task liveness.");
    const completed = await request("POST", {
      action: "complete",
      taskId: claimable.id,
      summary: "finished via structured verb",
      metadata: { changed_files: [], verification: ["api workflow"] },
    });
    assert(completed.task?.status === "done", "Complete should finish claimed work.");
    assert(completed.board.runs.some((run) => run.id === claimable.currentRunId && run.status === "completed"), "Complete should close the active run.");

    let loopGated = await createTask("loop gated completion", "ready", {
      maxAttempts: 3,
      loop: {
        mode: "closed",
        goal: "Complete only after the real worker output passes the held-out marker check.",
        successCriteria: ["worker result includes the verification marker"],
        evalGates: [{
          id: "marker-check",
          title: "worker marker evidence",
          kind: "receipt",
          phase: "post",
          required: true,
          verifier: "receipt:evidence",
          status: "pending",
          createdAt: Date.now(),
        }],
        budget: { maxAttempts: 3, maxRuntimeMs: 60_000 },
        retryPolicy: { maxAttempts: 3, onFailure: "retry" },
        evidenceRequired: ["worker chat transcript"],
      },
    });
    assert(loopGated.loop?.evalGates?.[0]?.phase === "post", "Loop gates should preserve Evo-style pre/post phase metadata.");
    assert(loopGated.maxAttempts === 3 && loopGated.maxRuntimeMs === 60_000, "Loop budget should hydrate task retry/runtime limits.");
    const loopBlocked = await request("POST", {
      action: "complete",
      taskId: loopGated.id,
      summary: "worker claimed success without eval evidence",
    });
    assert(loopBlocked.blocked === true, "Required loop gates should block completion without a passing receipt.");
    assert(loopBlocked.task?.status === "needs-human", "Missing loop evidence should fail closed to Needs You.");
    assert(loopBlocked.board.events.some((item) => item.kind === "loop.eval-blocked" && item.taskId === loopGated.id), "Blocked loop completion should leave an eval event receipt.");
    const loopPassed = await request("POST", {
      action: "complete",
      taskId: loopGated.id,
      summary: "worker output passed marker check",
      loopReceipts: [{
        gateId: "marker-check",
        status: "passed",
        summary: "worker supplied the required marker evidence",
        evidence: ["worker chat transcript included marker"],
        verifier: "receipt:evidence",
      }],
    });
    loopGated = loopPassed.task;
    assert(loopGated.status === "done", "A passing loop receipt should allow completion.");
    assert(loopGated.loop?.evalGates?.[0]?.status === "passed", "Passing receipts should update gate status.");
    assert(loopGated.loopReceipts?.some((receipt) => receipt.gateId === "marker-check" && receipt.status === "passed"), "Loop receipts should persist on the task.");

    let optimizerLoop = await createTask("optimizer loop substrate", "ready", {
      loop: {
        mode: "optimizer",
        goal: "Improve routing quality without breaking QA gates.",
        successCriteria: ["increase held-out routing score"],
        evalGates: [],
      },
    });
    const discoveredLoop = await request("POST", {
      action: "loop-discover",
      taskId: optimizerLoop.id,
      loop: {
        goal: "Improve routing quality without breaking QA gates.",
        successCriteria: ["increase held-out routing score", "preserve marker verification"],
        target: "src/lib/services/queen-bee/router.ts",
        command: "pnpm test:queen-bee:routing -- --json",
        metricName: "held_out_routing_score",
        metricDirection: "max",
        scoreFloor: 0.72,
        resourceProfile: "CPU-light isolated benchmark",
        instrumentation: "manual",
        frontierStrategy: { kind: "pareto_per_task", params: { k: 2, task_floor: 0.01 }, seed: 7 },
        evalGates: [{
          id: "routing-floor",
          title: "held-out routing floor",
          kind: "test",
          phase: "post",
          required: true,
          status: "pending",
          createdAt: Date.now(),
        }],
      },
    });
    optimizerLoop = discoveredLoop.task;
    assert(optimizerLoop.loop?.benchmark?.metricName === "held_out_routing_score", "loop-discover should persist benchmark discovery metadata.");
    assert(optimizerLoop.loop?.frontierStrategy?.kind === "pareto_per_task", "loop-discover should persist frontier strategy.");
    assert(optimizerLoop.loop?.observation?.pendingRequiredGateCount === 1, "Observation should expose pending required gates.");
    const expA = await request("POST", {
      action: "loop-record",
      taskId: optimizerLoop.id,
      experiment: {
        id: "exp-a",
        hypothesis: "prefer exact QA worker class",
        status: "committed",
        score: 0.76,
        taskScores: { qa: 0.91, coding: 0.54 },
        createdAt: Date.now(),
      },
    });
    assert(expA.task?.loop?.observation?.bestExperimentId === "exp-a", "First committed experiment should become running best.");
    const expA2 = await request("POST", {
      action: "loop-record",
      taskId: optimizerLoop.id,
      experiment: {
        id: "exp-a2",
        parentId: "exp-a",
        hypothesis: "prefer exact QA worker class plus freshest project checkout",
        status: "committed",
        score: 0.82,
        taskScores: { qa: 0.92, coding: 0.65 },
        createdAt: Date.now() + 1,
      },
    });
    assert(expA2.task?.loop?.observation?.runningBestExperimentIds?.includes("exp-a2"), "Observation should track running-best experiment lineage.");
    const expB = await request("POST", {
      action: "loop-record",
      taskId: optimizerLoop.id,
      experiment: {
        id: "exp-b",
        hypothesis: "route by coding project checkout before worker class",
        status: "evaluated",
        score: 0.74,
        taskScores: { qa: 0.62, coding: 0.93 },
        createdAt: Date.now() + 2,
      },
      antiPatterns: [{
        title: "Do not route by display name alone",
        reason: "It repeatedly assigns local and remote agents ambiguously when names collide.",
        sourceExperimentId: "exp-b",
        evidence: ["display-name-only routing caused stale checkout selection"],
      }],
    });
    optimizerLoop = expB.task;
    const observation = optimizerLoop.loop?.observation;
    assert(observation?.totalExperiments === 3, "Observation should count loop experiments.");
    assert(observation?.antiPatternCount === 1, "What-not-to-try memory should be counted in observation.");
    assert(optimizerLoop.loop?.antiPatterns?.[0]?.title === "Do not route by display name alone", "Anti-pattern memory should persist on the loop.");
    assert(observation?.frontier?.some((item) => item.id === "exp-a2"), "Frontier should include the best leaf experiment.");
    assert(observation?.frontier?.some((item) => item.id === "exp-b"), "Pareto frontier should preserve a specialist leaf.");
    assert(!observation?.frontier?.some((item) => item.id === "exp-a"), "Frontier should exclude experiments extended by children.");
    await moveTask(optimizerLoop, "archived");

    const queueTarget = { key: "queue-test-machine", name: "Queue Test Machine" };
    await createTask("queue lower priority", "ready", { priority: "normal", targetMachine: queueTarget });
    const queueUrgent = await createTask("queue retryable runtime failure", "ready", {
      priority: "urgent",
      targetMachine: queueTarget,
      maxAttempts: 2,
    });
    const firstQueuedClaim = await request("POST", {
      action: "claim-next",
      targetMachineKey: queueTarget.key,
      assignee: "Codex Queue Worker",
      runtime: "codex",
      ttlMs: 60_000,
    });
    assert(firstQueuedClaim.claimed === true, "claim-next should report a claimed task when a queue candidate exists.");
    assert(firstQueuedClaim.task?.id === queueUrgent.id, "claim-next should prefer higher priority ready work.");
    assert(firstQueuedClaim.task?.attempt === 1 && firstQueuedClaim.run?.attempt === 1, "First claim should record attempt 1 on task and run.");
    const retryableFailure = await request("POST", {
      action: "fail",
      taskId: queueUrgent.id,
      error: "runtime heartbeat timed out",
      summary: "Runtime heartbeat timed out before the worker reported progress.",
    });
    assert(retryableFailure.retried === true, "Retryable infrastructure failures should requeue before maxAttempts is exhausted.");
    assert(retryableFailure.task?.status === "ready" && retryableFailure.task?.attempt === 2, "Retryable failure should queue the next attempt.");
    assert(retryableFailure.task?.lastFailureReason === "timeout", "Retryable failure should classify timeout reasons.");
    const secondQueuedClaim = await request("POST", {
      action: "claim-next",
      targetMachineKey: queueTarget.key,
      assignee: "Codex Queue Worker",
      runtime: "codex",
      ttlMs: 60_000,
    });
    assert(secondQueuedClaim.task?.id === queueUrgent.id && secondQueuedClaim.run?.attempt === 2, "Second claim should resume the retry attempt before lower-priority work.");
    const exhaustedFailure = await request("POST", {
      action: "fail",
      taskId: queueUrgent.id,
      error: "runtime heartbeat timed out again",
      summary: "Runtime heartbeat timed out again.",
    });
    assert(exhaustedFailure.retried === false, "Retryable failures should stop after maxAttempts.");
    assert(exhaustedFailure.task?.status === "needs-human" && exhaustedFailure.task?.attempt === 2, "Exhausted retries should fail closed to Needs You.");
    const finalQueueClaim = await request("POST", {
      action: "claim-next",
      targetMachineKey: queueTarget.key,
      assignee: "Codex Queue Worker",
      runtime: "codex",
      ttlMs: 60_000,
    });
    assert(finalQueueClaim.task?.title === "queue lower priority", "claim-next should continue to the next eligible task after retry exhaustion.");

    const bulkA = await createTask("bulk a", "ideas");
    const bulkB = await createTask("bulk b", "ideas");
    const bulk = await request("POST", { action: "bulk", ids: [bulkA.id, bulkB.id], patch: { status: "archived" } });
    assert(bulk.results?.every((result) => result.ok), "Bulk action should report per-task success.");
    assert(bulk.board.tasks.filter((task) => [bulkA.id, bulkB.id].includes(task.id)).every((task) => task.status === "archived"), "Bulk action should update every selected task.");

    let needsHumanReadyRetry = await createTask("needs human assigned ready retry", "needs-human");
    needsHumanReadyRetry = await patchTask(needsHumanReadyRetry, {
      assignee: "Hermes on Test Machine",
      tenant: "code-worker",
      agentSession: {
        agentId: "hermes-test",
        agentName: "Hermes on Test Machine",
        telemetryUrl: "http://127.0.0.1:8787",
        sessionId: "api-stale-session",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        lastMessageCount: 12,
      },
      result: "Retry with a clean claim.",
    });
    needsHumanReadyRetry = await moveTask(needsHumanReadyRetry, "ready");
    assert(!needsHumanReadyRetry.assignee && !needsHumanReadyRetry.tenant && !needsHumanReadyRetry.agentSession, "Moving Needs Human back to Ready should clear stale ownership/session state.");
    assert(needsHumanReadyRetry.result === "Retry with a clean claim.", "Moving back to Ready should preserve retry notes.");

    let stale = await createTask("hard unpollable accepted work should not wait forever", "working", {
      assignee: "Hermes on Test Machine",
      tenant: "general-worker",
      result: "Hermes on Test Machine returned no task output and no pollable session.",
    });
    assert(stale.status === "working" && !stale.agentSession, "Fixture should start as unpollable Working.");
    stale = await patchTask(stale, {
      status: "working",
      result: "Hermes on Test Machine returned no task output and no pollable session.",
      agentSession: null,
    });
    assert(stale.status === "needs-human", "Unpollable accepted work must fail closed to Needs Human.");
    assert(!stale.completedAt, "Moving out of Done/Working recovery must not retain completedAt.");

    let timeoutAccepted = await createTask("timeout accepted runtime without session fails closed", "needs-human", {
      assignee: "Hermes on Test Machine",
      tenant: "code-worker",
      result: "Previous dashboard timeout.",
    });
    timeoutAccepted = await patchTask(timeoutAccepted, {
      status: "working",
      assignee: "Hermes on Test Machine",
      tenant: "code-worker",
      agentSession: null,
      result: "Hermes on Test Machine accepted the runtime connection and may still be working. Waiting for telemetry or agent output after the dashboard timeout.",
    });
    assert(timeoutAccepted.status === "needs-human", "Timeout-accepted runtime work without a session should fail closed to Needs Human.");

    const project = await projectRequest("/api/projects", {
      name: "Proof fixture",
      localPath: "/Users/liam/Documents/code/projects/proof-fixture",
      vaultNotePath: "Projects/Secret/Proof fixture.md",
      preferredMachineKey: "this-mac",
    });
    const linkedProject = await projectRequest("/api/projects/link-gitlawb", {
      projectId: project.project.id,
      repo: {
        repoId: "proof-fixture-repo",
        repoName: "liam/proof-fixture",
        remoteUrl: "gitlawb://proof-fixture-repo",
        branch: "main",
      },
    });
    assert(linkedProject.project?.gitlawbRepo?.repoName === "liam/proof-fixture", "Project should link to GitLawb repo metadata.");
    let proofTask = await createTask("project proof hydration", "ready", {
      projectId: project.project.id,
      proofs: [{
        id: "proof-verified-commit",
        kind: "commit",
        status: "verified",
        title: "signed main commit",
        commit: "abc123def456",
        metadata: {
          proofTitle: "signed main commit",
          localPath: "/Users/liam/Documents/Obsidian/Private Vault/secret.md",
          vaultNotePath: "Private/secret.md",
        },
      }],
    });
    proofTask = await request("GET", {}, { vaultPath, kanbanFolder, include_archived: "true" })
      .then((data) => data.board.tasks.find((task) => task.id === proofTask.id));
    assert(proofTask?.proofs?.some((proof) => proof.kind === "task" && proof.metadata?.projectId === project.project.id), "Project-linked tasks should carry hydrated project proof metadata.");
    const verifiedProof = proofTask?.proofs?.find((proof) => proof.id === "proof-verified-commit");
    assert(verifiedProof?.status === "verified", "Explicit verified proofs should survive task hydration.");
    assert(verifiedProof?.metadata?.localPath === "[redacted]", "Proof metadata should redact private local paths.");
    assert(verifiedProof?.metadata?.vaultNotePath === "[redacted]", "Proof metadata should redact private vault note paths.");

    const helperSource = await readFile(new URL("../src/features/dashboard/dashboard-light-helpers.tsx", import.meta.url), "utf8");
    const dispatchSource = await readFile(new URL("../src/features/dashboard/hooks/use-kanban-dispatch-controller.tsx", import.meta.url), "utf8");
    const taskControllerSource = await readFile(new URL("../src/features/dashboard/hooks/use-kanban-task-controller.tsx", import.meta.url), "utf8");
    assert(
      /function isKanbanAwaitingAgentUpdate\(task: KanbanTask\) \{\s*return task\.status === "working"\s*&& Boolean\(task\.agentSession\?\.sessionId\);\s*\}/m.test(helperSource),
      "Regression guard failed: unpollable accepted text must not count as an awaiting agent update.",
    );
    assert(
      dispatchSource.includes('logClientTelemetry("kanban.dispatch.no_progress_timeout"')
      && dispatchSource.includes("KANBAN_DISPATCH_NO_PROGRESS_MS"),
      "Regression guard failed: dispatches with no content/session need a bounded no-progress timeout.",
    );
    assert(
      helperSource.includes("This is an explicit undo request.")
      && helperSource.includes("reverse it narrowly")
      && helperSource.includes("Treat existing notes as authoritative retry context"),
      "Regression guard failed: explicit undo prompts must override stale retry context.",
    );

    const kanbanPanelSource = await readFile(new URL("../src/features/dashboard/views/KanbanPanel.tsx", import.meta.url), "utf8");
    const pollingSource = await readFile(new URL("../src/features/dashboard/hooks/use-dashboard-polling-effects.tsx", import.meta.url), "utf8");
    assert(
      kanbanPanelSource.includes('if (status === "verified") return 4;')
      && kanbanPanelSource.includes('const projectProofForTask = (task: any) => Array.isArray(task.proofs)')
      && kanbanPanelSource.includes('const kindDelta = proofKindRank(proof.kind) - proofKindRank(best.kind);'),
      "Regression guard failed: Work cards should prioritize verified GitLawb proofs while keeping project proof metadata available.",
    );
    assert(
      kanbanPanelSource.includes("const KANBAN_INITIAL_VISIBLE_TASKS = 20;")
      && kanbanPanelSource.includes("visibleTasks.map((task)")
      && kanbanPanelSource.includes("Show {Math.min(KANBAN_VISIBLE_TASK_STEP, hiddenTaskCount)} more"),
      "Regression guard failed: large Work Board lanes must render cards in bounded batches.",
    );
    assert(
      pollingSource.includes('include_columns: "false"')
      && pollingSource.includes('params.set("if_updated_at"')
      && pollingSource.includes("nativeData.notModified"),
      "Regression guard failed: Work Board polls must avoid duplicate columns and full unchanged payloads.",
    );
    assert(
      taskControllerSource.includes("const undoRequested = Boolean(task.undoRequestedAt);")
      && taskControllerSource.includes("preferQueen: !undoRequested"),
      "Regression guard failed: undo requests should prefer worker routing before Queen fallback.",
    );
    assert(
      dispatchSource.includes('logClientTelemetry("kanban.dispatch.completed_from_session"')
      && dispatchSource.includes('logClientTelemetry("kanban.dispatch.empty_without_session"')
      && dispatchSource.includes('status: "needs-human"')
      && dispatchSource.includes("agentSession: null"),
      "Regression guard failed: session-backed dispatches must finalize from assistant output or fail closed out of Working.",
    );

    const compactPatch = await request("PATCH", {
      taskId: proofTask.id,
      patch: { priority: "high" },
    }, { vaultPath, kanbanFolder, compact_response: "true" });
    assert(compactPatch.task?.priority === "high", "Compact PATCH responses should return the updated task.");
    assert(!compactPatch.board, "Compact PATCH responses should not serialize the full board.");

    const leanBoard = await request("GET", {}, {
      vaultPath,
      kanbanFolder,
      include_archived: "true",
      include_columns: "false",
    });
    assert(leanBoard.board?.tasks?.length > 0, "Lean board reads should retain task data.");
    assert(!leanBoard.columns, "Lean board reads should omit the duplicate grouped task payload.");
    const unchanged = await request("GET", {}, {
      vaultPath,
      kanbanFolder,
      include_archived: "true",
      include_columns: "false",
      if_updated_at: leanBoard.board.meta.updatedAt,
    });
    assert(unchanged.notModified === true, "Unchanged board reads should return a revision-only response.");
    assert(!unchanged.board, "Unchanged board reads should not serialize the full board.");
    const summary = await request("GET", {}, { vaultPath, kanbanFolder, summary_only: "true" });
    assert(typeof summary.counts?.["needs-human"] === "number", "Summary reads should return lane counts.");
    assert(!summary.board, "Summary reads should not serialize the full board.");

    const final = await request("GET", {}, { vaultPath, kanbanFolder, include_archived: "true", include_columns: "false" });
    const statuses = Object.fromEntries(final.board.tasks.map((task) => [task.title, task.status]));
    console.log(JSON.stringify({ ok: true, board, statuses }, null, 2));
  } finally {
    await rm(vaultPath, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
