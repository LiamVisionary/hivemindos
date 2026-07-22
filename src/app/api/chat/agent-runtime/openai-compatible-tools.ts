import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import type { ChatResponseBilling } from "@/lib/types/chat-billing";
import type { ChatMediaArtifact } from "./media-artifacts";

const IMAGE_TOOL_DISPATCH_TIMEOUT_MS = 190_000;
const VIDEO_TOOL_DISPATCH_TIMEOUT_MS = 260_000;
export const IMAGE_GENERATION_TOOL_NAME = "generate_image";
export const VIDEO_GENERATION_TOOL_NAME = "generate_video";

export type AccumulatedToolCall = { id: string; name: string; arguments: string };
export type ToolCallOutcome = { toolResultContent: string; fallbackText: string; finalText?: string; prompted?: boolean };
export type NonStreamToolRun = {
  events: string[];
  assistantToolCalls: Array<Record<string, unknown>>;
  toolResultMessages: Array<Record<string, unknown>>;
  fallbacks: string[];
  finalTexts: string[];
  failures: string[];
  prompted: boolean;
  /** Corrective system messages appended to the conversation after this round's tool results. */
  steeringMessages?: Array<Record<string, unknown>>;
};

function numericHeader(headers: Headers, name: string) {
  const value = headers.get(name)?.trim();
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stringHeader(headers: Headers, name: string) {
  return headers.get(name)?.trim() || undefined;
}

function dataUrlDecodedBytes(dataUrl?: string) {
  if (!dataUrl) return 0;
  const payload = dataUrl.split(",", 2)[1] ?? "";
  return Math.floor((payload.replace(/=+$/u, "").length * 3) / 4);
}

export function modelVisibleMediaBytes(artifacts: ChatMediaArtifact[]) {
  return artifacts.reduce(
    (total, artifact) => total + dataUrlDecodedBytes(artifact.dataUrl || artifact.previewDataUrl),
    0,
  );
}

export function hivemindosModelsBillingFromHeaders(headers: Headers): ChatResponseBilling | null {
  const creditDebitUsd = numericHeader(headers, "X-HivemindOS-Models-Credit-Debited-Usd");
  const creditBalanceUsd = numericHeader(headers, "X-HivemindOS-Models-Credit-Balance-Usd");
  const walletDebitUsd = numericHeader(headers, "X-HivemindOS-Wallet-Paid-Amount-Usd");
  const paidHeader = stringHeader(headers, "X-HivemindOS-Wallet-Paid");
  const costUsd = creditDebitUsd ?? walletDebitUsd;
  if (costUsd === undefined && creditBalanceUsd === undefined && !paidHeader) return null;
  const hiveComputeRoute = paidHeader === "hive-compute";
  return {
    provider: hiveComputeRoute ? "hive-compute" : "hivemindos-models",
    label: hiveComputeRoute ? "Hive Compute" : "HivemindOS Models",
    source: hiveComputeRoute
      ? "marketplace"
      : creditDebitUsd !== undefined
        ? "prepaid-credit"
        : paidHeader === "x402" ? "x402" : undefined,
    costUsd,
    balanceUsd: creditBalanceUsd,
    paid: creditDebitUsd !== undefined || walletDebitUsd !== undefined || paidHeader === "x402" || hiveComputeRoute,
    network: stringHeader(headers, "X-HivemindOS-Wallet-Paid-Network"),
  };
}

export function imageGenerationToolDefinition() {
  return {
    type: "function",
    function: {
      name: IMAGE_GENERATION_TOOL_NAME,
      description: "Generate an image from a text prompt using a connected HivemindOS image-generation app (for example Open Generative AI, ComfyUI, or Z-Image). Call this whenever the user asks to generate, create, draw, or render an image. HivemindOS automatically routes to the best reachable connected app, so do not pick an app yourself - just pass the full prompt.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The complete image-generation prompt to render." },
        },
        required: ["prompt"],
      },
    },
  };
}

export function videoGenerationToolDefinition() {
  return {
    type: "function",
    function: {
      name: VIDEO_GENERATION_TOOL_NAME,
      description: "Generate a video using a connected cloud or local HivemindOS video-generation app or service. Call this only when conversational context establishes that the user is asking to create a video and has selected cloud/local generation. Discussion, brainstorming, hypotheticals, and capability questions are not generation requests. If an actionable creation request leaves the method open, ask whether they want cloud AI, local AI, or HTML / HyperFrames before calling a tool. Never use this tool for HTML / HyperFrames rendering. If the current turn has media artifact handles, pass the relevant artifact id or path; otherwise HivemindOS will use the current turn's first attached image by default.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The complete video-generation prompt." },
          inputImageId: { type: "string", description: "Optional current-turn media artifact id to use as the source image." },
          inputImagePath: { type: "string", description: "Optional local path for the source image artifact." },
        },
        required: ["prompt"],
      },
    },
  };
}

