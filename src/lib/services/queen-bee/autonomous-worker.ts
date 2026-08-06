import type { KanbanTask, KanbanFailureReason } from "../../types/kanban";
import {
  loopContractForPrompt,
  runLoopGates,
  type LoopGateJudge,
  type LoopJudgeVerdict,
} from "../loops/loop-runner";
import { makeLiveUrlProber } from "../loops/integrity-probes";
import { makeDeliverableContentFetcher } from "@/lib/services/deliverables/content-fetcher";
import { classifyKanbanFailure } from "../kanban/kanban-failure-classification";
import { classifyRuntimeFailureOutput } from "./worker-output-failure";
import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { isLocalCollectorUrl } from "@/lib/services/local-collector-url";
import { runtimeCommandEnv } from "@/lib/services/runtime-command-env";
import { companyIdFromSource } from "@/lib/services/queen-bee/company-task-context";
import { scoreModelStrength } from "@/lib/config/model-strength";
import { getCompany as readCompany } from "@/lib/services/companies-store";
import {
  frontierLabTierFromSkills,
  normalizeFrontierLabPolicy,
  openAiOAuthAgentForFrontierLabTier,
} from "@/lib/frontier-lab";
import {
  addCompanyIntelligenceUsage,
  companyIntelligenceUsageFromResponse,
  releaseCompanyIntelligenceReservation,
  reserveCompanyIntelligence,
  settleCompanyIntelligenceReservation,
  type CompanyIntelligenceLedgerOptions,
  type CompanyIntelligenceOutcome,
  type CompanyIntelligenceUsage,
} from "@/lib/services/company-intelligence-usage";
import type { Company } from "@/lib/types/company";

const execFileAsync = promisify(execFile);

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
  trustedLoopReceipts?: boolean;
};

export type QueenBeeAutonomousAgent = {
  id?: string;
  agentId?: string;
  name?: string;
  runtime?: string;
  provider?: string;
  model?: string;
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
  fail: (slug: string | null, taskId: string, input?: Record<string, unknown>, options?: KanbanStorageOptions) => Promise<{ task: KanbanTask; board: unknown; retried?: boolean; failureReason?: string }>;
  heartbeat?: (slug: string | null, taskId: string, note?: string, claimLock?: string, options?: KanbanStorageOptions) => Promise<unknown>;
};

type QueenBeeAutonomousRerouteInput = {
  reason: string;
  failedAgentName?: string;
  nextAssignee: string;
  nextRuntime?: string;
  targetMachine?: KanbanTask["targetMachine"];
  failedClaimLock?: string;
};

export type QueenBeeAutonomousPickupDeps = {
  fetchJson?: JsonFetcher;
  claim?: KanbanMutations["claim"];
  complete?: KanbanMutations["complete"];
  block?: KanbanMutations["block"];
  reroute?: KanbanMutations["reroute"];
  fail?: KanbanMutations["fail"];
  heartbeat?: KanbanMutations["heartbeat"];
  /** Test seam and alternate store adapter; production reads the replicated company registry. */
  getCompany?: (id: string) => Promise<Company | null>;
  /** Hermetic ledger path/clock for tests. Production uses the private HivemindOS ledger. */
  intelligenceLedgerOptions?: CompanyIntelligenceLedgerOptions;
};

/**
 * How long ONE delegate chat may run. Real company tasks legitimately take
 * tens of minutes; the old fixed 240s default amputated them mid-work (live
 * 2026-07-05: every WEBS chat aborted at exactly 240s under load, then the
 * retries burned the attempt budget). The task's own maxRuntimeMs is the
 * duration contract — honor it; QUEEN_BEE_AUTONOMOUS_CHAT_TIMEOUT_MS remains
 * an absolute operator override, and the claim heartbeat (below) keeps a
 * long-running chat visibly alive so the stale-claim reclaim never sweeps it.
 */
export function pickupChatTimeoutMs(task: Pick<KanbanTask, "maxRuntimeMs">): number {
  const envOverride = Number(process.env.QUEEN_BEE_AUTONOMOUS_CHAT_TIMEOUT_MS);
  if (Number.isFinite(envOverride) && envOverride > 0) return envOverride;
  const runtime = Number(task.maxRuntimeMs);
  if (Number.isFinite(runtime) && runtime > 0) return runtime;
  return DEFAULT_PICKUP_TTL_MS;
}

