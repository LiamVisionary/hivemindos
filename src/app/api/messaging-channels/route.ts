import { NextRequest, NextResponse } from "next/server";
import {
  deleteMessagingChannel,
  listMessagingChannels,
  type MessagingRuntimeAgent,
  sendHiveMessage,
  upsertMessagingChannel,
} from "@/lib/services/messaging/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const result = await listMessagingChannels(optionsFromRequest(request));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const options = optionsFromRequest(request, body);
    if (body.action === "list") {
      const result = await listMessagingChannels(options);
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "send" || body.action === "test") {
      const result = await sendHiveMessage({
        ...options,
        channelId: String(body.channelId || ""),
        message: body.message || "HivemindOS test message.",
      });
      return NextResponse.json({ ok: true, result });
    }
    const result = await upsertMessagingChannel(body.channel ?? body, options);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const options = optionsFromRequest(request, body);
    const result = await upsertMessagingChannel(body.channel ?? body, options);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const options = optionsFromRequest(request, body);
    const id = request.nextUrl.searchParams.get("id") || body.id;
    const result = await deleteMessagingChannel(String(id || ""), options);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

function optionsFromRequest(request: NextRequest, body?: {
  vaultPath?: string;
  brainServicesFolder?: string;
  includeRuntimeChannels?: boolean;
  agents?: unknown;
}) {
  const includeRuntimeChannels =
    request.nextUrl.searchParams.get("includeRuntimeChannels") === "1"
    || body?.includeRuntimeChannels === true;
  return {
    vaultPath: request.nextUrl.searchParams.get("vaultPath") ?? body?.vaultPath,
    brainServicesFolder: request.nextUrl.searchParams.get("brainServicesFolder") ?? body?.brainServicesFolder,
    includeRuntimeChannels,
    runtimeAgents: includeRuntimeChannels ? normalizeRuntimeAgents(body?.agents) : [],
  };
}

function normalizeRuntimeAgents(value: unknown): MessagingRuntimeAgent[] {
  if (!Array.isArray(value)) return [];
  const agents: MessagingRuntimeAgent[] = [];
  for (const agent of value.slice(0, 160)) {
    if (!agent || typeof agent !== "object" || Array.isArray(agent)) continue;
    const record = agent as Record<string, unknown>;
    const collectorCapabilities = record.collectorCapabilities && typeof record.collectorCapabilities === "object" && !Array.isArray(record.collectorCapabilities)
      ? record.collectorCapabilities as Record<string, unknown>
      : {};
    const runtimes = Array.isArray(collectorCapabilities.runtimes)
      ? collectorCapabilities.runtimes.map(String).filter(Boolean)
      : undefined;
    agents.push({
      id: stringValue(record.id),
      name: stringValue(record.name),
      runtime: stringValue(record.runtime),
      agentId: stringValue(record.agentId),
      localDataDir: stringValue(record.localDataDir),
      machineName: stringValue(record.machineName),
      telemetryUrl: stringValue(record.telemetryUrl),
      collectorCapabilities: runtimes ? { runtimes } : undefined,
    });
  }
  return agents;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Messaging channels request failed.";
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}
