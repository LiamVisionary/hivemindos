import type { LoopCapabilityCapital } from "@/lib/types/loops";
import type { AnalyticsProviderKey, CompanyAnalyticsConfig } from "@/lib/services/company-analytics/types";
import type { KanbanDeliverableKind, KanbanTaskAttachment } from "@/lib/types/kanban";
import type { CompanyImportedOperations } from "@/lib/types/company-import";

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

/** What counts toward the autonomy-pause threshold (items "waiting on a human"). */
export type CompanyAutonomyPauseMode = "all" | "deliverable-kinds";

/**
 * Approval backpressure: auto-pause the company's autonomy driver from planning
 * NEW work once too many items are already waiting on a human. In-flight work
 * still finishes; the driver resumes on its own once the count drops back below
 * the threshold — no button, no permanent Stop. Absent/`maxWaitingOnHuman <= 0`
 * means never auto-pause (today's behavior).
 */
export interface CompanyAutonomyPause {
  /** Pause new-work dispatch once this many items are waiting on a human. 0/undefined = disabled. */
  maxWaitingOnHuman?: number;
  /**
   * What counts toward the threshold. "all" (default) = every task of this company
   * sitting in the needs-human lane. "deliverable-kinds" = only needs-human tasks
   * carrying a deliverable whose kind is in `deliverableKinds` (e.g. just websites).
   */
  countMode?: CompanyAutonomyPauseMode;
  /** When countMode is "deliverable-kinds", only these deliverable kinds count. Empty = falls back to counting all. */
  deliverableKinds?: KanbanDeliverableKind[];
}

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

/**
 * One sellable product/package in a company's catalog. Field names deliberately
 * match the self-serve offer funnel's `packages[]` shape ({key, name, amountUsd,
 * description, recommended}) so agents can drop catalog entries straight into
 * client offers without remapping.
 */
export interface CompanyProduct {
  /** Stable slug key, e.g. "starter-launch". */
  key: string;
  name: string;
  /** Price in USD. */
  amountUsd: number;
  description?: string;
  /** Highlighted as the default pick in offers and the UI. */
  recommended?: boolean;
  /** Billing cadence. Absent/"one-time" = a one-off sale; "month"/"year" = recurring. */
  interval?: "one-time" | "month" | "year";
  /** "package" (core offer, default) or "addon" (optional extra, e.g. a care plan). */
  kind?: "package" | "addon";
}

/**
 * The company's official product catalog — the single source of truth for what
 * the company sells and at what price. It lives in the replicated definitions
 * file (Operations/Companies/companies.json in the shared vault), so every
 * machine and every dispatched agent reads the same prices, and UI edits
 * propagate fleet-wide. Companies that sell no fixed products simply have no
 * catalog (the Products tab stays hidden).
 */
export interface CompanyProductCatalog {
  items: CompanyProduct[];
  /** Where the initial catalog came from: "ui", "repo:<file>", or "shared-brain". */
  seededFrom?: string;
  updatedAt?: string;
}

/**
 * A concrete price-change request raised by the crew when the evidence they
 * gather (reply objections, quote-vs-close rates, abandoned checkouts) points
 * at pricing as the conversion blocker. Pending proposals live on the company
 * definition (replicated + governance-tracked) and surface under the Approvals
 * tab; approving applies the change to the catalog, and either outcome lands in
 * company memory so the crew learns the decision instead of re-proposing it.
 */
export interface CompanyPricingProposal {
  id: string;
  /** Catalog product this targets (CompanyProduct.key). */
  productKey: string;
  /** Product name snapshot at proposal time (display survives later renames). */
  productName: string;
  currentAmountUsd: number;
  proposedAmountUsd: number;
  /** The concrete evidence the crew cited. */
  why?: string;
  /** Work Board task whose result raised this. */
  sourceTaskId?: string;
  /** Agent that raised it. */
  proposedBy?: string;
  createdAt: string;
}

/** Human-governed company action policy: off, ask first, or never allow. */
export type CompanyApprovalPolicyMode = "off" | "ask" | "never";

export type CompanyApprovalPolicySource = "default" | "learning" | "manual";

