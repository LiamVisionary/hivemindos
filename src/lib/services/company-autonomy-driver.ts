import "server-only";

import {
  acquireOrRenewCompanyDriverLease,
  companyDriverLeaseDisabled,
  releaseCompanyDriverLease,
} from "@/lib/services/company-driver-lease";
import { companyRunsOnThisMachine, markCompanyDispatched, parseMetricNumber, readCompanies } from "@/lib/services/companies-store";
import { countDispatchableMembers, dispatchCompanyGoal, scopeFleetToMembers } from "@/lib/services/companies-orchestration";
import type { QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";
import { redispatchReadyQueenBeeTasks, routePendingQueenBeeTasks } from "@/lib/services/queen-bee/control-plane";
import { rescueInfraStrandedTasks } from "@/lib/services/queen-bee/infra-rescue";
import { readBoard, reclaimStaleTasks } from "@/lib/services/kanban/local-kanban-store";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import { notifyEscalation, resolveEscalationNotification, runEscalationSweep } from "@/lib/services/messaging/escalation-notify";
import { syncCompanyTaskOutcomes } from "@/lib/services/company-memory";
import { companyExecutionCapability } from "@/lib/services/company-execution-capabilities";
import { inspectCompanyAeonActivity } from "@/lib/services/company-aeon-binding";

/**
 * Perpetual company autonomy driver. A single boot-time background loop (one per
 * server process, like the Telegram tip bot) that keeps autonomous companies
 * working toward their apex goal "forever, until stopped". Each tick it:
 *   1. reclaims stale Work Board tasks (recovers timed-out / offline pickups),
 *   2. for every company with autonomy ON, not frozen, and with a goal:
 *      asks the selected engine whether its work surface is idle, then re-dispatches
 *      on the engine's cadence. Native crews use Work Board + online-member state;
 *      AEON uses the selected workspace's run state and needs no native crew.
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

const globalState = globalThis as typeof globalThis & {
  __hivemindCompanyAutonomyDriver?: Runner;
  __hivemindCompanyDriverSelfPort?: string;
  __hivemindCompanyDriverSelfBase?: string;
};

/**
 * The server doesn't always expose its own listen port as process.env.PORT
 * (the Tauri-spawned dev server doesn't) — and without it the driver both
 * skipped boot autostart and self-fetched an EMPTY fleet snapshot, so it never
 * dispatched anything while looking "running". Any request that reaches the
 * driver/companies routes records its own port here as a fallback.
 * globalThis-backed so dev HMR module reloads don't lose it.
 */
export function rememberCompanyDriverSelfPort(port: string | number | null | undefined): void {
  const value = String(port ?? "").trim();
  if (value && /^\d+$/.test(value)) globalState.__hivemindCompanyDriverSelfPort = value;
}

export function resolveCompanyDriverSelfPort(): string {
  return process.env.PORT?.trim() || globalState.__hivemindCompanyDriverSelfPort || "";
}

/**
 * Port alone isn't enough: this server may listen on ONE loopback family only
 * (the Tauri-spawned dev server binds [::1] exclusively — a self-fetch to
 * 127.0.0.1 on the right port still ECONNREFUSED, so every tick saw an empty
 * fleet and dispatched nothing). Remember the full host:port a real request
 * arrived on (works through the Tauri :5021 proxy too), and try both loopback
 * families as fallbacks.
 */
export function rememberCompanyDriverSelfBase(hostHeader: string | null | undefined): void {
  const value = (hostHeader ?? "").trim();
  // Loopback shapes only ("127.0.0.1:5021", "localhost:5020", "[::1]:5122") —
  // never remember an outward host as our self-fetch base.
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(value)) return;
  globalState.__hivemindCompanyDriverSelfBase = `http://${value}`;
  rememberCompanyDriverSelfPort(value.match(/:(\d+)$/)?.[1]);
}

