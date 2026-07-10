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
  sourceArtifacts?: ChatApplicationGenerationArtifact[];
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

function normalizeApplicationGenerationArtifacts(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((artifact) => {
    if (!artifact || typeof artifact !== "object") return [];
    const item = artifact as Partial<ChatApplicationGenerationArtifact>;
    const url = normalizeApplicationGenerationUrl(item.url);
    if (!url) return [];
    const artifactKind = item.kind === "image" || item.kind === "audio" || item.kind === "video" || item.kind === "model3d" || item.kind === "file"
      ? item.kind
      : "file";
    return [{
      kind: artifactKind,
      url,
      ...(typeof item.label === "string" ? { label: item.label } : {}),
      ...(typeof item.mimeType === "string" ? { mimeType: item.mimeType } : {}),
      ...(typeof item.width === "number" ? { width: item.width } : {}),
      ...(typeof item.height === "number" ? { height: item.height } : {}),
      ...(typeof item.durationMs === "number" ? { durationMs: item.durationMs } : {}),
      ...(typeof item.seed === "string" || typeof item.seed === "number" ? { seed: item.seed } : {}),
    } satisfies ChatApplicationGenerationArtifact];
  });
}

export function normalizeApplicationGenerationCard(value: unknown): ChatApplicationGenerationCard | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const card = value as Partial<ChatApplicationGenerationCard>;
  const id = typeof card.id === "string" ? card.id.trim() : "";
  const prompt = typeof card.prompt === "string" ? card.prompt.trim() : "";
  if (!id || !prompt) return undefined;
  const kind = card.kind === "image" || card.kind === "music" || card.kind === "tts" || card.kind === "model3d" || card.kind === "video"
    ? card.kind
    : "image";
  const status = card.status === "running" || card.status === "ready" || card.status === "error" ? card.status : "ready";
  const sourceArtifacts = normalizeApplicationGenerationArtifacts(card.sourceArtifacts);
  const artifacts = normalizeApplicationGenerationArtifacts(card.artifacts);
  return {
    id,
    kind,
    prompt,
    status,
    ...(typeof card.title === "string" ? { title: card.title } : {}),
    ...(typeof card.appId === "string" ? { appId: card.appId } : {}),
    ...(typeof card.appName === "string" ? { appName: card.appName } : {}),
    ...(typeof card.serviceKind === "string" ? { serviceKind: card.serviceKind } : {}),
    ...(typeof card.modelName === "string" ? { modelName: card.modelName } : {}),
    ...(typeof card.machineName === "string" ? { machineName: card.machineName } : {}),
    ...(typeof card.machineSpecs === "string" ? { machineSpecs: card.machineSpecs } : {}),
    ...(sourceArtifacts ? { sourceArtifacts } : {}),
    ...(artifacts ? { artifacts } : {}),
    ...(typeof card.error === "string" ? { error: card.error } : {}),
    ...(typeof card.createdAt === "number" ? { createdAt: card.createdAt } : {}),
    ...(typeof card.completedAt === "number" ? { completedAt: card.completedAt } : {}),
  };
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
