#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dashboardUrl = (
  process.env.DASHBOARD_URL ||
  process.env.HIVEMINDOS_APP_URL ||
  "http://127.0.0.1:5020"
).replace(/\/+$/, "");
const runId =
  process.env.MCP_WORK_E2E_RUN_ID ||
  `mcp-work-real-e2e-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
const marker = `MCP_WORK_REAL_E2E_${runId}`.replace(/[^A-Z0-9_-]/gi, "_");
const boardSlug =
  process.env.MCP_WORK_E2E_BOARD ||
  `mcp_e2e_${runId.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(-36)}`;
const eventName =
  process.env.MCP_WORK_E2E_EVENT ||
  `mcp_${runId.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(-48)}`;
const artifactDir = join(process.cwd(), "artifacts", "e2e-mcp-work", runId);
const dashboardDeviceToken =
  process.env.HIVE_E2E_DASHBOARD_TOKEN ||
  process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN ||
  (await readEnvValue(new URL("../.env.local", import.meta.url), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN"));

const summary = {
  ok: false,
  runId,
  marker,
  boardSlug,
  eventName,
  dashboardUrl,
  startedAt: new Date().toISOString(),
  checks: [],
};

if (process.env.MCP_WORK_REAL_E2E !== "1") {
  throw new Error("Refusing to run real app E2E without MCP_WORK_REAL_E2E=1.");
}

function ok(name, detail = {}) {
  summary.checks.push({ name, ok: true, detail });
}

function authHeaders(extra = {}) {
  return {
    ...(dashboardDeviceToken
      ? { "x-hivemindos-device-token": dashboardDeviceToken }
      : {}),
    ...extra,
  };
}

async function readEnvValue(fileUrl, key) {
  const raw = await readFile(fileUrl, "utf8").catch(() => "");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^${escapedKey}=(.*)$`, "m"));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "";
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${dashboardUrl}${path}`, {
    ...options,
    headers: authHeaders({
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs || 60_000),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { text };
  }
  if (!response.ok || data?.ok === false || data?.success === false) {
    throw new Error(`${options.method || "GET"} ${path} failed: ${data?.error || response.status}`);
  }
  return data;
}

function mcpRequest(child, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for MCP response to ${message.method}`));
    }, 90_000);
    const onData = (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.id !== message.id) continue;
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        if (parsed.error) reject(new Error(parsed.error.message));
        else resolve(parsed.result);
      }
    };
    child.stdout.on("data", onData);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

async function launchMcp() {
  const child = spawn("node", ["scripts/hivemind-mcp"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      DASHBOARD_URL: dashboardUrl,
      HIVEMINDOS_APP_URL: dashboardUrl,
      ...(dashboardDeviceToken
        ? { HIVEMINDOS_DASHBOARD_DEVICE_TOKEN: dashboardDeviceToken }
        : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let id = 1;
  await mcpRequest(child, {
    jsonrpc: "2.0",
    id: id++,
    method: "initialize",
    params: {},
  });
  const tools = await mcpRequest(child, {
    jsonrpc: "2.0",
    id: id++,
    method: "tools/list",
    params: {},
  });
  const names = new Set((tools.tools || []).map((tool) => tool.name));
  for (const name of ["work_board", "queen_bee", "work_event", "request_human_approval"]) {
    assert.ok(names.has(name), `${name} should be exposed by the real MCP server`);
  }
  ok("mcp tools/list exposes orchestration tools", {
    count: tools.tools?.length || 0,
  });
  return {
    child,
    async call(name, args = {}) {
      const response = await mcpRequest(child, {
        jsonrpc: "2.0",
        id: id++,
        method: "tools/call",
        params: { name, arguments: args },
      });
      return response.structuredContent;
    },
    close() {
      child.kill();
    },
    stderr() {
      return stderr;
    },
  };
}

async function verifyBoardTask(taskId, expectedStatus) {
  const board = await requestJson(
    `/api/kanban?board=${encodeURIComponent(boardSlug)}&include_archived=true&q=${encodeURIComponent(marker)}`,
  );
  const task = board.board?.tasks?.find((item) => item.id === taskId);
  assert.ok(task, `task ${taskId} should be visible through real /api/kanban`);
  assert.equal(task.status, expectedStatus);
  return task;
}

async function runBrowserVerification(taskTitles) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      extraHTTPHeaders: authHeaders(),
    });
    if (dashboardDeviceToken) {
      await context.request
        .post(`${dashboardUrl}/api/auth/session`, {
          data: { token: dashboardDeviceToken },
          headers: { Accept: "application/json" },
        })
        .catch(() => null);
    }
    const page = await context.newPage();
    await page.goto(`${dashboardUrl}/?view=kanban`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        return /Tasks|Workboard|Work board/i.test(text) && !/Dashboard locked/i.test(text);
      },
      null,
      { timeout: 45_000 },
    );
    await page.waitForFunction(
      (board) =>
        [...document.querySelectorAll("select")].some((candidate) =>
          [...candidate.options].some((option) => option.value === board),
        ),
      boardSlug,
      { timeout: 45_000 },
    );
    await page.evaluate((board) => {
      const select = [...document.querySelectorAll("select")].find((candidate) =>
        [...candidate.options].some((option) => option.value === board),
      );
      if (!select) throw new Error(`Board select did not include ${board}`);
      select.value = board;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, boardSlug);
    const search = page.getByPlaceholder("title, note, result...");
    await search.fill(marker);
    for (const title of taskTitles) {
      await page.getByText(title, { exact: false }).first().waitFor({ timeout: 45_000 });
    }
    ok("browser Work view shows real E2E board/tasks", {
      visibleTitles: taskTitles,
    });
    await context.close();
  } finally {
    await browser.close();
  }
}

