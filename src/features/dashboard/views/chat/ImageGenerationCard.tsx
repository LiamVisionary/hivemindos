"use client";

import { imageGenerationToApplicationGeneration, type ChatImageGeneration } from "@/features/dashboard/chat-application-generation";
import { ApplicationGenerationCard } from "@/features/dashboard/views/chat/ApplicationGenerationCard";

export type { ChatGeneratedImage, ChatImageGeneration } from "@/features/dashboard/chat-application-generation";

export function ImageGenerationCard({ card }: { card: ChatImageGeneration }) {
  return <ApplicationGenerationCard card={imageGenerationToApplicationGeneration(card)} />;
}
