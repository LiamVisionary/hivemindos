import { NextRequest } from "next/server";
import { z } from "zod";
import {
  COMPUTER_INTERACTION_ACTION_KINDS,
  COMPUTER_INTERACTION_ADAPTER_IDS,
  createComputerInteractionObservation,
} from "@/lib/services/computer-interaction";
import { computerInteractionRunStore, createServerComputerInteractionOrchestrator } from "@/lib/services/computer-interaction/server";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const adapterSchema = z.enum(COMPUTER_INTERACTION_ADAPTER_IDS);
const actionKindSchema = z.enum(COMPUTER_INTERACTION_ACTION_KINDS);
const observationInputSchema = z.object({
  adapter: adapterSchema,
  sequence: z.number().int().nonnegative(),
  capturedAt: z.number().int().nonnegative().optional(),
  url: z.string().optional(),
  app: z.string().optional(),
  title: z.string().optional(),
  content: z.string().max(200_000).optional(),
  evidence: z.array(z.string()).max(8).optional(),
}).strict();
const interactionActionSchema = z.object({
  id: z.string().optional(),
  kind: actionKindSchema,
  adapter: adapterSchema,
  observationId: z.string().optional(),
  params: z.record(z.string(), z.unknown()).default({}),
  consequence: z.boolean().optional(),
  description: z.string().max(500).optional(),
}).strict();
const policySchema = z.object({
  allowedDomains: z.array(z.string()).max(50).optional(),
  allowedApps: z.array(z.string()).max(50).optional(),
  requireConfirmationForConsequences: z.boolean().optional(),
  pauseOnPromptInjection: z.boolean().optional(),
}).strict();
const limitsSchema = z.object({
  maxSteps: z.number().int().min(1).max(100).optional(),
  maxRuntimeMs: z.number().int().min(1_000).max(3_600_000).optional(),
  maxCostUsd: z.number().positive().max(1_000).optional(),
}).strict();
const adapterContextSchema = z.object({
  browserSession: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/).optional(),
}).strict();
const reportedResultSchema = z.object({
  ok: z.boolean(),
  summary: z.string().min(1).max(1_000),
  evidence: z.array(z.string()).max(8).optional(),
  costUsd: z.number().nonnegative().optional(),
  model: z.string().max(200).optional(),
  cache: z.object({
    readTokens: z.number().int().nonnegative().optional(),
    writeTokens: z.number().int().nonnegative().optional(),
    hit: z.boolean().optional(),
  }).strict().optional(),
}).strict();

const requestSchema = z.object({
  action: z.enum(["start", "step", "approve", "pause", "resume", "stop", "get"]),
  runId: z.string().min(1).nullable().optional(),
  goal: z.string().min(1).max(2_000).nullable().optional(),
  adapters: z.array(adapterSchema).min(1).max(COMPUTER_INTERACTION_ADAPTER_IDS.length).nullable().optional(),
  policy: policySchema.nullable().optional(),
  limits: limitsSchema.nullable().optional(),
  runtimeSessionId: z.string().nullable().optional(),
  adapterContext: adapterContextSchema.nullable().optional(),
  interactionAction: interactionActionSchema.nullable().optional(),
  observation: observationInputSchema.nullable().optional(),
  reportedResult: reportedResultSchema.nullable().optional(),
  approvalId: z.string().min(1).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
}).strict().superRefine((input, context) => {
  const requireField = (field: "runId" | "goal" | "adapters" | "interactionAction" | "approvalId") => {
    if (input[field] == null) context.addIssue({ code: "custom", path: [field], message: `${field} is required for ${input.action}.` });
  };
  if (input.action === "start") {
    requireField("goal");
    requireField("adapters");
  } else {
    requireField("runId");
  }
  if (input.action === "step") requireField("interactionAction");
  if (input.action === "approve") requireField("approvalId");
});

function observation(input: z.infer<typeof observationInputSchema> | null | undefined) {
  return input ? createComputerInteractionObservation(input) : undefined;
}

function omitNullToolFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNullToolFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== null)
      .map(([key, nested]) => [key, omitNullToolFields(nested)]),
  );
}

export async function GET(request: NextRequest) {
  try {
    const runId = request.nextUrl.searchParams.get("runId")?.trim();
    if (runId) {
      const run = await computerInteractionRunStore.readRun(runId);
      if (!run) return errorJson("Computer interaction run not found.", 404);
      const after = Number(request.nextUrl.searchParams.get("after") || 0);
      const events = await computerInteractionRunStore.listEvents(runId, Number.isFinite(after) ? after : 0);
      return okJson({ run, events });
    }
    return okJson({ runs: await computerInteractionRunStore.listRuns() });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Computer interaction status failed.", 400);
  }
}

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(omitNullToolFields(await request.json().catch(() => null)));
  if (!parsed.success) {
    return errorJson(`Invalid computer interaction request: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ")}`, 400);
  }
  const orchestrator = createServerComputerInteractionOrchestrator();
  try {
    const input = parsed.data;
    if (input.action === "start") {
      const run = await orchestrator.start({
        goal: input.goal!,
        adapters: input.adapters!,
        policy: input.policy ?? undefined,
        limits: input.limits ?? undefined,
        runtimeSessionId: input.runtimeSessionId ?? undefined,
        adapterContext: input.adapterContext ?? undefined,
        initialObservation: observation(input.observation),
      });
      return okJson({ run });
    }
    if (input.action === "step") {
      const run = await orchestrator.step(input.runId!, input.interactionAction!, {
        postObservation: observation(input.observation),
        reportedResult: input.reportedResult ?? undefined,
      });
      return okJson({ run, awaitingApproval: run.status === "awaiting-approval" });
    }
    if (input.action === "approve") return okJson({ run: await orchestrator.approve(input.runId!, input.approvalId!) });
    if (input.action === "pause") return okJson({ run: await orchestrator.pause(input.runId!, input.reason ?? undefined) });
    if (input.action === "resume") return okJson({ run: await orchestrator.resume(input.runId!) });
    if (input.action === "get") return okJson({ run: await orchestrator.get(input.runId!) });
    return okJson({ run: await orchestrator.stop(input.runId!, input.reason ?? undefined) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Computer interaction request failed.";
    return errorJson(message, /not found/i.test(message) ? 404 : /approval|paused|completed|stopped/i.test(message) ? 409 : 400);
  }
}
