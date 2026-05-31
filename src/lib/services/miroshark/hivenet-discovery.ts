type FleetHostedApp = {
  id?: string;
  name?: string;
  sourceName?: string;
  port?: number;
  openUrl?: string;
  apiBaseUrl?: string;
  healthUrl?: string;
  machineName?: string;
  machineHost?: string;
  local?: boolean;
  interactive?: boolean;
  serviceKind?: string;
};

type FleetAppsPayload = {
  ok?: boolean;
  apps?: FleetHostedApp[];
};

export type DiscoveredMiroSharkService = {
  baseUrl: string;
  healthUrl: string;
  app: FleetHostedApp;
};

function dashboardOrigin(requestUrl?: string) {
  const explicit = process.env.HIVEMINDOS_BASE_URL || process.env.NEXT_PUBLIC_HIVEMINDOS_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit?.trim()) return explicit.trim().replace(/\/+$/, "");
  if (!requestUrl) return "";
  try {
    return new URL(requestUrl).origin;
  } catch {
    return "";
  }
}

function apiBaseForApp(app: FleetHostedApp) {
  const explicit = app.apiBaseUrl?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const openUrl = app.openUrl?.trim();
  if (!openUrl) return "";
  try {
    const url = new URL(openUrl);
    const proxyMatch = url.pathname.match(/^(.*?\/app-proxy\/\d+)/);
    if (proxyMatch) {
      url.pathname = proxyMatch[1];
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    }
    return url.origin;
  } catch {
    return "";
  }
}

function healthUrlForApp(app: FleetHostedApp, baseUrl: string) {
  const explicit = app.healthUrl?.trim();
  if (explicit) return explicit;
  return `${baseUrl.replace(/\/+$/, "")}/health`;
}

function looksLikeMiroSharkApp(app: FleetHostedApp) {
  const haystack = `${app.name || ""} ${app.sourceName || ""} ${app.serviceKind || ""}`.toLowerCase();
  return haystack.includes("miroshark") || Number(app.port) === 5101;
}

async function mirosharkHealthOk(healthUrl: string) {
  const response = await fetch(healthUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(2_500),
  });
  const payload = await response.json().catch(() => null) as { service?: string; status?: string; ok?: boolean } | null;
  const service = String(payload?.service || "");
  const status = String(payload?.status || "");
  return response.ok && /miroshark/i.test(service) && (status === "ok" || payload?.ok === true);
}

export async function discoverMiroSharkHivenetService(requestUrl?: string): Promise<DiscoveredMiroSharkService | null> {
  const origin = dashboardOrigin(requestUrl);
  if (!origin) return null;

  const response = await fetch(`${origin}/api/fleet/apps?refresh=1`, {
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as FleetAppsPayload | null;
  const apps = payload?.apps ?? [];

  for (const app of apps.filter(looksLikeMiroSharkApp)) {
    const baseUrl = apiBaseForApp(app);
    if (!baseUrl) continue;
    const healthUrl = healthUrlForApp(app, baseUrl);
    if (await mirosharkHealthOk(healthUrl).catch(() => false)) {
      return { baseUrl, healthUrl, app };
    }
  }

  return null;
}
