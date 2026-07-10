import { latestUserMessage, type IncomingMessage } from "./messages";
import type { ChatMediaArtifact } from "./media-artifacts";
import { VIDEO_GENERATION_TOOL_NAME, type AccumulatedToolCall } from "./openai-compatible-tools";

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function latestUserTurnHasInlineImage(messages: IncomingMessage[]) {
  const message = latestUserMessage(messages);
  if (!message || typeof message.content === "string") return false;
  return message.content.some((part) => part.type === "image_url" && Boolean(part.image_url?.url?.trim()));
}

export function latestUserTurnHasAttachmentReference(messages: IncomingMessage[]) {
  const message = latestUserMessage(messages);
  if (!message) return false;
  const content = typeof message.content === "string"
    ? message.content
    : message.content.map((part) => part.type === "text" ? part.text ?? "" : "").join("\n");
  return /^Attached file(?: and folder)? references:/im.test(content)
    || /\.(?:png|jpe?g|webp|gif|heic|heif|bmp|tiff?)\b/i.test(content);
}

export function hasCurrentTurnImageArtifact(artifacts: ChatMediaArtifact[] = []) {
  return artifacts.some((artifact) => artifact.kind === "image" && Boolean(artifact.path || artifact.dataUrl));
}

export function hasCurrentTurnMediaArtifact(artifacts: ChatMediaArtifact[] = []) {
  return artifacts.some((artifact) => Boolean(artifact.path || artifact.dataUrl));
}

export function videoInputImagesForArgs(
  args: Record<string, unknown>,
  artifacts: ChatMediaArtifact[],
) {
  const imageId = typeof args.inputImageId === "string" ? args.inputImageId.trim() : "";
  const imagePath = typeof args.inputImagePath === "string" ? args.inputImagePath.trim() : "";
  const selected = artifacts.find((artifact) => (
    artifact.kind === "image"
    && ((imageId && artifact.id === imageId) || (imagePath && artifact.path === imagePath))
  )) ?? artifacts.find((artifact) => artifact.kind === "image");
  return selected ? [{
    path: selected.path,
    dataUrl: selected.dataUrl,
    mimeType: selected.mimeType,
    name: selected.name,
  }] : [];
}

export function forceVideoGenerationToolCall(
  toolCalls: AccumulatedToolCall[],
  force: boolean,
  prompt: string,
) {
  if (!force) return toolCalls;
  const selected = toolCalls.find((call) => call.name === VIDEO_GENERATION_TOOL_NAME);
  return [selected ?? {
    id: "forced_generate_video",
    name: VIDEO_GENERATION_TOOL_NAME,
    arguments: JSON.stringify({ prompt }),
  }];
}

export function explicitLocalCommandRequest(query: string) {
  return /\b(?:run|execute|shell|terminal|command|bash|zsh|python3?|node|script|grep|cat|ls|find|stat|exiftool|ffmpeg|imagemagick|full\s+path|working\s+directory|filesystem|file\s+system)\b/i.test(query);
}

export function visualMediaInspectionRequest(query: string) {
  const text = clean(query);
  if (!text) return true;
  return /\b(?:what(?:'s|\s+is|\s+about)|whats|and\s+this|this\?|describe|think\s+of|look\s+at|see|in\s+this|image|photo|picture|screenshot|visual|identify|caption|analy[sz]e|read|transcribe|ocr|does\s+this|is\s+this|who|where)\b/i.test(text);
}

export function shouldSuppressCommandToolForNativeMedia(input: {
  messages: IncomingMessage[];
  mediaArtifacts?: ChatMediaArtifact[];
  intentText: string;
  generationToolOffered: boolean;
}) {
  if (explicitLocalCommandRequest(input.intentText)) return false;
  const visualRequest = visualMediaInspectionRequest(input.intentText);
  const hasNativeMedia = latestUserTurnHasInlineImage(input.messages) || hasCurrentTurnImageArtifact(input.mediaArtifacts);
  const hasAttachment = hasNativeMedia || hasCurrentTurnMediaArtifact(input.mediaArtifacts) || latestUserTurnHasAttachmentReference(input.messages);
  if (!hasAttachment) return false;
  return input.generationToolOffered || visualRequest;
}
