import type { ContextIndexItem } from "@/lib/services/context-index";
import type { ModelFitRecommendation } from "@/lib/services/system/model-fit";
import type {
  FounderAgentCandidate,
  FounderBlueprint,
  FounderBudgetTier,
  FounderCapability,
  FounderConstraints,
  FounderCrewRole,
  FounderPrivacyMode,
} from "@/lib/types/founder-blueprint";

type FounderArchetype = {
  id: string;
  priority: number;
  sector: string;
  match: RegExp;
  roles: Array<{ role: string; responsibility: string; workerClasses: string[] }>;
  capabilityIntents: string[];
  deliverables: string[];
  hypotheses: string[];
};

export const FOUNDER_ARCHETYPE_MATRIX: readonly FounderArchetype[] = [
  {
    id: "product-company",
    priority: 70,
    sector: "Software & Digital Products",
    match: /\b(app|api|saas|software|developer|website|platform|product|tool|extension)\b/i,
    roles: [
      { role: "Queen", responsibility: "Own the goal, sequence work, and enforce evidence gates.", workerClasses: ["planner", "general"] },
      { role: "Engineer", responsibility: "Build and integrate the product in an isolated workspace.", workerClasses: ["code"] },
      { role: "QA", responsibility: "Verify functionality, regressions, and the done contract.", workerClasses: ["qa", "code"] },
      { role: "Growth", responsibility: "Package the offer and test distribution channels.", workerClasses: ["writer", "research"] },
    ],
    capabilityIntents: ["software delivery", "repository work", "testing", "deployment", "analytics"],
    deliverables: ["A working product increment", "Verification receipts", "A user-facing preview", "A measured next experiment"],
    hypotheses: ["A narrower first use case will reach a verified outcome faster.", "A working preview will produce better feedback than a longer plan."],
  },
  {
    id: "service-company",
    priority: 100,
    sector: "Professional Services",
    match: /\b(agency|service|client|consult|lead|outreach|sales|businesses|customers)\b/i,
    roles: [
      { role: "Queen", responsibility: "Own the offer, pipeline, and approval boundaries.", workerClasses: ["planner", "general"] },
      { role: "Research", responsibility: "Find and qualify real prospects with evidence.", workerClasses: ["research"] },
      { role: "Growth", responsibility: "Draft offers, outreach, and conversion experiments.", workerClasses: ["writer", "research"] },
      { role: "Engineer", responsibility: "Produce previews and delivery assets.", workerClasses: ["code", "artist"] },
      { role: "QA", responsibility: "Check customer-facing claims and deliverables before release.", workerClasses: ["qa"] },
    ],
    capabilityIntents: ["market research", "outreach", "email", "content creation", "customer previews", "analytics"],
    deliverables: ["A qualified prospect set", "A reviewable customer preview", "An approval-ready outreach batch", "A conversion baseline"],
    hypotheses: ["A concrete preview will outperform a generic pitch.", "A tightly qualified first segment will improve reply quality."],
  },
  {
    id: "content-company",
    priority: 90,
    sector: "Media & Content",
    match: /\b(content|video|podcast|newsletter|social|creator|media|channel|audience|post)\b/i,
    roles: [
      { role: "Queen", responsibility: "Own the editorial goal and publishing approvals.", workerClasses: ["planner", "general"] },
      { role: "Research", responsibility: "Find source material and audience signals.", workerClasses: ["research"] },
      { role: "Designer", responsibility: "Create the content package and visual assets.", workerClasses: ["writer", "artist", "vision"] },
      { role: "QA", responsibility: "Check originality, accuracy, and publishing readiness.", workerClasses: ["qa", "writer"] },
    ],
    capabilityIntents: ["research", "writing", "image generation", "video production", "publishing", "analytics"],
    deliverables: ["A finished content package", "Source and originality evidence", "A publishing approval packet", "An audience-response experiment"],
    hypotheses: ["A repeatable format will improve production speed without lowering quality.", "Audience-specific hooks will outperform broad summaries."],
  },
  {
    id: "research-company",
    priority: 80,
    sector: "Research & Intelligence",
    match: /\b(research|discover|investigate|analy[sz]e|intelligence|report|study|benchmark)\b/i,
    roles: [
      { role: "Queen", responsibility: "Define the question, evidence bar, and decision boundary.", workerClasses: ["planner", "general"] },
      { role: "Research", responsibility: "Gather primary evidence and test hypotheses.", workerClasses: ["research"] },
      { role: "Auditor", responsibility: "Challenge assumptions, provenance, and unsupported claims.", workerClasses: ["security", "qa", "research"] },
      { role: "Designer", responsibility: "Turn verified findings into a useful decision artifact.", workerClasses: ["writer"] },
    ],
    capabilityIntents: ["web research", "shared brain recall", "data analysis", "source verification", "reporting"],
    deliverables: ["An evidence-backed answer", "A source and assumption register", "A reproducible research trail", "Open questions for the next experiment"],
    hypotheses: ["Dividing evidence gathering from verification will reduce confident errors.", "A bounded decision question will produce a more useful report."],
  },
  {
    id: "general-company",
    priority: 0,
    sector: "General",
    match: /.*/,
    roles: [
      { role: "Queen", responsibility: "Own the goal, work breakdown, budget, and approvals.", workerClasses: ["planner", "general"] },
      { role: "Research", responsibility: "Establish facts, constraints, and candidate approaches.", workerClasses: ["research"] },
      { role: "Engineer", responsibility: "Produce the first concrete deliverable.", workerClasses: ["code", "general"] },
      { role: "QA", responsibility: "Verify the result against the success criteria.", workerClasses: ["qa"] },
    ],
    capabilityIntents: ["planning", "research", "execution", "verification"],
    deliverables: ["A concrete first outcome", "Verification receipts", "A measured next experiment"],
    hypotheses: ["A small verified milestone will expose the best next move.", "Separating execution from verification will improve reliability."],
  },
] as const;

