import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readSharedAgentEnv, saveSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";

export const GITHUB_OAUTH_STATE_COOKIE = "hive_github_oauth_state";
export const GITHUB_OAUTH_SOURCE_COOKIE = "hive_github_oauth_source";

const DEFAULT_GITHUB_OAUTH_SCOPES = ["repo", "workflow", "admin:repo_hook", "read:org", "user:email"];
const DELETE_REPO_SCOPE = "delete_repo";

export type GitHubOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  missing: string[];
};

export async function readGitHubOAuthConfig(request: NextRequest): Promise<GitHubOAuthConfig> {
  const sharedEnv = await readSharedAgentEnv();
  const clientId = sanitizeGitHubCredential(sharedEnvValue("GITHUB_OAUTH_CLIENT_ID", sharedEnv) || sharedEnvValue("GH_OAUTH_CLIENT_ID", sharedEnv));
  const clientSecret = sanitizeGitHubCredential(sharedEnvValue("GITHUB_OAUTH_CLIENT_SECRET", sharedEnv) || sharedEnvValue("GH_OAUTH_CLIENT_SECRET", sharedEnv));
  const redirectUri = sharedEnvValue("GITHUB_OAUTH_CALLBACK_URL", sharedEnv)
    || new URL("/api/integrations/github/oauth/callback", localCallbackOrigin(request)).toString();
  const scopes = normalizeScopes(sharedEnvValue("GITHUB_OAUTH_SCOPES", sharedEnv));
  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    missing: [
      clientId ? "" : "GITHUB_OAUTH_CLIENT_ID",
      clientSecret ? "" : "GITHUB_OAUTH_CLIENT_SECRET",
    ].filter(Boolean),
  };
}

export function createGitHubOAuthState(source: string, clientSecret: string) {
  const payload = Buffer.from(JSON.stringify({
    nonce: randomBytes(16).toString("base64url"),
    source: normalizeGitHubOAuthSource(source),
    exp: Date.now() + 10 * 60 * 1000,
  })).toString("base64url");
  const signature = signGitHubOAuthState(payload, clientSecret);
  return `${payload}.${signature}`;
}

export function verifyGitHubOAuthState(state: string, clientSecret: string) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  const expected = signGitHubOAuthState(payload, clientSecret);
  const signatureBuffer = new Uint8Array(Buffer.from(signature));
  const expectedBuffer = new Uint8Array(Buffer.from(expected));
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { source?: string; exp?: number };
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return { source: normalizeGitHubOAuthSource(parsed.source ?? null) };
  } catch {
    return null;
  }
}

export function normalizeGitHubOAuthSource(source: string | null) {
  return source === "aeon" ? "aeon" : "integrations";
}

export function githubOAuthReturnUrl(source: string) {
  return source === "aeon" ? "/?view=aeon&aeonPanel=detail&aeonTab=overview&githubOAuth=connected" : "/?view=integrations&connections=github";
}

export async function saveGitHubTokenForAeon(accessToken: string) {
  await saveSharedAgentEnv("GH_GLOBAL", accessToken);
}

export function renderGitHubOAuthPage(input: {
  title: string;
  body: string;
  returnUrl?: string;
  returnLabel?: string;
  status?: number;
}) {
  const returnUrl = input.returnUrl ?? "/?view=aeon";
  const returnLabel = input.returnLabel ?? "Back to AEON";
  return new NextResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #030712; color: #f8fafc; }
      main { width: min(560px, calc(100vw - 32px)); border: 1px solid rgba(94, 234, 212, 0.24); border-radius: 10px; background: rgba(15, 23, 42, 0.82); padding: 24px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34); }
      p { color: #a8b3c7; line-height: 1.55; }
      code { color: #67e8f9; }
      a { display: inline-flex; margin-top: 10px; color: #5eead4; font-weight: 800; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(input.title)}</h1>
      <p>${input.body}</p>
      <a href="${escapeHtml(returnUrl)}">${escapeHtml(returnLabel)}</a>
    </main>
  </body>
</html>`, {
    status: input.status ?? 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function sanitizeGitHubCredential(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "");
}

export function localCallbackOrigin(request: NextRequest) {
  const url = new URL(request.nextUrl.origin);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.hostname = "127.0.0.1";
  }
  return url.origin;
}

function signGitHubOAuthState(payload: string, clientSecret: string) {
  return createHmac("sha256", clientSecret).update(payload).digest("base64url");
}

function normalizeScopes(rawScopes?: string) {
  const scopes = (rawScopes?.trim() ? rawScopes.split(/\s+/) : DEFAULT_GITHUB_OAUTH_SCOPES)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .filter((scope) => scope !== DELETE_REPO_SCOPE);
  return [...new Set(scopes)];
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