const pickupHeartbeatMs = () => {
  const parsed = Number(process.env.QUEEN_BEE_PICKUP_HEARTBEAT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
};

const DEFAULT_PICKUP_TTL_MS = 30 * 60 * 1000;

// A claim/reroute rejection that means another dispatcher owns the task RIGHT NOW:
// `claimTask` throws "Task is not ready to claim." when the task is working/locked,
// and `rerouteTaskForAutonomousPickup` throws "claimed by another worker" when a
// different run's claim lock is live. Seen 2026-07-05 (WEBS): two dispatch sweeps
// interleaved on one task — each reroute briefly re-readied it, the other sweep
// claimed it, and the loser's "not ready to claim" lines (non-transient) forced a
// purely-transient outage chain into needs-human. The correct move for the losing
// run is to back off entirely: the task IS being worked; rerouting would steal the
// winner's claim, and more claim attempts just race again.
const CLAIM_CONFLICT = /not ready to claim|claimed by another worker/i;

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
// Set QUEEN_BEE_MACHINE_CHAT_CONCURRENCY=0 to disable the ordinary-company gate.
// A Frontier Lab policy still supplies its own reviewed per-machine ceiling.
// In-process only — the driver's machine-wide lease keeps autonomous dispatch
// in one server process, so this covers the batch path that caused the pile-up.
type MachineChatSlot = { active: number; waiters: Array<{ grant: () => void }> };
const machineChatSlots = new Map<string, MachineChatSlot>();
const inFlightPickupTaskIds = new Set<string>();

function machineChatConcurrency(requestedLimit?: number) {
  const raw = String(process.env.QUEEN_BEE_MACHINE_CHAT_CONCURRENCY ?? "").trim();
  const requested = Number.isFinite(requestedLimit) && Number(requestedLimit) > 0
    ? Math.max(1, Math.floor(Number(requestedLimit)))
    : undefined;
  if (!raw) return requested ?? 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 1;
  if (parsed === 0) return requested ?? Number.POSITIVE_INFINITY;
  const operatorLimit = Math.floor(parsed);
  return requested ? Math.min(operatorLimit, requested) : operatorLimit;
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

async function acquireMachineChatSlot(key: string, requestedLimit?: number): Promise<boolean> {
  const limit = machineChatConcurrency(requestedLimit);
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
  const fail = mutations.fail;
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const storageOptions = { vaultPath: input.vaultPath, kanbanFolder: input.kanbanFolder };
  const chain = pickupDelegationChain(input);
  if (!chain.length) {
    return { ok: false, status: "skipped", taskId: input.task.id, error: "Task has no live delegated collector/agent." };
  }

  const companyId = companyIdFromSource(input.task.source);
  const company = companyId ? await (deps.getCompany ?? readCompany)(companyId) : null;
  const taggedFrontierTier = frontierLabTierFromSkills(input.task.skills);
  if (taggedFrontierTier && (!companyId || !company || !company.frontierLab)) {
    const reason = "Frontier Lab task cannot resolve its company policy, so inference is blocked fail-closed.";
    await block(null, input.task.id, `${reason}\n\nRestore the company definition, then return this task to Ready.`, storageOptions);
    return { ok: false, status: "blocked", taskId: input.task.id, error: reason };
  }
  // Only dispatch-stamped tasks enter Frontier routing. Enabling a company must
  // not retroactively reclassify older queued tasks that lack a reviewed tier.
  const frontierPolicy = taggedFrontierTier && company?.frontierLab
    ? normalizeFrontierLabPolicy(company.frontierLab)
    : undefined;
  const frontierTier = frontierPolicy
    ? taggedFrontierTier ?? "scout"
    : undefined;

  let currentTask = input.task;
  let lastClaimLock = "";
  let lastCollectorUrl = "";
  let lastAgentName = "";
  const failures: string[] = [];
  // Back off without touching the board: another dispatcher owns the task, so this
  // run must not reroute (steal the claim), block, or burn a retry attempt.
  const backOff = (reason: string): QueenBeeAutonomousPickupResult => ({
    ok: false,
    status: "skipped",
    taskId: input.task.id,
    claimLock: lastClaimLock,
    collectorUrl: lastCollectorUrl,
    agentName: lastAgentName,
    error: reason,
  });
  // Reroute to the next delegate, or null when the store refused because another
  // run's claim lock is live (the caller backs off instead of fighting it).
  const rerouteOrConflict = async (message: string, failedAgentName: string, next: QueenBeeAutonomousDelegation, failedClaimLock: string) => {
    try {
      return (await reroute(null, input.task.id, rerouteInput(message, failedAgentName, next, failedClaimLock), storageOptions)).task;
    } catch (error) {
      const rerouteMessage = error instanceof Error ? error.message : String(error);
      if (CLAIM_CONFLICT.test(rerouteMessage)) return null;
      throw error;
    }
  };
  // Machines that already timed a waiter out this run: skip their remaining
  // delegates immediately instead of paying the slot wait once per delegate.
  const saturatedMachines = new Set<string>();
  let capacitySkips = 0;

  for (let index = 0; index < chain.length; index += 1) {
    const delegation = chain[index];
    const collectorUrl = collectorUrlForDelegation(currentTask, delegation);
    const agent = delegation.agent ?? null;
    const effectiveAgent = frontierTier && agent
      ? { ...agent, ...openAiOAuthAgentForFrontierLabTier(frontierTier) }
      : agent;
    const agentName = delegationAgentName(delegation, currentTask.assignee);
    lastCollectorUrl = collectorUrl;
    lastAgentName = agentName;

    if (!canAutonomouslyRunDelegation(currentTask, delegation)) {
      failures.push(`${agentName}: no live delegated collector/agent`);
      continue;
    }

    const machineKey = pickupMachineKey(delegation, collectorUrl);
    if (saturatedMachines.has(machineKey) || !(await acquireMachineChatSlot(machineKey, frontierPolicy?.perMachineConcurrency))) {
      saturatedMachines.add(machineKey);
      capacitySkips += 1;
      failures.push(`${agentName}: machine "${machineKey}" is at its autonomous chat capacity`);
      continue;
    }

    const claimLock = `queen-bee-autonomous:${input.task.id}:${Date.now().toString(36)}:${index + 1}`;
    lastClaimLock = claimLock;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let intelligenceReservationId: string | undefined;
    let intelligenceUsage: CompanyIntelligenceUsage | undefined;
    let intelligenceAttempted = false;
    let intelligenceUnobservedAttempt = false;
    let intelligenceEstimated = false;
    let intelligenceOutcome: CompanyIntelligenceOutcome = "failed";
    let intelligenceReason: string | undefined;

    try {
      if (frontierPolicy && frontierTier && company) {
        // updatedAt is the task revision: concurrent pickups share it and dedupe,
        // while a human requeue/retry creates a fresh revision that may reserve
        // again even when an earlier reservation for this attempt is terminal.
        const reservationId = `${input.task.id}:attempt-${Math.max(1, currentTask.attempt ?? 1)}:revision-${currentTask.updatedAt}:delegate-${index + 1}`;
        const reservation = await reserveCompanyIntelligence(company, {
          reservationId,
          taskId: input.task.id,
          tier: frontierTier,
        }, deps.intelligenceLedgerOptions);
        if (reservation.duplicate) {
          return backOff(`Backed off: Frontier Lab reservation ${reservationId} is already owned by another or prior pickup.`);
        }
        if (reservation.decision === "block") {
          const reason = reservation.reason ?? "The company intelligence budget blocked this task.";
          await block(null, input.task.id, `${reason}\n\nIncrease the Frontier Lab token budget, lower its per-task reservation, or disable Frontier Lab, then return this task to Ready.`, storageOptions);
          await advanceFlowIfTagged(input.task, "failed", reason, input.vaultPath);
          return { ok: false, status: "blocked", taskId: input.task.id, claimLock, collectorUrl, agentName, error: reason };
        }
        intelligenceReservationId = reservationId;
      }

      const claimed = await claim(null, input.task.id, {
        assignee: agentName,
        claimer: claimLock,
        runtime: effectiveAgent?.runtime || "hermes",
        ttlMs: currentTask.maxRuntimeMs || DEFAULT_PICKUP_TTL_MS,
      }, storageOptions);
      currentTask = claimed.task;

      // Keep the claim visibly alive for the whole chat: heartbeats extend
      // claimExpiresAt/lastHeartbeatAt so a legitimately long-running delegate
      // (tens of minutes) is never swept by the stale-claim reclaim mid-work.
      const heartbeat = mutations.heartbeat;
      if (heartbeat) {
        heartbeatTimer = setInterval(() => {
          void Promise.resolve(heartbeat(null, input.task.id, `Autonomous pickup chat in flight (${agentName}).`, claimLock, storageOptions)).catch(() => {});
        }, pickupHeartbeatMs());
        heartbeatTimer.unref?.();
      }

      const observeIntelligence = (response: unknown) => {
        if (!intelligenceReservationId) return;
        intelligenceUnobservedAttempt = false;
        const responseUsage = companyIntelligenceUsageFromResponse(response);
        if (!responseUsage) intelligenceEstimated = true;
        intelligenceUsage = addCompanyIntelligenceUsage(intelligenceUsage, responseUsage);
      };
      const beginIntelligenceAttempt = () => {
        if (!intelligenceReservationId) return;
        intelligenceAttempted = true;
        intelligenceUnobservedAttempt = true;
      };
      const runWorkerChat = async (message: string) => {
        beginIntelligenceAttempt();
        const response = await fetchJson(`${collectorUrl}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            rawUserMessage: message,
            stream: false,
            agent: effectiveAgent,
            context: {
              queenBeeTaskId: input.task.id,
              companyId: companyIdFromSource(claimed.task.source) || undefined,
              companyTaskId: companyIdFromSource(claimed.task.source) ? claimed.task.id : undefined,
              queenBeeAutonomousPickup: true,
              frontierLabTier: frontierTier,
              claimLock,
              marker: input.marker,
            },
          }),
          signal: AbortSignal.timeout(pickupChatTimeoutMs(claimed.task)),
        });
        observeIntelligence(response);
        return response;
      };

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

      // An output that self-declares a human blocker must land as a needs-human
      // card, not a completion. The worker contract asks for an `ACTION NEEDED:`
      // section; agents also open with "Blocked …" prose (live 2026-07-06: a
      // send batch blocked on a missing env token finished "done", so no card
      // ever pinged the human and the blocker sat invisible in a done result).
      // Tolerant match, aligned with the display extractor (kanban-result-format.ts):
      // agents emit "Action needed:", "ACTION_NEEDED:", indented variants — the old
      // /^ACTION NEEDED:/m column-0 uppercase-only match let those complete as "done"
      // with the ask buried in the result (live incident 2026-07-06).
      if (/(?:^|\n)\s*ACTION[\s_-]*NEEDED\s*:/i.test(text) || /^Blocked\b/.test(text.trim())) {
        intelligenceOutcome = "blocked";
        intelligenceReason = "Agent asked for human input.";
        await block(null, input.task.id, text, storageOptions);
        await advanceFlowIfTagged(input.task, "failed", text, input.vaultPath);
        return { ok: false, status: "blocked", taskId: input.task.id, claimLock, collectorUrl, agentName, error: "Agent asked for human input." };
      }

      // Turn the worker output into concrete loop receipts so required eval gates can
      // actually be satisfied (or honestly blocked) instead of staying pending metadata.
      const reviewer = independentReviewerDelegation(chain, index + 1, agent!);
      const loopJudge = reviewer
        ? makeLoopJudge({
          collectorUrl: delegationCollectorUrl(reviewer),
          agent: frontierPolicy
            ? { ...reviewer.agent!, ...openAiOAuthAgentForFrontierLabTier("reviewer") }
            : reviewer.agent!,
          fetchJson,
          claimLock,
          marker: input.marker,
          machineKey: pickupMachineKey(reviewer, delegationCollectorUrl(reviewer)),
          heldMachineKey: machineKey,
          requestedMachineConcurrency: frontierPolicy?.perMachineConcurrency,
          onAttempt: beginIntelligenceAttempt,
          onResponse: observeIntelligence,
        })
        : undefined;
      const { receipts } = await runLoopGates({
        loop: claimed.task.loop ?? input.task.loop,
        output: text,
        judge: loopJudge,
        runCommand: makeLocalLoopCommandRunner(claimed.task),
        verifyArtifact: makeLocalLoopArtifactVerifier(claimed.task),
        probeUrl: makeLiveUrlProber(),
        fetchContent: makeDeliverableContentFetcher(),
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
      }, { ...storageOptions, trustedLoopReceipts: true });

      const blockedByGates = completion?.blocked === true || completion?.task?.status === "needs-human";
      currentTask = completion.task ?? currentTask;
      if (!blockedByGates) {
        intelligenceOutcome = "completed";
        await advanceFlowIfTagged(input.task, "passed", text, input.vaultPath);
        return { ok: true, status: "completed", taskId: input.task.id, claimLock, collectorUrl, agentName };
      }

      const missing = completion?.missingGateIds ?? [];
      const message = `Worker finished but required loop gates are unsatisfied: ${missing.join(", ") || "missing required eval receipts"}.`;
      intelligenceOutcome = "blocked";
      intelligenceReason = message;
      failures.push(`${agentName}: ${message}`);
      const next = nextPickupDelegation(chain, index + 1, currentTask);
      if (!next) {
        await advanceFlowIfTagged(input.task, "failed", message, input.vaultPath);
        return { ok: false, status: "blocked", taskId: input.task.id, claimLock, collectorUrl, agentName, error: exhaustedMessage(failures) };
      }
      const rerouted = await rerouteOrConflict(message, agentName, next, claimLock);
      if (!rerouted) return backOff(`Backed off: another worker claimed task ${input.task.id} while ${agentName}'s gate failure was being rerouted.`);
      currentTask = rerouted;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Queen Bee autonomous pickup failed.";
      intelligenceOutcome = "failed";
      intelligenceReason = message;
      if (CLAIM_CONFLICT.test(message)) {
        return backOff(`Backed off: ${agentName} could not claim task ${input.task.id} — another dispatcher already holds it (${message})`);
      }
      // Name the machine in the failure record: "aborted due to timeout" alone
      // hides WHERE the chat ran, which made the single-machine funnel invisible.
      failures.push(`${agentName} [${machineKey}]: ${message}`);
      const next = nextPickupDelegation(chain, index + 1, currentTask);
      if (!next) {
        const finalMessage = exhaustedMessage(failures);
        const { retried } = await finalizeExhaustedPickup(fail, block, input.task.id, failures, finalMessage, storageOptions, {
          reroute,
          delegation: preferredExhaustionRetryDelegation(chain, failures),
        });
        // A transient-only chain that auto-retried is not a flow failure — the task
        // is back on the queue, so leave the flow untouched until it truly resolves.
        if (!retried) await advanceFlowIfTagged(input.task, "failed", finalMessage, input.vaultPath);
        return { ok: false, status: retried ? "skipped" : "blocked", taskId: input.task.id, claimLock, collectorUrl, agentName, error: finalMessage };
      }
      const rerouted = await rerouteOrConflict(message, agentName, next, claimLock);
      if (!rerouted) return backOff(`Backed off: another worker claimed task ${input.task.id} while ${agentName}'s failure was being rerouted.`);
      currentTask = rerouted;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (intelligenceReservationId && companyId) {
        try {
          if (intelligenceAttempted) {
            const estimated = intelligenceEstimated || intelligenceUnobservedAttempt;
            await settleCompanyIntelligenceReservation(companyId, intelligenceReservationId, {
              outcome: intelligenceOutcome,
              usage: estimated
                ? { ...intelligenceUsage, totalTokens: Math.max(intelligenceUsage?.totalTokens ?? 0, frontierPolicy?.perTaskTokenLimit ?? 0) }
                : intelligenceUsage,
              estimated,
              reason: intelligenceReason,
            }, deps.intelligenceLedgerOptions);
          } else {
            await releaseCompanyIntelligenceReservation(companyId, intelligenceReservationId, {
              outcome: "failed",
              reason: intelligenceReason ?? "Pickup ended before an inference response was observed.",
            }, deps.intelligenceLedgerOptions);
          }
        } catch (ledgerError) {
          console.error(`[queen-bee] failed to settle Frontier Lab reservation ${intelligenceReservationId}:`, ledgerError);
        }
      }
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
  const { retried } = await finalizeExhaustedPickup(fail, block, input.task.id, failures, finalMessage, storageOptions, {
    reroute,
    delegation: preferredExhaustionRetryDelegation(chain, failures),
  });
  if (!retried) await advanceFlowIfTagged(input.task, "failed", finalMessage, input.vaultPath);
  return { ok: false, status: retried ? "skipped" : "blocked", taskId: input.task.id, claimLock: lastClaimLock, collectorUrl: lastCollectorUrl, agentName: lastAgentName, error: finalMessage };
}

const SAFE_LOOP_COMMANDS = new Map<string, { command: string; args: string[] }>([
  ["pnpm run lint", { command: "pnpm", args: ["run", "lint"] }],
  ["pnpm exec tsc --noEmit --pretty false --skipLibCheck", { command: "pnpm", args: ["exec", "tsc", "--noEmit", "--pretty", "false", "--skipLibCheck"] }],
  ["pnpm test", { command: "pnpm", args: ["test"] }],
  ["pnpm exec playwright test", { command: "pnpm", args: ["exec", "playwright", "test"] }],
]);

function localTaskWorkingDirectory(task: KanbanTask): string | undefined {
  if (!isLocalCollectorUrl(task.targetMachine?.collectorUrl)) return undefined;
  if (task.workspace.startsWith("dir:")) {
    const path = task.workspace.slice(4).trim();
    return isAbsolute(path) ? path : undefined;
  }
  return task.linkedDirectories
    ?.map((entry) => entry.path)
    .find((path): path is string => typeof path === "string" && isAbsolute(path));
}

function makeLocalLoopCommandRunner(task: KanbanTask) {
  const cwd = localTaskWorkingDirectory(task);
  if (!cwd) return undefined;
  return async ({ command }: { command: string }) => {
    const spec = SAFE_LOOP_COMMANDS.get(command);
    if (!spec) return { ok: false, output: `Command is not in the trusted loop allowlist: ${command}` };
    try {
      const result = await execFileAsync(spec.command, spec.args, {
        cwd,
        timeout: 10 * 60_000,
        maxBuffer: 2_000_000,
        env: runtimeCommandEnv(),
      });
      return { ok: true, exitCode: 0, output: `${result.stdout}${result.stderr}`.trim() };
    } catch (error) {
      const value = error as { code?: unknown; stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        exitCode: typeof value.code === "number" ? value.code : undefined,
        output: `${value.stdout ?? ""}${value.stderr ?? ""}`.trim() || value.message,
      };
    }
  };
}

function makeLocalLoopArtifactVerifier(task: KanbanTask) {
  if (!isLocalCollectorUrl(task.targetMachine?.collectorUrl)) return undefined;
  return async ({ artifact }: { artifact: string }) => {
    const path = artifact.startsWith("file://") ? new URL(artifact).pathname : artifact;
    if (!isAbsolute(path)) return { ok: false, error: "Artifact path is not absolute." };
    const entry = await stat(path).catch(() => null);
    return entry
      ? { ok: true, evidence: [`stat: ${entry.isDirectory() ? "directory" : "file"}, ${entry.size} bytes`] }
      : { ok: false, error: "Artifact does not exist on the execution machine." };
  };
}

async function defaultKanbanMutations(deps: QueenBeeAutonomousPickupDeps): Promise<KanbanMutations> {
  if (deps.claim && deps.complete && deps.block && deps.reroute && deps.fail) {
    return { claim: deps.claim, complete: deps.complete, block: deps.block, reroute: deps.reroute, fail: deps.fail, heartbeat: deps.heartbeat };
  }
  const kanban = await import("../kanban/local-kanban-store");
  return {
    claim: deps.claim ?? kanban.claimTask,
    complete: deps.complete ?? kanban.completeTask,
    block: deps.block ?? kanban.blockTask,
    reroute: deps.reroute ?? kanban.rerouteTaskForAutonomousPickup,
    fail: deps.fail ?? kanban.failTask,
    heartbeat: deps.heartbeat ?? ((slug, taskId, note, claimLock, options) => kanban.heartbeatTask(slug, taskId, note, claimLock, options)),
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

function rerouteInput(reason: string, failedAgentName: string, next: QueenBeeAutonomousDelegation, failedClaimLock?: string): QueenBeeAutonomousRerouteInput {
  return {
    reason: `Autonomous pickup failed for ${failedAgentName}: ${reason}`,
    failedAgentName,
    nextAssignee: delegationAgentName(next),
    nextRuntime: next.agent?.runtime,
    targetMachine: targetMachineForDelegation(next),
    failedClaimLock,
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

function independentReviewerDelegation(
  chain: QueenBeeAutonomousDelegation[],
  startIndex: number,
  worker: QueenBeeAutonomousAgent,
): QueenBeeAutonomousDelegation | undefined {
  const workerIdentity = agentIdentity(worker);
  const eligible = chain.slice(startIndex).filter((delegation) => {
    const reviewer = delegation.agent;
    return Boolean(
      reviewer
      && delegationCollectorUrl(delegation)
      && agentIdentity(reviewer)
      && agentIdentity(reviewer) !== workerIdentity,
    );
  });
  // The strongest-model eligible reviewer judges, not merely the next in chain
  // order — a weak fallback model rubber-stamping a frontier worker's output
  // defeats the independent review. Array.prototype.sort is stable, so equal
  // scores keep the delegation chain's own order as the tiebreak.
  return eligible.sort((a, b) => scoreModelStrength(b.agent?.model).score - scoreModelStrength(a.agent?.model).score)[0];
}

function agentIdentity(agent: QueenBeeAutonomousAgent): string {
  return String(agent.id || agent.agentId || agent.name || "").trim().toLowerCase();
}

function exhaustedMessage(failures: string[]) {
  const detail = failures.map((failure) => `- ${failure}`).join("\n");
  return [
    "Queen Bee autonomous pickup exhausted all eligible delegates and now needs human input.",
    detail ? `Failures:\n${detail}` : "",
    "ACTION NEEDED: Review the delegate failures above, fix the underlying agent or runtime issue, then move this card back to Ready for another autonomous attempt.",
  ].filter(Boolean).join("\n");
}

// A delegate failure that is purely transport-level: the box was slow/overloaded
// (client abort at the chat timeout) or its collector gateway briefly died (502/503/
// 504). These are self-healing — the SAME agent completes the work once the machine
// drains — so a whole chain that failed ONLY this way should retry on a later sweep,
// not strand the company task on a human. Provider 429/usage-limit failures are also
// retryable, but they keep their typed `rate-limit` reason so Work Board attempts and
// infra-rescue receipts distinguish capacity from model quota. Content failures
// (a rejected eval gate, a non-429 runtime/model error) are deliberately excluded:
// those need a human, so a chain with any of them still escalates.
const TRANSIENT_PICKUP_FAILURE =
  /(timed?\s*out|timeout|aborted|abort(?:ed)? due to|bad gateway|gateway timeout|\b50[234]\b|service unavailable|temporarily unavailable|econnreset|econnrefused|socket hang ?up|connection (?:error|reset|refused)|network error|fetch failed)/i;

// A runtime that ends its tool loop without emitting a final message ("no final
// response was produced", even after our plain-text retry) is a runtime flake,
// not a judgment about the work: the task body never got a real attempt. This
// was previously excluded as a "content failure" and it strand-blocked 57 live
// WEBS tasks at attempt 1/3 (measured 2026-07-16) — every one a human page for
// something a re-route or later retry absorbs. It consumes the task's normal
// retry budget via `failTask`; after maxAttempts it still escalates.
const NO_OUTPUT_PICKUP_FAILURE =
  /(no final response was produced|returned no final response|runtime failed instead of producing a result)/i;

// Infrastructure failures that are not raw transport but still say nothing about
// the WORK: a machine at its autonomous chat capacity (the slot frees up), a
// delegate with no live collector in this snapshot (the machine comes back), or
// a claim race with another dispatcher. Live 2026-07-05 (WEBS t_mr7nmkl4_vr67n):
// a chain of 4 transport + 2 capacity lines — 100% infrastructure — escalated to
// needs-human because capacity lines failed the transport-only regex below.
const INFRA_PICKUP_FAILURE =
  /(at its autonomous chat capacity|no live delegated collector\/agent|not ready to claim|claimed by another worker)/i;

/**
 * True when one "Failures:" line describes infrastructure (transport, capacity,
 * machine offline, dispatch race) rather than the work itself failing. Shared
 * with the driver's infra-rescue sweep so both ends use one vocabulary.
 */
export function isInfrastructurePickupFailure(line: string): boolean {
  return TRANSIENT_PICKUP_FAILURE.test(line) || INFRA_PICKUP_FAILURE.test(line) || NO_OUTPUT_PICKUP_FAILURE.test(line);
}

/**
 * The retry failure-reason for an exhausted pickup, or `undefined` to escalate
 * to needs-human. Queen-takeover rule (Liam, 2026-07-18): a chain retries when
 * ANY delegate failed on infrastructure — not only when every failure was.
 * Live case: 13 delegates failed deterministically on broken model/provider
 * configs, which saturated the machine, so the healthy agents at the chain's
 * tail (including the one that had completed a task an hour earlier) died on
 * "fetch failed" — and the old every() rule handed the whole thing to a human
 * even though a targeted retry on a calm machine plausibly succeeds. Routed
 * through `failTask`, "timeout" is auto-retried up to the task's maxAttempts,
 * then still blocked to a human — the attempts budget bounds the takeover.
 */
export function pickupExhaustionRetryReason(failures: string[]): KanbanFailureReason | undefined {
  if (failures.length === 0) return undefined;
  if (failures.every((failure) => classifyKanbanFailure(failure) === "rate-limit")) return "rate-limit";
  if (!failures.some((failure) => isInfrastructurePickupFailure(failure))) return undefined;
  return "timeout";
}

/**
 * The delegate a queen-takeover retry should target: the first (chain-ranked)
 * delegate whose failure was pure TRANSPORT — it never got to run, so it is
 * the best candidate once the machine calms — falling back to the first
 * broader infrastructure failure. Retrying the whole chain would re-burn the
 * deterministically-broken delegates and saturate the machine again.
 */
export function preferredExhaustionRetryDelegation(
  chain: QueenBeeAutonomousDelegation[],
  failures: string[],
): QueenBeeAutonomousDelegation | undefined {
  const failureFor = (name: string) => failures.find((line) => line.startsWith(`${name} [`) || line.startsWith(`${name}:`));
  let infraFallback: QueenBeeAutonomousDelegation | undefined;
  for (const delegation of chain) {
    const name = delegationAgentName(delegation);
    if (!name) continue;
    const failure = failureFor(name);
    if (!failure) continue;
    if (TRANSIENT_PICKUP_FAILURE.test(failure)) return delegation;
    if (!infraFallback && isInfrastructurePickupFailure(failure)) infraFallback = delegation;
  }
  return infraFallback;
}

/**
 * Terminal outcome for an exhausted delegate chain: auto-retry via `failTask`
 * when the failures qualify (see pickupExhaustionRetryReason — queen takeover:
 * ANY infrastructure failure retries), otherwise block the card to needs-human.
 * On retry, when a preferred takeover delegate is known (the transient-failed
 * healthy agent), the task is re-pointed at it so the next sweep runs THAT
 * agent directly instead of re-burning the broken front of the chain.
 */
async function finalizeExhaustedPickup(
  fail: KanbanMutations["fail"],
  block: KanbanMutations["block"],
  taskId: string,
  failures: string[],
  finalMessage: string,
  storageOptions: KanbanStorageOptions,
  takeover?: { reroute: KanbanMutations["reroute"]; delegation: QueenBeeAutonomousDelegation | undefined },
): Promise<{ retried: boolean }> {
  const retryReason = pickupExhaustionRetryReason(failures);
  if (retryReason) {
    try {
      const result = await fail(null, taskId, { failureReason: retryReason, summary: finalMessage, error: finalMessage }, storageOptions);
      // retried → status is back to "ready" (attempt++), the driver re-routes it.
      // not retried → failTask already moved it to needs-human (attempts exhausted).
      const retried = result?.retried === true;
      if (retried && takeover?.delegation) {
        await takeover.reroute(null, taskId, rerouteInput(
          "Queen takeover: retrying with the delegate that only failed on infrastructure.",
          "exhausted chain",
          takeover.delegation,
        ), storageOptions).catch(() => undefined);
      }
      return { retried };
    } catch {
      // fall through to a plain block on any failTask error
    }
  }
  try {
    await block(null, taskId, finalMessage, storageOptions);
  } catch {
    // Preserve the original failure if the board was already moved by another worker.
  }
  return { retried: false };
}

function autonomousWorkerPrompt(task: KanbanTask, marker?: string) {
  const contract = loopContractForPrompt(task.loop);
  const companyId = companyIdFromSource(task.source);
  return [
    `You are the selected Queen Bee delegate for Work Board task ${task.id}.`,
    "Claim and complete this task now. Return a concise result with any evidence requested by the task.",
    "If you are blocked on human input, access, approval, or a decision, end your result with a section named exactly `ACTION NEEDED:` containing one or two imperative sentences telling the human precisely what to do or decide (include the options if there is a choice). This section becomes the card's headline on the Work Board.",
    "When it helps the human act faster, add extra lines directly under `ACTION NEEDED:` — `LINK: <url>` pointing where they get or do the thing (for an API key, the exact page that issues it), `OPTIONS: <choice A> | <choice B>` when you need a decision, and `NEEDS: api-key <ENV_VAR_NAME>` (or `NEEDS: file` / `NEEDS: text`) naming what you are waiting for. The Work Board renders these as one-click answer buttons, a save-to-shared-env key input, or an attach-a-file prompt, and the human's answer comes back to you on this task.",
    marker ? `If the task asks for a verification marker, include this exact marker: ${marker}` : null,
    companyId ? `Company task context: company ${companyId}; Work Board task ${task.id}.` : null,
    companyId ? `When a wallet, trade, paid API, or hosted-spend tool supports companyTaskId, pass exactly ${task.id}. Never attach companyTaskId to unrelated work.` : null,
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
  /** Fleet identity of the machine the judge chat lands on (see pickupMachineKey). */
  machineKey?: string;
  /** Machine key whose chat slot the worker pickup ALREADY holds while gates run. */
  heldMachineKey?: string;
  requestedMachineConcurrency?: number;
  onAttempt?: () => void;
  onResponse?: (response: unknown) => void;
}): LoopGateJudge | undefined {
  if (process.env.QUEEN_BEE_LOOP_JUDGE === "0") return undefined;
  return async ({ gate, output, goal, successCriteria, contract, evaluationRubric }) => {
    const prompt = [
      "You are an INDEPENDENT reviewer (not the worker that produced the output). Judge ONLY whether the worker output below satisfies the stated gate.",
      `Gate: ${gate.title}`,
      goal ? `Goal: ${goal}` : null,
      successCriteria.length ? `Success criteria:\n- ${successCriteria.join("\n- ")}` : null,
      contract ? [
        `Negotiated contract: ${contract.title}`,
        contract.agreedDone.length ? `Agreed done:\n- ${contract.agreedDone.join("\n- ")}` : "",
        contract.evaluatorPushback.length ? `Evaluator pushback:\n- ${contract.evaluatorPushback.join("\n- ")}` : "",
      ].filter(Boolean).join("\n") : null,
      evaluationRubric ? [
        `Rubric: ${evaluationRubric.title}; pass >= ${evaluationRubric.passThreshold}`,
        ...evaluationRubric.axes.map((axis) => `- ${axis.title} (${Math.round(axis.weight * 100)}%): ${axis.description}`),
      ].join("\n") : null,
      "",
      "Worker output:",
      truncateForJudge(output),
      "",
      evaluationRubric
        ? `Score every rubric axis. Reply with ONE line of JSON only: {"accepted":true|false,"confidence":0.0,"reason":"<short reason>","axes":[${evaluationRubric.axes.map((axis) => `{"id":"${axis.id}","score":0.0,"evidence":["specific evidence"]}`).join(",")}]} . Accept only when every score is evidence-backed and the weighted result meets the threshold.`
        : 'Reply with ONE line of JSON only: {"accepted":true|false,"confidence":0.0,"reason":"<short reason>","axes":[]}. Accept only if the output genuinely meets the gate; otherwise reject.',
    ].filter(Boolean).join("\n");
    const runJudgeChat = async (message: string) => {
      ctx.onAttempt?.();
      const response = await ctx.fetchJson(`${ctx.collectorUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          rawUserMessage: message,
          stream: false,
          agent: ctx.agent,
          context: { queenBeeLoopJudge: true, gateId: gate.id, claimLock: ctx.claimLock },
        }),
        signal: AbortSignal.timeout(Number(process.env.QUEEN_BEE_LOOP_JUDGE_TIMEOUT_MS || 120_000)),
      });
      ctx.onResponse?.(response);
      return response;
    };
    // A judge chat landing on a DIFFERENT machine than the one the worker pickup
    // already holds must take that machine's own chat slot — the 1-chat-per-machine
    // gate protects small boxes from concurrent `hermes -z` turns regardless of which
    // pickup fired them. A same-machine judge keeps running under the already-held
    // slot: re-acquiring it here would self-deadlock the pickup against itself.
    const needsOwnSlot = Boolean(ctx.machineKey && ctx.machineKey !== ctx.heldMachineKey);
    if (needsOwnSlot && !(await acquireMachineChatSlot(ctx.machineKey!, ctx.requestedMachineConcurrency))) {
      return {
        accepted: false,
        summary: `Reviewer machine "${ctx.machineKey}" is at its autonomous chat capacity; the judge chat never ran.`,
      };
    }
    try {
      let verdict = parseJudgeVerdict(chatText(await runJudgeChat(prompt)));
      if (!verdict) {
        // Mirror of the worker's empty-output retry: some runtimes wrap the verdict
        // in prose ("The output is not accepted…"), which must never keyword-match
        // to a pass. One corrective retry, then fail closed (judge doctrine above).
        verdict = parseJudgeVerdict(chatText(await runJudgeChat(`${prompt}\n\nYour previous reply was not parseable. Return ONLY the JSON object.`)));
      }
      if (!verdict) verdict = { accepted: false, summary: "unparseable judge verdict" };
      return {
        ...verdict,
        evaluator: {
          agentId: ctx.agent.id || ctx.agent.agentId || ctx.agent.name,
          model: ctx.agent.model,
          runtime: ctx.agent.runtime,
          independent: true,
        },
      };
    } finally {
      if (needsOwnSlot) releaseMachineChatSlot(ctx.machineKey!);
    }
  };
}

/**
 * Parses a judge chat reply into a verdict, or `null` when the reply carries no
 * parseable verdict at all — the caller retries once, then fails closed. Free
 * prose must NEVER keyword-match to a pass: "The output is not accepted" contains
 * ACCEPTED, so keyword detection is restricted to an exact single-token reply.
 */
function parseJudgeVerdict(text: string): LoopJudgeVerdict | null {
  const json = text.match(/\{[\s\S]*"accepted"[\s\S]*\}/i);
  if (json) {
    try {
      const parsed = JSON.parse(json[0]) as { accepted?: unknown; confidence?: unknown; reason?: unknown; axes?: unknown };
      const axes = Array.isArray(parsed.axes)
        ? parsed.axes.flatMap((axis) => {
          if (!axis || typeof axis !== "object") return [];
          const record = axis as { id?: unknown; score?: unknown; evidence?: unknown };
          const id = typeof record.id === "string" ? record.id.trim() : "";
          const score = Number(record.score);
          if (!id || !Number.isFinite(score)) return [];
          return [{
            id,
            score: Math.max(0, Math.min(1, score)),
            evidence: Array.isArray(record.evidence)
              ? record.evidence.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 4)
              : [],
          }];
        })
        : [];
      return {
        accepted: parsed.accepted === true,
        summary: typeof parsed.reason === "string" ? parsed.reason : undefined,
        evidence: axes.flatMap((axis) => axis.evidence ?? []),
        confidence: Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : undefined,
        axes,
      };
    } catch {
      // fall through to the exact-token check / unparseable-null
    }
  }
  const token = text.trim().toUpperCase();
  if (token === "ACCEPT" || token === "ACCEPTED") return { accepted: true, summary: text.trim() };
  if (token === "REJECT" || token === "REJECTED") return { accepted: false, summary: text.trim() };
  return null;
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

/**
 * Long-session-safe transport for http:// collector calls. A non-streaming
 * `/chat` responds only when the WHOLE agent session finishes — routinely far
 * past undici's default 300s headers timeout, so bare fetch executed every
 * long delegate session at the 5-minute wall as a bare "fetch failed"
 * (2026-07-19: two real posting sessions died at 5:23 and 5:02). node:http
 * applies no response deadline. https/other schemes keep fetch below.
 */
function httpTextRequest(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; statusText: string; text: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: init.method ?? "GET",
      headers: (init.headers as Record<string, string> | undefined) ?? {},
    }, (response) => {
      const chunks: Uint8Array[] = [];
      response.on("data", (chunk: Uint8Array) => chunks.push(chunk));
      response.on("end", () => resolve({
        ok: (response.statusCode ?? 500) < 400,
        status: response.statusCode ?? 0,
        statusText: response.statusMessage ?? "",
        text: Buffer.concat(chunks).toString("utf8"),
      }));
      response.on("error", reject);
    });
    request.on("error", reject);
    if (typeof init.body === "string") request.write(init.body);
    request.end();
  });
}

async function defaultFetchJson(url: string, init: RequestInit) {
  let response: { ok: boolean; status: number; statusText: string; text: string };
  if (url.startsWith("http://")) {
    response = await httpTextRequest(url, init);
  } else {
    const fetched = await fetch(url, init);
    response = { ok: fetched.ok, status: fetched.status, statusText: fetched.statusText, text: await fetched.text() };
  }
  const text = response.text;
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
