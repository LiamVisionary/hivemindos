import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { readRuntimeChatSession } from "@/lib/services/chat/runtime-session-store";

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

async function readLocalHermesSession(agent: AgentProfile | undefined, sessionId = "") {
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
      messages: messages
        .filter((message) => typeof message.content === "string" && message.content.trim())
        .map((message) => ({
          role: message.role,
          content: message.content ?? "",
          createdAt: Math.round(Number(message.timestamp || 0) * 1000),
          index: message.id,
        })),
    };
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { agent?: AgentProfile; sessionId?: string; sinceMs?: number; chatStorageKey?: string };
    const telemetryUrl = body.agent?.telemetryUrl?.trim().replace(/\/+$/, "");
    const sessionId = body.sessionId?.trim();
    const sinceMs = Number(body.sinceMs || 0);
    const chatStorageKey = body.chatStorageKey?.trim();
    if (!body.agent || (!sessionId && !sinceMs && !chatStorageKey)) {
      return NextResponse.json({ ok: false, error: "Expected { agent, sessionId }, { agent, sinceMs }, or { agent, chatStorageKey }." }, { status: 400 });
    }
    const fallbackSession = () => readRuntimeChatSession({
      sessionId,
      sinceMs,
      chatStorageKey,
      runtime: body.agent?.runtime?.trim(),
      agentId: body.agent?.id?.trim() || body.agent?.agentId?.trim(),
    });
    const fallbackLocalSession = async () => await readLocalHermesSession(body.agent, sessionId) ?? await fallbackSession();
    if (!telemetryUrl) {
      const session = await fallbackLocalSession();
      if (session) return NextResponse.json({ ok: true, session });
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
        if (session) return NextResponse.json({ ok: true, session });
        return NextResponse.json({ ok: false, error: "Agent bridge unavailable." }, { status: 502 });
      }
      data = await response.json().catch(() => null);
    }
    if (!response.ok || !data?.ok) {
      const session = await fallbackLocalSession();
      if (session) return NextResponse.json({ ok: true, session });
      return NextResponse.json({ ok: false, error: data?.error || `Agent bridge returned ${response.status}` }, { status: response.ok ? 502 : response.status });
    }
    return NextResponse.json({ ok: true, session: data.session });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read agent session.",
    }, { status: 502 });
  }
}
