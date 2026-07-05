// Zero Human Companies — pure mappers from real app data → the Colony view model.
// Inputs come straight from the JSON APIs (/api/companies, /api/wallet/approvals,
// /api/obsidian/agents, /api/kanban); these functions are side-effect-free and
// client-safe (no server-only imports). Anything the app doesn't track is
// DERIVED here from what it does (spend rollups, member caps, kanban tasks),
// never invented.
import type {
  Company,
  CompanyMember,
  CompanyCapabilityCapital,
  CompanySpendRollup,
} from "@/lib/types/company";
import type { CompanyRevenueRollup } from "@/lib/types/company-revenue";
import type { KanbanDeliverable, KanbanLoopReceipt, KanbanLoopSpec } from "@/lib/types/kanban";
import { computeLoopCapabilityCapital } from "@/lib/services/loops";
import type {
  Agent,
  AgentState,
  Approval,
  Colony,
  CompanyEditForm,
  CompanyStatus,
  GovEvent,
  Issue,
  IssueStatus,
  MetricUnit,
  PoolAgent,
  Priority,
  Role,
  Risk,
} from "./types";

// ── lite shapes of the API payloads we consume ────────────────────────────
export interface AgentLite {
  id: string;
  name: string;
  runtime?: string;
  provider?: string;
  model?: string;
  beeRole?: string;
  workerClass?: string;
}

export interface ApprovalRow {
  id: string;
  agentId: string;
  agentName?: string;
  companyId?: string;
  kind: string;
  asset: string;
  amountUsd: number;
  target?: string;
  reason: string;
  status: string;
  createdAtMs: number;
}

export interface KanbanTaskLite {
  id: string;
  title: string;
  body?: string;
  result?: string;
  status: string;
  /** Origin marker; company dispatches stamp `company:{id}:{runId}` — the authoritative company link. */
  source?: string;
  assignee?: string | null;
  priority?: string;
  skills?: string[];
  deliverables?: KanbanDeliverable[];
  loop?: KanbanLoopSpec;
  loopReceipts?: KanbanLoopReceipt[];
  /** Machine that ran the task; its name is shown as deliverable provenance. */
  targetMachine?: { name?: string } | null;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
}

