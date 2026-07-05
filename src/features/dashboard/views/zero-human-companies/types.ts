// Zero Human Companies — shared types.
// Ported from the nextjs-companies prototype; `id` fields added on Agent /
// PoolAgent so the live view can persist real agent membership.
import type { CompanyRevenueEventSource, CompanyRevenueRollup } from "@/lib/types/company-revenue";
import type { AnalyticsProviderKey } from "@/lib/services/company-analytics/types";
import type { CompanyDirective } from "@/lib/types/company";

export type AgentState =
  | "working" | "reviewing" | "scheduled" | "ready" | "idle" | "blocked" | "setup";

export type Role =
  | "Queen" | "Engineer" | "Product" | "Designer" | "QA"
  | "DevOps" | "Auditor" | "Growth" | "Research" | "Treasury";

export type CompanyStatus = "shipping" | "drift" | "review" | "setup" | "paused";
export type IssueStatus = "todo" | "in_progress" | "in_review" | "board_review" | "done";
export type Priority = "urgent" | "high" | "med" | "low";
export type Risk = "high" | "med" | "low";

export type CardStyle = "detailed" | "minimal";
export type Density = "comfortable" | "compact";
export type Theme = "dark" | "light";

export interface Agent {
  /** Durable agent id (used to persist company membership). */
  id?: string;
  name: string;
  role: Role;
  runtime: string;
  model?: string;
  walletCap?: number;
  state: AgentState;
  reportsTo: string | null;
  budgetPct: number;
  task: string;
  /** company-specific daily budget cap (USDC) */
  _cap?: number;
}

export interface ApexGoal {
  title: string;
  metric: string;
  target: string;
  current: string;
  progress: number;
}

export interface WorkBlock {
  name: string;
  state: string;
  done: number;
  total: number;
  eta: string;
}

export interface Burn {
  today: number;
  cap: number;
  week: number;
  runway: number;
}

export interface CapabilityCapital {
  score: number;
  learningAssets: number;
  workflowAssets: number;
  evalGates: number;
  passedEvalGates: number;
  experiments: number;
  committedExperiments: number;
  frontierCandidates: number;
  antiPatterns: number;
  distillationQueue: number;
  learningVelocity: number;
  spendEfficiency: number | null;
  modelIndependence: number;
  notes: string[];
}

export interface Revenue {
  /** "users" renders DAU/MAU; otherwise a currency headline */
  kind?: "users" | "revenue";
  label: string;
  value: string;
  target: string | null;
  mau?: string;
  /** progress toward target (0–100) or null for no bar/ring */
  pct: number | null;
  delta: string | null;
  up: boolean;
  /** true when this metric IS the apex goal (ring carries its progress) */
  isApex: boolean;
}

export interface Approval {
  id: string;
  title: string;
  agent: string;
  kind: string;
  risk: Risk;
}

export interface GovEvent {
  kind: "patch" | "reflect" | "escalate" | "alert";
  text: string;
  agent: string;
  since: string;
}

/** A durable output attached to a piece of company work (file, doc, or link). */
export interface IssueDeliverable {
  id: string;
  label: string;
  kind: string;
  path?: string;
  url?: string;
}

/** A verification receipt recorded against the work's eval gates. */
export interface IssueReceipt {
  title: string;
  status: "passed" | "failed" | "skipped";
  /** The concrete commands/probes and their results behind this receipt — the
   * proof the human can expand under a failed gate instead of taking it on faith. */
  evidence?: string[];
}

/**
 * The real Work Board record behind a board card — what the agent actually
 * produced. Present only for live data (demo issues have no backing task);
 * cards with `work` open the task-detail modal.
 */
export interface IssueWork {
  taskId: string;
  status: string;
  body?: string;
  result?: string;
  deliverables: IssueDeliverable[];
  receipts: IssueReceipt[];
  /** Name of the machine that produced the work (for deliverable provenance). */
  machineName?: string;
  updatedAt?: number;
  completedAt?: number;
}

