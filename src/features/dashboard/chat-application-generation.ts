export type ChatApplicationGenerationKind = "image" | "music" | "tts" | "model3d" | "video";
export type ChatApplicationGenerationStatus = "running" | "ready" | "error";
export type ChatApplicationGenerationArtifactKind = "image" | "audio" | "video" | "model3d" | "file";

export type ChatApplicationGenerationArtifact = {
  kind: ChatApplicationGenerationArtifactKind;
  url: string;
  label?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  seed?: string | number;
};

export type ChatApplicationGenerationCard = {
  id: string;
  kind: ChatApplicationGenerationKind;
  prompt: string;
  status: ChatApplicationGenerationStatus;
  title?: string;
  appId?: string;
  appName?: string;
  serviceKind?: string;
  modelName?: string;
  machineName?: string;
  machineSpecs?: string;
  artifacts?: ChatApplicationGenerationArtifact[];
  error?: string;
  createdAt?: number;
  completedAt?: number;
};

export type ChatGeneratedImage = {
  url: string;
  width?: number;
  height?: number;
  seed?: string | number;
};

export type ChatImageGeneration = {
  id: string;
  prompt: string;
  status: ChatApplicationGenerationStatus;
  appId?: string;
  appName?: string;
  serviceKind?: string;
  modelName?: string;
  machineName?: string;
  machineSpecs?: string;
  images?: ChatGeneratedImage[];
  error?: string;
  createdAt?: number;
  completedAt?: number;
};

export function normalizeApplicationGenerationUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function applicationGenerationContent(card: Pick<ChatApplicationGenerationCard, "kind" | "prompt" | "status">) {
  const label = card.kind === "model3d" ? "3D model" : card.kind;
  if (card.status === "ready") return `Generated ${label}: ${card.prompt}`;
  if (card.status === "error") return `${label} generation failed: ${card.prompt}`;
  return `Generating ${label}: ${card.prompt}`;
}

export function imageGenerationToApplicationGeneration(card: ChatImageGeneration): ChatApplicationGenerationCard {
  return {
    id: card.id,
    kind: "image",
    prompt: card.prompt,
    status: card.status,
    appId: card.appId,
    appName: card.appName,
    serviceKind: card.serviceKind,
    modelName: card.modelName,
    machineName: card.machineName,
    machineSpecs: card.machineSpecs,
    artifacts: card.images
      ?.map((image) => ({ image, url: normalizeApplicationGenerationUrl(image.url) }))
      .filter((item): item is { image: ChatGeneratedImage; url: string } => Boolean(item.url))
      .map(({ image, url }, index) => ({
        kind: "image",
        url,
        label: index === 0 ? "Generated image" : `Generated image ${index + 1}`,
        width: image.width,
        height: image.height,
        seed: image.seed,
      })),
    error: card.error,
    createdAt: card.createdAt,
    completedAt: card.completedAt,
  };
}
