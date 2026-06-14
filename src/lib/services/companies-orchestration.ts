import "server-only";

import type { Company } from "@/lib/types/company";
import { decomposePrdToTaskDrafts } from "@/lib/services/queen-bee/prd-decomposition";
import { submitQueenBeeMessage, type QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";

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

/** Mirror of the queen-bee router's chat-capability gate (kept dependency-free). */
function isMemberChatCapable(
  agent: NonNullable<QueenBeeFleetMachine["agents"]>[number],
  machineCapabilities?: Record<string, unknown>,
): boolean {
  const runtime = (agent.runtime || "").toLowerCase();
  if (runtime === "hermes" || runtime === "aeon" || runtime === "openclaw") return true;
  if (agent.runtimeCapabilities?.chat) return true;
  if (agent.collectorCapabilities?.chat) return true;
  if (machineCapabilities?.chat) return true;
  return false;
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
  tasks: CompanyDispatchTask[];
};

export async function dispatchCompanyGoal(
  company: Company,
  fleetSnapshot: QueenBeeFleetMachine[],
  opts: { maxTasks?: number } = {},
): Promise<CompanyDispatchResult> {
  const goal = company.apexGoal?.title?.trim();
  if (!goal) throw new Error("Set an apex goal before launching work.");
  if (!company.agentIds?.length) throw new Error("Staff the company with at least one agent first.");

  const scoped = scopeFleetToMembers(fleetSnapshot, company.agentIds);
  const dispatchableMembers = countDispatchableMembers(scoped);
  const { prd, title } = buildApexBrief(company);
  const { drafts } = decomposePrdToTaskDrafts(prd, { title, maxTasks: Math.max(1, Math.min(opts.maxTasks ?? 6, 8)) });

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
    tasks,
  };
}