export interface Issue {
  key: string;
  title: string;
  status: IssueStatus;
  agent: string | null;
  pri: Priority;
  pts: number;
  /** Live-data link to the underlying Work Board task and its outputs. */
  work?: IssueWork;
}

export interface Colony {
  id: string;
  name: string;
  ticker: string;
  sector: string;
  status: CompanyStatus;
  founded: string;
  runtimeMix: string[];
  blurb: string;
  alignment: number;
  apex: ApexGoal;
  workBlock: WorkBlock;
  burn: Burn;
  capabilityCapital: CapabilityCapital;
  revenue?: Revenue;
  revenueShare?: CompanyRevenueRollup;
  velocity: number[];
  approvals: Approval[];
  agents: Agent[];
  issues: Issue[];
  governance: GovEvent[];
  activity: string[];
  /** True when this company is the kill-switched (frozen) — drives Treasury controls. */
  frozen?: boolean;
  /** When the apex goal was last dispatched to the crew (epoch ms). */
  lastDispatchedAt?: number;
  /** True only when an explicit apex goal is set (not the derived fallback) — gates dispatch. */
  hasApexGoal?: boolean;
  /** True when perpetual autonomy is on — the driver keeps re-dispatching until stopped/frozen. */
  autonomy?: boolean;
  /** Standing directives injected by a human or captured from rejecting a deliverable. */
  directives?: CompanyDirective[];
  /**
   * Raw, unformatted company values used to seed the edit form. Distinct from
   * display fields above (`apex`, `ticker`, …), which carry derived fallbacks
   * and `$`/`%` formatting — this is what the user actually set.
   */
  edit: CompanyEditForm;
}

export interface CompanyRevenueShareInput {
  amountUsd: number;
  source: CompanyRevenueEventSource;
  collectFee: boolean;
  collectingAgentId?: string;
}

/** A fully-configured agent from the org roster, available to assign. */
export interface PoolAgent {
  /** Durable agent id. */
  id: string;
  name: string;
  role: Role;
  runtime: string;
  model: string;
  walletCap: number;
}

/** How an apex metric is read/rendered (plain number, %, currency, or users). */
export type MetricUnit = "number" | "percent" | "currency" | "users";

export interface CreateForm {
  name: string;
  ticker?: string;
  sector?: string;
  apexTitle?: string;
  apexMetric?: string;
  apexTarget?: string;
  metricUnit?: MetricUnit;
}

export interface CompanyMemberEdit {
  agentId: string;
  name: string;
  role: Role;
  companyCap?: number;
  task?: string;
  state?: AgentState | "";
  reportsTo?: string | null;
  runtime?: string;
  model?: string;
}

export interface CompanyEditForm extends CreateForm {
  charter?: string;
  blurb?: string;
  /** Project-registry id of the company's domain code repo ("" = unlinked). */
  projectId?: string;
  /** Analytics provider link ("" = not configured; guided setup shown in the tab). */
  analyticsProvider?: AnalyticsProviderKey | "";
  /** Provider project/site id (PostHog project id, Plausible domain, GA4 property). */
  analyticsProjectId?: string;
  /** Optional self-hosted analytics base URL. */
  analyticsHost?: string;
  dailyBudgetUsd?: number;
  monthlyBudgetUsd?: number;
  totalBudgetUsd?: number;
  status?: CompanyStatus | "";
  alignment?: number;
  apexCurrent?: string;
  apexProgress?: number;
  frozen?: boolean;
  revenueKind?: "users" | "revenue" | "";
  revenueLabel?: string;
  revenueValue?: string;
  revenueTarget?: string;
  revenueMau?: string;
  revenuePct?: number;
  revenueDelta?: string;
  revenueUp?: boolean;
  revenueIsApex?: boolean;
  members?: CompanyMemberEdit[];
}
