import { NextRequest } from "next/server";

export const runtime = "nodejs";

const REQUEST_TIMEOUT_MS = 120_000;
const ALLOWED_METHODS = new Set(["GET", "POST"]);

type AppRequestBody = {
  appId?: string;
  serviceKind?: string;
  method?: string;
  path?: string;
  body?: unknown;
};

type HostedApp = {
  id?: string;
  name?: string;
  serviceKind?: string;
  apiBaseUrl?: string;
};

function normalizeRequestPath(path: unknown) {
  const value = typeof path === "string" ? path.trim() : "";
  if (!value || !value.startsWith("/") || value.startsWith("//") || /^https?:\/\//i.test(value)) {
    throw new Error("App request path must be a relative path starting with /.");
  }
  return value;
}

function selectedApp(apps: HostedApp[], body: AppRequestBody) {
  const appId = body.appId?.trim();
  const serviceKind = body.serviceKind?.trim().toLowerCase();
  if (appId) return apps.find((app) => app.id === appId);
  if (serviceKind) return apps.find((app) => app.serviceKind?.trim().toLowerCase() === serviceKind);
  return null;
}

async function discoveredApps(origin: string) {
  const url = new URL("/api/fleet/apps?refresh=1&fast=1&wait=1", origin);
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Apps discovery returned ${response.status}.`);
  const payload = await response.json().catch(() => null) as { apps?: HostedApp[] } | null;
  return Array.isArray(payload?.apps) ? payload.apps : [];
}

export async function POST(request: NextRequest) {
  let body: AppRequestBody;
  try {
    body = await request.json() as AppRequestBody;
  } catch {
    return Response.json({ ok: false, error: "Expected JSON body." }, { status: 400 });
  }

  const method = (body.method || "GET").trim().toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return Response.json({ ok: false, error: "Only GET and POST app requests are supported." }, { status: 400 });
  }

  let path: string;
  try {
    path = normalizeRequestPath(body.path);
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Invalid app request path." }, { status: 400 });
  }

  try {
    const apps = await discoveredApps(request.nextUrl.origin);
    const app = selectedApp(apps, body);
    if (!app?.apiBaseUrl) {
      return Response.json({ ok: false, error: "No matching connected app with an API base URL was found." }, { status: 404 });
    }

    const baseUrl = app.apiBaseUrl.replace(/\/+$/, "");
    const url = new URL(`${baseUrl}${path}`);
    const upstream = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
      body: method === "POST" ? JSON.stringify(body.body ?? {}) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const payload = await upstream.arrayBuffer();
    return new Response(payload, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Connected app request failed.",
    }, { status: 502 });
  }
}
