import type { KanbanTask } from "../../types/kanban";

// Advance an agent flow when one of its task nodes completes/fails. Dynamic, guarded import keeps
// the flow layer off the autonomous worker's static graph and never breaks task pickup.
async function advanceFlowIfTagged(task: KanbanTask, outcome: "passed" | "failed", output: string, vaultPath?: string | null) {
  if (!task.source || !task.source.startsWith("flow:")) return;
  try {
    const { maybeAdvanceFlowForTask } = await import("./flow-runner");
    await maybeAdvanceFlowForTask({ source: task.source, outcome, output, vaultPath });
  } catch {
    // Flow advancement is best-effort; never let it break autonomous pickup.
  }
}

type KanbanStorageOptions = {
  vaultPath?: string | null;
  kanbanFolder?: string | null;
};

export type QueenBeeAutonomousAgent = {
  id?: string;
  agentId?: string;
  name?: string;
  runtime?: string;
  beeRole?: string;
  workerClass?: string;
  runtimeCapabilities?: Record<string, unknown>;
  collectorCapabilities?: Record<string, unknown>;
};

export type QueenBeeAutonomousDelegation = {
  status?: string;
  workerClass?: string;
  agent?: QueenBeeAutonomousAgent | null;
  machine?: {
    key?: string;
    device?: {
      name?: string;
      collectorUrl?: string;
    };
  } | null;
};

export type QueenBeeAutonomousPickupInput = KanbanStorageOptions & {
  task: KanbanTask;
  delegation: QueenBeeAutonomousDelegation;
  marker?: string;
};

export type QueenBeeAutonomousPickupResult = {
  ok: boolean;
  status: "completed" | "blocked" | "skipped";
  taskId: string;
  claimLock?: string;
  collectorUrl?: string;
  agentName?: string;
  error?: string;
};

type JsonFetcher = (url: string, init: RequestInit) => Promise<unknown>;

type KanbanMutations = {
  claim: (slug: string | null, taskId: string, input?: Record<string, unknown>, options?: KanbanStorageOptions) => Promise<{ task: KanbanTask; board: unknown; run?: unknown }>;
  complete: (slug: string | null, taskId: string, input?: Record<string, unknown>, options?: KanbanStorageOptions) => Promise<{ task: KanbanTask; board: unknown }>;
  block: (slug: string | null, taskId: string, reason: string, options?: KanbanStorageOptions) => Promise<{ task: KanbanTask; board: unknown }>;
};

export type QueenBeeAutonomousPickupDeps = {
  fetchJson?: JsonFetcher;
  claim?: KanbanMutations["claim"];
  complete?: KanbanMutations["complete"];
  block?: KanbanMutations["block"];
};

const DEFAULT_PICKUP_TTL_MS = 30 * 60 * 1000;

export function shouldAutonomouslyPickupQueenBeeTask(input: QueenBeeAutonomousPickupInput) {
  const collectorUrl = cleanCollectorUrl(input.task.targetMachine?.collectorUrl || input.delegation.machine?.device?.collectorUrl);
  const agent = input.delegation.agent;
  return Boolean(
    input.task.status === "ready"
    && input.delegation.status === "delegated"
    && collectorUrl
    && agent
    && (agent.runtime === "hermes" || agent.runtimeCapabilities?.chat || agent.collectorCapabilities?.chat),
  );
}

export function scheduleQueenBeeAutonomousPickup(input: QueenBeeAutonomousPickupInput, deps: QueenBeeAutonomousPickupDeps = {}) {
  if (process.env.QUEEN_BEE_AUTONOMOUS_PICKUP === "0") return false;
  if (!shouldAutonomouslyPickupQueenBeeTask(input)) return false;
  setTimeout(() => {
    void runQueenBeeAutonomousPickup(input, deps).catch((error) => {
      console.error("Queen Bee autonomous pickup failed", error);
    });
  }, 0);
  return true;
}

