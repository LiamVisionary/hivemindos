#!/usr/bin/env node
import { mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.KANBAN_TEST_BASE_URL || "http://127.0.0.1:5020";
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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

    const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
    assert(
      /function isKanbanAwaitingAgentUpdate\(task: KanbanTask\) \{\s*return task\.status === "working"\s*&& Boolean\(task\.agentSession\?\.sessionId\);\s*\}/m.test(source),
      "Regression guard failed: unpollable accepted text must not count as an awaiting agent update.",
    );
    assert(
      source.includes('logClientTelemetry("kanban.dispatch.no_progress_timeout"')
      && source.includes("KANBAN_DISPATCH_NO_PROGRESS_MS"),
      "Regression guard failed: dispatches with no content/session need a bounded no-progress timeout.",
    );
    assert(
      source.includes("This is an explicit undo request.")
      && source.includes("reverse it narrowly")
      && source.includes("Treat existing notes as authoritative retry context"),
      "Regression guard failed: explicit undo prompts must override stale retry context.",
    );

    const kanbanPanelSource = await readFile(new URL("../src/features/dashboard/views/KanbanPanel.tsx", import.meta.url), "utf8");
    assert(
      kanbanPanelSource.includes('if (status === "verified") return 4;')
      && kanbanPanelSource.includes('const projectProofForTask = (task: any) => Array.isArray(task.proofs)')
      && kanbanPanelSource.includes('const kindDelta = proofKindRank(proof.kind) - proofKindRank(best.kind);'),
      "Regression guard failed: Work cards should prioritize verified GitLawb proofs while keeping project proof metadata available.",
    );
    assert(
      source.includes("const undoRequested = Boolean(task.undoRequestedAt);")
      && source.includes("preferQueen: !undoRequested"),
      "Regression guard failed: undo requests should prefer worker routing before Queen fallback.",
    );
    assert(
      source.includes('logClientTelemetry("kanban.dispatch.no_final_assistant"')
      && source.includes('logClientTelemetry("kanban.dispatch.completed_from_session"')
      && source.includes('await patchKanbanTask(task.id, {\n              status: "needs-human",\n              agentSession: null,'),
      "Regression guard failed: session-backed dispatches must finalize from assistant output or fail closed out of Working.",
    );

    const final = await request("GET", {}, { vaultPath, kanbanFolder, include_archived: "true" });
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
