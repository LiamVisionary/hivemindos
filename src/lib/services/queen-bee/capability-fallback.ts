import {
  HIVEMIND_OS_RUNTIME,
  type AgentProfile,
} from "@/lib/types/agent-runtime";
import {
  readRuntimeResponseText,
} from "@/lib/services/phone/runtime-voice-turn";
import { readRuntimeChatSession } from "@/lib/services/chat/runtime-session-store";
import {
  resolveOpenAiApiKeyChatEndpoint,
  resolvePreferredOpenAiChatRoute,
} from "@/lib/services/openai-preferred-chat";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import type { PreferredOpenAiChatRoute } from "@/lib/config/openai-provider-routing";

type CapabilityMessage = { role: string; content: string };

type CapabilityFallbackInput = {
  origin: string;
  messages: CapabilityMessage[];
  model: string;
  sessionId: string;
  actingWalletSource?: { agentId: string; address: string; network: string; kind: string };
  suppressWalletIntents?: boolean;
};

type CapabilityFallbackDependencies = {
  apiKey?: () => Promise<string>;
  fetcher?: typeof fetch;
  readSession?: typeof readRuntimeChatSession;
  readResponse?: (response: Response) => Promise<string>;
  resolveRoute?: (model: string) => Promise<PreferredOpenAiChatRoute>;
  resolveApiEndpoint?: typeof resolveOpenAiApiKeyChatEndpoint;
};

export type BuiltInCapabilityTurnResult = {
  text: string;
  capabilityExecuted: boolean;
  approvalRequired: boolean;
};

function capabilitySseEvents(raw: string) {
  const events: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    try {
      const payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
      events.push(payload.event && typeof payload.event === "object"
        ? payload.event as Record<string, unknown>
        : payload);
    } catch {
      // Ignore non-JSON keepalives.
    }
  }
  return events;
}

export function capabilityExecutionFromSse(raw: string) {
  return capabilitySseEvents(raw).some((event) => (
    event.type === "chat.tool.done"
    && event.status === "completed"
    && (event.toolName !== "invoke_hive_capability" || event.operation === "invoke")
  ));
}

function capabilityExecutionReceipt(content: string) {
  return /^(?:Hive capability completed|Command finished|Image generation completed|Video generation completed|Bankr action finished)\b/i.test(content.trim());
}

async function recentCapabilitySessionMessages(
  readSession: typeof readRuntimeChatSession,
  sessionId: string,
  beforeCount: number,
) {
  let messages: Awaited<ReturnType<typeof readRuntimeChatSession>>["messages"] = [];
  for (const delayMs of [0, 25, 75, 150]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    messages = (await readSession({ sessionId }).catch(() => null))?.messages.slice(beforeCount) ?? [];
    if (messages.some((message) => message.role === "tool" && (capabilityExecutionReceipt(message.content) || /(?:approval|permission) required/i.test(message.content)))) break;
  }
  return messages;
}

export function capabilityApprovalFromSse(raw: string) {
  for (const event of capabilitySseEvents(raw)) {
    if (event.type !== "chat.approval") continue;
    const commandLine = typeof event.commandLine === "string" ? event.commandLine.trim() : "";
    const question = typeof event.question === "string" ? event.question.trim() : "Approval is required.";
    const detail = typeof event.detail === "string" ? event.detail.trim() : "";
    return {
      speech: commandLine
        ? `The capability is available, but running ${commandLine} needs your approval.`
        : "The capability is available, but the next action needs your approval.",
      detail: [question, detail].filter(Boolean).join("\n\n"),
    };
  }
  return null;
}

