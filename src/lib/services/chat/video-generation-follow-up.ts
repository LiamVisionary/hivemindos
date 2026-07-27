import { chatImageMimeTypeForPath, isChatImagePath } from "@/lib/services/chat/chat-image-formats";

type VideoGenerationSourceArtifact = {
  kind?: unknown;
  url?: unknown;
  label?: unknown;
  mimeType?: unknown;
};

type VideoGenerationSessionMessage = {
  role?: string;
  content?: string;
  applicationGeneration?: {
    id?: unknown;
    kind?: unknown;
    prompt?: unknown;
    status?: unknown;
    sourceArtifacts?: unknown;
  };
};

export type ReusedVideoInputImage = {
  path: string;
  mimeType: string;
  name: string;
};

export type ResolvedVideoGenerationFollowUp = {
  prompt: string;
  inputImages: ReusedVideoInputImage[];
  previousGenerationId?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || "source-image";
}

function imageMimeType(path: string, candidate?: unknown) {
  const declared = clean(candidate);
  if (declared.startsWith("image/")) return declared;
  return chatImageMimeTypeForPath(path) || "image/jpeg";
}

export function generationPromptWithoutAttachmentReferences(value: unknown) {
  return clean(value).split(/\s+Attached file(?: and folder)? references:\s*/i)[0]?.trim() ?? "";
}

function generatedMediaPath(value: unknown) {
  const url = clean(value);
  if (!url) return "";
  try {
    const parsed = new URL(url, "http://hivemind.local");
    if (parsed.pathname !== "/api/chat/generated-media") return "";
    return clean(parsed.searchParams.get("path"));
  } catch {
    return "";
  }
}

function sourceImageFromArtifacts(value: unknown): ReusedVideoInputImage | null {
  if (!Array.isArray(value)) return null;
  for (const artifactValue of value) {
    if (!artifactValue || typeof artifactValue !== "object") continue;
    const artifact = artifactValue as VideoGenerationSourceArtifact;
    if (artifact.kind !== "image") continue;
    const path = generatedMediaPath(artifact.url);
    if (!path) continue;
    return {
      path,
      mimeType: imageMimeType(path, artifact.mimeType),
      name: clean(artifact.label) || basename(path),
    };
  }
  return null;
}

function sourceImageFromAttachmentReference(value: unknown): ReusedVideoInputImage | null {
  const content = clean(value);
  if (!content) return null;
  const path = clean(/(?:^|[;(]\s*)path:\s*([^;)\n]+)/im.exec(content)?.[1]);
  if (!path || !isChatImagePath(path)) return null;
  const mimeType = clean(/(?:^|[;(]\s*)type:\s*([^;)\n]+)/im.exec(content)?.[1]);
  return { path, mimeType: imageMimeType(path, mimeType), name: basename(path) };
}

export function isVideoGenerationFollowUpRequest(value: string) {
  const prompt = clean(value);
  if (!prompt) return false;
  return /^(?:please\s+)?(?:now\s+)?(?:re-?generate|redo|rerender|re-render|remake|try\s+(?:it|that|the\s+video)?\s*again|generate\s+(?:it|that|the\s+video)\s+again)\b/i.test(prompt)
    || /^now\s+(?:with|without|in|using|add|remove|change|make|but)\b/i.test(prompt)
    || /^(?:again|same\s+(?:video|one))\b/i.test(prompt);
}

function requestedChanges(value: string) {
  const withoutNow = clean(value).replace(/^(?:please\s+)?now\s+/i, "");
  const withoutRegenerate = withoutNow.replace(
    /^(?:re-?generate|redo|rerender|re-render|remake|generate)\s+(?:(?:it|that|the\s+video)\s*)?(?:again\s*)?(?:with\s+)?/i,
    "",
  );
  const withoutTryAgain = withoutRegenerate.replace(/^try\s+(?:(?:it|that|the\s+video)\s*)?again\s*(?:with\s+)?/i, "");
  return withoutTryAgain.replace(/^with\s+/i, "").trim() || clean(value);
}

export function resolveVideoGenerationFollowUp(
  prompt: string,
  messages: VideoGenerationSessionMessage[] = [],
): ResolvedVideoGenerationFollowUp | null {
  if (!isVideoGenerationFollowUpRequest(prompt)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const card = message?.applicationGeneration;
    if (message?.role !== "assistant" || card?.kind !== "video") continue;
    let inputImage = sourceImageFromArtifacts(card.sourceArtifacts);
    if (!inputImage) {
      for (let userIndex = index - 1; userIndex >= 0; userIndex -= 1) {
        if (messages[userIndex]?.role !== "user") continue;
        inputImage = sourceImageFromAttachmentReference(messages[userIndex]?.content);
        break;
      }
    }
    if (!inputImage) return null;
    const previousPrompt = generationPromptWithoutAttachmentReferences(card.prompt) || "the previous video";
    const changes = requestedChanges(prompt);
    return {
      prompt: `Generate a new video from the same source image. Previous prompt: ${previousPrompt}. Requested changes: ${changes}.`,
      inputImages: [inputImage],
      previousGenerationId: clean(card.id) || undefined,
    };
  }
  return null;
}
