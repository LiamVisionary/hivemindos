#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

const dashboardUrl = (process.env.DASHBOARD_URL || "http://127.0.0.1:5020").replace(/\/+$/, "");
const runId = process.env.QUEEN_BEE_E2E_RUN_ID || `queen-bee-real-e2e-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
const marker = `QUEEN_BEE_REAL_E2E_${runId}`.replace(/[^A-Z0-9_\-]/gi, "_");
const pollMs = Number(process.env.QUEEN_BEE_E2E_POLL_MS || 2_000);
const autoWaitMs = Number(process.env.QUEEN_BEE_E2E_AUTO_WAIT_MS || 60_000);
// Queen Bee E2E is autonomous by default: the harness must only create the task
// and observe the Work Board. Set QUEEN_BEE_E2E_REQUIRE_AUTONOMOUS=0 only when
// intentionally testing the legacy harness-assisted claim/chat/complete path.
const requireAutonomousPickup = process.env.QUEEN_BEE_E2E_REQUIRE_AUTONOMOUS !== "0";
const loopGateRequired = !requireAutonomousPickup;
const dashboardDeviceToken = process.env.HIVE_E2E_DASHBOARD_TOKEN
  || process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || await readEnvValue(new URL("../.env.local", import.meta.url), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN");

const summary = {
  ok: false,
  runId,
  marker,
  dashboardUrl,
  startedAt: new Date().toISOString(),
  fleet: null,
  queenBee: null,
  automaticPickup: null,
  workerChat: null,
  completion: null,
  finalTask: null,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readEnvValue(fileUrl, key) {
  const raw = await readFile(fileUrl, "utf8").catch(() => "");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^${escapedKey}=(.*)$`, "m"));
  return match?.[1]?.trim().replace(/^[\"']|[\"']$/g, "") || "";
}

function headers(extra = {}) {
  return {
    ...(dashboardDeviceToken ? { "x-hivemindos-device-token": dashboardDeviceToken } : {}),
    ...extra,
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: headers({
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs || 90_000),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { text };
  }
  if (!response.ok || data?.ok === false || data?.success === false) {
    throw new Error(`${options.method || "GET"} ${url} failed: ${data?.error || response.status}`);
  }
  return data;
}

async function dashboard(path, options = {}) {
  return requestJson(`${dashboardUrl}${path}`, options);
}

async function waitForTask(taskId, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastTask = null;
  while (Date.now() < deadline) {
    const board = await dashboard(`/api/kanban?include_archived=true&q=${encodeURIComponent(marker)}`);
    lastTask = board.board?.tasks?.find((task) => task.id === taskId) || null;
    if (lastTask && predicate(lastTask, board)) return { task: lastTask, board };
    await sleep(pollMs);
  }
  return { task: lastTask, timedOut: true, label };
}

function compactAgent(agent) {
  if (!agent) return null;
  return {
    id: agent.id,
    agentId: agent.agentId,
    name: agent.name,
    runtime: agent.runtime,
    beeRole: agent.beeRole,
    workerClass: agent.workerClass,
    localDataDir: agent.localDataDir,
    model: agent.model,
    provider: agent.provider,
  };
}

function compactMachine(machine) {
  if (!machine) return null;
  return {
    key: machine.key,
    collector: machine.collector,
    name: machine.device?.name,
    os: machine.device?.os,
    online: machine.device?.online,
    collectorUrl: machine.device?.collectorUrl,
    agentCount: Array.isArray(machine.agents) ? machine.agents.length : 0,
  };
}

async function main() {
  const fleet = await dashboard("/api/fleet/discover?includeSnapshots=0&fresh=1", { timeoutMs: 30_000 });
  const readyMachines = (fleet.machines || []).filter((machine) => machine.collector === "ready");
  const chatAgents = readyMachines.flatMap((machine) => (machine.agents || [])
    .filter((agent) => agent.runtime === "hermes" || agent.runtimeCapabilities?.chat || agent.collectorCapabilities?.chat || machine.capabilities?.chat)
    .map((agent) => ({ machine, agent })));
  summary.fleet = {
    machineCount: fleet.machines?.length || 0,
    readyMachineCount: readyMachines.length,
    chatAgentCount: chatAgents.length,
    machines: readyMachines.map(compactMachine),
  };
  assert(chatAgents.length > 0, "No live chat-capable fleet agents discovered.");

  const message = [
    `Real Queen Bee E2E prompt ${marker}.`,
    "QA verify the Queen Bee routing flow with a real worker chat.",
    "The selected delegate must return the marker exactly so the harness can verify completion.",
  ].join(" ");
  const loop = {
    mode: "closed",
    goal: "Verify Queen Bee can route a real Work Board task to a real fleet chat agent and persist completion evidence.",
    successCriteria: ["selected delegate returns the exact marker", "Work Board task completes with a loop receipt"],
    evalGates: [{
      id: "real-worker-chat-marker",
      title: "real worker chat marker",
      kind: "agent",
      phase: "post",
      required: loopGateRequired,
      status: "pending",
      verifier: "scripts/e2e-queen-bee-real-chat.mjs",
      createdAt: Date.now(),
    }],
    budget: { maxAttempts: 2, maxRuntimeMs: 10 * 60 * 1000 },
    retryPolicy: { maxAttempts: 2, onFailure: "needs-human" },
    evidenceRequired: ["worker chat response", "Work Board completion receipt"],
  };
  const queenBee = await dashboard("/api/queen-bee", {
    method: "POST",
    body: JSON.stringify({
      source: "real-e2e-chat",
      mode: "act",
      priority: "high",
      taskTitle: `Real Queen Bee E2E ${marker}`,
      message,
      loop,
    }),
    timeoutMs: 45_000,
  });
  const taskId = queenBee.task?.id;
  assert(taskId, "Queen Bee did not return a task id.");
  summary.queenBee = {
    created: queenBee.created,
    taskId,
    assignee: queenBee.task?.assignee,
    status: queenBee.task?.status,
    workerClass: queenBee.route?.delegation?.workerClass,
    routeStatus: queenBee.route?.delegation?.status,
    routeReason: queenBee.route?.reason,
    targetMachine: queenBee.route?.targetMachine,
    receiptStatus: queenBee.receipt?.status,
    receiptSummary: queenBee.receipt?.summary,
    loopGateRequired,
    loopGateCount: queenBee.task?.loop?.evalGates?.length || 0,
  };
  assert(queenBee.route?.delegation?.status === "delegated", "Queen Bee did not delegate to a live fleet agent.");
  assert(queenBee.route?.delegation?.workerClass === "qa", `Queen Bee inferred ${queenBee.route?.delegation?.workerClass || "none"}, expected qa for an explicit QA verification prompt.`);
  assert(queenBee.task?.assignee && queenBee.task.assignee !== "queen-bee", "Queen Bee task was not assigned to a selected worker.");

  const autoResult = await waitForTask(taskId, (task) => task.status === "working" || task.status === "done", autoWaitMs, "automatic pickup");
  summary.automaticPickup = autoResult.timedOut
    ? { observed: false, waitedMs: autoWaitMs, lastStatus: autoResult.task?.status || null, note: "No autonomous worker claimed/completed this Work Board card during the wait window." }
    : { observed: true, waitedMs: autoWaitMs, status: autoResult.task.status, assignee: autoResult.task.assignee };

  if (requireAutonomousPickup) {
    assert(summary.automaticPickup.observed === true, "Autonomous pickup was required but the task remained ready during the wait window.");
    const autonomousDone = await waitForTask(taskId, (task) => task.status === "done" && String(task.result || "").includes(marker), Number(process.env.QUEEN_BEE_E2E_AUTONOMOUS_DONE_WAIT_MS || 300_000), "autonomous done verification");
    assert(!autonomousDone.timedOut, `Autonomous pickup happened but completion with marker timed out; last status ${autonomousDone.task?.status || "missing"}.`);
    summary.workerChat = {
      ok: true,
      autonomous: true,
      markerSeen: String(autonomousDone.task.result || "").includes(marker),
      textPreview: String(autonomousDone.task.result || "").slice(0, 500),
    };
    summary.completion = {
      status: autonomousDone.task.status,
      completedAt: autonomousDone.task.completedAt,
      currentRunId: autonomousDone.task.currentRunId,
      runsCompleted: autonomousDone.board?.runs?.filter((run) => run.taskId === taskId && run.status === "completed").length || 0,
      autonomous: true,
    };
    summary.finalTask = {
      id: autonomousDone.task.id,
      title: autonomousDone.task.title,
      status: autonomousDone.task.status,
      assignee: autonomousDone.task.assignee,
      targetMachine: autonomousDone.task.targetMachine,
      completedAt: autonomousDone.task.completedAt,
      resultHasMarker: String(autonomousDone.task.result || "").includes(marker),
    };
    summary.ok = true;
    summary.finishedAt = new Date().toISOString();
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const selectedAgent = queenBee.route?.delegation?.agent;
  const selectedMachineKey = queenBee.route?.targetMachine?.key;
  const selectedMachine = readyMachines.find((machine) => (
    machine.key === selectedMachineKey
    || machine.device?.machineId === selectedMachineKey
    || machine.device?.name === queenBee.route?.targetMachine?.name
  )) || readyMachines.find((machine) => (machine.agents || []).some((agent) => agent.name === queenBee.task?.assignee));
  assert(selectedMachine, "Could not resolve selected machine from live fleet snapshot.");
  const selectedLiveAgent = (selectedMachine.agents || []).find((agent) => (
    agent.id === selectedAgent?.id
    || agent.agentId === selectedAgent?.agentId
    || agent.name === selectedAgent?.name
    || agent.name === queenBee.task?.assignee
  )) || selectedMachine.agents?.[0];
  assert(selectedLiveAgent, "Could not resolve selected live agent from fleet snapshot.");

  const claimed = summary.automaticPickup?.observed && summary.automaticPickup?.status === "working"
    ? { task: autoResult.task, run: null, claimedByAutonomousPickup: true }
    : await dashboard("/api/kanban", {
      method: "POST",
      body: JSON.stringify({
        action: "claim",
        taskId,
        assignee: selectedLiveAgent.name || selectedLiveAgent.id || queenBee.task.assignee,
        claimer: `queen-bee-real-e2e:${runId}`,
        runtime: selectedLiveAgent.runtime || "hermes",
        ttlMs: 10 * 60 * 1000,
      }),
      timeoutMs: 30_000,
    });
  assert(claimed.task?.status === "working", "Claim did not move task to working.");

  const collectorUrl = (selectedMachine.device?.collectorUrl || queenBee.route?.targetMachine?.collectorUrl || "").replace(/\/+$/, "");
  assert(collectorUrl, "Selected machine has no collector URL.");
  const chatPrompt = [
    `You are the selected Queen Bee delegate for Work Board task ${taskId}.`,
    `This is a real E2E worker chat. Return exactly this marker on one line: ${marker}`,
    "Do not add any other text.",
  ].join("\n");
  const chat = await requestJson(`${collectorUrl}/chat`, {
    method: "POST",
    body: JSON.stringify({
      message: chatPrompt,
      rawUserMessage: chatPrompt,
      stream: false,
      agent: selectedLiveAgent,
      context: {
        queenBeeTaskId: taskId,
        queenBeeRunId: runId,
        queenBeeMarker: marker,
      },
    }),
    timeoutMs: Number(process.env.QUEEN_BEE_E2E_CHAT_TIMEOUT_MS || 240_000),
  });
  const chatText = String(chat.text || chat.choices?.[0]?.message?.content || "");
  summary.workerChat = {
    ok: chat.ok === true,
    host: chat.host,
    agent: compactAgent(selectedLiveAgent),
    machine: compactMachine(selectedMachine),
    markerSeen: chatText.includes(marker),
    textPreview: chatText.slice(0, 500),
  };
  assert(chat.ok === true, "Worker chat did not return ok:true.");
  assert(chatText.includes(marker), "Worker chat response did not include the verification marker.");

  const completed = await dashboard("/api/kanban", {
    method: "POST",
    body: JSON.stringify({
      action: "complete",
      taskId,
      summary: `Real Queen Bee E2E completed by ${selectedLiveAgent.name || selectedLiveAgent.id}; marker ${marker}`,
      result: chatText,
      metadata: {
        runId,
        marker,
        workerChatHost: chat.host,
        selectedAgent: selectedLiveAgent.name || selectedLiveAgent.id,
        selectedMachine: selectedMachine.device?.name || selectedMachine.key,
        automaticPickupObserved: summary.automaticPickup?.observed === true,
      },
      loopReceipts: [{
        gateId: "real-worker-chat-marker",
        status: "passed",
        summary: `Real worker chat returned marker ${marker}.`,
        evidence: [chatText],
        verifier: selectedLiveAgent.name || selectedLiveAgent.id || "real fleet agent",
        metadata: {
          runId,
          workerChatHost: chat.host,
          selectedMachine: selectedMachine.device?.name || selectedMachine.key,
        },
      }],
    }),
    timeoutMs: 30_000,
  });
  assert(completed.task?.status === "done", "Complete did not move task to done.");
  assert(completed.task?.loop?.evalGates?.some((gate) => gate.id === "real-worker-chat-marker" && gate.status === "passed"), "Loop gate did not record the passing worker-chat receipt.");
  summary.completion = {
    status: completed.task.status,
    completedAt: completed.task.completedAt,
    currentRunId: completed.task.currentRunId,
    runsCompleted: completed.board?.runs?.filter((run) => run.taskId === taskId && run.status === "completed").length || 0,
  };

  const final = await waitForTask(taskId, (task) => task.status === "done" && String(task.result || "").includes(marker), 30_000, "final done verification");
  assert(!final.timedOut, "Final board verification timed out.");
  summary.finalTask = {
    id: final.task.id,
    title: final.task.title,
    status: final.task.status,
    assignee: final.task.assignee,
    targetMachine: final.task.targetMachine,
    completedAt: final.task.completedAt,
    resultHasMarker: String(final.task.result || "").includes(marker),
  };

  summary.ok = true;
  summary.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  summary.error = error instanceof Error ? error.message : String(error);
  summary.finishedAt = new Date().toISOString();
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
});
