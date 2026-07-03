import "server-only";

import {
  acquireOrRenewCompanyDriverLease,
  companyDriverLeaseDisabled,
  releaseCompanyDriverLease,
} from "@/lib/services/company-driver-lease";
import { markCompanyDispatched, parseMetricNumber, readCompanies } from "@/lib/services/companies-store";
import { countDispatchableMembers, dispatchCompanyGoal, scopeFleetToMembers } from "@/lib/services/companies-orchestration";
import type { QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";
import { redispatchReadyQueenBeeTasks, routePendingQueenBeeTasks } from "@/lib/services/queen-bee/control-plane";
import { readBoard, reclaimStaleTasks } from "@/lib/services/kanban/local-kanban-store";
import { notifyEscalation, runEscalationSweep } from "@/lib/services/messaging/escalation-notify";
import { syncCompanyTaskOutcomes } from "@/lib/services/company-memory";

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
  /**
   * Machine-wide lease election (see company-driver-lease.ts). Every server
   * process runs a driver loop, but only the lease holder ticks — standby
   * instances poll the lease and take over when the holder stops/dies.
   * Absent while the first loop iteration hasn't run or the lease is disabled.
   */
  lease?: { held: boolean; holderPid?: number; holderPort?: string };
};

type Runner = CompanyAutonomyDriverStatus & { stopRequested: boolean; stopped: Promise<void> };

const globalState = globalThis as typeof globalThis & { __hivemindCompanyAutonomyDriver?: Runner };

function envNum(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const tickIntervalMs = () => envNum("HIVEMINDOS_COMPANY_DRIVER_TICK_MS", 300_000); // 5 min
const minRedispatchMs = () => envNum("HIVEMINDOS_COMPANY_DRIVER_MIN_REDISPATCH_MS", 1_800_000); // 30 min
// Window over which a recently-completed company task still counts as "recent"
// for dedup — a fresh plan shouldn't re-propose work finished within a day.
const dedupWindowMs = () => envNum("HIVEMINDOS_COMPANY_DEDUP_WINDOW_MS", 86_400_000); // 24h
// When the last batch drained WITHOUT completing anything, the company is stuck —
// re-planning immediately just burns tokens, so widen the interval by this factor.
const noProgressBackoff = () => envNum("HIVEMINDOS_COMPANY_DRIVER_NOPROGRESS_BACKOFF", 4);
// Completed-task count past which a company at zero apex progress is flagged
// "busy but blocked" (an outward action is almost certainly gated).
const stalledMinDone = () => envNum("HIVEMINDOS_COMPANY_STALL_MIN_DONE", 8);
// Standby instances (lease held elsewhere) re-check the lease this often — a
// tiny file read — so a killed holder is replaced within about a minute.
const standbyPollMs = () => envNum("HIVEMINDOS_COMPANY_DRIVER_STANDBY_POLL_MS", 60_000);

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
  // Board recovery runs EVERY tick, independent of whether any company is launched: reclaim
  // tasks whose pickup timed out / agent went offline (back to "ready"), then re-dispatch any
  // autonomous task left stranded "ready" (e.g. a server restart killed its in-process pickup).
  // This is what makes autonomous loops survive a crash/restart instead of stalling forever.
  await reclaimStaleTasks(null, {}, {});
  const redispatched = await redispatchReadyQueenBeeTasks({});
  if (redispatched > 0) console.log(`[company-autonomy-driver] re-dispatched ${redispatched} stranded ready task(s)`);

  // One fleet snapshot per tick, shared by pending-task routing and company
  // re-dispatch. Routing pending ("queen-bee"-assigned) tasks runs regardless of
  // company eligibility: a task queued while its agent was offline must get
  // delegated once the agent returns, or it waits forever.
  const fleet = await fetchFleetSnapshot();
  const routedPending = await routePendingQueenBeeTasks(fleet, {});
  if (routedPending > 0) console.log(`[company-autonomy-driver] routed ${routedPending} pending task(s) to online agents`);

  const companies = await readCompanies();
  const eligible = companies.filter(
    (c) => c.autonomy && !c.frozen && Boolean(c.apexGoal?.title?.trim()) && (c.agentIds?.length ?? 0) > 0,
  );
  // Fold finished company-sourced tasks into each company's durable memory ledger
  // BEFORE re-dispatch, so a re-plan triggered this tick already sees the outcomes.
  // Covers every company (even autonomy off) — memory accrues whenever work finishes.
  try {
    const board = await readBoard(null, {});
    const recorded = await syncCompanyTaskOutcomes(companies, board.tasks ?? []);
    if (recorded > 0) console.log(`[company-autonomy-driver] recorded ${recorded} task outcome(s) into company memory`);
  } catch (error) {
    console.warn("[company-autonomy-driver] memory sync failed:", error instanceof Error ? error.message : error);
  }

  let companyPassError: unknown = null;
  if (eligible.length > 0) {
    try {
      await redispatchEligibleCompanies(eligible, fleet);
    } catch (error) {
      companyPassError = error; // rethrown below so the runner records lastError
    }
  }

  // Escalation sweep runs EVERY tick (blocked tasks and approvals exist even with
  // no launched company) and LAST so it sees this tick's board/approval state.
  // It's what reaches the user headless — no dashboard open.
  await runEscalationSweep({}).catch((error) =>
    console.warn("[company-autonomy-driver] escalation sweep failed:", error instanceof Error ? error.message : error),
  );
  if (companyPassError) throw companyPassError;
}

