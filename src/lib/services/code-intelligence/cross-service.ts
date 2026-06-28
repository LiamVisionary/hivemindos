// Cross-service route linking (the "system intelligence" seam).
//
// The code-graph engine only knows about code (Next API routes). HivemindOS
// stitches in the surfaces it already knows: Hive actions / MCP tools and their
// backing routes, and connected-app (fleet) endpoints. This is what makes
// queries like "which routes expose wallet execution?" answerable from the
// architecture view, not just "what functions exist".

import { listHiveActions } from "@/lib/services/hive-actions";
import type { ArchitectureRoute } from "./types";

/** Capability routes exposed via Hive actions / MCP tools (deduped, in-process). */
export function hiveActionRoutes(): ArchitectureRoute[] {
  const seen = new Map<string, ArchitectureRoute>();
  for (const action of listHiveActions()) {
    const route = action.contextIndex?.route;
    if (!route) continue;
    const methods = action.contextIndex?.methods?.length ? action.contextIndex.methods : ["POST"];
    for (const method of methods) {
      const key = `${method} ${route} ${action.id}`;
      if (!seen.has(key)) {
        seen.set(key, { method, path: route, handler: action.id, surface: "hive-action", source: action.mcp?.expose ? "mcp" : "hive-action" });
      }
    }
  }
  return [...seen.values()];
}

type ConnectedAppLike = {
  name?: unknown;
  apiBaseUrl?: unknown;
  openUrl?: unknown;
  machineName?: unknown;
  apiRoutes?: unknown;
};

type ServiceRouteLike = { method?: unknown; path?: unknown; summary?: unknown };

/** Endpoints exposed by connected fleet apps (from /api/fleet/apps). */
export function connectedAppRoutes(apps: unknown): ArchitectureRoute[] {
  if (!Array.isArray(apps)) return [];
  const routes: ArchitectureRoute[] = [];
  for (const raw of apps as ConnectedAppLike[]) {
    const appName = typeof raw?.name === "string" ? raw.name : "app";
    const base = typeof raw?.apiBaseUrl === "string" ? raw.apiBaseUrl : typeof raw?.openUrl === "string" ? raw.openUrl : "";
    const apiRoutes = Array.isArray(raw?.apiRoutes) ? (raw.apiRoutes as ServiceRouteLike[]) : [];
    for (const route of apiRoutes.slice(0, 60)) {
      if (typeof route?.path !== "string") continue;
      routes.push({
        method: typeof route.method === "string" ? route.method : "ANY",
        path: route.path,
        handler: appName,
        surface: "connected-app",
        source: base || appName,
      });
    }
  }
  return routes;
}

/** Merge the code-graph routes with the HivemindOS system surfaces, deduped. */
export function mergeCrossServiceRoutes(base: ArchitectureRoute[], apps?: unknown): ArchitectureRoute[] {
  const merged = new Map<string, ArchitectureRoute>();
  for (const route of [...base, ...hiveActionRoutes(), ...connectedAppRoutes(apps)]) {
    const key = `${route.surface} ${route.method} ${route.path} ${route.handler ?? ""}`;
    if (!merged.has(key)) merged.set(key, route);
  }
  return [...merged.values()];
}
