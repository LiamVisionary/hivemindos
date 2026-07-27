import { applicationGenerationContent } from "@/features/dashboard/chat-application-generation";
import { generatedMediaCardFromAssistantText } from "@/features/dashboard/chat-generated-media";

function sameChatMessage(left: any, right: any) {
  return Boolean(left)
    && left?.role === right.role
    && (left?.content ?? "").trim() === (right.content ?? "").trim()
    && (left?.attachments?.length ?? 0) === (right.attachments?.length ?? 0)
    && Boolean(left?.agentPrompt) === Boolean(right.agentPrompt);
}

export function appendPreviewMessagesForActiveChat(current: any, agentId: string, leafKey: string, appendedMessages: any[]) {
  if (!current || current.agentId !== agentId || current.leafKey !== leafKey) return current;
  const next = [...current.messages];
  for (const message of appendedMessages) {
    if (sameChatMessage(next.at(-1), message)) continue;
    let previousUserIndex = -1;
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (next[index].role === "user" && next[index].content.trim() === message.content.trim()) {
        previousUserIndex = index;
        break;
      }
    }
    const between = previousUserIndex >= 0 ? next.slice(previousUserIndex + 1) : [];
    const duplicateActiveUser = message.role === "user" && between.length > 0 && between.every((item) => (
      item.role === "assistant"
      && !(item.content ?? "").trim()
      && !item.agentPrompt
    ));
    if (!duplicateActiveUser) next.push(message);
  }
  return { ...current, messages: next };
}

export function findLatestAssistantIndexAfterLastUser(items: Array<{ role?: string }>) {
  let latestUserIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  for (let index = items.length - 1; index > latestUserIndex; index -= 1) {
    if (items[index]?.role === "assistant") return index;
  }
  return -1;
}

export function processEventSignature(events: Array<{ at?: number; label?: string; detail?: string; status?: string; runId?: string }> = []) {
  return events.map((event) => [event.at, event.label, event.detail ?? "", event.status ?? "", event.runId ?? ""].join("\u001f")).join("\u001e");
}

export function applicationGenerationSignature(card: any) {
  return card ? JSON.stringify({
    id: card.id,
    status: card.status,
    prompt: card.prompt,
    sourceArtifactUrls: (card.sourceArtifacts ?? []).map((artifact: any) => artifact?.url ?? ""),
    artifactUrls: (card.artifacts ?? []).map((artifact: any) => artifact?.url ?? ""),
    error: card.error ?? "",
    completedAt: card.completedAt ?? "",
  }) : "";
}

export function cloneApplicationGenerationCard(card: any) {
  return card ? {
    ...card,
    sourceArtifacts: card.sourceArtifacts?.map((artifact: any) => ({ ...artifact })),
    artifacts: card.artifacts?.map((artifact: any) => ({ ...artifact })),
  } : undefined;
}

function isCapabilitySearchProcessEvent(label: string, detail?: string) {
  const normalizedLabel = label.trim().toLowerCase();
  if (normalizedLabel === "hive capability search" || normalizedLabel === "capability search") return true;
  const detailText = detail ?? "";
  return /\b(?:retrieval hits?|connected apps? observed)\b/i.test(detailText)
    && /\b(?:image generation available|image[-_\s]?gen config)\b/i.test(detailText);
}

function promptWantsImageGeneration(prompt: string) {
  return /\b(?:generate|create|make|draw|render|txt2img|text\s*to\s*image|image[-_\s]?gen|image generation)\b[\s\S]*\b(?:image|images|picture|pictures|illustration|artwork|photo|visual)\b/i.test(prompt)
    || /\b(?:txt2img|text\s*to\s*image|image[-_\s]?gen|image generation|comfyui|z[-_\s]?image)\b/i.test(prompt);
}

function promptWantsVideoGeneration(prompt: string) {
  return /\b(?:generate|create|make|render|produce|animate)\b[\s\S]*\b(?:video|movie|clip|animation|reel)\b/i.test(prompt)
    || /\b(?:video|movie|clip|animation|reel|image[-_\s]?to[-_\s]?video|img2vid|txt2vid)\b[\s\S]*\b(?:generate|create|make|render|produce|animate)\b/i.test(prompt);
}

