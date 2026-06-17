// Temporary Zero Human Companies walkthrough data.
// Flip USE_ZHC_DEMO_DATA in ZeroHumanCompaniesView.tsx back to false to restore
// the live companies / agents / approvals / Work Board data.
import type {
  Agent,
  AgentState,
  ApexGoal,
  Approval,
  Burn,
  Colony,
  CompanyEditForm,
  CompanyStatus,
  CreateForm,
  GovEvent,
  Issue,
  PoolAgent,
  Revenue,
  Role,
  TokenCapital,
  WorkBlock,
} from "./types";

export const DEMO_HERO_COLONY_ID = "zhc-demo-dropshipper-aio";

const nowish = () => Date.now();

function agentId(company: string, name: string): string {
  return `demo-${company}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function poolId(name: string): string {
  return `demo-pool-${name.toLowerCase()}`;
}

function agent(
  company: string,
  name: string,
  role: Role,
  runtime: string,
  model: string,
  state: AgentState,
  reportsTo: string | null,
  budgetPct: number,
  task: string,
  cap: number,
  walletCap?: number,
): Agent {
  return {
    id: agentId(company, name),
    name,
    role,
    runtime,
    model,
    walletCap,
    state,
    reportsTo,
    budgetPct,
    task,
    _cap: cap,
  };
}

function poolAgent(name: string, role: Role, runtime: string, model: string, walletCap: number): PoolAgent {
  return { id: poolId(name), name, role, runtime, model, walletCap };
}

export const DEMO_AGENT_POOL: PoolAgent[] = [
  poolAgent("Cobalt", "Engineer", "Claude Code", "Sonnet 4.5", 120),
  poolAgent("Indigo", "Engineer", "Codex", "GPT-5 Codex", 100),
  poolAgent("Forge", "Engineer", "MiroShark", "Custom 70B", 95),
  poolAgent("Sable", "Product", "Hermes", "Opus 4.1", 90),
  poolAgent("Quill", "Product", "Aeon", "Gemini 3 Pro", 85),
  poolAgent("Mica", "Designer", "Gemini", "Gemini 3 Pro", 70),
  poolAgent("Hue", "Designer", "Claude Code", "Sonnet 4.5", 65),
  poolAgent("Vert", "QA", "Codex", "GPT-5", 60),
  poolAgent("Patch", "DevOps", "Hermes", "Sonnet 4.5", 110),
  poolAgent("Onyx", "DevOps", "Codex", "GPT-5", 100),
  poolAgent("Ledger", "Auditor", "Claude Code", "Opus 4.1", 50),
  poolAgent("Scout", "Research", "Aeon", "Gemini 3 Pro", 80),
  poolAgent("Pitch", "Growth", "Hermes", "Sonnet 4.5", 75),
  poolAgent("Vault", "Treasury", "Hermes", "Opus 4.1", 130),
];

export const DEMO_CREATE_SEED_CREW: Agent[] = [
  {
    id: "demo-seed-regent",
    name: "Regent",
    role: "Queen",
    runtime: "Claude Code",
    model: "Opus 4.1",
    walletCap: 150,
    state: "ready",
    reportsTo: null,
    budgetPct: 0,
    task: "Drafting the first apex work block",
    _cap: 60,
  },
];

function tokenCapital(partial: Partial<TokenCapital>): TokenCapital {
  return {
    score: 78,
    learningAssets: 0,
    workflowAssets: 0,
    evalGates: 0,
    passedEvalGates: 0,
    experiments: 0,
    committedExperiments: 0,
    frontierCandidates: 0,
    antiPatterns: 0,
    distillationQueue: 0,
    learningVelocity: 0,
    spendEfficiency: null,
    modelIndependence: 70,
    notes: [],
    ...partial,
  };
}

function approval(id: string, title: string, agentName: string, kind: string, risk: Approval["risk"]): Approval {
  return { id, title, agent: agentName, kind, risk };
}

function gov(kind: GovEvent["kind"], text: string, agentName: string, since: string): GovEvent {
  return { kind, text, agent: agentName, since };
}

function issue(key: string, title: string, status: Issue["status"], agentName: string | null, pri: Issue["pri"], pts: number): Issue {
  return { key, title, status, agent: agentName, pri, pts };
}

function editFor(input: {
  name: string;
  ticker: string;
  sector: string;
  blurb: string;
  status: CompanyStatus;
  alignment: number;
  apex: ApexGoal;
  burn: Burn;
  revenue?: Revenue;
  agents: Agent[];
  frozen?: boolean;
}): CompanyEditForm {
  return {
    name: input.name,
    ticker: input.ticker,
    sector: input.sector,
    blurb: input.blurb,
    charter: input.apex.title,
    dailyBudgetUsd: input.burn.cap,
    monthlyBudgetUsd: input.burn.cap * 30,
    totalBudgetUsd: input.burn.cap * Math.max(1, input.burn.runway),
    status: input.status,
    alignment: input.alignment,
    apexTitle: input.apex.title,
    apexMetric: input.apex.metric,
    apexTarget: input.apex.target.replace(/^\$/, ""),
    apexCurrent: input.apex.current.replace(/^\$/, ""),
    apexProgress: input.apex.progress,
    metricUnit: input.apex.current.startsWith("$") || input.apex.target.startsWith("$") ? "currency" : "number",
    frozen: Boolean(input.frozen),
    revenueKind: input.revenue?.kind ?? "",
    revenueLabel: input.revenue?.label ?? "",
    revenueValue: input.revenue?.value ?? "",
    revenueTarget: input.revenue?.target ?? "",
    revenueMau: input.revenue?.mau ?? "",
    revenuePct: input.revenue?.pct ?? undefined,
    revenueDelta: input.revenue?.delta ?? "",
    revenueUp: input.revenue?.up ?? true,
    revenueIsApex: input.revenue?.isApex ?? false,
    members: input.agents
      .filter((member) => member.id)
      .map((member) => ({
        agentId: member.id!,
        name: member.name,
        role: member.role,
        companyCap: member._cap,
        task: member.task,
        state: member.state,
        reportsTo: member.reportsTo,
        runtime: member.runtime,
        model: member.model,
      })),
  };
}

function colony(input: Omit<Colony, "edit">): Colony {
  return {
    ...input,
    edit: editFor({
      name: input.name,
      ticker: input.ticker,
      sector: input.sector,
      blurb: input.blurb,
      status: input.status,
      alignment: input.alignment,
      apex: input.apex,
      burn: input.burn,
      revenue: input.revenue,
      agents: input.agents,
      frozen: input.frozen,
    }),
  };
}

const heroAgents = [
  agent("drop", "Regent", "Queen", "Claude Code", "Opus 4.1", "reviewing", null, 31, "Reviewing winning-product shortlist before ads scale-up", 60, 150),
  agent("drop", "Sable", "Product", "Hermes", "Opus 4.1", "working", "Regent", 58, "Curating 6 SKUs from 1,200 trending products", 45, 90),
  agent("drop", "Cobalt", "Engineer", "Claude Code", "Sonnet 4.5", "working", "Sable", 64, "Wiring Shopify <-> supplier fulfilment webhook", 60, 120),
  agent("drop", "Surge", "Growth", "Hermes", "Sonnet 4.5", "blocked", "Regent", 88, "Blocked - needs approval to scale ads to $42k/day", 40, 75),
  agent("drop", "Mica", "Designer", "Gemini", "Gemini 3 Pro", "working", "Sable", 41, "Generating 18 ad creatives for top-3 SKUs", 30, 70),
  agent("drop", "Vert", "QA", "Codex", "GPT-5", "working", "Regent", 36, "Test-ordering 12 products: ship times + refunds", 25, 60),
  agent("drop", "Vault", "Treasury", "Hermes", "Opus 4.1", "working", "Regent", 22, "Reconciling Stripe payouts vs supplier invoices", 45, 130),
  agent("drop", "Ledger", "Auditor", "Claude Code", "Opus 4.1", "working", "Regent", 9, "Auditing return rate by SKU - flagged 2 suppliers", 15, 50),
];

export const DEMO_HERO_COLONY: Colony = colony({
  id: DEMO_HERO_COLONY_ID,
  name: "Dropshipper AIO",
  ticker: "DROP",
  sector: "Autonomous Commerce",
  status: "shipping",
  founded: "just now",
  runtimeMix: ["Claude Code", "Hermes", "Codex"],
  blurb: "A fully autonomous commerce company compounding product research, ad tests, fulfilment, and supplier governance.",
  alignment: 91,
  apex: { title: "Reach $1M in monthly store revenue", metric: "30d revenue", current: "$684k", target: "$1M", progress: 68 },
  workBlock: { name: "Cycle - Q3 winning-product push", state: "active", done: 9, total: 15, eta: "5d" },
  burn: { today: 212, cap: 320, week: 1480, runway: 33 },
  tokenCapital: tokenCapital({
    score: 91,
    learningAssets: 1240,
    workflowAssets: 34,
    evalGates: 86,
    passedEvalGates: 73,
    experiments: 212,
    committedExperiments: 58,
    frontierCandidates: 24,
    antiPatterns: 19,
    distillationQueue: 11,
    learningVelocity: 39,
    spendEfficiency: 0.84,
    modelIndependence: 91,
    notes: [
      "1,240 artifacts from product research, fulfilment tests, creative variants, and supplier audits.",
      "86 eval gates keep SKU margin, delivery time, refund rate, and ad creative quality inside policy.",
      "19 failure modes are now reusable operating memory for the next launch cycle.",
    ],
  }),
  revenue: { kind: "revenue", label: "30d revenue", value: "$684k", target: "$1M", pct: 68, delta: "+22%", up: true, isApex: true },
  velocity: [3, 4, 2, 5, 4, 6, 5, 7, 6, 8, 8, 9, 7, 10],
  approvals: [
    approval("drop-ads-scale", "Scale ads to $42k/day", "Surge", "spend", "high"),
    approval("drop-shenzhen-contract", "12-mo Shenzhen supplier contract", "Vault", "contract", "med"),
  ],
  agents: heroAgents,
  issues: [
    issue("DROP-501", "Score 1,200 trending products by margin velocity", "done", "Sable", "high", 5),
    issue("DROP-502", "Decompose apex gap into product, ads, fulfilment, QA, and treasury lanes", "done", "Regent", "high", 3),
    issue("DROP-503", "Curate 6 SKUs from the winning-product shortlist", "in_progress", "Sable", "high", 5),
    issue("DROP-504", "Wire Shopify to supplier fulfilment webhook", "in_progress", "Cobalt", "urgent", 8),
    issue("DROP-505", "Generate 18 ad creatives for the top-3 SKUs", "in_progress", "Mica", "high", 3),
    issue("DROP-506", "Test-order 12 products for ship times, refunds, and packaging", "in_review", "Vert", "med", 5),
    issue("DROP-507", "Reconcile Stripe payouts vs supplier invoices", "in_review", "Vault", "med", 3),
    issue("DROP-508", "Approve $42k/day ad scale", "board_review", "Surge", "urgent", 2),
    issue("DROP-509", "Audit return-rate spike and quarantine 2 suppliers", "todo", "Ledger", "high", 3),
    issue("DROP-510", "Publish launch brief for the Q3 product push", "todo", "Regent", "med", 2),
  ],
  governance: [
    gov("escalate", "Surge escalated paid social spend beyond the automatic wallet cap for human approval.", "Surge", "11m"),
    gov("alert", "Ledger flagged 2 suppliers with abnormal return-rate clusters before the new contract is signed.", "Ledger", "24m"),
    gov("reflect", "Regent converted the product-research miss list into reusable SKU rejection rules.", "Regent", "1h"),
  ],
  activity: [
    "script 1/5 :: parse apex gap - $316k monthly revenue remaining",
    "script 2/5 :: rank constraints - CAC, delivery time, refund risk",
    "script 3/5 :: assign lanes - product, ads, fulfilment, QA, treasury",
    "script 4/5 :: attach eval gates - margin, creative CTR, supplier SLA",
    "script 5/5 :: dispatch work - 15 tasks / 5d ETA",
  ],
  lastDispatchedAt: nowish() - 42 * 60 * 1000,
  hasApexGoal: true,
  autonomy: true,
});

function compactColony(input: {
  id: string;
  name: string;
  ticker: string;
  sector: string;
  status: CompanyStatus;
  founded: string;
  alignment: number;
  apex: ApexGoal;
  workBlock: WorkBlock;
  burn: Burn;
  revenue?: Revenue;
  agents: Agent[];
  issues: Issue[];
  approvals?: Approval[];
  governance?: GovEvent[];
  activity?: string[];
  tokenCapital?: Partial<TokenCapital>;
}): Colony {
  return colony({
    ...input,
    runtimeMix: [...new Set(input.agents.map((member) => member.runtime))].slice(0, 3),
    blurb: `${input.sector} company operated by an autonomous agent crew.`,
    tokenCapital: tokenCapital(input.tokenCapital ?? {}),
    velocity: [1, 2, 2, 3, 2, 4, 3, 5, 4, 5, 6, 5, 6, 7],
    approvals: input.approvals ?? [],
    governance: input.governance ?? [],
    activity: input.activity ?? [],
    hasApexGoal: true,
    autonomy: input.status === "shipping",
  });
}

export const DEMO_PORTFOLIO_COLONIES: Colony[] = [
  compactColony({
    id: "zhc-demo-aperture-labs",
    name: "Aperture Labs",
    ticker: "APRT",
    sector: "Developer Tools",
    status: "shipping",
    founded: "41d",
    alignment: 92,
    apex: { title: "Become the default agent API layer", metric: "weekly active SDKs", current: "3,410", target: "5,000", progress: 68 },
    workBlock: { name: "Cycle - SDK activation sprint", state: "active", done: 11, total: 16, eta: "4d" },
    burn: { today: 184, cap: 260, week: 990, runway: 42 },
    revenue: { kind: "revenue", label: "MRR", value: "$48.2k", target: "$75k", pct: 64, delta: "+9%", up: true, isApex: false },
    agents: [
      agent("aprt", "Regent", "Queen", "Claude Code", "Opus 4.1", "reviewing", null, 26, "Reviewing SDK adoption plan", 45),
      agent("aprt", "Sable", "Product", "Hermes", "Opus 4.1", "working", "Regent", 54, "Prioritizing agent API onboarding gaps", 35),
      agent("aprt", "Cobalt", "Engineer", "Claude Code", "Sonnet 4.5", "working", "Regent", 66, "Shipping auth middleware examples", 45),
      agent("aprt", "Indigo", "Engineer", "Codex", "GPT-5 Codex", "blocked", "Cobalt", 82, "Blocked on partner sandbox credentials", 40),
      agent("aprt", "Mica", "Designer", "Hermes", "Opus 4.1", "working", "Sable", 38, "Refreshing quickstart docs", 25),
      agent("aprt", "Vert", "QA", "Codex", "GPT-5", "working", "Cobalt", 33, "Testing SDK install paths", 25),
      agent("aprt", "Patch", "DevOps", "Hermes", "Sonnet 4.5", "scheduled", "Regent", 12, "Load-testing release candidates tonight", 55),
      agent("aprt", "Ledger", "Auditor", "Claude Code", "Opus 4.1", "working", "Regent", 11, "Auditing usage-based billing events", 20),
    ],
    issues: [
      issue("APRT-221", "Ship SDK auth quickstart", "done", "Cobalt", "high", 5),
      issue("APRT-222", "Add streaming examples for JS and Python", "in_progress", "Indigo", "high", 8),
      issue("APRT-223", "Review weekly active SDK activation dropoffs", "in_review", "Sable", "med", 3),
      issue("APRT-224", "Approve partner sandbox access", "board_review", "Regent", "high", 2),
      issue("APRT-225", "Refresh pricing copy for teams", "todo", "Mica", "med", 2),
      issue("APRT-226", "Run release load test", "todo", "Patch", "med", 3),
    ],
    approvals: [approval("aprt-sandbox", "Partner sandbox credential approval for SDK QA", "Indigo", "access", "med")],
    governance: [gov("reflect", "Regent moved onboarding misses into the SDK release checklist.", "Regent", "2h")],
    tokenCapital: { score: 84, learningAssets: 212, workflowAssets: 18, evalGates: 29, passedEvalGates: 24, experiments: 41, antiPatterns: 6, learningVelocity: 12, modelIndependence: 88 },
  }),
  compactColony({
    id: "zhc-demo-nectar-markets",
    name: "Nectar Markets",
    ticker: "NCTR",
    sector: "Autonomous DeFi",
    status: "shipping",
    founded: "76d",
    alignment: 81,
    apex: { title: "Reach $250k monthly trading revenue", metric: "monthly trading revenue", current: "$214k", target: "$250k", progress: 86 },
    workBlock: { name: "Cycle - market-maker spread capture", state: "active", done: 13, total: 18, eta: "3d" },
    burn: { today: 338, cap: 410, week: 2100, runway: 18 },
    revenue: { kind: "revenue", label: "monthly trading revenue", value: "$214k", target: "$250k", pct: 86, delta: "+11%", up: true, isApex: true },
    agents: [
      agent("nctr", "Apiary", "Queen", "Hermes", "Opus 4.1", "reviewing", null, 44, "Reviewing market-risk envelope", 60),
      agent("nctr", "Quant", "Research", "MiroShark", "Custom 70B", "working", "Apiary", 67, "Backtesting spread strategies", 80),
      agent("nctr", "Forge", "Engineer", "Codex", "GPT-5 Codex", "working", "Apiary", 59, "Hardening execution router", 70),
      agent("nctr", "Vault", "Treasury", "Hermes", "Opus 4.1", "blocked", "Apiary", 91, "Blocked on rebalancing approval", 95),
      agent("nctr", "Sentry", "QA", "Codex", "GPT-5", "working", "Forge", 37, "Simulating liquidation edge cases", 45),
      agent("nctr", "Ledger", "Auditor", "Hermes", "Opus 4.1", "working", "Apiary", 18, "Auditing realized PnL by venue", 30),
    ],
    issues: [
      issue("NCTR-144", "Backtest volatility bands", "done", "Quant", "high", 5),
      issue("NCTR-145", "Ship exchange health monitor", "in_progress", "Forge", "high", 5),
      issue("NCTR-146", "Approve rebalancing window", "board_review", "Vault", "urgent", 2),
      issue("NCTR-147", "Simulate liquidation cascades", "in_review", "Sentry", "med", 3),
      issue("NCTR-148", "Audit PnL attribution", "todo", "Ledger", "med", 2),
    ],
    approvals: [approval("nctr-rebalance", "Rebalance strategy capital for spread capture", "Vault", "treasury", "high")],
    governance: [gov("escalate", "Vault escalated capital rotation after risk bands tightened.", "Vault", "33m")],
    tokenCapital: { score: 79, learningAssets: 366, workflowAssets: 21, evalGates: 44, passedEvalGates: 31, experiments: 83, antiPatterns: 12, learningVelocity: 15, modelIndependence: 82 },
  }),
  compactColony({
    id: "zhc-demo-pollen-studio",
    name: "Pollen Studio",
    ticker: "PLLN",
    sector: "Creative Agency",
    status: "drift",
    founded: "28d",
    alignment: 47,
    apex: { title: "Retain $40k MRR", metric: "MRR retained", current: "$6.1k", target: "$40k", progress: 15 },
    workBlock: { name: "Cycle - retention rescue", state: "active", done: 2, total: 13, eta: "9d" },
    burn: { today: 74, cap: 170, week: 410, runway: 27 },
    revenue: { kind: "revenue", label: "MRR retained", value: "$6.1k", target: "$40k", pct: 15, delta: "-18%", up: false, isApex: true },
    agents: [
      agent("plln", "Bloom", "Queen", "Claude Code", "Opus 4.1", "idle", null, 8, "Idle - awaiting revised client-retention plan", 40),
      agent("plln", "Petal", "Designer", "Gemini", "Gemini 3 Pro", "working", "Bloom", 36, "Drafting client creative refreshes", 35),
      agent("plln", "Hue", "Designer", "Claude Code", "Sonnet 4.5", "working", "Bloom", 42, "Generating campaign variants", 35),
      agent("plln", "Pitch", "Growth", "Hermes", "Sonnet 4.5", "idle", "Bloom", 17, "Idle - waiting on target accounts", 35),
      agent("plln", "Proof", "QA", "Gemini", "Gemini 3 Pro", "working", "Bloom", 21, "Checking creative against brand rules", 25),
    ],
    issues: [
      issue("PLLN-072", "Identify churned accounts by offer type", "in_review", "Bloom", "high", 3),
      issue("PLLN-073", "Generate retention creative refreshes", "in_progress", "Petal", "high", 5),
      issue("PLLN-074", "Rewrite pitch sequence for dormant clients", "todo", "Pitch", "high", 3),
      issue("PLLN-075", "Audit brand-rule violations", "todo", "Proof", "med", 2),
    ],
    governance: [gov("alert", "Alignment drift crossed the intervention threshold; growth work is no longer tied tightly to retention.", "Bloom", "4h")],
    tokenCapital: { score: 31, learningAssets: 48, workflowAssets: 7, evalGates: 12, passedEvalGates: 5, experiments: 19, antiPatterns: 14, learningVelocity: 2, modelIndependence: 64 },
  }),
  compactColony({
    id: "zhc-demo-hivemind-press",
    name: "Hivemind Press",
    ticker: "PRSS",
    sector: "Autonomous Media",
    status: "review",
    founded: "53d",
    alignment: 74,
    apex: { title: "Reach 50k daily brief readers", metric: "daily brief readers", current: "31.2k", target: "50k", progress: 62 },
    workBlock: { name: "Cycle - morning brief expansion", state: "active", done: 7, total: 12, eta: "4d" },
    burn: { today: 96, cap: 190, week: 610, runway: 30 },
    revenue: { kind: "users", label: "DAU / MAU", value: "31.2k", target: "50k", mau: "104k", pct: 62, delta: "+7%", up: true, isApex: true },
    agents: [
      agent("prss", "Editor", "Queen", "Hermes", "Opus 4.1", "reviewing", null, 35, "Reviewing editorial policy escalation", 45),
      agent("prss", "Scout", "Research", "Aeon", "Gemini 3 Pro", "working", "Editor", 52, "Scanning source clusters for tomorrow's brief", 45),
      agent("prss", "Scribe", "Product", "Hermes", "Opus 4.1", "working", "Editor", 46, "Packaging personalized brief sections", 40),
      agent("prss", "Fact", "QA", "Gemini", "Gemini 3 Pro", "working", "Editor", 41, "Verifying citations before publish", 35),
      agent("prss", "Ledger", "Auditor", "Hermes", "Opus 4.1", "working", "Editor", 12, "Auditing source diversity", 25),
    ],
    issues: [
      issue("PRSS-118", "Ship personalized brief sections", "in_progress", "Scribe", "high", 5),
      issue("PRSS-119", "Review source-policy escalation", "board_review", "Editor", "high", 2),
      issue("PRSS-120", "Verify citations for partner feeds", "in_review", "Fact", "med", 3),
      issue("PRSS-121", "Expand source clusters", "done", "Scout", "med", 3),
      issue("PRSS-122", "Audit source diversity by topic", "todo", "Ledger", "low", 2),
    ],
    approvals: [approval("prss-policy", "Approve source-policy expansion for automated briefs", "Editor", "policy", "med")],
    governance: [gov("escalate", "Editor moved source expansion into board review before scaling distribution.", "Editor", "1h")],
    tokenCapital: { score: 68, learningAssets: 157, workflowAssets: 16, evalGates: 31, passedEvalGates: 24, experiments: 54, antiPatterns: 8, learningVelocity: 8, modelIndependence: 76 },
  }),
  compactColony({
    id: "zhc-demo-drone-logistics",
    name: "Drone Logistics",
    ticker: "DRON",
    sector: "Ops Automation",
    status: "shipping",
    founded: "19d",
    alignment: 88,
    apex: { title: "Reach zero manual ops touches/week", metric: "manual ops touches/week", current: "4", target: "0", progress: 84 },
    workBlock: { name: "Cycle - dispatch automation hardening", state: "active", done: 8, total: 10, eta: "2d" },
    burn: { today: 59, cap: 120, week: 330, runway: 58 },
    revenue: { kind: "revenue", label: "cost saved", value: "$31k/mo", target: null, pct: null, delta: "+24%", up: true, isApex: false },
    agents: [
      agent("dron", "Foreman", "Queen", "Hermes", "Opus 4.1", "reviewing", null, 28, "Reviewing exception-routing policy", 35),
      agent("dron", "Router", "Engineer", "Codex", "GPT-5", "working", "Foreman", 49, "Optimizing dispatch route planner", 45),
      agent("dron", "Tally", "DevOps", "Aeon", "Gemini 3 Pro", "scheduled", "Foreman", 18, "Scheduled overnight warehouse sync", 25),
      agent("dron", "Ledger", "Auditor", "Hermes", "Opus 4.1", "working", "Foreman", 11, "Auditing manual-touch exceptions", 15),
    ],
    issues: [
      issue("DRON-089", "Automate warehouse exception routing", "done", "Router", "high", 5),
      issue("DRON-090", "Schedule overnight dispatch sync", "todo", "Tally", "med", 3),
      issue("DRON-091", "Audit remaining manual touches", "in_review", "Ledger", "med", 2),
      issue("DRON-092", "Tune route planner for weather holds", "in_progress", "Router", "high", 5),
    ],
    governance: [gov("patch", "Foreman narrowed exception routing so only four manual ops touches remain this week.", "Foreman", "49m")],
    tokenCapital: { score: 74, learningAssets: 128, workflowAssets: 12, evalGates: 23, passedEvalGates: 19, experiments: 37, antiPatterns: 5, learningVelocity: 10, modelIndependence: 78 },
  }),
];

export const DEMO_COLONIES: Colony[] = [DEMO_HERO_COLONY, ...DEMO_PORTFOLIO_COLONIES];

function nextTicker(name: string): string {
  return (name.replace(/[^a-z]/gi, "").slice(0, 4) || "NEWC").toUpperCase();
}

export function createDemoColony(form: CreateForm, crew: Agent[]): Colony {
  const safeName = form.name.trim() || "New Company";
  const ticker = (form.ticker || nextTicker(safeName)).toUpperCase();
  const id = `zhc-demo-${ticker.toLowerCase()}-${Math.round(nowish())}`;
  const queenName = crew.find((member) => member.role === "Queen")?.name ?? crew[0]?.name ?? null;
  const agents = crew.map((member, index) => ({
    ...member,
    id: member.id ?? agentId(ticker.toLowerCase(), member.name),
    role: index === 0 ? "Queen" as Role : member.role,
    reportsTo: index === 0 ? null : member.reportsTo ?? queenName,
    state: member.state === "ready" ? "setup" as AgentState : member.state,
  }));
  const cap = agents.reduce((total, member) => total + (member._cap ?? 0), 0);
  return colony({
    id,
    name: safeName,
    ticker,
    sector: form.sector || "Autonomous Org",
    status: "setup",
    founded: "just now",
    runtimeMix: [...new Set(agents.map((member) => member.runtime))].slice(0, 3),
    blurb: "Newly founded zero-human company waiting for its first autonomous work cycle.",
    alignment: 0,
    apex: {
      title: form.apexTitle || `Scale ${safeName} autonomously`,
      metric: form.apexMetric || "shipped work",
      current: "0",
      target: form.apexTarget || "1",
      progress: 0,
    },
    workBlock: { name: "Current cycle", state: "ready", done: 0, total: 0, eta: "-" },
    burn: { today: 0, cap, week: 0, runway: 99 },
    tokenCapital: tokenCapital({
      notes: [
        "Launch autonomy to attach private eval loops to new work.",
        "No private eval gates have been recorded yet.",
        "Completed work will become reusable company memory after review.",
      ],
    }),
    velocity: new Array(14).fill(0),
    approvals: [],
    agents,
    issues: [],
    governance: [],
    activity: [],
    hasApexGoal: Boolean(form.apexTitle?.trim()),
    autonomy: false,
  });
}

export function applyDemoEdit(colonyValue: Colony, form: CompanyEditForm): Colony {
  const members = form.members ?? [];
  const memberNames = new Map(members.map((member) => [member.agentId, member.name || member.agentId]));
  const agents = members.map((member) => {
    const previous = colonyValue.agents.find((agentValue) => agentValue.id === member.agentId);
    const isQueen = member.role === "Queen";
    return {
      id: member.agentId,
      name: member.name || previous?.name || member.agentId,
      role: member.role,
      runtime: member.runtime || previous?.runtime || "Agent",
      model: member.model || previous?.model,
      walletCap: previous?.walletCap,
      state: member.state || previous?.state || "ready",
      reportsTo: isQueen ? null : (member.reportsTo ? memberNames.get(member.reportsTo) ?? member.reportsTo : previous?.reportsTo ?? null),
      budgetPct: previous?.budgetPct ?? 0,
      task: member.task || previous?.task || "Idle - awaiting work block",
      _cap: member.companyCap ?? previous?._cap,
    } satisfies Agent;
  });
  const burn = {
    ...colonyValue.burn,
    cap: form.dailyBudgetUsd ?? colonyValue.burn.cap,
  };
  const apex = {
    title: form.apexTitle || colonyValue.apex.title,
    metric: form.apexMetric || colonyValue.apex.metric,
    current: form.apexCurrent || colonyValue.apex.current,
    target: form.apexTarget || colonyValue.apex.target,
    progress: form.apexProgress ?? colonyValue.apex.progress,
  };
  const revenue: Revenue | undefined = form.revenueKind
    ? {
        kind: form.revenueKind || undefined,
        label: form.revenueLabel || colonyValue.revenue?.label || "",
        value: form.revenueValue || colonyValue.revenue?.value || "",
        target: form.revenueTarget || null,
        mau: form.revenueMau || undefined,
        pct: form.revenuePct ?? null,
        delta: form.revenueDelta || null,
        up: form.revenueUp !== false,
        isApex: form.revenueIsApex === true,
      }
    : undefined;

  return colony({
    ...colonyValue,
    name: form.name || colonyValue.name,
    ticker: (form.ticker || colonyValue.ticker).toUpperCase(),
    sector: form.sector || colonyValue.sector,
    blurb: form.blurb || colonyValue.blurb,
    status: form.status || colonyValue.status,
    alignment: form.alignment ?? colonyValue.alignment,
    apex,
    burn,
    revenue,
    agents,
    runtimeMix: [...new Set(agents.map((member) => member.runtime))].slice(0, 3),
    frozen: form.frozen,
  });
}
