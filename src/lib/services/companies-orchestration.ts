import "server-only";

import type { Company } from "@/lib/types/company";
import { decomposePrdToTaskDrafts, type QueenBeePrdTaskDraft } from "@/lib/services/queen-bee/prd-decomposition";
import { submitQueenBeeMessage, type QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";
import { llmDecomposeApexGoal } from "@/lib/services/companies-goal-planner";
import type { KanbanEvalGate, KanbanLoopSpec } from "@/lib/types/kanban";

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
  /** "llm" when the LLM brain authored the plan, "heuristic" when it fell back. */
  planner: "llm" | "heuristic";
  tasks: CompanyDispatchTask[];
};

function companyEvalGate(id: string, title: string, verifier: string, createdAt: number): KanbanEvalGate {
  return {
    id,
    title,
    kind: "receipt",
    phase: "post",
    required: false,
    status: "pending",
    verifier,
    createdAt,
  };
}

/**
 * Evo-style private optimization loop for every company-dispatched task. Gates
 * are intentionally non-blocking at creation time: agents can ship useful work
 * without being trapped by missing receipts, while the company still accumulates
 * eval/experiment structure that future distillers and Evo runs can strengthen.
 */
function buildCompanyLearningLoop(company: Company, draft: QueenBeePrdTaskDraft, runId: string): KanbanLoopSpec {
  const now = Date.now();
  const metric = company.apexGoal?.metric?.trim() || "business outcome";
  const target = company.apexGoal?.target?.trim();
  const goal = company.apexGoal?.title?.trim() || company.name;
  const gatePrefix = `company-${company.id}-${runId}-${draft.title}`.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);

  return {
    mode: "optimizer",
    goal: `${draft.title}: improve "${goal}" while preserving the company's charter, budget, and evidence trail.`,
    successCriteria: [
      target ? `${metric} moves toward ${target}.` : `${metric} has measurable evidence of improvement or a clear next measurement.`,
      "The result includes reusable company learning: artifact, workflow, decision, customer signal, or anti-pattern.",
      "Any spend or external action stays inside company governance.",
    ],
    evalGates: [
      companyEvalGate(`${gatePrefix}-outcome`, `Outcome evidence for ${metric}`, "company-private-eval", now),
      companyEvalGate(`${gatePrefix}-learning`, "Reviewed learning distillation candidate", "company-memory-distiller", now),
      companyEvalGate(`${gatePrefix}-governance`, "Budget and policy constraints respected", "company-governance", now),
    ],
    benchmark: {
      target: target ? `${metric} -> ${target}` : metric,
      metricName: metric,
      metricDirection: "max",
      instrumentation: "manual",
      discoveredAt: now,
      notes: [
        "Created from zero-human company dispatch.",
        "Compatible with Evo-style branch scoring: task receipts can later become per-task benchmark scores.",
      ],
    },
    frontierStrategy: {
      kind: "pareto_per_task",
      params: { k: 5, task_floor: 0 },
      seed: now,
    },
    experiments: [
      {
        id: `exp_${runId}_${Math.abs(hashCode(draft.title)).toString(36)}`,
        title: draft.title,
        hypothesis: `This work item is a branch toward the company apex goal: ${goal}.`,
        status: "candidate",
        agent: draft.skills?.[0],
        createdAt: now,
        updatedAt: now,
      },
    ],
    antiPatterns: [],
    budget: {
      maxAttempts: 3,
      maxRuntimeMs: 60 * 60 * 1000,
    },
    retryPolicy: {
      maxAttempts: 3,
      onFailure: "needs-human",
    },
    handoffRules: [
      "Prefer recording evidence and reusable learning over only marking the task done.",
      "Escalate irreversible external actions or budget exceptions for human approval.",
    ],
    evidenceRequired: [
      "Outcome evidence tied to the apex metric.",
      "Reusable company learning or a clear reason none was found.",
      "Artifacts, receipts, links, or test output when available.",
    ],
  };
}

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return hash;
}

export async function dispatchCompanyGoal(
  company: Company,
  fleetSnapshot: QueenBeeFleetMachine[],
  opts: { maxTasks?: number; origin?: string; vaultPath?: string } = {},
): Promise<CompanyDispatchResult> {
  const goal = company.apexGoal?.title?.trim();
  if (!goal) throw new Error("Set an apex goal before launching work.");
  if (!company.agentIds?.length) throw new Error("Staff the company with at least one agent first.");

  const scoped = scopeFleetToMembers(fleetSnapshot, company.agentIds);
  const dispatchableMembers = countDispatchableMembers(scoped);
  const maxTasks = Math.max(1, Math.min(opts.maxTasks ?? 6, 8));

  // Prefer an LLM-authored, goal-specific plan via queen-bee's brain order
  // (the company's own agent first, then OpenAI). Fall back to the deterministic
  // per-role heuristic brief when no brain is reachable, so dispatch never blocks.
  let drafts: QueenBeePrdTaskDraft[];
  let planner: "llm" | "heuristic";
  const llmDrafts = await llmDecomposeApexGoal(company, { origin: opts.origin, vaultPath: opts.vaultPath, maxTasks }).catch(() => null);
  if (llmDrafts && llmDrafts.length > 0) {
    drafts = llmDrafts;
    planner = "llm";
  } else {
    const { prd, title } = buildApexBrief(company);
    drafts = decomposePrdToTaskDrafts(prd, { title, maxTasks }).drafts;
    planner = "heuristic";
  }

  // A per-dispatch run id keeps each explicit "Launch / Re-launch" a fresh queen-bee
  // intent (distinct fingerprint) so it actually creates tasks + schedules pickup,
  // instead of de-duping against a prior identical dispatch.
  const runId = `${Date.now().toString(36)}`;

  const tasks: CompanyDispatchTask[] = [];
  let firstError: Error | null = null;
  // Sequential: each submit reads+writes the shared board file; avoid clobbering.
  // One failing draft must not abort the whole dispatch.
  for (const draft of drafts) {
    try {
      const result = await submitQueenBeeMessage({
        message: draft.body,
        taskTitle: draft.title,
        mode: "act",
        priority: "high",
        source: `company:${company.id}:${runId}`,
        fleetSnapshot: scoped,
        skills: draft.skills,
        loop: buildCompanyLearningLoop(company, draft, runId),
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

  return {
    goal,
    taskCount: tasks.length,
    delegatedCount: tasks.filter((t) => t.delegated).length,
    pickupCount: tasks.filter((t) => t.pickupScheduled).length,
    dispatchableMembers,
    planner,
    tasks,
  };
}
