import "server-only";

import {
  appPreferenceFor,
  preferredModelFor,
  readAppPreferences,
  usageNoteAffinity,
  type ConnectedAppPreference,
} from "@/lib/services/fleet/app-preferences";
import { discoverRawConnectedApps, type ConnectedHostedApp } from "@/lib/services/fleet/connected-apps";
import { recordGenerationMetric } from "@/lib/services/generation-metrics";
import { signedGeneratedMediaUrl } from "@/lib/services/chat/generated-media-signing";

// Shared image-generation orchestration used by both the dashboard chat route
// (/api/chat/image-generation) and the phone API (/api/phone action
// "image-generation"). Discovers connected fleet apps, scores them, fires the
// best generation endpoint and polls until images come back.

const REQUEST_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1_500;
const MAX_POLL_ATTEMPTS = 80;

export type ImageGenerationInput = {
  /** Origin of this hub's own HTTP server, used for fleet app discovery. */
  origin: string;
  prompt: string;
  appId?: string;
  serviceKind?: string;
  model?: string;
  /** Forwarded to the generation metric so ETAs can be correlated per run. */
  runId?: string;
};

type ImageGenerationCandidate = ConnectedHostedApp & {
  score: number;
};

export type GeneratedImage = {
  url: string;
  width?: number;
  height?: number;
  seed?: string | number;
};

export type ImageGenerationSuccess = {
  ok: true;
  prompt: string;
  app: {
    id?: string;
    name?: string;
    machineName?: string;
    serviceKind?: string;
    modelName?: string;
    machineSpecs?: string;
  };
  endpoint: string;
  images: GeneratedImage[];
  rawStatus?: string;
  requestedModel?: string;
  preferenceApplied: boolean;
};

export type ImageGenerationFailure = {
  ok: false;
  reason: "no-app" | "generation-failed";
  error: string;
  /** Suggested HTTP status for route handlers. */
  status: number;
  appCount?: number;
};

export type ImageGenerationResult = ImageGenerationSuccess | ImageGenerationFailure;

function firstStringField(value: unknown, keys: string[], depth = 0): string {
  if (!value || typeof value !== "object" || depth > 3) return "";
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = clean(record[key]);
    if (candidate) return candidate;
  }
  for (const nested of Object.values(record)) {
    if (!nested || typeof nested !== "object") continue;
    const candidate = firstStringField(nested, keys, depth + 1);
    if (candidate) return candidate;
  }
  return "";
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRequestPath(path: string) {
  const value = path.trim();
  if (!value || !value.startsWith("/") || value.startsWith("//") || /^https?:\/\//i.test(value)) {
    throw new Error("Connected app route paths must be relative paths starting with /.");
  }
  return value;
}

function appIdHint(value?: string) {
  const text = value?.trim() || "";
  const match = /^(.+):(\d+):(.+)$/.exec(text);
  if (!match) return null;
  return { host: match[1], port: Number(match[2]) };
}

function appMatchesId(app: ConnectedHostedApp, selectedAppId: string) {
  if (app.id === selectedAppId) return true;
  const selected = appIdHint(selectedAppId);
  const candidate = appIdHint(app.id);
  if (!selected || !candidate || selected.host !== candidate.host) return false;
  return selected.port === candidate.port;
}

function localProxyScore(value?: string) {
  const text = clean(value).toLowerCase();
  if (!text) return 0;
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//.test(text)) return 90;
  if (/^https?:\/\/100\.\d+\.\d+\.\d+:\d+\/app-proxy\//.test(text)) return -90;
  return 0;
}

async function normalizedApps(origin: string) {
  const url = new URL("/api/fleet/apps?refresh=1&wait=1", origin);
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null) as { apps?: ConnectedHostedApp[] } | null;
  return Array.isArray(payload?.apps) ? payload.apps : [];
}

async function discoveredApps(origin: string, appId?: string) {
  const [raw, normalized] = await Promise.all([
    discoverRawConnectedApps(origin, { selfOnly: appId?.startsWith("local:") }).catch(() => []),
    normalizedApps(origin).catch(() => []),
  ]);
  const byId = new Map<string, ConnectedHostedApp>();
  for (const app of [...normalized, ...raw]) {
    if (app.id && !byId.has(app.id)) byId.set(app.id, app);
  }
  return [...byId.values()];
}

