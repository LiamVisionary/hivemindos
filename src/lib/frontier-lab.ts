import type {
  CompanyFrontierLabModel,
  CompanyFrontierLabPolicy,
  CompanyFrontierLabStage,
  CompanyFrontierLabTaskTier,
} from "@/lib/types/company";

export const FRONTIER_LAB_MODEL_LADDER: Readonly<Record<CompanyFrontierLabTaskTier, CompanyFrontierLabModel>> = {
  scout: "gpt-5.6-luna",
  builder: "gpt-5.6-terra",
  reviewer: "gpt-5.6-sol",
};

export interface FrontierLabStageProfile {
  stage: CompanyFrontierLabStage;
  label: string;
  maxParallelTasks: number;
  maxTasksPerCycle: number;
  maxPerMachineConcurrency: number;
  requiredSettledTasks: number;
  requiredSuccessRate: number;
}

export const FRONTIER_LAB_STAGE_PROFILES: Readonly<Record<CompanyFrontierLabStage, FrontierLabStageProfile>> = {
  pilot: {
    stage: "pilot",
    label: "Pilot",
    maxParallelTasks: 4,
    maxTasksPerCycle: 4,
    maxPerMachineConcurrency: 1,
    requiredSettledTasks: 0,
    requiredSuccessRate: 0,
  },
  team: {
    stage: "team",
    label: "Team",
    maxParallelTasks: 12,
    maxTasksPerCycle: 12,
    maxPerMachineConcurrency: 2,
    requiredSettledTasks: 3,
    requiredSuccessRate: 2 / 3,
  },
  frontier: {
    stage: "frontier",
    label: "Frontier",
    maxParallelTasks: 24,
    maxTasksPerCycle: 24,
    maxPerMachineConcurrency: 4,
    requiredSettledTasks: 12,
    requiredSuccessRate: 0.8,
  },
};

export const FRONTIER_LAB_DEFAULT_POLICY: Readonly<CompanyFrontierLabPolicy> = {
  enabled: false,
  stage: "pilot",
  monthlyTokenLimit: 5_000_000,
  perTaskTokenLimit: 250_000,
  maxParallelTasks: 4,
  maxTasksPerCycle: 4,
  perMachineConcurrency: 1,
  elasticWorkers: true,
  requireIndependentReview: true,
  provider: "openai-oauth",
  models: FRONTIER_LAB_MODEL_LADDER,
};

const STAGE_ORDER: CompanyFrontierLabStage[] = ["pilot", "team", "frontier"];

