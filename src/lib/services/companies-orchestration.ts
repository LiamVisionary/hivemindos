import "server-only";

import type { Company, CompanyProcess } from "@/lib/types/company";
import { decomposePrdToTaskDrafts, type QueenBeePrdTaskDraft } from "@/lib/services/queen-bee/prd-decomposition";
import { submitQueenBeeMessage, type QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";
import { llmDecomposeApexGoal } from "@/lib/services/companies-goal-planner";
import { appendCompanyGovernanceProof } from "@/lib/services/company-governance";
import { appendCompanyMemory, companyMemoryDigest } from "@/lib/services/company-memory";
import { dedupeDrafts } from "@/lib/services/company-task-dedup";
import type { KanbanLoopSpec } from "@/lib/types/kanban";
import { buildOperatingUnitLearningLoop } from "@/lib/services/loops";
import type { FlowSpec } from "@/lib/types/agent-flow";
import { flowFromSequence, getFlowTemplate } from "@/lib/services/queen-bee/flow-templates";
import { startFlowRun } from "@/lib/services/queen-bee/flow-runner";

/**
 * Company orchestration bridge: turn a company's apex goal into a per-role work
 * plan and dispatch each task through the EXISTING queen-bee engine
 * (submitQueenBeeMessage), scoped to the company's member agents. The queen-bee
 * engine routes each task to the best member in the supplied fleet snapshot,
 * creates the Work Board card, and schedules autonomous pickup (claim → the
 * agent's collector /chat → complete). Spend during that work is already
 * company-governed via getCompanyForAgent, so the company budget + kill switch
 * bind without any extra wiring here.
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

/** Build a structured PRD brief from the apex goal + the crew's roles. */
export function buildApexBrief(company: Company): { prd: string; title: string } {
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
export function companyWorkerContext(company: Company, memoryDigest: string): string {
  const apex = company.apexGoal;
  const metricLine = apex?.metric || apex?.target
    ? `Metric: ${apex?.metric || "—"}${apex?.target ? ` → target ${apex.target}` : ""}${apex?.current ? ` (current ${apex.current})` : ""}`
    : "";
  const mission = (company.blurb || company.charter || "").trim();
  const lines = [
    "",
    "---",
    `Company: ${company.name}${company.sector ? ` (${company.sector})` : ""}`,
    apex?.title?.trim() ? `Apex goal: ${apex.title.trim()}` : "",
    metricLine,
    mission ? `Charter: ${mission}` : "",
  ];
  const digest = memoryDigest.trim();
  if (digest) lines.push("", "What the company has done recently (newest first):", digest);
  lines.push(
    "",
    "Do not repeat work listed as DONE above. Record a concrete, durable result on the Work Board — it becomes company memory for the next cycle.",
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

export type CompanyDispatchResult = {
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
  process?: CompanyProcess;
  /** How many planned drafts were dropped as duplicates of recent/in-flight work. */
  deduped?: number;
};

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
    const { prd, title } = buildApexBrief(company);
    const drafts = decomposePrdToTaskDrafts(prd, { title, maxTasks }).drafts;
    spec = planCompanyFlowSpec(company, drafts);
  }

  const run = await startFlowRun(spec, {
    vaultPath: opts.vaultPath,
    fleetSnapshot: scoped,
    priority: "high",
    state: { topic: goal, goal },
  });

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

  return {
    goal,
    taskCount: spec.nodes.filter((n) => n.kind === "task").length,
    delegatedCount: 0,
    pickupCount: 0,
    dispatchableMembers,
    planner: "flow",
    flowRunId: run.runId,
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
    governanceLabel: "company governance",
  });
}

export async function dispatchCompanyGoal(
  company: Company,
  fleetSnapshot: QueenBeeFleetMachine[],
  opts: { maxTasks?: number; origin?: string; vaultPath?: string; recentCompanyTaskTitles?: string[] } = {},
): Promise<CompanyDispatchResult> {
  const goal = company.apexGoal?.title?.trim();
  if (!goal) throw new Error("Set an apex goal before launching work.");
  if (!company.agentIds?.length) throw new Error("Staff the company with at least one agent first.");

  // Sequential/graph processes run as an agent flow; hierarchical (default) fans tasks out below.
  if (company.process === "sequential" || company.process === "graph") {
    return dispatchCompanyFlow(company, fleetSnapshot, opts);
  }

  const scoped = scopeFleetToMembers(fleetSnapshot, company.agentIds);
  const dispatchableMembers = countDispatchableMembers(scoped);
  const maxTasks = Math.max(1, Math.min(opts.maxTasks ?? 6, 8));

  // Company memory makes each cycle incremental: the planner sees a longer digest
  // (plan the NEXT batch), each worker body a shorter one (don't run cold).
  const plannerMemory = await companyMemoryDigest(company.id, { maxChars: 1_600 }).catch(() => "");
  const workerMemory = plannerMemory.length > 900 ? `${plannerMemory.slice(0, 899)}…` : plannerMemory;

  // Prefer an LLM-authored, goal-specific plan via queen-bee's brain order
  // (the company's own agent first, then OpenAI). Fall back to the deterministic
  // per-role heuristic brief when no brain is reachable, so dispatch never blocks.
  let drafts: QueenBeePrdTaskDraft[];
  let planner: "llm" | "heuristic";
  const llmDrafts = await llmDecomposeApexGoal(company, { origin: opts.origin, vaultPath: opts.vaultPath, maxTasks, history: plannerMemory }).catch(() => null);
  if (llmDrafts && llmDrafts.length > 0) {
    drafts = llmDrafts;
    planner = "llm";
  } else {
    const { prd, title } = buildApexBrief(company);
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
    drafts = fresh;
  }
  if (drafts.length === 0) {
    // Everything the planner proposed is already recent or in flight — nothing new
    // to do this cycle. Not an error; the driver backs off and re-checks later.
    return { goal, taskCount: 0, delegatedCount: 0, pickupCount: 0, dispatchableMembers, planner, tasks: [], deduped };
  }

  // A per-dispatch run id keeps each explicit "Launch / Re-launch" a fresh queen-bee
  // intent (distinct fingerprint) so it actually creates tasks + schedules pickup,
  // instead of de-duping against a prior identical dispatch.
  const runId = `${Date.now().toString(36)}`;

  const workerContext = companyWorkerContext(company, workerMemory);
  const tasks: CompanyDispatchTask[] = [];
  let firstError: Error | null = null;
  // Sequential: each submit reads+writes the shared board file; avoid clobbering.
  // One failing draft must not abort the whole dispatch.
  for (const draft of drafts) {
    try {
      const result = await submitQueenBeeMessage({
        message: `${draft.body}\n${workerContext}`,
        taskTitle: draft.title,
        mode: "act",
        priority: "high",
        source: `company:${company.id}:${runId}`,
        fleetSnapshot: scoped,
        skills: draft.skills,
        loop: buildCompanyLearningLoop(company, draft, runId),
        // The company's domain repo: routes code work toward machines with the
        // checkout and gives the task the project's GitLawb proof badge.
        projectId: company.projectId,
        vaultPath: opts.vaultPath,
      });
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
  if (tasks.length === 0) throw firstError ?? new Error("No tasks could be dispatched.");

  await appendCompanyMemory(company.id, {
    kind: "dispatch",
    title: `Dispatched ${tasks.length} task(s) toward "${goal}" (${planner} plan)`,
    detail: tasks.map((t) => t.title).join(" · "),
  }).catch(() => undefined);
  await appendCompanyGovernanceProof({
    companyId: company.id,
    companyName: company.name,
    event: "dispatch",
    payload: { goal, runId, planner, taskIds: tasks.map((t) => t.taskId), taskCount: tasks.length },
  }).catch(() => undefined);

  return {
    goal,
    taskCount: tasks.length,
    delegatedCount: tasks.filter((t) => t.delegated).length,
    pickupCount: tasks.filter((t) => t.pickupScheduled).length,
    dispatchableMembers,
    planner,
    tasks,
    deduped,
  };
}