function appPreferenceScore(app: ConnectedHostedApp, prompt: string, preferences: ConnectedAppPreference[]) {
  const preference = appPreferenceFor(app, preferences);
  if (!preference) return 0;
  let score = 0;
  if (preference.priority) score += 150;
  // Prose routing hints ("use this app for realistic images") outrank generic name matches.
  score += Math.min(usageNoteAffinity(prompt, preference.usageNotes) * 35, 140);
  return score;
}

function appScore(app: ConnectedHostedApp, input: ImageGenerationInput, preferences: ConnectedAppPreference[]) {
  if (!app.apiBaseUrl) return -1;
  if (input.appId && appMatchesId(app, input.appId)) return 10_000;
  const requestedKind = clean(input.serviceKind).toLowerCase();
  const routeText = (app.apiRoutes ?? []).map((route) => `${route.method ?? ""} ${route.path ?? ""} ${route.summary ?? ""} ${route.category ?? ""}`).join(" ");
  const appUrls = app as ConnectedHostedApp & { openUrl?: string };
  const haystack = `${app.name ?? ""} ${app.description ?? ""} ${app.serviceKind ?? ""} ${appUrls.openUrl ?? ""} ${app.apiBaseUrl ?? ""} ${routeText}`.toLowerCase();
  const routes = app.apiRoutes ?? [];
  const hasGenerationRoute = routes.some((route) => generationRouteScore(route) > 0);
  const workspaceOnlyRoute = routes.length > 0 && !hasGenerationRoute && routes.every((route) => clean(route.method || "GET").toUpperCase() === "GET" && clean(route.path || "/") === "/");
  let score = 0;
  if (requestedKind && app.serviceKind?.toLowerCase() === requestedKind) score += 120;
  if (/\b(?:z[-\s]?image|zimage)\b/.test(haystack)) score += 110;
  if (/\bopen generative ai(?: hosted)?\b/.test(haystack)) score += 130;
  if (/\b(?:image[-\s]?gen|image generation|txt2img|text to image|comfyui|diffusion|stable diffusion|open generative ai|local-ai|localai)\b/.test(haystack)) score += 90;
  if (/\b(?:creative|studio|canvas|generate)\b/.test(haystack)) score += 30;
  if (hasGenerationRoute) score += 80;
  if (!routes.length && /\bopen generative ai(?: hosted)?\b/.test(haystack)) score += 60;
  if (workspaceOnlyRoute) score -= 30;
  score += localProxyScore(app.apiBaseUrl);
  score += appPreferenceScore(app, clean(input.prompt), preferences);
  return score;
}

function selectImageApp(apps: ConnectedHostedApp[], input: ImageGenerationInput, preferences: ConnectedAppPreference[]): ImageGenerationCandidate | null {
  const ranked = apps
    .map((app) => ({ ...app, score: appScore(app, input, preferences) }))
    .filter((app) => app.score > 0)
    .sort((left, right) => right.score - left.score);
  return ranked[0] ?? null;
}

function generationRouteScore(route: { method?: string; path?: string; summary?: string; category?: string }) {
  const method = clean(route.method || "GET").toUpperCase();
  if (method && method !== "POST") return 0;
  const text = `${route.path ?? ""} ${route.summary ?? ""} ${route.category ?? ""}`.toLowerCase();
  let score = 0;
  if (/\/(?:api\/)?(?:generate|generation|txt2img|image|images)(?:\/|$)/.test(text)) score += 50;
  if (/prompt|text.?to.?image|image generation|generate image/.test(text)) score += 30;
  if (/status|history|models|health|download|delete/.test(text)) score -= 40;
  return score;
}

function generationPaths(app: ConnectedHostedApp) {
  const routePaths = (app.apiRoutes ?? [])
    .filter((route) => generationRouteScore(route) > 0)
    .sort((left, right) => generationRouteScore(right) - generationRouteScore(left))
    .map((route) => clean(route.path))
    .filter(Boolean);
  return [...new Set([
    ...routePaths,
    "/local-ai/generate",
    "/api/generate",
    "/api/images/generate",
    "/api/image/generate",
    "/generate",
    "/txt2img",
    "/api/txt2img",
  ])];
}

