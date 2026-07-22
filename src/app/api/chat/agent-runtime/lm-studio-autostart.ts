import type { AgentProfile } from "@/lib/types/agent-runtime";
import { isBankrLlmProfile } from "@/lib/services/bankr-llm";
import { appendRuntimeChatSessionEvent } from "@/lib/services/chat/runtime-session-store";
import {
  isLocalLmStudioProfile,
  lmStudioCliEnv,
  resolveLmStudioCliBin,
  stripTerminalControls,
} from "./openai-compat";
import { execFileAsync } from "./runtime-helpers";
import { recordRuntimeTelemetry, telemetryPayloadForProfile, type RuntimeRouteTelemetry } from "./route-telemetry";

/**
 * LM Studio can have a model loaded while its OpenAI-compatible server is not
 * listening. When a local LM Studio profile's fetch fails, start the server on
 * the profile's port so the retry can connect. Extracted verbatim from
 * stream-openai-compatible.ts (file-size ratchet split).
 */
export async function startLmStudioServer(input: {
  candidateProfile: AgentProfile;
  failedUrl: string;
  error: unknown;
  adaptiveRouting: boolean;
  usePodEnabled: boolean;
  telemetry?: RuntimeRouteTelemetry;
  runtimeSessionId: string;
  fetchStartedAt: number;
}): Promise<boolean> {
  const { candidateProfile, failedUrl, error, telemetry, runtimeSessionId, fetchStartedAt } = input;
  if (!isLocalLmStudioProfile(candidateProfile) || input.adaptiveRouting || input.usePodEnabled || isBankrLlmProfile(candidateProfile)) return false;
  let port = "1234";
  try {
    const parsed = new URL(candidateProfile.gatewayUrl);
    port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  } catch {
    return false;
  }
  if (!/^\d+$/.test(port)) return false;
  recordRuntimeTelemetry(telemetry, "agent_runtime.lm_studio_server.start", {
    ...telemetryPayloadForProfile(candidateProfile),
    failedUrl,
    port,
    originalError: error instanceof Error ? error.message : String(error),
  });
  await appendRuntimeChatSessionEvent(
    runtimeSessionId,
    "Starting LM Studio server",
    `LM Studio has the model loaded, but ${failedUrl} is not listening. Starting the local LM Studio OpenAI-compatible server on port ${port}.`,
  ).catch(() => undefined);
  try {
    const { stdout, stderr } = await execFileAsync(await resolveLmStudioCliBin(), ["server", "start", "--port", port, "--bind", "127.0.0.1"], {
      timeout: 20_000,
      maxBuffer: 1_000_000,
      env: lmStudioCliEnv(),
      signal: telemetry?.request.signal,
    });
    const detail = stripTerminalControls([stdout, stderr].filter(Boolean).join("\n"));
    recordRuntimeTelemetry(telemetry, "agent_runtime.lm_studio_server.started", {
      ...telemetryPayloadForProfile(candidateProfile),
      port,
      detail: detail.slice(0, 500),
      elapsedMs: Date.now() - fetchStartedAt,
    });
    return true;
  } catch (serverError) {
    recordRuntimeTelemetry(telemetry, "agent_runtime.lm_studio_server.start_failed", {
      ...telemetryPayloadForProfile(candidateProfile),
      port,
      errorName: serverError instanceof Error ? serverError.name : null,
      errorMessage: serverError instanceof Error ? serverError.message : String(serverError),
      elapsedMs: Date.now() - fetchStartedAt,
    });
    await appendRuntimeChatSessionEvent(
      runtimeSessionId,
      "LM Studio server start failed",
      serverError instanceof Error ? serverError.message : "Could not start LM Studio server.",
    ).catch(() => undefined);
    return false;
  }
}
