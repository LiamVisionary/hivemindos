import { NextRequest, NextResponse } from "next/server";
import { searchContextIndex, writeConnectedAppsRagSnapshot, type ContextConnectedApp, type ContextIndexKind } from "@/lib/services/context-index";
import { createContextXrayManifestFromContextIndex } from "@/lib/services/context-xray";
import { importVaultToGbrain, queryGbrain } from "@/lib/services/brain/gbrain";
import type { GBrainConfig } from "@/lib/types/agent-runtime";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import { localAdminPrincipal } from "@/lib/types/principal";
import { verifyAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS = new Set<ContextIndexKind>(["skill", "tool-schema", "api-route", "connected-app", "app-endpoint", "connector", "artifact", "runtime", "doc", "workspace-file", "code-symbol", "code-route", "repo-architecture"]);

function parseKinds(value?: string | null) {
  if (!value) return undefined;
  const kinds = value.split(",").map((kind) => kind.trim()).filter((kind): kind is ContextIndexKind => VALID_KINDS.has(kind as ContextIndexKind));
  return kinds.length ? kinds : undefined;
}

function parseLimit(value: unknown, fallback = 40) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

async function connectedAppsFromExistingAppsView(request: NextRequest, includeConnectedApps: boolean) {
  if (!includeConnectedApps) return undefined;
  const url = new URL("/api/fleet/apps", request.url);
  const response = await fetch(url, {
    cache: "no-store",
    headers: internalApiAuthHeaders(),
    signal: AbortSignal.timeout(7_000),
  }).catch(() => null);
  if (!response?.ok) return undefined;
  const payload = await response.json().catch(() => null) as { apps?: ContextConnectedApp[] } | null;
  return Array.isArray(payload?.apps) ? payload.apps : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    const principal = auth.principal ?? localAdminPrincipal(auth.userId ?? "local-user", "fallback");
    const query = request.nextUrl.searchParams.get("q") ?? undefined;
    const vaultPath = request.nextUrl.searchParams.get("vaultPath") ?? undefined;
    const includeRuntimeProviders = request.nextUrl.searchParams.get("providers") !== "0";
    const connectedApps = await connectedAppsFromExistingAppsView(request, request.nextUrl.searchParams.get("apps") !== "0");
    const result = await searchContextIndex({
      query,
      vaultPath,
      includeRuntimeProviders,
      connectedApps,
      kinds: parseKinds(request.nextUrl.searchParams.get("kinds")),
      limit: parseLimit(request.nextUrl.searchParams.get("limit"), query ? 40 : 80),
      principal,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not build context index." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    const principal = auth.principal ?? localAdminPrincipal(auth.userId ?? "local-user", "fallback");
    const body = await request.json().catch(() => ({})) as {
      query?: string;
      vaultPath?: string;
      kinds?: ContextIndexKind[];
      limit?: number;
      includeRuntimeProviders?: boolean;
      includeConnectedApps?: boolean;
      brainServicesFolder?: string;
      semantic?: boolean;
      syncConnectedAppsToVault?: boolean;
      syncConnectedAppsToGbrain?: boolean;
      gbrain?: Partial<GBrainConfig>;
      gbrainMode?: "search" | "query" | "think";
      contextXray?: boolean;
      runId?: string;
      threadId?: string;
      model?: string;
    };
    const connectedApps = await connectedAppsFromExistingAppsView(request, body.includeConnectedApps !== false);
    const result = await searchContextIndex({
      query: body.query,
      vaultPath: body.vaultPath,
      includeRuntimeProviders: body.includeRuntimeProviders !== false,
      connectedApps,
      kinds: Array.isArray(body.kinds) ? body.kinds.filter((kind) => VALID_KINDS.has(kind)) : undefined,
      limit: parseLimit(body.limit, 40),
      principal,
    });

    const connectedAppsRag = body.syncConnectedAppsToVault || body.syncConnectedAppsToGbrain
      ? await writeConnectedAppsRagSnapshot({
        apps: connectedApps,
        vaultPath: body.vaultPath,
        brainServicesFolder: body.brainServicesFolder,
      })
      : undefined;

    const gbrainSync = body.syncConnectedAppsToGbrain
      ? await importVaultToGbrain({
        vaultPath: body.vaultPath,
        brainServicesFolder: body.brainServicesFolder,
        gbrain: body.gbrain,
      }).then(
        (value) => ({
          ok: value.commands.every((command) => command.ok),
          error: value.commands.every((command) => command.ok) ? undefined : value.status.error || "One or more GBrain import/embed commands failed.",
          commands: value.commands.map((command) => ({
            command: command.command,
            ok: command.ok,
            error: command.error,
            exitCode: command.exitCode,
          })),
        }),
        (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : "GBrain import/embed failed." }),
      )
      : undefined;

    const semantic = body.semantic && body.query?.trim()
      ? await queryGbrain({
        query: body.query,
        vaultPath: body.vaultPath,
        brainServicesFolder: body.brainServicesFolder,
        gbrain: body.gbrain,
        mode: body.gbrainMode ?? "search",
      }).then(
        (value) => value.output
          ? ({ ok: true as const, output: value.output })
          : ({ ok: false as const, error: value.status.error || "GBrain returned no retrieval output." }),
        (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : "GBrain retrieval failed." }),
      )
      : undefined;

    const contextXray = body.contextXray || body.runId || body.threadId
      ? await createContextXrayManifestFromContextIndex({
        runId: body.runId,
        threadId: body.threadId,
        model: body.model,
        query: body.query,
        items: result.items,
      }).then(
        (manifest) => ({
          id: manifest.id,
          sourceCount: manifest.sources.length,
          totalEstimatedTokens: manifest.totalEstimatedTokens,
        }),
        (error: unknown) => ({
          error: error instanceof Error ? error.message : "Context X-Ray capture failed.",
        }),
      )
      : undefined;

    return NextResponse.json({ ok: true, ...result, connectedAppsRag, gbrainSync, semantic, contextXray });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not search context index." }, { status: 400 });
  }
}
