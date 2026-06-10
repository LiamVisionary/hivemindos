import { imageGenerationToApplicationGeneration, type ChatApplicationGenerationCard } from "@/features/dashboard/chat-application-generation";
import { generatedImageCardFromAssistantText } from "@/features/dashboard/chat-generated-media";

function cardFromMessage(message: any): ChatApplicationGenerationCard | null {
  if (message?.applicationGeneration) return message.applicationGeneration;
  if (message?.imageGeneration) return imageGenerationToApplicationGeneration(message.imageGeneration);
  const content = typeof message?.content === "string" ? message.content : "";
  return content ? generatedImageCardFromAssistantText(content, message?.createdAt) : null;
}

function mergeProcessEvents(first: any[] = [], second: any[] = []) {
  const output: any[] = [];
  const seen = new Set<string>();
  for (const event of [...first, ...second]) {
    if (!event) continue;
    const key = [event.runId ?? "", event.label ?? "", event.detail ?? "", event.status ?? ""].join("\u001f");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(event);
  }
  return output;
}

export function collapseSameTurnGenerationMessages(messages: any[] = []) {
  const output: any[] = [];
  let latestUserOutputIndex = -1;
  let generationAssistantOutputIndex = -1;
  for (const message of messages) {
    if (message?.role === "user") {
      latestUserOutputIndex = output.length;
      generationAssistantOutputIndex = -1;
      output.push(message);
      continue;
    }
    if (message?.role !== "assistant") {
      output.push(message);
      continue;
    }
    const card = cardFromMessage(message);
    if (card && generationAssistantOutputIndex > latestUserOutputIndex) {
      const previous = output[generationAssistantOutputIndex] ?? {};
      const previousCard = cardFromMessage(previous);
      const nextCard = card.status === "ready" || !previousCard || previousCard.status !== "ready" ? card : previousCard;
      output[generationAssistantOutputIndex] = {
        ...previous,
        ...message,
        content: message.content || previous.content || "",
        processEvents: mergeProcessEvents(previous.processEvents ?? previous.events, message.processEvents ?? message.events),
        applicationGeneration: nextCard,
        imageGeneration: undefined,
      };
      continue;
    }
    if (card) generationAssistantOutputIndex = output.length;
    output.push(message);
  }
  return output;
}
