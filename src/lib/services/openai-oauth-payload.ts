export type OpenAiOAuthChatMessage = {
  role: string;
  content: string;
};

type OpenAiOAuthInputText = { type: "input_text" | "output_text"; text: string };
type OpenAiOAuthInputImage = { type: "input_image"; image_url: string; detail: "auto" };

export type OpenAiOAuthResponsesMessage = {
  type: "message";
  role: string;
  content: Array<OpenAiOAuthInputText | OpenAiOAuthInputImage>;
};

export type OpenAiOAuthToolContinuation = {
  id: string;
  name: string;
  arguments: string;
  output: string;
};

export type OpenAiOAuthToolContinuationItem =
  | OpenAiOAuthResponsesMessage
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

export function buildOpenAiOAuthResponsesInput(
  messages: OpenAiOAuthChatMessage[],
  images: string[] = [],
): OpenAiOAuthResponsesMessage[] {
  const conversation = messages.filter((message) => message.role !== "system");
  let lastUserIndex = -1;
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return conversation.map((message, index) => ({
    type: "message",
    role: message.role,
    content: [
      {
        type: message.role === "assistant" ? "output_text" : "input_text",
        text: message.content,
      },
      ...(index === lastUserIndex && message.role === "user"
        ? images.map((image_url) => ({ type: "input_image" as const, image_url, detail: "auto" as const }))
        : []),
    ],
  }));
}

/** Replays one Responses function-call turn with its server-owned outputs.
 * ChatGPT OAuth cannot consume Chat Completions `role: "tool"` messages; it
 * needs the original function_call + function_call_output items instead. */
export function buildOpenAiOAuthToolContinuationInput(
  assistantText: string,
  results: OpenAiOAuthToolContinuation[],
): OpenAiOAuthToolContinuationItem[] {
  const items: OpenAiOAuthToolContinuationItem[] = [];
  if (assistantText.trim()) {
    items.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: assistantText.trim() }],
    });
  }
  for (const result of results) {
    items.push({
      type: "function_call",
      call_id: result.id,
      name: result.name,
      arguments: result.arguments || "{}",
    });
    items.push({
      type: "function_call_output",
      call_id: result.id,
      output: result.output,
    });
  }
  return items;
}
