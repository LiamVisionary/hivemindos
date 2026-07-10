import { beeWorkerPreset } from "@/lib/config/bee-worker-presets";
import { searchContextIndex, type ContextConnectedApp, type ContextConnectedAppRoute, type ContextIndexItem } from "@/lib/services/context-index";
import { createContextXrayManifestFromContextIndex } from "@/lib/services/context-xray";
import { applyAppPreferences, readAppPreferences, usageNoteAffinity } from "@/lib/services/fleet/app-preferences";
import { generationMetricsContext } from "@/lib/services/generation-metrics";
import { buildConnectedMcpCapabilityContext } from "@/lib/services/mcp/capability-context";
import { untrustedContextMessage } from "@/lib/services/security/untrusted-context";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import type { BeeWorkerClass, SharedVaultConfig, WorkerTaskPreference } from "@/lib/types/agent-runtime";

const CONNECTED_APPS_PREFLIGHT_TIMEOUT_MS = 250;
const CONNECTED_APPS_CACHE_TTL_MS = 60_000;
const CONNECTED_APPS_STALE_TTL_MS = 5 * 60_000;
const CHAT_CAPABILITY_SEARCH_KINDS = ["skill", "tool-schema", "api-route", "connected-app", "app-endpoint", "connector", "artifact", "runtime"] as const;

let connectedAppsCache: { origin: string; apps: ContextConnectedApp[]; updatedAt: number } | null = null;
let connectedAppsRefresh: Promise<ContextConnectedApp[] | undefined> | null = null;

