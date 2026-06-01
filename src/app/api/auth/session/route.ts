import { NextRequest, NextResponse } from "next/server";
import {
  DASHBOARD_SESSION_COOKIE,
  createDashboardSessionCookieValue,
  dashboardAuthStatus,
  dashboardSessionCookieOptions,
  verifyAuth,
} from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json")
    || request.headers.get("content-type")?.includes("application/json");
}

function safeReturnTo(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

async function tokenFromRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({})) as { token?: string; returnTo?: string };
    return { token: body.token?.trim() ?? "", returnTo: safeReturnTo(body.returnTo ?? null) };
  }
  const form = await request.formData().catch(() => null);
  return {
    token: String(form?.get("token") ?? "").trim(),
    returnTo: safeReturnTo(String(form?.get("returnTo") ?? "/")),
  };
}

async function openSession(request: NextRequest, token: string, returnTo = "/") {
  const status = dashboardAuthStatus();
  if (!status.ok) {
    return NextResponse.json({ ok: false, error: status.reason }, { status: 503 });
  }
  const probe = new Request(request.url, {
    headers: {
      "x-hivemindos-device-token": token,
    },
  });
  const auth = await verifyAuth(probe);
  if (!auth.userId) {
    if (wantsJson(request)) return NextResponse.json({ ok: false, error: "Invalid dashboard device token." }, { status: 401 });
    return NextResponse.redirect(new URL(`/?auth=failed&returnTo=${encodeURIComponent(returnTo)}`, request.url));
  }

  const response = wantsJson(request)
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL(returnTo, request.url));
  response.cookies.set(DASHBOARD_SESSION_COOKIE, await createDashboardSessionCookieValue(), dashboardSessionCookieOptions(request));
  return response;
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  const status = dashboardAuthStatus();
  return NextResponse.json({
    ok: Boolean(auth.userId),
    configured: status.ok,
    error: auth.userId ? undefined : auth.reason,
  }, { status: auth.userId ? 200 : 401 });
}

export async function POST(request: NextRequest) {
  const { token, returnTo } = await tokenFromRequest(request);
  return openSession(request, token, returnTo);
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(DASHBOARD_SESSION_COOKIE);
  return response;
}
