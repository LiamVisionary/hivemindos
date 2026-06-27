import type { KanbanTask } from "../../types/kanban";
import {
  loopContractForPrompt,
  runLoopGates,
  type LoopGateJudge,
  type LoopJudgeVerdict,
} from "../loops/loop-runner";

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
  complete: (slug: string | null, taskId: string, input?: Record<string, unknown>, options?: KanbanStorageOptions) => Promise<{ task: KanbanTask; board: unknown; blocked?: boolean; missingGateIds?: string[] }>;
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

    const runWorkerChat = (message: string) => fetchJson(`${collectorUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        rawUserMessage: message,
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

    let text = chatText(await runWorkerChat(autonomousWorkerPrompt(claimed.task, input.marker)));
    if (!text.trim()) {
      // Some runtimes return NO final assistant message on long or tool-heavy prompts
      // (the worker enters a tool loop that ends without emitting text). Retry once asking
      // for a concise, plain-text final answer with no tool calls before giving up.
      text = chatText(await runWorkerChat(autonomousWorkerFallbackPrompt(claimed.task, input.marker)));
    }
    if (!text.trim()) {
      // Still nothing after the retry — fail loud with a re-route hint rather than pretend
      // the work happened. Never mark a task done without real output.
      throw new Error(
        `Agent "${agentName}" returned no final response after a retry (the runtime likely ended a tool loop without emitting text). Re-route this task to a healthy fleet agent or simplify the task.`,
      );
    }

    // Turn the worker output into concrete loop receipts so required eval gates can
    // actually be satisfied (or honestly blocked) instead of staying pending metadata.
    const loopJudge = makeLoopJudge({ collectorUrl, agent, fetchJson, claimLock, marker: input.marker });
    const { receipts } = await runLoopGates({
      loop: claimed.task.loop ?? input.task.loop,
      output: text,
      judge: loopJudge,
    });

    const completion = await complete(null, input.task.id, {
      summary: `Queen Bee autonomous pickup completed by ${agentName}.`,
      result: text,
      loopReceipts: receipts.length ? receipts : undefined,
      metadata: {
        queenBeeAutonomousPickup: true,
        collectorUrl,
        agentName,
        workerClass: input.delegation.workerClass,
        markerSeen: input.marker ? text.includes(input.marker) : undefined,
        loopGatesEvaluated: receipts.length || undefined,
      },
    }, storageOptions);

    const blockedByGates = completion?.blocked === true || completion?.task?.status === "needs-human";
    await advanceFlowIfTagged(input.task, blockedByGates ? "failed" : "passed", text, input.vaultPath);
    if (blockedByGates) {
      const missing = completion?.missingGateIds ?? [];
      return {
        ok: false,
        status: "blocked",
        taskId: input.task.id,
        claimLock,
        collectorUrl,
        agentName,
        error: `Worker finished but required loop gates are unsatisfied: ${missing.join(", ") || "missing required eval receipts"}.`,
      };
    }
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
  const contract = loopContractForPrompt(task.loop);
  return [
    `You are the selected Queen Bee delegate for Work Board task ${task.id}.`,
    "Claim and complete this task now. Return a concise result with any evidence requested by the task.",
    marker ? `If the task asks for a verification marker, include this exact marker: ${marker}` : null,
    "",
    `Title: ${task.title}`,
    "",
    "Task body:",
    task.body,
    contract ? "" : null,
    contract || null,
  ].filter((line) => line !== null).join("\n");
}

/**
 * Builds an independent-reviewer function for `agent:judge` loop gates. It runs a
 * SECOND, evaluation-only collector chat turn (temperature-free rubric) against the
 * worker output. Best-effort: any error resolves to "not accepted" so the gate fails
 * closed and the task blocks for a human rather than passing on a silent error.
 * Returns `undefined` when judging is disabled, leaving judge gates pending.
 */
function makeLoopJudge(ctx: {
  collectorUrl: string;
  agent: QueenBeeAutonomousAgent;
  fetchJson: JsonFetcher;
  claimLock: string;
  marker?: string;
}): LoopGateJudge | undefined {
  if (process.env.QUEEN_BEE_LOOP_JUDGE === "0") return undefined;
  return async ({ gate, output, goal, successCriteria }) => {
    const prompt = [
      "You are an INDEPENDENT reviewer (not the worker that produced the output). Judge ONLY whether the worker output below satisfies the stated gate.",
      `Gate: ${gate.title}`,
      goal ? `Goal: ${goal}` : null,
      successCriteria.length ? `Success criteria:\n- ${successCriteria.join("\n- ")}` : null,
      "",
      "Worker output:",
      truncateForJudge(output),
      "",
      'Reply with ONE line of JSON only: {"accepted": true|false, "reason": "<short reason>"}. Accept only if the output genuinely meets the gate; otherwise reject.',
    ].filter(Boolean).join("\n");
    const chat = await ctx.fetchJson(`${ctx.collectorUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: prompt,
        rawUserMessage: prompt,
        stream: false,
        agent: ctx.agent,
        context: { queenBeeLoopJudge: true, gateId: gate.id, claimLock: ctx.claimLock },
      }),
      signal: AbortSignal.timeout(Number(process.env.QUEEN_BEE_LOOP_JUDGE_TIMEOUT_MS || 120_000)),
    });
    return parseJudgeVerdict(chatText(chat));
  };
}

function parseJudgeVerdict(text: string): LoopJudgeVerdict {
  const json = text.match(/\{[^{}]*"accepted"[^{}]*\}/i);
  if (json) {
    try {
      const parsed = JSON.parse(json[0]) as { accepted?: unknown; reason?: unknown };
      return {
        accepted: parsed.accepted === true,
        summary: typeof parsed.reason === "string" ? parsed.reason : undefined,
        evidence: [],
      };
    } catch {
      // fall through to keyword detection
    }
  }
  const accepted = /\bACCEPT(?:ED)?\b/i.test(text) && !/\bREJECT(?:ED)?\b/i.test(text);
  return { accepted, summary: truncateForJudge(text, 280) };
}

function truncateForJudge(value: string, max = 4_000) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…[truncated]` : trimmed;
}

function autonomousWorkerFallbackPrompt(task: KanbanTask, marker?: string) {
  const contract = loopContractForPrompt(task.loop);
  return [
    `You are the selected Queen Bee delegate for Work Board task ${task.id}.`,
    "Your previous attempt returned no final message. Respond NOW with your final answer as plain text only.",
    "Do NOT call any tools or run any commands. Do NOT plan further — just write the deliverable and your evidence directly. Be concise.",
    marker ? `Include this exact marker on its own line: ${marker}` : null,
    "",
    `Title: ${task.title}`,
    "",
    "Task body:",
    task.body,
    contract ? "" : null,
    contract ? "For any gate you cannot verify in this chat (e.g. lint/typecheck/test/judge), mark it \"skipped\" with a one-line reason in the loop-receipts block rather than attempting it." : null,
    contract || null,
  ].filter((line) => line !== null).join("\n");
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
