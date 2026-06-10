import { NextRequest } from "next/server";

export const runtime = "nodejs";

const ICON_PROXY_TIMEOUT_MS = 10_000;
const ALLOWED_REMOTE_HOSTS = new Set(["cdn.simpleicons.org"]);

function isLocalHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function isPrivateOrTailnetHost(host: string) {
  if (isLocalHost(host)) return true;
  if (host.endsWith(".ts.net")) return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return false;
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  // Tailscale CGNAT range 100.64.0.0/10
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isAllowedIconTarget(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (ALLOWED_REMOTE_HOSTS.has(host)) return true;
  return isPrivateOrTailnetHost(host);
}

function looksLikeImagePath(url: URL) {
  return /\.(?:ico|png|svg|webp|jpg|jpeg|gif)$/i.test(url.pathname);
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url") || "";
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return Response.json({ ok: false, error: "Invalid icon URL" }, { status: 400 });
  }

  if (!isAllowedIconTarget(target)) {
    return Response.json({ ok: false, error: "Icon URL is not allowlisted" }, { status: 400 });
  }

  const upstream = await fetch(target, {
    cache: "no-store",
    signal: AbortSignal.timeout(ICON_PROXY_TIMEOUT_MS),
  }).catch(() => null);
  if (!upstream?.ok) {
    return Response.json({ ok: false, error: "Icon unavailable" }, { status: upstream?.status || 502 });
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const genericType = contentType === "application/octet-stream" || contentType.startsWith("text/plain");
  if (!contentType.startsWith("image/") && !(genericType && looksLikeImagePath(target))) {
    return Response.json({ ok: false, error: "Icon response is not an image" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Type": contentType.startsWith("image/") ? contentType : "image/x-icon",
    },
  });
}
