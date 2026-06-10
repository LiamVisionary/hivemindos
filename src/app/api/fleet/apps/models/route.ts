import { NextRequest } from "next/server";

export const runtime = "nodejs";

const MODEL_LIST_TIMEOUT_MS = 6_000;
const FALLBACK_MODEL_PATHS = [
  "/local-ai/models",
  "/api/models",
  "/v1/models",
  "/models",
  "/api/tags",
  "/sdapi/v1/sd-models",
];

type DiscoveredAppRoute = {
  method?: string;
  path?: string;
  summary?: string;
};

type DiscoveredApp = {
  id?: string;
  name?: string;
  apiBaseUrl?: string;
  apiRoutes?: DiscoveredAppRoute[];
};

export type ConnectedAppModel = {
  id: string;
  label: string;
  kind: "image" | "video" | "other";
  source: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function appIdHostPort(value: string) {
  const match = /^(.+):(\d+):(.+)$/.exec(value);
  if (!match) return null;
  return { host: match[1], port: Number(match[2]) };
}

function appMatchesId(app: DiscoveredApp, selectedAppId: string) {
  if (app.id === selectedAppId) return true;
  const selected = appIdHostPort(selectedAppId);
  const candidate = appIdHostPort(clean(app.id));
  return Boolean(selected && candidate && selected.host === candidate.host && selected.port === candidate.port);
}

function modelKind(value: Record<string, unknown>, id: string): ConnectedAppModel["kind"] {
  const typed = `${clean(value.type)} ${clean(value.kind)} ${clean(value.modality)} ${clean(value.task)}`.toLowerCase();
  const haystack = `${typed} ${id.toLowerCase()}`;
  if (/video|img2vid|text2video|t2v|i2v|\bwan\b|\bsvd\b|animatediff|hunyuan-?video|cogvideo/.test(haystack)) return "video";
  if (/image|img|diffusion|flux|sdxl|\bsd\d/.test(haystack) || /txt2img|text2img|dall|imagen|photo/.test(haystack)) return "image";
  return "other";
}

function collectModels(payload: unknown, source: string, output: ConnectedAppModel[], depth = 0) {
  if (!payload || output.length >= 80 || depth > 3) return;
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (typeof entry === "string" && entry.trim()) {
        const id = entry.trim();
        pushModel(output, { id, label: id, kind: modelKind({}, id), source });
      } else if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const id = clean(record.id) || clean(record.model) || clean(record.name) || clean(record.model_name) || clean(record.title) || clean(record.checkpoint);
        if (id) {
          const label = clean(record.name) || clean(record.title) || id;
          pushModel(output, { id, label, kind: modelKind(record, id), source });
        } else {
          collectModels(entry, source, output, depth + 1);
        }
      }
    }
    return;
  }
  if (typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  for (const key of ["models", "data", "items", "results", "checkpoints", "tags", "available"]) {
    if (record[key]) collectModels(record[key], source, output, depth + 1);
  }
}

function pushModel(output: ConnectedAppModel[], model: ConnectedAppModel) {
  if (output.some((entry) => entry.id === model.id)) return;
  output.push(model);
}

function modelListPaths(app: DiscoveredApp) {
  const routePaths = (app.apiRoutes ?? [])
    .filter((route) => {
      const method = clean(route.method || "GET").toUpperCase();
      if (method !== "GET") return false;
      return /\bmodels?\b|\bcheckpoints?\b|\btags\b/.test(`${route.path ?? ""} ${route.summary ?? ""}`.toLowerCase());
    })
    .map((route) => clean(route.path))
    .filter((path) => path.startsWith("/"));
  return [...new Set([...routePaths, ...FALLBACK_MODEL_PATHS])];
}

async function fetchAppList(origin: string): Promise<DiscoveredApp[]> {
  const url = new URL("/api/fleet/apps", origin);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) return [];
  const payload = await response.json().catch(() => null) as { apps?: DiscoveredApp[] } | null;
  return Array.isArray(payload?.apps) ? payload.apps : [];
}

export async function GET(request: NextRequest) {
  const appId = clean(request.nextUrl.searchParams.get("appId"));
  if (!appId) {
    return Response.json({ ok: false, error: "appId is required." }, { status: 400 });
  }
  const apps = await fetchAppList(request.nextUrl.origin);
  const app = apps.find((candidate) => appMatchesId(candidate, appId));
  const baseUrl = clean(app?.apiBaseUrl);
  if (!app || !baseUrl) {
    return Response.json({ ok: false, error: "Connected app with an API base URL was not found.", models: [] }, { status: 404 });
  }
  const models: ConnectedAppModel[] = [];
  for (const path of modelListPaths(app)) {
    if (models.length) break;
    const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    }).catch(() => null);
    if (!response?.ok) continue;
    const payload = await response.json().catch(() => null);
    if (payload) collectModels(payload, path, models);
  }
  return Response.json({
    ok: true,
    appId: app.id ?? appId,
    appName: app.name,
    models,
  });
}
