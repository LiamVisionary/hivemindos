import { NextRequest } from "next/server";

import { SHELL_SESSION_PATTERN, shellBaseFromCollectorUrl, shellSessionUrl } from "../shell-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const session = params.get("session") ?? "";
  if (!SHELL_SESSION_PATTERN.test(session)) {
    return Response.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }
  const base = shellBaseFromCollectorUrl(params.get("collectorUrl") ?? undefined);
  if (!base) {
    return Response.json({ ok: false, error: "invalid collector URL" }, { status: 400 });
  }

  try {
    const upstream = await fetch(shellSessionUrl(base, session, "stream"), {
      cache: "no-store",
      // Tie the upstream SSE socket to the browser connection so closing the
      // EventSource tears down the whole chain.
      signal: request.signal,
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      return Response.json(
        { ok: false, error: detail || `shell stream failed (${upstream.status})` },
        { status: upstream.status || 502 },
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "shell stream failed" },
      { status: 502 },
    );
  }
}
