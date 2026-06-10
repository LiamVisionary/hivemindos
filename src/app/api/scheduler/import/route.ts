import { NextRequest, NextResponse } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { getRuntimeAdapter, runtimeSupports, type RuntimeSchedule } from "@/lib/services/runtime-adapters/registry";
import { canonicalLocalCollectorUrl } from "@/lib/services/local-collector-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { agents?: AgentProfile[] };
  const agents = Array.isArray(body.agents) ? body.agents : [];
  const schedules: RuntimeSchedule[] = [];
  const errors: string[] = [];

  const scheduleAgents = agents.filter((agent) => runtimeSupports(agent.runtime, "schedules"));
  const adapterResults = await Promise.all(scheduleAgents.map((agent) => importAdapterSchedules(agent, request)));
  for (const result of adapterResults) {
    schedules.push(...result.schedules);
    errors.push(...result.errors);
  }

  const collectorUrls = [...new Set((await Promise.all(agents
    .filter((agent) => !runtimeSupports(agent.runtime, "schedules") && agent.telemetryUrl?.trim())
    .map((agent) => canonicalLocalCollectorUrl(agent))))
    .filter(Boolean))];
  const collectorResults = await Promise.all(collectorUrls.map(importCollectorSchedules));
  for (const result of collectorResults) {
    schedules.push(...result.schedules);
    errors.push(...result.errors);
  }

  return NextResponse.json({
    ok: true,
    schedules,
    errors,
    sources: {
      adapters: scheduleAgents.map((agent) => agent.runtime),
      collectors: collectorUrls.length,
    },
  });
}

async function importAdapterSchedules(agent: AgentProfile, request: NextRequest): Promise<{ schedules: RuntimeSchedule[]; errors: string[] }> {
  const adapter = getRuntimeAdapter(agent.runtime);
  if (!adapter?.listSchedules) return { schedules: [], errors: [] };
  try {
    return { schedules: await adapter.listSchedules(agent, { requestUrl: request.url, agents: [agent] }), errors: [] };
  } catch (error) {
    return { schedules: [], errors: [error instanceof Error ? error.message : `${adapter.label} schedule adapter failed`] };
  }
}

async function importCollectorSchedules(baseUrl: string): Promise<{ schedules: RuntimeSchedule[]; errors: string[] }> {
  try {
    const response = await fetch(`${baseUrl}/schedules`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const data = await response.json().catch(() => null) as { ok?: boolean; schedules?: RuntimeSchedule[]; error?: string } | null;
    if (!response.ok || !data?.ok) return { schedules: [], errors: [data?.error ?? `${baseUrl} schedule agent bridge unavailable`] };
    return { schedules: data.schedules ?? [], errors: [] };
  } catch (error) {
    return { schedules: [], errors: [error instanceof Error ? error.message : `${baseUrl} schedule import failed`] };
  }
}
