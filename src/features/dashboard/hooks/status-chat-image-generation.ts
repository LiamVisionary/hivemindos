import { applicationGenerationContent, normalizeApplicationGenerationUrl, type ChatApplicationGenerationArtifact, type ChatApplicationGenerationCard, type ChatApplicationGenerationStatus } from "@/features/dashboard/chat-application-generation";

export function imageGenerationPrompt(input: string) {
  const match = input.trim().match(/^\/(?:image-gen|imagine|txt2img)(?:\s+([\s\S]+))?$/i);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export function localImageGenerationPrompt(input: string) {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  if (!/\b(?:local|locally|local-only|on-device|on device|self-hosted|hosted locally)\b/.test(lower)) return null;
  if (!/\b(?:generate|create|make|draw|render)\b/.test(lower) || !/\b(?:image|images|picture|pictures|illustration|artwork)\b/.test(lower)) return null;
  const withoutLocalRoute = trimmed
    .replace(/\b(?:local|locally|local-only|on-device|on device|self-hosted|hosted locally)\b/gi, " ");
  const subject = withoutLocalRoute.match(/\b(?:of|showing|featuring|with)\s+([\s\S]+)$/i)?.[1]?.trim();
  return subject || withoutLocalRoute
    .replace(/\b(?:please\s+)?(?:generate|create|make|draw|render)\b/gi, " ")
    .replace(/\b(?:an?|some|two|three|four)?\s*(?:image|images|picture|pictures|illustration|artwork)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type RunNativeImageGenerationInput = {
  prompt: string;
  userContent?: string;
  selectedAgent: { id: string };
  selectedChatLeafKey: string;
  selectedStorageKey: string;
  chatAutoScrollRef: { current: boolean };
  clearChatComposerDraft: () => void;
  appendMessage: (agentId: string, message: Record<string, unknown>, storageKey?: string) => void;
  appendPreviewMessages: (agentId: string, leafKey: string, messages: Array<Record<string, unknown>>) => void;
  setMessagesByAgent: (updater: (current: Record<string, Array<Record<string, unknown>>>) => Record<string, Array<Record<string, unknown>>>) => void;
  setSelectedChatPreview: (updater: (current: { agentId: string; leafKey: string; messages: Array<Record<string, unknown>> } | null) => { agentId: string; leafKey: string; messages: Array<Record<string, unknown>> } | null) => void;
};

type GeneratedImageCandidate = {
  url?: unknown;
  width?: unknown;
  height?: unknown;
  seed?: unknown;
};

function replaceImageGenerationMessage(input: RunNativeImageGenerationInput, cardId: string, patch: Record<string, unknown>) {
  const updateMessages = (items: Array<Record<string, unknown>> = []) => items.map((message) => {
    const card = message.applicationGeneration;
    if (!card || typeof card !== "object" || (card as { id?: unknown }).id !== cardId) return message;
    const nextCard = { ...(card as ChatApplicationGenerationCard), ...patch } as ChatApplicationGenerationCard;
    const status: ChatApplicationGenerationStatus = nextCard.status === "ready" || nextCard.status === "error" ? nextCard.status : "running";
    const normalizedCard: ChatApplicationGenerationCard = { ...nextCard, status };
    return {
      ...message,
      content: applicationGenerationContent(normalizedCard),
      applicationGeneration: normalizedCard,
    };
  });
  input.setMessagesByAgent((current) => ({
    ...current,
    [input.selectedStorageKey]: updateMessages(current[input.selectedStorageKey] ?? []),
  }));
  input.setSelectedChatPreview((current) => {
    if (!current || current.agentId !== input.selectedAgent.id || current.leafKey !== input.selectedChatLeafKey) return current;
    return { ...current, messages: updateMessages(current.messages) };
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readGenerationResponse(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as { ok?: boolean; error?: string; app?: { id?: string; name?: string; serviceKind?: string; machineName?: string; modelName?: string; machineSpecs?: string }; images?: unknown[] };
  } catch {
    return { ok: false, error: text.trim() };
  }
}

async function requestNativeImageGeneration(prompt: string, input: Pick<RunNativeImageGenerationInput, "selectedAgent" | "selectedStorageKey"> & { cardId: string }) {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("/api/chat/image-generation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hivemind-run-id": input.cardId,
        "x-hivemind-chat-storage-key": input.selectedStorageKey,
      },
      body: JSON.stringify({ prompt, agentId: input.selectedAgent.id }),
    });
    const data = await readGenerationResponse(response);
    if (response.ok && data?.ok) return data;
    lastError = data?.error || `Image generation failed with HTTP ${response.status}.`;
    if (response.status === 503 && /warming up/i.test(lastError) && attempt === 0) {
      await sleep(1_500);
      continue;
    }
    throw new Error(lastError);
  }
  throw new Error(lastError || "Image generation failed.");
}

export async function runNativeImageGeneration(input: RunNativeImageGenerationInput) {
  const cardId = `image-gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = Date.now();
  const userMessage = { role: "user", content: input.userContent || `/image-gen ${input.prompt}`, surface: "chat", createdAt };
  const assistantMessage = {
    role: "assistant",
    content: applicationGenerationContent({ kind: "image", status: "running", prompt: input.prompt }),
    surface: "chat",
    createdAt: createdAt + 1,
    applicationGeneration: {
      id: cardId,
      kind: "image",
      prompt: input.prompt,
      status: "running",
      createdAt,
    },
  };
  input.chatAutoScrollRef.current = true;
  input.clearChatComposerDraft();
  input.appendMessage(input.selectedAgent.id, userMessage, input.selectedStorageKey);
  input.appendMessage(input.selectedAgent.id, assistantMessage, input.selectedStorageKey);
  input.appendPreviewMessages(input.selectedAgent.id, input.selectedChatLeafKey, [userMessage, assistantMessage]);
  try {
    const data = await requestNativeImageGeneration(input.prompt, { selectedAgent: input.selectedAgent, selectedStorageKey: input.selectedStorageKey, cardId });
    replaceImageGenerationMessage(input, cardId, {
      status: "ready",
      appId: data.app?.id,
      appName: data.app?.name,
      serviceKind: data.app?.serviceKind,
      modelName: data.app?.modelName,
      machineName: data.app?.machineName,
      machineSpecs: data.app?.machineSpecs,
      artifacts: Array.isArray(data.images)
        ? (data.images as unknown[])
          .map((image: unknown): { image: GeneratedImageCandidate; url: string | null } => ({
            image: image && typeof image === "object" ? image as GeneratedImageCandidate : {},
            url: Boolean(image) && typeof image === "object" ? normalizeApplicationGenerationUrl((image as { url?: unknown }).url) : null,
          }))
          .filter((item): item is { image: GeneratedImageCandidate; url: string } => Boolean(item.url))
          .map(({ image, url }, index: number): ChatApplicationGenerationArtifact => ({
            kind: "image",
            url,
            label: index === 0 ? "Generated image" : `Generated image ${index + 1}`,
            width: typeof image.width === "number" ? image.width : undefined,
            height: typeof image.height === "number" ? image.height : undefined,
            seed: typeof image.seed === "string" || typeof image.seed === "number" ? image.seed : undefined,
          }))
        : [],
      completedAt: Date.now(),
    });
  } catch (error) {
    replaceImageGenerationMessage(input, cardId, {
      status: "error",
      error: error instanceof Error ? error.message : "Image generation failed.",
      completedAt: Date.now(),
    });
  }
}

export async function handleNativeImageGenerationCommand(input: RunNativeImageGenerationInput & { rawPrompt: string }) {
  const slashPrompt = imageGenerationPrompt(input.rawPrompt);
  if (slashPrompt === null) return false;
  if (slashPrompt === "") {
    const userMessage = { role: "user", content: input.rawPrompt, surface: "chat" };
    const assistantMessage = { role: "assistant", content: "Add a prompt after `/image-gen`, for example `/image-gen a luminous honeycomb city at night`.", surface: "chat" };
    input.appendMessage(input.selectedAgent.id, userMessage, input.selectedStorageKey);
    input.appendMessage(input.selectedAgent.id, assistantMessage, input.selectedStorageKey);
    input.appendPreviewMessages(input.selectedAgent.id, input.selectedChatLeafKey, [userMessage, assistantMessage]);
    input.clearChatComposerDraft();
    return true;
  }
  await runNativeImageGeneration({ ...input, prompt: slashPrompt, userContent: input.rawPrompt });
  return true;
}
