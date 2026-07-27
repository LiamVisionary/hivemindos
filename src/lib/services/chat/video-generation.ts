import "server-only";

import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "@/lib/home-dir";
import {
  appPreferenceFor,
  preferredModelFor,
  readAppPreferences,
  usageNoteAffinity,
  type AppMcpVideoDescriptor,
  type ConnectedAppPreference,
} from "@/lib/services/fleet/app-preferences";
import { discoverRawConnectedApps, type ConnectedHostedApp } from "@/lib/services/fleet/connected-apps";
import { recordGenerationMetric } from "@/lib/services/generation-metrics";
import { signedGeneratedMediaUrl } from "@/lib/services/chat/generated-media-signing";
import {
  chatImageMimeTypeForPath,
  preferredChatImageExtensionForMimeType,
} from "@/lib/services/chat/chat-image-formats";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import { callMcpTool, connectMcpServer, disconnectMcpServer } from "@/lib/services/mcp/client";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";

const REQUEST_TIMEOUT_MS = 240_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 120;
const MCP_POLL_INTERVAL_MS = 6_000;
const MCP_MAX_POLL_ATTEMPTS = 90;
const GENERATED_VIDEO_DIR = join(homedir(), ".hivemindos", "cache", "generated-video");
const MCP_VIDEO_FRAME_RATE = 24;
const DEFAULT_VIDEO_DURATION_SECONDS = 4;
const MAX_MCP_VIDEO_DURATION_SECONDS = 30;

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
  appId?: string;
  appName?: string;
  machineName?: string;
  serviceKind?: string;
};

export type VideoGenerationResult = VideoGenerationSuccess | VideoGenerationFailure;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function requestedVideoDurationSeconds(prompt: string) {
  const match = /\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i.exec(prompt);
  const requested = match ? Number(match[1]) : DEFAULT_VIDEO_DURATION_SECONDS;
  if (!Number.isFinite(requested)) return DEFAULT_VIDEO_DURATION_SECONDS;
  return Math.max(1, Math.min(MAX_MCP_VIDEO_DURATION_SECONDS, requested));
}

