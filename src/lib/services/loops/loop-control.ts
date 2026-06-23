export type LoopControlStatus = "running" | "paused" | "killed";

export type LoopControlTargetKind = "task" | "schedule" | "flow" | "company" | "evo-run" | "chat";

export type LoopControlTarget = {
  kind: LoopControlTargetKind;
  id: string;
};

export type LoopControlPolicy = {
  status: LoopControlStatus;
  reason?: string;
  maxAttempts?: number;
  maxRuntimeMs?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  requireHumanApprovalBeforeSideEffects?: boolean;
  updatedAt: number;
  updatedBy?: string;
};

export type LoopControlRegistry = Record<string, LoopControlPolicy>;

export function loopControlKey(target: LoopControlTarget): string {
  return `${target.kind}:${target.id}`;
}

export function defaultLoopControlPolicy(now = Date.now()): LoopControlPolicy {
  return {
    status: "running",
    requireHumanApprovalBeforeSideEffects: false,
    updatedAt: now,
  };
}

export function updateLoopControlPolicy(
  registry: LoopControlRegistry,
  target: LoopControlTarget,
  patch: Partial<Omit<LoopControlPolicy, "updatedAt">>,
  now = Date.now(),
): LoopControlRegistry {
  const key = loopControlKey(target);
  const prior = registry[key] ?? defaultLoopControlPolicy(now);
  return {
    ...registry,
    [key]: {
      ...prior,
      ...cleanPolicyPatch(patch),
      updatedAt: now,
    },
  };
}

export function loopControlAllowsProgress(policy?: LoopControlPolicy): { allowed: true } | { allowed: false; reason: string } {
  if (!policy || policy.status === "running") return { allowed: true };
  if (policy.status === "paused") return { allowed: false, reason: policy.reason || "Loop is paused." };
  return { allowed: false, reason: policy.reason || "Loop was killed." };
}

function cleanPolicyPatch(patch: Partial<Omit<LoopControlPolicy, "updatedAt">>): Partial<Omit<LoopControlPolicy, "updatedAt">> {
  const cleaned = {
    status: patch.status && ["running", "paused", "killed"].includes(patch.status) ? patch.status : undefined,
    reason: cleanOptional(patch.reason),
    maxAttempts: positiveInteger(patch.maxAttempts),
    maxRuntimeMs: positiveNumber(patch.maxRuntimeMs),
    maxTokens: positiveInteger(patch.maxTokens),
    maxCostUsd: positiveNumber(patch.maxCostUsd),
    requireHumanApprovalBeforeSideEffects: typeof patch.requireHumanApprovalBeforeSideEffects === "boolean"
      ? patch.requireHumanApprovalBeforeSideEffects
      : undefined,
    updatedBy: cleanOptional(patch.updatedBy),
  };
  return Object.fromEntries(Object.entries(cleaned).filter(([, value]) => value !== undefined)) as Partial<Omit<LoopControlPolicy, "updatedAt">>;
}

function cleanOptional(value?: string | null) {
  return value?.trim() || undefined;
}

function positiveNumber(value?: number | null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function positiveInteger(value?: number | null) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}
