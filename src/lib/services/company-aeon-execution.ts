import "server-only";

import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { Company } from "@/lib/types/company";
import { appendCompanyGovernanceProof } from "@/lib/services/company-governance";
import { appendCompanyMemory, readCompanyMemory } from "@/lib/services/company-memory";
import {
  appendCompanyRunEvent,
  finishCompanyRun,
  listCompanyRuns,
  startCompanyRun,
} from "@/lib/services/company-runs";
import {
  resolveCompanyAeonBinding,
  type CompanyAeonBinding,
} from "@/lib/services/company-aeon-binding";
import {
  dispatchAeonSkill,
  listAeonRuns,
  type AeonSkillDispatchResult,
} from "@/lib/services/runtime-adapters/aeon";
import type { RuntimeRun } from "@/lib/services/runtime-adapters/types";
import { evaluateCompletionEvent } from "@/lib/services/evaluation/control-plane";

type CompanyAeonExecutionDependencies = {
  resolveBinding: (
    profileId: string,
    skill: string,
    options: { vaultPath?: string },
  ) => Promise<CompanyAeonBinding>;
  dispatchSkill: (
    profile: AgentProfile,
    skill: string,
    overrides: { var?: string; model?: string },
  ) => Promise<AeonSkillDispatchResult>;
};

const DEFAULT_DEPENDENCIES: CompanyAeonExecutionDependencies = {
  resolveBinding: resolveCompanyAeonBinding,
  dispatchSkill: dispatchAeonSkill,
};

export type CompanyAeonDispatchResult = {
  goal: string;
  taskCount: 0;
  delegatedCount: 0;
  pickupCount: 0;
  dispatchableMembers: 0;
  planner: "aeon";
  executionEngine: "aeon";
  externalRunCount: 1;
  tasks: [];
  companyRunId: string;
  aeon: {
    profileId: string;
    profileName: string;
    skill: string;
    source: AeonSkillDispatchResult["source"];
  };
};

function compactAeonInput(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_ .\-/#@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the bounded `var` input carried into the selected AEON skill. */
export function buildCompanyAeonVariable(company: Company): string {
  const goal = company.apexGoal?.title?.trim() || company.name;
  const parts = [
    `Company ${company.name}.`,
    `Goal ${goal}.`,
    company.apexGoal?.metric ? `Metric ${company.apexGoal.metric}.` : "",
    company.apexGoal?.target ? `Target ${company.apexGoal.target}.` : "",
    company.blurb || company.charter ? `Charter ${company.blurb || company.charter}.` : "",
    company.directives?.length
      ? `Current directives ${company.directives.slice(-3).map((directive) => directive.text).join(". ")}.`
      : "",
  ].filter(Boolean);
  return compactAeonInput(parts.join(" ")).slice(0, 1_000);
}

export async function dispatchCompanyWithAeon(
  company: Company,
  options: { vaultPath?: string } = {},
  dependencies: Partial<CompanyAeonExecutionDependencies> = {},
): Promise<CompanyAeonDispatchResult> {
  if (company.execution?.engine !== "aeon") {
    throw new Error("This company is not configured to use AEON.");
  }
  const execution = company.execution;
  const goal = company.apexGoal?.title?.trim();
  if (!goal) throw new Error("Set an apex goal before launching AEON automation.");

  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const skill = execution.skill;
  const { profile } = await deps.resolveBinding(execution.profileId, skill, options);
  const variable = buildCompanyAeonVariable(company);
  const companyRun = await startCompanyRun(company.id, {
    kind: "dispatch",
    title: `AEON dispatch: ${skill}`,
    actor: `aeon:${profile.id}`,
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
      executionEngine: "aeon",
      aeonProfileId: profile.id,
      aeonSkill: skill,
      variable,
    },
  });

  let dispatch: AeonSkillDispatchResult;
  try {
    dispatch = await deps.dispatchSkill(profile, skill, { var: variable });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AEON dispatch failed.";
    await finishCompanyRun(company.id, companyRun.id, { status: "failed", summary: message }).catch(() => undefined);
    throw error;
  }

  await appendCompanyRunEvent(company.id, companyRun.id, {
    kind: "aeon-dispatched",
    title: `Dispatched ${skill} through ${profile.name}`,
    detail: `AEON accepted the company goal through ${dispatch.source}. Outputs remain in the selected AEON workspace and its run history.`,
    data: { profileId: profile.id, skill, source: dispatch.source },
  }).catch(() => undefined);
  await appendCompanyMemory(company.id, {
    kind: "dispatch",
    title: `Dispatched AEON skill ${skill} toward "${goal}"`,
    detail: `${profile.name} accepted the run through ${dispatch.source}.`,
  }).catch(() => undefined);
  await appendCompanyGovernanceProof({
    companyId: company.id,
    companyName: company.name,
    event: "dispatch",
    payload: { goal, executionEngine: "aeon", aeonProfileId: profile.id, aeonSkill: skill, source: dispatch.source },
  }).catch(() => undefined);
  // Dispatch-accept is NOT completion: the company run stays "running" until
  // syncCompanyAeonOutcomes observes the workspace run's terminal state. Finishing
  // here marked every accepted dispatch COMPLETED with an unobserved evaluation,
  // so planning never saw outcomes and failing external runs were invisible.

  return {
    goal,
    taskCount: 0,
    delegatedCount: 0,
    pickupCount: 0,
    dispatchableMembers: 0,
    planner: "aeon",
    executionEngine: "aeon",
    externalRunCount: 1,
    tasks: [],
    companyRunId: companyRun.id,
    aeon: {
      profileId: profile.id,
      profileName: profile.name,
      skill,
      source: dispatch.source,
    },
  };
}

