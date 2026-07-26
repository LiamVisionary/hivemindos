import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { createTask, patchTask, readBoard } from "@/lib/services/kanban/local-kanban-store";
import { scheduleQueenBeeAutonomousPickup } from "@/lib/services/queen-bee/autonomous-worker";
import { chooseQueenBeeDelegate, machineMatchesTarget, rankQueenBeeDelegates, type QueenBeeDelegate, type QueenBeeRouterOptions, type QueenBeeTaskIntent, type QueenBeeWorkerClass } from "@/lib/services/queen-bee/router";
import { discoverQueenBeeFleetSnapshot } from "@/lib/services/queen-bee/fleet-snapshot";
import { DASHBOARD_AUTH_HEADER, internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import { companyIdFromSource } from "@/lib/services/queen-bee/company-task-context";
import { readQueenBeeOutcomeStats } from "@/lib/services/queen-bee/outcome-stats";
import { readProjectRegistry } from "@/lib/services/projects/project-registry";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { KanbanLoopSpec, KanbanPriority, KanbanTask } from "@/lib/types/kanban";

export const QUEEN_BEE_FOLDER_NAME = "Queen Bee";
export const QUEEN_BEE_PROTOCOL = "hivemind-queen-bee";

export type QueenBeeOptions = {
  vaultPath?: string | null;
  brainServicesFolder?: string | null;
  kanbanFolder?: string | null;
};

export type QueenBeeMessageInput = QueenBeeOptions & {
  message: string;
  source?: string | null;
  mode?: "act" | "plan" | "route";
  priority?: KanbanPriority;
  loop?: KanbanLoopSpec | null;
  taskTitle?: string | null;
  agentId?: string | null;
  machineId?: string | null;
  fleetSnapshot?: QueenBeeFleetMachine[] | null;
  /** Explicit worker-class hints for routing (e.g. ["code"]); defaults to []. */
  skills?: string[] | null;
  /** Workspace isolation requested for the Work Board task. */
  workspace?: KanbanTask["workspace"] | null;
  /** Project-registry id to stamp on the created task (routing + proof badge). */
  projectId?: string | null;
  /**
   * Work Board task ids this task depends on. The board parent-gates the child
   * (created in "ideas" until every parent is done) and promoteReadyChildren
   * releases it, so dependent plans run as a DAG instead of all-at-once.
   */
  parents?: string[] | null;
};

export type QueenBeeFleetMachine = {
  key?: string;
  collector?: string;
  device?: {
    name?: string;
    dnsName?: string;
    os?: string;
    online?: boolean;
    collectorUrl?: string;
    machineId?: string;
    self?: boolean;
  };
  capabilities?: Record<string, unknown>;
  system?: {
    cpuPct?: number;
    ramPct?: number;
    diskPct?: number | null;
  };
  fleetPolicy?: {
    configured?: boolean;
    performance?: {
      enabled?: boolean;
      ignore?: boolean;
      maxCpuPct?: number;
      maxRamPct?: number;
      maxDiskPct?: number;
    };
  };
  version?: {
    appDir?: string;
    commit?: string;
    shortCommit?: string;
    branch?: string;
    dirty?: boolean;
    latestCommit?: string;
    latestShortCommit?: string;
    updateCommand?: string;
    projects?: Array<{
      projectId?: string;
      name?: string;
      slug?: string;
      localPath?: string;
      appDir?: string;
      remoteUrl?: string;
      gitlawbRepoId?: string;
      gitlawbRepoName?: string;
      branch?: string;
      commit?: string;
      shortCommit?: string;
      dirty?: boolean;
      latestCommit?: string;
      latestShortCommit?: string;
      updateCommand?: string;
    }>;
    projectCheckouts?: Array<{
      projectId?: string;
      name?: string;
      slug?: string;
      localPath?: string;
      appDir?: string;
      remoteUrl?: string;
      gitlawbRepoId?: string;
      gitlawbRepoName?: string;
      branch?: string;
      commit?: string;
      shortCommit?: string;
      dirty?: boolean;
      latestCommit?: string;
      latestShortCommit?: string;
      updateCommand?: string;
    }>;
  };
  agents?: Array<{
    id?: string;
    agentId?: string;
    name?: string;
    runtime?: string;
    beeRole?: string;
    workerClass?: string;
    machineName?: string;
    telemetryUrl?: string;
    gatewayUrl?: string;
    skillProfilePrompt?: string;
    preferredSkillSlugs?: string[];
    runtimeCapabilities?: Record<string, unknown>;
    collectorCapabilities?: Record<string, unknown>;
  }>;
};

export type QueenBeeState = {
  protocol: typeof QUEEN_BEE_PROTOCOL;
  version: 1;
  identity: "logical-queen-bee";
  status: "ready";
  updatedAt: string;
  workBoard: string;
  memory: string;
  fleet: string;
  handoff: string;
};

type QueenBeePaths = {
  vaultRoot: string;
  brainServicesFolder: string;
  root: string;
  state: string;
  identity: string;
  routingPolicy: string;
  safetyPolicy: string;
  currentState: string;
  intentDedupe: string;
  leases: string;
  receipts: string;
  nodes: string;
  inbox: string;
  outbox: string;
};

export function normalizeQueenBeeFolder(folder?: string | null) {
  const clean = String(folder || DEFAULT_SHARED_VAULT.brainServicesFolder).trim();
  if (!clean || clean.split(/[\\/]+/).includes("..")) {
    throw new Error("Brain services folder must be a relative vault path.");
  }
  return clean.split(/[\\/]+/).filter(Boolean).join(sep);
}

export function resolveQueenBeePaths(options: QueenBeeOptions = {}): QueenBeePaths {
  const vaultRoot = resolveObsidianVaultPath(options.vaultPath || DEFAULT_SHARED_VAULT.vaultPath);
  const brainServicesFolder = normalizeQueenBeeFolder(options.brainServicesFolder);
  const root = join(vaultRoot, brainServicesFolder, QUEEN_BEE_FOLDER_NAME);
  return {
    vaultRoot,
    brainServicesFolder,
    root,
    state: join(root, "state.json"),
    identity: join(root, "Identity.md"),
    routingPolicy: join(root, "Routing Policy.md"),
    safetyPolicy: join(root, "Safety Policy.md"),
    currentState: join(root, "Current State.md"),
    intentDedupe: join(root, "intent-dedupe.jsonl"),
    leases: join(root, "leases.jsonl"),
    receipts: join(root, "receipts.jsonl"),
    nodes: join(root, "nodes"),
    inbox: join(root, "inbox"),
    outbox: join(root, "outbox"),
  };
}

export async function initializeQueenBeeControlPlane(options: QueenBeeOptions = {}) {
  const paths = resolveQueenBeePaths(options);
  await Promise.all([paths.root, paths.nodes, paths.inbox, paths.outbox].map((path) => mkdir(path, { recursive: true })));

  const state = defaultQueenBeeState(options);
  await writeIfMissing(paths.state, `${JSON.stringify(state, null, 2)}\n`);
  await writeIfMissing(paths.identity, queenBeeIdentityMarkdown());
  await writeIfMissing(paths.routingPolicy, queenBeeRoutingPolicyMarkdown());
  await writeIfMissing(paths.safetyPolicy, queenBeeSafetyPolicyMarkdown());
  await writeIfMissing(paths.currentState, queenBeeCurrentStateMarkdown());
  await writeIfMissing(join(paths.nodes, "README.md"), queenBeeNodesReadme());
  await writeIfMissing(join(paths.inbox, "README.md"), "# Queen Bee Inbox\n\nOptional append-only request intake for runtimes that cannot call `/api/queen-bee` directly.\n");
  await writeIfMissing(join(paths.outbox, "README.md"), "# Queen Bee Outbox\n\nOptional response receipts for runtimes that cannot receive live API responses.\n");
  await writeIfMissing(paths.intentDedupe, "");
  await writeIfMissing(paths.leases, "");
  await writeIfMissing(paths.receipts, "");
  return { paths, state };
}

export async function readQueenBeeState(options: QueenBeeOptions = {}) {
  const { paths, state } = await initializeQueenBeeControlPlane(options);
  try {
    const raw = await readFile(paths.state, "utf8");
    return { paths, state: JSON.parse(raw) as QueenBeeState };
  } catch {
    return { paths, state };
  }
}

const REDISPATCH_MIN_READY_AGE_MS = 120_000;

/** Pure predicate: is this a stranded autonomous task safe to re-dispatch a pickup for? */
export function isRedispatchableReadyTask(
  task: Pick<KanbanTask, "status" | "assignee" | "targetMachine" | "loop" | "source" | "updatedAt">,
  now: number,
): boolean {
  if (task.status !== "ready") return false;
  const collectorUrl = task.targetMachine?.collectorUrl;
  const assignee = task.assignee?.trim();
  if (!collectorUrl || !assignee || assignee === "queen-bee") return false;
  const source = task.source ?? "";
  // "flow:" is load-bearing: without it, sequential/graph company tasks were
  // invisible to every recovery sweep — a stalled flow just stopped forever
  // with zero signal (confirmed open in the 2026-07-11 and 07-16 audits).
  // "marketplace" likewise: its monitor/research dispatches are unattended, and
  // one that missed submit-time routing sat pending 90+ minutes with zero
  // recovery (seen live 2026-07-18, sync-catalog task t_mrqsxtpy_nn9cg).
  const autonomous = Boolean(task.loop) || source.startsWith("queen-bee") || source.startsWith("loop") || source.startsWith("company:") || source.startsWith("flow:") || source.startsWith("marketplace");
  if (!autonomous) return false;
  // Idle a beat so we never race the original setTimeout pickup of a just-submitted task.
  return now - (task.updatedAt ?? 0) >= REDISPATCH_MIN_READY_AGE_MS;
}

export type QueenBeeResumeChainOptions = QueenBeeOptions & {
  /** Injected fleet snapshot (tests / callers that already hold one); when absent the rebuild self-fetches discovery. */
  fleetSnapshot?: QueenBeeFleetMachine[] | null;
  companyMembers?: Map<string, Set<string>>;
};

/** Inputs one recovery/resume pass shares across every chain rebuild: the current fleet plus routing signals. */
export type QueenBeeResumeChainContext = {
  fleet: QueenBeeFleetMachine[];
  membersByCompany: Map<string, Set<string>>;
  projectRegistry: QueenBeeTaskIntent["projectRegistry"];
  routerOptions: QueenBeeRouterOptions;
};

/**
 * Best-effort context for rebuilding delegation chains outside the submit path.
 * Returns null when the fleet cannot be discovered — callers degrade to the
 * task's single known delegate instead of blocking recovery.
 */
export async function prepareQueenBeeResumeChainContext(options: QueenBeeResumeChainOptions = {}): Promise<QueenBeeResumeChainContext | null> {
  const fleet = options.fleetSnapshot ?? await fetchOwnFleetSnapshotForResume();
  if (!fleet.length) return null;
  const membersByCompany = options.companyMembers ?? await readCompanyMembersByCompany();
  const projectRegistry = await readQueenBeeProjectRegistry(options.vaultPath);
  const sessionOutcomes = await readQueenBeeOutcomeStats().catch(() => ({}));
  const { assignments, boardOutcomes } = await readQueenBeeBoardSignals(options);
  return {
    fleet,
    membersByCompany,
    projectRegistry,
    routerOptions: { outcomes: mergeQueenBeeOutcomes(sessionOutcomes, boardOutcomes), assignments },
  };
}

/**
 * Rebuild a REAL delegation chain for a task that already carries an assignee
 * and a delegated target, by ranking the current fleet — honoring the task's
 * company crew scoping and requestedMachine/requestedAgent pins exactly like
 * the pending-task re-router. The previously-assigned agent stays first (both
 * recovery and answer-resume resume the same worker); the ranked peers behind
 * it give the autonomous pickup real fallbacks AND an independent reviewer for
 * judge-gated loops — a fabricated one-element chain structurally cannot staff
 * a reviewer, so judge-gated tasks ran their work and then parked needs-human.
 * Returns [] when no safe chain can be built (callers degrade to the single
 * known delegate).
 */
export function rebuildQueenBeeResumeChain(
  task: Pick<KanbanTask, "title" | "body" | "skills" | "source" | "assignee" | "targetMachine" | "requestedMachine" | "requestedAgent">,
  context: QueenBeeResumeChainContext,
): QueenBeeDelegate[] {
  const assignee = task.assignee?.trim();
  if (!assignee || assignee === "queen-bee") return [];
  let candidateFleet = context.fleet;
  // Company tasks may only ever run (and be reviewed) by their own crew.
  const companyId = companyIdFromSource(task.source);
  if (companyId) {
    const memberIds = context.membersByCompany.get(companyId);
    if (!memberIds || memberIds.size === 0) return [];
    candidateFleet = scopeFleetToMemberIds(candidateFleet, memberIds);
    if (candidateFleet.length === 0) return [];
  }
  const requestedMachine = task.requestedMachine?.trim();
  if (requestedMachine) {
    candidateFleet = candidateFleet.filter((machine) => machineMatchesTarget(machine, requestedMachine));
    if (candidateFleet.length === 0) return [];
  }
  const requestedAgent = task.requestedAgent?.trim();
  if (requestedAgent) {
    candidateFleet = scopeFleetToMemberIds(candidateFleet, new Set([requestedAgent]));
    if (candidateFleet.length === 0) return [];
  }
  const intent = { title: task.title, body: task.body ?? "", skills: task.skills ?? [], projectRegistry: context.projectRegistry };
  const ranked = rankQueenBeeDelegates(
    intent,
    candidateFleet,
    requestedMachine ? { ...context.routerOptions, targetMachineKey: requestedMachine } : context.routerOptions,
  );
  if (ranked.length === 0) return [];
  // Resume the SAME agent that owns the card. Its ranked entry moves first so
  // the pickup runs it with real fleet metadata (runtime, model — which feeds
  // the reviewer's model-strength scoring); when the assignee is not currently
  // routable, keep it first as the known delegate with the ranked fleet behind
  // it as fallbacks/reviewers.
  const matchIndex = ranked.findIndex((delegation) => delegationMatchesAssignee(delegation, assignee));
  if (matchIndex > 0) ranked.unshift(...ranked.splice(matchIndex, 1));
  else if (matchIndex < 0) ranked.unshift(assignedTaskResumeDelegation(task, assignee));
  return ranked;
}

function delegationMatchesAssignee(delegation: QueenBeeDelegate, assignee: string): boolean {
  const wanted = assignee.toLowerCase();
  return [delegation.agent?.name, delegation.agent?.id, delegation.agent?.agentId]
    .some((value) => String(value || "").trim().toLowerCase() === wanted);
}

/** The degraded single-delegate shape: resume the recorded assignee on the task's recorded target machine. */
function assignedTaskResumeDelegation(task: Pick<KanbanTask, "targetMachine">, assignee: string): QueenBeeDelegate {
  return {
    status: "delegated",
    workerClass: "general",
    score: 0,
    reason: "Resuming the task's previously delegated agent on its recorded target machine.",
    agent: { name: assignee, runtime: "hermes", runtimeCapabilities: { chat: true } },
    machine: { key: task.targetMachine?.key, device: { name: task.targetMachine?.name, collectorUrl: task.targetMachine?.collectorUrl } },
  };
}

/** Company membership map: injected (tests / caller) or lazily read from the company store. */
async function readCompanyMembersByCompany(): Promise<Map<string, Set<string>>> {
  // Lazy import keeps control-plane free of a static companies-store dependency.
  return new Map(
    (await import("@/lib/services/companies-store")
      .then((m) => m.readCompanies())
      .catch(() => [] as Array<{ id: string; agentIds?: string[] }>)
    ).map((c) => [c.id, new Set(c.agentIds ?? [])]),
  );
}

/**
 * Best-effort fleet discovery for sweeps that run with no request context (the
 * driver ticks). Reuses the company driver's remembered self-base candidates so
 * the fetch works through whichever loopback family this server actually
 * listens on; an empty result means discovery is unavailable and the caller
 * degrades. Lazy driver import avoids a static import cycle (the driver
 * statically imports this module).
 */
async function fetchOwnFleetSnapshotForResume(): Promise<QueenBeeFleetMachine[]> {
  try {
    const { resolveCompanyDriverSelfBases } = await import("@/lib/services/company-autonomy-driver");
    const token = internalApiAuthHeaders()[DASHBOARD_AUTH_HEADER] ?? null;
    for (const base of resolveCompanyDriverSelfBases()) {
      const machines = await discoverQueenBeeFleetSnapshot(base, token);
      if (machines.length) return machines;
    }
  } catch {
    // fall through — resume degrades to the single known delegate
  }
  return [];
}

/**
 * Recovers autonomous Work Board tasks left "ready" with a delegated target but no live worker —
 * e.g. when a server restart killed the in-process pickup, or `reclaimStaleTasks` returned a
 * timed-out task to the queue. Re-schedules an autonomous pickup for each so a crashed/restarted
 * dispatch self-heals instead of stranding. Only touches tasks idle a beat (so it never races a
 * freshly-scheduled pickup) that carry a collector URL. Returns the number of pickups scheduled.
 */
export async function redispatchReadyQueenBeeTasks(options: QueenBeeResumeChainOptions = {}): Promise<number> {
  const board = await readBoard(null, { vaultPath: options.vaultPath, kanbanFolder: options.kanbanFolder }).catch(() => null);
  if (!board) return 0;
  const now = Date.now();
  const stranded = (board.tasks ?? []).filter((task) => isRedispatchableReadyTask(task, now));
  if (stranded.length === 0) return 0;
  // One chain-rebuild context per sweep. Judge-gated tasks need a real
  // multi-delegate chain to staff an independent reviewer; when discovery is
  // unavailable the sweep degrades to the single known delegate per task.
  const context = await prepareQueenBeeResumeChainContext(options).catch(() => null);
  let scheduled = 0;
  for (const task of stranded) {
    const chain = context ? rebuildQueenBeeResumeChain(task, context) : [];
    const ok = scheduleQueenBeeAutonomousPickup({
      task,
      delegation: chain[0] ?? assignedTaskResumeDelegation(task, task.assignee!.trim()),
      delegationChain: chain,
      vaultPath: options.vaultPath,
      kanbanFolder: options.kanbanFolder,
    });
    if (ok) scheduled += 1;
  }
  return scheduled;
}

/**
 * Pure predicate: a task Queen Bee queued "pending" (assignee "queen-bee", never
 * delegated — no routable agent was online at submit time) that routing should
 * retry against a fresh fleet snapshot. The pickup re-dispatcher intentionally
 * skips these (no delegate to re-schedule), so without a routing retry they wait
 * forever even after matching agents come online.
 */
export function isRoutablePendingQueenBeeTask(
  task: Pick<KanbanTask, "status" | "assignee" | "source" | "loop" | "updatedAt">,
  now: number,
): boolean {
  if (task.status !== "ready") return false;
  if ((task.assignee?.trim() || "queen-bee") !== "queen-bee") return false;
  const source = task.source ?? "";
  // "flow:" is load-bearing: without it, sequential/graph company tasks were
  // invisible to every recovery sweep — a stalled flow just stopped forever
  // with zero signal (confirmed open in the 2026-07-11 and 07-16 audits).
  // "marketplace" likewise: its monitor/research dispatches are unattended, and
  // one that missed submit-time routing sat pending 90+ minutes with zero
  // recovery (seen live 2026-07-18, sync-catalog task t_mrqsxtpy_nn9cg).
  const autonomous = Boolean(task.loop) || source.startsWith("queen-bee") || source.startsWith("loop") || source.startsWith("company:") || source.startsWith("flow:") || source.startsWith("marketplace");
  if (!autonomous) return false;
  // Idle a beat so we never race the submit path that just created the task.
  return now - (task.updatedAt ?? 0) >= REDISPATCH_MIN_READY_AGE_MS;
}

export { companyIdFromSource } from "@/lib/services/queen-bee/company-task-context";

/** Restrict a fleet snapshot to a set of member agent ids (by id/agentId/name). */
function scopeFleetToMemberIds(fleet: QueenBeeFleetMachine[], ids: Set<string>): QueenBeeFleetMachine[] {
  if (ids.size === 0) return [];
  const out: QueenBeeFleetMachine[] = [];
  for (const machine of fleet) {
    const agents = (machine.agents ?? []).filter(
      (a) => (a.id && ids.has(a.id)) || (a.agentId && ids.has(a.agentId)) || (a.name && ids.has(a.name)),
    );
    if (agents.length > 0) out.push({ ...machine, agents });
  }
  return out;
}

/**
 * Re-run routing for pending queen-bee tasks against the CURRENT fleet, delegate
 * the ones that now have a routable agent, and schedule their autonomous pickup.
 * Returns the number of tasks delegated. One task's failure never stops the sweep.
 *
 * COMPANY SCOPING (load-bearing): a pending `company:{id}:` task is routed ONLY
 * to that company's staffed members — never to any available fleet agent. Without
 * this, the pending re-router picked the globally-best chat agent and ran company
 * work on non-members (seen live 2026-07-02: a Venice-provider agent and others
 * ran Website-Outreach tasks, violating the codex/hermes-only crew). If none of a
 * company's members are online, the task stays pending rather than leaking out.
 */
export async function routePendingQueenBeeTasks(
  fleetSnapshot: QueenBeeFleetMachine[],
  options: QueenBeeOptions & { now?: number; companyMembers?: Map<string, Set<string>> } = {},
): Promise<number> {
  if (!fleetSnapshot.length) return 0;
  const board = await readBoard(null, { vaultPath: options.vaultPath, kanbanFolder: options.kanbanFolder }).catch(() => null);
  if (!board) return 0;
  const now = options.now ?? Date.now();
  const pending = (board.tasks ?? []).filter((task) => isRoutablePendingQueenBeeTask(task, now));
  if (pending.length === 0) return 0;

  // Company membership: injected (tests / caller) or read from the company store.
  const membersByCompany = options.companyMembers ?? await readCompanyMembersByCompany();

  const projectRegistry = await readQueenBeeProjectRegistry(options.vaultPath);
  const sessionOutcomes = await readQueenBeeOutcomeStats().catch(() => ({}));
  const { assignments, boardOutcomes } = await readQueenBeeBoardSignals(options);
  const routerOptions = { outcomes: mergeQueenBeeOutcomes(sessionOutcomes, boardOutcomes), assignments };

  let routed = 0;
  for (const task of pending) {
    try {
      // Company tasks may only run on their own crew. Skip (leave pending) when the
      // company is unknown or has no member currently online — never route out.
      const companyId = companyIdFromSource(task.source);
      let candidateFleet = fleetSnapshot;
      if (companyId) {
        const memberIds = membersByCompany.get(companyId);
        if (!memberIds || memberIds.size === 0) continue;
        candidateFleet = scopeFleetToMemberIds(fleetSnapshot, memberIds);
        if (candidateFleet.length === 0) continue;
      }
      // A machine-pinned task may ONLY run on its pinned machine. When it is
      // offline, leave the task pending — routing "somewhere" ran a marketplace
      // browser task on a Mac without the signed-in browser (2026-07-18).
      const requestedMachine = task.requestedMachine?.trim();
      if (requestedMachine) {
        candidateFleet = candidateFleet.filter((machine) => machineMatchesTarget(machine, requestedMachine));
        if (candidateFleet.length === 0) continue;
      }
      // An agent-pinned task likewise only ever runs as its pinned agent.
      const requestedAgent = task.requestedAgent?.trim();
      if (requestedAgent) {
        candidateFleet = scopeFleetToMemberIds(candidateFleet, new Set([requestedAgent]));
        if (candidateFleet.length === 0) continue;
      }
      const intent = { title: task.title, body: task.body ?? "", skills: task.skills ?? [], projectRegistry };
      const chain = rankQueenBeeDelegates(
        intent,
        candidateFleet,
        requestedMachine ? { ...routerOptions, targetMachineKey: requestedMachine } : routerOptions,
      );
      const delegation = chain[0];
      if (!delegation || delegation.status !== "delegated") continue;
      const agentName = delegation.agent?.name || delegation.agent?.id || delegation.agent?.agentId;
      const collectorUrl = queenBeeDelegationCollectorUrl(delegation);
      if (!agentName || !collectorUrl) continue;
      const machineName = delegation.machine?.device?.name || delegation.machine?.key;
      const { task: updated } = await patchTask(null, task.id, {
        assignee: agentName,
        targetMachine: {
          key: delegation.machine?.key || delegation.machine?.device?.machineId || machineName || "unknown",
          name: machineName || "Unknown machine",
          collectorUrl,
        },
      }, { vaultPath: options.vaultPath, kanbanFolder: options.kanbanFolder });
      // The sweep must see its OWN placements: ranked against a frozen
      // assignments snapshot, a burst of pending tasks all landed on the same
      // top agent/machine and then serialized behind its chat slot. Count each
      // placement in the shared in-memory assignments (keyed like the board's
      // assignee signal) so the router's load penalty and machine spreader see
      // intra-sweep assignments when ranking the next task.
      assignments[agentName] = (assignments[agentName] ?? 0) + 1;
      const scheduled = scheduleQueenBeeAutonomousPickup({
        task: updated,
        delegation,
        delegationChain: chain,
        vaultPath: options.vaultPath,
        kanbanFolder: options.kanbanFolder,
      });
      if (scheduled) routed += 1;
    } catch {
      // Leave this task pending; the next sweep retries it.
    }
  }
  return routed;
}

type QueenBeeBoardSignals = {
  assignments: Record<string, number>;
  boardOutcomes: Record<string, { completed: number; failed: number }>;
};

const BOARD_OUTCOME_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;

// Reads the shared Work Board ONCE to derive two routing signals: in-flight load per agent
// (to spread bursts) and per-agent completion/failure history (so routing learns from REMOTE
// agents too — local chat-session stats only cover this machine's agents).
async function readQueenBeeBoardSignals(input: QueenBeeOptions): Promise<QueenBeeBoardSignals> {
  try {
    const board = await readBoard(null, { vaultPath: input.vaultPath, kanbanFolder: input.kanbanFolder });
    const assignments: Record<string, number> = {};
    for (const task of board?.tasks ?? []) {
      const assignee = task.assignee?.trim();
      if (!assignee || assignee === "queen-bee") continue;
      if (task.status === "working" || task.status === "ready") assignments[assignee] = (assignments[assignee] ?? 0) + 1;
    }
    const now = Date.now();
    const boardOutcomes: Record<string, { completed: number; failed: number }> = {};
    for (const run of board?.runs ?? []) {
      const assignee = run.assignee?.trim();
      if (!assignee || assignee === "queen-bee") continue;
      if (run.endedAt && now - run.endedAt > BOARD_OUTCOME_WINDOW_MS) continue;
      const outcome = run.outcome ?? run.status;
      const bucket = boardOutcomes[assignee] ?? (boardOutcomes[assignee] = { completed: 0, failed: 0 });
      if (outcome === "completed") bucket.completed += 1;
      else if (outcome === "blocked" || outcome === "failed" || outcome === "reclaimed") bucket.failed += 1;
    }
    return { assignments, boardOutcomes };
  } catch {
    return { assignments: {}, boardOutcomes: {} };
  }
}

function mergeQueenBeeOutcomes(
  session: Record<string, { completed: number; failed: number }>,
  board: Record<string, { completed: number; failed: number }>,
): Record<string, { completed: number; failed: number }> {
  const merged: Record<string, { completed: number; failed: number }> = { ...session };
  for (const [key, value] of Object.entries(board)) {
    merged[key] = merged[key]
      ? { completed: merged[key].completed + value.completed, failed: merged[key].failed + value.failed }
      : value;
  }
  return merged;
}

// An explicit machineId pins the task to that machine. Otherwise, if the message
// names a specific fleet machine by a hyphenated tailnet identifier (its key,
// machineId, or dnsName / dnsName first label — NOT friendly names like "This
// Mac", which are too ambiguous to infer from prose), pin to that machine. The
// router then hard-restricts candidates to that machine's agents.
function resolveQueenBeeTargetMachine(
  machineId: string | null | undefined,
  message: string,
  machines: QueenBeeFleetMachine[],
): string | undefined {
  const explicit = machineId?.trim();
  if (explicit) return explicit;
  const text = message.toLowerCase();
  for (const machine of machines) {
    const dns = String(machine.device?.dnsName || "").toLowerCase().replace(/\.$/, "");
    const identifiers = [machine.key, machine.device?.machineId, dns, dns.split(".")[0]]
      .map((value) => String(value || "").toLowerCase().trim())
      .filter((value) => value.length >= 12 && value.includes("-"));
    if (identifiers.some((id) => text.includes(id))) {
      return machine.key || machine.device?.name || undefined;
    }
  }
  return undefined;
}

export async function submitQueenBeeMessage(input: QueenBeeMessageInput) {
  const message = input.message?.trim();
  if (!message) throw new Error("Queen Bee message is required.");

  const { paths, state } = await initializeQueenBeeControlPlane(input);
  const source = input.source?.trim() || "api";
  const mode = input.mode || "act";
  const fingerprint = fingerprintIntent({ message, source, mode });
  const idempotencyKey = `queen-bee:${fingerprint}`;
  const title = input.taskTitle?.trim() || taskTitleFromMessage(message);
  const createdAt = new Date().toISOString();
  const projectRegistry = await readQueenBeeProjectRegistry(input.vaultPath);
  const sessionOutcomes = await readQueenBeeOutcomeStats().catch(() => ({}));
  // One board read yields BOTH in-flight load (spread bursts) and cross-machine completion
  // history (so routing learns from remote agents, not just this machine's chat sessions).
  const { assignments, boardOutcomes } = await readQueenBeeBoardSignals(input);
  const outcomes = mergeQueenBeeOutcomes(sessionOutcomes, boardOutcomes);
  // An explicit agentId hard-scopes routing to that agent (previously declared
  // on the input but never honored). An absent agent leaves the task pending —
  // never a silent fallback to whoever ranks best (routing kept selecting a
  // fabricating delegate over the caller's proven one, 2026-07-19).
  const requestedAgent = input.agentId?.trim() || undefined;
  const routableFleet = requestedAgent
    ? scopeFleetToMemberIds(input.fleetSnapshot ?? [], new Set([requestedAgent]))
    : input.fleetSnapshot ?? [];
  const targetMachineKey = resolveQueenBeeTargetMachine(input.machineId, message, routableFleet);
  const routerOptions = { outcomes, assignments, targetMachineKey };
  const delegationChain = rankQueenBeeDelegates({ title, body: message, skills: input.skills ?? [], projectRegistry }, routableFleet, routerOptions);
  const delegation = delegationChain[0] ?? chooseQueenBeeDelegate({ title, body: message, skills: input.skills ?? [], projectRegistry }, routableFleet, routerOptions);
  const selectedAgentName = delegation.agent?.name || delegation.agent?.id || delegation.agent?.agentId;
  const selectedMachineName = delegation.machine?.device?.name || delegation.machine?.key;
  const selectedCollectorUrl = queenBeeDelegationCollectorUrl(delegation);

  const result = await createTask(null, {
    title,
    body: queenBeeTaskBody({ message, source, mode, fingerprint, delegation, loop: input.loop }),
    source,
    assignee: selectedAgentName || "queen-bee",
    status: mode === "plan" ? "ideas" : "ready",
    priority: input.priority || "normal",
    workspace: input.workspace ?? "scratch",
    skills: ["hivemindos-coordination", delegation.workerClass, ...(input.skills ?? [])],
    targetMachine: delegation.machine ? {
      key: delegation.machine.key || delegation.machine.device?.machineId || selectedMachineName || "unknown",
      name: selectedMachineName || "Unknown machine",
      collectorUrl: selectedCollectorUrl,
    } : null,
    // Persist the pins so recovery re-routing (a pending task delegated later)
    // can never send this task to a different machine or agent than demanded.
    requestedMachine: targetMachineKey || undefined,
    requestedAgent,
    loop: input.loop ?? undefined,
    projectId: input.projectId?.trim() || undefined,
    parents: input.parents?.filter(Boolean) ?? undefined,
    idempotencyKey,
  }, {
    vaultPath: input.vaultPath,
    kanbanFolder: input.kanbanFolder,
  });

  const dedupeRecord = {
    protocol: QUEEN_BEE_PROTOCOL,
    fingerprint,
    idempotencyKey,
    taskId: result.task.id,
    status: result.created ? "accepted" : "duplicate",
    source,
    mode,
    workerClass: delegation.workerClass,
    selectedAgent: selectedAgentName,
    selectedMachine: selectedMachineName,
    createdAt,
  };
  await appendJsonl(paths.intentDedupe, dedupeRecord);

  const receipt = {
    protocol: QUEEN_BEE_PROTOCOL,
    taskId: result.task.id,
    fingerprint,
    status: result.created ? "queued" : "already-queued",
    delegation: publicDelegation(delegation),
    summary: result.created
      ? delegation.status === "delegated"
        ? `Queen Bee accepted the request and delegated it to ${selectedAgentName} on ${selectedMachineName}.`
        : "Queen Bee accepted the request and queued it on the shared Work Board until a matching fleet agent is available."
      : "Queen Bee found an existing Work Board task for this request fingerprint.",
    createdAt,
  };
  await appendJsonl(paths.receipts, receipt);
  await updateCurrentState(paths.currentState, { taskId: result.task.id, title, source, mode, createdAt, delegation });
  // A parent-gated task is created in "ideas" (not "ready"): the board releases it
  // via promoteReadyChildren when its parents finish, and the regular dispatch
  // sweep picks it up then — scheduling pickup now would race an unmet dependency.
  const autonomousPickupScheduled = result.created && mode === "act" && result.task.status === "ready" && scheduleQueenBeeAutonomousPickup({
    task: result.task,
    delegation,
    delegationChain,
    vaultPath: input.vaultPath,
    kanbanFolder: input.kanbanFolder,
  });

  const board = await readBoard(null, { vaultPath: input.vaultPath, kanbanFolder: input.kanbanFolder });
  return {
    protocol: QUEEN_BEE_PROTOCOL,
    state,
    created: result.created,
    task: result.task,
    board: { slug: board.meta.slug, taskCount: board.tasks.length, kanbanFolder: input.kanbanFolder || DEFAULT_SHARED_VAULT.kanbanFolder },
    route: {
      kind: "work-board",
      assignee: result.task.assignee || "queen-bee",
      targetMachine: result.task.targetMachine,
      delegation: publicDelegation(delegation),
      autonomousPickupScheduled,
      reason: delegation.reason,
    },
    fingerprint,
    receipt,
    paths: {
      root: paths.root,
      intentDedupe: paths.intentDedupe,
      receipts: paths.receipts,
      currentState: paths.currentState,
    },
  };
}

export function fingerprintIntent(input: { message: string; source?: string; mode?: string }) {
  const normalized = [input.source || "api", input.mode || "act", input.message]
    .join("\n")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

function defaultQueenBeeState(options: QueenBeeOptions = {}): QueenBeeState {
  return {
    protocol: QUEEN_BEE_PROTOCOL,
    version: 1,
    identity: "logical-queen-bee",
    status: "ready",
    updatedAt: new Date().toISOString(),
    workBoard: options.kanbanFolder || DEFAULT_SHARED_VAULT.kanbanFolder,
    memory: "Memory/Distillations/Agent Memory + Operations/Brain Services/Agent Memory Index.jsonl",
    fleet: "/api/fleet/discover + /api/fleet/apps",
    handoff: "/api/handoff + .hivemindos-transfers/",
  };
}

async function readQueenBeeProjectRegistry(vaultPath?: string | null) {
  try {
    const registry = await readProjectRegistry({ vaultPath });
    return { projects: registry.projects, updatedAt: registry.updatedAt };
  } catch {
    return { projects: [], updatedAt: Date.now() };
  }
}

async function writeIfMissing(path: string, content: string) {
  if (existsSync(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return true;
}

// True O_APPEND write: records are self-contained JSONL lines, and the previous
// read-then-rewrite dropped lines whenever two submits appended concurrently.
async function appendJsonl(path: string, record: Record<string, unknown>) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

async function updateCurrentState(path: string, event: { taskId: string; title: string; source: string; mode: string; createdAt: string; delegation: ReturnType<typeof chooseQueenBeeDelegate> }) {
  const delegation = publicDelegation(event.delegation);
  const content = `${queenBeeCurrentStateMarkdown().trim()}\n\n## Last Accepted Request\n\n- Time: ${event.createdAt}\n- Task: ${event.taskId}\n- Title: ${event.title}\n- Source: ${event.source}\n- Mode: ${event.mode}\n- Worker class: ${delegation.workerClass}\n- Delegate: ${delegation.agent?.name || "pending"}\n- Machine: ${delegation.machine?.name || "pending"}\n- Routing reason: ${delegation.reason}\n`;
  await writeFile(path, content, "utf8");
}

function taskTitleFromMessage(message: string) {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
}

function queenBeeTaskBody(input: { message: string; source: string; mode: string; fingerprint: string; delegation: ReturnType<typeof chooseQueenBeeDelegate>; loop?: KanbanLoopSpec | null }) {
  const delegation = publicDelegation(input.delegation);
  return [
    "Created by the Queen Bee control plane.",
    "",
    `Source: ${input.source}`,
    `Mode: ${input.mode}`,
    `Intent fingerprint: ${input.fingerprint}`,
    `Worker class: ${delegation.workerClass}`,
    `Delegated agent: ${delegation.agent?.name || "pending"}`,
    `Target machine: ${delegation.machine?.name || "pending"}`,
    loopSummary(input.loop),
    "",
    "## Request",
    input.message,
    "",
    "## Routing contract",
    "Use Shared Brain Memory for durable context, Fleet discovery for live capability, Handoff for cross-machine work, and receipts under Operations/Brain Services/Queen Bee/ for dedupe/audit.",
    "",
    "## Queen Bee delegation",
    delegation.reason,
  ].join("\n");
}

function loopSummary(loop?: KanbanLoopSpec | null) {
  if (!loop) return "";
  return [
    "## Loop contract",
    `Mode: ${loop.mode}`,
    loop.goal ? `Goal: ${loop.goal}` : "",
    loop.contract ? `Contract: ${loop.contract.title} - done means ${loop.contract.agreedDone.join("; ")}` : "",
    loop.evaluationRubric ? `Evaluator rubric: ${loop.evaluationRubric.title} (${loop.evaluationRubric.axes.map((axis) => `${axis.title} ${Math.round(axis.weight * 100)}%`).join("; ")})` : "",
    loop.successCriteria?.length ? `Success criteria: ${loop.successCriteria.join("; ")}` : "",
    loop.evalGates?.length ? `Eval gates: ${loop.evalGates.map((gate) => `${gate.title} (${gate.phase})`).join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

function publicDelegation(delegation: ReturnType<typeof chooseQueenBeeDelegate>) {
  return {
    status: delegation.status,
    workerClass: delegation.workerClass as QueenBeeWorkerClass,
    score: delegation.score,
    reason: delegation.reason,
    agent: delegation.agent ? {
      id: delegation.agent.id,
      agentId: delegation.agent.agentId,
      name: delegation.agent.name,
      runtime: delegation.agent.runtime,
      beeRole: delegation.agent.beeRole,
      workerClass: delegation.agent.workerClass,
    } : null,
    machine: delegation.machine ? {
      key: delegation.machine.key,
      name: delegation.machine.device?.name,
      os: delegation.machine.device?.os,
      collectorUrl: queenBeeDelegationCollectorUrl(delegation),
      machineId: delegation.machine.device?.machineId,
    } : null,
  };
}

function queenBeeDelegationCollectorUrl(delegation: ReturnType<typeof chooseQueenBeeDelegate>) {
  const deviceUrl = String(delegation.machine?.device?.collectorUrl || "").trim();
  if (deviceUrl) return deviceUrl;
  const collector = String(delegation.machine?.collector || "").trim();
  return /^https?:\/\//i.test(collector) ? collector : undefined;
}

function queenBeeIdentityMarkdown() {
  return `# Queen Bee Identity

Queen Bee is the single logical coordinator identity for HivemindOS. She may be reached from any runtime or machine, but all instances coordinate through the shared brain, shared Work Board, shared memory, fleet discovery, and handoff receipts.

## Product contract

- Present one assistant identity to the user.
- Hide per-machine coordinators unless routing details help trust or debugging.
- Prefer existing HivemindOS primitives over parallel queues.
- Write auditable receipts for accepted, duplicate, delegated, blocked, and completed work.
`;
}

function queenBeeRoutingPolicyMarkdown() {
  return `# Queen Bee Routing Policy

Queen Bee routes requests by reading, in order: the user request, Shared Brain Memory, Work Board state, Fleet discovery, connected-app context, project notes, and safety policy.

## Canonical primitives

- Tasks: Operations/Work Board/kanban.json and /api/kanban.
- Durable memory: Memory/Distillations/Agent Memory and /api/brain/memory.
- Live machines: /api/fleet/discover and /api/fleet/apps.
- Cross-machine delegation: /api/handoff and .hivemindos-transfers/.
- Human attention: Operations/Agent Notifications/.

## Default routing

- Local repo work goes to the machine that owns the checkout and has shell/git capability.
- Vault writes go to a runtime with writable shared-vault access.
- Mac-only UI or voice actions go to the Mac coordinator.
- GPU/media work goes to a machine advertising those capabilities.
- Rank online chat-capable agents across all machines, not just the local machine.
- Assign Work Board cards to the best available matching agent and target machine; use \`queen-bee\` only when no matching runtime is online.
- Risky actions require an explicit safety gate before execution.
`;
}

function queenBeeSafetyPolicyMarkdown() {
  return `# Queen Bee Safety Policy

## Levels

- Read-only lookup: no confirmation required.
- Safe mutation directly requested by Liam: proceed after fresh prerequisite checks.
- Risky mutation such as delete, deploy, send, spend, credentials, or irreversible external side effects: require explicit confirmation and write a receipt.
- Sensitive data: never write raw secrets, tokens, passwords, keys, or connection strings into the vault; use credential names/status only.

## Execution rule

Vault state provides consistency and replay protection. Live APIs provide current execution truth. Human confirmation gates high-risk side effects.
`;
}

function queenBeeCurrentStateMarkdown() {
  return `# Queen Bee Current State

Status: ready

Queen Bee is backed by Operations/Brain Services/Queen Bee, the shared Work Board, Shared Brain Memory, Fleet discovery, and Handoff. Runtime instances should check this file for compact state, then use live APIs for fresh status before executing work.
`;
}

function queenBeeNodesReadme() {
  return `# Queen Bee Nodes

Optional machine snapshots and annotations. Live availability should come from /api/fleet/discover and /api/fleet/apps; files here are cache/context, not the primary source of truth.
`;
}
