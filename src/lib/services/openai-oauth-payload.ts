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
