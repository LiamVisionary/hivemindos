import { NextRequest, NextResponse } from "next/server";
import { createFusionSkill } from "@/lib/services/fusion/fusion-skill";
import type { ContextConnectedApp } from "@/lib/services/context-index";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function connectedAppsFromAppsView(request: NextRequest) {
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      prompt?: string;
      vaultPath?: string;
      includeConnectedApps?: boolean;
    };
    const result = await createFusionSkill({
      prompt: body.prompt ?? "",
      vaultPath: body.vaultPath,
      connectedApps: body.includeConnectedApps === false ? undefined : await connectedAppsFromAppsView(request),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not create fusion skill.",
    }, { status: 400 });
  }
}