const ROLES: Role[] = ["Queen", "Engineer", "Product", "Designer", "QA", "DevOps", "Auditor", "Growth", "Research", "Treasury"];
const STATES: AgentState[] = ["working", "reviewing", "scheduled", "ready", "idle", "blocked", "setup"];

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function relativeTime(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function relativeShort(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "now";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const RUNTIME_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  hermes: "Hermes",
  codex: "Codex",
  aeon: "Aeon",
  evo: "Evo",
  openclaw: "OpenClaw",
  opencode: "OpenCode",
  openhands: "OpenHands",
  aider: "Aider",
  "hivemind-os": "HivemindOS",
  miroshark: "MiroShark",
  gemini: "Gemini",
  "openai-compatible": "OpenAI",
};

/** Format a metric value for display per its unit ($ prefix / % suffix / raw). */
export function formatMetric(value: string | undefined, unit?: string): string {
  const v = (value ?? "").trim();
  if (!v || v === "—") return v || "—";
  if (unit === "currency") return v.startsWith("$") ? v : `$${v}`;
  if (unit === "percent") return v.endsWith("%") ? v : `${v}%`;
  return v;
}

export function runtimeLabel(runtime?: string): string {
  if (!runtime) return "Agent";
  const key = runtime.toLowerCase();
  if (RUNTIME_LABELS[key]) return RUNTIME_LABELS[key];
  return runtime
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Agent";
}

const WORKER_CLASS_ROLE: Record<string, Role> = {
  code: "Engineer",
  planner: "Product",
  general: "Product",
  writer: "Designer",
  artist: "Designer",
  vision: "Designer",
  qa: "QA",
  ops: "DevOps",
  security: "Auditor",
  research: "Research",
};

/** Map a real agent (bee role + worker class) to a company Role, honoring an explicit override. */
export function mapRole(profile?: AgentLite, override?: string): Role {
  if (override && (ROLES as string[]).includes(override)) return override as Role;
  if (profile?.beeRole === "queen") return "Queen";
  if (profile?.workerClass && WORKER_CLASS_ROLE[profile.workerClass]) return WORKER_CLASS_ROLE[profile.workerClass];
  if (profile?.beeRole === "observer") return "Auditor";
  return "Engineer";
}

/** Build the assignable roster (PoolAgent[]) from real agent profiles. */
export function toPoolAgents(profiles: AgentLite[]): PoolAgent[] {
  return profiles.map((p) => ({
    id: p.id,
    name: p.name || p.id,
    role: mapRole(p),
    runtime: runtimeLabel(p.runtime),
    model: p.model || p.provider || "",
    walletCap: 0,
  }));
}

function normalizeState(value?: string, frozen?: boolean): AgentState {
  if (value && (STATES as string[]).includes(value)) return value as AgentState;
  return frozen ? "blocked" : "ready";
}

function defaultTask(state: AgentState, frozen?: boolean): string {
  if (frozen) return "Paused · company frozen by human override";
  if (state === "blocked") return "Blocked · awaiting approval";
  if (state === "working") return "Executing assigned work";
  return "Idle · awaiting work block";
}

// ── approvals ──────────────────────────────────────────────────────────────
function riskFor(amountUsd: number, dailyCap?: number): Risk {
  if (amountUsd >= 50 || (dailyCap && dailyCap > 0 && amountUsd >= dailyCap * 0.5)) return "high";
  if (amountUsd >= 10) return "med";
  return "low";
}

export function mapApproval(row: ApprovalRow, dailyCap?: number): Approval {
  const amount = `$${(Number(row.amountUsd) || 0).toFixed(2)} ${row.asset || "USDC"}`;
  const head = row.reason?.trim() || `${row.kind} spend`;
  const title = `${head} — ${amount}${row.target ? ` → ${row.target}` : ""}`;
  return {
    id: row.id,
    title,
    agent: row.agentName || row.agentId,
    kind: row.kind || "spend",
    risk: riskFor(Number(row.amountUsd) || 0, dailyCap),
  };
}

// ── kanban → issues / work block / velocity ─────────────────────────────────
const STATUS_TO_LANE: Record<string, IssueStatus> = {
  ideas: "todo",
  ready: "todo",
  working: "in_progress",
  "needs-human": "board_review",
  done: "done",
};

const PRIORITY_TO_PRI: Record<string, Priority> = {
  urgent: "urgent",
  high: "high",
  normal: "med",
  medium: "med",
  low: "low",
};

function hash3(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return String(100 + (Math.abs(h) % 900));
}

function issueCollisionSuffix(value: string): string {
  const compact = value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (compact.length >= 4) return compact.slice(-4);

  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 33 + value.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).toUpperCase().padStart(4, "0").slice(-4);
}

function resolveAssigneeName(assignee: string | null | undefined, byId: Map<string, string>, names: Set<string>): string | null {
  if (!assignee) return null;
  if (byId.has(assignee)) return byId.get(assignee)!;
  if (names.has(assignee)) return assignee;
  return assignee;
}

export function mapIssues(tasks: KanbanTaskLite[], ticker: string, byId: Map<string, string>, names: Set<string>): Issue[] {
  const visibleTasks = tasks.filter((t) => t.status !== "archived" && STATUS_TO_LANE[t.status]);
  const baseKeys = visibleTasks.map((t) => `${ticker}-${hash3(t.id)}`);
  const baseKeyCounts = new Map<string, number>();
  for (const baseKey of baseKeys) {
    baseKeyCounts.set(baseKey, (baseKeyCounts.get(baseKey) ?? 0) + 1);
  }
  const usedKeys = new Map<string, number>();

  return visibleTasks.map((t, index) => {
    const baseKey = baseKeys[index] ?? `${ticker}-${hash3(t.id)}`;
    const collision = (baseKeyCounts.get(baseKey) ?? 0) > 1;
    const candidateKey = collision ? `${baseKey}-${issueCollisionSuffix(t.id)}` : baseKey;
    const usedCount = usedKeys.get(candidateKey) ?? 0;
    usedKeys.set(candidateKey, usedCount + 1);
    const key = usedCount === 0 ? candidateKey : `${candidateKey}-${usedCount + 1}`;

    return {
      key,
      title: t.title || "(untitled)",
      status: STATUS_TO_LANE[t.status],
      agent: resolveAssigneeName(t.assignee, byId, names),
      pri: (t.priority && PRIORITY_TO_PRI[t.priority]) || "med",
      pts: Math.max(1, Math.min(8, t.skills?.length || 1)),
      // Carry the real Work Board record so the cockpit can open the task's
      // actual output (result, deliverables, receipts) instead of a dead card.
      work: {
        taskId: t.id,
        status: t.status,
        body: t.body,
        result: t.result,
        deliverables: (t.deliverables ?? []).map((d) => ({ id: d.id, label: d.label, kind: d.kind, path: d.path, url: d.url })),
        receipts: (t.loopReceipts ?? []).map((r) => ({ title: r.summary || r.gateId || "receipt", status: r.status, evidence: r.evidence ?? [] })),
        machineName: t.targetMachine?.name || undefined,
        updatedAt: t.updatedAt,
        completedAt: t.completedAt,
      },
    };
  });
}

