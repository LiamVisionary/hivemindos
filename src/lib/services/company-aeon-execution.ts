import "server-only";

import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { Company } from "@/lib/types/company";
import { appendCompanyGovernanceProof } from "@/lib/services/company-governance";
import { appendCompanyMemory } from "@/lib/services/company-memory";
import {
  appendCompanyRunEvent,
  finishCompanyRun,
  startCompanyRun,
} from "@/lib/services/company-runs";
import {
  resolveCompanyAeonBinding,
  type CompanyAeonBinding,
} from "@/lib/services/company-aeon-binding";
import {
  dispatchAeonSkill,
  type AeonSkillDispatchResult,
} from "@/lib/services/runtime-adapters/aeon";
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
  const evaluation = await evaluateCompletionEvent({
    id: companyRun.id,
    surface: "aeon",
    status: "completed",
    observed: false,
    output: "",
    startedAt: Date.parse(companyRun.createdAt),
    completedAt: Date.now(),
    metadata: { profileId: profile.id, skill, source: dispatch.source },
  });
  await finishCompanyRun(company.id, companyRun.id, {
    status: "completed",
    summary: `AEON accepted ${skill} for background execution.`,
    output: {
      executionEngine: "aeon",
      externalRunCount: 1,
      aeonProfileId: profile.id,
      aeonSkill: skill,
      source: dispatch.source,
      evaluation,
    },
  }).catch(() => undefined);

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
