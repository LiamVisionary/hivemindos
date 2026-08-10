import { imageGenerationToApplicationGeneration, type ChatApplicationGenerationCard } from "@/features/dashboard/chat-application-generation";
import { generatedImageCardFromAssistantText } from "@/features/dashboard/chat-generated-media";
import { mergeChatProcessEvents } from "@/lib/services/chat/chat-process-events";

function cardFromMessage(message: any): ChatApplicationGenerationCard | null {
  if (message?.applicationGeneration) return message.applicationGeneration;
  if (message?.imageGeneration) return imageGenerationToApplicationGeneration(message.imageGeneration);
  const content = typeof message?.content === "string" ? message.content : "";
  return content ? generatedImageCardFromAssistantText(content, message?.createdAt) : null;
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
        processEvents: mergeChatProcessEvents(previous.processEvents ?? previous.events, message.processEvents ?? message.events),
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