export function commandFailureFallbackText(
  commandLine: string,
  result: { command?: string; error?: string; stderr?: string },
) {
  const command = result.command?.trim() || commandLine.trim() || "the command";
  const text = (result.error || result.stderr || "unknown error").trim();
  const failure = text.split(/\n/).map((line) => line.trim()).find(Boolean) || "unknown error";
  if (/not allowlisted/i.test(failure)) {
    return `I couldn't run \`${command}\` because it is not in this agent's local command allowlist.`;
  }
  return `I tried \`${commandLine.trim() || command}\`, but it failed: ${failure}`;
}

export function parseToolCallArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function extractOpenAIToolCalls(payload: unknown): AccumulatedToolCall[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as {
    choices?: Array<{ message?: { tool_calls?: unknown }; delta?: { tool_calls?: unknown } }>;
    message?: { tool_calls?: unknown };
    tool_calls?: unknown;
  };
  const rawCalls = record.choices?.flatMap((choice) => (
    Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls
      : Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls
        : []
  )) ?? (Array.isArray(record.message?.tool_calls)
    ? record.message.tool_calls
    : Array.isArray(record.tool_calls) ? record.tool_calls : []);
  return rawCalls.map((toolCall, index): AccumulatedToolCall | null => {
    if (!toolCall || typeof toolCall !== "object") return null;
    const entry = toolCall as {
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
      name?: unknown;
      arguments?: unknown;
    };
    const name = typeof entry.function?.name === "string"
      ? entry.function.name
      : typeof entry.name === "string" ? entry.name : "";
    if (!name.trim()) return null;
    const args = typeof entry.function?.arguments === "string"
      ? entry.function.arguments
      : typeof entry.arguments === "string" ? entry.arguments : "";
    return {
      id: typeof entry.id === "string" && entry.id.trim() ? entry.id : `call_${index}`,
      name,
      arguments: args,
    };
  }).filter((call): call is AccumulatedToolCall => Boolean(call));
}

type ImageGenerationDispatchResult = {
  ok: boolean;
  error?: string;
  prompt?: string;
  app?: { id?: string; name?: string; machineName?: string; serviceKind?: string };
  endpoint?: string;
  images?: Array<{ url: string; width?: number; height?: number; seed?: string | number }>;
};

type VideoGenerationDispatchResult = {
  ok: boolean;
  error?: string;
  prompt?: string;
  app?: { id?: string; name?: string; machineName?: string; serviceKind?: string };
  endpoint?: string;
  videos?: Array<{ url: string; mimeType?: string; durationMs?: number }>;
};

export async function dispatchImageGenerationViaRoute(
  origin: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<ImageGenerationDispatchResult> {
  const response = await fetch(new URL("/api/chat/image-generation", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...internalApiAuthHeaders() },
    body: JSON.stringify({ prompt }),
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(IMAGE_TOOL_DISPATCH_TIMEOUT_MS),
  });
  const json = await response.json().catch(() => null) as ImageGenerationDispatchResult | null;
  if (!response.ok || !json?.ok) {
    throw new Error(json?.error || `Image generation failed (${response.status}).`);
  }
  return json;
}

export async function dispatchVideoGenerationViaRoute(
  origin: string,
  prompt: string,
  inputImages: Array<{ path?: string; dataUrl?: string; mimeType?: string; name?: string }>,
  signal?: AbortSignal,
): Promise<VideoGenerationDispatchResult> {
  const response = await fetch(new URL("/api/chat/video-generation", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...internalApiAuthHeaders() },
    body: JSON.stringify({ prompt, inputImages }),
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(VIDEO_TOOL_DISPATCH_TIMEOUT_MS),
  });
  const json = await response.json().catch(() => null) as VideoGenerationDispatchResult | null;
  if (!response.ok || !json?.ok) {
    throw new Error(json?.error || `Video generation failed (${response.status}).`);
  }
  return json;
}

export function imageGenerationArtifacts(images?: Array<{ url: string }>) {
  const urls = (images ?? []).map((image) => image?.url).filter((url): url is string => Boolean(url));
  return urls.map((url, index) => ({
    kind: "image",
    url,
    label: urls.length === 1 ? "Generated image" : `Generated image ${index + 1}`,
  }));
}

export function videoGenerationArtifacts(
  videos?: Array<{ url: string; mimeType?: string; durationMs?: number }>,
) {
  const entries = (videos ?? []).filter(
    (video): video is { url: string; mimeType?: string; durationMs?: number } => Boolean(video?.url),
  );
  return entries.map((video, index) => ({
    kind: "video",
    url: video.url,
    label: entries.length === 1 ? "Generated video" : `Generated video ${index + 1}`,
    mimeType: video.mimeType,
    durationMs: video.durationMs,
  }));
}
