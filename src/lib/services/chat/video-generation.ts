import "server-only";

import { readFile } from "fs/promises";
import { extname } from "path";
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
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

const REQUEST_TIMEOUT_MS = 240_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 120;

export type VideoGenerationInputImage = {
  path?: string;
  dataUrl?: string;
  mimeType?: string;
  name?: string;
};

export type VideoGenerationInput = {
  origin: string;
  prompt: string;
  inputImages?: VideoGenerationInputImage[];
  appId?: string;
  serviceKind?: string;
  model?: string;
  runId?: string;
};

type VideoGenerationCandidate = ConnectedHostedApp & {
  score: number;
};

export type GeneratedVideo = {
  url: string;
  mimeType?: string;
  durationMs?: number;
};

export type VideoGenerationSuccess = {
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
  videos: GeneratedVideo[];
  rawStatus?: string;
  requestedModel?: string;
  preferenceApplied: boolean;
};

export type VideoGenerationFailure = {
  ok: false;
  reason: "no-app" | "generation-failed";
  error: string;
  status: number;
  appCount?: number;
};

export type VideoGenerationResult = VideoGenerationSuccess | VideoGenerationFailure;

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

function absoluteUrl(baseUrl: string, pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${baseUrl.replace(/\/+$/, "")}${normalizeRequestPath(pathOrUrl)}`;
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
    headers: internalApiAuthHeaders(),
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
  score += Math.min(usageNoteAffinity(prompt, preference.usageNotes) * 35, 140);
  return score;
}

function videoRouteScore(route: { method?: string; path?: string; summary?: string; category?: string }) {
  const method = clean(route.method || "GET").toUpperCase();
  if (method && method !== "POST") return 0;
  const text = `${route.path ?? ""} ${route.summary ?? ""} ${route.category ?? ""}`.toLowerCase();
  let score = 0;
  if (/\/(?:api\/)?(?:generate|generation|video|videos|image-to-video|img2vid|i2v|text-to-video|txt2vid)(?:\/|$)/.test(text)) score += 50;
  if (/video|image.?to.?video|img2vid|i2v|text.?to.?video|txt2vid|animate|motion|clip|reel/.test(text)) score += 45;
  if (/prompt|generate|generation/.test(text)) score += 20;
  if (/status|history|models|health|download|delete/.test(text)) score -= 35;
  return score;
}

function appScore(app: ConnectedHostedApp, input: VideoGenerationInput, preferences: ConnectedAppPreference[]) {
  if (!app.apiBaseUrl) return -1;
  if (input.appId && appMatchesId(app, input.appId)) return 10_000;
  const requestedKind = clean(input.serviceKind).toLowerCase();
  const routeText = (app.apiRoutes ?? []).map((route) => `${route.method ?? ""} ${route.path ?? ""} ${route.summary ?? ""} ${route.category ?? ""}`).join(" ");
  const appUrls = app as ConnectedHostedApp & { openUrl?: string };
  const haystack = `${app.name ?? ""} ${app.description ?? ""} ${app.serviceKind ?? ""} ${appUrls.openUrl ?? ""} ${app.apiBaseUrl ?? ""} ${routeText}`.toLowerCase();
  const routes = app.apiRoutes ?? [];
  const hasVideoRoute = routes.some((route) => videoRouteScore(route) > 0);
  let score = 0;
  if (requestedKind && app.serviceKind?.toLowerCase() === requestedKind) score += 120;
  if (/\b(?:video|movie|clip|animation|reel|media|creative|palmier|seedance|higgsfield|kling|runway|wan|comfyui|animatediff|hunyuan)\b/.test(haystack)) score += 95;
  if (/\b(?:image[-\s]?to[-\s]?video|img2vid|i2v|text[-\s]?to[-\s]?video|txt2vid|video generation|generate video)\b/.test(haystack)) score += 90;
  if (hasVideoRoute) score += 110;
  score += localProxyScore(app.apiBaseUrl);
  score += appPreferenceScore(app, clean(input.prompt), preferences);
  return score;
}

function selectVideoApp(apps: ConnectedHostedApp[], input: VideoGenerationInput, preferences: ConnectedAppPreference[]): VideoGenerationCandidate | null {
  const ranked = apps
    .map((app) => ({ ...app, score: appScore(app, input, preferences) }))
    .filter((app) => app.score > 0)
    .sort((left, right) => right.score - left.score);
  return ranked[0] ?? null;
}

function generationPaths(app: ConnectedHostedApp) {
  const routePaths = (app.apiRoutes ?? [])
    .filter((route) => videoRouteScore(route) > 0)
    .sort((left, right) => videoRouteScore(right) - videoRouteScore(left))
    .map((route) => clean(route.path))
    .filter(Boolean);
  return [...new Set([
    ...routePaths,
    "/api/videos/generate",
    "/api/video/generate",
    "/api/generate-video",
    "/api/image-to-video",
    "/api/img2vid",
    "/api/i2v",
    "/api/generate",
    "/generate-video",
    "/image-to-video",
    "/img2vid",
    "/i2v",
    "/generate",
  ])];
}

async function requestJson(baseUrl: string, path: string, init?: RequestInit) {
  const url = absoluteUrl(baseUrl, path);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, video/*, */*",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Could not reach connected video app endpoint ${url}: ${error instanceof Error ? error.message : "fetch failed"}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Connected video app returned ${response.status}.`);
  }
  if (contentType.startsWith("video/")) {
    return { video: response.url, contentType };
  }
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function maybeVideoUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^data:video\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed) && /\.(?:mp4|m4v|mov|webm)(?:\?|#|$)/i.test(trimmed)) return trimmed;
  if (/^\/(?:Users|var|tmp|private\/tmp)\/.*\.(?:mp4|m4v|mov|webm)(?:\?|#|$)/i.test(trimmed)) {
    return `/api/chat/generated-media?path=${encodeURIComponent(trimmed)}`;
  }
  if (/^\/[^/].*\.(?:mp4|m4v|mov|webm)(?:\?|#|$)/i.test(trimmed)) return trimmed;
  return "";
}

function generatedMediaPathFromUrl(url: string) {
  try {
    const parsed = new URL(url, "http://hivemind.local");
    return parsed.pathname === "/api/chat/generated-media" ? parsed.searchParams.get("path")?.trim() ?? "" : "";
  } catch {
    return "";
  }
}

async function finalizeGeneratedVideos(videos: GeneratedVideo[]) {
  const signed = await Promise.all(videos.map(async (video) => {
    const path = generatedMediaPathFromUrl(video.url);
    return path ? { ...video, url: await signedGeneratedMediaUrl(path) } : video;
  }));
  const seen = new Set<string>();
  return signed.filter((video) => {
    const key = video.url.split(/[?#]/)[0].toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function videoUrlFromRecord(value: Record<string, unknown>, baseUrl: string): string {
  for (const key of ["videoUrl", "video_url", "url", "src", "href", "path", "output", "file", "filename", "video"]) {
    const url = maybeVideoUrl(value[key]);
    if (url) return /^\/[^/]/.test(url) && !url.startsWith("/api/chat/generated-media") ? absoluteUrl(baseUrl, url) : url;
  }
  return "";
}

function collectVideos(value: unknown, baseUrl: string, output: GeneratedVideo[] = []): GeneratedVideo[] {
  if (!value || output.length >= 8) return output;
  const url = maybeVideoUrl(value);
  if (url) {
    output.push({ url: /^\/[^/]/.test(url) && !url.startsWith("/api/chat/generated-media") ? absoluteUrl(baseUrl, url) : url });
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectVideos(item, baseUrl, output);
    return output;
  }
  if (typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  const recordUrl = videoUrlFromRecord(record, baseUrl);
  if (recordUrl) {
    output.push({
      url: recordUrl,
      mimeType: clean(record.mimeType ?? record.mime_type ?? record.contentType ?? record.content_type) || undefined,
      durationMs: typeof record.durationMs === "number" ? record.durationMs : typeof record.duration_ms === "number" ? record.duration_ms : undefined,
    });
  }
  for (const key of recordUrl ? ["videos", "outputs", "results", "artifacts", "data"] : ["videos", "outputs", "results", "artifacts", "files", "data"]) {
    collectVideos(record[key], baseUrl, output);
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

async function pollForVideos(baseUrl: string, firstPayload: unknown) {
  let lastPayload = firstPayload;
  const firstVideos = collectVideos(firstPayload, baseUrl);
  if (firstVideos.length) return { videos: await finalizeGeneratedVideos(firstVideos), payload: firstPayload };

  const jobId = jobIdFromPayload(firstPayload);
  const statusUrl = statusUrlFromPayload(firstPayload, baseUrl);
  const paths = [
    statusUrl,
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
      const videos = collectVideos(lastPayload, baseUrl);
      if (videos.length) return { videos: await finalizeGeneratedVideos(videos), payload: lastPayload };
      if (terminalStatus(lastPayload) === "error") {
        const error = clean((lastPayload as Record<string, unknown>).error) || "Connected video app reported a failed generation.";
        throw new Error(error);
      }
    }
  }
  return { videos: [], payload: lastPayload };
}

async function imageDataUrlFromPath(path: string, mimeType?: string) {
  const data = await readFile(path);
  const type = clean(mimeType) || mimeTypeForPath(path) || "application/octet-stream";
  return `data:${type};base64,${data.toString("base64")}`;
}

function mimeTypeForPath(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "";
}

async function buildGenerationBody(input: VideoGenerationInput, model?: string) {
  const images = await Promise.all((input.inputImages ?? []).slice(0, 4).map(async (image) => {
    const path = clean(image.path);
    const dataUrl = clean(image.dataUrl) || (path ? await imageDataUrlFromPath(path, image.mimeType).catch(() => "") : "");
    return {
      name: clean(image.name) || undefined,
      mimeType: clean(image.mimeType) || undefined,
      path: path || undefined,
      dataUrl: dataUrl || undefined,
    };
  }));
  const first = images.find((image) => image.dataUrl || image.path);
  return {
    prompt: clean(input.prompt),
    ...(model ? { model } : {}),
    ...(images.length ? { inputImages: images } : {}),
    ...(images.some((image) => image.path) ? { inputImagePaths: images.map((image) => image.path).filter(Boolean) } : {}),
    ...(first?.dataUrl ? { image: first.dataUrl, imageDataUrl: first.dataUrl } : {}),
    ...(first?.path ? { imagePath: first.path, image_path: first.path } : {}),
  };
}

async function startGeneration(app: ConnectedHostedApp, input: VideoGenerationInput, model?: string) {
  const baseUrl = clean(app.apiBaseUrl);
  if (!baseUrl) throw new Error("Selected connected app does not expose an API base URL.");
  const body = await buildGenerationBody(input, model);
  let lastError = "";
  for (const path of generationPaths(app)) {
    try {
      const payload = await requestJson(baseUrl, path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const result = await pollForVideos(baseUrl, payload);
      if (result.videos.length) return { path, ...result };
      lastError = "The connected video app completed without returning a video URL.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Generation request failed.";
    }
  }
  throw new Error(lastError || "No compatible generation endpoint worked for the connected video app.");
}

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

export async function runChatVideoGeneration(input: VideoGenerationInput): Promise<VideoGenerationResult> {
  const startedAt = Date.now();
  const prompt = clean(input.prompt);
  if (!prompt) return { ok: false, reason: "generation-failed", error: "Prompt is required.", status: 400 };
  try {
    const [apps, preferences] = await Promise.all([
      discoveredApps(input.origin, input.appId),
      readAppPreferences().catch(() => [] as ConnectedAppPreference[]),
    ]);
    const app = selectVideoApp(apps, input, preferences);
    if (!app) {
      return {
        ok: false,
        reason: "no-app",
        error: "No connected video generation app with an API endpoint was found. Open Apps or start a video-capable HivemindOS service, then try again.",
        status: 404,
        appCount: apps.length,
      };
    }
    const appPreference = appPreferenceFor(app, preferences);
    const requestedModel = clean(input.model) || preferredModelFor("video", appPreference?.preferredModels);
    const result = await startGeneration(app, input, requestedModel || undefined);
    const modelName = firstStringField(result.payload, ["model", "modelName", "model_name", "checkpoint", "checkpointName"]) || requestedModel;
    const machineSpecs = firstStringField(result.payload, ["machineSpecs", "machine_specs", "gpu", "device", "hardware"]);
    await recordGenerationMetric({
      kind: "video",
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
      videos: result.videos,
      rawStatus: terminalStatus(result.payload) || undefined,
      requestedModel: requestedModel || undefined,
      preferenceApplied: Boolean(appPreference),
    };
  } catch (error) {
    return {
      ok: false,
      reason: "generation-failed",
      error: error instanceof Error ? error.message : "Video generation failed.",
      status: 502,
    };
  }
}
