import "server-only";

import { markCompanyDispatched, readCompanies } from "@/lib/services/companies-store";
import { countDispatchableMembers, dispatchCompanyGoal, scopeFleetToMembers } from "@/lib/services/companies-orchestration";
import type { QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";
import { readBoard, reclaimStaleTasks } from "@/lib/services/kanban/local-kanban-store";

/**
 * Perpetual company autonomy driver. A single boot-time background loop (one per
 * server process, like the Telegram tip bot) that keeps autonomous companies
 * working toward their apex goal "forever, until stopped". Each tick it:
 *   1. reclaims stale Work Board tasks (recovers timed-out / offline pickups),
 *   2. for every company with autonomy ON, not frozen, with a goal + crew:
 *      re-dispatches the apex goal ONLY when the crew has gone idle (no ready/
 *      working member tasks) and there's at least one dispatchable member online,
 *      throttled by a minimum re-dispatch interval.
 *
 * Safety: spend is bounded by the company's daily/monthly/total budgets and the
 * frozen kill switch (enforced in spend-governance on every rail). The driver is
 * a no-op for any company that hasn't been explicitly launched (autonomy=false),
 * and skips frozen companies. Disable globally with HIVEMINDOS_COMPANY_AUTONOMY_DRIVER=0.
 */

export type CompanyAutonomyDriverStatus = {
  status: "running" | "stopped";
  startedAt?: string;
  tickCount?: number;
  lastTickAt?: string;
  lastError?: string;
};

type Runner = CompanyAutonomyDriverStatus & { stopRequested: boolean; stopped: Promise<void> };

const globalState = globalThis as typeof globalThis & { __hivemindCompanyAutonomyDriver?: Runner };

function envNum(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const tickIntervalMs = () => envNum("HIVEMINDOS_COMPANY_DRIVER_TICK_MS", 300_000); // 5 min
const minRedispatchMs = () => envNum("HIVEMINDOS_COMPANY_DRIVER_MIN_REDISPATCH_MS", 1_800_000); // 30 min

export function companyAutonomyDriverDisabled(): boolean {
  return (process.env.HIVEMINDOS_COMPANY_AUTONOMY_DRIVER || "").trim() === "0";
}

function sleepUnlessStopped(runner: Runner, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const interval = setInterval(() => {
      if (runner.stopRequested || Date.now() - started >= ms) {
        clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

/** Pull a live fleet snapshot by self-fetching our own discovery route (no auth). */
async function fetchFleetSnapshot(): Promise<QueenBeeFleetMachine[]> {
  const port = process.env.PORT?.trim();
  if (!port) return [];
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fleet/discover?stale=1&includeSnapshots=0`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as { machines?: QueenBeeFleetMachine[] };
    return Array.isArray(json?.machines) ? json.machines : [];
  } catch {
    return [];
  }
}

/** Identifiers (id + name) of a company's member agents, for matching board assignees. */
function memberIdentities(scoped: QueenBeeFleetMachine[]): Set<string> {
  const ids = new Set<string>();
  for (const machine of scoped) {
    for (const agent of machine.agents ?? []) {
      if (agent.id) ids.add(agent.id);
      if (agent.agentId) ids.add(agent.agentId);
      if (agent.name) ids.add(agent.name);
    }
  }
  return ids;
}

async function tickOnce(): Promise<void> {
  const companies = await readCompanies();
  const eligible = companies.filter(
    (c) => c.autonomy && !c.frozen && Boolean(c.apexGoal?.title?.trim()) && (c.agentIds?.length ?? 0) > 0,
  );
  if (eligible.length === 0) return;

  // Recover tasks whose pickup timed out / agent went offline so they re-enter
  // "ready". Let failures bubble to the loop's try/catch (surfaced in lastError)
  // and skip this tick's dispatch rather than acting on a broken board.
  await reclaimStaleTasks(null, {}, {});

  const fleet = await fetchFleetSnapshot();
  // If the board can't be read we can't tell whether the crew is idle — a throw
  // bubbles to the loop and we skip this tick rather than re-dispatch blind.
  const board = await readBoard(null, {});
  const tasks = board.tasks ?? [];
  const now = Date.now();

  for (const company of eligible) {
    try {
      const scoped = scopeFleetToMembers(fleet, company.agentIds);
      // No member online + chat-capable → nobody to do the work; don't pile up queued tasks.
      if (countDispatchableMembers(scoped) === 0) continue;
      // Crew already has live work (incl. queued "queen-bee" tasks awaiting an
      // agent) → let it finish before re-dispatching. Counting "queen-bee" here is
      // defense-in-depth against ever re-dispatching on top of pending work.
      const idents = memberIdentities(scoped);
      const hasActiveWork = tasks.some(
        (t) =>
          (t.status === "ready" || t.status === "working") &&
          t.assignee != null &&
          (idents.has(t.assignee) || t.assignee === "queen-bee"),
      );
      if (hasActiveWork) continue;
      // Throttle: don't re-dispatch the same company more often than the min interval.
      if (now - (company.lastDispatchedAt ?? 0) < minRedispatchMs()) continue;

      // Stamp BEFORE dispatching so the throttle still applies if the dispatch
      // throws — prevents a tight retry loop on a persistently failing company.
      await markCompanyDispatched(company.id, Date.now());
      const port = process.env.PORT?.trim();
      await dispatchCompanyGoal(company, fleet, { origin: port ? `http://127.0.0.1:${port}` : undefined });
    } catch (error) {
      // One company's failure must never stop the loop.
      console.error(
        `[company-autonomy-driver] re-dispatch failed for ${company.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

async function loop(runner: Runner): Promise<void> {
  while (!runner.stopRequested) {
    try {
      await tickOnce();
      runner.tickCount = (runner.tickCount ?? 0) + 1;
      runner.lastTickAt = new Date().toISOString();
      runner.lastError = undefined;
    } catch (error) {
      runner.lastError = error instanceof Error ? error.message : String(error);
    }
    if (runner.stopRequested) break;
    await sleepUnlessStopped(runner, tickIntervalMs());
  }
}

export async function startCompanyAutonomyDriver(): Promise<CompanyAutonomyDriverStatus> {
  if (companyAutonomyDriverDisabled()) {
    return { status: "stopped", lastError: "Disabled via HIVEMINDOS_COMPANY_AUTONOMY_DRIVER=0" };
  }
  const existing = globalState.__hivemindCompanyAutonomyDriver;
  if (existing?.status === "running") return getCompanyAutonomyDriverStatus();

  const runner: Runner = {
    status: "running",
    startedAt: new Date().toISOString(),
    tickCount: 0,
    stopRequested: false,
    stopped: Promise.resolve(),
  };
  runner.stopped = loop(runner)
    .then(() => {
      runner.status = "stopped";
    })
    .catch((error) => {
      runner.status = "stopped";
      runner.lastError = error instanceof Error ? error.message : String(error);
    });
  globalState.__hivemindCompanyAutonomyDriver = runner;
  return getCompanyAutonomyDriverStatus();
}

export async function stopCompanyAutonomyDriver(): Promise<CompanyAutonomyDriverStatus> {
  const runner = globalState.__hivemindCompanyAutonomyDriver;
  if (runner && runner.status === "running") {
    runner.stopRequested = true;
    await runner.stopped;
  }
  return getCompanyAutonomyDriverStatus();
}

export function getCompanyAutonomyDriverStatus(): CompanyAutonomyDriverStatus {
  const runner = globalState.__hivemindCompanyAutonomyDriver;
  if (!runner) return { status: "stopped" };
  return {
    status: runner.status,
    startedAt: runner.startedAt,
    tickCount: runner.tickCount,
    lastTickAt: runner.lastTickAt,
    lastError: runner.lastError,
  };
}

/** Idempotently ensure the driver is running (called when a company is launched). */
export function ensureCompanyAutonomyDriver(): void {
  if (companyAutonomyDriverDisabled()) return;
  if (globalState.__hivemindCompanyAutonomyDriver?.status === "running") return;
  void startCompanyAutonomyDriver().catch((error) =>
    console.error("[company-autonomy-driver] ensure failed:", error instanceof Error ? error.message : error),
  );
}
