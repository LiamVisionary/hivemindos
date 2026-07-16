import type { ChatApplicationGenerationArtifact, ChatApplicationGenerationCard } from "@/features/dashboard/chat-application-generation";

const LOCAL_MEDIA_PATH_PATTERN = /(?:^|[\s([<{`"'])((?:\/Users|\/var|\/tmp|\/private\/tmp)\/[^\n\r"'<>`]+\.(?:gif|jpe?g|m4v|mov|mp4|png|webm|webp))(?:$|[\s)\]}>`"'])/gim;
const VIDEO_EXTENSION_PATTERN = /\.(?:m4v|mov|mp4|webm)$/i;

function generatedMediaUrl(path: string) {
  return `/api/chat/generated-media?path=${encodeURIComponent(path)}`;
}

function uniqueMediaPaths(text: string) {
  const paths = new Set<string>();
  for (const match of text.matchAll(LOCAL_MEDIA_PATH_PATTERN)) {
    paths.add(match[1].trim());
  }
  return [...paths];
}

function promptFromAssistantText(text: string) {
  const generated = text.match(/\bgenerated\s+(?:\w+\s+)?images?\s+of\s+(.+?)\s+for\s+you\b/i);
  if (generated?.[1]?.trim()) return generated[1].trim();
  return "Image file";
}

export function generatedImageCardFromAssistantText(text: string, createdAt?: number): ChatApplicationGenerationCard | null {
  const card = generatedMediaCardFromAssistantText(text, createdAt);
  return card?.kind === "image" ? card : null;
}

export function generatedMediaCardFromAssistantText(text: string, createdAt?: number): ChatApplicationGenerationCard | null {
  const paths = uniqueMediaPaths(text);
  if (!paths.length) return null;
  const kind = paths.some((path) => VIDEO_EXTENSION_PATTERN.test(path)) ? "video" : "image";
  const artifacts: ChatApplicationGenerationArtifact[] = paths.map((path, index) => ({
    kind: VIDEO_EXTENSION_PATTERN.test(path) ? "video" : "image",
    url: generatedMediaUrl(path),
    label: paths.length === 1 ? `${kind === "video" ? "Video" : "Image"} file` : `Media file ${index + 1}`,
  }));
  return {
    id: `generated-media-paths-${createdAt ?? ""}-${paths[0]}`,
    kind,
    prompt: kind === "video" ? "Rendered video" : promptFromAssistantText(text),
    status: "ready",
    title: paths.length === 1 ? `${kind === "video" ? "Video" : "Image"} file` : "Media files",
    appName: kind === "video" && /hyperframes/i.test(text) ? "HyperFrames" : "Agent media cache",
    artifacts,
    completedAt: createdAt,
  };
}