type CompanyAeonOutcomeSweepDependencies = {
  resolveBinding: CompanyAeonExecutionDependencies["resolveBinding"];
  listRuns: (profile: AgentProfile) => Promise<RuntimeRun[]>;
};

const DEFAULT_SWEEP_DEPENDENCIES: CompanyAeonOutcomeSweepDependencies = {
  resolveBinding: resolveCompanyAeonBinding,
  listRuns: (profile) => listAeonRuns(profile, { strict: true }),
};

/** GitHub/AEON clocks can trail the dispatching machine slightly; a workspace run
 *  created within this window before the open dispatch still counts as its run. */
const AEON_RUN_CORRELATION_SLACK_MS = 2 * 60_000;

function parseRunEpochMs(value: string | undefined): number | null {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Fold terminal AEON workspace runs back into the company: the driver-tick
 * counterpart of syncCompanyTaskOutcomes for external (AEON-engined) execution.
 * For each company with an OPEN aeon dispatch run, list the workspace's runs and,
 * for every newly-terminal one since that dispatch, idempotently append a
 * task-completed/task-blocked memory record (deduped on data.aeonRunId in the
 * same ledger syncCompanyTaskOutcomes uses) and finish the corresponding company
 * run — completed or failed — with an OBSERVED evaluation, so planning finally
 * sees external outcomes and a failing run stops looking like success.
 * Returns the number of outcomes recorded.
 */
export async function syncCompanyAeonOutcomes(
  companies: Company[],
  options: { vaultPath?: string } = {},
  dependencies: Partial<CompanyAeonOutcomeSweepDependencies> = {},
): Promise<number> {
  const deps = { ...DEFAULT_SWEEP_DEPENDENCIES, ...dependencies };
  let recorded = 0;
  for (const company of companies) {
    if (company.execution?.engine !== "aeon") continue;
    const execution = company.execution;
    try {
      const ledger = await listCompanyRuns(company.id, { runLimit: 100 });
      const openDispatches = ledger.runs
        .filter((run) => run.status === "running" && run.kind === "dispatch" && run.input?.executionEngine === "aeon")
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      if (openDispatches.length === 0) continue; // nothing outstanding — skip the workspace lookup
      const { profile } = await deps.resolveBinding(execution.profileId, execution.skill, options);
      const workspaceRuns = await deps.listRuns(profile);
      const seen = new Set(
        (await readCompanyMemory(company.id, { limit: 2_000 }))
          .map((record) => record.data?.aeonRunId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      );
      const windowStart = Date.parse(openDispatches[0].createdAt) - AEON_RUN_CORRELATION_SLACK_MS;
      const newlyTerminal = workspaceRuns
        .filter((run) => run.status === "completed" || run.status === "failed")
        .filter((run) => {
          const startedAt = parseRunEpochMs(run.createdAt) ?? parseRunEpochMs(run.updatedAt);
          return startedAt !== null && startedAt >= windowStart && !seen.has(run.id);
        })
        .sort((a, b) => (parseRunEpochMs(a.createdAt) ?? 0) - (parseRunEpochMs(b.createdAt) ?? 0));
      for (const run of newlyTerminal) {
        const succeeded = run.status === "completed";
        const finishedAt = parseRunEpochMs(run.updatedAt) ?? parseRunEpochMs(run.createdAt) ?? Date.now();
        await appendCompanyMemory(company.id, {
          kind: succeeded ? "task-completed" : "task-blocked",
          title: succeeded ? `AEON run finished: ${run.name}` : `AEON run failed: ${run.name}`,
          detail: [
            run.conclusion ? `Conclusion ${run.conclusion}.` : "",
            run.url ? `Run ${run.url}` : "",
          ].filter(Boolean).join(" ") || undefined,
          agent: `aeon:${profile.id}`,
          at: finishedAt,
          data: { aeonRunId: run.id, aeonSkill: execution.skill },
        });
        recorded += 1;
        const companyRun = openDispatches.shift();
        if (!companyRun) continue; // workspace ran more than we dispatched — memory only
        const summary = `AEON run ${run.name} (${run.id}) finished with status ${run.status}${run.conclusion ? ` (${run.conclusion})` : ""}.`;
        const evaluation = await evaluateCompletionEvent({
          id: companyRun.id,
          surface: "aeon",
          status: succeeded ? "completed" : "failed",
          observed: true,
          output: summary,
          startedAt: Date.parse(companyRun.createdAt),
          completedAt: finishedAt,
          metadata: {
            profileId: profile.id,
            skill: execution.skill,
            aeonRunId: run.id,
            ...(run.url ? { url: run.url } : {}),
          },
        });
        await appendCompanyRunEvent(company.id, companyRun.id, {
          kind: succeeded ? "aeon-run-completed" : "aeon-run-failed",
          title: succeeded ? `AEON run completed: ${run.name}` : `AEON run failed: ${run.name}`,
          detail: run.url,
          data: { aeonRunId: run.id, status: run.status, conclusion: run.conclusion ?? undefined },
        }).catch(() => undefined);
        await finishCompanyRun(company.id, companyRun.id, {
          status: succeeded ? "completed" : "failed",
          summary,
          output: {
            executionEngine: "aeon",
            externalRunCount: 1,
            aeonProfileId: profile.id,
            aeonSkill: execution.skill,
            aeonRunId: run.id,
            ...(run.url ? { aeonRunUrl: run.url } : {}),
            evaluation,
          },
        }).catch(() => undefined);
      }
    } catch (error) {
      console.warn(`[company-aeon] outcome sweep failed for ${company.id}:`, error instanceof Error ? error.message : error);
    }
  }
  return recorded;
}
