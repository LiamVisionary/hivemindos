import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "@/lib/home-dir";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { readRuntimeChatSession } from "@/lib/services/chat/runtime-session-store";
import { chatTelemetrySession } from "@/lib/services/telemetry/chat-dev-telemetry";
import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";
import { canonicalLocalCollectorUrl } from "@/lib/services/local-collector-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function execSqliteJson<T>(dbPath: string, sql: string, fallback: T): Promise<T> {
  try {
    const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
      timeout: 5_000,
      maxBuffer: 2_000_000,
    });
    return stdout.trim() ? JSON.parse(stdout) as T : fallback;
  } catch {
    return fallback;
  }
}

async function readLocalHermesSession(agent: AgentProfile | undefined, sessionId = "", sinceMs = 0) {
  if (agent?.runtime !== "hermes" || !sessionId.trim()) return null;
  const dbCandidates = [
    agent.localDataDir ? join(agent.localDataDir, "state.db") : "",
    join(homedir(), ".hermes", "state.db"),
  ].filter((value, index, list) => value && list.indexOf(value) === index && existsSync(value));
  for (const dbPath of dbCandidates) {
    const sessionRows = await execSqliteJson<Array<{
      id: string;
      source: string;
      started_at: number;
      ended_at: number | null;
      end_reason: string | null;
      title: string | null;
    }>>(dbPath, `
      select id, source, started_at, ended_at, end_reason, title
      from sessions
      where id = ${sqlString(sessionId)}
      limit 1;
    `, []);
    const session = sessionRows[0];
    if (!session) continue;
    const messages = await execSqliteJson<Array<{
      id: number;
      role: string;
      content: string | null;
      timestamp: number;
    }>>(dbPath, `
      select id, role, content, timestamp
      from messages
      where session_id = ${sqlString(sessionId)}
      order by timestamp asc
      limit 200;
    `, []);
    const mappedMessages = messages
      .filter((message) => typeof message.content === "string" && message.content.trim())
      .map((message) => ({
        role: message.role,
        content: message.content ?? "",
        createdAt: Math.round(Number(message.timestamp || 0) * 1000),
        index: message.id,
      }))
      .filter((message) => !sinceMs || message.createdAt >= sinceMs);
    return {
      sessionId: session.id,
      id: session.id,
      runtime: "hermes",
      source: session.source,
      title: session.title ?? undefined,
      startedAt: Math.round(Number(session.started_at || 0) * 1000),
      updatedAt: Math.round(Number(messages.at(-1)?.timestamp ?? session.ended_at ?? session.started_at ?? 0) * 1000),
      endedAt: session.ended_at ? Math.round(Number(session.ended_at) * 1000) : undefined,
      endReason: session.end_reason ?? undefined,
      messages: mappedMessages,
    };
  }
  return null;
}

function sessionMatchesRequest(session: { chatStorageKey?: unknown; id?: unknown; sessionId?: unknown } | null | undefined, sessionId = "", chatStorageKey = "") {
  if (!session) return false;
  if (sessionId) return [session.sessionId, session.id].some((value) => String(value ?? "") === sessionId);
  return !chatStorageKey || String(session.chatStorageKey ?? "") === chatStorageKey;
}

