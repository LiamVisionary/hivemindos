import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { readManagedVoiceConfig } from "@/lib/services/phone/realtime-voice";
import { voiceCapabilitySearchEvidence, voiceProviderCapabilitiesPayload } from "@/lib/services/phone/voice-provider-capabilities";
import { listVoiceRecipes, validateVoiceRecipe } from "@/lib/services/phone/voice-recipes";
import {
  appendVoiceRunEvent,
  completeVoiceRun,
  getVoiceRun,
  listVoiceRuns,
  runVoiceRunQa,
  voiceRunTimeline,
  type VoiceRunEventType,
} from "@/lib/services/phone/voice-runs";
import { describeVoiceToolBundles } from "@/lib/services/phone/voice-tool-bundles";

const VOICE_RUN_EVENT_TYPES = new Set<VoiceRunEventType>([
  "call.created",
  "call.connected",
  "call.ended",
  "user.transcript",
  "agent.caption",
  "tool.call.started",
  "tool.call.completed",
  "runtime.turn.started",
  "runtime.turn.completed",
  "runtime.turn.failed",
  "qa.completed",
  "extraction.completed",
  "note",
]);

export function voiceRunIdFromBody(body: Record<string, unknown>) {
  if (typeof body.voiceRunId === "string" && body.voiceRunId.trim()) return body.voiceRunId.trim();
  const voiceRun = body.voiceRun && typeof body.voiceRun === "object" ? body.voiceRun as Record<string, unknown> : {};
  if (typeof voiceRun.id === "string" && voiceRun.id.trim()) return voiceRun.id.trim();
  const runtimeAgent = body.runtimeAgent && typeof body.runtimeAgent === "object" ? body.runtimeAgent as Record<string, unknown> : {};
  return typeof runtimeAgent.voiceRunId === "string" && runtimeAgent.voiceRunId.trim()
    ? runtimeAgent.voiceRunId.trim()
    : undefined;
}

export async function recordVoiceRunEvent(
  voiceRunId: string | undefined,
  event: {
    type: VoiceRunEventType;
    speaker?: "user" | "agent" | "system" | "tool";
    text?: string;
    detail?: string;
    payload?: Record<string, unknown>;
  },
) {
  await appendVoiceRunEvent(voiceRunId, event).catch(() => undefined);
}

export function errorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Voice turn failed.");
}

export async function handleVoiceRunGetAction(action: string | null, request: NextRequest) {
  if (action === "voice-runs") {
    const limit = Number(request.nextUrl.searchParams.get("limit") || 30);
    return NextResponse.json({ ok: true, runs: await listVoiceRuns({ limit }) });
  }
  if (action === "voice-run") {
    const id = request.nextUrl.searchParams.get("id")?.trim();
    if (!id) throw new Error("A voice run id is required.");
    const run = await getVoiceRun(id);
    return NextResponse.json(run
      ? { ok: true, run, timeline: voiceRunTimeline(run) }
      : { ok: false, error: "Voice run not found." }, { status: run ? 200 : 404 });
  }
  if (action === "voice-recipes") {
    return NextResponse.json({
      ok: true,
      recipes: listVoiceRecipes(),
      toolBundles: describeVoiceToolBundles(),
    });
  }
  if (action === "voice-capabilities") {
    const managed = readManagedVoiceConfig();
    return NextResponse.json({
      ok: true,
      providerCapabilities: voiceProviderCapabilitiesPayload(managed),
      capabilitySearchEvidence: voiceCapabilitySearchEvidence(managed),
      toolBundles: describeVoiceToolBundles(),
      recipes: listVoiceRecipes(),
    });
  }
  return null;
}

export async function handleVoiceRunPostAction(body: Record<string, unknown>) {
  if (body.action === "voice-run-event") {
    const voiceRunId = voiceRunIdFromBody(body);
    const rawEvent = body.event && typeof body.event === "object" ? body.event as Record<string, unknown> : body;
    const type = typeof rawEvent.type === "string" && VOICE_RUN_EVENT_TYPES.has(rawEvent.type as VoiceRunEventType)
      ? rawEvent.type as VoiceRunEventType
      : null;
    if (!voiceRunId) throw new Error("A voice run id is required.");
    if (!type) throw new Error("A valid voice run event type is required.");
    const speaker = rawEvent.speaker === "user" || rawEvent.speaker === "agent" || rawEvent.speaker === "system" || rawEvent.speaker === "tool"
      ? rawEvent.speaker
      : undefined;
    const run = await appendVoiceRunEvent(voiceRunId, {
      type,
      speaker,
      text: typeof rawEvent.text === "string" ? rawEvent.text : undefined,
      detail: typeof rawEvent.detail === "string" ? rawEvent.detail : undefined,
      payload: rawEvent.payload && typeof rawEvent.payload === "object" ? rawEvent.payload as Record<string, unknown> : undefined,
    });
    return NextResponse.json({ ok: true, run });
  }
  if (body.action === "voice-run-complete") {
    const voiceRunId = voiceRunIdFromBody(body);
    if (!voiceRunId) throw new Error("A voice run id is required.");
    const status = body.status === "failed" ? "failed" : "ended";
    const reason = typeof body.reason === "string" ? body.reason : "";
    const run = await completeVoiceRun(voiceRunId, status, reason);
    return NextResponse.json({ ok: Boolean(run), run });
  }
  if (body.action === "voice-run-qa") {
    const voiceRunId = voiceRunIdFromBody(body);
    if (!voiceRunId) throw new Error("A voice run id is required.");
    const run = await runVoiceRunQa(voiceRunId);
    return NextResponse.json({ ok: true, run, timeline: voiceRunTimeline(run) });
  }
  if (body.action === "voice-recipe-validate") {
    return NextResponse.json(validateVoiceRecipe(body.recipe));
  }
  return null;
}
