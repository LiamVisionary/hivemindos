import "server-only";

import type { Company, CompanyFrontierLabStage, CompanyProcess } from "@/lib/types/company";
import { decomposePrdToTaskDrafts, type QueenBeePrdTaskDraft } from "@/lib/services/queen-bee/prd-decomposition";
import { submitQueenBeeMessage, type QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";
import { llmDecomposeApexGoal } from "@/lib/services/companies-goal-planner";
import { appendCompanyGovernanceProof } from "@/lib/services/company-governance";
import { appendCompanyMemory, companyMemoryDigest } from "@/lib/services/company-memory";
import {
  appendCompanyRunEvent,
  finishCompanyRun,
  startCompanyRun,
} from "@/lib/services/company-runs";
import { dedupeDrafts } from "@/lib/services/company-task-dedup";
import type { KanbanLoopSpec, KanbanTask } from "@/lib/types/kanban";
import { buildOperatingUnitLearningLoop } from "@/lib/services/loops";
import type { FlowSpec } from "@/lib/types/agent-flow";
import { flowFromSequence, getFlowTemplate } from "@/lib/services/queen-bee/flow-templates";
import { startFlowRun } from "@/lib/services/queen-bee/flow-runner";
import { activeCompanyApprovalPolicies } from "@/lib/services/company-approval-policies";
import { buildStoredSalesContentDispatchContext } from "@/lib/services/sales-content";
import {
  dispatchCompanyWithAeon,
  type CompanyAeonDispatchResult,
} from "@/lib/services/company-aeon-execution";
import {
  classifyFrontierLabTaskTier,
  evaluateFrontierLabCapacity,
  normalizeFrontierLabPolicy,
} from "@/lib/frontier-lab";
import { readCompanyIntelligenceSnapshot } from "@/lib/services/company-intelligence-usage";

/**
 * Company orchestration bridge: turn a company's apex goal into a per-role work
 * plan and dispatch each task through the EXISTING queen-bee engine
 * (submitQueenBeeMessage), scoped to the company's member agents. The queen-bee
 * engine routes each task to the best member in the supplied fleet snapshot,
 * creates the Work Board card, and schedules autonomous pickup (claim → the
 * agent's collector /chat → complete). The autonomous worker carries the active
 * company Work Board task id into supported spend tools so company policy binds
 * to this work without leaking into the same agent's unrelated activity.
 */

/** A directive verb per company role, used to seed the heuristic decomposer. */
const ROLE_DIRECTIVE: Record<string, string> = {
  Engineer: "Implement the next concrete increment toward",
  Product: "Define and scope the next shippable milestone for",
  Designer: "Design the experience and assets for",
  QA: "Verify, test, and harden progress toward",
  DevOps: "Stand up and operate the infrastructure for",
  Auditor: "Audit risks, spend, and compliance for",
  Growth: "Drive growth and outreach to move",
  Research: "Research what is required to reach",
  Treasury: "Plan budget and capital allocation for",
  Queen: "Coordinate the crew and review progress toward",
};

/** Restrict a fleet snapshot to a company's member agents (drops empty machines). */
export function scopeFleetToMembers(fleet: QueenBeeFleetMachine[], agentIds: string[]): QueenBeeFleetMachine[] {
  const ids = new Set(agentIds.filter(Boolean));
  if (ids.size === 0) return [];
  const scoped: QueenBeeFleetMachine[] = [];
  for (const machine of fleet) {
    const agents = (machine.agents ?? []).filter((a) => (a.id && ids.has(a.id)) || (a.agentId && ids.has(a.agentId)));
    if (agents.length > 0) scoped.push({ ...machine, agents });
  }
  return scoped;
}

/**
 * Mirror of queen-bee/router.ts `isChatCapable` EXACTLY (keep in sync). The
 * driver's dispatchable-member count MUST match who the router will actually
 * delegate to — otherwise we'd count agents the router leaves "pending" and
 * keep re-dispatching "queen-bee" tasks that never execute. Only `hermes`
 * runtime or an explicit chat capability flag qualifies.
 */
function isMemberChatCapable(
  agent: NonNullable<QueenBeeFleetMachine["agents"]>[number],
  machineCapabilities?: Record<string, unknown>,
): boolean {
  return (
    agent.runtime === "hermes" ||
    agent.runtimeCapabilities?.chat === true ||
    agent.collectorCapabilities?.chat === true ||
    machineCapabilities?.chat === true
  );
}

/** How many member agents are online AND chat-capable (i.e. can actually run work now). */
export function countDispatchableMembers(scoped: QueenBeeFleetMachine[]): number {
  let n = 0;
  for (const machine of scoped) {
    if (!machine.device?.online) continue;
    n += (machine.agents ?? []).filter((a) => isMemberChatCapable(a, machine.capabilities)).length;
  }
  return n;
}

/** Distinct online identities available for a worker/reviewer split. */
export function countDispatchableMemberIdentities(scoped: QueenBeeFleetMachine[]): number {
  const identities = new Set<string>();
  for (const machine of scoped) {
    if (!machine.device?.online) continue;
    for (const agent of machine.agents ?? []) {
      if (!isMemberChatCapable(agent, machine.capabilities)) continue;
      const identity = String(agent.id || agent.agentId || agent.name || "").trim().toLowerCase();
      if (identity) identities.add(identity);
    }
  }
  return identities.size;
}

/** Build a structured PRD brief from the apex goal + the crew's roles. */
export function buildApexBrief(company: Company, salesContentContext?: string): { prd: string; title: string } {
  const goal = (company.apexGoal?.title || company.name).trim();
  const metric = company.apexGoal?.metric?.trim();
  const target = company.apexGoal?.target?.trim();
  const mission = (company.blurb || company.charter || "").trim();
  const roles = [...new Set((company.members ?? []).map((m) => (m.roleInCompany || "").trim()).filter(Boolean))];
  const workerRoles = roles.filter((r) => r !== "Queen");
  const pool = workerRoles.length ? workerRoles : ["Research", "Engineer", "QA"];
  const metricClause = metric && target ? ` (${metric} → ${target})` : metric ? ` (track ${metric})` : "";

  const requirements = pool.map((role) => {
    const directive = ROLE_DIRECTIVE[role] || "Advance";
    return `${role}: ${directive} "${goal}"${metricClause}.`;
  });
  requirements.push(`Coordinate the crew and review progress toward "${goal}".`);

  const lines = [
    `# ${goal}`,
    metric || target ? `Metric: ${metric || "—"}${target ? ` → target ${target}` : ""}` : "",
    mission ? `Mission: ${mission}` : "",
    "",
    "## Requirements",
    ...requirements.map((r) => `- ${r}`),
    salesContentContext?.trim() ? `\n## Sales/content machine\n${salesContentContext.trim()}` : "",
    "",
    "## Acceptance criteria",
    ...(metric && target ? [`- ${metric} reaches ${target}.`] : []),
    "- Each requirement is completed and verified, with results recorded on the Work Board.",
  ].filter(Boolean);

  return { prd: lines.join("\n"), title: goal };
}

/**
 * Standing context appended to every dispatched task body so workers never run
 * cold: who the company is, what the apex goal/metric currently reads, and a
 * compact digest of what the company has already done. Business-agnostic — the
 * digest is whatever the company's own memory ledger accumulated.
 */
export function companyWorkerContext(company: Company, memoryDigest: string, salesContentContext?: string): string {
  const apex = company.apexGoal;
  const metricLine = apex?.metric || apex?.target
    ? `Metric: ${apex?.metric || "—"}${apex?.target ? ` → target ${apex.target}` : ""}${apex?.current ? ` (current ${apex.current})` : ""}`
    : "";
  const mission = (company.blurb || company.charter || "").trim();
  const lines = [
    "",
    "---",
    `Company: ${company.name}${company.sector ? ` (${company.sector})` : ""}`,
    `Company id: ${company.id}`,
    apex?.title?.trim() ? `Apex goal: ${apex.title.trim()}` : "",
    metricLine,
    mission ? `Charter: ${mission}` : "",
  ];
  const products = company.products?.items ?? [];
  if (products.length) {
    lines.push(
      "",
      "Official products & pricing (the shared-brain catalog is the single source of truth — quote, pitch, and sell at exactly these prices; never invent or negotiate prices, and treat any price found elsewhere, including the company repo, as stale):",
    );
    for (const p of products) {
      const cadence = p.interval === "month" ? "/mo" : p.interval === "year" ? "/yr" : "";
      const tags = [p.kind === "addon" ? "add-on" : null, p.recommended ? "recommended default" : null].filter(Boolean).join(", ");
      lines.push(`- ${p.name} (key: ${p.key}) — $${p.amountUsd.toLocaleString("en-US")}${cadence}${tags ? ` (${tags})` : ""}${p.description ? `: ${p.description}` : ""}`);
    }
    lines.push(
      "",
      "Pricing is a hypothesis, not a law: actively watch the evidence in company memory and your own work for signs that PRICE is why prospects don't book or buy — replies calling it too expensive, prospects who engage then vanish at the quote or checkout, competitor prices they cite, discount asks, a package that never sells while a cheaper one does. Weigh the evidence honestly (silence alone is not price evidence — a dead link or a bad pitch can look identical).",
      "If the evidence genuinely points at pricing, do NOT change or discount prices yourself. Raise a concrete request by ending your result with:",
      "PRICING PROPOSAL: <product key from the catalog above> $<proposed price>",
      "WHY: <the specific evidence, with numbers or quotes — this is what the human reads when deciding>",
      "It appears under the company's Approvals for a human decision; the outcome (approved or rejected) lands back in company memory. One proposal per product; only re-propose after materially new evidence.",
    );
  }
  const pendingProposals = company.pricingProposals ?? [];
  if (pendingProposals.length) {
    lines.push("", "Pricing proposals already awaiting the human's decision (do NOT re-propose these; keep selling at current catalog prices meanwhile):");
    for (const proposal of pendingProposals) {
      lines.push(`- ${proposal.productName}: $${proposal.currentAmountUsd.toLocaleString("en-US")} → $${proposal.proposedAmountUsd.toLocaleString("en-US")}${proposal.why ? ` (${proposal.why})` : ""}`);
    }
  }
  const approvalPolicies = activeCompanyApprovalPolicies(company);
  if (approvalPolicies.length) {
    lines.push("", "Human approval policies - mandatory before acting:");
    for (const policy of approvalPolicies) {
      if (policy.mode === "never") {
        lines.push(`- Never proceed with ${policy.subject}. If a task appears to require it, stop and end your result with ACTION NEEDED: asking the human to change the policy or choose another path.`);
      } else {
        lines.push(`- Before ${policy.subject}, ask the human first: park the work in Needs You by ending your result with ACTION NEEDED:, include the concrete preview/draft/link/options they must approve, and wait for the human's answer before proceeding.`);
      }
    }
  }
  const integrationBindings = company.integrationBindings ?? [];
  if (integrationBindings.length) {
    lines.push("", "Named integration accounts selected for this company — use these exact connection ids, never another company's account:");
    for (const binding of integrationBindings) lines.push(`- ${binding.providerKey}: ${binding.connectionId}`);
    if (integrationBindings.some((binding) => binding.providerKey === "meta-messaging")) {
      lines.push("- Meta Messaging is setup-only in this build: no message sync or send adapter is implemented. Never claim a Meta message was read or sent, and never treat it as a way to cold-DM arbitrary Instagram handles or Facebook users.");
    }
  }
  const integrationLimits = company.integrationLimits ?? [];
  const apiBudgets = company.apiBudgets ?? [];
  if (integrationLimits.length || apiBudgets.length) {
    lines.push(
      "",
      "API and integration limits — mandatory preflight:",
      "Before every external API/integration call for this company, call company_api_preflight with this company id, the connector providerKey/operationId, request count, a conservative USD estimate, and a stable idempotency key. If it blocks, do not call the provider.",
    );
    for (const limit of integrationLimits) {
      const caps = [
        limit.dailyRequestLimit ? `${limit.dailyRequestLimit} requests/day` : null,
        limit.monthlyRequestLimit ? `${limit.monthlyRequestLimit} requests/month` : null,
        limit.dailySpendLimitUsd ? `$${limit.dailySpendLimitUsd}/day` : null,
        limit.monthlySpendLimitUsd ? `$${limit.monthlySpendLimitUsd}/month` : null,
      ].filter(Boolean).join(", ");
      lines.push(`- ${limit.providerKey}:${limit.operationId || "all operations"} — ${caps}`);
    }
    for (const budget of apiBudgets) {
      const caps = budget.dailyCaps.map((cap) => `${cap.metric} ${cap.value}/${cap.unit}`).join(", ");
      lines.push(`- google-cloud:${budget.service} in ${budget.projectId || budget.projectNumber} — provider daily quotas ${caps || "none"}; $${budget.monthlyCeilingUsd}/month billing alert`);
    }
  }
  if (company.frontierLab?.enabled) {
    const policy = normalizeFrontierLabPolicy(company.frontierLab);
    lines.push(
      "",
      `Frontier Lab is active at the ${policy.stage} stage with a ${policy.monthlyTokenLimit.toLocaleString("en-US")}-token monthly control budget and ${policy.perTaskTokenLimit.toLocaleString("en-US")} tokens reserved per task attempt.`,
      `Model routing is fixed to OpenAI OAuth: scout ${policy.models.scout}, builder ${policy.models.builder}, reviewer ${policy.models.reviewer}. Do not switch to OpenRouter, Claude, or an API-key provider.`,
      `Capacity guardrails: ${policy.maxParallelTasks} parallel task(s), ${policy.maxTasksPerCycle} task(s) per planning cycle, ${policy.perMachineConcurrency} model turn(s) per machine.`,
      "Earned Scale checkpoints: before the first costly or mutating action, state the outcome metric, proof, task split, budget, and rollback path. Mid-run, pause and re-plan when evidence contradicts the plan, reviewers disagree, or half the task reservation is consumed. Before completion, require independent proof; task completion alone never earns more scale.",
    );
  }
  const directives = company.directives ?? [];
  if (directives.length) {
    lines.push("", "Standing directives from the human — follow these exactly (newest last):");
    for (const d of directives) {
      const skills = [...new Set([
        ...(Array.isArray(d.skills) ? d.skills : []),
        ...(d.skill ? [d.skill] : []),
      ].map((slug) => slug.trim()).filter(Boolean))];
      const skillLabel = skills.length === 1 ? "use skill" : "use skills";
      const extra = `${skills.length ? ` (${skillLabel}: ${skills.join(", ")})` : ""}${d.attachments?.length ? ` (refs: ${d.attachments.map((a) => a.name).join(", ")})` : ""}`;
      lines.push(`- ${d.text.trim()}${extra}`);
    }
  }
  const digest = memoryDigest.trim();
  if (digest) lines.push("", "What the company has done recently (newest first):", digest);
  const salesContext = salesContentContext?.trim();
  if (salesContext) lines.push("", salesContext);
  lines.push(
    "",
    "Do not repeat work listed as DONE above. Record a concrete, durable result on the Work Board — it becomes company memory for the next cycle.",
    "When your work produces or updates anything CUSTOMER-FACING — a live site, per-lead preview, offer page, booking or payment link — list each full URL on its own line under a `Deliverables:` heading in your result. Those URLs are the company's product shelf: the human's Deliverables view is built from them, and work that only records internal files/write-ups shows the human an empty shelf even when the product exists (do still record internal artifacts, just never as the ONLY deliverables when a customer-facing URL exists).",
    "If you are blocked on human input, access, approval, or a decision, end your result with a section named exactly `ACTION NEEDED:` containing one or two imperative sentences telling the human precisely what to do or decide (include the options if there is a choice). This section becomes the card's headline on the Work Board.",
    "When it helps the human act faster, add extra lines directly under `ACTION NEEDED:` — `LINK: <url>` pointing where they get or do the thing, `OPTIONS: <choice A> | <choice B>` when you need a decision, and `NEEDS: api-key <ENV_VAR_NAME>` (or `NEEDS: file` / `NEEDS: text`) naming what you are waiting for. The Work Board renders these as one-click controls and the human's answer comes back to you on this task.",
  );
  return lines.filter((line) => line !== "").join("\n");
}

export type CompanyDispatchTask = {
  taskId: string;
  title: string;
  assignee?: string;
  delegated: boolean;
  pickupScheduled: boolean;
};

export type HivemindCompanyDispatchResult = {
  goal: string;
  taskCount: number;
  delegatedCount: number;
  pickupCount: number;
  dispatchableMembers: number;
  /** "llm"/"heuristic" for hierarchical fan-out; "flow" for sequential/graph processes. */
  planner: "llm" | "heuristic" | "flow";
  tasks: CompanyDispatchTask[];
  /** Set when the company ran as a flow (process: "sequential" | "graph"). */
  flowRunId?: string;
  /** Durable company-run trace id for this dispatch attempt. */
  companyRunId?: string;
  process?: CompanyProcess;
  /** How many planned drafts were dropped as duplicates of recent/in-flight work. */
  deduped?: number;
  /** Absent on older native traces. */
  executionEngine?: "hivemind";
  externalRunCount?: never;
  aeon?: never;
  /** Present when company-scoped Frontier Lab scheduling governed this dispatch. */
  frontierLab?: {
    stage: CompanyFrontierLabStage;
    availableSlots: number;
    remainingTokens: number;
    blockedReason?: string;
  };
};

export type CompanyDispatchResult = HivemindCompanyDispatchResult | CompanyAeonDispatchResult;

// Build a sequential FlowSpec from decomposed PRD drafts: each draft becomes a step whose success
// hands off to the next, so the crew runs in order with each step consuming the prior output.
export function planCompanyFlowSpec(company: Company, drafts: QueenBeePrdTaskDraft[]): FlowSpec {
  const goal = company.apexGoal?.title?.trim() || company.name;
  const steps = drafts.map((draft, i) => ({
    id: `step-${i + 1}`,
    title: draft.title,
    workerClass: draft.skills?.[0],
    skills: draft.skills,
    prompt: i === 0 ? draft.body : `${draft.body}\n\nPrior step output:\n{{last}}`,
  }));
  return flowFromSequence(steps, {
    id: `company-${company.id}`,
    name: `${company.name} — ${goal}`,
    description: `Sequential crew flow for ${company.name}.`,
  });
}

// Run a company as a flow (process: "sequential" or "graph"). Sequential decomposes the apex goal
// into an ordered chain; graph runs the company's saved FlowSpec. Returns a dispatch result whose
// flowRunId is the handle to advance/inspect the run.
export async function dispatchCompanyFlow(
  company: Company,
  fleetSnapshot: QueenBeeFleetMachine[],
  opts: { maxTasks?: number; origin?: string; vaultPath?: string } = {},
): Promise<CompanyDispatchResult> {
  const goal = company.apexGoal?.title?.trim();
  if (!goal) throw new Error("Set an apex goal before launching work.");
  if (!company.agentIds?.length) throw new Error("Staff the company with at least one agent first.");

  const scoped = scopeFleetToMembers(fleetSnapshot, company.agentIds);
  const dispatchableMembers = countDispatchableMembers(scoped);

  let spec: FlowSpec | null;
  if (company.process === "graph") {
    spec = company.flowTemplateId ? await getFlowTemplate(company.flowTemplateId, { vaultPath: opts.vaultPath }) : null;
    if (!spec) throw new Error("Select a flow template for a graph-process company.");
  } else {
    const maxTasks = Math.max(1, Math.min(opts.maxTasks ?? 6, 8));
    const salesContentContext = await buildStoredSalesContentDispatchContext(company).catch(() => "");
    const { prd, title } = buildApexBrief(company, salesContentContext);
    const drafts = decomposePrdToTaskDrafts(prd, { title, maxTasks }).drafts;
    spec = planCompanyFlowSpec(company, drafts);
  }

  const companyRun = await startCompanyRun(company.id, {
    kind: "flow",
    title: `Flow dispatch: ${goal}`,
    actor: "company-autonomy",
    snapshot: {
      companyName: company.name,
      apexGoal: goal,
      apexMetric: company.apexGoal?.metric,
      apexTarget: company.apexGoal?.target,
      productCount: company.products?.items.length ?? 0,
      products: company.products?.items,
      directiveCount: company.directives?.length ?? 0,
      agentCount: company.agentIds.length,
      autonomy: company.autonomy,
      frozen: company.frozen,
    },
    input: {
      process: company.process ?? "sequential",
      dispatchableMembers,
      stepCount: spec.nodes.filter((n) => n.kind === "task").length,
    },
  });

  let run: Awaited<ReturnType<typeof startFlowRun>>;
  try {
    run = await startFlowRun(spec, {
      vaultPath: opts.vaultPath,
      fleetSnapshot: scoped,
      priority: "high",
      state: { topic: goal, goal, companyRunId: companyRun.id },
    });
  } catch (error) {
    await finishCompanyRun(company.id, companyRun.id, {
      status: "failed",
      summary: error instanceof Error ? error.message : "Flow dispatch failed.",
    }).catch(() => undefined);
    throw error;
  }

  await appendCompanyRunEvent(company.id, companyRun.id, {
    kind: "flow-started",
    title: `Flow run started: ${run.runId}`,
    data: { flowRunId: run.runId },
  }).catch(() => undefined);

  await appendCompanyMemory(company.id, {
    kind: "dispatch",
    title: `Started ${company.process ?? "sequential"} flow toward "${goal}"`,
    detail: `Flow run ${run.runId} with ${spec.nodes.filter((n) => n.kind === "task").length} step(s).`,
  }).catch(() => undefined);
  await appendCompanyGovernanceProof({
    companyId: company.id,
    companyName: company.name,
    event: "dispatch",
    payload: { goal, flowRunId: run.runId, process: company.process ?? "sequential", taskCount: spec.nodes.filter((n) => n.kind === "task").length },
  }).catch(() => undefined);
  await finishCompanyRun(company.id, companyRun.id, {
    status: "completed",
    output: {
      flowRunId: run.runId,
      process: company.process ?? "sequential",
      taskCount: spec.nodes.filter((n) => n.kind === "task").length,
    },
  }).catch(() => undefined);

  return {
    goal,
    taskCount: spec.nodes.filter((n) => n.kind === "task").length,
    delegatedCount: 0,
    pickupCount: 0,
    dispatchableMembers,
    planner: "flow",
    flowRunId: run.runId,
    companyRunId: companyRun.id,
    process: company.process,
    tasks: [],
  };
}

/**
 * Evo-style private optimization loop for every company-dispatched task. Gates
 * are intentionally non-blocking at creation time: agents can ship useful work
 * without being trapped by missing receipts, while the company still accumulates
 * eval/experiment structure that future distillers and Evo runs can strengthen.
 */
function buildCompanyLearningLoop(company: Company, draft: QueenBeePrdTaskDraft, runId: string): KanbanLoopSpec {
  return buildOperatingUnitLearningLoop({
    unitId: company.id,
    unitName: company.name,
    workTitle: draft.title,
    runId,
    metricName: company.apexGoal?.metric?.trim() || "business outcome",
    metricTarget: company.apexGoal?.target?.trim(),
    strategicGoal: company.apexGoal?.title?.trim() || company.name,
    branchAgent: draft.skills?.[0],
    skills: draft.skills,
    governanceLabel: "company governance",
    requireIndependentJudge: company.frontierLab?.enabled === true,
  });
}

/**
 * After dedupe drops drafts, surviving drafts' `dependsOnDraftIndexes` still point
 * into the ORIGINAL array. Remap them to positions in the surviving array and drop
 * edges to dropped drafts (their work already exists, so the dependency is treated
 * as satisfied). Pure; exported for hermetic tests.
 */
export function remapDraftDependencies(
  original: readonly QueenBeePrdTaskDraft[],
  fresh: readonly QueenBeePrdTaskDraft[],
): QueenBeePrdTaskDraft[] {
  const newIndexByDraft = new Map<QueenBeePrdTaskDraft, number>();
  fresh.forEach((draft, index) => newIndexByDraft.set(draft, index));
  const newIndexByOldIndex = new Map<number, number>();
  original.forEach((draft, oldIndex) => {
    const newIndex = newIndexByDraft.get(draft);
    if (newIndex !== undefined) newIndexByOldIndex.set(oldIndex, newIndex);
  });
  return fresh.map((draft) => ({
    ...draft,
    dependsOnDraftIndexes: (draft.dependsOnDraftIndexes ?? []).flatMap((oldIndex) => {
      const mapped = newIndexByOldIndex.get(oldIndex);
      return mapped !== undefined ? [mapped] : [];
    }),
  }));
}

export function companyTaskWorkspace(company: Company, draft: Pick<QueenBeePrdTaskDraft, "title" | "body" | "skills">): KanbanTask["workspace"] {
  if (!company.projectId) return "scratch";
  const text = [draft.title, draft.body, ...(draft.skills ?? [])].filter(Boolean).join(" ");
  return /api|app|backend|build|checkout|code|deploy|devops|engineer|frontend|implementation|landing|lint|repo|site|test|typecheck|ui|worker|website/i.test(text)
    ? "worktree"
    : "scratch";
}

export async function dispatchCompanyGoal(
  company: Company,
  fleetSnapshot: QueenBeeFleetMachine[],
  opts: { maxTasks?: number; origin?: string; vaultPath?: string; recentCompanyTaskTitles?: string[]; completedCompanyTaskTitles?: string[] } = {},
): Promise<CompanyDispatchResult> {
  const goal = company.apexGoal?.title?.trim();
  if (!goal) throw new Error("Set an apex goal before launching work.");

  if (company.execution?.engine === "aeon") {
    return dispatchCompanyWithAeon(company, { vaultPath: opts.vaultPath });
  }
  if (!company.agentIds?.length) throw new Error("Staff the company with at least one agent first.");

  // Sequential/graph processes run as an agent flow; hierarchical (default) fans tasks out below.
  if (company.process === "sequential" || company.process === "graph") {
    return dispatchCompanyFlow(company, fleetSnapshot, opts);
  }

  const scoped = scopeFleetToMembers(fleetSnapshot, company.agentIds);
  const dispatchableMembers = countDispatchableMembers(scoped);
  const frontierPolicy = company.frontierLab?.enabled ? normalizeFrontierLabPolicy(company.frontierLab) : undefined;
  const intelligence = frontierPolicy
    ? await readCompanyIntelligenceSnapshot(company.id, frontierPolicy)
    : undefined;
  const frontierCapacity = frontierPolicy && intelligence
    ? evaluateFrontierLabCapacity({
        policy: frontierPolicy,
        dispatchableMembers: countDispatchableMemberIdentities(scoped),
        activeTasks: intelligence.activeReservations,
        settledTokens: intelligence.settledTokens,
        reservedTokens: intelligence.reservedTokens,
      })
    : undefined;
  const frontierLab = frontierPolicy && frontierCapacity
    ? {
        stage: frontierPolicy.stage,
        availableSlots: frontierCapacity.availableSlots,
        remainingTokens: frontierCapacity.remainingTokens,
        blockedReason: frontierCapacity.blockedReason,
      }
    : undefined;
  if (frontierCapacity && frontierCapacity.availableSlots <= 0) {
    return {
      goal,
      taskCount: 0,
      delegatedCount: 0,
      pickupCount: 0,
      dispatchableMembers,
      planner: "heuristic",
      tasks: [],
      frontierLab,
    };
  }
  const requestedMax = opts.maxTasks ?? (frontierCapacity?.availableSlots ?? 6);
  const maxTasks = frontierCapacity
    ? Math.max(1, Math.min(requestedMax, frontierCapacity.availableSlots, 24))
    : Math.max(1, Math.min(requestedMax, 8));

  // Company memory makes each cycle incremental: the planner sees a longer digest
  // (plan the NEXT batch), each worker body a shorter one (don't run cold).
  const plannerMemory = await companyMemoryDigest(company.id, { maxChars: 1_600 }).catch(() => "");
  const workerMemory = plannerMemory.length > 900 ? `${plannerMemory.slice(0, 899)}…` : plannerMemory;
  const salesContentContext = await buildStoredSalesContentDispatchContext(company).catch(() => "");

  // Frontier planning is deterministic so no unreserved planner inference can
  // escape the company ledger or fall through to a member's non-OAuth runtime.
  // Ordinary companies preserve the established agent-first planner behavior.
  let drafts: QueenBeePrdTaskDraft[];
  let planner: "llm" | "heuristic";
  const llmDrafts = frontierPolicy
    ? null
    : await llmDecomposeApexGoal(company, {
        origin: opts.origin,
        vaultPath: opts.vaultPath,
        maxTasks,
        history: plannerMemory,
        // Lifetime completed-work inventory: the memory digest above only reaches a
        // few records back, so without this the planner re-creates assets built days
        // earlier once they roll off the digest and the 24h dedupe window.
        completedTitles: opts.completedCompanyTaskTitles,
        salesContentContext,
      }).catch(() => null);
  if (llmDrafts && llmDrafts.length > 0) {
    drafts = llmDrafts;
    planner = "llm";
  } else {
    const { prd, title } = buildApexBrief(company, salesContentContext);
    drafts = decomposePrdToTaskDrafts(prd, { title, maxTasks }).drafts;
    planner = "heuristic";
  }

  // Dedup against recent + in-flight company work: the planner re-proposes the
  // same steps each re-dispatch cycle, and without this the board fills with
  // redundant tasks (the "80 deliverables from one goal" churn). Only applied when
  // the caller supplies the recent titles (the driver does; an explicit manual
  // Launch does not — that stays a deliberate force-fresh dispatch).
  let deduped = 0;
  if (opts.recentCompanyTaskTitles?.length) {
    const { fresh, dropped } = dedupeDrafts(drafts, opts.recentCompanyTaskTitles);
    deduped = dropped.length;
    if (dropped.length) {
      console.log(`[company-dispatch] ${company.id}: dropped ${dropped.length}/${drafts.length} planned task(s) already recent or in flight`);
    }
    // Surviving drafts' dependency indexes still point into the pre-dedupe array.
    drafts = remapDraftDependencies(drafts, fresh);
  }
  if (drafts.length === 0) {
    // Everything the planner proposed is already recent or in flight — nothing new
    // to do this cycle. Not an error; the driver backs off and re-checks later.
    return { goal, taskCount: 0, delegatedCount: 0, pickupCount: 0, dispatchableMembers, planner, tasks: [], deduped, frontierLab };
  }

  const companyRun = await startCompanyRun(company.id, {
    kind: "dispatch",
    title: `Dispatch: ${goal}`,
    actor: "company-autonomy",
    snapshot: {
      companyName: company.name,
      apexGoal: goal,
      apexMetric: company.apexGoal?.metric,
      apexTarget: company.apexGoal?.target,
      productCount: company.products?.items.length ?? 0,
      products: company.products?.items,
      directiveCount: company.directives?.length ?? 0,
      agentCount: company.agentIds.length,
      autonomy: company.autonomy,
      frozen: company.frozen,
      frontierLab,
    },
    input: {
      planner,
      dispatchableMembers,
      deduped,
      draftTitles: drafts.map((draft) => draft.title),
      recentTitleCount: opts.recentCompanyTaskTitles?.length ?? 0,
      frontierLab,
    },
  });

  // The company-run id keeps each explicit "Launch / Re-launch" a fresh
  // queen-bee intent (distinct fingerprint) while linking Work Board tasks back
  // to the durable company trace.
  const runId = companyRun.id;

  const workerContext = companyWorkerContext(company, workerMemory, salesContentContext);
  const tasks: CompanyDispatchTask[] = [];
  // Draft index → created task id, so planner `dependsOn` edges become board
  // parent links (same mapping createQueenBeePrdTasks uses). A failed submit
  // leaves no id and its dependents simply drop that edge.
  const draftTaskIdByIndex = new Map<number, string>();
  let firstError: Error | null = null;
  // Sequential: each submit reads+writes the shared board file; avoid clobbering.
  // One failing draft must not abort the whole dispatch.
  for (let draftIndex = 0; draftIndex < drafts.length; draftIndex += 1) {
    const draft = drafts[draftIndex]!;
    try {
      const parents = (draft.dependsOnDraftIndexes ?? []).flatMap((dependsIndex) => {
        const id = draftTaskIdByIndex.get(dependsIndex);
        return id ? [id] : [];
      });
      const result = await submitQueenBeeMessage({
        message: `${draft.body}\n${workerContext}`,
        taskTitle: draft.title,
        mode: "act",
        priority: "high",
        source: `company:${company.id}:${runId}`,
        fleetSnapshot: scoped,
        skills: frontierPolicy
          ? [...new Set([...(draft.skills ?? []), `frontier-lab:tier:${classifyFrontierLabTaskTier(draft)}`])]
          : draft.skills,
        loop: buildCompanyLearningLoop(company, draft, runId),
        workspace: companyTaskWorkspace(company, draft),
        // The company's domain repo: routes code work toward machines with the
        // checkout and gives the task the project's GitLawb proof badge.
        projectId: company.projectId,
        parents: parents.length ? parents : undefined,
        vaultPath: opts.vaultPath,
      });
      draftTaskIdByIndex.set(draftIndex, result.task.id);
      tasks.push({
        taskId: result.task.id,
        title: result.task.title,
        assignee: result.task.assignee,
        delegated: result.route?.delegation?.status === "delegated",
        pickupScheduled: Boolean(result.route?.autonomousPickupScheduled),
      });
    } catch (error) {
      if (!firstError) firstError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (tasks.length === 0) {
    await finishCompanyRun(company.id, companyRun.id, {
      status: "failed",
      summary: firstError?.message ?? "No tasks could be dispatched.",
    }).catch(() => undefined);
    throw firstError ?? new Error("No tasks could be dispatched.");
  }

  await appendCompanyMemory(company.id, {
    kind: "dispatch",
    title: `Dispatched ${tasks.length} task(s) toward "${goal}" (${planner} plan)`,
    detail: tasks.map((t) => t.title).join(" · "),
  }).catch(() => undefined);
  await appendCompanyGovernanceProof({
    companyId: company.id,
    companyName: company.name,
    event: "dispatch",
    payload: { goal, runId, planner, taskIds: tasks.map((t) => t.taskId), taskCount: tasks.length, frontierLab },
  }).catch(() => undefined);
  await appendCompanyRunEvent(company.id, companyRun.id, {
    kind: "tasks-created",
    title: `Created ${tasks.length} Work Board task(s)`,
    detail: tasks.map((t) => t.title).join(" · "),
    data: {
      taskIds: tasks.map((t) => t.taskId),
      delegatedCount: tasks.filter((t) => t.delegated).length,
      pickupCount: tasks.filter((t) => t.pickupScheduled).length,
    },
  }).catch(() => undefined);
  await finishCompanyRun(company.id, companyRun.id, {
    status: "completed",
    output: {
      planner,
      taskIds: tasks.map((t) => t.taskId),
      taskCount: tasks.length,
      delegatedCount: tasks.filter((t) => t.delegated).length,
      pickupCount: tasks.filter((t) => t.pickupScheduled).length,
      firstError: firstError?.message,
    },
  }).catch(() => undefined);

  return {
    goal,
    taskCount: tasks.length,
    delegatedCount: tasks.filter((t) => t.delegated).length,
    pickupCount: tasks.filter((t) => t.pickupScheduled).length,
    dispatchableMembers,
    planner,
    companyRunId: companyRun.id,
    tasks,
    deduped,
    frontierLab,
  };
}