function deriveVelocity(tasks: KanbanTaskLite[], days = 14): number[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const buckets = new Array(days).fill(0);
  for (const t of tasks) {
    const done = t.completedAt;
    if (!done) continue;
    const age = Math.floor((now - done) / day);
    if (age >= 0 && age < days) buckets[days - 1 - age] += 1;
  }
  return buckets;
}

// ── governance + activity (derived from approvals + tasks) ──────────────────
function deriveGovernance(company: Company, approvals: ApprovalRow[]): GovEvent[] {
  const events: GovEvent[] = [];
  if (company.frozen) {
    events.push({ kind: "alert", text: "Company frozen — all member-agent spend halted by human override.", agent: "human", since: relativeShort(company.createdAtMs) });
  }
  for (const a of approvals.slice(0, 4)) {
    events.push({
      kind: "escalate",
      text: `${a.agentName || a.agentId} escalated a ${a.kind} spend of $${(Number(a.amountUsd) || 0).toFixed(2)} for sign-off: ${a.reason || "no reason given"}`,
      agent: a.agentName || a.agentId,
      since: relativeShort(a.createdAtMs),
    });
  }
  return events;
}

function deriveActivity(tasks: KanbanTaskLite[], byId: Map<string, string>, names: Set<string>): string[] {
  const laneLabel: Record<string, string> = { ideas: "scoped", ready: "queued", working: "working", "needs-human": "needs human", done: "shipped" };
  return [...tasks]
    .filter((t) => t.status !== "archived")
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 5)
    .map((t) => {
      const who = (resolveAssigneeName(t.assignee, byId, names) || "unassigned").slice(0, 10).padEnd(10);
      const verb = laneLabel[t.status] || t.status;
      return `${who} :: ${verb} · ${t.title}`.slice(0, 88);
    });
}

// ── agents / org ────────────────────────────────────────────────────────────
function buildAgents(company: Company, agentsById: Map<string, AgentLite>, rollup: CompanySpendRollup): Agent[] {
  // agentIds is the documented source of truth for membership; enrich each with
  // its member metadata (cap / role / task / state) when present.
  const memberMeta = new Map((company.members ?? []).map((m) => [m.agentId, m] as const));
  const rawMembers: CompanyMember[] = (company.agentIds ?? []).map((agentId) => memberMeta.get(agentId) ?? { agentId });

  let agents: Agent[] = rawMembers.map((m) => {
    const profile = agentsById.get(m.agentId);
    const role = mapRole(profile, m.roleInCompany);
    const cap = m.companyCap ?? 0;
    const spentToday = rollup.memberSpend?.[m.agentId]?.dailyUsd ?? 0;
    const budgetPct = cap > 0 ? clamp(Math.round((spentToday / cap) * 100)) : 0;
    const state = normalizeState(m.state, company.frozen);
    return {
      id: m.agentId,
      name: profile?.name || m.agentId,
      role,
      runtime: runtimeLabel(profile?.runtime),
      model: profile?.model,
      walletCap: undefined,
      state,
      reportsTo: null,
      budgetPct,
      task: m.task?.trim() || defaultTask(state, company.frozen),
      _cap: cap || undefined,
    };
  });

  // Ensure exactly one Queen for the org chart; promote the first member if none.
  let queen = agents.find((a) => a.role === "Queen");
  if (!queen && agents.length > 0) {
    agents = agents.map((a, i) => (i === 0 ? { ...a, role: "Queen" as Role } : a));
    queen = agents[0];
  }
  const queenName = queen?.name ?? null;
  return agents.map((a) => (a.role === "Queen" ? { ...a, reportsTo: null } : { ...a, reportsTo: queenName }));
}