export function videoFrameCount(durationSeconds: number, frameRate = MCP_VIDEO_FRAME_RATE) {
  const safeFrameRate = Number.isFinite(frameRate) ? Math.max(1, Math.min(120, frameRate)) : MCP_VIDEO_FRAME_RATE;
  const safeDuration = Number.isFinite(durationSeconds)
    ? Math.max(1, Math.min(MAX_MCP_VIDEO_DURATION_SECONDS, durationSeconds))
    : DEFAULT_VIDEO_DURATION_SECONDS;
  return Math.max(9, Math.min(721, Math.round(safeDuration * safeFrameRate) + 1));
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

// An app declared as an MCP video provider via the app-preferences overlay is a
// selectable candidate even if collector discovery didn't surface it this pass —
// its connection details live in the overlay, so it can't be a phantom, and this
// keeps "generate a video" working through a flaky discovery window.
function withMcpVideoProviders(apps: ConnectedHostedApp[], preferences: ConnectedAppPreference[]) {
  const mcpPreferenceByHostPort = new Map(preferences.flatMap((preference) => {
    if (!preference.mcpVideo || !clean(preference.appId)) return [];
    const hint = appIdHint(preference.appId);
    return [[hint ? `${hint.host}:${hint.port}` : clean(preference.appId), preference] as const];
  }));
  const enrichedApps = apps.map((app) => {
    const hint = appIdHint(app.id);
    const preference = mcpPreferenceByHostPort.get(hint ? `${hint.host}:${hint.port}` : clean(app.id));
    return preference ? {
      ...app,
      name: preference.appName || app.name,
      serviceKind: "video",
    } : app;
  });
  const hostPorts = new Set(enrichedApps.map((app) => {
    const hint = appIdHint(app.id);
    return hint ? `${hint.host}:${hint.port}` : clean(app.id);
  }).filter(Boolean));
  const virtual: ConnectedHostedApp[] = [];
  for (const preference of preferences) {
    if (!preference.mcpVideo || !clean(preference.appId)) continue;
    const hint = appIdHint(preference.appId);
    const key = hint ? `${hint.host}:${hint.port}` : clean(preference.appId);
    if (hostPorts.has(key)) continue;
    hostPorts.add(key);
    virtual.push({
      id: preference.appId,
      name: preference.appName || "Video app",
      serviceKind: "video",
      apiBaseUrl: clean(preference.mcpVideo.uploadBase) || clean(preference.mcpVideo.url),
    });
  }
  return virtual.length ? [...enrichedApps, ...virtual] : enrichedApps;
}

function appPreferenceScore(app: ConnectedHostedApp, prompt: string, preferences: ConnectedAppPreference[]) {
  const preference = appPreferenceFor(app, preferences);
  if (!preference) return 0;
  let score = 0;
  if (preference.priority) score += 150;
  score += Math.min(usageNoteAffinity(prompt, preference.usageNotes) * 35, 140);
  return score;
}

// Strong app name/description terms that specifically indicate a VIDEO generator.
// Deliberately EXCLUDES ambiguous image-or-anything words ("comfyui", "media",
// "creative", bare "generate") that previously let an image studio pose as a
// video app (2026-07-10: a Z-Image/ComfyUI control surface with a bare
// `/api/generate` route out-scored everything and wasted an 18s image render).
const VIDEO_APP_KEYWORD = /\b(?:videos?|movie|animatediff|animate|motion|reel|palmier|seedance|higgsfield|kling|runway|pika|luma|veo|sora|mochi|ltx|svd|hunyuan)\b|image[-\s]?to[-\s]?video|img2vid|\bi2v\b|text[-\s]?to[-\s]?video|txt2vid/i;
const VIDEO_TASK_KEYWORD = /image[-\s]?to[-\s]?video|img2vid|\bi2v\b|text[-\s]?to[-\s]?video|txt2vid|video[-\s]?generation|generate[-\s]?video/i;

// A connected app route only counts as a *video* route when its path/summary
// carries a genuinely video-specific signal. A bare image `/api/generate` (or a
// generic "prompt"/"generate" summary) must NOT qualify.
function videoRouteScore(route: { method?: string; path?: string; summary?: string; category?: string }) {
  const method = clean(route.method || "GET").toUpperCase();
  if (method && method !== "POST") return 0;
  const text = `${route.path ?? ""} ${route.summary ?? ""} ${route.category ?? ""}`.toLowerCase();
  let score = 0;
  if (/image[-_\s]?to[-_\s]?video|img2vid|\bi2v\b|text[-_\s]?to[-_\s]?video|txt2vid|generate[-_\s]?video|video[-_\s]?generat|\/videos?(?:\/|$)/.test(text)) score += 60;
  if (/\bvideos?\b|animatediff|\banimate\b|\bmotion\b|\.mp4|\.mov|\.webm/.test(text)) score += 40;
  if (/status|history|models|health|download|delete/.test(text)) score -= 35;
  return score;
}

function appScore(app: ConnectedHostedApp, input: VideoGenerationInput, preferences: ConnectedAppPreference[]) {
  if (!app.apiBaseUrl) return -1;
  // An explicit app pin from the caller always wins — the agent/user chose it.
  if (input.appId && appMatchesId(app, input.appId)) return 10_000;
  const requestedKind = clean(input.serviceKind).toLowerCase();
  const routeText = (app.apiRoutes ?? []).map((route) => `${route.method ?? ""} ${route.path ?? ""} ${route.summary ?? ""} ${route.category ?? ""}`).join(" ");
  const appUrls = app as ConnectedHostedApp & { openUrl?: string };
  const haystack = `${app.name ?? ""} ${app.description ?? ""} ${app.serviceKind ?? ""} ${appUrls.openUrl ?? ""} ${app.apiBaseUrl ?? ""} ${routeText}`.toLowerCase();
  const routes = app.apiRoutes ?? [];
  const hasVideoRoute = routes.some((route) => videoRouteScore(route) > 0);
  const kindIsVideo = app.serviceKind?.toLowerCase() === "video";
  const hasVideoKeyword = VIDEO_APP_KEYWORD.test(haystack) || VIDEO_TASK_KEYWORD.test(haystack);
  // A HivemindOS-side overlay (app-preferences) can declare an app as a video
  // provider — a `capabilities: ["video"]` tag, or an `mcpVideo` descriptor that
  // says exactly how to invoke it. That's an explicit human/agent declaration,
  // so it both counts as a video signal and outranks name/route heuristics.
  const preference = appPreferenceFor(app, preferences);
  const overlayVideo = Boolean(preference?.mcpVideo) || (preference?.capabilities ?? []).some((tag) => /video/i.test(tag));
  // Hard gate: without a genuine video signal (an overlay declaration, a "video"
  // serviceKind, a real video route, or a video-specific name/description) the
  // app is NOT a video candidate. selectVideoApp filters score > 0, so returning
  // 0 surfaces the honest "No connected video generation app…" instead of
  // dispatching a video request to an image-only app that returns no video URL.
  if (!overlayVideo && !kindIsVideo && !hasVideoRoute && !hasVideoKeyword) return 0;
  let score = 0;
  if (overlayVideo) score += 200;
  if (requestedKind === "video" && kindIsVideo) score += 120;
  else if (kindIsVideo) score += 100;
  if (VIDEO_APP_KEYWORD.test(haystack)) score += 95;
  if (VIDEO_TASK_KEYWORD.test(haystack)) score += 90;
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
  return chatImageMimeTypeForPath(path);
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

// ---- MCP-backed video apps (e.g. Media Studio) --------------------------
// Some connected apps expose video generation as an MCP tool, not a REST route,
// and run on a different fleet machine than the one holding the attached image.
// We stage the image bytes into the app via its multipart /upload/image ingest
// (the MCP JSON body limit is too small for a real photo's base64), call the
// tool with the returned input filename, poll the job, then pull the finished
// (tailnet-absolute) video into a local generated-media file the chat video
// card can stream.

async function imageBytesFromInput(image: VideoGenerationInputImage): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const dataUrl = clean(image.dataUrl);
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(dataUrl);
  if (match) {
    const mimeType = clean(match[1]) || clean(image.mimeType) || "image/png";
    const buffer = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
    return { buffer, filename: clean(image.name) || `attachment${extensionForMime(mimeType)}`, mimeType };
  }
  const path = clean(image.path);
  if (path) {
    const mimeType = clean(image.mimeType) || mimeTypeForPath(path) || "image/png";
    return { buffer: await readFile(path), filename: clean(image.name) || path.split("/").pop() || `attachment${extensionForMime(mimeType)}`, mimeType };
  }
  throw new Error("No attached image bytes to send to the video app.");
}

function extensionForMime(mimeType: string) {
  return preferredChatImageExtensionForMimeType(mimeType) || ".png";
}

async function uploadImageToStudio(uploadBase: string, image: VideoGenerationInputImage): Promise<{ name: string; dims: { width: number; height: number } }> {
  const { buffer, filename, mimeType } = await imageBytesFromInput(image);
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
  form.append("overwrite", "true");
  const url = `${uploadBase.replace(/\/+$/, "")}/upload/image`;
  const response = await fetch(url, { method: "POST", body: form, cache: "no-store", signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Video app image upload failed (${response.status}) at ${url}.`);
  const payload = await response.json().catch(() => null) as { name?: string } | null;
  const name = clean(payload?.name);
  if (!name) throw new Error("Video app image upload returned no input filename.");
  return { name, dims: videoDimsFromImage(buffer) };
}

function imagePixelSize(buffer: Buffer): { width: number; height: number } | null {
  // PNG: IHDR width/height at fixed offsets after the 8-byte signature.
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer.toString("ascii", 12, 16) === "IHDR") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  // JPEG: scan segments for a start-of-frame marker carrying the dimensions.
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }
  return null;
}

function videoDimsFromImage(buffer: Buffer): { width: number; height: number } {
  const size = imagePixelSize(buffer);
  const clamp = (n: number) => Math.max(384, Math.min(1024, Math.round(n / 32) * 32));
  if (!size || !size.width || !size.height) return { width: 768, height: 768 };
  return { width: clamp(size.width), height: clamp(size.height) };
}

function mcpResultJson(result: unknown): Record<string, unknown> {
  const record = result as { content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown } | null;
  const text = (record?.content ?? []).map((part) => (part?.type === "text" ? part.text ?? "" : "")).join("\n").trim();
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return { _text: text };
    }
  }
  return (record?.structuredContent && typeof record.structuredContent === "object" ? record.structuredContent : record ?? {}) as Record<string, unknown>;
}

function mcpJobId(payload: Record<string, unknown>): string {
  const job = payload.job as Record<string, unknown> | undefined;
  const submission = payload.submission as Record<string, unknown> | undefined;
  for (const value of [job?.id, payload.id, payload.job_id, payload.jobId, submission?.prompt_id, payload.prompt_id]) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function rewriteStudioMediaUrl(rawUrl: string, uploadBase: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)$/.test(parsed.hostname)) return rawUrl;
    const base = new URL(uploadBase);
    parsed.protocol = base.protocol;
    parsed.host = base.host;
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function firstVideoUrlInJson(payload: unknown): string {
  const blob = JSON.stringify(payload ?? "");
  const match = blob.match(/https?:\/\/[^"'\s]+\.(?:mp4|m4v|mov|webm)(?:\?[^"'\s]*)?/i);
  return match ? match[0] : "";
}

async function storeGeneratedVideoFromUrl(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Could not download the generated video (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Generated video download was empty.");
  await mkdir(GENERATED_VIDEO_DIR, { recursive: true, mode: 0o700 });
  const extMatch = /\.(mp4|m4v|mov|webm)(?:\?|#|$)/i.exec(url);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : ".mp4";
  const absolutePath = join(GENERATED_VIDEO_DIR, `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  await writeFile(absolutePath, new Uint8Array(buffer));
  return absolutePath;
}

async function startMcpVideoGeneration(app: ConnectedHostedApp, descriptor: AppMcpVideoDescriptor, input: VideoGenerationInput, model?: string) {
  const image = (input.inputImages ?? []).find((entry) => clean(entry.dataUrl) || clean(entry.path));
  if (!image) throw new Error("Attach an image to generate a video with this app.");
  const mediaBase = clean(descriptor.uploadBase) || clean(app.apiBaseUrl);
  if (!mediaBase) throw new Error("This video app has no upload/media base configured.");
  const token = descriptor.authEnvKey ? await hiveEnvValue(descriptor.authEnvKey) : "";
  if (descriptor.authEnvKey && !token) throw new Error(`Missing ${descriptor.authEnvKey} in the shared hive env for the video app.`);

  // Stage the attachment via multipart upload (the tool's JSON body is capped
  // too small for a real photo's base64), then reference the returned filename.
  const { name: inputName, dims } = await uploadImageToStudio(mediaBase, image);
  const tool = clean(descriptor.tool) || "media_generate_video";
  const jobTool = clean(descriptor.jobTool) || "media_get_job";
  const workflowId = clean(descriptor.workflowId) || clean(model);
  const mcpId = `mcp-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const durationSeconds = requestedVideoDurationSeconds(input.prompt);

  await connectMcpServer({
    id: mcpId,
    transport: "http",
    url: descriptor.url,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  try {
    const queued = mcpResultJson(await callMcpTool(mcpId, tool, {
      ...(workflowId ? { workflow_id: workflowId } : {}),
      image_path: inputName,
      prompt: clean(input.prompt),
      width: dims.width,
      height: dims.height,
      frames: videoFrameCount(durationSeconds, MCP_VIDEO_FRAME_RATE),
      frame_rate: MCP_VIDEO_FRAME_RATE,
      wait: false,
      include_urls: true,
    }));
    if (queued.ok === false) throw new Error(clean(queued.error) || "The video app rejected the generation request.");
    const jobId = mcpJobId(queued);
    if (!jobId) throw new Error("The video app did not return a job id.");

    let lastPayload: Record<string, unknown> = queued;
    let rawVideoUrl = firstVideoUrlInJson(queued);
    for (let attempt = 0; attempt < MCP_MAX_POLL_ATTEMPTS && !rawVideoUrl; attempt += 1) {
      await sleep(MCP_POLL_INTERVAL_MS);
      lastPayload = mcpResultJson(await callMcpTool(mcpId, jobTool, { id: jobId, include_urls: true }));
      rawVideoUrl = firstVideoUrlInJson(lastPayload);
      const status = clean((lastPayload.status ?? lastPayload.state ?? (lastPayload.job as Record<string, unknown>)?.status)).toLowerCase();
      if (!rawVideoUrl && /\b(?:error|failed|cancelled|canceled)\b/.test(status)) {
        throw new Error(clean(lastPayload.error) || "The video app reported a failed generation.");
      }
    }
    if (!rawVideoUrl) throw new Error("The video app did not return a finished video in time.");

    const absolutePath = await storeGeneratedVideoFromUrl(mediaBase ? rewriteStudioMediaUrl(rawVideoUrl, mediaBase) : rawVideoUrl);
    const signedUrl = await signedGeneratedMediaUrl(absolutePath);
    return { path: `mcp:${tool}`, videos: [{ url: signedUrl, mimeType: "video/mp4" }] as GeneratedVideo[], payload: lastPayload };
  } finally {
    await disconnectMcpServer(mcpId).catch(() => undefined);
  }
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
  // Hoisted so the generation-failed catch below can name the app it dispatched
  // to — otherwise a failure record can't say which app returned no video URL.
  let selectedApp: VideoGenerationCandidate | null = null;
  let discoveredAppCount = 0;
  try {
    const [discovered, preferences] = await Promise.all([
      discoveredApps(input.origin, input.appId),
      readAppPreferences().catch(() => [] as ConnectedAppPreference[]),
    ]);
    const apps = withMcpVideoProviders(discovered, preferences);
    discoveredAppCount = apps.length;
    const app = selectVideoApp(apps, input, preferences);
    selectedApp = app;
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
    const result = appPreference?.mcpVideo
      ? await startMcpVideoGeneration(app, appPreference.mcpVideo, input, requestedModel || undefined)
      : await startGeneration(app, input, requestedModel || undefined);
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
      appId: selectedApp?.id,
      appName: selectedApp?.name,
      machineName: selectedApp?.machineName,
      serviceKind: selectedApp?.serviceKind,
      appCount: discoveredAppCount,
    };
  }
}
