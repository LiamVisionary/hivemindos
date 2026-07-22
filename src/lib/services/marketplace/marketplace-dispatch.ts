import "server-only";

import { hostname } from "node:os";

import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import { isLoopbackCollector, sameMachineIdentity } from "@/features/fleet/fleet-identity";
import { resolveCompanyDriverSelfBases } from "@/lib/services/company-autonomy-driver";
import { machineMatchesTarget } from "@/lib/services/queen-bee/router";
import { submitQueenBeeMessage, type QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";
import { moveTask, readBoard } from "@/lib/services/kanban/local-kanban-store";
import { parseMarketplaceAgentReport } from "@/lib/services/marketplace/marketplace-agent-report";
import type { MarketplaceAgentDispatch, MarketplaceAgentTaskInput } from "@/lib/services/marketplace/adapters/types";
import type { MarketplaceAgentReport } from "@/lib/services/marketplace/marketplace-types";

/**
 * Marketplace → queen-bee dispatch rail. Ops that need the signed-in browser
 * session run as agent tasks PINNED to the profile-owning machine: submit a
 * mode:"act" queen task (routing, retries, receipts, collector /chat delivery
 * all come from the existing queen rail), then await the Work Board task's
 * completion and parse the fenced MARKETPLACE_REPORT from its result text.
 */

const DEFAULT_TASK_TIMEOUT_MS = 30 * 60_000;
const POLL_MS = 5_000;

/** Self-fetch the live fleet snapshot (company-driver pattern — the queen router needs machines to delegate). */
async function fetchFleetSnapshot(): Promise<QueenBeeFleetMachine[]> {
  for (const base of resolveCompanyDriverSelfBases()) {
    try {
      const res = await fetch(`${base}/api/fleet/discover?stale=1&includeSnapshots=0`, {
        cache: "no-store",
        headers: internalApiAuthHeaders(),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const json = (await res.json().catch(() => ({}))) as { machines?: QueenBeeFleetMachine[] };
      if (Array.isArray(json?.machines)) return json.machines;
    } catch {
      // wrong loopback family / proxy down — try the next candidate
    }
  }
  return [];
}

export type SubmittedMarketplaceTask = { taskId: string; created: boolean };

/**
 * A globally-unique pin identifier for a snapshot machine: the tailnet dns
 * label (e.g. "hivemindos-liams-macbook-pro") or the stable machine id. NEVER
 * the friendly device name — every machine's own snapshot labels itself
 * "This Mac", so persisting that as a pin would match the WRONG machine on any
 * other machine's re-route sweep. Empty when the machine carries neither.
 */
function machinePinIdentifier(machine: QueenBeeFleetMachine): string {
  const dns = String(machine.device?.dnsName ?? "").trim().replace(/\.$/, "");
  const dnsLabel = dns.split(".")[0] ?? "";
  return dnsLabel || String(machine.device?.machineId ?? "").trim() || machine.key?.trim() || "";
}

/**
 * Resolve the account's machine pin (its stored machineKey — a hostname like
 * "Liams-MacBook-Pro") to an identifier the queen router can actually match.
 * The live fleet payload identifies this machine by its Hivemind Link tsnet
 * name ("hivemindos-liams-macbook-pro…"), carries NO top-level key, and calls
 * itself "This Mac" — so the raw hostname matches nothing (live 2026-07-18:
 * every pinned marketplace dispatch sat pending on a healthy fleet). When the
 * pin is this host, resolve via the snapshot's `device.self` marker (with a
 * local-collector fallback that knows loopback-hosted linkd `/peer/` URLs are
 * REMOTE). An unresolvable pin is returned as-is: with requestedMachine
 * persisted on the task, the router holds it pending rather than routing to
 * the wrong machine.
 */
export function resolvePinnedMachineKey(fleet: QueenBeeFleetMachine[], machineKey: string): string {
  const direct = fleet.find((machine) => machineMatchesTarget(machine, machineKey));
  if (direct) return machinePinIdentifier(direct) || machineKey;
  if (sameMachineIdentity(machineKey, hostname())) {
    const local = fleet.find((machine) => machine.device?.self === true)
      ?? fleet.find((machine) => {
        const url = machine.device?.collectorUrl ?? "";
        return isLoopbackCollector(url) && !url.includes("/peer/");
      });
    if (local) {
      const identifier = machinePinIdentifier(local);
      if (identifier) return identifier;
    }
  }
  return machineKey;
}

/** Submit a marketplace agent task through the queen control plane. */
export async function submitMarketplaceQueenTask(input: {
  message: string;
  taskTitle: string;
  machineId?: string;
  /** Hard agent pin (the account's preferredAgentName) — routing never falls back to another agent. */
  agentId?: string;
  skills?: string[];
}): Promise<SubmittedMarketplaceTask> {
  const fleetSnapshot = await fetchFleetSnapshot();
  // The queen control plane fingerprints {message, source, mode} for intent
  // dedupe. Marketplace ops legitimately repeat with identical prompts (hourly
  // catalog syncs), so stamp each dispatch to keep fingerprints distinct —
  // otherwise a fresh sweep would "dedupe" onto a long-finished task.
  const stamped = `${input.message}\n\nDispatch stamp: ${new Date().toISOString()}`;
  const pinnedMachineId = input.machineId?.trim() ? resolvePinnedMachineKey(fleetSnapshot, input.machineId.trim()) : undefined;
  const result = await submitQueenBeeMessage({
    message: stamped,
    source: "marketplace",
    mode: "act",
    taskTitle: input.taskTitle,
    ...(pinnedMachineId ? { machineId: pinnedMachineId } : {}),
    ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
    ...(input.skills?.length ? { skills: input.skills } : {}),
    workspace: "scratch",
    fleetSnapshot,
  });
  return { taskId: result.task.id, created: result.created };
}

export type QueenTaskOutcome =
  | { status: "done"; result: string }
  | { status: "needs-human" | "archived" | "timeout"; result?: string };

/** Poll the Work Board until the task completes (or times out / escalates). */
export async function awaitQueenTaskResult(
  taskId: string,
  options?: { timeoutMs?: number; pollMs?: number },
): Promise<QueenTaskOutcome> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  const pollMs = options?.pollMs ?? POLL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const board = await readBoard(null, {});
    const task = board.tasks.find((candidate) => candidate.id === taskId);
    if (task) {
      if (task.status === "done") return { status: "done", result: task.result ?? "" };
      if (task.status === "needs-human" || task.status === "archived") {
        return { status: task.status, ...(task.result ? { result: task.result } : {}) };
      }
    }
    if (Date.now() >= deadline) return { status: "timeout" };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * A timed-out dispatch abandons its board task IF it is still "ready" (no
 * agent ever started it) — with the pending re-router retrying marketplace
 * tasks, a stale never-claimed mutation could otherwise fire long after its
 * caller gave up (double-post risk for create-listing). A task an agent is
 * actively working stays alive: archiving would not stop the session, and
 * research recovers late results. Returns true when the task was archived.
 */
export async function abandonUnclaimedQueenTask(taskId: string): Promise<boolean> {
  try {
    const board = await readBoard(null, {});
    const task = board.tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.status !== "ready") return false;
    await moveTask(null, taskId, "archived");
    return true;
  } catch {
    return false;
  }
}

/**
 * The MarketplaceAgentDispatch implementation handed to adapters: submit
 * pinned to the account's machine, await completion, parse the report.
 * A session that ends without a parseable MARKETPLACE_REPORT throws — callers
 * treat it as "the session told us nothing", never as an empty result.
 */
export const dispatchMarketplaceAgentTask: MarketplaceAgentDispatch = async (
  input: MarketplaceAgentTaskInput,
): Promise<MarketplaceAgentReport> => {
  const label = input.account.displayName ?? input.account.id;
  const submitted = await submitMarketplaceQueenTask({
    message: input.prompt,
    taskTitle: `Marketplace ${input.op}: ${label}`,
    machineId: input.account.machine.machineKey,
    ...(input.account.preferredAgentName ? { agentId: input.account.preferredAgentName } : {}),
  });
  const outcome = await awaitQueenTaskResult(submitted.taskId, {
    ...(input.maxRuntimeMs ? { timeoutMs: input.maxRuntimeMs } : {}),
  });
  if (outcome.status !== "done") {
    if (outcome.status === "timeout") {
      const abandoned = await abandonUnclaimedQueenTask(submitted.taskId);
      throw new Error(
        abandoned
          ? `Marketplace ${input.op} task was never picked up in time (task ${submitted.taskId} archived; the next sweep retries).`
          : `Marketplace ${input.op} session timed out (task ${submitted.taskId}).`,
      );
    }
    throw new Error(`Marketplace ${input.op} session ended ${outcome.status} (task ${submitted.taskId}).`);
  }
  const report = parseMarketplaceAgentReport(outcome.result);
  if (!report) {
    throw new Error(`Marketplace ${input.op} session returned no parseable MARKETPLACE_REPORT (task ${submitted.taskId}).`);
  }
  return report;
};
