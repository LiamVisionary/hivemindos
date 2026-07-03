import type { KanbanTask } from "../../types/kanban";
import {
  loopContractForPrompt,
  runLoopGates,
  type LoopGateJudge,
  type LoopJudgeVerdict,
  type LoopUrlProber,
  type LoopUrlProbeResult,
} from "../loops/loop-runner";
import { classifyRuntimeFailureOutput } from "./worker-output-failure";

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
    collector?: string;
    device?: {
      name?: string;
      collectorUrl?: string;
    };
  } | null;
};

export type QueenBeeAutonomousPickupInput = KanbanStorageOptions & {
  task: KanbanTask;
  delegation: QueenBeeAutonomousDelegation;
  delegationChain?: QueenBeeAutonomousDelegation[];
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
  reroute: (slug: string | null, taskId: string, input: QueenBeeAutonomousRerouteInput, options?: KanbanStorageOptions) => Promise<{ task: KanbanTask; board: unknown }>;
};

type QueenBeeAutonomousRerouteInput = {
  reason: string;
  failedAgentName?: string;
  nextAssignee: string;
  nextRuntime?: string;
  targetMachine?: KanbanTask["targetMachine"];
};

export type QueenBeeAutonomousPickupDeps = {
  fetchJson?: JsonFetcher;
  claim?: KanbanMutations["claim"];
  complete?: KanbanMutations["complete"];
  block?: KanbanMutations["block"];
  reroute?: KanbanMutations["reroute"];
};

const DEFAULT_PICKUP_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Per-machine autonomous-chat gate.
//
// A batch dispatch (driver re-dispatch sweep, company re-plan) used to fire
// every pickup at once, so several `hermes -z` turns landed on one small box
// simultaneously and starved each other past the 240s chat timeout (live on
// hivemindos-ubuntu-8gb-hel1-2 2026-07-03 ~13:44Z: 10+ CLI boots in 13 min,
// every delegate aborted at exactly the client timeout, while the same box
// completed identical work when it ran alone). The gate serializes pickup
// attempts per target machine: at most QUEEN_BEE_MACHINE_CHAT_CONCURRENCY
// attempts (default 1) hold a machine at once; later attempts wait up to
// QUEEN_BEE_MACHINE_SLOT_WAIT_MS (default 10 min) for a slot, then skip that
// delegate. A pickup whose delegates were ONLY skipped for capacity leaves the
// task "ready" for the next dispatch sweep instead of blocking it to a human.
// Set QUEEN_BEE_MACHINE_CHAT_CONCURRENCY=0 to disable the gate entirely.
// In-process only — the driver's machine-wide lease keeps autonomous dispatch
// in one server process, so this covers the batch path that caused the pile-up.
type MachineChatSlot = { active: number; waiters: Array<{ grant: () => void }> };
const machineChatSlots = new Map<string, MachineChatSlot>();
const inFlightPickupTaskIds = new Set<string>();

function machineChatConcurrency() {
  const raw = String(process.env.QUEEN_BEE_MACHINE_CHAT_CONCURRENCY ?? "").trim();
  if (!raw) return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 1;
  return parsed === 0 ? Number.POSITIVE_INFINITY : Math.floor(parsed);
}

function machineSlotWaitMs() {
  const parsed = Number(process.env.QUEEN_BEE_MACHINE_SLOT_WAIT_MS ?? 10 * 60_000);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10 * 60_000;
}

/**
 * Identity of the machine a delegation's chats land on. Prefers the fleet
 * machine key/name (stable across addressing modes); falls back to the peer
 * identity inside a link peer-proxy URL (`/peer/<host:port>/…` resolves to the
 * REMOTE box, not the local 8788 proxy), then the collector URL host.
 */
