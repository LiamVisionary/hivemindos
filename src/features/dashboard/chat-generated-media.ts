import type { ChatApplicationGenerationArtifact, ChatApplicationGenerationCard } from "@/features/dashboard/chat-application-generation";

const LOCAL_IMAGE_PATH_PATTERN = /(?:^|[\s([<{`"'])((?:\/Users|\/var|\/tmp|\/private\/tmp)\/[^\n\r"'<>`]+\.(?:gif|jpe?g|png|webp))(?:$|[\s)\]}>`"'])/gim;

function generatedMediaUrl(path: string) {
  return `/api/chat/generated-media?path=${encodeURIComponent(path)}`;
}

function uniqueImagePaths(text: string) {
  const paths = new Set<string>();
  for (const match of text.matchAll(LOCAL_IMAGE_PATH_PATTERN)) {
    paths.add(match[1].trim());
  }
  return [...paths];
}

function promptFromAssistantText(text: string) {
  const generated = text.match(/\bgenerated\s+(?:\w+\s+)?images?\s+of\s+(.+?)\s+for\s+you\b/i);
  if (generated?.[1]?.trim()) return generated[1].trim();
  return "Generated image";
}

export function generatedImageCardFromAssistantText(text: string, createdAt?: number): ChatApplicationGenerationCard | null {
  const paths = uniqueImagePaths(text);
  if (!paths.length) return null;
  const artifacts: ChatApplicationGenerationArtifact[] = paths.map((path, index) => ({
    kind: "image",
    url: generatedMediaUrl(path),
    label: paths.length === 1 ? "Generated image" : `Generated image ${index + 1}`,
  }));
  return {
    id: `generated-image-paths-${createdAt ?? ""}-${paths[0]}`,
    kind: "image",
    prompt: promptFromAssistantText(text),
    status: "ready",
    title: paths.length === 1 ? "Generated image" : "Generated images",
    appName: "Agent image cache",
    artifacts,
    completedAt: createdAt,
  };
}