export async function runQueenBeeAutonomousPickup(
  input: QueenBeeAutonomousPickupInput,
  deps: QueenBeeAutonomousPickupDeps = {},
): Promise<QueenBeeAutonomousPickupResult> {
  const collectorUrl = cleanCollectorUrl(input.task.targetMachine?.collectorUrl || input.delegation.machine?.device?.collectorUrl);
  const agent = input.delegation.agent ?? null;
  const agentName = agent?.name || agent?.id || agent?.agentId || input.task.assignee || "Queen Bee delegate";
  if (!collectorUrl || !agent || input.delegation.status !== "delegated") {
    return { ok: false, status: "skipped", taskId: input.task.id, collectorUrl, agentName, error: "Task has no live delegated collector/agent." };
  }

  const mutations = await defaultKanbanMutations(deps);
  const claim = mutations.claim;
  const complete = mutations.complete;
  const block = mutations.block;
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const claimLock = `queen-bee-autonomous:${input.task.id}:${Date.now().toString(36)}`;
  const storageOptions = { vaultPath: input.vaultPath, kanbanFolder: input.kanbanFolder };

  try {
    const claimed = await claim(null, input.task.id, {
      assignee: agentName,
      claimer: claimLock,
      runtime: agent.runtime || "hermes",
      ttlMs: input.task.maxRuntimeMs || DEFAULT_PICKUP_TTL_MS,
    }, storageOptions);

    const chat = await fetchJson(`${collectorUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: autonomousWorkerPrompt(claimed.task, input.marker),
        rawUserMessage: autonomousWorkerPrompt(claimed.task, input.marker),
        stream: false,
        agent,
        context: {
          queenBeeTaskId: input.task.id,
          queenBeeAutonomousPickup: true,
          claimLock,
          marker: input.marker,
        },
      }),
      signal: AbortSignal.timeout(Number(process.env.QUEEN_BEE_AUTONOMOUS_CHAT_TIMEOUT_MS || 240_000)),
    });
    const text = chatText(chat);
    if (!text.trim()) throw new Error("Autonomous worker chat returned empty output.");
    await complete(null, input.task.id, {
      summary: `Queen Bee autonomous pickup completed by ${agentName}.`,
      result: text,
      metadata: {
        queenBeeAutonomousPickup: true,
        collectorUrl,
        agentName,
        workerClass: input.delegation.workerClass,
        markerSeen: input.marker ? text.includes(input.marker) : undefined,
      },
    }, storageOptions);
    await advanceFlowIfTagged(input.task, "passed", text, input.vaultPath);
    return { ok: true, status: "completed", taskId: input.task.id, claimLock, collectorUrl, agentName };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queen Bee autonomous pickup failed.";
    try {
      await block(null, input.task.id, `Queen Bee autonomous pickup failed for ${agentName}: ${message}`, storageOptions);
    } catch {
      // Preserve the original failure if the board was already moved by another worker.
    }
    await advanceFlowIfTagged(input.task, "failed", message, input.vaultPath);
    return { ok: false, status: "blocked", taskId: input.task.id, claimLock, collectorUrl, agentName, error: message };
  }
}

async function defaultKanbanMutations(deps: QueenBeeAutonomousPickupDeps): Promise<KanbanMutations> {
  if (deps.claim && deps.complete && deps.block) {
    return { claim: deps.claim, complete: deps.complete, block: deps.block };
  }
  const kanban = await import("../kanban/local-kanban-store");
  return {
    claim: deps.claim ?? kanban.claimTask,
    complete: deps.complete ?? kanban.completeTask,
    block: deps.block ?? kanban.blockTask,
  };
}

function autonomousWorkerPrompt(task: KanbanTask, marker?: string) {
  return [
    `You are the selected Queen Bee delegate for Work Board task ${task.id}.`,
    "Claim and complete this task now. Return a concise result with any evidence requested by the task.",
    marker ? `If the task asks for a verification marker, include this exact marker: ${marker}` : null,
    "",
    `Title: ${task.title}`,
    "",
    "Task body:",
    task.body,
  ].filter(Boolean).join("\n");
}

function cleanCollectorUrl(value?: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function defaultFetchJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { text };
  }
  if (!response.ok || (typeof data === "object" && data && (data as { ok?: unknown }).ok === false)) {
    const error = typeof data === "object" && data && "error" in data ? String((data as { error?: unknown }).error) : response.statusText;
    throw new Error(error || `Collector chat failed with ${response.status}.`);
  }
  return data;
}

function chatText(chat: unknown) {
  if (typeof chat === "string") return chat;
  if (!chat || typeof chat !== "object") return "";
  const record = chat as { text?: unknown; result?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  return String(record.text || record.result || record.choices?.[0]?.message?.content || "");
}
