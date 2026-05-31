import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { homedir } from "os";
import { dirname, join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { promisify } from "util";
import { hivemindLinkControlUrl } from "@/lib/services/hivemind-link-control";

export const runtime = "nodejs";

const APPS_CACHE_MS = 60_000;
const APPS_STALE_MS = 5 * 60_000;
const APPS_CACHE_FILE = join(homedir(), ".hivemindos", "fleet-apps-cache.json");
const COLLECTOR_TIMEOUT_MS = 4_500;
const ICON_PROBE_TIMEOUT_MS = 900;
const SERVICE_SIGNATURE_TIMEOUT_MS = 2_500;
const HIVEMIND_LINK_APP_TIMEOUT_MS = 4_000;
const TAILSCALE_STATUS_TIMEOUT_MS = 3_000;
const HIVEMIND_LINK_COLLECTOR_PORTS = [8787, 8789, 8790, 8791, 8792];
const SERVICE_ROUTE_CATALOG_TIMEOUT_MS = 2_500;
const SERVICE_ROUTE_LIMIT = 80;
const OPENAPI_CATALOG_PATHS = [
  "/openapi.json",
  "/api/openapi.yaml",
  "/api/openapi.yml",
  "/api/openapi.json",
  "/swagger.json",
  "/api/swagger.json",
  "/api/swagger.yaml",
  "/api/swagger.yml",
];
const TAILSCALE_CLI_CANDIDATES = [
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "tailscale",
];

const execFileAsync = promisify(execFile);

type FleetMachine = {
  collector?: string;
  collectorHost?: string;
  device?: {
    self?: boolean;
    name?: string;
    dnsName?: string;
    ip?: string;
    online?: boolean;
    collectorUrl?: string;
  };
};

type CollectorApp = {
  id?: string;
  name?: string;
  description?: string;
  statusCode?: number;
  contentType?: string;
  iconUrl?: string;
  scheme?: string;
  host?: string;
  port?: number;
  path?: string;
  healthPath?: string;
  healthUrl?: string;
  apiBaseUrl?: string;
  localUrl?: string;
  proxyUrl?: string;
  apiProxyUrl?: string;
  healthProxyUrl?: string;
  process?: string;
  pid?: string;
  server?: string;
  interactive?: boolean;
  serviceKind?: string;
};

type HostedApp = {
  id: string;
  name: string;
  sourceName?: string;
  description: string;
  kind: AppKind;
  theme: string;
  initials: string;
  iconUrl?: string;
  machineName: string;
  machineHost: string;
  local: boolean;
  online: boolean;
  interactive: boolean;
  serviceKind?: string;
  scheme: string;
  port: number;
  path: string;
  openUrl: string;
  apiBaseUrl: string;
  healthUrl?: string;
  apiRoutes?: ServiceRoute[];
  apiRoutesSource?: "openapi" | "hivemind";
};

type ServiceSignature = {
  name: string;
  description: string;
  serviceKind: string;
  healthPath: string;
  healthUrl: string;
  apiBaseUrl: string;
};

type ServiceRoute = {
  method: string;
  path: string;
  url: string;
  category: string;
  summary?: string;
  source: "openapi" | "hivemind";
};

type ServiceRouteSpec = {
  method: string;
  path: string;
  category: string;
  summary: string;
};

type ServiceHealthPayload = {
  service?: string;
  name?: string;
  app?: string;
  application?: string;
  status?: string;
  state?: string;
  ok?: boolean;
};

type KnownServiceSignature = {
  displayName: string;
  serviceKind: string;
  defaultPorts: number[];
  healthPaths: string[];
  matches: RegExp;
  routes: ServiceRouteSpec[];
};

const KNOWN_SERVICE_SIGNATURES: KnownServiceSignature[] = [
  {
    displayName: "MiroShark",
    serviceKind: "miroshark",
    defaultPorts: [5101],
    healthPaths: ["/health"],
    matches: /miroshark/i,
    routes: [
      { method: "GET", path: "/health", category: "Core", summary: "Service health signature." },
      { method: "GET", path: "/api/docs", category: "Core", summary: "Interactive API reference when the service exposes Swagger UI." },
      { method: "GET", path: "/api/openapi.yaml", category: "Core", summary: "OpenAPI document for the MiroShark HTTP API." },
      { method: "GET", path: "/api/templates/list", category: "Templates", summary: "List scenario templates." },
      { method: "GET", path: "/api/templates/capabilities", category: "Templates", summary: "Template platform and feature capabilities." },
      { method: "GET", path: "/api/templates/{templateId}?enrich=true", category: "Templates", summary: "Template details with enriched metadata." },
      { method: "GET", path: "/api/simulation/list", category: "Simulations", summary: "List local simulations." },
      { method: "GET", path: "/api/simulation/history", category: "Simulations", summary: "Recent simulation history." },
      { method: "GET", path: "/api/simulation/public", category: "Simulations", summary: "Published simulation runs." },
      { method: "GET", path: "/api/simulation/trending", category: "Simulations", summary: "Trending simulation runs." },
      { method: "POST", path: "/api/simulation/create", category: "Lifecycle", summary: "Create a simulation from a graph." },
      { method: "POST", path: "/api/simulation/prepare", category: "Lifecycle", summary: "Prepare agent profiles for a simulation." },
      { method: "POST", path: "/api/simulation/prepare/status", category: "Lifecycle", summary: "Poll preparation progress." },
      { method: "POST", path: "/api/simulation/start", category: "Lifecycle", summary: "Start a simulation run." },
      { method: "POST", path: "/api/simulation/stop", category: "Lifecycle", summary: "Stop a simulation run." },
      { method: "GET", path: "/api/simulation/{simulationId}/run-status", category: "Run Data", summary: "Current runner status." },
      { method: "GET", path: "/api/simulation/{simulationId}/posts?platform=twitter&limit=500", category: "Run Data", summary: "Generated social posts." },
      { method: "GET", path: "/api/simulation/{simulationId}/timeline", category: "Run Data", summary: "Simulation timeline events." },
      { method: "GET", path: "/api/simulation/{simulationId}/profiles?platform=twitter", category: "Run Data", summary: "Agent profiles." },
      { method: "GET", path: "/api/simulation/{simulationId}/thread.json", category: "Exports", summary: "Thread export as JSON." },
      { method: "GET", path: "/api/simulation/{simulationId}/transcript.md", category: "Exports", summary: "Transcript export as Markdown." },
      { method: "GET", path: "/api/simulation/{simulationId}/share-card.png", category: "Exports", summary: "Share card image." },
      { method: "POST", path: "/api/graph/ontology/generate", category: "Graph", summary: "Generate graph ontology from source material." },
      { method: "POST", path: "/api/graph/build", category: "Graph", summary: "Build a Neo4j graph." },
      { method: "GET", path: "/api/graph/task/{taskId}", category: "Graph", summary: "Poll graph build progress." },
      { method: "GET", path: "/api/graph/data/{graphId}?limit=100", category: "Graph", summary: "Read graph nodes and edges." },
      { method: "GET", path: "/api/observability/stats", category: "Observability", summary: "Runtime and LLM usage stats." },
      { method: "GET", path: "/api/observability/events?limit=30", category: "Observability", summary: "Recent service events." },
      { method: "GET", path: "/api/observability/llm-calls?limit=20", category: "Observability", summary: "Recent LLM calls." },
      { method: "GET", path: "/api/settings", category: "Config", summary: "Current MiroShark settings." },
      { method: "GET", path: "/api/mcp/status", category: "Config", summary: "MCP integration status." },
    ],
  },
];

type AppsPayload = {
  ok: true;
  checkedAt: string;
  source: string;
  apps: HostedApp[];
  machines: Array<{
    name: string;
    collector: string;
    appCount: number;
    error?: string;
  }>;
};

type TailscalePeer = {
  Online?: boolean;
  TailscaleIPs?: string[];
};

type TailscaleStatus = {
  Peer?: Record<string, TailscalePeer>;
};

type AppsCacheRecord = { checkedAt: number; payload: AppsPayload };

let appsCache: AppsCacheRecord | null = null;
let appsInFlight: Promise<AppsPayload> | null = null;
let appsCacheGeneration = 0;

async function readDiskAppsCache() {
  try {
    const parsed = JSON.parse(await readFile(APPS_CACHE_FILE, "utf8")) as Partial<AppsCacheRecord>;
    if (!parsed || typeof parsed.checkedAt !== "number" || parsed.payload?.ok !== true || !Array.isArray(parsed.payload.apps)) {
      return null;
    }
    return { checkedAt: parsed.checkedAt, payload: parsed.payload };
  } catch {
    return null;
  }
}

async function writeDiskAppsCache(record: AppsCacheRecord) {
  await mkdir(dirname(APPS_CACHE_FILE), { recursive: true });
  await writeFile(APPS_CACHE_FILE, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

function rememberAppsPayload(payload: AppsPayload) {
  appsCache = { checkedAt: Date.now(), payload };
  void writeDiskAppsCache(appsCache).catch(() => undefined);
}

type AppKind = "ai" | "creative" | "code" | "dashboard" | "media" | "service" | "app";

const PLUMBING_PROCESSES = [
  "syncthing",
  "cloudflar",
  "cloudflare",
  "nginx",
  "tailscale",
  "container",
  "lmlink",
  "rapportd",
  "sharingd",
];

const PLUMBING_TITLES = [
  "welcome to nginx",
  "error",
  "404",
  "not found",
  "unauthorized",
  "syncthing",
  "gateway",
];

const KNOWN_APP_TITLES = [
  "comfyui",
  "z-image",
  "openclaw",
  "claw code",
  "hivemindos",
  "miroshark",
  "moneyprinter",
  "ai girlfriend",
  "ami",
];

const BRAND_ICON_SLUGS: Array<[RegExp, string]> = [
  [/github/i, "github"],
  [/discord/i, "discord"],
  [/openai|llm|ai/i, "openai"],
];

const LOCAL_APP_ICONS: Array<[RegExp, string]> = [
  [/hivemindos/i, "/hivemindos-logo.png"],
  [/openclaw/i, "/icons/runtimes/openclaw.svg"],
  [/miroshark/i, "/icons/miroshark.png"],
];

const APP_ICON_FALLBACKS: Array<[RegExp, string]> = [
  [/comfyui/i, "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/comfyui.svg"],
];

function normalizeBaseUrl(value?: string) {
  return value?.trim().replace(/\/+$/, "") || "";
}

function collectorAppsUrl(collectorUrl: string, forceRefresh: boolean) {
  return `${collectorUrl}/apps${forceRefresh ? "?refresh=1" : ""}`;
}

function normalizePath(value?: string) {
  const path = value?.trim() || "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function routeUrl(apiBaseUrl: string, path: string) {
  return `${apiBaseUrl.replace(/\/+$/, "")}${normalizePath(path)}`;
}

function routeCategory(path: string) {
  const normalized = normalizePath(path);
  if (normalized === "/health" || normalized.includes("openapi") || normalized.includes("/docs")) return "Core";
  if (normalized.startsWith("/api/templates")) return "Templates";
  if (normalized.startsWith("/api/graph")) return "Graph";
  if (normalized.startsWith("/api/report")) return "Reports";
  if (normalized.includes("/observability")) return "Observability";
  if (normalized.includes("/settings") || normalized.includes("/mcp")) return "Config";
  if (normalized.includes("/simulation/") && /\.(json|jsonl|csv|md|txt|png|gif|svg|ipynb)$/i.test(normalized)) return "Exports";
  if (normalized.startsWith("/api/simulation")) return "Simulations";
  return "API";
}

function knownServiceByKind(serviceKind?: string) {
  const normalized = serviceKind?.trim().toLowerCase();
  if (!normalized) return null;
  return KNOWN_SERVICE_SIGNATURES.find((signature) => signature.serviceKind === normalized) ?? null;
}

function routeFromSpec(apiBaseUrl: string, spec: ServiceRouteSpec, source: ServiceRoute["source"]): ServiceRoute {
  const path = normalizePath(spec.path);
  return {
    method: spec.method.toUpperCase(),
    path,
    url: routeUrl(apiBaseUrl, path),
    category: spec.category || routeCategory(path),
    summary: spec.summary,
    source,
  };
}

function dedupeServiceRoutes(routes: ServiceRoute[]) {
  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = `${route.method}:${route.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function routeSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as { summary?: unknown; description?: unknown; operationId?: unknown };
  const text = record.summary || record.description || record.operationId;
  return typeof text === "string" ? text.trim().split("\n")[0]?.slice(0, 180) : undefined;
}

function parseOpenApiJsonRoutes(apiBaseUrl: string, payload: unknown): ServiceRoute[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const paths = (payload as { paths?: unknown }).paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) return [];
  const routes: ServiceRoute[] = [];
  for (const [path, methods] of Object.entries(paths)) {
    if (!path.startsWith("/") || !methods || typeof methods !== "object" || Array.isArray(methods)) continue;
    for (const [method, operation] of Object.entries(methods)) {
      if (!/^(get|post|put|patch|delete)$/i.test(method)) continue;
      routes.push({
        method: method.toUpperCase(),
        path,
        url: routeUrl(apiBaseUrl, path),
        category: routeCategory(path),
        summary: routeSummary(operation),
        source: "openapi",
      });
    }
  }
  return dedupeServiceRoutes(routes).slice(0, SERVICE_ROUTE_LIMIT);
}

function parseOpenApiYamlRoutes(apiBaseUrl: string, text: string): ServiceRoute[] {
  const routes: ServiceRoute[] = [];
  let currentPath = "";
  let currentRouteIndex = -1;
  for (const line of text.split("\n")) {
    const pathMatch = line.match(/^ {2}(\/[^:]+):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1] ?? "";
      currentRouteIndex = -1;
      continue;
    }
    const methodMatch = line.match(/^ {4}(get|post|put|patch|delete):\s*$/i);
    if (methodMatch && currentPath) {
      routes.push({
        method: methodMatch[1]?.toUpperCase() ?? "GET",
        path: currentPath,
        url: routeUrl(apiBaseUrl, currentPath),
        category: routeCategory(currentPath),
        source: "openapi",
      });
      currentRouteIndex = routes.length - 1;
      continue;
    }
    const summaryMatch = line.match(/^ {6}summary:\s*["']?(.+?)["']?\s*$/);
    if (summaryMatch && currentRouteIndex >= 0) {
      routes[currentRouteIndex] = {
        ...routes[currentRouteIndex],
        summary: summaryMatch[1]?.trim().slice(0, 180),
      };
    }
  }
  return dedupeServiceRoutes(routes).slice(0, SERVICE_ROUTE_LIMIT);
}

async function discoverOpenApiRoutes(apiBaseUrl: string): Promise<ServiceRoute[]> {
  for (const path of OPENAPI_CATALOG_PATHS) {
    try {
      const response = await fetch(routeUrl(apiBaseUrl, path), {
        cache: "no-store",
        signal: AbortSignal.timeout(SERVICE_ROUTE_CATALOG_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const text = await response.text();
      const trimmed = text.trim();
      const routes = trimmed.startsWith("{")
        ? parseOpenApiJsonRoutes(apiBaseUrl, JSON.parse(trimmed))
        : parseOpenApiYamlRoutes(apiBaseUrl, trimmed);
      if (routes.length > 0) return routes;
    } catch {
      continue;
    }
  }
  return [];
}

async function serviceRouteCatalog(apiBaseUrl: string, serviceKind?: string): Promise<{ routes: ServiceRoute[]; source: ServiceRoute["source"] } | null> {
  const openApiRoutes = await discoverOpenApiRoutes(apiBaseUrl);
  if (openApiRoutes.length > 0) return { routes: openApiRoutes, source: "openapi" };

  const known = knownServiceByKind(serviceKind);
  if (!known?.routes.length) return null;
  return {
    routes: known.routes.map((route) => routeFromSpec(apiBaseUrl, route, "hivemind")),
    source: "hivemind",
  };
}

function dnsHost(value?: string) {
  return value?.trim().replace(/\.$/, "") || "";
}

function machineOpenHost(machine: FleetMachine) {
  if (isLocalMachine(machine)) return "localhost";
  return dnsHost(machine.device?.dnsName) || machine.collectorHost || machine.device?.ip || "";
}

function isLocalMachine(machine: FleetMachine) {
  return Boolean(machine.device?.self);
}

function serviceUrl(app: CollectorApp, machine: FleetMachine) {
  const scheme = app.scheme === "https" ? "https" : "http";
  const port = Number(app.port);
  const host = machineOpenHost(machine);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return "";
  return `${scheme}://${host}:${port}${normalizePath(app.path)}`;
}

function rewriteServiceAssetUrl(rawUrl: string | undefined, machine: FleetMachine) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    url.hostname = machineOpenHost(machine);
    return url.toString();
  } catch {
    return "";
  }
}

function rewriteCollectorUrl(rawUrl: string | undefined, collectorUrl: string) {
  if (!rawUrl || !collectorUrl) return "";
  try {
    const raw = new URL(rawUrl);
    const collector = new URL(collectorUrl);
    raw.protocol = collector.protocol;
    raw.host = collector.host;
    const collectorPrefix = collector.pathname.replace(/\/+$/, "");
    if (collectorPrefix && collectorPrefix !== "/" && raw.pathname.startsWith("/")) {
      raw.pathname = `${collectorPrefix}${raw.pathname}`;
    }
    return raw.toString();
  } catch {
    return "";
  }
}

function appOriginUrl(openUrl: string) {
  try {
    const url = new URL(openUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function dashboardIconProxyUrl(url: string) {
  return `/api/fleet/app-icon?url=${encodeURIComponent(url)}`;
}

async function isImageUrl(url: string) {
  if (!url) return false;
  try {
    const isCollectorAsset = /\/app-assets\//.test(url);
    let response = await fetch(url, {
      method: isCollectorAsset ? "GET" : "HEAD",
      headers: isCollectorAsset ? { range: "bytes=0-512" } : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(ICON_PROBE_TIMEOUT_MS),
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        headers: { range: "bytes=0-512" },
        cache: "no-store",
        signal: AbortSignal.timeout(ICON_PROBE_TIMEOUT_MS),
      });
    }
    const contentType = response.headers.get("content-type") || "";
    return response.ok && (
      contentType.startsWith("image/")
      || ((contentType === "" || contentType === "application/octet-stream") && /\.(?:ico|png|svg|webp|jpg|jpeg)(?:\?|$)/i.test(url))
    );
  } catch {
    return false;
  }
}

async function discoverDirectAppIcon(openUrl: string) {
  const origin = appOriginUrl(openUrl);
  if (!origin) return "";
  const candidates = [
    "/apple-touch-icon.png",
    "/favicon.png",
    "/favicon.ico",
    "/icon.png",
    "/assets/images/favicon.png",
    "/assets/images/icon.png",
    "/assets/icons/claude-sprite-icon.png",
  ].map((path) => `${origin}${path}`);
  for (const candidate of candidates) {
    if (await isImageUrl(candidate)) return candidate;
  }
  return "";
}

async function firstReachableIcon(urls: Array<string | undefined>) {
  for (const url of urls) {
    if (url && await isImageUrl(url)) return url;
  }
  return "";
}

function appName(app: CollectorApp, port: number) {
  return cleanAppName(app.name?.trim() || app.process?.trim() || `App ${port}`);
}

function cleanAppName(value: string) {
  return value
    .replace(/\s+on\s+\d+$/i, "")
    .replace(/\s+[–-]\s+gateway$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMachineName(value: string) {
  return value
    .replace(/^hivemindos-/i, "")
    .replace(/-local-\d+$/i, "")
    .replace(/-local$/i, "")
    .replace(/-\d+$/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || value;
}

function appKind(name: string): AppKind {
  const value = name.toLowerCase();
  if (/miroshark|api service/.test(value)) return "service";
  if (/comfy|z-image|image|studio|canvas|design/.test(value)) return "creative";
  if (/claw|openclaw|code|hivemind/.test(value)) return "code";
  if (/llm|ai|ami|chat|girlfriend/.test(value)) return "ai";
  if (/money|video|printer|media/.test(value)) return "media";
  if (/dashboard|control|admin/.test(value)) return "dashboard";
  return "app";
}

function appTheme(kind: AppKind) {
  if (kind === "creative") return "from-[#ff8a3d] via-[#ff4d6d] to-[#7c3aed]";
  if (kind === "code") return "from-[#22c55e] via-[#14b8a6] to-[#2563eb]";
  if (kind === "ai") return "from-[#38bdf8] via-[#6366f1] to-[#a855f7]";
  if (kind === "media") return "from-[#facc15] via-[#fb7185] to-[#f97316]";
  if (kind === "dashboard") return "from-[#2dd4bf] via-[#0ea5e9] to-[#334155]";
  if (kind === "service") return "from-[#14b8a6] via-[#0f766e] to-[#164e63]";
  return "from-[#94a3b8] via-[#64748b] to-[#334155]";
}

function appInitials(name: string) {
  const words = name.replace(/[^a-z0-9 ]/gi, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] || "A").slice(0, 2)).toUpperCase();
}

function brandFallbackIconUrl(name: string) {
  const localMatch = LOCAL_APP_ICONS.find(([pattern]) => pattern.test(name));
  if (localMatch) return localMatch[1];
  const appMatch = APP_ICON_FALLBACKS.find(([pattern]) => pattern.test(name));
  if (appMatch) return appMatch[1];
  const value = name;
  const match = BRAND_ICON_SLUGS.find(([pattern]) => pattern.test(value));
  return match ? `https://cdn.simpleicons.org/${match[1]}/ffffff` : "";
}

function hasKnownAppSignal(name: string, app: CollectorApp) {
  const value = `${name} ${app.process || ""} ${app.server || ""}`.toLowerCase();
  return KNOWN_APP_TITLES.some((token) => value.includes(token));
}

function isPlumbingApp(name: string, app: CollectorApp) {
  const value = `${name} ${app.process || ""} ${app.server || ""}`.toLowerCase();
  if (hasKnownAppSignal(name, app)) return false;
  if (PLUMBING_PROCESSES.some((token) => value.includes(token))) return true;
  return PLUMBING_TITLES.some((token) => name.toLowerCase().includes(token));
}

function isInteractiveApp(name: string, app: CollectorApp) {
  const statusCode = Number(app.statusCode ?? app.description?.match(/^(\d+)/)?.[1] ?? 0);
  const contentType = (app.contentType || app.description || "").toLowerCase();
  if (statusCode >= 400) return false;
  if (hasKnownAppSignal(name, app) && contentType.includes("text/html")) return true;
  return contentType.includes("text/html") && !isPlumbingApp(name, app);
}

function appDescription(kind: AppKind, machineName: string) {
  if (kind === "service") return `API service on ${machineName}`;
  if (kind === "creative") return `Creative workspace on ${machineName}`;
  if (kind === "code") return `Development workspace on ${machineName}`;
  if (kind === "ai") return `AI workspace on ${machineName}`;
  if (kind === "media") return `Media workspace on ${machineName}`;
  if (kind === "dashboard") return `Control surface on ${machineName}`;
  return `App on ${machineName}`;
}

function shouldProbeHealthSignature(name: string, app: CollectorApp) {
  if (app.serviceKind || app.healthPath) return true;
  if (KNOWN_SERVICE_SIGNATURES.some((signature) => signature.defaultPorts.includes(Number(app.port)))) return true;
  const value = `${name} ${app.description || ""} ${app.process || ""} ${app.server || ""}`.toLowerCase();
  return value.includes("404") || value.includes("not found") || value.includes("backend") || value.includes("api");
}

function healthServiceName(payload: ServiceHealthPayload | null) {
  const value = payload?.service || payload?.name || payload?.app || payload?.application;
  return typeof value === "string" ? value.trim() : "";
}

function healthStatus(payload: ServiceHealthPayload | null) {
  const value = payload?.status || payload?.state || payload?.ok;
  if (typeof value === "boolean") return value ? "ok" : "error";
  return typeof value === "string" ? value.trim() : "";
}

function knownServiceFromHealth(payload: ServiceHealthPayload | null) {
  const haystack = `${healthServiceName(payload)} ${JSON.stringify(payload ?? {})}`;
  return KNOWN_SERVICE_SIGNATURES.find((signature) => signature.matches.test(haystack)) ?? null;
}

function healthPathsForApp(app: CollectorApp) {
  const paths = [
    app.healthPath,
    ...KNOWN_SERVICE_SIGNATURES
      .filter((signature) => signature.defaultPorts.includes(Number(app.port)))
      .flatMap((signature) => signature.healthPaths),
    "/health",
  ].filter((path): path is string => Boolean(path));
  return [...new Set(paths.map(normalizePath))];
}

async function probeHealthSignature(input: {
  app: CollectorApp;
  name: string;
  proxyUrl: string;
  apiProxyUrl: string;
  healthProxyUrl: string;
}): Promise<ServiceSignature | null> {
  if (!shouldProbeHealthSignature(input.name, input.app)) return null;
  const apiBaseUrl = input.apiProxyUrl || input.proxyUrl.replace(/\/+$/, "");
  if (!apiBaseUrl) return null;
  const healthPaths = input.healthProxyUrl ? [new URL(input.healthProxyUrl).pathname] : healthPathsForApp(input.app);
  for (const healthPath of healthPaths) {
    const healthUrl = input.healthProxyUrl || `${apiBaseUrl}${normalizePath(healthPath)}`;
    try {
      const response = await fetch(healthUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(SERVICE_SIGNATURE_TIMEOUT_MS),
      });
      const payload = await response.json().catch(() => null) as ServiceHealthPayload | null;
      const service = healthServiceName(payload);
      const status = healthStatus(payload);
      const known = knownServiceFromHealth(payload);
      if (!response.ok || (!service && !known)) continue;
      const name = known?.displayName || service;
      return {
        name,
        description: status ? `API service · ${status}` : `API service · HTTP ${response.status}`,
        serviceKind: known?.serviceKind || "api",
        healthPath,
        healthUrl,
        apiBaseUrl,
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function toHostedApp(app: CollectorApp, machine: FleetMachine, collectorUrl: string): Promise<HostedApp | null> {
  const port = Number(app.port);
  const proxyUrl = rewriteCollectorUrl(app.proxyUrl, collectorUrl);
  const apiProxyUrl = rewriteCollectorUrl(app.apiProxyUrl, collectorUrl);
  const healthProxyUrl = rewriteCollectorUrl(app.healthProxyUrl, collectorUrl);
  const directServiceUrl = serviceUrl(app, machine);
  const openUrl = proxyUrl || directServiceUrl;
  if (!openUrl || !Number.isInteger(port)) return null;
  const machineName = normalizeMachineName(machine.device?.name || machine.collectorHost || machine.device?.ip || "Unknown machine");
  const fallbackName = appName(app, port);
  const signature = await probeHealthSignature({ app, name: fallbackName, proxyUrl, apiProxyUrl, healthProxyUrl });
  const name = signature?.name || fallbackName;
  const interactive = signature ? false : app.interactive ?? isInteractiveApp(name, app);
  const serviceKind = signature?.serviceKind || app.serviceKind?.trim();
  const healthPath = signature?.healthPath || app.healthPath;
  if (!interactive && !serviceKind && !healthPath) return null;
  const kind = appKind(name);
  const local = isLocalMachine(machine);
  const collectorIconUrl = rewriteCollectorUrl(app.iconUrl, collectorUrl) || rewriteServiceAssetUrl(app.iconUrl, machine);
  const iconUrl = /\/app-assets\//.test(collectorIconUrl)
    ? dashboardIconProxyUrl(collectorIconUrl)
    : await firstReachableIcon([
      collectorIconUrl,
      await discoverDirectAppIcon(openUrl),
    ]) || brandFallbackIconUrl(name) || undefined;
  const apiBaseUrl = signature?.apiBaseUrl || apiProxyUrl || proxyUrl.replace(/\/+$/, "") || appOriginUrl(directServiceUrl);
  const routes = !interactive ? await serviceRouteCatalog(apiBaseUrl, serviceKind) : null;
  return {
    id: `${local ? "local" : machineOpenHost(machine)}:${port}:${app.id || name}`,
    name,
    sourceName: app.name?.trim() || "",
    description: signature?.description || appDescription(kind, machineName),
    kind,
    theme: appTheme(kind),
    initials: appInitials(name),
    iconUrl,
    machineName,
    machineHost: machineOpenHost(machine),
    local,
    online: machine.device?.online !== false,
    interactive,
    serviceKind,
    scheme: app.scheme === "https" ? "https" : "http",
    port,
    path: normalizePath(app.path),
    openUrl,
    apiBaseUrl,
    healthUrl: signature?.healthUrl || healthProxyUrl || (healthPath ? `${apiBaseUrl}${normalizePath(healthPath)}` : undefined),
    apiRoutes: routes?.routes,
    apiRoutesSource: routes?.source,
  };
}

async function hostedAppFromHealth(input: {
  collectorUrl: string;
  healthUrl: string;
  ip: string;
  port: number;
  machineName?: string;
  health: ServiceHealthPayload;
}): Promise<HostedApp | null> {
  const known = knownServiceFromHealth(input.health);
  const service = healthServiceName(input.health);
  if (!known && !service) return null;
  const name = known?.displayName || service;
  const serviceKind = known?.serviceKind || "api";
  const machineName = normalizeMachineName(input.machineName || `${name} host ${input.ip}`);
  const kind = appKind(name);
  const apiBaseUrl = input.healthUrl.replace(/\/health\/?$/i, "");
  const routes = await serviceRouteCatalog(apiBaseUrl, serviceKind);
  return {
    id: `${input.ip}:${input.port}:${name}`,
    name,
    sourceName: name,
    description: healthStatus(input.health) ? `API service · ${healthStatus(input.health)}` : "API service · ok",
    kind,
    theme: appTheme(kind),
    initials: appInitials(name),
    iconUrl: brandFallbackIconUrl(name) || undefined,
    machineName,
    machineHost: input.ip,
    local: false,
    online: true,
    interactive: false,
    serviceKind,
    scheme: "http",
    port: input.port,
    path: "/",
    openUrl: `${input.collectorUrl}/app-proxy/${input.port}/`,
    apiBaseUrl,
    healthUrl: input.healthUrl,
    apiRoutes: routes?.routes,
    apiRoutesSource: routes?.source,
  };
}

async function toKnownServiceHostedApp(app: CollectorApp, machine: FleetMachine, collectorUrl: string): Promise<HostedApp | null> {
  const hosted = await toHostedApp(app, machine, collectorUrl);
  if (hosted) return hosted;
  const port = Number(app.port);
  const proxyUrl = rewriteCollectorUrl(app.proxyUrl, collectorUrl);
  const directServiceUrl = serviceUrl(app, machine);
  const openUrl = proxyUrl || directServiceUrl;
  if (!openUrl || !Number.isInteger(port)) return null;
  const apiBaseUrl = openUrl.replace(/\/+$/, "");
  for (const healthPath of healthPathsForApp(app)) {
    const healthUrl = `${apiBaseUrl}${healthPath}`;
    const health = await fetchJsonOrNull<ServiceHealthPayload>(healthUrl, SERVICE_SIGNATURE_TIMEOUT_MS);
    const known = knownServiceFromHealth(health);
    if (!health || !known) continue;
    const machineName = normalizeMachineName(machine.device?.name || machine.collectorHost || machine.device?.ip || "Unknown machine");
    const kind = appKind(known.displayName);
    const local = isLocalMachine(machine);
    const routes = await serviceRouteCatalog(apiBaseUrl, known.serviceKind);
    return {
      id: `${local ? "local" : machineOpenHost(machine)}:${port}:${app.id || known.displayName}`,
      name: known.displayName,
      sourceName: app.name?.trim() || "",
      description: healthStatus(health) ? `API service · ${healthStatus(health)}` : "API service · ok",
      kind,
      theme: appTheme(kind),
      initials: appInitials(known.displayName),
      iconUrl: brandFallbackIconUrl(known.displayName) || undefined,
      machineName,
      machineHost: machineOpenHost(machine),
      local,
      online: machine.device?.online !== false,
      interactive: false,
      serviceKind: known.serviceKind,
      scheme: app.scheme === "https" ? "https" : "http",
      port,
      path: normalizePath(app.path),
      openUrl,
      apiBaseUrl,
      healthUrl,
      apiRoutes: routes?.routes,
      apiRoutesSource: routes?.source,
    };
  }
  return null;
}

function dedupeVisibleApps(apps: HostedApp[]) {
  const byNameAndMachine = new Map<string, HostedApp>();
  const score = (app: HostedApp) => (
    (/gateway/i.test(app.sourceName || "") ? -100 : 0)
    + (app.iconUrl ? 10 : 0)
    + (app.local ? 2 : 0)
  );
  const iconScore = (app: HostedApp) => (
    (app.iconUrl ? 10 : 0)
    + (/gateway/i.test(app.sourceName || "") ? 30 : 0)
  );
  for (const app of apps) {
    const key = `${app.machineName.toLowerCase()}:${app.name.toLowerCase()}`;
    const previous = byNameAndMachine.get(key);
    if (!previous || score(app) > score(previous) || (score(app) === score(previous) && app.openUrl.length < previous.openUrl.length)) {
      const iconSource = previous && iconScore(previous) > iconScore(app) ? previous : app;
      byNameAndMachine.set(key, { ...app, iconUrl: iconSource.iconUrl || app.iconUrl });
      continue;
    }
    if (iconScore(app) > iconScore(previous)) {
      byNameAndMachine.set(key, { ...previous, iconUrl: app.iconUrl || previous.iconUrl });
    }
  }
  return [...byNameAndMachine.values()];
}

async function healthyCachedKnownServiceApps() {
  const cached = appsCache?.payload.apps.filter((app) => app.serviceKind && app.healthUrl) ?? [];
  const checks = await Promise.all(cached.map(async (app) => {
    const health = await fetchJsonOrNull<ServiceHealthPayload>(
      app.healthUrl ?? "",
      SERVICE_SIGNATURE_TIMEOUT_MS,
    );
    const known = knownServiceFromHealth(health);
    return known && known.serviceKind === app.serviceKind ? app : null;
  }));
  return checks.filter((app): app is HostedApp => Boolean(app));
}

async function fetchJson<T>(url: string, timeoutMs = COLLECTOR_TIMEOUT_MS): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

async function fetchJsonOrNull<T>(url: string, timeoutMs = HIVEMIND_LINK_APP_TIMEOUT_MS): Promise<T | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

function configuredPeerIps() {
  return (process.env.HIVEMIND_LINK_APP_PEERS || "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value));
}

async function tailscalePeerIps() {
  const explicit = configuredPeerIps();
  if (explicit.length > 0) return explicit;
  for (const command of TAILSCALE_CLI_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(command, ["status", "--json"], {
        encoding: "utf8",
        timeout: TAILSCALE_STATUS_TIMEOUT_MS,
        maxBuffer: 1_000_000,
      });
      const status = JSON.parse(stdout) as TailscaleStatus;
      return Object.values(status.Peer ?? {})
        .filter((peer) => peer?.Online)
        .flatMap((peer) => peer?.TailscaleIPs ?? [])
        .filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
    } catch {
      continue;
    }
  }
  return [];
}

function peerCollectorUrls(ip: string, collectorPort: number) {
  const linkBase = hivemindLinkControlUrl();
  const peer = encodeURIComponent(`${ip}:${collectorPort}`);
  return [
    { collectorUrl: `http://${ip}:${collectorPort}`, collector: "tailnet-direct" },
    { collectorUrl: `${linkBase}/peer/${peer}`, collector: "hivemind-link" },
  ];
}

function discoveredPeerIps(machines: FleetMachine[]) {
  return machines
    .flatMap((machine) => [machine.device?.ip, machine.collectorHost])
    .map((value) => value?.trim() ?? "")
    .filter((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value));
}

async function probeKnownServiceHealthApps(machines: FleetMachine[]): Promise<{ name: string; collector: string; apps: HostedApp[] }[]> {
  const candidates = machines.flatMap((machine) => {
    const ip = machine.device?.ip?.trim();
    if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip) || machine.device?.self) return [];
    const collectorUrls = [
      normalizeBaseUrl(machine.device?.collectorUrl),
      ...HIVEMIND_LINK_COLLECTOR_PORTS.map((port) => `http://${ip}:${port}`),
    ].filter(Boolean);
    return [...new Set(collectorUrls)].flatMap((collectorUrl) => (
      KNOWN_SERVICE_SIGNATURES.flatMap((signature) => (
        signature.defaultPorts.flatMap((port) => (
          signature.healthPaths.map(async (healthPath) => {
            const healthUrl = `${collectorUrl}/app-proxy/${port}${normalizePath(healthPath)}`;
            const health = await fetchJsonOrNull<ServiceHealthPayload>(healthUrl, SERVICE_SIGNATURE_TIMEOUT_MS);
            if (!health || !knownServiceFromHealth(health)) return null;
            const app = await hostedAppFromHealth({
              collectorUrl,
              healthUrl,
              ip,
              port,
              machineName: machine.device?.name,
              health,
            });
            return app ? { name: machine.device?.name ?? ip, collector: "tailnet-health", apps: [app] } : null;
          })
        ))
      ))
    ));
  });
  return (await Promise.all(candidates)).filter((result): result is { name: string; collector: string; apps: HostedApp[] } => Boolean(result));
}

async function readPeerKnownServiceApps(forceRefresh: boolean, machines: FleetMachine[]): Promise<{ name: string; collector: string; apps: HostedApp[]; error?: string }[]> {
  const peers = [...new Set([...discoveredPeerIps(machines), ...await tailscalePeerIps()])];
  const probes = peers.flatMap((ip) => (
    HIVEMIND_LINK_COLLECTOR_PORTS.flatMap((collectorPort) => peerCollectorUrls(ip, collectorPort).map(async ({ collectorUrl, collector }) => {
      const payload = await fetchJsonOrNull<{ apps?: CollectorApp[] }>(collectorAppsUrl(collectorUrl, forceRefresh));
      const serviceApps = (payload?.apps ?? []).filter((app) => (
        KNOWN_SERVICE_SIGNATURES.some((signature) => signature.defaultPorts.includes(Number(app.port)))
        || app.healthPath
        || app.serviceKind
      ));
      if (serviceApps.length === 0) return null;
      const machine: FleetMachine = {
        collector: "ready",
        collectorHost: ip,
        device: {
          self: false,
          name: `Hivenet app host ${ip}`,
          ip,
          online: true,
          collectorUrl,
        },
      };
      const apps = await Promise.all(serviceApps.map((app) => toKnownServiceHostedApp(app, machine, collectorUrl)));
      const visibleApps = apps.filter((app): app is HostedApp => Boolean(app));
      return visibleApps.length > 0 ? { name: machine.device?.name ?? ip, collector, apps: visibleApps } : null;
    }))
  ));
  return (await Promise.all(probes)).filter((result): result is { name: string; collector: string; apps: HostedApp[] } => Boolean(result));
}

async function readApps(request: NextRequest): Promise<AppsPayload> {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const fleetUrl = new URL("/api/fleet/discover", request.url);
  fleetUrl.searchParams.set("includeSnapshots", "0");
  if (forceRefresh) {
    fleetUrl.searchParams.set("fresh", "1");
  }
  let fleet: { source?: string; machines?: FleetMachine[] } = {};
  let fleetError = "";
  try {
    fleet = await fetchJson<{ source?: string; machines?: FleetMachine[] }>(
      fleetUrl.toString(),
      forceRefresh ? 12_000 : COLLECTOR_TIMEOUT_MS,
    );
  } catch (error) {
    fleetError = error instanceof Error ? error.message : "Fleet discovery did not return apps.";
  }
  const machines = fleet.machines ?? [];
  const results = await Promise.all(machines.map(async (machine) => {
    const collectorUrl = normalizeBaseUrl(machine.device?.collectorUrl);
    const name = machine.device?.name || machine.collectorHost || machine.device?.ip || "Unknown machine";
    if (machine.collector !== "ready" || !collectorUrl) {
      return { name, collector: machine.collector || "missing", apps: [] as HostedApp[] };
    }
    try {
      const payload = await fetchJson<{ apps?: CollectorApp[] }>(collectorAppsUrl(collectorUrl, forceRefresh));
      const apps = await Promise.all((payload.apps ?? []).map((app) => toHostedApp(app, machine, collectorUrl)));
      return {
        name,
        collector: machine.collector,
        apps: apps.filter((app): app is HostedApp => Boolean(app)),
      };
    } catch (error) {
      return {
        name,
        collector: machine.collector,
        apps: [] as HostedApp[],
        error: error instanceof Error ? error.message : "Agent bridge did not return apps.",
      };
    }
  }));

  const linkResults = results.some((result) => result.apps.some((app) => app.serviceKind && app.healthUrl))
    ? []
    : await readPeerKnownServiceApps(forceRefresh, machines);

  const allResults = [
    ...results,
    ...linkResults,
    ...await probeKnownServiceHealthApps(machines),
  ];
  let apps = dedupeVisibleApps(allResults.flatMap((result) => result.apps))
    .sort((left, right) => Number(right.local) - Number(left.local) || left.machineName.localeCompare(right.machineName) || left.port - right.port);
  if (!apps.some((app) => app.serviceKind && app.healthUrl)) {
    apps = dedupeVisibleApps([...apps, ...await healthyCachedKnownServiceApps()])
      .sort((left, right) => Number(right.local) - Number(left.local) || left.machineName.localeCompare(right.machineName) || left.port - right.port);
  }
  const machineResults = allResults.map((result) => ({
    name: result.name,
    collector: result.collector,
    appCount: result.apps.length,
    error: "error" in result && typeof result.error === "string" ? result.error : undefined,
  }));
  if (fleetError) {
    machineResults.unshift({
      name: "Fleet discovery",
      collector: "error",
      appCount: 0,
      error: fleetError,
    });
  }

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    source: fleet.source || (fleetError ? "peer-service-fallback" : "fleet-discover"),
    apps,
    machines: machineResults,
  };
}

export async function GET(request: NextRequest) {
  const now = Date.now();
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  if (!forceRefresh && !appsCache) {
    appsCache = await readDiskAppsCache();
  }
  if (!forceRefresh && appsCache && now - appsCache.checkedAt < APPS_CACHE_MS) {
    return Response.json(appsCache.payload);
  }
  if (!forceRefresh && appsCache && now - appsCache.checkedAt < APPS_STALE_MS) {
    const stalePayload = appsCache.payload;
    if (!appsInFlight) {
      const generation = appsCacheGeneration;
      appsInFlight = readApps(request)
        .then((payload) => {
          if (generation === appsCacheGeneration) {
            rememberAppsPayload(payload);
          }
          return payload;
        })
        .catch(() => stalePayload)
        .finally(() => {
          appsInFlight = null;
        });
    }
    return Response.json(stalePayload);
  }
  if (forceRefresh) {
    appsCacheGeneration += 1;
    const generation = appsCacheGeneration;
    const payload = await readApps(request);
    if (generation === appsCacheGeneration) {
      rememberAppsPayload(payload);
    }
    return Response.json(payload);
  }
  if (!appsInFlight) {
    const generation = appsCacheGeneration;
    appsInFlight = readApps(request)
      .then((payload) => {
        if (generation === appsCacheGeneration) {
          rememberAppsPayload(payload);
        }
        return payload;
      })
      .finally(() => {
        appsInFlight = null;
      });
  }
  return Response.json(await appsInFlight);
}
