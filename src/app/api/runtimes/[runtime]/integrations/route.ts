import { NextRequest, NextResponse } from "next/server";
import type { AgentProfile, AgentRuntime } from "@/lib/types/agent-runtime";
import { getRuntimeIntegrationStatus, runRuntimeIntegrationAction } from "@/lib/services/runtime-integrations";
import { runtimeHasAdapter } from "@/lib/services/runtime-adapters/registry";
import { canonicalLocalCollectorUrl, isLocalCollectorUrl, normalizeCollectorUrl } from "@/lib/services/local-collector-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validRuntime(value: string): value is AgentRuntime {
  return runtimeHasAdapter(value);
}

async function proxyCollectorIntegration(runtime: AgentRuntime, collectorUrl: string, body: { agent?: AgentProfile; action?: string; input?: Record<string, unknown> }) {
  const base = normalizeCollectorUrl(collectorUrl);
  const response = await fetch(`${base}/runtimes/${runtime}/integrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Runtime installs (npm/uv, plus a possible uv bootstrap; OpenHands pulls
    // CPython + a large dep tree) can run many minutes; give them a 15-min budget.
    signal: AbortSignal.timeout(body.action === "install-runtime" ? 900_000 : body.action === "hermes-update" ? 330_000 : 30_000),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || data?.ok === false) {
    throw new Error(typeof data?.error === "string" ? data.error : `Remote agent bridge returned HTTP ${response.status}.`);
  }
  return data;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runtime: string }> },
) {
  const { runtime } = await params;
  if (!validRuntime(runtime)) {
    return NextResponse.json({ ok: false, error: `Unknown runtime: ${runtime}` }, { status: 404 });
  }
  const body = await request.json().catch(() => ({})) as { agent?: AgentProfile; action?: string; input?: Record<string, unknown> };
  const collectorUrl = await canonicalLocalCollectorUrl(body.agent);
  if (collectorUrl && !isLocalCollectorUrl(collectorUrl)) {
    try {
      return NextResponse.json(await proxyCollectorIntegration(runtime, collectorUrl, body));
    } catch (error) {
      return NextResponse.json({
        ok: false,
        error: error instanceof Error ? error.message : "Remote runtime integration failed.",
        target: collectorUrl,
      }, { status: 502 });
    }
  }
  if (body.action) {
    try {
      const result = await runRuntimeIntegrationAction(runtime, body.action, body.input ?? {}, body.agent);
      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Runtime action failed." }, { status: 502 });
    }
  }
  try {
    return NextResponse.json({ ok: true, status: await getRuntimeIntegrationStatus(runtime, body.agent) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Runtime integrations failed." }, { status: 502 });
  }
}
