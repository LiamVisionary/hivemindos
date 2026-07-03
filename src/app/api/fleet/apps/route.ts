import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { promisify } from "util";
import {
  dedupeVisibleApps,
  normalizeAppsPayload,
  peerPortalToTailnetUrl,
  pinPeerAppProxyUrl,
} from "../apps-normalize";
import { fetchServiceProbe } from "../apps-service-probe";
import { hivemindLinkControlUrl } from "@/lib/services/hivemind-link-control";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

export const runtime = "nodejs";

const APPS_CACHE_MS = 60_000;
const APPS_CACHE_FILE = join(homedir(), ".hivemindos", "fleet-apps-cache.json");
const COLLECTOR_TIMEOUT_MS = 4_500;
const ICON_PROBE_TIMEOUT_MS = 2_500;
const SERVICE_SIGNATURE_TIMEOUT_MS = 2_500;
const HIVEMIND_LINK_APP_TIMEOUT_MS = 4_000;
const TAILSCALE_STATUS_TIMEOUT_MS = 3_000;
const HIVEMIND_LINK_COLLECTOR_PORTS = Array.from(
  { length: 24 },
  (_, index) => 8787 + index,
);
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
  runningTasks?: ServiceRunningTask[];
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

type ServiceRunningTask = {
  id: string;
  title: string;
  status: string;
  startedAt?: string;
  updatedAt?: string;
  progressPercent?: number;
  currentRound?: number;
  totalRounds?: number;
  detail?: string;
  potentiallyStuck?: boolean;
  stuckReason?: string;
  canCancel?: boolean;
  canKill?: boolean;
  source?: string;
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
  Self?: TailscalePeer;
  Peer?: Record<string, TailscalePeer>;
};

type AppsCacheRecord = { checkedAt: number; payload: AppsPayload };

type AppTaskActionBody = {
  action?: "cancel-task" | "kill-task";
  appId?: string;
  taskId?: string;
};

type MachineResult = {
  name: string;
  collector: string;
  apps: HostedApp[];
  error?: string;
};

let appsCache: AppsCacheRecord | null = null;
let appsInFlight: Promise<AppsPayload> | null = null;
let appsCacheGeneration = 0;

type AppDiscoveryMode = "fast" | "full";

// Older caches also stored cross-machine URLs minted before the linkd tailnet
// door was pinned :8787 — direct collector-port bases (e.g. ip:8792, now
// localhost-scoped and refused from the tailnet) and /peer/ identities
// carrying that dead port. The dedupe merge re-elects cached entries over
// fresh ones (richer score, shorter-URL tie-break) and writes them back to
// disk, so a dead base self-renews forever unless healed on read
// (2026-07-03: NYC universal-tts stuck on ip:8792 → false watchdog alerts).
function repairCachedAppUrls(app: HostedApp): HostedApp {
  if (app.local) return app;
  const apiUrl = (value?: string) =>
    pinPeerAppProxyUrl(peerPortalToTailnetUrl(value)) || undefined;
  return {
    ...app,
    // openUrl keeps its /peer/ portal shape (browser HTML rewriting); only
    // the embedded port is healed.
    openUrl: pinPeerAppProxyUrl(app.openUrl) || app.openUrl,
    apiBaseUrl: apiUrl(app.apiBaseUrl) || app.apiBaseUrl,
    healthUrl: apiUrl(app.healthUrl),
    apiRoutes: app.apiRoutes?.map((route) => ({
      ...route,
      url: apiUrl(route.url) || route.url,
    })),
  };
}