/** Ordered self-fetch candidates: last-known-good base first, then both loopback families. */
export function resolveCompanyDriverSelfBases(): string[] {
  const bases: string[] = [];
  if (globalState.__hivemindCompanyDriverSelfBase) bases.push(globalState.__hivemindCompanyDriverSelfBase);
  const port = resolveCompanyDriverSelfPort();
  if (port) {
    for (const host of ["127.0.0.1", "[::1]"]) {
      const base = `http://${host}:${port}`;
      if (!bases.includes(base)) bases.push(base);
    }
  }
  return bases;
}

/** Foreign-homed companies already logged this process — one line each, not one per tick. */
const loggedForeignCompanies = new Set<string>();

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
// Revenue-nudge cadence: at most one low-priority "goal hasn't moved" note per
// company per WEEK (a young company at $0 is expected, not a defect). Grace: no
// nudge until the company has had a fair run. Set the interval to 0 or
// HIVEMINDOS_COMPANY_REVENUE_NUDGE=0 to silence it entirely.
const revenueNudgeTtlMs = () => envNum("HIVEMINDOS_COMPANY_REVENUE_NUDGE_TTL_MS", 7 * 86_400_000); // weekly
const revenueNudgeMinAgeMs = () => envNum("HIVEMINDOS_COMPANY_REVENUE_NUDGE_MIN_AGE_MS", 7 * 86_400_000); // 7-day grace
// Auto-pause "you have N approvals waiting" re-notify cadence — a paused company
// is otherwise silent, so remind at most this often (deduped by company key).
const autonomyPauseNudgeTtlMs = () => envNum("HIVEMINDOS_COMPANY_PAUSE_NUDGE_TTL_MS", 6 * 3_600_000); // 6h
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
  const bases = resolveCompanyDriverSelfBases();
  if (!bases.length) {
    console.warn(
      "[company-autonomy-driver] cannot resolve this server's own address (no PORT env, no driver/companies route hit yet) — fleet snapshot unavailable, company dispatch skipped this tick",
    );
    return [];
  }
  for (const base of bases) {
    try {
      // Self-fetches 401 without a credential since the API auth gate moved to
      // src/proxy.ts — ride the server's own device token (empty when auth is
      // in setup mode). Without this the driver silently saw an empty fleet.
      const res = await fetch(`${base}/api/fleet/discover?stale=1&includeSnapshots=0`, {
        cache: "no-store",
        headers: internalApiAuthHeaders(),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const json = (await res.json().catch(() => ({}))) as { machines?: QueenBeeFleetMachine[] };
      if (!Array.isArray(json?.machines)) continue;
      globalState.__hivemindCompanyDriverSelfBase = base; // remember the door that worked
      return json.machines;
    } catch {
      // wrong loopback family / proxy down — try the next candidate
    }
  }
  return [];
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

// A driver that ticks with an empty fleet snapshot dispatches nothing while
// looking healthy. Track consecutive empty snapshots and escalate — this is the
// silent failure mode that stalled companies for hours (notifyEscalation
// de-dupes on the key, so repeat calls past the threshold are cheap).
let emptyFleetTicks = 0;
let emptyFleetEscalated = false;
async function trackFleetVisibility(machineCount: number, nativeCompanyCount: number): Promise<void> {
  if (nativeCompanyCount === 0) {
    if (emptyFleetEscalated) {
      await resolveEscalationNotification("company-driver-empty-fleet", {
        status: "resolved",
        note: "No launched native-crew company currently depends on fleet visibility. AEON-backed companies continue through their selected workspaces.",
      }).catch(() => undefined);
    }
    emptyFleetTicks = 0;
    emptyFleetEscalated = false;
    return;
  }
  if (machineCount > 0) {
    // Announce recovery once so the earlier alert doesn't read as still-live —
    // an unresolved-looking "can't see the fleet" cost real diagnosis time on
    // 2026-07-03 after the underlying cause was already fixed.
    if (emptyFleetEscalated) {
      emptyFleetEscalated = false;
      // Resolve the original alarm card in place AND announce recovery — the
      // resolved badge keeps the old card honest, the notice pings the feed.
      await resolveEscalationNotification("company-driver-empty-fleet", {
        status: "resolved",
        note: `Fleet snapshot recovered (${machineCount} machine${machineCount === 1 ? "" : "s"}) — native company dispatch resumed.`,
      }).catch(() => undefined);
      await notifyEscalation({
        key: `company-driver-empty-fleet-recovered:${Date.now()}`,
        title: "Company autonomy driver can see the fleet again",
        body: `The driver's fleet snapshot is back (${machineCount} machine${machineCount === 1 ? "" : "s"}) after ${emptyFleetTicks} empty ticks — native company dispatch has resumed. The earlier "can't see the fleet" alert is resolved.`,
        severity: "high",
        ttlMs: 0,
        tags: ["company", "driver", "recovered"],
      }).catch(() => undefined);
    }
    emptyFleetTicks = 0;
    return;
  }
  emptyFleetTicks += 1;
  if (emptyFleetTicks < 6) return; // ~30 min at the default 5-min tick
  emptyFleetEscalated = true;
  await notifyEscalation({
    key: "company-driver-empty-fleet",
    title: "Company autonomy driver can't see the fleet",
    body: `The driver's self-fetched fleet snapshot has been empty for ${emptyFleetTicks} consecutive ticks, so ${nativeCompanyCount} native-crew compan${nativeCompanyCount === 1 ? "y" : "ies"} cannot dispatch work. AEON-backed companies continue through their selected workspaces. Usual causes: the server's own port is unresolvable (no PORT env and no dashboard/watchdog request yet), the self-fetch is unauthenticated against the API auth gate, or /api/fleet/discover is failing.`,
    severity: "high",
    ttlMs: 6 * 60 * 60 * 1_000,
    tags: ["company", "driver"],
  }).catch(() => undefined);
}

async function tickOnce(): Promise<void> {
  // Board recovery runs EVERY tick, independent of whether any company is launched: reclaim
  // tasks whose pickup timed out / agent went offline (back to "ready"), then re-dispatch any
  // autonomous task left stranded "ready" (e.g. a server restart killed its in-process pickup).
  // This is what makes autonomous loops survive a crash/restart instead of stalling forever.
  await reclaimStaleTasks(null, {}, {}).catch((error) =>
    console.warn("[company-autonomy-driver] stale Work Board task recovery failed:", error instanceof Error ? error.message : error),
  );
  // Rescue infrastructure-stranded needs-human tasks BEFORE the ready re-dispatch,
  // so a task whose collector just came back is re-queued and re-dispatched in the
  // SAME tick instead of waiting a human click (zero-human boards have no hand-move).
  try {
    const rescue = await rescueInfraStrandedTasks();
    if (rescue.rescued.length > 0) {
      console.log(`[company-autonomy-driver] infra-rescue re-queued ${rescue.rescued.length} stranded task(s): ${rescue.rescued.map((r) => r.taskId).join(", ")}`);
    }
  } catch (error) {
    console.warn("[company-autonomy-driver] infra-rescue sweep failed:", error instanceof Error ? error.message : error);
  }
  const redispatched = await redispatchReadyQueenBeeTasks({}).catch((error) => {
    console.warn("[company-autonomy-driver] ready-task re-dispatch failed:", error instanceof Error ? error.message : error);
    return 0;
  });
  if (redispatched > 0) console.log(`[company-autonomy-driver] re-dispatched ${redispatched} stranded ready task(s)`);

  const companies = await readCompanies();
  const launched = companies.filter((company) => {
    const autonomy = companyExecutionCapability(company.execution).autonomy;
    return Boolean(
      company.autonomy
      && !company.frozen
      && company.apexGoal?.title?.trim()
      && (!autonomy.requiresCompanyCrew || (company.agentIds?.length ?? 0) > 0),
    );
  });
  // Company definitions replicate fleet-wide through the shared vault, so only
  // locally homed companies participate in this machine's dispatch/health state.
  const eligible = launched.filter((company) => companyRunsOnThisMachine(company));
  const nativeCompanyCount = eligible.filter(
    (company) => companyExecutionCapability(company.execution).autonomy.requiresOnlineCrew,
  ).length;

  // One fleet snapshot per tick, shared by pending-task routing and company
  // re-dispatch. Routing pending ("queen-bee"-assigned) tasks runs regardless of
  // company eligibility: a task queued while its agent was offline must get
  // delegated once the agent returns, or it waits forever.
  const fleet = await fetchFleetSnapshot().catch((error) => {
    console.warn("[company-autonomy-driver] fleet snapshot unavailable; native companies will wait for a later pass:", error instanceof Error ? error.message : error);
    return [];
  });
  await trackFleetVisibility(fleet.length, nativeCompanyCount);
  const routedPending = await routePendingQueenBeeTasks(fleet, {}).catch((error) => {
    console.warn("[company-autonomy-driver] pending-task routing failed:", error instanceof Error ? error.message : error);
    return 0;
  });
  if (routedPending > 0) console.log(`[company-autonomy-driver] routed ${routedPending} pending task(s) to online agents`);

  for (const foreign of launched) {
    if (eligible.includes(foreign) || loggedForeignCompanies.has(foreign.id)) continue;
    loggedForeignCompanies.add(foreign.id);
    console.log(
      `[company-autonomy-driver] ${foreign.name} (${foreign.id}) is homed on "${foreign.homeMachineKey ?? "unclaimed"}" — this machine will not auto-dispatch it`,
    );
  }
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

/** Sticky-hold guards are on unless HIVEMINDOS_APPROVAL_HOLD=0. */
const approvalHoldEnabled = () => process.env.HIVEMINDOS_APPROVAL_HOLD !== "0";

/**
 * Count this company's items currently "waiting on a human" — tasks it owns that
 * sit in the needs-human lane — honoring the pause config's count mode. "all"
 * (the default) counts every such task; "deliverable-kinds" counts only those
 * carrying a deliverable of a configured kind (e.g. just website approvals). An
 * absent/empty kind list falls back to counting all: a mode must never silently
 * count zero and defeat the backpressure it exists to apply.
 *
 * Held ("parked") tasks are EXCLUDED: the operator has already seen and deferred
 * them, so they must not count toward the pause threshold — otherwise a deferred
 * pile would wedge the company at paused forever, unable to drop back under the
 * threshold. Kill switch HIVEMINDOS_APPROVAL_HOLD=0 restores counting held items.
 */
export function countCompanyWaitingOnHuman(
  tasks: Array<Pick<import("@/lib/types/kanban").KanbanTask, "status" | "source" | "deliverables" | "held">>,
  companyId: string,
  pause?: import("@/lib/types/company").CompanyAutonomyPause,
): number {
  const companyPrefix = `company:${companyId}:`;
  const holdOn = approvalHoldEnabled();
  const kinds =
    pause?.countMode === "deliverable-kinds" && (pause.deliverableKinds?.length ?? 0) > 0
      ? new Set(pause.deliverableKinds)
      : null;
  return tasks.filter((t) => {
    if (t.status !== "needs-human") return false;
    if (holdOn && t.held) return false;
    if (!(t.source ?? "").startsWith(companyPrefix)) return false;
    if (!kinds) return true;
    return (t.deliverables ?? []).some((d) => kinds.has(d.kind));
  }).length;
}

async function redispatchEligibleCompanies(eligible: Awaited<ReturnType<typeof readCompanies>>, fleet: QueenBeeFleetMachine[]): Promise<void> {
  // Native crews fail closed when the Work Board cannot be read. AEON companies
  // remain independent of that surface and use their workspace run state below.
  const board = await readBoard(null, {}).catch((error) => {
    console.warn("[company-autonomy-driver] Work Board unavailable; native companies will skip this pass:", error instanceof Error ? error.message : error);
    return null;
  });
  const tasks = board?.tasks ?? [];
  const now = Date.now();

  // Weekly revenue check — a low-priority, in-app-only FYI, NOT a blocking alarm.
  // A company sitting at $0 apex is EXPECTED early on: conversions lag outreach by
  // weeks, so treating it as "work is blocked on you" every 12h is noise. This
  // fires at most once a week, only after a grace period, at low severity, framed
  // as "here's why the number hasn't moved" rather than "fix this now". It also
  // never pings external channels (isExternallyDeliverable gates that). Silence
  // entirely with HIVEMINDOS_COMPANY_REVENUE_NUDGE=0.
  if (process.env.HIVEMINDOS_COMPANY_REVENUE_NUDGE !== "0" && revenueNudgeTtlMs() > 0) {
    for (const company of eligible) {
      const companyPrefix = `company:${company.id}:`;
      const doneCount = tasks.filter((t) => (t.source ?? "").startsWith(companyPrefix) && t.status === "done").length;
      if (doneCount < stalledMinDone()) continue;
      const target = parseMetricNumber(company.apexGoal?.target);
      if (!(target && target > 0)) continue;
      if ((parseMetricNumber(company.apexGoal?.current) ?? 0) > 0) continue;
      // Grace: a company that hasn't had a fair run yet gets no revenue nudge —
      // $0 in week one is not something to flag.
      if (now - (company.createdAtMs ?? now) < revenueNudgeMinAgeMs()) continue;
      const metric = company.apexGoal?.metric ?? "the apex metric";
      const current = company.apexGoal?.current ?? "0";
      await notifyEscalation({
        key: `company-progress-stalled:${company.id}`,
        title: `${company.name}: weekly revenue check — ${metric} still at ${current}`,
        body: `Weekly status: the crew has shipped ${doneCount} tasks, but ${metric} is still ${current} of ${company.apexGoal?.target}. That's normal early on — conversions lag outreach by weeks. If it stays flat, the usual reasons are: no bookings/payments have closed yet, real sends are gated for compliance, or the metric isn't wired to your booking/Stripe events (so real revenue wouldn't show here even if it happened). No action needed — this is an FYI, at most once a week.`,
        severity: "low",
        ttlMs: revenueNudgeTtlMs(),
        tags: ["company", "progress"],
      }).catch(() => undefined);
    }
  }

  for (const company of eligible) {
    try {
      const executionCapability = companyExecutionCapability(company.execution);
      const companyPrefix = `company:${company.id}:`;
      if (executionCapability.autonomy.activityAuthority === "work-board") {
        if (!board) continue;
        const scoped = scopeFleetToMembers(fleet, company.agentIds);
        // No member online + chat-capable → nobody to do the work; don't pile up queued tasks.
        if (executionCapability.autonomy.requiresOnlineCrew && countDispatchableMembers(scoped) === 0) continue;
        // Crew already has live work → let it finish before re-dispatching.
        const idents = memberIdentities(scoped);
        if (companyHasActiveWork(tasks, idents, company.id)) continue;
      } else if (company.execution?.engine === "aeon") {
        // The AEON workspace is the activity authority. Any queued/active run in
        // that workspace serializes company dispatches so overlapping external
        // runs cannot be created by the HivemindOS cadence.
        const activity = await inspectCompanyAeonActivity(company.execution);
        if (activity.hasActiveRun) continue;
      }

      // Approval backpressure: once too many items are already waiting on a human,
      // stop planning NEW work so the Needs You lane can't silently balloon to
      // hundreds. This only gates FRESH dispatch (in-flight work drained above) and
      // auto-releases the moment the human clears enough to drop back under the
      // threshold — no Stop button, no permanent halt. A low-severity, in-app-only
      // nudge (deduped per company) tells the operator why the company went quiet.
      const pauseThreshold = company.autonomyPause?.maxWaitingOnHuman ?? 0;
      if (pauseThreshold > 0) {
        const waiting = countCompanyWaitingOnHuman(tasks, company.id, company.autonomyPause);
        if (waiting >= pauseThreshold) {
          console.log(`[company-autonomy-driver] ${company.id}: paused — ${waiting} item(s) waiting on a human (threshold ${pauseThreshold}), skipping dispatch`);
          await notifyEscalation({
            key: `company-autonomy-paused:${company.id}`,
            title: `${company.name}: paused — ${waiting} waiting on you`,
            body: `Autonomy is paused: ${waiting} item(s) are waiting on your approval (threshold ${pauseThreshold}), so no new work will be planned until you clear some. Open the Needs You lane to review — it resumes on its own once the count drops below ${pauseThreshold}.`,
            severity: "low",
            ttlMs: autonomyPauseNudgeTtlMs(),
            tags: ["company", "paused"],
          }).catch(() => undefined);
          continue;
        }
      }

      // Progress-gated cadence: if the LAST batch drained without completing any
      // work, the company is stuck — re-planning the same goal immediately just
      // burns tokens, so back off to a longer interval until something completes.
      const sinceDispatch = company.lastDispatchedAt ?? 0;
      const completedSince = tasks.filter(
        (t) => (t.source ?? "").startsWith(companyPrefix) && t.status === "done" && (t.completedAt ?? t.updatedAt ?? 0) > sinceDispatch,
      ).length;
      const noProgress = executionCapability.autonomy.activityAuthority === "work-board"
        && sinceDispatch > 0
        && completedSince === 0;
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

      // Lifetime completed titles (newest first) for the planner's "already
      // built — don't recreate" inventory. Deliberately NOT fed to the hard
      // dedupe: dropping every similar title forever would block legitimately
      // recurring ops work; the planner just needs to SEE what exists.
      const completedCompanyTaskTitles = tasks
        .filter((t) => (t.source ?? "").startsWith(companyPrefix) && t.status === "done")
        .sort((a, b) => (b.completedAt ?? b.updatedAt ?? 0) - (a.completedAt ?? a.updatedAt ?? 0))
        .map((t) => t.title)
        .filter((t): t is string => Boolean(t));

      // Stamp BEFORE dispatching so the throttle still applies if the dispatch
      // throws — prevents a tight retry loop on a persistently failing company.
      await markCompanyDispatched(company.id, Date.now());
      const origin = resolveCompanyDriverSelfBases()[0];
      const result = await dispatchCompanyGoal(company, fleet, {
        origin,
        recentCompanyTaskTitles,
        completedCompanyTaskTitles,
      });
      if (result.executionEngine === "aeon") {
        console.log(`[company-autonomy-driver] ${company.id}: dispatched AEON skill ${result.aeon?.skill ?? "run"} through ${result.aeon?.profileName ?? "the configured workspace"}`);
      } else if (result.taskCount === 0) {
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

/**
 * Run ONE driver tick through this module's CURRENT code. Exposed for the
 * driver route's `action: "tick"`: in dev, an API request always compiles the
 * latest source, so ticks driven through the route pick up driver fixes with
 * NO server restart — "restart the dev server" must never be the remedy for a
 * driver bug. The machine-wide lease still gates it: only the lease-holder
 * process (the route runs inside it) may tick, so a standby process's route
 * cannot double-dispatch.
 */
export async function runCompanyDriverTickNow(): Promise<{ ticked: boolean; reason?: string }> {
  if (companyAutonomyDriverDisabled()) return { ticked: false, reason: "driver disabled via HIVEMINDOS_COMPANY_AUTONOMY_DRIVER=0" };
  if (!companyDriverLeaseDisabled()) {
    const lease = await acquireOrRenewCompanyDriverLease();
    if (!lease.held) return { ticked: false, reason: `company-driver lease held by pid ${lease.holder?.pid ?? "?"}` };
  }
  await tickOnce();
  return { ticked: true };
}

/**
 * Prefer ticking through our own driver route over calling tickOnce from this
 * module instance: a long-lived loop holds whatever code it booted with, and
 * in dev that meant every driver fix silently waited for a server restart. The
 * route compiles fresh on request, so the loop always executes current logic.
 * Falls back to the in-process tick when no self base is known yet or the
 * route is unreachable (packaged static mode) — behavior is identical there.
 */
async function tickPreferringFreshRoute(): Promise<void> {
  for (const base of resolveCompanyDriverSelfBases()) {
    try {
      const response = await fetch(`${base}/api/company-autonomy-driver`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...internalApiAuthHeaders() },
        body: JSON.stringify({ action: "tick" }),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!response.ok) continue;
      const json = await response.json().catch(() => null) as { ok?: unknown; ticked?: unknown } | null;
      if (json?.ok === true && json?.ticked === true) return;
      if (json?.ok === true) return; // lease moved between checks — the holder ticks
    } catch {
      // try the next loopback candidate, then fall back in-process
    }
  }
  await tickOnce();
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
        await tickPreferringFreshRoute();
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