// ── status / alignment / burn ───────────────────────────────────────────────
function deriveStatus(company: Company, agents: Agent[], approvals: ApprovalRow[], alignment: number, hasWork: boolean): CompanyStatus {
  if (company.status) return company.status;
  if (company.frozen) return "paused";
  if (agents.length === 0 || !hasWork) return "setup";
  if (approvals.length > 0) return "review";
  if (alignment < 55) return "drift";
  return "shipping";
}

function deriveBurn(company: Company, rollup: CompanySpendRollup, agents: Agent[]) {
  const today = Math.round(rollup.dailySpentUsd);
  const memberCapTotal = agents.reduce((n, a) => n + (a._cap || 0), 0);
  const cap = company.dailyBudgetUsd ?? memberCapTotal ?? 0;
  const week = Math.round((rollup.monthlySpentUsd / 30) * 7);
  let runway = 99;
  if (rollup.dailySpentUsd > 0) {
    const remaining = rollup.totalRemainingUsd ?? rollup.monthlyRemainingUsd;
    if (remaining != null) runway = clamp(Math.round(remaining / rollup.dailySpentUsd), 0, 99);
  }
  return { today, cap: Math.round(cap), week, runway };
}

function deriveCapabilityCapital(
  company: Company,
  rollup: CompanySpendRollup,
  tasks: KanbanTaskLite[],
  agents: Agent[],
): CompanyCapabilityCapital {
  return computeLoopCapabilityCapital({
    tasks,
    agents,
    totalSpentUsd: rollup.totalSpentUsd,
    autonomyActive: company.autonomy,
    emptyLoopNote: "Launch autonomy to attach private eval loops to new work.",
    loopAttachmentNoun: "company work",
  });
}

export interface BuildColonyInput {
  company: Company;
  rollup: CompanySpendRollup;
  revenueShare?: CompanyRevenueRollup;
  approvals: ApprovalRow[];
  agentsById: Map<string, AgentLite>;
  tasks: KanbanTaskLite[];
}

