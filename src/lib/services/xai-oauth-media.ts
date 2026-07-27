import "server-only";

import { getXaiOAuthAccess } from "@/lib/services/xai-oauth";

const IMAGE_MODEL = "grok-imagine-image-quality";
const VIDEO_MODEL = "grok-imagine-video";
const TERMINAL_VIDEO_STATUSES = new Set(["done", "failed", "expired"]);

type XaiOAuthMediaAction = "image-generate" | "video-generate" | "video-status";

export type XaiOAuthMediaRequest = {
  action?: XaiOAuthMediaAction;
  prompt?: unknown;
  model?: unknown;
  aspectRatio?: unknown;
  resolution?: unknown;
  duration?: unknown;
  image?: unknown;
  requestId?: unknown;
};

function boundedString(value: unknown, label: string, maximum: number, required = false) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (required && !normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) throw new Error(`${label} is too long.`);
  return normalized;
}

function xaiBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "api.x.ai") {
    throw new Error("xAI OAuth media requires the official api.x.ai HTTPS endpoint.");
  }
  return url.toString().replace(/\/+$/, "");
}

function imageInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const url = boundedString(source.url, "Image URL", 15_000_000);
  const fileId = boundedString(source.file_id, "Image file id", 300);
  if (url && !url.startsWith("https://") && !/^data:image\/(?:png|jpeg|webp);base64,/.test(url)) {
    throw new Error("Image URL must use public HTTPS or a PNG, JPEG, or WebP data URL.");
  }
  if (url) return { url };
  if (fileId) return { file_id: fileId };
  return undefined;
}

async function xaiJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(180_000),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    const error = payload?.error;
    const message =
      typeof error === "string"
        ? error
        : error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string"
          ? String((error as Record<string, unknown>).message)
          : `xAI media returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return payload;
}

export async function xaiOAuthMediaRequest(body: XaiOAuthMediaRequest) {
  const action = body.action;
  if (!action || !["image-generate", "video-generate", "video-status"].includes(action)) {
    throw new Error("Unsupported xAI OAuth media action.");
  }
  const access = await getXaiOAuthAccess();
  const baseUrl = xaiBaseUrl(access.baseUrl);
  const headers = {
    Authorization: `Bearer ${access.accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (action === "video-status") {
    const requestId = boundedString(body.requestId, "Video request id", 300, true);
    const result = await xaiJson(`${baseUrl}/videos/${encodeURIComponent(requestId)}`, {
      method: "GET",
      headers,
    });
    const status = boundedString(result.status, "Video status", 40).toLowerCase();
    return { ...result, terminal: TERMINAL_VIDEO_STATUSES.has(status) };
  }

  const prompt = boundedString(body.prompt, "Prompt", 20_000, true);
  const aspectRatio = boundedString(body.aspectRatio, "Aspect ratio", 20) || "9:16";
  const resolution = boundedString(body.resolution, "Resolution", 20) || (action === "image-generate" ? "1k" : "720p");
  if (!["9:16", "4:5", "1:1", "16:9"].includes(aspectRatio)) throw new Error("Unsupported xAI media aspect ratio.");
  if (action === "image-generate") {
    if (!["1k", "2k"].includes(resolution.toLowerCase())) throw new Error("xAI image resolution must be 1k or 2k.");
    const model = boundedString(body.model, "Model", 120) || IMAGE_MODEL;
    if (!model.startsWith("grok-imagine-image")) throw new Error("Unsupported xAI image model.");
    return xaiJson(`${baseUrl}/images/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, prompt, aspect_ratio: aspectRatio, resolution, n: 1 }),
    });
  }

  const model = boundedString(body.model, "Model", 120) || VIDEO_MODEL;
  if (!["480p", "720p"].includes(resolution.toLowerCase())) throw new Error("xAI video resolution must be 480p or 720p.");
  if (!model.startsWith("grok-imagine-video")) throw new Error("Unsupported xAI video model.");
  const duration = Math.min(15, Math.max(1, Math.round(Number(body.duration) || 5)));
  return xaiJson(`${baseUrl}/videos/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      prompt,
      aspect_ratio: aspectRatio,
      resolution,
      duration,
      ...(imageInput(body.image) ? { image: imageInput(body.image) } : {}),
    }),
  });
}
