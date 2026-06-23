import type { LoopCapabilityCapital } from "@/lib/types/loops";

/**
 * A Company groups agents into an accountable business unit: a shared charter, a
 * collective budget rollup, and a single kill switch (`frozen`) that halts spend
 * across all member agents. The company owns its member list (`agentIds`), so an
 * agent's company is resolved by reverse lookup — membership lives in exactly one
 * place and is managed from the company itself.
 *
 * The Zero Human Companies view ("a company that runs itself") layers richer
 * presentation metadata on top: a ticker, sector, apex goal, and a per-member
 * org/budget map (`members`). All of it is OPTIONAL and additive — the
 * governance/spend stack only ever reads `agentIds`, the budget caps, and
 * `frozen`, so older records and other consumers keep working untouched.
 */

/** A company's lifecycle posture, surfaced as a status pill in the portfolio. */
export type CompanyStatus = "shipping" | "drift" | "review" | "setup" | "paused";

/** How an apex/metric value should be read and rendered. */
export type CompanyMetricUnit = "number" | "percent" | "currency" | "users";

/** The single strategic mandate every member agent aligns to. */
export interface CompanyApexGoal {
  title: string;
  /** What is being measured, e.g. "weekly active SDKs". */
  metric?: string;
  /** The goal value, e.g. "5,000". */
  target?: string;
  /** Where the metric stands today, e.g. "3,410". */
  current?: string;
  /** Progress toward target, 0–100. */
  progress?: number;
  /**
   * Whether the metric is a plain number, a percentage, a currency amount, or a
   * user count. Drives formatting ($ / %) and which company card layout shows:
   * currency/users get the headline "money/DAU" card, number/percent the ring card.
   */
  unit?: CompanyMetricUnit;
}

/** Optional headline business metric (MRR, DAU, cost saved, …). */
export interface CompanyRevenue {
  /** "users" renders a DAU/MAU headline; otherwise a currency headline. */
  kind?: "users" | "revenue";
  label: string;
  value: string;
  target?: string | null;
  mau?: string;
  /** Progress toward target (0–100) or null for no bar. */
  pct?: number | null;
  delta?: string | null;
  up?: boolean;
  /** When true this metric IS the apex goal (the card ring carries its progress). */
  isApex?: boolean;
}

/**
 * Per-agent company assignment: a company-specific daily budget cap, where the
 * agent sits in the org chart, and an optional human-set task/state caption.
 * `agentId` is the durable key; `agentIds` is kept in sync from this list.
 */
export interface CompanyMember {
  agentId: string;
  /** Company-specific daily USD budget for this agent (distinct from the agent's own wallet cap). */
  companyCap?: number;
  /** Role within this company (Queen/Engineer/Product/…). Free-form to match the UI's Role union. */
  roleInCompany?: string;
  /** Agent id this member reports to (null for the Queen/CEO). */
  reportsTo?: string | null;
  /** Human-authored current-work caption (no live telemetry source exists yet). */
  task?: string;
  /** Manually pinned activity state (working/reviewing/idle/…); derived when absent. */
  state?: string;
}

/**
 * How the crew runs the apex goal:
 * - "hierarchical" (default): Queen decomposes + fans tasks out to members in parallel.
 * - "sequential": members run in order, each consuming the prior step's output (CrewAI sequential).
 * - "graph": run a named agent flow (FlowSpec) with conditional edges + HITL checkpoints.
 */
export type CompanyProcess = "hierarchical" | "sequential" | "graph";

export interface Company {
  id: string;
  name: string;
  /** Member agent ids. Source of truth for company membership. */
  agentIds: string[];
  /** Founder-set direction; the "humans at the edges" charter. */
  charter?: string;
  /** Rolling 24h collective USD spend cap across member agents. 0/undefined = unlimited. */
  dailyBudgetUsd?: number;
  /** Rolling 30d collective USD spend cap across member agents. 0/undefined = unlimited. */
  monthlyBudgetUsd?: number;
  /** Lifetime collective USD spend cap. 0/undefined = unlimited. */
  totalBudgetUsd?: number;
  /** Kill switch: when true, every member agent's spend is blocked. */
  frozen: boolean;
  createdAt: string;
  createdAtMs: number;
  updatedAt: string;

  // ── Zero Human Companies presentation metadata (all optional/additive) ──
  /** Short uppercase symbol, e.g. "APRT". Derived from the name when absent. */
  ticker?: string;
  /** Industry / domain label, e.g. "Developer Tools". */
  sector?: string;
  /** One-line mission tagline (falls back to `charter`). */
  blurb?: string;
  /** Explicit status override; otherwise derived from frozen/members/approvals/alignment. */
  status?: CompanyStatus;
  /** 0–100 alignment to the apex goal; derived from work progress when absent. */
  alignment?: number;
  /** The strategic mandate every agent aligns to. */
  apexGoal?: CompanyApexGoal;
  /** Optional headline business metric. */
  revenue?: CompanyRevenue;
  /** Per-agent org/budget assignments; `agentIds` stays in sync with this. */
  members?: CompanyMember[];
  /** When the apex goal was last decomposed + dispatched to the crew (epoch ms). */
  lastDispatchedAt?: number;
  /**
   * Perpetual autonomy: when true, the company-autonomy driver keeps re-dispatching
   * the apex goal whenever the crew goes idle, until this is turned off or the
   * company is frozen. Set on "Launch", cleared on "Stop".
   */
  autonomy?: boolean;
  /** How the crew executes the apex goal. Defaults to "hierarchical" (parallel fan-out). */
  process?: CompanyProcess;
  /** For process: "graph" — the saved FlowSpec id to run. */
  flowTemplateId?: string;
}

export interface CompanySpendRollup {
  companyId: string;
  memberCount: number;
  dailySpentUsd: number;
  monthlySpentUsd: number;
  totalSpentUsd: number;
  dailyRemainingUsd: number | null;
  monthlyRemainingUsd: number | null;
  totalRemainingUsd: number | null;
  /** Per-agent company-scoped spend, keyed by agentId. Powers per-agent budget bars. */
  memberSpend?: Record<string, CompanyMemberSpend>;
}

export interface CompanyMemberSpend {
  dailyUsd: number;
  monthlyUsd: number;
  totalUsd: number;
}

/**
 * Derived "capability capital" readout for a zero-human company. This is not money;
 * it is the reusable private learning layer the company accumulates through
 * completed work, eval gates, experiments, durable artifacts, and model/runtime
 * diversity. It is intentionally computed from task/loop state so the company
 * can swap models without losing its veteran layer.
 */
export type CompanyCapabilityCapital = LoopCapabilityCapital;
