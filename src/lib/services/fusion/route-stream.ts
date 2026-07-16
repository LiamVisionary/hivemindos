import "server-only";

import type { NextRequest } from "next/server";
import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";
import { proxyOutput, redactSecretText } from "@/lib/services/agent-security-proxy";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { runFusion } from "./orchestrator";
import type { FusionEvent, FusionMessage } from "./types";
import {
  appendRuntimeChatSessionText,
  finishRuntimeChatSession,
} from "@/lib/services/chat/runtime-session-store";

export function isFusionProfile(profile: Pick<AgentProfile, "provider">): boolean {
  return profile.provider?.trim().toLowerCase() === "hive-fusion";
}

function ssePayload(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function fusionSystemPrompt(profile: AgentProfile): string | undefined {
  const candidate = [profile.skillProfilePrompt, (profile as { soulPrompt?: string }).soulPrompt]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
  return candidate || undefined;
}

function planSummary(meta: Extract<FusionEvent, { type: "plan" }>["plan"]): string {
  const panel = meta.panel.map((member) => member.label).join(", ") || "(resolving)";
  const lines = [
    `**Hive Fusion** (${meta.mode === "openrouter" ? "OpenRouter hosted" : "native panel"})`,
    `Panel: ${panel}`,
  ];
  if (meta.mode === "native") {
    lines.push(`Judge: ${meta.judge ?? "—"} · Synthesizer: ${meta.synthesizer}`);
  }
  for (const note of meta.notes) lines.push(`⚠︎ ${note}`);
  return lines.join("\n");
}

type FusionStreamArgs = {
  profile: AgentProfile;
  messages: FusionMessage[];
  runtimeSessionId: string;
  request?: NextRequest;
  routeStartedAt?: number;
};

/**
 * Run a Hive Fusion turn and stream it back over the dashboard's SSE contract:
 * the synthesizer answer streams as choices[].delta.content, while panel and
 * judge progress surface as tool/reasoning process events.
 */
export function streamFusionResponse({ profile, messages, runtimeSessionId, request, routeStartedAt }: FusionStreamArgs): Response {
  const encoder = new TextEncoder();
  const startedAt = routeStartedAt ?? Date.now();

  const telemetry = (type: string, payload: Record<string, unknown> = {}) => {
    if (!request) return;
    void recordTelemetryBatch([
      {
        source: "route" as const,
        type,
        threadId: request.headers.get("x-hivemind-chat-storage-key"),
        runId: request.headers.get("x-hivemind-run-id"),
        payload,
      },
    ]).catch(() => undefined);
  };

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(ssePayload(payload)));
      const signal = request?.signal;
      let fatal = false;
      // Mirror the rest of the runtime route: every model-produced token that
      // reaches the user is run through the output proxy (secret redaction +
      // output-policy block). Once blocked, stop forwarding model content.
      let blocked = false;
      let safeOutput = "";

      if (runtimeSessionId) {
        send({ type: "chat.session", session: { id: runtimeSessionId, runtime: "hive-fusion", source: "hivemindos-chat" } });
      }

      const onEvent = (event: FusionEvent) => {
        switch (event.type) {
          case "plan":
            send({ type: "chat.reasoning", delta: planSummary(event.plan) });
            break;
          case "member.start":
            send({ type: "chat.tool.start", toolName: event.label, message: "querying panel model", status: "running" });
            break;
          case "member.done":
            send({
              type: "chat.tool.done",
              toolName: event.label,
              status: event.ok ? "completed" : "failed",
              message: event.ok
                ? `${event.chars} chars · ${event.latencyMs}ms`
                : `failed: ${redactSecretText(event.error ?? "no output").text}`,
            });
            break;
          case "judge.start":
            send({ type: "chat.tool.start", toolName: `Judge (${event.label})`, message: "structuring panel responses", status: "running" });
            break;
          case "judge.done":
            send({ type: "chat.tool.done", toolName: "Judge", status: "completed", message: "analysis ready" });
            break;
          case "judge.skipped":
            send({ type: "chat.tool.done", toolName: "Judge", status: "completed", message: event.reason });
            break;
          case "synth.start":
            send({ type: "chat.tool.start", toolName: `Synthesizer (${event.label})`, message: "synthesizing final answer", status: "running" });
            break;
          case "synth.delta": {
            if (blocked) break;
            const outputCheck = proxyOutput(event.delta);
            if (outputCheck.verdict === "block") {
              blocked = true;
              fatal = true;
              send({ type: "chat.error", error: outputCheck.reason ?? "Response blocked by security policy" });
              break;
            }
            safeOutput += outputCheck.text;
            send({ choices: [{ delta: { content: outputCheck.text } }] });
            break;
          }
          case "reasoning":
            if (blocked) break;
            send({ type: "chat.reasoning", delta: redactSecretText(event.delta).text });
            break;
          case "done":
            telemetry("chat.fusion.completed", {
              mode: event.meta.mode,
              participantsSucceeded: event.meta.participantsSucceeded,
              participantsTotal: event.meta.participantsTotal,
              judged: event.meta.judged,
              chars: event.finalText.length,
              elapsedMs: Date.now() - startedAt,
            });
            break;
          case "error":
            // Surfaced via the throw below; nothing to enqueue here.
            break;
        }
      };

      try {
        telemetry("chat.fusion.request", { provider: profile.provider, model: profile.model || null });
        await runFusion({
          messages,
          config: profile.fusion,
          model: profile.model,
          systemPrompt: fusionSystemPrompt(profile),
          signal,
          emit: onEvent,
        });
      } catch (error) {
        fatal = true;
        const message = error instanceof Error ? error.message : "Hive Fusion failed.";
        telemetry("chat.fusion.error", { error: message, elapsedMs: Date.now() - startedAt });
        send({ type: "chat.error", error: message });
      } finally {
        if (safeOutput) {
          await appendRuntimeChatSessionText(runtimeSessionId, "assistant", safeOutput).catch(() => undefined);
        }
        await finishRuntimeChatSession(runtimeSessionId, fatal ? "failed" : "completed").catch(() => undefined);
        if (!fatal) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