// Remove everything this run (and any crashed prior run) parked on the REAL app:
// marker-titled tasks on the shared default board, throwaway mcp_e2e_* boards, and
// mcp_* work-event definitions/triggers. Sweeping by marker prefix instead of
// per-run ids makes the cleanup self-healing when an earlier run died mid-way.
// Set E2E_KEEP_TASKS=1 to keep the artifacts around for debugging.
async function cleanupRealBoardArtifacts() {
  if (process.env.E2E_KEEP_TASKS === "1") return { skipped: "E2E_KEEP_TASKS=1" };
  const outcome = { deletedTasks: 0, archivedBoards: 0, deletedEvents: 0, errors: [] };
  try {
    const board = await requestJson("/api/kanban?include_archived=true");
    const junkTasks = (board.board?.tasks || []).filter((task) =>
      String(task.title || "").startsWith("MCP_WORK_REAL_E2E_"),
    );
    for (const task of junkTasks) {
      try {
        await requestJson("/api/kanban", {
          method: "DELETE",
          body: JSON.stringify({ taskId: task.id }),
        });
        outcome.deletedTasks += 1;
      } catch (error) {
        outcome.errors.push(`delete task ${task.id}: ${error.message}`);
      }
    }
  } catch (error) {
    outcome.errors.push(`list default board: ${error.message}`);
  }
  try {
    const boards = await requestJson("/api/kanban?boards_only=true");
    const junkBoards = (boards.boards || [])
      .map((entry) => entry.slug || entry)
      .filter((slug) => /^mcp_e2e_/.test(String(slug)));
    for (const slug of junkBoards) {
      try {
        await requestJson("/api/kanban", {
          method: "POST",
          body: JSON.stringify({ action: "archive-board", slug }),
        });
        outcome.archivedBoards += 1;
      } catch (error) {
        outcome.errors.push(`archive board ${slug}: ${error.message}`);
      }
    }
  } catch (error) {
    outcome.errors.push(`list boards: ${error.message}`);
  }
  try {
    const events = await requestJson("/api/work-events");
    const junkEvents = (events.events || [])
      .map((event) => event.name)
      .filter((name) => /^mcp_mcp_work_real_e2e_/.test(String(name)));
    for (const name of junkEvents) {
      try {
        await requestJson("/api/work-events", {
          method: "POST",
          body: JSON.stringify({ action: "delete-event", eventName: name }),
        });
        outcome.deletedEvents += 1;
      } catch (error) {
        outcome.errors.push(`delete event ${name}: ${error.message}`);
      }
    }
  } catch (error) {
    outcome.errors.push(`list work events: ${error.message}`);
  }
  return outcome;
}

