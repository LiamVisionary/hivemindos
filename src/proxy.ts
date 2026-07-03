import { NextResponse, type NextRequest } from "next/server";
import { unauthorizedJson, verifyAuth } from "@/lib/utils/server-auth";

// Next 16 with a src/ layout only loads this file from src/proxy.ts (or
// src/middleware.ts, deprecated) — a root-level middleware.ts is silently
// ignored, which left every /api route without this gate until 2026-07-03.
const SELF_AUTHENTICATING_API_PREFIXES = [
  "/api/auth/session",
  "/api/runtimes/aeon/brain",
  "/api/runtimes/aeon/hive/miroshark",
  // Authenticates inside the route: dashboard auth OR a path-scoped signed URL
  // (phone image loaders can't carry the session cookie / device token).
  "/api/chat/generated-media",
];

function isSelfAuthenticatingApi(pathname: string) {
  return SELF_AUTHENTICATING_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  if (isSelfAuthenticatingApi(request.nextUrl.pathname)) return NextResponse.next();

  const auth = await verifyAuth(request);
  if (!auth.userId) return unauthorizedJson(auth.reason);
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
