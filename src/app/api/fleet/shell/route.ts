import { NextRequest } from "next/server";

import { errorJson } from "@/lib/utils/api-response";
import {
  SHELL_SESSION_PATTERN,
  shellBaseFromCollectorUrl,
  shellEnvelopeFromUpstream,
  shellSessionUrl,
} from "./shell-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHELL_ACTIONS = new Set(["command", "stdin", "interrupt", "kill"]);

const badRequest = (error: string) => errorJson(error);

function resolveTarget(collectorUrl: string | undefined, session: string | undefined) {
  if (!session || !SHELL_SESSION_PATTERN.test(session)) {
    return { error: badRequest("invalid session id") } as const;
  }
  const base = shellBaseFromCollectorUrl(collectorUrl);
  if (!base) {
    return { error: badRequest("invalid collector URL") } as const;
  }
  return { base, session } as const;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const target = resolveTarget(params.get("collectorUrl") ?? undefined, params.get("session") ?? undefined);
  if ("error" in target) return target.error;
  try {
    const upstream = await fetch(shellSessionUrl(target.base, target.session), {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = shellEnvelopeFromUpstream(await upstream.text(), upstream.status);
    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "shell history request failed" },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    collectorUrl?: string;
    session?: string;
    action?: string;
    command?: string;
    data?: string;
  };
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const action = body.action ?? "";
  if (!SHELL_ACTIONS.has(action)) return badRequest("unknown shell action");
  const target = resolveTarget(body.collectorUrl, body.session);
  if ("error" in target) return target.error;

  let payload: Record<string, string> = {};
  if (action === "command") {
    if (!body.command?.trim()) return badRequest("missing command");
    payload = { command: body.command };
  } else if (action === "stdin") {
    if (!body.data) return badRequest("missing data");
    payload = { data: body.data };
  }

  try {
    const upstream = await fetch(shellSessionUrl(target.base, target.session, action), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = shellEnvelopeFromUpstream(await upstream.text(), upstream.status);
    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "shell action failed" },
      { status: 502 },
    );
  }
}