export interface CompanyApprovalPolicy {
  /** Stable policy key. Built-ins use fixed ids; learned subjects use a subject slug. */
  id: string;
  /** Gerund/action phrase, e.g. "sending customer-facing emails". */
  subject: string;
  mode: CompanyApprovalPolicyMode;
  /** Where this row came from. Explicit saves may preserve default/learning provenance. */
  source?: CompanyApprovalPolicySource;
  /** For policies inferred from a standing directive, the source directive id. */
  directiveId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A standing directive / knowledge entry injected into a company by a human
 * (Learning tab) or captured from rejecting a deliverable. Directives are
 * appended to the standing context on EVERY dispatched task
 * (companyWorkerContext), so the crew is redirected without editing the charter.
 */
export interface CompanyDirective {
  id: string;
  /** The instruction / knowledge / redirect, in the human's words. */
  text: string;
  /** Optional legacy first shared-brain skill slug the crew should read/use for this. */
  skill?: string;
  /** Shared-brain skill slugs the crew should read/use for this. */
  skills?: string[];
  /** Reference attachments (reuses the task/chat attachment model). */
  attachments?: KanbanTaskAttachment[];
  /** How it was created: a Learning-tab injection, or feedback from a rejected deliverable. */
  source: "inject" | "reject";
  /** When source === "reject": the deliverable key/title being redirected. */
  deliverableRef?: string;
  createdAt: string;
}

/** One Google-Cloud per-day quota override to push to Service Usage. */
export interface GcpApiDailyCap {
  /** Fully-qualified quota metric, e.g. "places.googleapis.com/SearchTextRequest". */
  metric: string;
  /** Cap value for the unit window. */
  value: number;
  /** Quota unit, e.g. "1/d/{project}". */
  unit: string;
  /** Optional per-call cost + free tier for month-cost estimation (mirrors the meter config). */
  skuUnitCostUsd?: number;
  freeMonthlyCalls?: number;
}

/**
 * A per-company, per-API cost guardrail applied directly to a cloud provider
 * (per-day quota caps + a monthly billing budget). Config only — the SA key that
 * actually applies it lives in server-only hive env, never here.
 */
export interface CompanyApiBudget {
  /** Provider discriminant; only "gcp" for now. */
  provider: "gcp";
  /** e.g. "places.googleapis.com". */
  service: string;
  projectId: string;
  projectNumber: string;
  billingAccount: string;
  /** Monthly billing-budget ceiling in USD. */
  monthlyCeilingUsd: number;
  dailyCaps: GcpApiDailyCap[];
  /** Provider-side apply status — set by the server, never trusted from the client. */
  appliedAt?: string;
  appliedError?: string;
  /** Cloud budget resource name once created, so re-applies update in place. */
  budgetResourceName?: string;
}

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
  /**
   * Approval backpressure: auto-pause new-work dispatch when too many items are
   * already waiting on a human, so the Needs You lane can't silently pile up to
   * hundreds. Reversible and self-resuming — see {@link CompanyAutonomyPause}.
   */
  autonomyPause?: CompanyAutonomyPause;
  /** How the crew executes the apex goal. Defaults to "hierarchical" (parallel fan-out). */
  process?: CompanyProcess;
  /** For process: "graph" — the saved FlowSpec id to run. */
  flowTemplateId?: string;
  /**
   * Which machine's autonomy driver owns this company's auto-dispatch. Company
   * definitions replicate fleet-wide through the shared vault, so without this
   * gate every machine running the app would dispatch every company. Matched
   * loosely (normalizeMachineName) against the local hostname; unset means
   * unclaimed — no driver auto-dispatches until a manual Launch claims it.
   */
  homeMachineKey?: string;
  /**
   * Project-registry id of the company's domain code repo (e.g. maps-agency).
   * Dispatched Work Board tasks carry it, so Queen Bee routes code work to
   * machines with the right checkout and tasks pick up the project's GitLawb
   * proof badge.
   */
  projectId?: string;
  /**
   * Official product catalog (what the company sells, at what price). Replicates
   * with the definitions through the shared vault; agents quote these prices via
   * the standing worker context. Absent = the company sells no fixed products.
   */
  products?: CompanyProductCatalog;
  /** Pending crew-raised price-change requests (resolved ones are removed; outcomes live in company memory). */
  pricingProposals?: CompanyPricingProposal[];
  /** Human approval policy for company actions such as sends, publishing, and learned permission subjects. */
  approvalPolicies?: CompanyApprovalPolicy[];
  /** Which analytics provider this company's numbers come from. Unset = not configured (guided setup shown). */
  analyticsProvider?: AnalyticsProviderKey;
  /** Per-company analytics link (project/site id + optional self-host). Credentials live in shared hive env, not here. */
  analyticsConfig?: CompanyAnalyticsConfig;
  /** Imported legacy project wiring: repo, GitHub Actions, cron jobs, hosting services, and scripts discovered from source. */
  importedOperations?: CompanyImportedOperations;
  /**
   * Standing directives injected by a human (Learning tab) or captured from a
   * rejected deliverable. Appended to every dispatched task's context so the
   * crew follows them without a charter edit. Newest last.
   */
  directives?: CompanyDirective[];
  /**
   * Per-API cloud cost guardrails (per-day quota caps + a monthly billing budget),
   * applied server-side to the provider. Written only by the dedicated apply route,
   * not the generic upsert, so a treasury save can't blank it.
   */
  apiBudgets?: CompanyApiBudget[];
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
  /** Rolling-24h spend recorded under the "api" kind (paid cloud APIs). */
  apiSpentUsd: number;
  /** Rolling-30d spend recorded under the "api" kind. */
  apiMonthlySpentUsd: number;
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