function compactContextText(value: string, maxLength: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function safeContextTags(item: ContextIndexItem) {
  return item.tags.filter((tag) => !/^\d+$/.test(tag)).slice(0, 8).join(", ");
}

function contextItemLocator(item: ContextIndexItem) {
  if (item.kind === "connected-app" || item.kind === "app-endpoint") {
    return "Dashboard can resolve current app URLs through /api/context-index or /api/fleet/apps for tool-capable runtimes; do not hard-code Tailnet endpoints.";
  }
  if (item.kind === "connector") {
    return "Use /api/hive-query for deterministic read-only connector metadata/status; credentials are resolved server-side by key name only.";
  }
  if (item.kind === "artifact") {
    return "Load through /api/visual-artifacts; public views redact local paths.";
  }
  if (item.route && item.path) return `${item.route}; source: ${item.path}`;
  return item.path || item.route || item.load.note || "No direct locator.";
}

type RetrievalHit = {
  item: ContextIndexItem;
  label: string;
};

export type AgentRetrievalProfile = {
  workerClass?: string;
  preferredSkillSlugs?: string[];
  taskPreferences?: WorkerTaskPreference[];
};

function normalizeMatchText(value?: string) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function classPreferredSkillSlugs(agent: AgentRetrievalProfile | undefined) {
  if (!agent) return new Set<string>();
  const preset = agent.workerClass ? beeWorkerPreset(agent.workerClass as BeeWorkerClass) : null;
  return new Set([
    ...(agent.preferredSkillSlugs ?? []),
    ...(preset?.skillSlugs ?? []),
  ].map((slug) => slug.toLowerCase().trim()).filter(Boolean));
}

function taskPreferenceMatches(item: ContextIndexItem, preferences: WorkerTaskPreference[]) {
  if (item.kind !== "connected-app" && item.kind !== "app-endpoint") return null;
  const itemText = normalizeMatchText(`${item.id} ${item.title}`);
  return preferences.find((preference) => {
    const appName = normalizeMatchText(preference.appName);
    const appId = normalizeMatchText(preference.appId);
    return (appName.length >= 3 && itemText.includes(appName)) || (appId.length >= 3 && itemText.includes(appId));
  }) ?? null;
}

// Class-aware re-rank: the class never gates what an agent can see — it only
// reorders ties so class-preferred skills and the agent's task-preference apps
// surface in the top slots of the bounded hit list.
function rankHitsForAgent(hits: RetrievalHit[], agent: AgentRetrievalProfile | undefined): RetrievalHit[] {
  if (!agent) return hits;
  const skillSlugs = classPreferredSkillSlugs(agent);
  const taskPreferences = (agent.taskPreferences ?? []).filter((preference) => preference.appId || preference.appName);
  if (!skillSlugs.size && !taskPreferences.length) return hits;
  const annotated = hits.map((hit, index) => {
    let bonus = 0;
    let label = hit.label;
    if (hit.item.kind === "skill") {
      const skillText = `${hit.item.id} ${hit.item.path ?? ""} ${hit.item.title}`.toLowerCase();
      if ([...skillSlugs].some((slug) => skillText.includes(slug))) {
        bonus += 30;
        label = `${label}; class-preferred skill`;
      }
    }
    const matchedPreference = taskPreferenceMatches(hit.item, taskPreferences);
    if (matchedPreference) {
      bonus += 40;
      label = `${label}; agent task preference (${matchedPreference.taskType}${matchedPreference.model ? `, model ${matchedPreference.model}` : ""})`;
    }
    return { hit: { ...hit, label }, sortScore: (hit.item.score ?? 0) + bonus, index };
  });
  return annotated
    .sort((left, right) => right.sortScore - left.sortScore || left.index - right.index)
    .map((entry) => entry.hit);
}

function userAppPreferenceContext(apps: ContextConnectedApp[] | undefined, query: string) {
  const preferred = (apps ?? [])
    .filter((app) => app.priority || app.usageNotes?.trim())
    .sort((left, right) =>
      (Number(right.priority ?? false) - Number(left.priority ?? false))
      || (usageNoteAffinity(query, right.usageNotes) - usageNoteAffinity(query, left.usageNotes)))
    .slice(0, 4);
  if (!preferred.length) return "";
  const lines = ["User app routing preferences (honor these before picking an app yourself):"];
  for (const app of preferred) {
    lines.push([
      `- ${app.name ?? app.id ?? "Connected app"}`,
      app.priority ? "(priority app)" : "",
      app.usageNotes?.trim() ? `— ${app.usageNotes.trim()}` : "",
      app.preferredModels?.length ? `[models: ${app.preferredModels.map((entry) => `${entry.task} → ${entry.model}`).join("; ")}]` : "",
    ].filter(Boolean).join(" "));
  }
  return lines.join("\n");
}

const APP_ROSTER_LIMIT = 24;
const GENERIC_APP_KINDS = new Set(["api", "app", "service", ""]);

function appDoesText(app: ContextConnectedApp): string {
  if (app.capabilities?.length) return `can: ${app.capabilities.join(", ")}`;
  const description = app.description?.trim();
  if (description) return description;
  const routes = (app.apiRoutes ?? [])
    .filter((route) => (route.method ?? "").toUpperCase() === "POST")
    .concat(app.apiRoutes ?? [])
    .map((route) => (route.summary?.trim() || route.path?.trim() || ""))
    .filter(Boolean);
  const unique = [...new Set(routes)].slice(0, 3);
  if (unique.length) return `endpoints: ${unique.join("; ")}`;
  return app.serviceKind?.trim() || app.kind?.trim() || "connected app";
}

function appRosterInterest(app: ContextConnectedApp): number {
  let score = 0;
  if (app.capabilities?.length) score += 4;
  if (app.usageNotes?.trim()) score += 3;
  if (app.priority) score += 3;
  if (app.kind && !GENERIC_APP_KINDS.has(app.kind.toLowerCase())) score += 2;
  if (app.serviceKind && !GENERIC_APP_KINDS.has(app.serviceKind.toLowerCase())) score += 2;
  if ((app.apiRoutes ?? []).length) score += 1;
  return score;
}

/**
 * Always-on roster of every connected app and what it does, so an agent knows
 * its fleet's capabilities regardless of whether the prompt happened to
 * text-match a retrieval query. Previously only a bare count was injected, so an
 * app's real capability (e.g. video generation) stayed invisible unless the
 * prompt used its words.
 */
function connectedAppsRosterContext(apps: ContextConnectedApp[] | undefined): string {
  const list = (apps ?? []).filter((app) => app.name || app.id);
  if (!list.length) return "";
  const ranked = list
    .map((app, index) => ({ app, index, interest: appRosterInterest(app) }))
    .sort((left, right) => right.interest - left.interest || left.index - right.index);
  const shown = ranked.slice(0, APP_ROSTER_LIMIT);
  const lines = ["Connected apps on this fleet (what each can do — resolve live URLs via the Apps APIs, don't hardcode addresses):"];
  for (const { app } of shown) {
    const name = (app.name ?? app.id ?? "Connected app").trim();
    const machine = app.machineName?.trim() ? ` [${app.machineName.trim()}]` : "";
    lines.push(`- ${name}${machine}: ${compactContextText(appDoesText(app), 160)}`);
  }
  const remaining = ranked.length - shown.length;
  if (remaining > 0) lines.push(`- …and ${remaining} more connected app${remaining === 1 ? "" : "s"} (ask to list all).`);
  return lines.join("\n");
}

type RuntimeCapabilityContext = {
  runtime?: string;
  hasRuntimeImageGeneration?: boolean;
  runtimeImageGenerationProvider?: string;
  runtimeImageGenerationModel?: string;
  runtimeImageGenerationSource?: string;
};

export type TaskRetrievalTelemetry = {
  queryCount: number;
  hitCount: number;
  connectedAppCount: number | null;
  imageGenerationIntent: boolean;
  localImageGenerationIntent: boolean;
  runtimeImageGenerationAvailable: boolean;
  runtimeImageGenerationSource: string | null;
};

export type TaskRetrievalContextResult = {
  context: string;
  telemetry: TaskRetrievalTelemetry;
};

export function formatTaskRetrievalProcessDetail(telemetry: TaskRetrievalTelemetry) {
  return [
    `${telemetry.hitCount} retrieval hit${telemetry.hitCount === 1 ? "" : "s"}`,
    `${telemetry.queryCount} quer${telemetry.queryCount === 1 ? "y" : "ies"}`,
    telemetry.connectedAppCount === null ? "connected apps unavailable" : `${telemetry.connectedAppCount} connected app${telemetry.connectedAppCount === 1 ? "" : "s"} observed`,
    telemetry.localImageGenerationIntent ? "local image generation intent detected" : telemetry.imageGenerationIntent ? "image generation intent detected" : "",
    telemetry.runtimeImageGenerationAvailable ? `runtime image generation available${telemetry.runtimeImageGenerationSource ? ` via ${telemetry.runtimeImageGenerationSource}` : ""}` : "",
  ].filter(Boolean).join("; ");
}

export function buildTaskRetrievalFallbackContext(input: {
  query: string;
  origin: string;
  timeoutMs: number;
  timedOut: boolean;
  failed: boolean;
}) {
  if (!input.timedOut && !input.failed) return "";
  const status = input.timedOut
    ? `timed out after ${input.timeoutMs}ms`
    : "failed before returning retrieval results";
  return [
    "Hive capability search preflight:",
    `- Capability search ${status}; this chat is continuing under the fast preflight SLA instead of waiting on slow discovery.`,
    `- Query attempted: ${compactContextText(input.query, 240)}`,
    `- HivemindOS dashboard API origin for tool-capable runtimes: ${dashboardOriginFor(input.origin)}`,
    "- Do not invent tool calls, app names, local generation success, or execution receipts.",
    "- For local image generation requests, say the capability search did not return a live generator route in time and ask the user to retry or use the HivemindOS image route once discovery is healthy.",
    "- If a real HTTP/tool bridge is available later in the turn, prefer the dashboard proxy POST /api/fleet/apps/request with a discovered service/app target.",
  ].join("\n");
}

export function formatTaskRetrievalFallbackProcessDetail(input: { timeoutMs: number; timedOut: boolean; failed: boolean }) {
  if (input.timedOut) {
    return `capability search timed out after ${input.timeoutMs}ms before returning retrieval telemetry; query attempted; continuing with fallback context`;
  }
  if (input.failed) {
    return "capability search failed before returning retrieval telemetry; query attempted; continuing with fallback context";
  }
  return "";
}

function dashboardOriginFor(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function formatTaskRetrievalItem(hit: RetrievalHit, index: number) {
  const item = hit.item;
  const methods = item.methods?.length ? ` [${item.methods.join(", ")}]` : "";
  const hiveActionId = item.id.startsWith("hive-action:") ? item.id.slice("hive-action:".length) : "";
  return [
    `${index + 1}. ${item.kind}: ${item.title}${methods}`,
    `   capability id: ${item.id}`,
    hiveActionId ? `   invoke: surface=hive_action; capabilityId=${hiveActionId}` : "",
    `   matched: ${hit.label}`,
    `   summary: ${compactContextText(item.summary, 260)}`,
    `   tags: ${safeContextTags(item) || "none"}`,
    `   locator: ${contextItemLocator(item)}`,
  ].filter(Boolean).join("\n");
}

function taskRetrievalQueries(query: string) {
  const normalized = query.toLowerCase();
  const queries = [{ label: "full task", query }];
  if (loopEngineeringRequest(query)) {
    queries.push({
      label: "loop engineering",
      query: "loop engineering readiness /api/loops Work Board pattern registry eval gates receipts budgets code-fix app-build-harness research daily-brief evo benchmark LOOP.md STATE.md",
    });
  }
  if (/\b(x|twitter|tweet|tweets|post|social)\b/.test(normalized)) {
    queries.push({ label: "x research and writing", query: "x twitter search latest news social post x-post optimizer grok writer" });
  }
  if (/image|picture|photo|visual|render|generate|generation/.test(normalized)) {
    queries.push({ label: "image generation", query: "image generation open generative ai zimage z-image imagegen visual creative diffusion comfyui" });
  }
  if (/video|movie|clip|animation|reel|img2vid|i2v|animate/.test(normalized)) {
    queries.push({ label: "video generation", query: "video generation image to video img2vid i2v animation connected app mcp palmier seedance higgsfield kling runway comfyui" });
  }
  if (/telegram|message|send|deliver|delivery|notify|notification/.test(normalized)) {
    queries.push({ label: "delivery channel", query: "telegram message send notification delivery channel configure access bot" });
  }
  if (/\b(wallet|payment|pay|paid|spend|crypto|usdc|x402|usepod|moneyclaw|bankr|trade|trading|fund|funding|private|privately|privacy)\b/.test(normalized)) {
    queries.push({ label: "wallet and payment rails", query: "agent wallet tools payment rails private transfer privacy x402 fetch paid api crypto usdc usepod moneyclaw bankr send balance approval" });
  }
  if (/\b(bankr|token\s+launch|launch\s+(?:a\s+)?token|llm\s+credits|max\s+mode|polymarket|hyperliquid|limit\s+order|stop\s+order|dca|twap)\b/.test(normalized)) {
    queries.push({ label: "Bankr agent platform", query: "bankr agent platform trading swap token launch fee share llm gateway credits max mode automations polymarket hyperliquid wallet portfolio" });
  }
  if (/\b(miroshark|simulation|simulate|rehearsal|social\s+sim|belief\s+drift|prediction\s+market|polymarket|reddit|twitter)\b/.test(normalized)) {
    queries.push({ label: "MiroShark social simulation", query: "MiroShark x402 paid run native chat card social simulation rehearsal prompt url article deep research prediction market report status modal" });
  }
  if (/agent|worker|specialist|runtime|workflow|skill/.test(normalized)) {
    queries.push({ label: "agent and workflow routing", query: "agent worker runtime capabilities skill action workflow social posting xSearch writer" });
  }
  const seen = new Set<string>();
  return queries.filter((entry) => {
    const key = entry.query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

export function imageGenerationRequest(query: string) {
  return /\b(?:generate|create|make|draw|render|produce|imagine)\b[\s\S]{0,80}\b(?:image|picture|photo|visual|art|illustration)\b/i.test(query)
    || /\b(?:image|picture|photo|visual|art|illustration)\b[\s\S]{0,80}\b(?:generate|generation|create|make|draw|render|produce|imagine)\b/i.test(query)
    || /\b(?:txt2img|text\s*to\s*image|image[-\s]?gen|image generation)\b/i.test(query);
}

export function videoGenerationRequest(query: string) {
  return /\b(?:generate|create|make|render|produce|animate)\b[\s\S]{0,100}\b(?:video|movie|clip|animation|reel)\b/i.test(query)
    || /\b(?:video|movie|clip|animation|reel|image[-\s]?to[-\s]?video|img2vid|text[-\s]?to[-\s]?video|txt2vid)\b[\s\S]{0,100}\b(?:generate|generation|create|make|render|produce|animate)\b/i.test(query)
    || /\b(?:image[-\s]?to[-\s]?video|img2vid|text[-\s]?to[-\s]?video|txt2vid|video generation)\b/i.test(query);
}

export function localImageGenerationRequest(query: string) {
  return imageGenerationRequest(query) && /\b(?:local|locally|on this mac|this mac|my mac|self[-\s]?hosted|tailnet|comfyui|z[-\s]?image|zimage)\b/i.test(query);
}

export function requiresCapabilityRouting(query: string) {
  return loopEngineeringRequest(query)
    || localImageGenerationRequest(query)
    || videoGenerationRequest(query)
    || /\b(?:capabilit(?:y|ies)|connected app|tool|api|x402|wallet|payment|send|deliver|deploy|workflow|kanban|scheduler|miroshark|bankr|crypto|trade|trading|token|swap|portfolio)\b/i.test(query)
    || /\bwhat\b[\s\S]{0,40}\bcan you do\b|\bcan you do with\b/i.test(query);
}

export function loopEngineeringRequest(query: string) {
  const normalized = query.toLowerCase();
  if (/\bloop(?:ed|ing|s)?\b/.test(normalized)) return true;
  if (/\b(?:keep|continue|retry|rerun|repeat|iterate)\b[\s\S]{0,100}\b(?:until|unless|passes?|green|clean|verified|fixed|done)\b/.test(normalized)) return true;
  if (/\buntil\b[\s\S]{0,100}\b(?:tests?|checks?|lint|typecheck|receipts?|evidence|verified|passes?|green|clean|done)\b/.test(normalized)) return true;
  if (/\b(?:every|daily|weekly|weekday|hourly|recurring|scheduled)\b[\s\S]{0,120}\b(?:brief|scan|report|check|deliver|monitor|summary)\b/.test(normalized)) return true;
  if (/\b(?:smoke|judge|receipt|receipts|evidence|gate|gates|handoff|budget|attempts?)\b[\s\S]{0,120}\b(?:build|fix|repair|research|investigate|scan|deliver|ship)\b/.test(normalized)) return true;
  if (/\b(?:build|fix|repair|research|investigate|scan|deliver|ship)\b[\s\S]{0,120}\b(?:smoke|judge|receipt|receipts|evidence|gate|gates|handoff|budget|attempts?)\b/.test(normalized)) return true;
  return false;
}

function shouldRunTaskRetrieval(query: string) {
  return Boolean(query.trim());
}

const IMAGE_APP_HAYSTACK_PATTERN = /\b(?:image[-\s]?gen|image generation|txt2img|text to image|comfyui|diffusion|stable diffusion|open generative ai|local-?ai|z[-\s]?image|zimage|gpt-image|dall-?e)\b/;

// Mirrors generationRouteScore() in /api/chat/image-generation/route.ts so the
// preflight ranks connected image apps by the same "reachable endpoint" signal
// the deterministic dispatch scorer uses. Kept local to avoid importing a route handler.
function generationRouteStrength(route: ContextConnectedAppRoute) {
  const method = (route.method || "GET").trim().toUpperCase();
  if (method && method !== "POST") return 0;
  const text = `${route.path ?? ""} ${route.summary ?? ""} ${route.category ?? ""}`.toLowerCase();
  let score = 0;
  if (/\/(?:api\/)?(?:generate|generation|txt2img|image|images)(?:\/|$)/.test(text)) score += 50;
  if (/prompt|text.?to.?image|image generation|generate image/.test(text)) score += 30;
  if (/status|history|models|health|download|delete/.test(text)) score -= 40;
  return score;
}

type RankedImageApp = {
  app: ContextConnectedApp;
  score: number;
  hasGenerationRoute: boolean;
  workspaceOnly: boolean;
  bestRoute?: ContextConnectedAppRoute;
};

function scoreImageApp(app: ContextConnectedApp, query = ""): RankedImageApp | null {
  const routes = app.apiRoutes ?? [];
  const routeText = routes.map((route) => `${route.method ?? ""} ${route.path ?? ""} ${route.summary ?? ""} ${route.category ?? ""}`).join(" ");
  const haystack = `${app.name ?? ""} ${app.description ?? ""} ${app.serviceKind ?? ""} ${app.openUrl ?? ""} ${app.apiBaseUrl ?? ""} ${routeText}`.toLowerCase();
  const serviceKind = (app.serviceKind ?? "").toLowerCase();
  if (!IMAGE_APP_HAYSTACK_PATTERN.test(haystack) && !serviceKind.includes("image")) return null;
  const rankedRoutes = routes
    .map((route) => ({ route, strength: generationRouteStrength(route) }))
    .sort((left, right) => right.strength - left.strength);
  const bestRoute = rankedRoutes[0];
  const hasGenerationRoute = (bestRoute?.strength ?? 0) > 0;
  const workspaceOnly = routes.length > 0 && !hasGenerationRoute
    && routes.every((route) => (route.method || "GET").trim().toUpperCase() === "GET" && (route.path || "/").trim() === "/");
  // Deliberately no per-name boosts: endpoint strength decides, not whether the
  // name looks image-related, so a real generation route outranks a name match.
  let score = 0;
  if (serviceKind.includes("image")) score += 40;
  if (IMAGE_APP_HAYSTACK_PATTERN.test(haystack)) score += 30;
  if (hasGenerationRoute) score += 80;
  if (workspaceOnly) score -= 30;
  if (app.online) score += 10;
  if (app.local) score += 10;
  // User preference signals: a pinned app or a prose hint that matches the
  // request ("use this app for realism") outranks name-pattern matches.
  if (app.priority) score += 60;
  score += Math.min(usageNoteAffinity(query, app.usageNotes) * 25, 100);
  return { app, score, hasGenerationRoute, workspaceOnly, bestRoute: hasGenerationRoute ? bestRoute?.route : undefined };
}

function imageAppRecommendationContext(apps: ContextConnectedApp[] | undefined, query = "") {
  if (!apps?.length) return "";
  const ranked = apps
    .map((app) => scoreImageApp(app, query))
    .filter((entry): entry is RankedImageApp => entry !== null && entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return "";
  const top = ranked[0];
  const lines = ["Connected image-app ranking (ranked by reachable generation endpoint and user preference, not by name):"];
  if (top.app.usageNotes?.trim() && usageNoteAffinity(query, top.app.usageNotes) > 0) {
    lines.push(`- User preference matched: ${top.app.name ?? "connected app"} — "${top.app.usageNotes.trim()}"`);
  }
  if (top.hasGenerationRoute && top.bestRoute) {
    const method = (top.bestRoute.method || "POST").trim().toUpperCase();
    const path = (top.bestRoute.path || "").trim();
    lines.push(`- Recommended route: ${top.app.name ?? "connected app"} — reachable generation endpoint (${method} ${path || "/"}). Prefer this over name-only or workspace-only matches.`);
  } else {
    lines.push(`- Highest-ranked connected image app: ${top.app.name ?? "connected app"}, but no reachable generation endpoint was discovered. Do not claim it can generate until a real route is confirmed.`);
  }
  const others = ranked.slice(1, 4).map((entry) => {
    const status = entry.hasGenerationRoute ? "has generation route" : entry.workspaceOnly ? "workspace-only" : "name match only";
    return `${entry.app.name ?? "app"} (${status})`;
  });
  if (others.length) lines.push(`- Lower-ranked candidates: ${others.join("; ")}.`);
  return lines.join("\n");
}

function imageGenerationCapabilityContext(query: string, runtime?: RuntimeCapabilityContext, connectedApps?: ContextConnectedApp[]) {
  if (!imageGenerationRequest(query)) return "";
  const localRequested = localImageGenerationRequest(query);
  const runtimeLabel = runtime?.runtime ? `${runtime.runtime} runtime` : "active runtime";
  const runtimeModel = [runtime?.runtimeImageGenerationProvider, runtime?.runtimeImageGenerationModel].filter(Boolean).join("/");
  const runtimeDetail = [
    runtimeModel ? `model ${runtimeModel}` : "",
    runtime?.runtimeImageGenerationSource ? `source: ${runtime.runtimeImageGenerationSource}` : "",
  ].filter(Boolean).join("; ");
  return [
    "Image generation capability routing:",
    runtime?.hasRuntimeImageGeneration
      ? `- Active ${runtimeLabel} advertises its own image-generation capability${runtimeDetail ? ` (${runtimeDetail})` : ""}; prefer the runtime-native image tool before selecting an OpenRouter image model.`
      : "- If the active runtime advertises a native image-generation capability, prefer that runtime tool before selecting an external image provider.",
    localRequested
      ? "- The user asked for local image generation: prefer connected local/Tailnet image-generation apps from the retrieved capability hints when a real tool bridge is available."
      : "- Prefer hive capability search results and connected image-generation apps/services before choosing a provider-specific fallback.",
    "- Rank connected image apps by reachable generation endpoints and healthy app-proxy routes. A name that merely looks image-related (no discovered generation route) or a workspace-only app must not outrank an app that exposes a real generation endpoint.",
    "- When a user app routing preference matches the requested style (for example anime versus realism), use that app and its preferred model for the task type; pass the model in the generation request body.",
    imageAppRecommendationContext(connectedApps, query),
    "- If this chat bridge does not expose real tool calls/app dispatch, do not say the generation was initiated, sent, dispatched, queued, or executed. Say the selected route and that HivemindOS needs to run the native image-generation dispatch path.",
    "- OpenRouter free image-model search is only a fallback when no runtime-native image generator and no suitable hive capability/app is available, unless the user explicitly asks for OpenRouter.",
  ].filter(Boolean).join("\n");
}

function videoGenerationCapabilityContext(query: string) {
  if (!videoGenerationRequest(query)) return "";
  return [
    "Video generation capability routing:",
    "- Prefer connected video-generation apps, MCP servers, or media services discovered by Hive capability search before provider-specific fallbacks.",
    "- If the user attached an image, use the current turn media artifact path/id as the image-to-video source input. Do not embed base64 in the model prompt.",
    "- Tool-capable OpenAI-compatible runtimes may call the generate_video tool; the runtime will pass the prepared media artifact bytes/path to the selected connected video app.",
    "- For connected apps and MCP servers, resolve fresh routes through HivemindOS APIs instead of hard-coding Tailnet or localhost endpoints.",
    "- Do not claim a video was generated unless a tool/app route returns a video artifact or receipt.",
  ].join("\n");
}

function loopEngineeringCapabilityContext(query: string) {
  if (!loopEngineeringRequest(query)) return "";
  return [
    "Loop-shaped task routing:",
    "- The user described repeat-until-clean, recurring, gated, judged, receipt-backed, budgeted, or handoff-driven work. Treat it as Work Board loop-engineering work even when they did not say the word loop.",
    "- For loop-shaped requests, include a section labeled \"Work Board loop plan\" before any generic execution plan so the user sees how the task will be bounded, judged, retried, and audited.",
    "- When asked how HivemindOS should track it, name the concrete Work Board loop task shape: template/pattern, acceptance gates, required receipts, attempt/runtime/token/cost budget, handoff rule, and readiness audit.",
    "- Prefer /api/loops for loop task templates, create-task, readiness checks, and LOOP.md / STATE.md artifact exports; use /api/kanban for claim, heartbeat, complete, block, loop-discover, and loop-record lifecycle events.",
    "- Do not claim execution if this chat bridge has no real tool call/app dispatch. Instead, describe the exact Work Board card and receipts HivemindOS should create or ask the user to run the HivemindOS loop/kanban path.",
  ].join("\n");
}

async function fetchConnectedAppsForTaskRetrieval(origin: string) {
  const url = new URL("/api/fleet/apps", origin);
  const response = await fetch(url, {
    cache: "no-store",
    headers: internalApiAuthHeaders(),
    signal: AbortSignal.timeout(CONNECTED_APPS_PREFLIGHT_TIMEOUT_MS),
  }).catch(() => null);
  if (!response?.ok) return undefined;
  const payload = await response.json().catch(() => null) as { apps?: ContextConnectedApp[] } | null;
  return Array.isArray(payload?.apps) ? payload.apps : undefined;
}

function refreshConnectedAppsForTaskRetrieval(origin: string) {
  if (connectedAppsRefresh) return connectedAppsRefresh;
  connectedAppsRefresh = fetchConnectedAppsForTaskRetrieval(origin)
    .then((apps) => {
      if (apps) connectedAppsCache = { origin, apps, updatedAt: Date.now() };
      return apps;
    })
    .finally(() => {
      connectedAppsRefresh = null;
    });
  return connectedAppsRefresh;
}

async function connectedAppsForTaskRetrieval(origin: string) {
  const now = Date.now();
  const cached = connectedAppsCache?.origin === origin ? connectedAppsCache : null;
  if (cached && now - cached.updatedAt < CONNECTED_APPS_CACHE_TTL_MS) return cached.apps;
  if (cached && now - cached.updatedAt < CONNECTED_APPS_STALE_TTL_MS) {
    void refreshConnectedAppsForTaskRetrieval(origin).catch(() => undefined);
    return cached.apps;
  }
  return refreshConnectedAppsForTaskRetrieval(origin);
}

export async function buildTaskRetrievalContext(input: {
  origin: string;
  query: string;
  sharedVault: SharedVaultConfig | null;
  runtime?: RuntimeCapabilityContext;
  agent?: AgentRetrievalProfile;
}) {
  return (await buildTaskRetrievalContextResult(input)).context;
}

export async function buildTaskRetrievalContextResult(input: {
  origin: string;
  query: string;
  sharedVault: SharedVaultConfig | null;
  runtime?: RuntimeCapabilityContext;
  agent?: AgentRetrievalProfile;
  recordContextXray?: boolean;
  runId?: string;
  threadId?: string;
  model?: string;
}): Promise<TaskRetrievalContextResult> {
  const trimmed = input.query.trim();
  const baseTelemetry = {
    queryCount: 0,
    hitCount: 0,
    connectedAppCount: null,
    imageGenerationIntent: false,
    localImageGenerationIntent: false,
    runtimeImageGenerationAvailable: Boolean(input.runtime?.hasRuntimeImageGeneration),
    runtimeImageGenerationSource: input.runtime?.runtimeImageGenerationSource ?? null,
  };
  if (!trimmed) {
    return { context: "", telemetry: baseTelemetry };
  }
  if (!shouldRunTaskRetrieval(trimmed)) {
    return { context: "", telemetry: baseTelemetry };
  }
  const dashboardOrigin = dashboardOriginFor(input.origin);
  const [rawConnectedApps, appPreferences] = await Promise.all([
    connectedAppsForTaskRetrieval(dashboardOrigin),
    readAppPreferences().catch(() => []),
  ]);
  const connectedApps = rawConnectedApps ? applyAppPreferences(rawConnectedApps, appPreferences) : rawConnectedApps;
  const queries = taskRetrievalQueries(trimmed);
  const imageIntent = imageGenerationRequest(trimmed);
  const localImageIntent = localImageGenerationRequest(trimmed);
  const generationPerformanceContext = await generationMetricsContext(trimmed).catch(() => "");
  const connectedMcpContext = buildConnectedMcpCapabilityContext();
  const results = await Promise.all(queries.map(async (entry) => {
    const result = await searchContextIndex({
      query: entry.query,
      vaultPath: input.sharedVault?.vaultPath,
      connectedApps,
      includeRuntimeProviders: false,
      kinds: [...CHAT_CAPABILITY_SEARCH_KINDS],
      limit: 8,
    }).catch(() => null);
    return (result?.items ?? []).map((item): RetrievalHit => ({ item, label: entry.label }));
  }));
  const seen = new Set<string>();
  const dedupedHits = results.flat().filter((hit) => {
    if (seen.has(hit.item.id)) return false;
    seen.add(hit.item.id);
    return true;
  });
  const hits = rankHitsForAgent(dedupedHits, input.agent).slice(0, 22);
  if (input.recordContextXray && (input.runId || input.threadId)) {
    void createContextXrayManifestFromContextIndex({
      runId: input.runId,
      threadId: input.threadId,
      model: input.model ?? input.runtime?.runtime,
      query: trimmed,
      items: hits.map((hit) => hit.item),
    }).catch(() => undefined);
  }
  const telemetry: TaskRetrievalTelemetry = {
    queryCount: queries.length,
    hitCount: hits.length,
    connectedAppCount: connectedApps?.length ?? null,
    imageGenerationIntent: imageIntent,
    localImageGenerationIntent: localImageIntent,
    runtimeImageGenerationAvailable: Boolean(input.runtime?.hasRuntimeImageGeneration),
    runtimeImageGenerationSource: input.runtime?.runtimeImageGenerationSource ?? null,
  };
  const retrievalSummary = hits.length
    ? "- Ranked retrieval hits are listed below. Prefer these concrete names before inventing generic tools."
    : "- No ranked retrieval hits were returned. Still use this capability preflight: resolve live apps/routes through the dashboard APIs before choosing a provider fallback.";
  const context = [
    "Hive capability search preflight:",
    "- Treat this as already-retrieved context. If the current chat does not expose real tool calls, answer directly and do not emit tool-call markup.",
    `- Query: ${compactContextText(trimmed, 240)}`,
    `- HivemindOS dashboard API origin for tool-capable runtimes: ${dashboardOrigin}`,
    `- Queries run: ${queries.length}; retrieval hits: ${hits.length}; connected apps observed: ${connectedApps?.length ?? "unknown"}.`,
    retrievalSummary,
    "- For connected apps and app endpoints, tool-capable runtimes should resolve fresh URLs through the Apps view APIs instead of hard-coding local or Tailnet addresses.",
    "- Use a dedicated native tool such as generate_image or generate_video when one is exposed for the user's exact intent. Otherwise, tool-capable runtimes should call invoke_hive_capability for retrieved MCP tools, connected-app endpoints, and Hive Actions. It resolves live targets and enforces read/write confirmation policy; do not invent provider-specific tool names.",
    input.agent?.workerClass
      ? `- Worker class lens: ${input.agent.workerClass}. Hits marked class-preferred or agent task preference match this agent's specialization; prefer them on ties, but any listed capability remains usable.`
      : "",
    connectedAppsRosterContext(connectedApps),
    connectedMcpContext ? untrustedContextMessage("Connected MCP capability inventory", connectedMcpContext).content : "",
    userAppPreferenceContext(connectedApps, trimmed),
    loopEngineeringCapabilityContext(trimmed),
    imageGenerationCapabilityContext(trimmed, input.runtime, connectedApps),
    videoGenerationCapabilityContext(trimmed),
    generationPerformanceContext,
    hits.length ? untrustedContextMessage("Hive capability search hits", hits.map(formatTaskRetrievalItem).join("\n")).content : "",
  ].filter(Boolean).join("\n");
  return { context, telemetry };
}