export function builtInQueenCapabilityProfile(
  model: string,
  token = "",
  auth: PreferredOpenAiChatRoute["auth"] = "api-key",
  apiUrl = new URL(
    "/v1/chat/completions",
    "https://api.openai.com",
  ).toString(),
): AgentProfile {
  if (auth === "oauth") {
    return {
      id: "queen-capability-fallback",
      name: "Queen capability fallback",
      runtime: "hermes",
      provider: "openai-codex",
      model,
      gatewayUrl:
        process.env.NEXT_PUBLIC_HERMES_BASE_URL ?? "http://127.0.0.1:8642",
      chatPath: "/chat",
      statusPath: "/health",
      runtimeCapabilities: { chat: true, skillActions: true },
      workerClass: "general",
    };
  }
  const endpoint = new URL(apiUrl);
  return {
    id: "queen-capability-fallback",
    name: "Queen capability fallback",
    runtime: HIVEMIND_OS_RUNTIME,
    provider: "openai",
    model,
    gatewayUrl: endpoint.origin,
    chatPath: endpoint.pathname,
    statusPath: "/models",
    token,
    runtimeCapabilities: { chat: true, skillActions: true },
    workerClass: "general",
  };
}

export async function runBuiltInQueenCapabilityTurn(
  input: CapabilityFallbackInput,
  dependencies: CapabilityFallbackDependencies = {},
) {
  return (await runBuiltInQueenCapabilityTurnWithEvidence(input, dependencies)).text;
}

export async function runBuiltInQueenCapabilityTurnWithEvidence(
  input: CapabilityFallbackInput,
  dependencies: CapabilityFallbackDependencies = {},
): Promise<BuiltInCapabilityTurnResult> {
  const route = await (
    dependencies.resolveRoute ?? resolvePreferredOpenAiChatRoute
  )(input.model);
  let profile: AgentProfile;
  if (route.auth === "oauth") {
    profile = builtInQueenCapabilityProfile(route.model, "", "oauth");
  } else {
    const endpoint = dependencies.apiKey
      ? {
          key: await dependencies.apiKey(),
          url: new URL(
            "/v1/chat/completions",
            "https://api.openai.com",
          ).toString(),
        }
      : await (
          dependencies.resolveApiEndpoint ?? resolveOpenAiApiKeyChatEndpoint
        )();
    if (!endpoint?.key) {
      throw new Error(
        "The built-in tool-capable fallback has no OpenAI API key.",
      );
    }
    profile = builtInQueenCapabilityProfile(
      route.model,
      endpoint.key,
      "api-key",
      endpoint.url,
    );
  }

  const fetcher = dependencies.fetcher ?? fetch;
  const readSession = dependencies.readSession ?? readRuntimeChatSession;
  const beforeCount = (await readSession({ sessionId: input.sessionId }).catch(() => null))?.messages.length ?? 0;
  const response = await fetcher(new URL("/api/chat/agent-runtime", input.origin), {
    method: "POST",
    headers: { "content-type": "application/json", ...internalApiAuthHeaders() },
    body: JSON.stringify({
      agent: profile,
      messages: input.messages,
      runtimeSessionId: input.sessionId,
      agentMode: "act",
      latencyMode: "capability",
      permissionMode: "manual",
      actingWalletSource: input.actingWalletSource,
      suppressWalletIntents: input.suppressWalletIntents === true,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const approvalCopy = response.clone();
  const readResponse = dependencies.readResponse ?? readRuntimeResponseText;
  const [text, raw] = await Promise.all([readResponse(response), approvalCopy.text()]);
  if (!response.ok) {
    throw new Error(text.trim() || `Built-in capability runtime returned HTTP ${response.status}.`);
  }
  const approval = capabilityApprovalFromSse(raw);
  const newMessages = await recentCapabilitySessionMessages(readSession, input.sessionId, beforeCount);
  return {
    text: text.trim() || (approval ? JSON.stringify(approval) : ""),
    capabilityExecuted: capabilityExecutionFromSse(raw) || newMessages.some((message) => message.role === "tool" && capabilityExecutionReceipt(message.content)),
    approvalRequired: Boolean(approval) || newMessages.some((message) => message.role === "tool" && /(?:approval|permission) required/i.test(message.content)),
  };
}
