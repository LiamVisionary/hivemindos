import type { CompanyExecutionConfig } from "@/lib/types/company";
import { isValidAeonSkillSlug } from "@/lib/services/runtime-adapters/aeon-identifiers";

export type CompanyExecutionEngine = CompanyExecutionConfig["engine"];

export type CompanyExecutionSelection = {
  executionEngine: CompanyExecutionEngine;
  aeonProfileId: string;
  aeonSkill: string;
};

type CompanyExecutionFormFields = Partial<CompanyExecutionSelection>;

type CompanyExecutionParseResult =
  | { ok: true; value: CompanyExecutionConfig }
  | { ok: false; error: string };

export const COMPANY_EXECUTION_ENGINE_MATRIX = {
  hivemind: {
    label: "HivemindOS crew",
    description: "Plan Work Board tasks and route them across the company's eligible agents.",
    outputSurface: "Work Board + Runs",
    autonomy: {
      requiresCompanyCrew: true,
      requiresOnlineCrew: true,
      activityAuthority: "work-board",
    },
  },
  aeon: {
    label: "AEON background skill",
    description: "Dispatch one selected AEON skill with the company goal on each autonomy cycle.",
    outputSurface: "AEON outputs + company Runs",
    autonomy: {
      requiresCompanyCrew: false,
      requiresOnlineCrew: false,
      activityAuthority: "aeon-workspace",
    },
  },
} as const satisfies Record<
  CompanyExecutionEngine,
  {
    label: string;
    description: string;
    outputSurface: string;
    autonomy: {
      requiresCompanyCrew: boolean;
      requiresOnlineCrew: boolean;
      activityAuthority: "work-board" | "aeon-workspace";
    };
  }
>;

export const COMPANY_EXECUTION_ENGINE_OPTIONS = (
  Object.entries(COMPANY_EXECUTION_ENGINE_MATRIX) as Array<
    [CompanyExecutionEngine, (typeof COMPANY_EXECUTION_ENGINE_MATRIX)[CompanyExecutionEngine]]
  >
).map(([value, capability]) => ({ value, label: capability.label }));

export function companyExecutionCapability(execution?: CompanyExecutionConfig | null) {
  return COMPANY_EXECUTION_ENGINE_MATRIX[execution?.engine ?? "hivemind"];
}

export function companyExecutionConfigFromForm(
  value: CompanyExecutionFormFields,
): CompanyExecutionConfig {
  return value.executionEngine === "aeon"
    ? {
        engine: "aeon",
        profileId: value.aeonProfileId?.trim() ?? "",
        skill: value.aeonSkill?.trim() ?? "",
      }
    : { engine: "hivemind" };
}

export function companyExecutionFormFromConfig(
  execution?: CompanyExecutionConfig | null,
): CompanyExecutionSelection {
  return execution?.engine === "aeon"
    ? {
        executionEngine: "aeon",
        aeonProfileId: execution.profileId,
        aeonSkill: execution.skill,
      }
    : { executionEngine: "hivemind", aeonProfileId: "", aeonSkill: "" };
}

export function parseCompanyExecutionConfig(value: unknown): CompanyExecutionParseResult {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Choose a valid company autonomy engine." };
  }
  const input = value as Record<string, unknown>;
  if (input.engine === "hivemind") {
    return { ok: true, value: { engine: "hivemind" } };
  }
  if (input.engine !== "aeon") {
    return { ok: false, error: "Choose a valid company autonomy engine." };
  }
  const profileId = typeof input.profileId === "string" ? input.profileId.trim() : "";
  if (!profileId) {
    return { ok: false, error: "Choose an AEON workspace before saving this company." };
  }
  const skill = typeof input.skill === "string" ? input.skill.trim() : "";
  if (!isValidAeonSkillSlug(skill)) {
    return { ok: false, error: "Choose a valid AEON skill before saving this company." };
  }
  return { ok: true, value: { engine: "aeon", profileId, skill } };
}

export function normalizeCompanyExecutionConfig(
  value: unknown,
): CompanyExecutionConfig | undefined {
  const parsed = parseCompanyExecutionConfig(value);
  return parsed.ok ? parsed.value : undefined;
}

export function isCompleteCompanyExecutionSelection(
  value: CompanyExecutionFormFields,
): boolean {
  return parseCompanyExecutionConfig(companyExecutionConfigFromForm(value)).ok;
}

export function buildCompanyRuntimeMix(
  execution: CompanyExecutionConfig | null | undefined,
  runtimes: Iterable<string>,
  limit = 3,
): string[] {
  const aeonRuntime = execution?.engine === "aeon" ? `AEON · ${execution.skill}` : null;
  return [
    ...(aeonRuntime ? [aeonRuntime] : []),
    ...new Set(runtimes),
  ].slice(0, limit);
}