async function recordAgentSessionTelemetry(type: string, body: { agent?: AgentProfile; sessionId?: string; sinceMs?: number; chatStorageKey?: string }, payload: Record<string, unknown> = {}) {
  await recordTelemetryBatch([{
    source: "route",
    type,
    threadId: body.chatStorageKey || undefined,
    runId: body.sessionId || undefined,
    payload: {
      agentId: body.agent?.id ?? body.agent?.agentId ?? null,
      agentName: body.agent?.name ?? null,
      runtime: body.agent?.runtime ?? null,
      sessionId: body.sessionId || null,
      chatStorageKey: body.chatStorageKey || null,
      sinceMs: body.sinceMs || null,
      ...payload,
    },
  }]).catch(() => undefined);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { agent?: AgentProfile; sessionId?: string; sinceMs?: number; chatStorageKey?: string };
    const telemetryUrl = await canonicalLocalCollectorUrl(body.agent);
    const sessionId = body.sessionId?.trim();
    const sinceMs = Number(body.sinceMs || 0);
    const chatStorageKey = body.chatStorageKey?.trim();
    await recordAgentSessionTelemetry("chat.agent_session.request", body);
    if (!body.agent || (!sessionId && !sinceMs && !chatStorageKey)) {
      await recordAgentSessionTelemetry("chat.agent_session.invalid", body);
      return NextResponse.json({ ok: false, error: "Expected { agent, sessionId }, { agent, sinceMs }, or { agent, chatStorageKey }." }, { status: 400 });
    }
    const fallbackSession = () => readRuntimeChatSession({
      sessionId,
      sinceMs,
      chatStorageKey,
      runtime: body.agent?.runtime?.trim(),
      agentId: body.agent?.id?.trim() || body.agent?.agentId?.trim(),
    });
    const fallbackLocalSession = async () => await readLocalHermesSession(body.agent, sessionId, sinceMs) ?? await fallbackSession();
    if (!telemetryUrl) {
      const session = await fallbackLocalSession();
      if (session) {
        await recordAgentSessionTelemetry("chat.agent_session.response", body, { via: "local-fallback", session: chatTelemetrySession(session) });
        return NextResponse.json({ ok: true, session });
      }
      await recordAgentSessionTelemetry("chat.agent_session.not_found", body, { via: "local-fallback", status: 404 });
      return NextResponse.json({ ok: false, error: "No runtime session found." }, { status: 404 });
    }
    const buildUrl = (pathname: string) => {
      const url = new URL(`${telemetryUrl}${pathname}`);
      if (sessionId) url.searchParams.set("sessionId", sessionId);
      if (sinceMs) url.searchParams.set("sinceMs", String(sinceMs));
      if (chatStorageKey) url.searchParams.set("chatStorageKey", chatStorageKey);
      if (body.agent?.runtime?.trim()) url.searchParams.set("runtime", body.agent.runtime.trim());
      if (body.agent?.localDataDir?.trim()) url.searchParams.set("localDataDir", body.agent.localDataDir.trim());
      return url;
    };
    let response = await fetch(buildUrl("/runtime-sessions"), { cache: "no-store", signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (!response) {
      const session = await fallbackLocalSession();
      if (session) return NextResponse.json({ ok: true, session });
      return NextResponse.json({ ok: false, error: "Agent bridge unavailable." }, { status: 502 });
    }
    let data = await response.json().catch(() => null);
    if (response.status === 404 && !data?.ok) {
      response = await fetch(buildUrl("/sessions"), { cache: "no-store", signal: AbortSignal.timeout(8_000) }).catch(() => null);
      if (!response) {
        const session = await fallbackLocalSession();
        if (session) {
          await recordAgentSessionTelemetry("chat.agent_session.response", body, { via: "bridge-unavailable-fallback", session: chatTelemetrySession(session) });
          return NextResponse.json({ ok: true, session });
        }
        await recordAgentSessionTelemetry("chat.agent_session.bridge_unavailable", body);
        return NextResponse.json({ ok: false, error: "Agent bridge unavailable." }, { status: 502 });
      }
      data = await response.json().catch(() => null);
    }
    if (!response.ok || !data?.ok) {
      const session = await fallbackLocalSession();
      if (session) {
        await recordAgentSessionTelemetry("chat.agent_session.response", body, { via: "bridge-error-fallback", bridgeStatus: response.status, session: chatTelemetrySession(session) });
        return NextResponse.json({ ok: true, session });
      }
      await recordAgentSessionTelemetry("chat.agent_session.bridge_error", body, { bridgeStatus: response.status, error: data?.error || null });
      return NextResponse.json({ ok: false, error: data?.error || `Agent bridge returned ${response.status}` }, { status: response.ok ? 502 : response.status });
    }
    if (!sessionMatchesRequest(data.session, sessionId, chatStorageKey)) {
      const session = await fallbackLocalSession();
      if (session) {
        await recordAgentSessionTelemetry("chat.agent_session.response", body, { via: "mismatch-fallback", session: chatTelemetrySession(session) });
        return NextResponse.json({ ok: true, session });
      }
      await recordAgentSessionTelemetry("chat.agent_session.mismatch", body, { bridgeSession: chatTelemetrySession(data.session) });
      return NextResponse.json({ ok: false, error: "No runtime session found for this chat." }, { status: 404 });
    }
    await recordAgentSessionTelemetry("chat.agent_session.response", body, { via: "bridge", session: chatTelemetrySession(data.session) });
    return NextResponse.json({ ok: true, session: data.session });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read agent session.",
    }, { status: 502 });
  }
}
