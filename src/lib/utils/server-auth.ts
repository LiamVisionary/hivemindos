import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const DASHBOARD_SESSION_COOKIE = "hivemindos_session";
export const DASHBOARD_AUTH_HEADER = "x-hivemindos-device-token";

const SESSION_VERSION = "v1";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;
const MIN_TOKEN_LENGTH = 24;

type AuthResult = {
  userId: string | null;
  reason?: string;
};

type CookieOptions = {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
};

function dashboardAuthSecret() {
  return process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET?.trim() ?? "";
}

function dashboardDeviceToken() {
  return process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN?.trim() ?? "";
}

function userId() {
  return process.env.OPENCLAW_NEXT_USER_ID?.trim() || "local-user";
}

export function dashboardAuthConfigured() {
  return dashboardAuthSecret().length >= MIN_SECRET_LENGTH;
}

export function dashboardDeviceTokenConfigured() {
  return dashboardDeviceToken().length >= MIN_TOKEN_LENGTH;
}

export function dashboardAuthStatus() {
  if (!dashboardAuthConfigured()) {
    return {
      ok: false,
      reason: `Set HIVEMINDOS_DASHBOARD_AUTH_SECRET to at least ${MIN_SECRET_LENGTH} characters.`,
    };
  }
  if (!dashboardDeviceTokenConfigured()) {
    return {
      ok: false,
      reason: `Set HIVEMINDOS_DASHBOARD_DEVICE_TOKEN to at least ${MIN_TOKEN_LENGTH} characters.`,
    };
  }
  return { ok: true, reason: "" };
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return bytesToHex(data);
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textBytes(value));
  return bytesToHex(new Uint8Array(signature));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function parseCookies(header: string | null) {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies.set(key, decodeURIComponent(value));
  }
  return cookies;
}

function requestCookie(request: Request, name: string) {
  const nextRequest = request as NextRequest;
  const cookieValue = nextRequest.cookies?.get(name)?.value;
  if (cookieValue) return cookieValue;
  return parseCookies(request.headers.get("cookie")).get(name) ?? "";
}

function secureDashboardRequest(request?: Request) {
  if (!request) return process.env.NODE_ENV === "production";
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto) return forwardedProto === "https";
  return new URL(request.url).protocol === "https:";
}

export function dashboardSessionCookieOptions(request?: Request): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: secureDashboardRequest(request),
    path: "/",
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  };
}

export async function createDashboardSessionCookieValue(now = Date.now()) {
  const secret = dashboardAuthSecret();
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("Dashboard auth secret is not configured.");
  const issuedAt = String(now);
  const expiresAt = String(now + SESSION_DURATION_MS);
  const nonce = randomHex(16);
  const payload = [SESSION_VERSION, issuedAt, expiresAt, nonce].join(".");
  const signature = await hmacHex(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifyDashboardSessionCookie(value: string, now = Date.now()) {
  const secret = dashboardAuthSecret();
  if (secret.length < MIN_SECRET_LENGTH) return false;
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== SESSION_VERSION) return false;
  const [version, issuedAt, expiresAt, nonce, signature] = parts;
  if (!/^\d+$/.test(issuedAt) || !/^\d+$/.test(expiresAt) || !/^[a-f0-9]{32}$/i.test(nonce)) return false;
  const expiresAtMs = Number(expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return false;
  const payload = [version, issuedAt, expiresAt, nonce].join(".");
  const expected = await hmacHex(secret, payload);
  return safeEqual(expected, signature);
}

async function verifyDeviceToken(value: string) {
  const secret = dashboardAuthSecret();
  const expectedToken = dashboardDeviceToken();
  if (secret.length < MIN_SECRET_LENGTH || expectedToken.length < MIN_TOKEN_LENGTH || !value) return false;
  const [actual, expected] = await Promise.all([
    hmacHex(secret, value),
    hmacHex(secret, expectedToken),
  ]);
  return safeEqual(actual, expected);
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export async function verifyAuth(request: Request): Promise<AuthResult> {
  const status = dashboardAuthStatus();
  if (!status.ok) return { userId: null, reason: status.reason };

  const sessionValue = requestCookie(request, DASHBOARD_SESSION_COOKIE);
  if (sessionValue && await verifyDashboardSessionCookie(sessionValue)) {
    return { userId: userId() };
  }

  const headerToken = request.headers.get(DASHBOARD_AUTH_HEADER)?.trim() || bearerToken(request);
  if (await verifyDeviceToken(headerToken)) {
    return { userId: userId() };
  }

  return { userId: null, reason: "Dashboard authentication is required." };
}

export function unauthorizedJson(reason = "Dashboard authentication is required.") {
  return NextResponse.json({ ok: false, error: reason }, { status: 401 });
}

export async function requireAuth(request: Request) {
  const auth = await verifyAuth(request);
  return auth.userId ? null : unauthorizedJson(auth.reason);
}