async function main() {
  await mkdir(artifactDir, { recursive: true });
  const preflight = await requestJson("/api/kanban?boards_only=true", {
    timeoutMs: 20_000,
  });
  ok("real dashboard API reachable", {
    boardCount: Array.isArray(preflight.boards) ? preflight.boards.length : null,
    hasDashboardToken: Boolean(dashboardDeviceToken),
  });

  const mcp = await launchMcp();
  try {
    const lifecycleTitle = `${marker} lifecycle task`;
    const created = await mcp.call("work_board", {
      action: "create-task",
      board: boardSlug,
      title: lifecycleTitle,
      body: `Real MCP Work Board lifecycle E2E for ${marker}.`,
      status: "ready",
      priority: "urgent",
      skills: ["qa", "mcp"],
      tenant: marker,
      maxAttempts: 1,
      idempotencyKey: `${marker}:lifecycle`,
    });
    assert.equal(created.task.title, lifecycleTitle);
    assert.equal(created.task.status, "ready");
    ok("work_board create-task wrote real board task", {
      taskId: created.task.id,
    });

    const listed = await mcp.call("work_board", {
      action: "list",
      board: boardSlug,
      includeArchived: true,
      query: marker,
    });
    assert.ok(
      listed.board?.tasks?.some((task) => task.id === created.task.id),
      "work_board list should return the created lifecycle task",
    );
    ok("work_board list read real board task", {
      visibleTaskCount: listed.board.tasks.length,
    });

    const claimed = await mcp.call("work_board", {
      action: "claim-next",
      board: boardSlug,
      assignee: "mcp-real-e2e-agent",
      tenant: marker,
      runtime: "codex-real-e2e",
      ttlMs: 10 * 60 * 1000,
    });
    assert.equal(claimed.claimed, true);
    assert.equal(claimed.task.id, created.task.id);
    assert.ok(claimed.task.claimLock, "claimed task should have a claim lock");
    ok("work_board claim-next claimed real task", {
      taskId: claimed.task.id,
      runId: claimed.run?.id,
    });

    await mcp.call("work_board", {
      action: "heartbeat",
      board: boardSlug,
      taskId: claimed.task.id,
      claimLock: claimed.task.claimLock,
      note: `${marker} heartbeat before block`,
    });
    await mcp.call("work_board", {
      action: "comment",
      board: boardSlug,
      taskId: claimed.task.id,
      body: `${marker} MCP comment recorded through real app`,
      author: "mcp-real-e2e",
    });
    ok("work_board heartbeat and comment wrote real task activity", {
      taskId: claimed.task.id,
    });

    const blocked = await mcp.call("work_board", {
      action: "block",
      board: boardSlug,
      taskId: claimed.task.id,
      reason: `${marker} intentional human gate for E2E`,
    });
    assert.equal(blocked.task.status, "needs-human");
    ok("work_board block moved real task to Needs You", {
      taskId: blocked.task.id,
    });

    const promoted = await mcp.call("work_board", {
      action: "promote",
      board: boardSlug,
      taskId: claimed.task.id,
      reason: `${marker} E2E promote after human gate`,
    });
    assert.equal(promoted.task.status, "ready");
    ok("work_board promote moved real task back to Ready", {
      taskId: promoted.task.id,
    });

    const reclaimed = await mcp.call("work_board", {
      action: "claim-next",
      board: boardSlug,
      assignee: "mcp-real-e2e-agent",
      tenant: marker,
      runtime: "codex-real-e2e",
    });
    assert.equal(reclaimed.task.id, created.task.id);
    const completed = await mcp.call("work_board", {
      action: "complete",
      board: boardSlug,
      taskId: reclaimed.task.id,
      summary: `${marker} completed through real MCP Work Board E2E`,
      result: `${marker} lifecycle result: complete.`,
    });
    assert.equal(completed.task.status, "done");
    await verifyBoardTask(completed.task.id, "done");
    ok("work_board complete persisted Done status", {
      taskId: completed.task.id,
    });

    const failTitle = `${marker} fail task`;
    const failCreated = await mcp.call("work_board", {
      action: "create-task",
      board: boardSlug,
      title: failTitle,
      body: `Real MCP failure E2E for ${marker}.`,
      status: "ready",
      priority: "high",
      tenant: marker,
      maxAttempts: 1,
      idempotencyKey: `${marker}:fail`,
    });
    const failClaim = await mcp.call("work_board", {
      action: "claim-next",
      board: boardSlug,
      assignee: "mcp-real-e2e-agent",
      tenant: marker,
      runtime: "codex-real-e2e",
    });
    assert.equal(failClaim.task.id, failCreated.task.id);
    const failed = await mcp.call("work_board", {
      action: "fail",
      board: boardSlug,
      taskId: failClaim.task.id,
      error: `${marker} intentional failure for E2E`,
      failureReason: "manual",
    });
    assert.equal(failed.task.status, "needs-human");
    ok("work_board fail persisted Needs You status", {
      taskId: failed.task.id,
      failureReason: failed.failureReason,
    });

    const approvalTitle = `${marker} approval request`;
    const approval = await mcp.call("request_human_approval", {
      board: boardSlug,
      title: approvalTitle,
      request: `Approve or deny the real E2E request ${marker}.`,
      context: "This verifies the approval request tool creates a review card without granting authority.",
      requestedBy: "mcp-real-e2e",
      options: ["allow", "deny"],
      idempotencyKey: `${marker}:approval`,
    });
    assert.equal(approval.task.status, "needs-human");
    assert.equal(approval.task.assignee, "human");
    ok("request_human_approval created real Needs You card", {
      taskId: approval.task.id,
    });

    await mcp.call("work_event", {
      action: "create-event",
      eventName,
      payloadGuidelines: `Payloads should include marker ${marker}.`,
    });
    await mcp.call("work_event", {
      action: "create-trigger",
      eventName,
      board: boardSlug,
      title: `${marker} event task {{EVENT_NAME}}`,
      body: [
        "Event source: {{EVENT_SOURCE}}",
        "Payload:",
        "{{EVENT_PAYLOAD}}",
        "",
        "FAQ:",
        "{{EVENT_FAQ}}",
      ].join("\n"),
      assignee: "mcp-event-e2e",
      tenant: marker,
      priority: "high",
      status: "ready",
      skills: ["event-fanout", "qa"],
      emitEventName: `${eventName}_done`,
      idempotencyKey: `${marker}:event:{{EVENT_NAME}}`,
    });
    const published = await mcp.call("work_event", {
      action: "publish",
      eventName,
      payload: { marker, boardSlug, kind: "real-app-e2e" },
      faq: [{ question: "Is this a simulation?", answer: "No, it used the real app API." }],
      source: "real-mcp-e2e",
    });
    assert.equal(published.matchedTriggers, 1);
    assert.equal(published.tasks.length, 1);
    assert.equal(published.tasks[0].board, boardSlug);
    ok("work_event publish fanned out into real Work Board task", {
      taskId: published.tasks[0].task.id,
    });

    const queenState = await mcp.call("queen_bee", { action: "state" });
    assert.equal(queenState.ok, true);
    ok("queen_bee state read real control plane", {
      protocol: queenState.protocol,
    });

    const queenQueued = await mcp.call("queen_bee", {
      action: "queue-task",
      message: `Real Queen Bee MCP queue E2E ${marker}. Record this as a planning receipt only.`,
      taskTitle: `${marker} Queen Bee queued task`,
      source: "real-mcp-e2e",
      mode: "plan",
      priority: "normal",
      skills: ["qa"],
    });
    assert.ok(queenQueued.task?.id, "queen_bee queue-task should return a Work Board task");
    ok("queen_bee queue-task created or reused real coordinator task", {
      taskId: queenQueued.task.id,
      created: queenQueued.created,
    });

    const prdPreview = await mcp.call("queen_bee", {
      action: "decompose-prd",
      preview: true,
      title: `${marker} PRD preview`,
      prd: [
        `# ${marker} PRD preview`,
        "## Requirements",
        `- Verify the MCP Work Board lifecycle for ${marker}`,
        "- Verify event fanout creates a normal Work Board task",
        "## Acceptance criteria",
        "- All checks are recorded in the real E2E summary",
      ].join("\n"),
      maxTasks: 2,
    });
    assert.equal(prdPreview.created, false);
    assert.ok(prdPreview.decomposition?.drafts?.length >= 1);
    ok("queen_bee decompose-prd preview used real route", {
      draftCount: prdPreview.decomposition.drafts.length,
    });

    const flowTemplates = await mcp.call("queen_bee", {
      action: "flow",
      flowAction: "list-templates",
    });
    assert.equal(flowTemplates.ok, true);
    ok("queen_bee flow list-templates used real route", {
      templateCount: Array.isArray(flowTemplates.templates) ? flowTemplates.templates.length : null,
    });

    await runBrowserVerification([
      lifecycleTitle,
      failTitle,
      approvalTitle,
      `${marker} event task`,
    ]);
  } catch (error) {
    if (mcp.stderr().trim()) {
      error.message = `${error.message}\nMCP stderr:\n${mcp.stderr()}`;
    }
    throw error;
  } finally {
    mcp.close();
  }
  summary.ok = true;
}

await main().catch((error) => {
  summary.error = error instanceof Error ? error.stack || error.message : String(error);
  process.exitCode = 1;
}).finally(async () => {
  summary.cleanup = await cleanupRealBoardArtifacts().catch((error) => ({
    errors: [String(error?.message || error)],
  }));
  summary.finishedAt = new Date().toISOString();
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: summary.ok,
    runId,
    boardSlug,
    eventName,
    artifactDir,
    checks: summary.checks,
    error: summary.error,
  }, null, 2));
});