export function shouldStartImageGenerationCard(prompt: string, label: string, detail?: string) {
  if (isCapabilitySearchProcessEvent(label, detail)) return false;
  const text = `${label}\n${detail ?? ""}`;
  const currentTurnWantsVideoGeneration = promptWantsVideoGeneration(prompt);
  const hyperframesRenderActivity = /\b(?:run\s+)?hyperframes\s+(?:lint|validate|inspect|snapshot|render)\b|\b(?:rendering|rendered)\b[\s\S]*\bhyperframes\b/i;
  if (currentTurnWantsVideoGeneration && hyperframesRenderActivity.test(text)) return true;
  const currentTurnWantsImageGeneration = promptWantsImageGeneration(prompt);
  const imageGenerationActivityPattern = /\b(?:image[-_\s]?gen|image generation|generate(?:d|s|ing)? image|generating image|txt2img|text\s*to\s*image|comfyui|z[-_\s]?image|gpt-image|dall-e|local[-_\s]?ai|image studio|\/api\/job|job_url)\b/i;
  const strongImageGenerationActivityPattern = /\b(?:image[-_\s]?gen|txt2img|text\s*to\s*image|comfyui|z[-_\s]?image|gpt-image|dall-e|local[-_\s]?ai|image studio|\/api\/job|job_url)\b/i;
  if (!imageGenerationActivityPattern.test(text)) return false;
  if (/\b(?:capabilit|context|search|skill context|file content read)\b/i.test(label) && !strongImageGenerationActivityPattern.test(text)) return false;
  return currentTurnWantsImageGeneration || strongImageGenerationActivityPattern.test(text);
}

export function shouldRenderImageGenerationCard(card: any) {
  if (!card) return false;
  if (Array.isArray(card.artifacts) && card.artifacts.length > 0) return true;
  if (card.error) return true;
  const status = String(card.status ?? "").trim().toLowerCase();
  if (status === "ready" || status === "failed" || status === "error") return true;
  if (card.kind === "video") return promptWantsVideoGeneration(String(card.prompt ?? ""));
  if (card.kind && card.kind !== "image") return true;
  return promptWantsImageGeneration(String(card.prompt ?? ""));
}

export function buildActiveImageGenerationCard(input: {
  current: any;
  taskId: string;
  prompt: string;
  outgoingLabel: string;
  agentName?: string;
  appId?: string;
  serviceKind?: string;
  modelName?: string;
  machineName?: string;
  machineSpecs?: string;
  patch?: Record<string, unknown>;
}) {
  const patch = input.patch ?? {};
  const patchKind = (patch as { kind?: unknown }).kind;
  const requestedKind = promptWantsVideoGeneration(input.prompt) ? "video" : "image";
  const generationKind = patchKind === "image" || patchKind === "music" || patchKind === "tts" || patchKind === "model3d" || patchKind === "video"
    ? patchKind
    : input.current?.kind ?? requestedKind;
  const current = input.current ?? {
    id: `agent-${generationKind}-gen-${input.taskId}`,
    kind: generationKind,
    prompt: input.prompt || input.outgoingLabel,
    status: "running",
    title: generationKind === "video" ? "HyperFrames render" : "Image generation",
    appId: input.appId,
    appName: input.agentName,
    serviceKind: input.serviceKind,
    modelName: input.modelName,
    machineName: input.machineName,
    machineSpecs: input.machineSpecs,
    createdAt: Date.now(),
  };
  return {
    ...current,
    ...patch,
    kind: generationKind,
    prompt: String((patch as { prompt?: unknown }).prompt ?? current.prompt ?? input.prompt ?? input.outgoingLabel),
  };
}

export function imageGenerationCompletionPatchFromText(text: string, current: any, prompt: string, completedAt = Date.now()) {
  const generatedCard = generatedMediaCardFromAssistantText(text, completedAt);
  if (!generatedCard?.artifacts?.length) return null;
  return {
    status: "ready",
    kind: generatedCard.kind,
    prompt: current?.prompt ?? prompt ?? generatedCard.prompt,
    title: generatedCard.title,
    appName: current?.appName ?? generatedCard.appName,
    machineName: current?.machineName,
    artifacts: generatedCard.artifacts,
    completedAt,
  };
}

export function imageGenerationCardContent(card: any) {
  return applicationGenerationContent(card);
}