// Older caches stored raw icon values (relative hrefs, unproxied remote URLs)
// that cannot render from the dashboard origin; rewrap or drop them so the
// icon-keeping dedupe logic never resurrects a broken icon over a fresh one.
function sanitizeCachedApps(apps: HostedApp[]) {
  return apps.map(repairCachedAppUrls).map((app) => {
    const rawIconUrl = app.iconUrl || "";
    let decodedIconUrl = rawIconUrl;
    try {
      decodedIconUrl = decodeURIComponent(rawIconUrl);
    } catch {
      // keep the raw value
    }
    // simple-icons removed the openai slug, so cached URLs pointing at it 404
    const legacyDeadIcon = /cdn\.simpleicons\.org\/openai\//.test(
      decodedIconUrl,
    );
    const sanitized = legacyDeadIcon ? "" : appIconDisplayUrl(rawIconUrl);
    return {
      ...app,
      iconUrl:
        sanitized || bundledAppIconUrl(app.name, app.serviceKind) || undefined,
    };
  });
}

async function readDiskAppsCache() {
  try {
    const parsed = JSON.parse(
      await readFile(APPS_CACHE_FILE, "utf8"),
    ) as Partial<AppsCacheRecord>;
    if (
      !parsed ||
      typeof parsed.checkedAt !== "number" ||
      parsed.payload?.ok !== true ||
      !Array.isArray(parsed.payload.apps)
    ) {
      return null;
    }
    const payload = {
      ...parsed.payload,
      apps: sanitizeCachedApps(parsed.payload.apps),
    };
    return {
      checkedAt: parsed.checkedAt,
      payload: normalizeAppsPayload(payload),
    };
  } catch {
    return null;
  }
}