function absoluteUrl(baseUrl: string, pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${baseUrl.replace(/\/+$/, "")}${normalizeRequestPath(pathOrUrl)}`;
}

async function requestJson(baseUrl: string, path: string, init?: RequestInit) {
  const url = absoluteUrl(baseUrl, path);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Could not reach connected image app endpoint ${url}: ${error instanceof Error ? error.message : "fetch failed"}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Connected image app returned ${response.status}.`);
  }
  if (contentType.startsWith("image/")) {
    return {
      image: response.url,
      contentType,
    };
  }
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function maybeImageUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed) && /\.(?:png|jpe?g|webp|gif|avif)(?:\?|#|$)/i.test(trimmed)) return trimmed;
  if (/^\/(?:Users|var|tmp|private\/tmp)\/.*\.(?:png|jpe?g|webp|gif|avif)(?:\?|#|$)/i.test(trimmed)) {
    return `/api/chat/generated-media?path=${encodeURIComponent(trimmed)}`;
  }
  if (/^\/[^/].*\.(?:png|jpe?g|webp|gif|avif)(?:\?|#|$)/i.test(trimmed)) return trimmed;
  return "";
}

function imageIdentity(url: string) {
  const decoded = decodeURIComponent(url);
  const generatedPath = decoded.match(/[?&]path=([^&]+)/)?.[1];
  const source = generatedPath ? decodeURIComponent(generatedPath) : decoded;
  return source.split(/[?#]/)[0].split("/").pop()?.toLowerCase() || decoded.toLowerCase();
}

function generatedMediaPathFromUrl(url: string) {
  try {
    const parsed = new URL(url, "http://hivemind.local");
    return parsed.pathname === "/api/chat/generated-media" ? parsed.searchParams.get("path")?.trim() ?? "" : "";
  } catch {
    return "";
  }
}

async function finalizeGeneratedImages(images: GeneratedImage[]) {
  const signed = await Promise.all(images.map(async (image) => {
    const path = generatedMediaPathFromUrl(image.url);
    return path ? { ...image, url: await signedGeneratedMediaUrl(path) } : image;
  }));
  const deduped: GeneratedImage[] = [];
  for (const image of signed) {
    const identity = imageIdentity(image.url);
    if (deduped.some((item) => imageIdentity(item.url) === identity)) continue;
    deduped.push(image);
  }
  const nonDataImages = deduped.filter((image) => !/^data:image\//i.test(image.url));
  return nonDataImages.length ? nonDataImages : deduped;
}

function pushImage(output: GeneratedImage[], image: GeneratedImage) {
  const identity = imageIdentity(image.url);
  if (output.some((item) => imageIdentity(item.url) === identity)) return;
  output.push(image);
}

function imageUrlFromRecord(value: Record<string, unknown>, baseUrl: string): string {
  for (const key of ["imageUrl", "image_url", "url", "src", "href", "path", "output", "file", "filename"]) {
    const url = maybeImageUrl(value[key]);
    if (url) return /^\/[^/]/.test(url) && !url.startsWith("/api/chat/generated-media") ? absoluteUrl(baseUrl, url) : url;
  }
  return "";
}

function collectImages(value: unknown, baseUrl: string, output: GeneratedImage[] = []): GeneratedImage[] {
  if (!value || output.length >= 8) return output;
  const url = maybeImageUrl(value);
  if (url) {
    pushImage(output, { url: /^\/[^/]/.test(url) && !url.startsWith("/api/chat/generated-media") ? absoluteUrl(baseUrl, url) : url });
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImages(item, baseUrl, output);
    return output;
  }
  if (typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  const recordUrl = imageUrlFromRecord(record, baseUrl);
  if (recordUrl) {
    pushImage(output, {
      url: recordUrl,
      width: typeof record.width === "number" ? record.width : undefined,
      height: typeof record.height === "number" ? record.height : undefined,
      seed: typeof record.seed === "string" || typeof record.seed === "number" ? record.seed : undefined,
    });
  }
  for (const key of recordUrl ? ["images", "outputs", "results", "artifacts", "data"] : ["images", "outputs", "results", "artifacts", "files", "data"]) {
    collectImages(record[key], baseUrl, output);
  }
  return output;
}

function jobIdFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["jobId", "job_id", "taskId", "task_id", "id", "runId", "requestId", "prompt_id"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function statusUrlFromPayload(payload: unknown, baseUrl: string) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["statusUrl", "status_url", "waitUrl", "wait_url", "pollUrl", "poll_url"]) {
    const value = clean(record[key]);
    if (value) return /^\/[^/]/.test(value) ? absoluteUrl(baseUrl, value) : value;
  }
  return "";
}

function terminalStatus(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const text = clean(record.status ?? record.state ?? record.phase).toLowerCase();
  if (/\b(?:success|succeeded|complete|completed|ready|done|finished)\b/.test(text)) return "ready";
  if (/\b(?:failed|error|cancelled|canceled)\b/.test(text)) return "error";
  return "";
}

async function pollForImages(baseUrl: string, firstPayload: unknown) {
  let lastPayload = firstPayload;
  const firstImages = collectImages(firstPayload, baseUrl);
  if (firstImages.length) return { images: await finalizeGeneratedImages(firstImages), payload: firstPayload };

  const jobId = jobIdFromPayload(firstPayload);
  const statusUrl = statusUrlFromPayload(firstPayload, baseUrl);
  const paths = [
    statusUrl,
    jobId ? `/local-ai/job/${encodeURIComponent(jobId)}` : "",
    jobId ? `/api/jobs/${encodeURIComponent(jobId)}` : "",
    jobId ? `/api/job/${encodeURIComponent(jobId)}` : "",
    jobId ? `/api/status/${encodeURIComponent(jobId)}` : "",
    jobId ? `/status/${encodeURIComponent(jobId)}` : "",
    jobId ? `/api/generate/${encodeURIComponent(jobId)}` : "",
    jobId ? `/api/tasks/${encodeURIComponent(jobId)}` : "",
  ].filter(Boolean);

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS && paths.length; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);
    for (const path of paths) {
      try {
        lastPayload = await requestJson(baseUrl, path);
      } catch {
        continue;
      }
      const images = collectImages(lastPayload, baseUrl);
      if (images.length) return { images: await finalizeGeneratedImages(images), payload: lastPayload };
      if (terminalStatus(lastPayload) === "error") {
        const error = clean((lastPayload as Record<string, unknown>).error) || "Connected image app reported a failed generation.";
        throw new Error(error);
      }
    }
  }
  return { images: [], payload: lastPayload };
}

async function startGeneration(app: ConnectedHostedApp, prompt: string, model?: string) {
  const baseUrl = clean(app.apiBaseUrl);
  if (!baseUrl) throw new Error("Selected connected app does not expose an API base URL.");
  let lastError = "";
  for (const path of generationPaths(app)) {
    try {
      const payload = await requestJson(baseUrl, path, {
        method: "POST",
        body: JSON.stringify(model ? { prompt, model } : { prompt }),
      });
      const result = await pollForImages(baseUrl, payload);
      if (result.images.length) return { path, ...result };
      lastError = "The connected image app completed without returning an image URL.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Generation request failed.";
    }
  }
  throw new Error(lastError || "No compatible generation endpoint worked for the connected image app.");
}

export async function runChatImageGeneration(input: ImageGenerationInput): Promise<ImageGenerationResult> {
  const startedAt = Date.now();
  const prompt = clean(input.prompt);
  if (!prompt) {
    return { ok: false, reason: "generation-failed", error: "Prompt is required.", status: 400 };
  }
  try {
    const [apps, preferences] = await Promise.all([
      discoveredApps(input.origin, input.appId),
      readAppPreferences().catch(() => [] as ConnectedAppPreference[]),
    ]);
    const app = selectImageApp(apps, input, preferences);
    if (!app) {
      return {
        ok: false,
        reason: "no-app",
        error: "No connected image generation app with an API endpoint was found. Open Apps or start Image Studio, ComfyUI, or Z-Image, then try again.",
        status: 404,
        appCount: apps.length,
      };
    }
    const appPreference = appPreferenceFor(app, preferences);
    const requestedModel = clean(input.model) || preferredModelFor("image", appPreference?.preferredModels);
    const result = await startGeneration(app, prompt, requestedModel || undefined);
    const modelName = firstStringField(result.payload, ["model", "modelName", "model_name", "checkpoint", "checkpointName"]) || requestedModel;
    const machineSpecs = firstStringField(result.payload, ["machineSpecs", "machine_specs", "gpu", "device", "hardware"]);
    await recordGenerationMetric({
      kind: "image",
      appId: app.id,
      appName: app.name,
      serviceKind: app.serviceKind,
      modelName,
      machineName: app.machineName,
      machineSpecs,
      durationMs: Date.now() - startedAt,
      runId: input.runId,
      completedAt: Date.now(),
    }).catch(() => undefined);
    return {
      ok: true,
      prompt,
      app: {
        id: app.id,
        name: app.name,
        machineName: app.machineName,
        serviceKind: app.serviceKind,
        modelName,
        machineSpecs,
      },
      endpoint: result.path,
      images: result.images,
      rawStatus: terminalStatus(result.payload) || undefined,
      requestedModel: requestedModel || undefined,
      preferenceApplied: Boolean(appPreference),
    };
  } catch (error) {
    return {
      ok: false,
      reason: "generation-failed",
      error: error instanceof Error ? error.message : "Image generation failed.",
      status: 502,
    };
  }
}
