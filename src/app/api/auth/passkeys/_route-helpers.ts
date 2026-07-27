import { NextRequest, NextResponse } from "next/server";

export const DASHBOARD_PASSKEY_CEREMONY_COOKIE = "hivemindos_passkey_ceremony";

function ceremonyCookieOptions(request: NextRequest) {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: forwardedProtocol ? forwardedProtocol === "https" : request.nextUrl.protocol === "https:",
    path: "/api/auth/passkeys",
  };
}

export function readPasskeyCeremonyId(request: NextRequest) {
  return request.cookies.get(DASHBOARD_PASSKEY_CEREMONY_COOKIE)?.value ?? "";
}

export function setPasskeyCeremonyCookie(response: NextResponse, request: NextRequest, ceremonyId: string) {
  response.cookies.set(DASHBOARD_PASSKEY_CEREMONY_COOKIE, ceremonyId, {
    ...ceremonyCookieOptions(request),
    maxAge: 5 * 60,
  });
}

export function clearPasskeyCeremonyCookie(response: NextResponse, request: NextRequest) {
  response.cookies.set(DASHBOARD_PASSKEY_CEREMONY_COOKIE, "", {
    ...ceremonyCookieOptions(request),
    maxAge: 0,
  });
}