export function buildColony({ company, rollup, revenueShare, approvals, agentsById, tasks }: BuildColonyInput): Colony {
  const safeName = (company.name || "").trim() || company.id || "Untitled company";
  const ticker = (company.ticker || safeName.replace(/[^a-z]/gi, "").slice(0, 4) || "ORG").toUpperCase();
  const agents = buildAgents(company, agentsById, rollup);
  const memberMeta = new Map((company.members ?? []).map((m) => [m.agentId, m] as const));

  const byId = new Map<string, string>();
  const names = new Set<string>();
  for (const a of agents) {
    if (a.id) byId.set(a.id, a.name);
    names.add(a.name);
  }

  const liveTasks = tasks.filter((t) => t.status !== "archived");
  const doneCount = liveTasks.filter((t) => t.status === "done").length;
  const totalCount = liveTasks.length;
  const hasWork = totalCount > 0;

  const alignment = company.alignment ?? (hasWork ? clamp(Math.round((doneCount / totalCount) * 100)) : 0);
  const status = deriveStatus(company, agents, approvals, alignment, hasWork);
  const burn = deriveBurn(company, rollup, agents);
  const capabilityCapital = deriveCapabilityCapital(company, rollup, liveTasks, agents);

  const unit = company.apexGoal?.unit;
  const apex = {
    title: company.apexGoal?.title || company.charter || `Scale ${safeName} autonomously`,
    metric: company.apexGoal?.metric || "shipped work",
    target: formatMetric(company.apexGoal?.target || (hasWork ? String(totalCount) : "—"), unit),
    current: formatMetric(company.apexGoal?.current || String(doneCount), unit),
    progress: company.apexGoal?.progress ?? alignment,
  };

  const workBlock = {
    name: company.apexGoal?.metric ? `Cycle · ${company.apexGoal.metric}` : "Current cycle",
    state: status === "setup" ? "ready" : doneCount < totalCount ? "active" : "ready",
    done: doneCount,
    total: Math.max(totalCount, doneCount),
    eta: hasWork ? (totalCount > doneCount ? `${totalCount - doneCount} left` : "ship") : "—",
  };

  const runtimeMix = [...new Set(agents.map((a) => a.runtime))].slice(0, 3);

  // An explicit company.revenue wins; otherwise a currency/users apex goal becomes
  // the headline metric so the card shows the money/DAU layout instead of the
  // plain ring layout used for number/percent goals.
  let revenue = company.revenue
    ? {
        kind: company.revenue.kind,
        label: company.revenue.label,
        value: company.revenue.value,
        target: company.revenue.target ?? null,
        mau: company.revenue.mau,
        pct: company.revenue.pct ?? null,
        delta: company.revenue.delta ?? null,
        up: company.revenue.up ?? true,
        isApex: company.revenue.isApex ?? false,
      }
    : undefined;
  if (!revenue && company.apexGoal && (unit === "currency" || unit === "users")) {
    revenue = {
      kind: unit === "users" ? "users" : "revenue",
      label: company.apexGoal.metric || (unit === "users" ? "DAU / MAU" : "revenue"),
      value: apex.current,
      target: company.apexGoal.target ? apex.target : null,
      mau: undefined,
      pct: company.apexGoal.progress ?? 0,
      delta: null,
      up: true,
      isApex: true,
    };
  }

  return {
    id: company.id,
    name: safeName,
    ticker,
    sector: company.sector || "Autonomous Org",
    status,
    founded: relativeTime(company.createdAtMs),
    runtimeMix,
    blurb: company.blurb || company.charter || "An agent-run company governed by a shared budget and kill switch.",
    alignment,
    apex,
    workBlock,
    burn,
    capabilityCapital,
    revenue,
    revenueShare,
    velocity: deriveVelocity(liveTasks),
    approvals: approvals.map((a) => mapApproval(a, company.dailyBudgetUsd)),
    agents,
    issues: mapIssues(liveTasks, ticker, byId, names),
    governance: deriveGovernance(company, approvals),
    activity: deriveActivity(liveTasks, byId, names),
    frozen: company.frozen,
    lastDispatchedAt: company.lastDispatchedAt,
    hasApexGoal: Boolean(company.apexGoal?.title?.trim()),
    autonomy: Boolean(company.autonomy),
    directives: company.directives,
    // Raw values for the edit form — the user's own input, not the derived
    // display fallbacks (`apex`, formatted target, etc.).
    edit: {
      name: safeName,
      ticker,
      sector: company.sector || "",
      charter: company.charter || "",
      blurb: company.blurb || "",
      projectId: company.projectId || "",
      analyticsProvider: company.analyticsProvider ?? "",
      analyticsProjectId: company.analyticsConfig?.projectId ?? "",
      analyticsHost: company.analyticsConfig?.host ?? "",
      dailyBudgetUsd: company.dailyBudgetUsd,
      monthlyBudgetUsd: company.monthlyBudgetUsd,
      totalBudgetUsd: company.totalBudgetUsd,
      status: company.status ?? "",
      alignment: company.alignment,
      apexTitle: company.apexGoal?.title || "",
      apexMetric: company.apexGoal?.metric || "",
      apexTarget: company.apexGoal?.target || "",
      apexCurrent: company.apexGoal?.current || "",
      apexProgress: company.apexGoal?.progress,
      metricUnit: (company.apexGoal?.unit as MetricUnit) || "number",
      frozen: company.frozen,
      revenueKind: company.revenue?.kind ?? "",
      revenueLabel: company.revenue?.label || "",
      revenueValue: company.revenue?.value || "",
      revenueTarget: company.revenue?.target || "",
      revenueMau: company.revenue?.mau || "",
      revenuePct: company.revenue?.pct ?? undefined,
      revenueDelta: company.revenue?.delta || "",
      revenueUp: company.revenue?.up ?? true,
      revenueIsApex: company.revenue?.isApex ?? false,
      members: agents
        .filter((agent) => agent.id)
        .map((agent) => {
          const saved = agent.id ? memberMeta.get(agent.id) : undefined;
          const state = saved?.state && (STATES as string[]).includes(saved.state) ? (saved.state as AgentState) : "";
          return {
            agentId: agent.id!,
            name: agent.name,
            role: agent.role,
            companyCap: saved?.companyCap ?? agent._cap,
            task: saved?.task || "",
            state,
            reportsTo: saved?.reportsTo ?? null,
            runtime: agent.runtime,
            model: agent.model,
          };
        }),
    } satisfies CompanyEditForm,
  };
}