function integerInRange(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function normalizedStage(value: unknown): CompanyFrontierLabStage {
  return value === "team" || value === "frontier" ? value : "pilot";
}

/**
 * Fail closed onto the reviewed OAuth ladder and clamp every capacity input to
 * its stage. Stored records may be older or hand-edited, so every runtime call
 * normalizes again instead of trusting JSON shape.
 */
export function normalizeFrontierLabPolicy(input: unknown): CompanyFrontierLabPolicy {
  const record = input && typeof input === "object" ? input as Partial<CompanyFrontierLabPolicy> : {};
  const stage = normalizedStage(record.stage);
  const profile = FRONTIER_LAB_STAGE_PROFILES[stage];
  const monthlyTokenLimit = integerInRange(record.monthlyTokenLimit, FRONTIER_LAB_DEFAULT_POLICY.monthlyTokenLimit, 100_000, 100_000_000);
  return {
    enabled: record.enabled === true,
    stage,
    monthlyTokenLimit,
    perTaskTokenLimit: Math.min(
      monthlyTokenLimit,
      integerInRange(record.perTaskTokenLimit, FRONTIER_LAB_DEFAULT_POLICY.perTaskTokenLimit, 10_000, 5_000_000),
    ),
    maxParallelTasks: integerInRange(record.maxParallelTasks, Math.min(FRONTIER_LAB_DEFAULT_POLICY.maxParallelTasks, profile.maxParallelTasks), 1, profile.maxParallelTasks),
    maxTasksPerCycle: integerInRange(record.maxTasksPerCycle, Math.min(FRONTIER_LAB_DEFAULT_POLICY.maxTasksPerCycle, profile.maxTasksPerCycle), 1, profile.maxTasksPerCycle),
    perMachineConcurrency: integerInRange(record.perMachineConcurrency, Math.min(FRONTIER_LAB_DEFAULT_POLICY.perMachineConcurrency, profile.maxPerMachineConcurrency), 1, profile.maxPerMachineConcurrency),
    elasticWorkers: record.elasticWorkers !== false,
    requireIndependentReview: true,
    provider: "openai-oauth",
    models: { ...FRONTIER_LAB_MODEL_LADDER },
  };
}

export interface FrontierLabStageEvidence {
  settledTasks: number;
  completedTasks: number;
}

export interface FrontierLabStageTransitionDecision {
  allowed: boolean;
  reason?: string;
  requiredSettledTasks: number;
  requiredSuccessRate: number;
  observedSuccessRate: number;
}

/** Scale-down is always reversible; scale-up needs enough settled, successful attempts. */
export function evaluateFrontierLabStageTransition(
  current: CompanyFrontierLabStage,
  target: CompanyFrontierLabStage,
  evidence: FrontierLabStageEvidence,
): FrontierLabStageTransitionDecision {
  const profile = FRONTIER_LAB_STAGE_PROFILES[target];
  const settledTasks = Math.max(0, Math.floor(evidence.settledTasks));
  const completedTasks = Math.min(settledTasks, Math.max(0, Math.floor(evidence.completedTasks)));
  const observedSuccessRate = settledTasks > 0 ? completedTasks / settledTasks : 0;
  const reversible = STAGE_ORDER.indexOf(target) <= STAGE_ORDER.indexOf(current);
  const enoughTasks = settledTasks >= profile.requiredSettledTasks;
  const enoughSuccess = observedSuccessRate >= profile.requiredSuccessRate;
  const allowed = reversible || (enoughTasks && enoughSuccess);
  return {
    allowed,
    reason: allowed
      ? undefined
      : `Earn ${profile.requiredSettledTasks} settled tasks at ${Math.round(profile.requiredSuccessRate * 100)}% success before scaling to ${profile.label}. Current evidence: ${settledTasks} at ${Math.round(observedSuccessRate * 100)}%.`,
    requiredSettledTasks: profile.requiredSettledTasks,
    requiredSuccessRate: profile.requiredSuccessRate,
    observedSuccessRate,
  };
}

export interface FrontierLabCapacityInput {
  policy: CompanyFrontierLabPolicy;
  dispatchableMembers: number;
  activeTasks: number;
  settledTokens: number;
  reservedTokens: number;
}

export interface FrontierLabCapacity {
  availableSlots: number;
  stageSlots: number;
  workerSlots: number;
  affordableSlots: number;
  remainingTokens: number;
  blockedReason?: string;
}

export function evaluateFrontierLabCapacity(input: FrontierLabCapacityInput): FrontierLabCapacity {
  const policy = normalizeFrontierLabPolicy(input.policy);
  const profile = FRONTIER_LAB_STAGE_PROFILES[policy.stage];
  const settledTokens = Math.max(0, Math.floor(input.settledTokens));
  const reservedTokens = Math.max(0, Math.floor(input.reservedTokens));
  const remainingTokens = Math.max(0, policy.monthlyTokenLimit - settledTokens - reservedTokens);
  const stageSlots = Math.max(0, Math.min(policy.maxParallelTasks, profile.maxParallelTasks) - Math.max(0, Math.floor(input.activeTasks)));
  const dispatchableMembers = Math.max(0, Math.floor(input.dispatchableMembers));
  const workerSlots = dispatchableMembers < 2
    ? 0
    : policy.elasticWorkers
      ? profile.maxParallelTasks
      : dispatchableMembers;
  const affordableSlots = Math.floor(remainingTokens / policy.perTaskTokenLimit);
  const availableSlots = policy.enabled
    ? Math.max(0, Math.min(stageSlots, workerSlots, affordableSlots, policy.maxTasksPerCycle))
    : 0;
  let blockedReason: string | undefined;
  if (!policy.enabled) blockedReason = "Frontier Lab is disabled.";
  else if (affordableSlots <= 0) blockedReason = "The company intelligence token budget cannot fund another task reservation.";
  else if (stageSlots <= 0) blockedReason = "The company has reached its parallel task limit.";
  else if (workerSlots <= 0) blockedReason = "At least two dispatchable company agent identities must be online for worker/reviewer independence.";
  return { availableSlots, stageSlots, workerSlots, affordableSlots, remainingTokens, blockedReason };
}

export function classifyFrontierLabTaskTier(input: {
  title?: string;
  body?: string;
  role?: string;
  skills?: readonly string[];
}): CompanyFrontierLabTaskTier {
  const signal = [input.title, input.body, input.role, ...(input.skills ?? [])].filter(Boolean).join(" ").toLowerCase();
  if (/\b(qa|quality|test|verify|verification|review|reviewer|audit|auditor|security|compliance|judge|eval)\b/.test(signal)) return "reviewer";
  if (/\b(build|builder|implement|implementation|engineer|engineering|code|coding|develop|developer|design|designer|devops|deploy|infrastructure|operate|operations)\b/.test(signal)) return "builder";
  return "scout";
}

export function openAiOAuthAgentForFrontierLabTier(tier: CompanyFrontierLabTaskTier): {
  runtime: "hermes";
  provider: "openai-codex";
  model: CompanyFrontierLabModel;
} {
  return {
    runtime: "hermes",
    provider: "openai-codex",
    model: FRONTIER_LAB_MODEL_LADDER[tier],
  };
}

export function frontierLabTierFromSkills(skills: readonly string[] | undefined): CompanyFrontierLabTaskTier | undefined {
  const value = skills?.find((skill) => skill.startsWith("frontier-lab:tier:"))?.slice("frontier-lab:tier:".length);
  return value === "builder" || value === "reviewer" || value === "scout" ? value : undefined;
}