export function pickupMachineKey(delegation: QueenBeeAutonomousDelegation, collectorUrl: string): string {
  const named = String(delegation.machine?.key || delegation.machine?.device?.name || "").trim().toLowerCase();
  if (named) return named;
  const url = String(collectorUrl || "").trim();
  const peer = url.match(/\/peer\/([^/?#]+)/);
  if (peer) {
    try {
      return decodeURIComponent(peer[1]).toLowerCase();
    } catch {
      return peer[1].toLowerCase();
    }
  }
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url.toLowerCase() || "unknown-machine";
  }
}

async function acquireMachineChatSlot(key: string): Promise<boolean> {
  const limit = machineChatConcurrency();
  if (!Number.isFinite(limit)) return true;
  const slot = machineChatSlots.get(key) ?? { active: 0, waiters: [] };
  machineChatSlots.set(key, slot);
  if (slot.active < limit) {
    slot.active += 1;
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const waiter = { grant: () => {} };
    const timer = setTimeout(() => {
      const index = slot.waiters.indexOf(waiter);
      if (index >= 0) slot.waiters.splice(index, 1);
      resolve(false);
    }, machineSlotWaitMs());
    waiter.grant = () => {
      clearTimeout(timer);
      slot.active += 1;
      resolve(true);
    };
    slot.waiters.push(waiter);
  });
}

function releaseMachineChatSlot(key: string) {
  const slot = machineChatSlots.get(key);
  if (!slot) return;
  slot.active = Math.max(0, slot.active - 1);
  const next = slot.waiters.shift();
  if (next) next.grant();
  else if (slot.active === 0 && slot.waiters.length === 0) machineChatSlots.delete(key);
}

export function shouldAutonomouslyPickupQueenBeeTask(input: QueenBeeAutonomousPickupInput) {
  return Boolean(
    input.task.status === "ready"
    && input.delegation.status === "delegated"
    && canAutonomouslyRunDelegation(input.task, input.delegation),
  );
}

export function scheduleQueenBeeAutonomousPickup(input: QueenBeeAutonomousPickupInput, deps: QueenBeeAutonomousPickupDeps = {}) {
  if (process.env.QUEEN_BEE_AUTONOMOUS_PICKUP === "0") return false;
  if (!shouldAutonomouslyPickupQueenBeeTask(input)) return false;
  // A pickup can now wait minutes for a machine slot while its task stays
  // "ready" — the next driver sweep would re-dispatch it and double-run the
  // same task in this process. Dedupe on task id for the pickup's lifetime.
  if (inFlightPickupTaskIds.has(input.task.id)) return false;
  inFlightPickupTaskIds.add(input.task.id);
  setTimeout(() => {
    void runQueenBeeAutonomousPickup(input, deps)
      .catch((error) => {
        console.error("Queen Bee autonomous pickup failed", error);
      })
      .finally(() => {
        inFlightPickupTaskIds.delete(input.task.id);
      });
  }, 0);
  return true;
}

export async function runQueenBeeAutonomousPickup(
  input: QueenBeeAutonomousPickupInput,
  deps: QueenBeeAutonomousPickupDeps = {},
): Promise<QueenBeeAutonomousPickupResult> {
  const mutations = await defaultKanbanMutations(deps);
  const claim = mutations.claim;
  const complete = mutations.complete;
  const block = mutations.block;
  const reroute = mutations.reroute;
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const storageOptions = { vaultPath: input.vaultPath, kanbanFolder: input.kanbanFolder };
  const chain = pickupDelegationChain(input);
  if (!chain.length) {
    return { ok: false, status: "skipped", taskId: input.task.id, error: "Task has no live delegated collector/agent." };
  }

  let currentTask = input.task;
  let lastClaimLock = "";
  let lastCollectorUrl = "";
  let lastAgentName = "";
  const failures: string[] = [];
  // Machines that already timed a waiter out this run: skip their remaining
  // delegates immediately instead of paying the slot wait once per delegate.
  const saturatedMachines = new Set<string>();
  let capacitySkips = 0;

  for (let index = 0; index < chain.length; index += 1) {
    const delegation = chain[index];
    const collectorUrl = collectorUrlForDelegation(currentTask, delegation);
    const agent = delegation.agent ?? null;
    const agentName = delegationAgentName(delegation, currentTask.assignee);
    lastCollectorUrl = collectorUrl;
    lastAgentName = agentName;

    if (!canAutonomouslyRunDelegation(currentTask, delegation)) {
      failures.push(`${agentName}: no live delegated collector/agent`);
      continue;
    }

    const machineKey = pickupMachineKey(delegation, collectorUrl);
    if (saturatedMachines.has(machineKey) || !(await acquireMachineChatSlot(machineKey))) {
      saturatedMachines.add(machineKey);
      capacitySkips += 1;
      failures.push(`${agentName}: machine "${machineKey}" is at its autonomous chat capacity`);
      continue;
    }

    const claimLock = `queen-bee-autonomous:${input.task.id}:${Date.now().toString(36)}:${index + 1}`;
    lastClaimLock = claimLock;

    try {
      const claimed = await claim(null, input.task.id, {
        assignee: agentName,
        claimer: claimLock,
        runtime: agent?.runtime || "hermes",
        ttlMs: currentTask.maxRuntimeMs || DEFAULT_PICKUP_TTL_MS,
      }, storageOptions);
      currentTask = claimed.task;

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

      // A runtime that can't reach its model API returns the transport error AS its
      // chat text ("API call failed after 3 retries: Connection error."). That is a
      // failed pickup, not a result — completing with it poisons company memory with
      // fake DONEs. Throw into the reroute/block machinery like any other failure.
      const runtimeFailure = classifyRuntimeFailureOutput(text);
      if (runtimeFailure) {
        throw new Error(
          `Agent "${agentName}" runtime failed instead of producing a result (${runtimeFailure}). Check the runner's model/provider connectivity, then re-route or retry.`,
        );
      }

      // Turn the worker output into concrete loop receipts so required eval gates can
      // actually be satisfied (or honestly blocked) instead of staying pending metadata.
      const loopJudge = makeLoopJudge({ collectorUrl, agent: agent!, fetchJson, claimLock, marker: input.marker });
      const { receipts } = await runLoopGates({
        loop: claimed.task.loop ?? input.task.loop,
        output: text,
        judge: loopJudge,
        probeUrl: makeLiveUrlProber(),
      });

      const completion = await complete(null, input.task.id, {
        summary: `Queen Bee autonomous pickup completed by ${agentName}.`,
        result: text,
        loopReceipts: receipts.length ? receipts : undefined,
        metadata: {
          queenBeeAutonomousPickup: true,
          collectorUrl,
          agentName,
          workerClass: delegation.workerClass ?? input.delegation.workerClass,
          markerSeen: input.marker ? text.includes(input.marker) : undefined,
          loopGatesEvaluated: receipts.length || undefined,
        },
      }, storageOptions);

      const blockedByGates = completion?.blocked === true || completion?.task?.status === "needs-human";
      currentTask = completion.task ?? currentTask;
      if (!blockedByGates) {
        await advanceFlowIfTagged(input.task, "passed", text, input.vaultPath);
        return { ok: true, status: "completed", taskId: input.task.id, claimLock, collectorUrl, agentName };
      }

      const missing = completion?.missingGateIds ?? [];
      const message = `Worker finished but required loop gates are unsatisfied: ${missing.join(", ") || "missing required eval receipts"}.`;
      failures.push(`${agentName}: ${message}`);
      const next = nextPickupDelegation(chain, index + 1, currentTask);
      if (!next) {
        await advanceFlowIfTagged(input.task, "failed", message, input.vaultPath);
        return { ok: false, status: "blocked", taskId: input.task.id, claimLock, collectorUrl, agentName, error: exhaustedMessage(failures) };
      }
      currentTask = (await reroute(null, input.task.id, rerouteInput(message, agentName, next), storageOptions)).task;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Queen Bee autonomous pickup failed.";
      failures.push(`${agentName}: ${message}`);
      const next = nextPickupDelegation(chain, index + 1, currentTask);
      if (!next) {
        const finalMessage = exhaustedMessage(failures);
        try {
          await block(null, input.task.id, finalMessage, storageOptions);
        } catch {
          // Preserve the original failure if the board was already moved by another worker.
        }
        await advanceFlowIfTagged(input.task, "failed", finalMessage, input.vaultPath);
        return { ok: false, status: "blocked", taskId: input.task.id, claimLock, collectorUrl, agentName, error: finalMessage };
      }
      currentTask = (await reroute(null, input.task.id, rerouteInput(message, agentName, next), storageOptions)).task;
    } finally {
      releaseMachineChatSlot(machineKey);
    }
  }

  if (capacitySkips > 0) {
    // At least one delegate was skipped only because its machine was at chat
    // capacity, and no attempt reached a terminal outcome. The task is still
    // "ready" (untouched, or rerouted back to ready), so leave it for the next
    // dispatch sweep to retry once the machine drains — a transient capacity
    // condition must not escalate the task to needs-human.
    return {
      ok: false,
      status: "skipped",
      taskId: input.task.id,
      claimLock: lastClaimLock,
      collectorUrl: lastCollectorUrl,
      agentName: lastAgentName,
      error: exhaustedMessage(failures),
    };
  }

  const finalMessage = exhaustedMessage(failures.length ? failures : ["No eligible autonomous delegates were available."]);
  try {
    await block(null, input.task.id, finalMessage, storageOptions);
  } catch {
    // Preserve the original failure if the board was already moved by another worker.
  }
  await advanceFlowIfTagged(input.task, "failed", finalMessage, input.vaultPath);
  return { ok: false, status: "blocked", taskId: input.task.id, claimLock: lastClaimLock, collectorUrl: lastCollectorUrl, agentName: lastAgentName, error: finalMessage };
}

async function defaultKanbanMutations(deps: QueenBeeAutonomousPickupDeps): Promise<KanbanMutations> {
  if (deps.claim && deps.complete && deps.block && deps.reroute) {
    return { claim: deps.claim, complete: deps.complete, block: deps.block, reroute: deps.reroute };
  }
  const kanban = await import("../kanban/local-kanban-store");
  return {
    claim: deps.claim ?? kanban.claimTask,
    complete: deps.complete ?? kanban.completeTask,
    block: deps.block ?? kanban.blockTask,
    reroute: deps.reroute ?? kanban.rerouteTaskForAutonomousPickup,
  };
}

function canAutonomouslyRunDelegation(
  task: KanbanTask,
  delegation: QueenBeeAutonomousDelegation,
  options: { allowTaskTargetFallback?: boolean } = { allowTaskTargetFallback: true },
) {
  const collectorUrl = collectorUrlForDelegation(task, delegation, options);
  const agent = delegation.agent;
  return Boolean(
    delegation.status === "delegated"
    && collectorUrl
    && agent
    && (agent.runtime === "hermes" || agent.runtimeCapabilities?.chat || agent.collectorCapabilities?.chat),
  );
}

function collectorUrlForDelegation(
  task: KanbanTask,
  delegation: QueenBeeAutonomousDelegation,
  options: { allowTaskTargetFallback?: boolean } = { allowTaskTargetFallback: true },
) {
  return delegationCollectorUrl(delegation)
    || (options.allowTaskTargetFallback === false ? "" : cleanCollectorUrl(task.targetMachine?.collectorUrl));
}

function delegationCollectorUrl(delegation: QueenBeeAutonomousDelegation) {
  const deviceUrl = cleanCollectorUrl(delegation.machine?.device?.collectorUrl);
  if (deviceUrl) return deviceUrl;
  const machineCollector = cleanCollectorUrl(delegation.machine?.collector);
  return /^https?:\/\//i.test(machineCollector) ? machineCollector : "";
}

function pickupDelegationChain(input: QueenBeeAutonomousPickupInput) {
  const chain = [input.delegation, ...(input.delegationChain ?? [])];
  const seen = new Set<string>();
  return chain.filter((delegation) => {
    const key = delegationKey(delegation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function delegationKey(delegation: QueenBeeAutonomousDelegation) {
  const agent = delegation.agent;
  const machine = delegation.machine;
  return [
    cleanCollectorUrl(machine?.device?.collectorUrl),
    cleanCollectorUrl(machine?.collector),
    machine?.key,
    machine?.device?.name,
    agent?.id,
    agent?.agentId,
    agent?.name,
  ].filter(Boolean).join("|") || "unknown-delegation";
}

function delegationAgentName(delegation: QueenBeeAutonomousDelegation, fallback?: string) {
  const agent = delegation.agent;
  return agent?.name || agent?.id || agent?.agentId || fallback || "Queen Bee delegate";
}

function nextPickupDelegation(chain: QueenBeeAutonomousDelegation[], startIndex: number, task: KanbanTask) {
  for (let index = startIndex; index < chain.length; index += 1) {
    if (canAutonomouslyRunDelegation(task, chain[index], { allowTaskTargetFallback: false })) return chain[index];
  }
  return null;
}

function rerouteInput(reason: string, failedAgentName: string, next: QueenBeeAutonomousDelegation): QueenBeeAutonomousRerouteInput {
  return {
    reason: `Autonomous pickup failed for ${failedAgentName}: ${reason}`,
    failedAgentName,
    nextAssignee: delegationAgentName(next),
    nextRuntime: next.agent?.runtime,
    targetMachine: targetMachineForDelegation(next),
  };
}

function targetMachineForDelegation(delegation: QueenBeeAutonomousDelegation): KanbanTask["targetMachine"] {
  const machine = delegation.machine;
  const collectorUrl = delegationCollectorUrl(delegation);
  const name = machine?.device?.name || machine?.key || (collectorUrl ? "Delegated machine" : "");
  if (!name && !collectorUrl) return null;
  return {
    key: machine?.key || name || "delegated-machine",
    name: name || "Delegated machine",
    collectorUrl: collectorUrl || undefined,
  };
}

function exhaustedMessage(failures: string[]) {
  const detail = failures.map((failure) => `- ${failure}`).join("\n");
  return [
    "Queen Bee autonomous pickup exhausted all eligible delegates and now needs human input.",
    detail ? `Failures:\n${detail}` : "",
  ].filter(Boolean).join("\n");
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

/**
 * Real network prober for the live-URL integrity gate. Reads only the response STATUS
 * (HEAD, falling back to GET when a host rejects HEAD) with a short per-URL timeout, so a
 * slow host never stalls completion. Distinguishes a definitive DNS NXDOMAIN from transient
 * failures so the runner blocks only on real fabrication. Disable with QUEEN_BEE_LIVE_URL_PROBE=0.
 * The runner already rejects reserved/mock/non-public hosts WITHOUT this, and never probes them.
 */
function makeLiveUrlProber(): LoopUrlProber | undefined {
  if (process.env.QUEEN_BEE_LIVE_URL_PROBE === "0") return undefined;
  const timeoutMs = Number(process.env.QUEEN_BEE_LIVE_URL_PROBE_TIMEOUT_MS || 5_000);
  return async ({ url }) => {
    for (const method of ["HEAD", "GET"] as const) {
      try {
        const response = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
        if (method === "HEAD" && (response.status === 405 || response.status === 501)) continue; // host dislikes HEAD → GET
        return { status: response.status } satisfies LoopUrlProbeResult;
      } catch (error) {
        if (errorCode(error) === "ENOTFOUND") return { dnsFailed: true }; // definitive: host does not resolve
        if (method === "GET") return { error: error instanceof Error ? error.message : String(error) };
        // HEAD threw for another reason (some servers hang up on HEAD) → fall through to GET.
      }
    }
    return { error: "no response" };
  };
}

/** Undici surfaces DNS/connection errors on `error.cause.code`; some paths use `error.code`. */
function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object") {
    const cause = (error as { cause?: unknown }).cause;
    if (cause && typeof cause === "object" && "code" in cause) return String((cause as { code?: unknown }).code);
    if ("code" in error) return String((error as { code?: unknown }).code);
  }
  return undefined;
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
    const record = typeof data === "object" && data ? (data as { error?: unknown; text?: unknown }) : {};
    // Proxy hops (linkd peer proxy, reverse proxies) put the actual cause in a
    // plain-text body — "hivemind-linkd peer proxy error: <cause>" — which a
    // bare statusText fallback used to discard, leaving only "Bad Gateway" in
    // the task's failure record. Surface the body so failures stay diagnosable.
    const bodyText = typeof record.text === "string" ? record.text.trim().slice(0, 300) : "";
    const error = record.error
      ? String(record.error)
      : bodyText
        ? `${response.status} ${response.statusText || "error"}: ${bodyText}`
        : response.statusText;
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
