import "server-only";

import {
  finishRuntimeChatSession,
  readRuntimeChatSession,
  startRuntimeChatSession,
  type RuntimeChatSessionRecord,
} from "@/lib/services/chat/runtime-session-store";
import { RUNTIME_STREAM_EVENT_TYPES } from "@/lib/services/runtime-stream-events";
import {
  completeMobileAgentJob,
  enqueueMobileAgentJob,
  getMobileAgentJob,
  mobileAgentHostLastPollAt,
} from "@/lib/services/mobile-agents/store";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import {
  machineKeyFromMobileGatewayUrl,
  MOBILE_AGENT_HOST_FRESH_MS,
  type MobileAgentJob,
  type MobileAgentJobMessage,
} from "@/lib/types/mobile-agents";

// Chat dispatch for `mobile://` agents: the hub cannot reach the phone, so a
// turn is queued as a job, the phone app polls /api/phone to run it on-device
// (MLX) and posts events/results back into the runtime chat session, and this
// stream re-emits that session to the dashboard in the exact SSE wire format
// the /api/chat/agent-runtime consumers already parse.
const POLL_INTERVAL_MS = 750;
const TURN_TIMEOUT_MS = 6 * 60 * 1000;
const MAX_JOB_MESSAGES = 20;

type IncomingChatMessage = {
  role: string;
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        image_url?: { url?: string };
        file?: { filename?: string };
      }>;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function messageText(content: IncomingChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text") return part.text ?? "";
      if (part.type === "image_url")
        return part.image_url?.url ? "[image attachment]" : "";
      if (part.type === "file")
        return part.file?.filename
          ? `[file attachment: ${part.file.filename}]`
          : "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function jobMessages(messages: IncomingChatMessage[]): MobileAgentJobMessage[] {
  return messages
    .map((message) => {
      const role =
        message.role === "user" ||
        message.role === "assistant" ||
        message.role === "system"
          ? message.role
          : null;
      const content = messageText(message.content).trim();
      return role && content ? { role, content } : null;
    })
    .filter((message): message is MobileAgentJobMessage => Boolean(message))
    .slice(-MAX_JOB_MESSAGES);
}

function phoneJobErrorMessage(job: MobileAgentJob, machineName: string) {
  if (job.errorReason === "expired-unclaimed") {
    return `${machineName} never picked this turn up. Open the HivemindOS app on the phone so it can poll for work, then try again.`;
  }
  return (
    job.errorReason?.trim() || `The on-device run on ${machineName} failed.`
  );
}

export function streamMobileAgentTurn(input: {
  profile: AgentProfile;
  messages: IncomingChatMessage[];
  userPrompt: string;
  runtimeSessionId: string;
  chatStorageKey?: string;
  sharedVaultPath?: string;
  routeStartedAt: number;
}): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      const sendDone = () =>
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      const sendTool = (
        type: string,
        label: string,
        detail?: string,
        status: "running" | "completed" | "failed" = "running",
      ) =>
        send({
          type,
          toolName: "Phone agent",
          name: "Phone agent",
          message: label,
          detail,
          status,
        });
      // Per-session-message emission progress: assistant messages grow in
      // place (the session store merges consecutive assistant text), so track
      // how much of each message index has already been streamed.
      const emittedTextByIndex = new Map<number, number>();
      const emittedProcessIndexes = new Set<number>();
      let baselineCount = 0;
      const flushSession = (session: RuntimeChatSessionRecord | null) => {
        if (!session) return;
        for (
          let index = baselineCount;
          index < session.messages.length;
          index += 1
        ) {
          const message = session.messages[index];
          if (message.role === "assistant" && !message.type) {
            const emitted = emittedTextByIndex.get(index) ?? 0;
            if (message.content.length > emitted) {
              send({
                choices: [
                  { delta: { content: message.content.slice(emitted) } },
                ],
              });
              emittedTextByIndex.set(index, message.content.length);
            }
            continue;
          }
          if (
            message.role === "tool" &&
            message.type === "process" &&
            !emittedProcessIndexes.has(index)
          ) {
            emittedProcessIndexes.add(index);
            const [label, ...detail] = message.content.split("\n");
            const failed = /failed/i.test(label);
            sendTool(
              failed
                ? RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE
                : RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
              label.trim() || "Phone agent event",
              detail.join("\n").trim() || undefined,
              failed ? "failed" : "running",
            );
          }
        }
      };
      try {
        const machineKey = machineKeyFromMobileGatewayUrl(
          input.profile.gatewayUrl,
        );
        if (!machineKey)
          throw new Error(
            "This phone agent has an invalid mobile:// runtime address.",
          );
        const machineName = input.profile.machineName?.trim() || machineKey;
        const session = await startRuntimeChatSession({
          sessionId: input.runtimeSessionId,
          agent: input.profile,
          chatStorageKey: input.chatStorageKey,
          sharedVaultPath: input.sharedVaultPath,
          userContent: input.userPrompt,
          startedAt: input.routeStartedAt,
        });
        baselineCount = session.messages.length;
        send({
          session: {
            id: input.runtimeSessionId,
            runtime: input.profile.runtime,
            source: "hivemindos-mobile-agent",
            startedAt: input.routeStartedAt,
          },
        });
        const job = await enqueueMobileAgentJob({
          agentId: input.profile.id,
          machineKey,
          sessionId: input.runtimeSessionId,
          prompt: input.userPrompt,
          messages: jobMessages(input.messages),
        });
        const lastPollAt = await mobileAgentHostLastPollAt(machineKey);
        if (Date.now() - lastPollAt > MOBILE_AGENT_HOST_FRESH_MS) {
          sendTool(
            RUNTIME_STREAM_EVENT_TYPES.TOOL_START,
            `Waiting for ${machineName}`,
            `Open the HivemindOS app on ${machineName} to run this agent.`,
          );
        }
        const startedAtMs = Date.now();
        let failure = "";
        let finished = false;
        while (!cancelled && !finished) {
          const currentJob = await getMobileAgentJob(job.id);
          flushSession(
            await readRuntimeChatSession({
              sessionId: input.runtimeSessionId,
            }).catch(() => null),
          );
          if (!currentJob) {
            failure = "This phone agent job was removed before it finished.";
            finished = true;
          } else if (currentJob.status === "done") {
            finished = true;
          } else if (currentJob.status === "error") {
            failure = phoneJobErrorMessage(currentJob, machineName);
            finished = true;
          } else if (Date.now() - startedAtMs > TURN_TIMEOUT_MS) {
            await completeMobileAgentJob(job.id, {
              ok: false,
              errorReason: "phone-timeout",
            }).catch(() => undefined);
            await finishRuntimeChatSession(
              input.runtimeSessionId,
              "error",
            ).catch(() => undefined);
            failure = `${machineName} did not finish this turn within 6 minutes. Check that the HivemindOS app is open on the phone, then try again.`;
            finished = true;
          } else {
            await sleep(POLL_INTERVAL_MS);
          }
        }
        if (cancelled) return;
        // One last flush: the completion handler may have appended the final
        // assistant text just before flipping the job status.
        flushSession(
          await readRuntimeChatSession({
            sessionId: input.runtimeSessionId,
          }).catch(() => null),
        );
        if (failure) send({ error: failure });
        sendDone();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Phone agent turn failed.";
        await finishRuntimeChatSession(input.runtimeSessionId, "error").catch(
          () => undefined,
        );
        send({ error: message });
        sendDone();
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by a client disconnect
        }
      }
    },
    cancel() {
      cancelled = true;
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