/**
 * Pure predicate: does this company still have live work? Counts tasks delegated
 * to its members (any source) plus ITS OWN pending ("queen-bee"-assigned) tasks
 * awaiting routing. Another source's pending task must never freeze this company
 * — that wildcard once deadlocked every company on one stuck task.
 */
export function companyHasActiveWork(
  tasks: Array<Pick<import("@/lib/types/kanban").KanbanTask, "status" | "assignee" | "source">>,
  memberIdents: Set<string>,
  companyId: string,
): boolean {
  const companyPrefix = `company:${companyId}:`;
  return tasks.some((t) => {
    if (t.status !== "ready" && t.status !== "working") return false;
    const assignee = t.assignee ?? "";
    if (assignee && memberIdents.has(assignee)) return true;
    return assignee === "queen-bee" && (t.source ?? "").startsWith(companyPrefix);
  });
}

async function redispatchEligibleCompanies(eligible: Awaited<ReturnType<typeof readCompanies>>, fleet: QueenBeeFleetMachine[]): Promise<void> {
  // If the board can't be read we can't tell whether the crew is idle — a throw
  // bubbles to the loop and we skip this pass rather than re-dispatch blind.
  const board = await readBoard(null, {});
  const tasks = board.tasks ?? [];
  const now = Date.now();

  // "Busy but blocked" detector — runs for every eligible company each tick,
  // independent of re-dispatch. A company completing lots of work while its apex
  // metric sits at zero is almost always blocked on an outward action (paused
  // sends for compliance, no payment rail). Surface it — the crew can't move the
  // number on its own. notifyEscalation de-dupes on the key (12h TTL).
  for (const company of eligible) {
    const companyPrefix = `company:${company.id}:`;
    const doneCount = tasks.filter((t) => (t.source ?? "").startsWith(companyPrefix) && t.status === "done").length;
    if (doneCount < stalledMinDone()) continue;
    const target = parseMetricNumber(company.apexGoal?.target);
    if (!(target && target > 0)) continue;
    if ((parseMetricNumber(company.apexGoal?.current) ?? 0) > 0) continue;
    await notifyEscalation({
      key: `company-progress-stalled:${company.id}`,
      title: `${company.name}: producing work but the goal isn't moving`,
      body: `The crew has completed ${doneCount} tasks, but ${company.apexGoal?.metric ?? "the apex metric"} is still ${company.apexGoal?.current ?? "0"} of ${company.apexGoal?.target}. This almost always means an outward action is blocked — real sends paused for compliance, or no payment rail yet. Clear the blocker; the crew can't move the number on its own.`,
      severity: "high",
      ttlMs: 12 * 60 * 60 * 1_000,
      tags: ["company", "progress"],
    }).catch(() => undefined);
  }

  for (const company of eligible) {
    try {
      const companyPrefix = `company:${company.id}:`;
      const scoped = scopeFleetToMembers(fleet, company.agentIds);
      // No member online + chat-capable → nobody to do the work; don't pile up queued tasks.
      if (countDispatchableMembers(scoped) === 0) continue;
      // Crew already has live work → let it finish before re-dispatching.
      const idents = memberIdentities(scoped);
      if (companyHasActiveWork(tasks, idents, company.id)) continue;

      // Progress-gated cadence: if the LAST batch drained without completing any
      // work, the company is stuck — re-planning the same goal immediately just
      // burns tokens, so back off to a longer interval until something completes.
      const sinceDispatch = company.lastDispatchedAt ?? 0;
      const completedSince = tasks.filter(
        (t) => (t.source ?? "").startsWith(companyPrefix) && t.status === "done" && (t.completedAt ?? t.updatedAt ?? 0) > sinceDispatch,
      ).length;
      const noProgress = sinceDispatch > 0 && completedSince === 0;
      const interval = noProgress ? minRedispatchMs() * noProgressBackoff() : minRedispatchMs();
      if (now - sinceDispatch < interval) continue;

      // Titles of this company's recent + in-flight tasks, so the planner's fresh
      // batch can be deduped against work already done or under way.
      const recentCompanyTaskTitles = tasks
        .filter((t) => {
          if (!(t.source ?? "").startsWith(companyPrefix)) return false;
          const terminal = t.status === "done" || t.status === "archived";
          if (!terminal) return true; // still open / in flight
          return (t.completedAt ?? t.updatedAt ?? 0) > now - dedupWindowMs(); // recently finished
        })
        .map((t) => t.title)
        .filter((t): t is string => Boolean(t));

      // Stamp BEFORE dispatching so the throttle still applies if the dispatch
      // throws — prevents a tight retry loop on a persistently failing company.
      await markCompanyDispatched(company.id, Date.now());
      const port = process.env.PORT?.trim();
      const result = await dispatchCompanyGoal(company, fleet, {
        origin: port ? `http://127.0.0.1:${port}` : undefined,
        recentCompanyTaskTitles,
      });
      if (result.taskCount === 0) {
        console.log(`[company-autonomy-driver] ${company.id}: nothing new to dispatch — all ${result.deduped ?? 0} planned task(s) already recent or in flight`);
      } else if (result.deduped) {
        console.log(`[company-autonomy-driver] ${company.id}: dispatched ${result.taskCount} new task(s), skipped ${result.deduped} redundant`);
      }
    } catch (error) {
      // One company's failure must never stop the loop — but the operator should
      // hear about a company that keeps failing to dispatch (6h re-notify TTL).
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[company-autonomy-driver] re-dispatch failed for ${company.id}:`, message);
      await notifyEscalation({
        key: `company-dispatch-failed:${company.id}`,
        title: `${company.name}: autonomous dispatch failing`,
        body: `The autonomy driver could not dispatch new work toward "${company.apexGoal?.title ?? company.name}".\nError: ${message}\nIt retries every ${Math.round(minRedispatchMs() / 60_000)} minutes.`,
        severity: "high",
        ttlMs: 6 * 60 * 60 * 1_000,
        tags: ["company", "dispatch"],
      }).catch(() => undefined);
    }
  }
}

async function loop(runner: Runner): Promise<void> {
  while (!runner.stopRequested) {
    // Lease election: several server processes run this loop concurrently on a
    // dev machine (every Next server auto-starts the driver), but only the
    // lease holder may tick — otherwise each instance re-scans the fleet and
    // can re-dispatch real agent work against the same shared board.
    let ticking = true;
    if (!companyDriverLeaseDisabled()) {
      const wasStandby = runner.lease?.held === false;
      const lease = await acquireOrRenewCompanyDriverLease();
      ticking = lease.held;
      runner.lease = {
        held: lease.held,
        holderPid: lease.holder?.pid,
        holderPort: lease.holder?.port || undefined,
      };
      if (!lease.held && !wasStandby) {
        console.log(
          `[company-autonomy-driver] standby — active driver is pid ${lease.holder?.pid ?? "?"}${lease.holder?.port ? ` (port ${lease.holder.port})` : ""}`,
        );
      } else if (lease.held && wasStandby) {
        console.log("[company-autonomy-driver] lease acquired — this instance is now the active driver");
      }
    } else {
      runner.lease = undefined;
    }
    if (runner.stopRequested) break;
    if (ticking) {
      try {
        await tickOnce();
        runner.tickCount = (runner.tickCount ?? 0) + 1;
        runner.lastTickAt = new Date().toISOString();
        runner.lastError = undefined;
      } catch (error) {
        runner.lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (runner.stopRequested) break;
    await sleepUnlessStopped(runner, ticking ? tickIntervalMs() : standbyPollMs());
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
    // Hand the lease to a standby instance immediately instead of making it
    // wait out staleness/pid-death detection. No-op if we never held it.
    await releaseCompanyDriverLease().catch(() => undefined);
    runner.lease = undefined;
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
    lease: runner.lease,
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
