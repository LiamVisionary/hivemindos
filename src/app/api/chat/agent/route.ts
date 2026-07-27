import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { getLanguageModel } from "@/lib/providers";
import { searchTool } from "@/lib/search-tool";

export const maxDuration = 120;

const SYSTEM = `You are an open-source local automation assistant.

You help developers understand OpenClaw gateway setup, local agent workflows,
and safe automation patterns. Use web search when the user asks about current
versions, releases, or documentation.`;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages = (body as { messages?: UIMessage[] }).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { error: "Expected { messages: UIMessage[] }" },
      { status: 400 },
    );
  }

  let model;
  try {
    model = await getLanguageModel();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model configuration error";
    return Response.json({ error: message }, { status: 503 });
  }

  const tools = { search: searchTool };
  const modelMessages = convertToModelMessages(messages, { tools });
  const result = streamText({
    model,
    system: SYSTEM,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    temperature: 0.4,
  });

  return result.toUIMessageStreamResponse({ originalMessages: messages });
}