const BUDGETS: Record<FounderBudgetTier, { first: number; daily: number; monthly: number }> = {
  "local-free": { first: 0, daily: 0, monthly: 0 },
  starter: { first: 10, daily: 5, monthly: 50 },
  growth: { first: 50, daily: 20, monthly: 250 },
  scale: { first: 200, daily: 75, monthly: 1_000 },
};

const STOP_WORDS = new Set(["a", "an", "and", "be", "build", "create", "for", "help", "i", "make", "my", "of", "on", "that", "the", "to", "want", "with"]);

function cleanGoal(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 2_000);
}

function archetypeFor(goal: string) {
  return [...FOUNDER_ARCHETYPE_MATRIX]
    .filter((entry) => entry.match.test(goal))
    .sort((left, right) => right.priority - left.priority)[0] ?? FOUNDER_ARCHETYPE_MATRIX.at(-1)!;
}

function titleWords(goal: string) {
  return goal
    .replace(/[^a-z0-9\s-]/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function identityFor(goal: string, archetype: FounderArchetype) {
  const words = titleWords(goal);
  const stem = words.length ? words.join(" ") : "New Venture";
  const suffix = archetype.id === "content-company" ? "Studio" : archetype.id === "research-company" ? "Labs" : archetype.id === "service-company" ? "Works" : "Company";
  const name = stem.endsWith(suffix) ? stem : `${stem} ${suffix}`;
  const ticker = words.join("").replace(/[^A-Z]/g, "").slice(0, 5) || "HIVE";
  return { name, ticker, sector: archetype.sector };
}

function metricFor(goal: string) {
  const money = goal.match(/\$\s*([\d,.]+\s*[kKmM]?)/);
  const users = goal.match(/([\d,.]+\s*[kKmM]?)\s+(?:users|customers|clients|subscribers|members)/i);
  const percent = goal.match(/([\d.]+)\s*%/);
  if (/\b(mrr|arr|revenue|sales|income)\b/i.test(goal) || money) {
    return { metric: /mrr/i.test(goal) ? "monthly recurring revenue" : "verified revenue", target: money?.[1] ?? "first revenue", unit: "currency" as const };
  }
  if (users) return { metric: "active customers", target: users[1], unit: "users" as const };
  if (percent) return { metric: "success rate", target: percent[1], unit: "percent" as const };
  return { metric: "accepted outcomes", target: "1 verified milestone", unit: "number" as const };
}

function agentScore(agent: FounderAgentCandidate, role: FounderArchetype["roles"][number]) {
  const text = `${agent.role ?? ""} ${agent.workerClass ?? ""} ${agent.name} ${agent.runtime ?? ""}`.toLowerCase();
  let score = role.workerClasses.some((workerClass) => text.includes(workerClass)) ? 60 : 0;
  if (text.includes(role.role.toLowerCase())) score += 50;
  if (role.role === "Queen" && /queen|planner|lead|general/.test(text)) score += 35;
  return score;
}

function crewFor(archetype: FounderArchetype, agents: FounderAgentCandidate[]): FounderCrewRole[] {
  const used = new Set<string>();
  return archetype.roles.map((role) => {
    const candidate = [...agents]
      .filter((agent) => !used.has(agent.id))
      .sort((left, right) => agentScore(right, role) - agentScore(left, role) || left.name.localeCompare(right.name))[0];
    if (candidate) used.add(candidate.id);
    return {
      role: role.role,
      responsibility: role.responsibility,
      candidateAgentId: candidate?.id,
      candidateAgentName: candidate?.name,
      runtime: candidate?.runtime,
      model: candidate?.model,
    };
  });
}

function credentialKeys(item: ContextIndexItem) {
  const text = `${item.summary} ${item.retrievalText ?? ""}`;
  return [...new Set(text.match(/\b[A-Z][A-Z0-9_]{3,}(?:_KEY|_TOKEN|_SECRET|_URL|_ID)\b/g) ?? [])].slice(0, 6);
}

function capabilitiesFor(archetype: FounderArchetype, contextItems: ContextIndexItem[]): FounderCapability[] {
  return archetype.capabilityIntents.map((intent) => {
    const words = intent.toLowerCase().split(/\s+/);
    const matched = contextItems.find((item) => {
      const haystack = `${item.title} ${item.summary} ${item.tags.join(" ")} ${item.aliases?.join(" ") ?? ""}`.toLowerCase();
      return words.some((word) => word.length > 3 && haystack.includes(word));
    });
    const sideEffects = matched?.authorization?.sideEffects ?? [];
    const keys = matched ? credentialKeys(matched) : [];
    return {
      intent,
      label: matched?.title ?? intent.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      readiness: matched ? (keys.length ? "optional" : "ready") : "missing",
      implementation: matched?.title,
      requiredCredentialKeys: keys,
      sideEffects,
      approvalRequired: Boolean(sideEffects.length || matched?.authorization?.confirmation),
      fallback: matched ? undefined : "Use a local/BYOK skill or install a matching capability.",
    };
  });
}

function computeRoutesFor(privacy: FounderPrivacyMode, modelFits: ModelFitRecommendation[]) {
  const local = modelFits.find((fit) => fit.tier !== "hosted-or-remote");
  const routes = [
    ...(local ? [{ id: `local:${local.machineId}`, label: local.machineName, source: "local" as const, rationale: local.rationale.join(" "), privacy, estimatedCost: "Uses owned compute", recommended: privacy === "private-first" }] : []),
    { id: "hive-compute:auto", label: "Hive Compute Auto", source: "hive-compute" as const, rationale: "Uses eligible marketplace capacity with a hosted fallback and metered receipts.", privacy, estimatedCost: "Usage metered", recommended: privacy === "balanced" || !local },
    { id: "hosted:adaptive", label: "Adaptive hosted models", source: "hosted" as const, rationale: "Uses configured model providers and observed reliability when local capacity is unavailable.", privacy, estimatedCost: "Provider pricing", recommended: privacy === "cloud-ok" },
  ];
  if (!routes.some((route) => route.recommended)) routes[0].recommended = true;
  return routes;
}

export function compileFounderBlueprint(input: {
  goal: string;
  constraints: FounderConstraints;
  agents?: FounderAgentCandidate[];
  contextItems?: ContextIndexItem[];
  modelFits?: ModelFitRecommendation[];
  now?: string;
}): FounderBlueprint {
  const goal = cleanGoal(input.goal);
  if (goal.length < 12) throw new Error("Describe the outcome in at least a short sentence.");
  const archetype = archetypeFor(goal);
  const identity = identityFor(goal, archetype);
  const metric = metricFor(goal);
  const budget = BUDGETS[input.constraints.budgetTier];
  const capabilities = capabilitiesFor(archetype, input.contextItems ?? []);
  const firstMilestoneTitle = `Prove the first ${metric.metric} milestone`;
  return {
    version: 1,
    generatedAt: input.now ?? new Date().toISOString(),
    goal,
    archetype: archetype.id,
    identity: {
      ...identity,
      blurb: `An agent-run operating loop focused on: ${goal}`,
      charter: `Pursue "${goal}" through small, evidence-backed milestones. External publishing, customer contact, money movement, and destructive actions require operator approval. Prefer ${input.constraints.privacy} execution and preserve receipts for consequential work.`,
    },
    apexGoal: { title: goal, ...metric },
    firstMilestone: {
      title: firstMilestoneTitle,
      successCriteria: [
        "Produce at least one concrete deliverable a human can inspect.",
        `Measure ${metric.metric} against the stated target or establish a defensible baseline.`,
        "Pass the verification gates or label failures and missing evidence explicitly.",
      ],
      deliverables: archetype.deliverables,
      pace: input.constraints.pace,
    },
    crew: crewFor(archetype, input.agents ?? []),
    capabilities,
    computeRoutes: computeRoutesFor(input.constraints.privacy, input.modelFits ?? []),
    budget: { firstMilestoneUsd: budget.first, dailyUsd: budget.daily, monthlyUsd: budget.monthly },
    governance: {
      externalActionsRequireApproval: true,
      moneyMovementRequiresApproval: true,
      publishingRequiresApproval: true,
      killSwitchEnabled: true,
    },
    proofRequirements: [
      "Source and assumption register",
      "Agent, model, machine, and tool provenance",
      "Deliverable inventory",
      "Eval-gate receipts with evidence",
      "Cost and approval record for consequential actions",
    ],
    lab: {
      title: `${identity.name} · first milestone lab`,
      objective: firstMilestoneTitle,
      metricName: metric.metric,
      metricDirection: "increase",
      significanceThreshold: metric.unit === "percent" ? 1 : 0,
      hypotheses: archetype.hypotheses,
      experiments: [
        `Create the smallest inspectable version of: ${goal}`,
        "Run an independent verification pass against the done contract.",
        "Compare the result with one materially different approach before scaling.",
      ],
    },
    assumptions: [
      input.agents?.length ? "Existing agents can be assigned to the proposed roles." : "No stored agents were found; the company will need a crew before launch.",
      capabilities.some((item) => item.readiness === "missing") ? "Some desired capabilities are not currently discoverable and need setup or a fallback." : "The main capability intents are discoverable.",
      "The first milestone remains a proposal until the operator founds the company.",
    ],
    constraints: input.constraints,
  };
}
