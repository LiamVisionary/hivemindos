import {
  contentHasLeakedToolCallMarker,
  extractLeakedToolCalls,
  stripLeakedToolCallMarkup,
} from "@/lib/services/chat/leaked-tool-call-markup";
import {
  extractChunk,
  type IncomingMessage,
} from "./messages";
import {
  extractOpenAIToolCalls,
  type AccumulatedToolCall,
  type NonStreamToolRun,
} from "./openai-compatible-tools";

export type NonStreamWinningRequest = {
  url: string;
  headers: Record<string, string>;
  messages: IncomingMessage[];
  model: string;
  provider: string;
  sentTools: boolean;
  cacheBody: Record<string, unknown>;
  inferenceBody: Record<string, unknown>;
};

type NonStreamConversationInput = {
  initialToolCalls: AccumulatedToolCall[];
  request: NonStreamWinningRequest;
  toolDefinitions: Array<Record<string, unknown>>;
  maxToolRounds: number;
  timeoutMs: number;
  runToolCalls: (toolCalls: AccumulatedToolCall[]) => Promise<NonStreamToolRun>;
  fetcher?: typeof fetch;
};

export type NonStreamConversationResult = {
  events: string[];
  text: string;
  raw: unknown;
  prompted: boolean;
  failed: boolean;
};

const SAFE_TOOL_LOOP_FAILURE = "I couldn't complete that capability action because the agent produced an invalid tool request. Nothing was run. Please retry, or choose another agent or model.";
const TOOL_LOOP_RECOVERY_PROMPT = [
  "Tool-loop recovery: tools are unavailable for this final response.",
  "Answer the user's request directly in concise plain text.",
  "Do not emit tool-call syntax, API parameters, validator messages, hidden reasoning, or claims that an action succeeded.",
  "State what did or did not happen. If a required user choice is missing, ask one concise question with explicit choices.",
].join(" ");

async function fetchJson(input: NonStreamConversationInput, messages: Array<Record<string, unknown>>) {
  const response = await (input.fetcher ?? fetch)(input.request.url, {
    method: "POST",
    headers: input.request.headers,
    body: JSON.stringify({
      model: input.request.model,
      messages,
      stream: false,
      ...input.request.cacheBody,
      ...input.request.inferenceBody,
    }),
    signal: AbortSignal.timeout(input.timeoutMs),
  }).catch(() => null);
  if (!response?.ok || !response.body) return null;
  return response.json().catch(async () => ({ text: await response.text().catch(() => "") }));
}

async function recoverUserFacingText(
  input: NonStreamConversationInput,
  conversation: Array<Record<string, unknown>>,
) {
  const recoveryJson = await fetchJson(input, [
    ...conversation,
    { role: "system", content: TOOL_LOOP_RECOVERY_PROMPT },
  ]);
  const recoveryText = stripLeakedToolCallMarkup(extractChunk(recoveryJson)).trim();
  return {
    text: recoveryText && !contentHasLeakedToolCallMarker(recoveryText)
      ? recoveryText
      : SAFE_TOOL_LOOP_FAILURE,
    raw: recoveryJson,
  };
}

export async function runNonStreamToolConversation(
  input: NonStreamConversationInput,
): Promise<NonStreamConversationResult> {
  const events: string[] = [];
  const conversation: Array<Record<string, unknown>> = [
    ...(input.request.messages as unknown as Array<Record<string, unknown>>),
  ];
  let toolCalls = input.initialToolCalls;
  let toolRoundsLeft = input.maxToolRounds;
  let fallbackText = "The tool finished.";
  let raw: unknown = null;
  let failed = false;

  while (toolCalls.length && toolRoundsLeft > 0) {
    toolRoundsLeft -= 1;
    const toolRun = await input.runToolCalls(toolCalls);
    events.push(...toolRun.events);
    failed ||= toolRun.failures.length > 0;
    if (toolRun.prompted) return { events, text: "", raw, prompted: true, failed };
    if (toolRun.fallbacks.length) fallbackText = toolRun.fallbacks.join(" ");
    if (toolRun.finalTexts.length) {
      return { events, text: toolRun.finalTexts.join("\n\n"), raw, prompted: false, failed };
    }
    conversation.push({ role: "assistant", content: "", tool_calls: toolRun.assistantToolCalls });
    conversation.push(...toolRun.toolResultMessages);
    if (toolRun.steeringMessages?.length) conversation.push(...toolRun.steeringMessages);
    const continuationMessages = [...conversation];
    const continuationBody: Record<string, unknown> = {
      model: input.request.model,
      messages: continuationMessages,
      stream: false,
      ...input.request.cacheBody,
      ...input.request.inferenceBody,
      ...(toolRoundsLeft > 0 && input.toolDefinitions.length
        ? { tools: input.toolDefinitions, tool_choice: "auto" }
        : {}),
    };
    const continuation = await (input.fetcher ?? fetch)(input.request.url, {
      method: "POST",
      headers: input.request.headers,
      body: JSON.stringify(continuationBody),
      signal: AbortSignal.timeout(input.timeoutMs),
    }).catch(() => null);
    if (!continuation?.ok || !continuation.body) {
      return failed
        ? { events, ...(await recoverUserFacingText(input, conversation)), prompted: false, failed: true }
        : { events, text: fallbackText, raw, prompted: false, failed: false };
    }
    const continuationJson = await continuation.json().catch(async () => ({ text: await continuation.text().catch(() => "") }));
    raw = continuationJson;
    const continuationText = extractChunk(continuationJson);
    toolCalls = toolRoundsLeft > 0 && input.request.sentTools
      ? [...extractOpenAIToolCalls(continuationJson), ...extractLeakedToolCalls(continuationText)]
      : [];
    if (!toolCalls.length) {
      const visibleText = stripLeakedToolCallMarkup(continuationText).trim();
      if (visibleText) return { events, text: visibleText, raw, prompted: false, failed };
      return failed
        ? { events, ...(await recoverUserFacingText(input, conversation)), prompted: false, failed: true }
        : { events, text: fallbackText, raw, prompted: false, failed: false };
    }
  }

  return failed
    ? { events, ...(await recoverUserFacingText(input, conversation)), prompted: false, failed: true }
    : { events, text: fallbackText, raw, prompted: false, failed: false };
}
