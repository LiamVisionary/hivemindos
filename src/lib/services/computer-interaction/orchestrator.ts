import { createHash } from "node:crypto";
import { assessComputerInteractionPolicy, redactComputerInteractionParams } from "./policy";
import type { ComputerInteractionRunStore } from "./store";
import type {
  ComputerInteractionAction,
  ComputerInteractionActionResult,
  ComputerInteractionAdapter,
  ComputerInteractionEvent,
  ComputerInteractionLimits,
  ComputerInteractionObservation,
  ComputerInteractionPolicy,
  ComputerInteractionPolicyDecision,
  ComputerInteractionReceipt,
  ComputerInteractionRun,
  ComputerInteractionRunStatus,
} from "./types";

type StartInput = {
  goal: string;
  adapters: ComputerInteractionRun["adapters"];
  policy?: ComputerInteractionPolicy;
  limits?: Partial<ComputerInteractionLimits>;
  runtimeSessionId?: string;
  adapterContext?: ComputerInteractionRun["adapterContext"];
  initialObservation?: ComputerInteractionObservation;
};

type StepOptions = {
  postObservation?: ComputerInteractionObservation;
  reportedResult?: ComputerInteractionActionResult;
};

type OrchestratorOptions = {
  store: ComputerInteractionRunStore;
  adapters: ComputerInteractionAdapter[];
  now?: () => number;
  onEvent?: (event: ComputerInteractionEvent, run: ComputerInteractionRun) => Promise<void> | void;
};

const DEFAULT_LIMITS: ComputerInteractionLimits = {
  maxSteps: 20,
  maxRuntimeMs: 5 * 60_000,
  maxCostUsd: 5,
};
const TERMINAL_STATUSES = new Set<ComputerInteractionRunStatus>(["completed", "failed", "stopped"]);
const REPORTED_ADAPTERS = new Set(["hive-action", "bee-pilot", "page-agent"]);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function actionFingerprint(action: ComputerInteractionAction) {
  return createHash("sha256").update(canonicalJson(action)).digest("hex");
}

function positiveInteger(value: unknown, fallback: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
}

function limits(input?: Partial<ComputerInteractionLimits>): ComputerInteractionLimits {
  return {
    maxSteps: positiveInteger(input?.maxSteps, DEFAULT_LIMITS.maxSteps),
    maxRuntimeMs: positiveNumber(input?.maxRuntimeMs, DEFAULT_LIMITS.maxRuntimeMs),
    maxCostUsd: positiveNumber(input?.maxCostUsd, DEFAULT_LIMITS.maxCostUsd),
  };
}

function activeRun(run: ComputerInteractionRun) {
  if (TERMINAL_STATUSES.has(run.status)) throw new Error(`Computer interaction run ${run.id} is ${run.status} and cannot continue.`);
  return run;
}