async function writeDiskAppsCache(record: AppsCacheRecord) {
  await mkdir(dirname(APPS_CACHE_FILE), { recursive: true });
  await writeFile(APPS_CACHE_FILE, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function rememberAppsPayload(payload: AppsPayload) {
  appsCache = { checkedAt: Date.now(), payload };
  void writeDiskAppsCache(appsCache).catch(() => undefined);
}

function sortHostedApps(apps: HostedApp[]) {
  return apps.sort(
    (left, right) =>
      Number(right.local) - Number(left.local) ||
      left.machineName.localeCompare(right.machineName) ||
      left.port - right.port,
  );
}

function mergeMachineResults(
  current: AppsPayload["machines"],
  cached: AppsPayload["machines"],
) {
  const byName = new Map<string, AppsPayload["machines"][number]>();
  for (const machine of cached) {
    byName.set(machine.name, machine);
  }
  for (const machine of current) {
    const previous = byName.get(machine.name);
    byName.set(
      machine.name,
      !previous || machine.appCount >= previous.appCount ? machine : previous,
    );
  }
  return [...byName.values()];
}

function cachedAppMerge(payload: AppsPayload): AppsPayload {
  const cached = appsCache?.payload;
  if (!cached?.apps.length || cached.apps.length <= payload.apps.length)
    return payload;
  const apps = sortHostedApps(
    dedupeVisibleApps([...payload.apps, ...cached.apps]),
  );
  return normalizeAppsPayload({
    ...payload,
    source: `${payload.source}:cached-merge`,
    apps,
    machines: mergeMachineResults(payload.machines, cached.machines),
  });
}

function isSparsePayload(payload: AppsPayload) {
  const readyMachines = payload.machines.filter(
    (machine) => machine.collector === "ready",
  ).length;
  return payload.apps.length <= 1 && readyMachines > 1;
}

function payloadWithRefreshError(
  payload: AppsPayload,
  error: unknown,
): AppsPayload {
  const message =
    error instanceof Error ? error.message : "Fleet app refresh failed.";
  return {
    ...payload,
    source: `${payload.source}:stale-after-error`,
    machines: [
      {
        name: "Fleet app refresh",
        collector: "error",
        appCount: 0,
        error: message,
      },
      ...payload.machines,
    ],
  };
}

type AppKind =
  | "ai"
  | "creative"
  | "code"
  | "dashboard"
  | "media"
  | "service"
  | "app";

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

const BRAND_ICON_SLUGS: Array<[RegExp, string]> = [
  [/github/i, "github"],
  [/discord/i, "discord"],
];

// Icons shipped in public/ for hive services that expose no favicon of their own
const BUNDLED_APP_ICONS: Array<[RegExp, string]> = [
  [/miroshark/i, "/icons/miroshark.png"],
  [/queen bee/i, "/icons/queen-bee.png"],
  [/hivemindos/i, "/icon-512.png"],
];

function bundledAppIconUrl(name: string, serviceKind?: string) {
  const value = `${name} ${serviceKind || ""}`;
  const match = BUNDLED_APP_ICONS.find(([pattern]) => pattern.test(value));
  return match ? match[1] : "";
}

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
  if (
    normalized === "/health" ||
    normalized.includes("openapi") ||
    normalized.includes("/docs")
  )
    return "Core";
  if (normalized.startsWith("/api/templates")) return "Templates";
  if (normalized.startsWith("/api/graph")) return "Graph";
  if (normalized.startsWith("/api/report")) return "Reports";
  if (normalized.includes("/observability")) return "Observability";
  if (normalized.includes("/settings") || normalized.includes("/mcp"))
    return "Config";
  if (
    normalized.includes("/simulation/") &&
    /\.(json|jsonl|csv|md|txt|png|gif|svg|ipynb)$/i.test(normalized)
  )
    return "Exports";
  if (normalized.startsWith("/api/simulation")) return "Simulations";
  return "API";
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
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as {
    summary?: unknown;
    description?: unknown;
    operationId?: unknown;
  };
  const text = record.summary || record.description || record.operationId;
  return typeof text === "string"
    ? text.trim().split("\n")[0]?.slice(0, 180)
    : undefined;
}

function parseOpenApiJsonRoutes(
  apiBaseUrl: string,
  payload: unknown,
): ServiceRoute[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [];
  const paths = (payload as { paths?: unknown }).paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) return [];
  const routes: ServiceRoute[] = [];
  for (const [path, methods] of Object.entries(paths)) {
    if (
      !path.startsWith("/") ||
      !methods ||
      typeof methods !== "object" ||
      Array.isArray(methods)
    )
      continue;
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

function parseOpenApiYamlRoutes(
  apiBaseUrl: string,
  text: string,
): ServiceRoute[] {
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

async function discoverOpenApiRoutes(
  apiBaseUrl: string,
): Promise<ServiceRoute[]> {
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

async function serviceRouteCatalog(
  apiBaseUrl: string,
  serviceKind?: string,
): Promise<{ routes: ServiceRoute[]; source: ServiceRoute["source"] } | null> {
  const openApiRoutes = await discoverOpenApiRoutes(apiBaseUrl);
  if (openApiRoutes.length > 0)
    return { routes: openApiRoutes, source: "openapi" };
  void serviceKind;
  return null;
}

async function serviceRunningTasks(
  apiBaseUrl: string,
  serviceKind?: string,
): Promise<ServiceRunningTask[]> {
  void apiBaseUrl;
  void serviceKind;
  return [];
}

function dnsHost(value?: string) {
  return value?.trim().replace(/\.$/, "") || "";
}

function machineOpenHost(machine: FleetMachine) {
  if (isLocalMachine(machine)) return "localhost";
  return (
    dnsHost(machine.device?.dnsName) ||
    machine.collectorHost ||
    machine.device?.ip ||
    ""
  );
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

function rewriteServiceAssetUrl(
  rawUrl: string | undefined,
  machine: FleetMachine,
) {
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
    if (
      collectorPrefix &&
      collectorPrefix !== "/" &&
      raw.pathname.startsWith("/")
    ) {
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

function appIconDisplayUrl(url: string) {
  if (!url) return "";
  if (
    url.startsWith("data:image/") ||
    url.startsWith("/api/") ||
    BUNDLED_APP_ICONS.some(([, bundledPath]) => bundledPath === url)
  ) {
    return url;
  }
  return /^https?:\/\//i.test(url) ? dashboardIconProxyUrl(url) : "";
}

function textFromHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlMetaContent(html: string, name: string) {
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  return textFromHtml(html.match(pattern)?.[1] ?? "");
}

function htmlTitle(html: string) {
  return textFromHtml(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "");
}

function htmlFaviconHref(html: string) {
  const links = (html.match(/<link\b[^>]*>/gi) ?? []).filter((tag) =>
    /\brel=["'][^"']*icon[^"']*["']/i.test(tag),
  );
  const rank = (tag: string) =>
    /apple-touch-icon/i.test(tag)
      ? 0
      : /\.(?:svg|png|webp)\b/i.test(tag)
        ? 1
        : 2;
  const best = links.sort((a, b) => rank(a) - rank(b))[0];
  return best?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? "";
}

function resolveIconHref(href: string | undefined, baseUrl: string) {
  if (!href) return "";
  if (href.startsWith("data:image/")) return href;
  try {
    const resolved = new URL(href, baseUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : "";
  } catch {
    return "";
  }
}

function isGenericAppName(name: string, port: number) {
  const value = name.toLowerCase();
  return (
    value === `app ${port}` ||
    /^(node|python|docker|container|nginx|http|api)(?: api| service)?$/i.test(
      name,
    ) ||
    /\bon\s+\d+$/.test(value)
  );
}

async function discoverAppMetadata(openUrl: string) {
  try {
    const response = await fetch(openUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(SERVICE_SIGNATURE_TIMEOUT_MS),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().includes("text/html"))
      return null;
    const html = await response.text();
    return {
      title: htmlTitle(html),
      description:
        htmlMetaContent(html, "description") ||
        htmlMetaContent(html, "og:description"),
      iconUrl: resolveIconHref(htmlFaviconHref(html), openUrl),
    };
  } catch {
    return null;
  }
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
    return (
      response.ok &&
      (contentType.startsWith("image/") ||
        ((contentType === "" || contentType === "application/octet-stream") &&
          /\.(?:ico|png|svg|webp|jpg|jpeg)(?:\?|$)/i.test(url)))
    );
  } catch {
    return false;
  }
}

function directAppIconCandidates(openUrl: string) {
  // Resolve against the app's base path, not the host origin — proxied apps
  // live under paths like /app-proxy/<port>/ where the origin is the collector.
  let base: URL;
  try {
    base = new URL(openUrl);
  } catch {
    return [];
  }
  if (!base.pathname.endsWith("/")) base.pathname = `${base.pathname}/`;
  return [
    "/apple-touch-icon.png",
    "/apple-touch-icon-precomposed.png",
    "/favicon.svg",
    "/favicon.png",
    "/favicon.ico",
    "/icon.png",
    "/icon.svg",
    "/logo.png",
    "/logo.svg",
    "/static/favicon.png",
    "/static/favicon.ico",
    "/assets/images/favicon.png",
    "/assets/images/icon.png",
    "/assets/icons/claude-sprite-icon.png",
  ].map((path) => new URL(path.replace(/^\//, ""), base).toString());
}

async function firstReachableIcon(urls: Array<string | undefined>) {
  const candidates = [
    ...new Set(urls.filter((url): url is string => Boolean(url))),
  ];
  const checks = await Promise.all(
    candidates.map(async (url) =>
      url.startsWith("data:image/") || (await isImageUrl(url)) ? url : "",
    ),
  );
  return checks.find(Boolean) || "";
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
  return (
    value
      .replace(/^hivemindos-/i, "")
      .replace(/-local-\d+$/i, "")
      .replace(/-local$/i, "")
      .replace(/-\d+$/i, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
      .trim() || value
  );
}

function appKind(name: string): AppKind {
  const value = name.toLowerCase();
  if (/api service|\bapi\b|backend|server/.test(value)) return "service";
  if (/image|studio|canvas|design|generative|creative/.test(value))
    return "creative";
  if (/code|dev|editor|workspace|runtime/.test(value)) return "code";
  if (/\bai\b|llm|chat|assistant|agent/.test(value)) return "ai";
  if (/money|video|printer|media|audio|photo/.test(value)) return "media";
  if (/dashboard|control|admin|console|portal/.test(value)) return "dashboard";
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
  const words = name
    .replace(/[^a-z0-9 ]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  return (
    words.length > 1
      ? `${words[0][0]}${words[1][0]}`
      : (words[0] || "A").slice(0, 2)
  ).toUpperCase();
}

function brandFallbackIconUrl(name: string) {
  const value = name;
  const match = BRAND_ICON_SLUGS.find(([pattern]) => pattern.test(value));
  return match ? `https://cdn.simpleicons.org/${match[1]}/ffffff` : "";
}

function isPlumbingApp(name: string, app: CollectorApp) {
  const value =
    `${name} ${app.process || ""} ${app.server || ""}`.toLowerCase();
  if (PLUMBING_PROCESSES.some((token) => value.includes(token))) return true;
  return PLUMBING_TITLES.some((token) => name.toLowerCase().includes(token));
}

function isInteractiveApp(name: string, app: CollectorApp) {
  const statusCode = Number(
    app.statusCode ?? app.description?.match(/^(\d+)/)?.[1] ?? 0,
  );
  const contentType = (app.contentType || app.description || "").toLowerCase();
  if (statusCode >= 400) return false;
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
  const value =
    `${name} ${app.description || ""} ${app.process || ""} ${app.server || ""}`.toLowerCase();
  return (
    value.includes("404") ||
    value.includes("not found") ||
    value.includes("backend") ||
    value.includes("api")
  );
}

function healthServiceName(payload: ServiceHealthPayload | null) {
  const value =
    payload?.service || payload?.name || payload?.app || payload?.application;
  return typeof value === "string" ? value.trim() : "";
}

function healthStatus(payload: ServiceHealthPayload | null) {
  const value = payload?.status || payload?.state || payload?.ok;
  if (typeof value === "boolean") return value ? "ok" : "error";
  return typeof value === "string" ? value.trim() : "";
}

function healthPathsForApp(app: CollectorApp) {
  const paths = [app.healthPath, "/health"].filter((path): path is string =>
    Boolean(path),
  );
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
  const healthPaths = input.healthProxyUrl
    ? [new URL(input.healthProxyUrl).pathname]
    : healthPathsForApp(input.app);
  for (const healthPath of healthPaths) {
    const healthUrl =
      input.healthProxyUrl || `${apiBaseUrl}${normalizePath(healthPath)}`;
    try {
      const probe = await fetchServiceProbe(
        healthUrl,
        SERVICE_SIGNATURE_TIMEOUT_MS,
      );
      const payload = probe?.payload ?? null;
      const service = healthServiceName(payload);
      const status = healthStatus(payload);
      if (!probe || !service) continue;
      return {
        name: service,
        description: status
          ? `API service · ${status}`
          : "API service · reachable",
        serviceKind: input.app.serviceKind?.trim() || "api",
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

async function toHostedApp(
  app: CollectorApp,
  machine: FleetMachine,
  collectorUrl: string,
  mode: AppDiscoveryMode = "full",
): Promise<HostedApp | null> {
  const port = Number(app.port);
  const proxyUrl = rewriteCollectorUrl(app.proxyUrl, collectorUrl);
  const apiProxyUrl = rewriteCollectorUrl(app.apiProxyUrl, collectorUrl);
  const healthProxyUrl = rewriteCollectorUrl(app.healthProxyUrl, collectorUrl);
  // API-facing URLs must be reachable fleet-wide. A /peer/<host:port> portal
  // base only resolves through this machine's linkd control port, so unwrap
  // it to the peer's own tailnet door for apiBaseUrl/healthUrl. openUrl keeps
  // the portal, whose HTML rewriting the in-browser flow depends on.
  const apiProxyTailnetUrl = peerPortalToTailnetUrl(apiProxyUrl);
  const healthProxyTailnetUrl = peerPortalToTailnetUrl(healthProxyUrl);
  const proxyTailnetUrl = peerPortalToTailnetUrl(proxyUrl);
  const directServiceUrl = serviceUrl(app, machine);
  const openUrl = proxyUrl || directServiceUrl;
  if (!openUrl || !Number.isInteger(port)) return null;
  const machineName = normalizeMachineName(
    machine.device?.name ||
      machine.collectorHost ||
      machine.device?.ip ||
      "Unknown machine",
  );
  const fallbackName = appName(app, port);
  const signature =
    mode === "full"
      ? await probeHealthSignature({
          app,
          name: fallbackName,
          proxyUrl: proxyTailnetUrl,
          apiProxyUrl: apiProxyTailnetUrl,
          healthProxyUrl: healthProxyTailnetUrl,
        })
      : null;
  const metadata = mode === "full" ? await discoverAppMetadata(openUrl) : null;
  const name =
    signature?.name ||
    (metadata?.title && isGenericAppName(fallbackName, port)
      ? metadata.title
      : fallbackName);
  const interactive =
    app.interactive ??
    (isInteractiveApp(name, app) || Boolean(metadata?.title));
  const serviceKind = signature?.serviceKind || app.serviceKind?.trim();
  const healthPath = signature?.healthPath || app.healthPath;
  if (!interactive && !serviceKind && !healthPath) return null;
  const kind = appKind(name);
  const local = isLocalMachine(machine);
  const collectorIconUrl =
    rewriteCollectorUrl(app.iconUrl, collectorUrl) ||
    rewriteServiceAssetUrl(app.iconUrl, machine);
  const discoveredIconUrl =
    mode === "fast"
      ? collectorIconUrl ||
        bundledAppIconUrl(name, serviceKind) ||
        brandFallbackIconUrl(name)
      : /\/app-assets\//.test(collectorIconUrl)
        ? collectorIconUrl
        : (await firstReachableIcon([
            collectorIconUrl,
            metadata?.iconUrl,
            ...directAppIconCandidates(openUrl),
          ])) ||
          bundledAppIconUrl(name, serviceKind) ||
          brandFallbackIconUrl(name) ||
          metadata?.iconUrl ||
          "";
  const iconUrl = appIconDisplayUrl(discoveredIconUrl) || undefined;
  const apiBaseUrl =
    signature?.apiBaseUrl ||
    apiProxyTailnetUrl ||
    proxyTailnetUrl.replace(/\/+$/, "") ||
    appOriginUrl(directServiceUrl);
  const routes =
    mode === "full" ? await serviceRouteCatalog(apiBaseUrl, serviceKind) : null;
  const runningTasks =
    mode === "full" ? await serviceRunningTasks(apiBaseUrl, serviceKind) : [];
  return {
    id: `${local ? "local" : machineOpenHost(machine)}:${port}:${app.id || name}`,
    name,
    sourceName: app.name?.trim() || "",
    description:
      signature?.description ||
      metadata?.description ||
      appDescription(kind, machineName),
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
    healthUrl:
      signature?.healthUrl ||
      healthProxyTailnetUrl ||
      (healthPath ? `${apiBaseUrl}${normalizePath(healthPath)}` : undefined),
    apiRoutes: routes?.routes,
    apiRoutesSource: routes?.source,
    runningTasks: runningTasks.length ? runningTasks : undefined,
  };
}

async function safeHostedApp(
  app: CollectorApp,
  machine: FleetMachine,
  collectorUrl: string,
  mode: AppDiscoveryMode,
) {
  try {
    return await toHostedApp(app, machine, collectorUrl, mode);
  } catch {
    return null;
  }
}

async function fetchJson<T>(
  url: string,
  timeoutMs = COLLECTOR_TIMEOUT_MS,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

async function fetchJsonOrNull<T>(
  url: string,
  timeoutMs = HIVEMIND_LINK_APP_TIMEOUT_MS,
): Promise<T | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
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
      const selfPeers = status.Self ? [status.Self] : [];
      const peers = [...selfPeers, ...Object.values(status.Peer ?? {})];
      return peers
        .filter((peer) => peer === status.Self || peer?.Online)
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
    {
      collectorUrl: `http://${ip}:${collectorPort}`,
      collector: "tailnet-direct",
    },
    { collectorUrl: `${linkBase}/peer/${peer}`, collector: "hivemind-link" },
  ];
}

function discoveredPeerIps(machines: FleetMachine[]) {
  return machines
    .flatMap((machine) => [machine.device?.ip, machine.collectorHost])
    .map((value) => value?.trim() ?? "")
    .filter((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value));
}

async function readPeerCollectorApps(
  forceRefresh: boolean,
  machines: FleetMachine[],
  mode: AppDiscoveryMode,
): Promise<MachineResult[]> {
  const peers = [
    ...new Set([...discoveredPeerIps(machines), ...(await tailscalePeerIps())]),
  ];
  const probes = peers.flatMap((ip) =>
    HIVEMIND_LINK_COLLECTOR_PORTS.flatMap((collectorPort) =>
      peerCollectorUrls(ip, collectorPort).map(
        async ({ collectorUrl, collector }) => {
          const payload = await fetchJsonOrNull<{ apps?: CollectorApp[] }>(
            collectorAppsUrl(collectorUrl, forceRefresh),
          );
          const collectorApps = payload?.apps ?? [];
          if (collectorApps.length === 0) return null;
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
          const apps = await Promise.all(
            collectorApps.map((app) =>
              safeHostedApp(app, machine, collectorUrl, mode),
            ),
          );
          const visibleApps = apps.filter((app): app is HostedApp =>
            Boolean(app),
          );
          return visibleApps.length > 0
            ? { name: machine.device?.name ?? ip, collector, apps: visibleApps }
            : null;
        },
      ),
    ),
  );
  return (await Promise.all(probes)).filter(
    (
      result,
    ): result is { name: string; collector: string; apps: HostedApp[] } =>
      Boolean(result),
  );
}

async function readApps(
  request: NextRequest,
  mode: AppDiscoveryMode = "full",
): Promise<AppsPayload> {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const forceCollectors = forceRefresh && mode === "full";
  const fleetUrl = new URL("/api/fleet/discover", request.url);
  fleetUrl.searchParams.set("includeSnapshots", "0");
  if (forceCollectors) {
    fleetUrl.searchParams.set("fresh", "1");
  }
  let fleet: { source?: string; machines?: FleetMachine[] } = {};
  let fleetError = "";
  try {
    // Self-fetch of our own /api/fleet/discover: needs the server's device
    // token since the API auth gate moved to src/proxy.ts. Collector fetches
    // stay tokenless — the device token must not leak to non-dashboard hosts.
    fleet = await fetchJson<{ source?: string; machines?: FleetMachine[] }>(
      fleetUrl.toString(),
      forceCollectors ? 12_000 : COLLECTOR_TIMEOUT_MS,
      internalApiAuthHeaders(),
    );
  } catch (error) {
    fleetError =
      error instanceof Error
        ? error.message
        : "Fleet discovery did not return apps.";
  }
  const machines = fleet.machines ?? [];
  const results: MachineResult[] = await Promise.all(
    machines.map(async (machine) => {
      const collectorUrl = normalizeBaseUrl(machine.device?.collectorUrl);
      const name =
        machine.device?.name ||
        machine.collectorHost ||
        machine.device?.ip ||
        "Unknown machine";
      if (machine.collector !== "ready" || !collectorUrl) {
        return {
          name,
          collector: machine.collector || "missing",
          apps: [] as HostedApp[],
        };
      }
      try {
        const payload = await fetchJson<{ apps?: CollectorApp[] }>(
          collectorAppsUrl(collectorUrl, forceCollectors),
        );
        const apps = await Promise.all(
          (payload.apps ?? []).map((app) =>
            safeHostedApp(app, machine, collectorUrl, mode),
          ),
        );
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
          error:
            error instanceof Error
              ? error.message
              : "Agent bridge did not return apps.",
        };
      }
    }),
  );

  const linkResults = await readPeerCollectorApps(forceRefresh, machines, mode);

  const allResults = [...results, ...linkResults];
  let apps = sortHostedApps(
    dedupeVisibleApps(allResults.flatMap((result) => result.apps)),
  );
  if (appsCache?.payload.apps.length)
    apps = sortHostedApps(
      dedupeVisibleApps([...apps, ...appsCache.payload.apps]),
    );
  const machineResults = allResults.map((result) => ({
    name: result.name,
    collector: result.collector,
    appCount: result.apps.length,
    error:
      "error" in result && typeof result.error === "string"
        ? result.error
        : undefined,
  }));
  if (fleetError) {
    machineResults.unshift({
      name: "Fleet discovery",
      collector: "error",
      appCount: 0,
      error: fleetError,
    });
  }

  return cachedAppMerge(
    normalizeAppsPayload({
      ok: true,
      checkedAt: new Date().toISOString(),
      source:
        fleet.source ||
        (fleetError ? "peer-service-fallback" : "fleet-discover"),
      apps,
      machines: machineResults,
    }),
  );
}

export async function GET(request: NextRequest) {
  const now = Date.now();
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const mode: AppDiscoveryMode =
    request.nextUrl.searchParams.get("fast") === "1" ? "fast" : "full";
  const waitForRefresh = request.nextUrl.searchParams.get("wait") === "1";
  if (!appsCache) appsCache = await readDiskAppsCache();
  if (
    forceRefresh &&
    mode === "fast" &&
    !waitForRefresh &&
    appsCache &&
    !isSparsePayload(appsCache.payload)
  ) {
    if (!appsInFlight) {
      const generation = appsCacheGeneration;
      appsInFlight = readApps(request, "fast")
        .then((payload) => {
          if (generation === appsCacheGeneration) {
            rememberAppsPayload(payload);
          }
          return payload;
        })
        .catch(() => appsCache!.payload)
        .finally(() => {
          appsInFlight = null;
        });
    }
    return Response.json(appsCache.payload);
  }
  if (!forceRefresh && appsCache && now - appsCache.checkedAt < APPS_CACHE_MS) {
    return Response.json(appsCache.payload);
  }
  // Any usable cache serves immediately with a background revalidation —
  // a full discovery can take 10s+ across the tailnet, and blocking a read
  // on it makes every client (dashboard, phone launcher) hang. Only a
  // sparse snapshot (discovery misfire) or an explicit refresh=1 waits for
  // live results.
  if (!forceRefresh && appsCache && !isSparsePayload(appsCache.payload)) {
    const stalePayload = appsCache.payload;
    if (!appsInFlight) {
      const generation = appsCacheGeneration;
      appsInFlight = readApps(request, mode)
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
    let payload: AppsPayload;
    try {
      payload = await readApps(request, mode);
    } catch (error) {
      const fallbackCache = appsCache ?? (await readDiskAppsCache());
      if (fallbackCache)
        return Response.json(
          payloadWithRefreshError(fallbackCache.payload, error),
        );
      throw error;
    }
    if (generation === appsCacheGeneration) {
      rememberAppsPayload(payload);
    }
    return Response.json(payload);
  }
  if (!appsInFlight) {
    const generation = appsCacheGeneration;
    appsInFlight = readApps(request, mode)
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

export async function POST(request: NextRequest) {
  const body = (await request
    .json()
    .catch(() => null)) as AppTaskActionBody | null;
  const action = body?.action;
  const appId = body?.appId?.trim();
  const taskId = body?.taskId?.trim();
  if (action !== "cancel-task" && action !== "kill-task") {
    return Response.json(
      { ok: false, error: "Unsupported app task action." },
      { status: 400 },
    );
  }
  if (!appId || !taskId) {
    return Response.json(
      { ok: false, error: "appId and taskId are required." },
      { status: 400 },
    );
  }
  return Response.json(
    {
      ok: false,
      action,
      appId,
      taskId,
      error:
        "Managed app task actions require the app to publish a generic task-control endpoint.",
    },
    { status: 400 },
  );
}
