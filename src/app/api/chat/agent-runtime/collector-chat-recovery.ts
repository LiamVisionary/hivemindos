import type { AgentProfile } from "@/lib/types/agent-runtime";
import { ssePayload } from "./messages";

const COLLECTOR_RECOVERY_WAIT_MS = 15_000;
const COLLECTOR_RECOVERY_POLL_MS = 250;
const COLLECTOR_RECOVERY_REQUEST_TIMEOUT_MS = 2_000;

type CollectorRecoverySession = {
  sessionId?: string;
  id?: string;
  runtime?: string;
  source?: string;
  startedAt?: number;
  updatedAt?: number;
  messageCount?: number;
};

type CollectorRecoveryPayload = {
  ok?: boolean;
  recovered?: boolean;
  safeToRetry?: boolean;
  active?: boolean;
  session?: CollectorRecoverySession | null;
};

export type CollectorChatRecoveryResult =
  | { kind: "recovered"; response: Response; sessionId: string }
  | { kind: "retry" }
  | { kind: "unavailable" };

function collectorOrigin(chatUrl: string) {
  const parsed = new URL(chatUrl);
  return parsed.origin;
}

function recoveredChatResponse(session: CollectorRecoverySession) {
  const sessionId = String(session.sessionId || session.id || "").trim();
  const encoder = new TextEncoder();
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(ssePayload({
      type: "agent_bridge.recovered",
      message: "The local agent bridge restarted, so HivemindOS reattached to the existing Hermes session.",
      session: {
        id: sessionId,
        runtime: session.runtime || "hermes",
        source: session.source || "hermes-recovery",
        startedAt: session.startedAt,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
      },
      })));
      disconnectTimer = setTimeout(() => {
        controller.error(new TypeError("terminated"));
      }, 0);
    },
    cancel() {
      if (disconnectTimer) clearTimeout(disconnectTimer);
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

export async function recoverCollectorChatAfterFetchFailure(input: {
  profile: AgentProfile;
  chatUrl: string;
  runtimeSessionId: string;
  rawUserMessage: string;
  fetchStartedAt: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<CollectorChatRecoveryResult> {
  if (input.profile.runtime !== "hermes" || !input.profile.telemetryUrl?.trim()) {
    return { kind: "unavailable" };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const wait = input.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const origin = collectorOrigin(input.chatUrl);
  const deadline = now() + COLLECTOR_RECOVERY_WAIT_MS;

  while (now() < deadline) {
    try {
      const health = await fetchImpl(`${origin}/health`, {
        signal: AbortSignal.timeout(COLLECTOR_RECOVERY_REQUEST_TIMEOUT_MS),
      });
      if (!health.ok) throw new Error(`collector health returned ${health.status}`);
      const recovery = await fetchImpl(`${origin}/chat/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: input.profile,
          runtimeSessionId: input.runtimeSessionId || undefined,
          rawUserMessage: input.rawUserMessage,
          sinceMs: input.fetchStartedAt - 2_000,
        }),
        signal: AbortSignal.timeout(COLLECTOR_RECOVERY_REQUEST_TIMEOUT_MS),
      });
      if (recovery.status === 404) return { kind: "unavailable" };
      if (!recovery.ok) throw new Error(`collector recovery returned ${recovery.status}`);
      const payload = await recovery.json() as CollectorRecoveryPayload;
      const sessionId = String(payload.session?.sessionId || payload.session?.id || "").trim();
      if (payload.recovered && sessionId && payload.session) {
        return {
          kind: "recovered",
          response: recoveredChatResponse(payload.session),
          sessionId,
        };
      }
      if (payload.safeToRetry && !payload.active) return { kind: "retry" };
    } catch {
      // The collector is still restarting or its recovery scan is not ready.
    }
    await wait(COLLECTOR_RECOVERY_POLL_MS);
  }
  return { kind: "unavailable" };
}