export function createComputerInteractionOrchestrator(options: OrchestratorOptions) {
  const now = options.now ?? Date.now;
  const adapters = new Map(options.adapters.map((adapter) => [adapter.id, adapter]));

  async function emit(
    run: ComputerInteractionRun,
    input: Omit<ComputerInteractionEvent, "id" | "sequence" | "runId" | "at" | "status"> & { status?: ComputerInteractionRunStatus; at?: number },
  ) {
    const event = await options.store.appendEvent(run.id, {
      ...input,
      status: input.status ?? run.status,
      at: input.at ?? now(),
    });
    await options.onEvent?.(event, run);
    return event;
  }

  function adapterFor(id: ComputerInteractionAction["adapter"]) {
    const adapter = adapters.get(id);
    if (!adapter) throw new Error(`Computer interaction adapter ${id} is not available.`);
    return adapter;
  }

  async function start(input: StartInput): Promise<ComputerInteractionRun> {
    const goal = input.goal.trim();
    if (!goal) throw new Error("A computer interaction goal is required.");
    if (!input.adapters.length) throw new Error("At least one computer interaction adapter is required.");
    const primary = adapterFor(input.adapters[0]);
    const startedAt = now();
    const runLimits = limits(input.limits);
    const base: ComputerInteractionRun = {
      version: 1,
      id: options.store.createId("run"),
      goal,
      status: "running",
      adapters: [...new Set(input.adapters)],
      policy: {
        ...input.policy,
        requireConfirmationForConsequences: input.policy?.requireConfirmationForConsequences ?? true,
        pauseOnPromptInjection: input.policy?.pauseOnPromptInjection ?? true,
      },
      limits: runLimits,
      startedAt,
      updatedAt: startedAt,
      deadlineAt: startedAt + runLimits.maxRuntimeMs,
      stepCount: 0,
      costUsd: 0,
      runtimeSessionId: input.runtimeSessionId?.trim() || undefined,
      adapterContext: input.adapterContext?.browserSession?.trim()
        ? { browserSession: input.adapterContext.browserSession.trim() }
        : undefined,
      receipts: [],
    };
    base.latestObservation = input.initialObservation ?? await primary.observe({ run: base });
    await options.store.writeRun(base);
    await emit(base, { type: "run-started", label: "Computer interaction started", detail: goal });
    await emit(base, { type: "observation", label: "Screen observed", detail: base.latestObservation.title ?? base.latestObservation.url, observationId: base.latestObservation.id });
    return base;
  }

  async function persistPolicyReceipt(
    run: ComputerInteractionRun,
    action: ComputerInteractionAction,
    policy: ComputerInteractionPolicyDecision,
    outcome: ComputerInteractionReceipt["outcome"],
    summary: string,
  ) {
    const at = now();
    const receipt: ComputerInteractionReceipt = {
      id: options.store.createId("receipt"),
      step: run.stepCount + 1,
      adapter: action.adapter,
      actionKind: action.kind,
      params: redactComputerInteractionParams(action.params),
      observationId: action.observationId,
      outcome,
      summary,
      evidence: [],
      policy,
      startedAt: at,
      finishedAt: at,
      latencyMs: 0,
    };
    return receipt;
  }

  async function executeAllowed(
    run: ComputerInteractionRun,
    action: ComputerInteractionAction,
    decision: ComputerInteractionPolicyDecision,
    stepOptions: StepOptions = {},
  ): Promise<ComputerInteractionRun> {
    const adapter = adapterFor(action.adapter);
    const startedAt = now();
    const result = stepOptions.reportedResult ?? await adapter.act({ run, action });
    const observation = stepOptions.postObservation ?? await adapter.observe({ run });
    const finishedAt = now();
    const nextStepCount = run.stepCount + 1;
    const nextCost = run.costUsd + Math.max(0, result.costUsd ?? 0);
    const costLimitReached = nextCost > run.limits.maxCostUsd;
    const stepLimitReached = nextStepCount >= run.limits.maxSteps;
    const deadlineReached = finishedAt >= run.deadlineAt;
    const status: ComputerInteractionRunStatus = !result.ok
      ? "failed"
      : costLimitReached || deadlineReached
        ? "paused"
        : stepLimitReached || action.kind === "complete"
          ? "completed"
          : "running";
    const summary = !result.ok
      ? result.summary
      : costLimitReached
        ? "The run reached its cost budget and paused."
        : deadlineReached
          ? "The run reached its deadline and paused."
          : result.summary;
    const receipt: ComputerInteractionReceipt = {
      id: options.store.createId("receipt"),
      step: nextStepCount,
      adapter: action.adapter,
      actionKind: action.kind,
      params: redactComputerInteractionParams(action.params),
      observationId: action.observationId,
      verifiedObservationId: observation.id,
      outcome: result.ok ? "succeeded" : "failed",
      summary,
      evidence: [...(result.evidence ?? []), `Post-action observation: ${observation.id}`].slice(0, 8),
      policy: decision,
      startedAt,
      finishedAt,
      latencyMs: Math.max(0, finishedAt - startedAt),
      costUsd: result.costUsd,
      model: result.model,
      cache: result.cache,
    };
    const next: ComputerInteractionRun = {
      ...run,
      status,
      updatedAt: finishedAt,
      stepCount: nextStepCount,
      costUsd: nextCost,
      latestObservation: observation,
      pendingApproval: undefined,
      approvedAction: undefined,
      receipts: [...run.receipts, receipt],
      error: result.ok ? undefined : result.summary,
    };
    await options.store.writeRun(next);
    await emit(next, { type: "action", label: result.ok ? "Action completed" : "Action failed", detail: summary, receiptId: receipt.id });
    await emit(next, { type: "verification", label: "Post-action state verified", detail: observation.title ?? observation.url, receiptId: receipt.id, observationId: observation.id });
    if (status === "completed") await emit(next, { type: "completed", label: "Computer interaction completed", detail: `${nextStepCount} step${nextStepCount === 1 ? "" : "s"}` });
    if (status === "paused") await emit(next, { type: "paused", label: "Computer interaction paused", detail: summary });
    if (status === "failed") await emit(next, { type: "failed", label: "Computer interaction failed", detail: summary });
    return next;
  }

  async function stepUnlocked(runId: string, action: ComputerInteractionAction, stepOptions: StepOptions = {}): Promise<ComputerInteractionRun> {
    const run = activeRun(await requiredRun(runId));
    if (run.status !== "running") throw new Error(`Computer interaction run ${run.id} is ${run.status}; resume or approve it before stepping.`);
    if (run.stepCount >= run.limits.maxSteps) throw new Error("The computer interaction step budget is exhausted.");
    if (now() >= run.deadlineAt) {
      const paused = await options.store.mutateRun(run.id, (current) => ({ ...current, status: "paused", updatedAt: now(), error: "Run deadline reached." }));
      await emit(paused, { type: "paused", label: "Computer interaction paused", detail: "Run deadline reached." });
      return paused;
    }
    if (!run.adapters.includes(action.adapter)) throw new Error(`Adapter ${action.adapter} is not enabled for this run.`);
    const fingerprint = actionFingerprint(action);
    const approvedExactAction = run.approvedAction?.actionFingerprint === fingerprint;
    const assessed = assessComputerInteractionPolicy({
      action,
      observation: run.latestObservation,
      expectedObservationId: run.latestObservation?.id,
      policy: approvedExactAction ? { ...run.policy, requireConfirmationForConsequences: false } : run.policy,
    });
    const decision: ComputerInteractionPolicyDecision = approvedExactAction && assessed.decision === "allow"
      ? { ...assessed, reason: "The human approved this exact pending action." }
      : assessed;
    await emit(run, { type: "policy", label: `Policy: ${decision.decision}`, detail: decision.reason });
    if (decision.decision === "allow") return executeAllowed(run, action, decision, stepOptions);
    const outcome = decision.decision === "confirm" ? "awaiting-approval" : decision.decision === "pause" ? "paused" : "blocked";
    const receipt = await persistPolicyReceipt(run, action, decision, outcome, decision.reason);
    const status: ComputerInteractionRunStatus = decision.decision === "confirm" ? "awaiting-approval" : decision.decision === "pause" ? "paused" : "failed";
    const pendingApproval = decision.decision === "confirm" ? {
      id: options.store.createId("approval"),
      action: { ...action, params: redactComputerInteractionParams(action.params) },
      actionFingerprint: fingerprint,
      reason: decision.reason,
      createdAt: now(),
    } : undefined;
    const next: ComputerInteractionRun = {
      ...run,
      status,
      updatedAt: now(),
      pendingApproval,
      approvedAction: undefined,
      receipts: [...run.receipts, receipt],
      error: decision.decision === "block" ? decision.reason : undefined,
    };
    await options.store.writeRun(next);
    await emit(next, {
      type: decision.decision === "confirm" ? "approval-required" : decision.decision === "pause" ? "paused" : "failed",
      label: decision.decision === "confirm" ? "Approval required" : decision.decision === "pause" ? "Computer interaction paused" : "Action blocked",
      detail: decision.reason,
      receiptId: receipt.id,
    });
    return next;
  }

  async function step(runId: string, action: ComputerInteractionAction, stepOptions: StepOptions = {}) {
    return options.store.runExclusive(runId, () => stepUnlocked(runId, action, stepOptions));
  }

  async function approveUnlocked(runId: string, approvalId: string): Promise<ComputerInteractionRun> {
    const run = activeRun(await requiredRun(runId));
    if (run.status !== "awaiting-approval" || !run.pendingApproval) throw new Error("This run is not awaiting approval.");
    if (run.pendingApproval.id !== approvalId) throw new Error("Approval does not match the pending action.");
    const action = run.pendingApproval.action;
    if (REPORTED_ADAPTERS.has(action.adapter)) {
      if (!run.pendingApproval.actionFingerprint) {
        throw new Error("Pending approval is missing its exact-action binding; replan the action before approving it.");
      }
      const next: ComputerInteractionRun = {
        ...run,
        status: "running",
        updatedAt: now(),
        pendingApproval: undefined,
        approvedAction: {
          approvalId,
          actionFingerprint: run.pendingApproval.actionFingerprint,
          approvedAt: now(),
        },
      };
      await options.store.writeRun(next);
      await emit(next, { type: "approved", label: "Action approved", detail: action.description ?? action.kind });
      return next;
    }
    const decision: ComputerInteractionPolicyDecision = {
      decision: "allow",
      reasonCode: "allowed",
      reason: "The human approved this exact pending action.",
      tier: "consequence",
    };
    const resumed = { ...run, status: "running" as const, updatedAt: now(), pendingApproval: undefined, approvedAction: undefined };
    await options.store.writeRun(resumed);
    await emit(resumed, { type: "approved", label: "Action approved", detail: action.description ?? action.kind });
    return executeAllowed(resumed, action, decision);
  }

  async function approve(runId: string, approvalId: string) {
    return options.store.runExclusive(runId, () => approveUnlocked(runId, approvalId));
  }

  async function pauseUnlocked(runId: string, reason = "Paused by the operator.") {
    const run = activeRun(await requiredRun(runId));
    const next = await options.store.mutateRun(run.id, (current) => ({ ...current, status: "paused", updatedAt: now(), error: reason }));
    await emit(next, { type: "paused", label: "Computer interaction paused", detail: reason });
    return next;
  }

  async function pause(runId: string, reason = "Paused by the operator.") {
    return options.store.runExclusive(runId, () => pauseUnlocked(runId, reason));
  }

  async function resumeUnlocked(runId: string) {
    const run = activeRun(await requiredRun(runId));
    if (run.status !== "paused") throw new Error(`Computer interaction run ${run.id} is ${run.status}, not paused.`);
    const next = await options.store.mutateRun(run.id, (current) => ({ ...current, status: "running", updatedAt: now(), error: undefined }));
    await emit(next, { type: "resumed", label: "Computer interaction resumed" });
    return next;
  }

  async function resume(runId: string) {
    return options.store.runExclusive(runId, () => resumeUnlocked(runId));
  }

  async function stopUnlocked(runId: string, reason = "Stopped by the operator.") {
    const run = activeRun(await requiredRun(runId));
    const next = await options.store.mutateRun(run.id, (current) => ({ ...current, status: "stopped", updatedAt: now(), pendingApproval: undefined, approvedAction: undefined, error: reason }));
    await emit(next, { type: "stopped", label: "Computer interaction stopped", detail: reason });
    return next;
  }

  async function stop(runId: string, reason = "Stopped by the operator.") {
    return options.store.runExclusive(runId, () => stopUnlocked(runId, reason));
  }

  async function requiredRun(runId: string) {
    const run = await options.store.readRun(runId);
    if (!run) throw new Error(`Computer interaction run ${runId} was not found.`);
    return run;
  }

  return { start, step, approve, pause, resume, stop, get: requiredRun };
}

export type ComputerInteractionOrchestrator = ReturnType<typeof createComputerInteractionOrchestrator>;
