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
  const isError = (input.status ?? 200) >= 400;
  // Glyph tracks outcome: a live-teal check for success, a danger triangle for
  // failure — the same two tones the Integrations panel uses for connected /
  // failed states, so this external-browser return page reads as "our app".
  const glyph = isError
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" width="23" height="23"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="23" height="23"><path d="M20 6 9 17l-5-5"/></svg>`;
  return new NextResponse(`<!doctype html>
<html lang="en" data-tone="${isError ? "error" : "ok"}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)}</title>
    <style>
      /* HivemindOS Integrations design tokens (warm-neutral dark; theme-aware).
         Inlined because this page renders in the user's external browser, not
         the app webview, so it can't reach the app stylesheet. */
      :root {
        color-scheme: dark light;
        --bg: #0c0d11; --panel: #14161c; --panel-2: #181b22;
        --line-2: rgba(238, 232, 220, 0.13);
        --fg: #f3f0e9; --fg-2: #a7a39a; --fg-4: #545049;
        --honey: #e7b45c; --honey-2: #f0c879;
        --ok: #6fcdba; --ok-soft: rgba(111, 205, 186, 0.14); --ok-line: rgba(111, 205, 186, 0.34);
        --danger: #e58e85; --danger-soft: rgba(229, 142, 133, 0.14); --danger-line: rgba(229, 142, 133, 0.34);
        --accent: var(--ok); --accent-soft: var(--ok-soft); --accent-line: var(--ok-line);
        --f-body: "Geist", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        --f-display: "Space Grotesk", "Geist", system-ui, sans-serif;
        --f-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      :root[data-tone="error"] { --accent: var(--danger); --accent-soft: var(--danger-soft); --accent-line: var(--danger-line); }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #f1ede3; --panel: #fbf8f1; --panel-2: #f4efe4;
          --line-2: rgba(54, 46, 30, 0.16);
          --fg: #221d14; --fg-2: #5e574b; --fg-4: #a59b89;
          --honey: #e6bb5c; --honey-2: #936811;
          --ok: #1d8e7c; --ok-soft: rgba(29, 142, 124, 0.13); --ok-line: rgba(29, 142, 124, 0.32);
          --danger: #a23a35; --danger-soft: rgba(162, 58, 53, 0.12); --danger-line: rgba(162, 58, 53, 0.32);
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
        font-family: var(--f-body); color: var(--fg); -webkit-font-smoothing: antialiased;
        background: radial-gradient(1100px 560px at 50% -12%, color-mix(in srgb, var(--honey) 9%, transparent), transparent 60%), var(--bg);
      }
      main {
        width: min(470px, calc(100vw - 32px));
        border: 1px solid var(--line-2); border-radius: 20px;
        background: linear-gradient(180deg, var(--panel-2), var(--panel));
        padding: 30px 32px 32px;
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03) inset, 0 30px 80px -30px rgba(0, 0, 0, 0.8);
        animation: rise .34s cubic-bezier(.2, .8, .2, 1) both;
      }
      .brand { display: flex; align-items: center; gap: 8px; font-family: var(--f-mono); font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--fg-4); }
      .dot { width: 7px; height: 7px; border-radius: 99px; background: var(--honey); box-shadow: 0 0 10px var(--honey); }
      .badge { width: 46px; height: 46px; margin: 22px 0 16px; border-radius: 13px; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); border: 1px solid var(--accent-line); }
      h1 { margin: 0 0 10px; font-family: var(--f-display); font-size: 24px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.2; }
      .body { margin: 0; color: var(--fg-2); line-height: 1.6; font-size: 14px; }
      .body code { font-family: var(--f-mono); font-size: 0.88em; color: var(--honey-2); }
      .btn {
        display: inline-flex; align-items: center; gap: 8px; margin-top: 24px;
        padding: 11px 18px; border-radius: 99px; text-decoration: none;
        background: var(--honey); color: #1a1305; font-weight: 600; font-size: 13.5px;
        transition: filter .16s, transform .16s;
      }
      .btn:hover { filter: brightness(1.06); transform: translateY(-1px); }
      .btn svg { width: 15px; height: 15px; }
      @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { main { animation: none; } .btn:hover { transform: none; } }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="dot"></span> HivemindOS</div>
      <div class="badge">${glyph}</div>
      <h1>${escapeHtml(input.title)}</h1>
      <p class="body">${input.body}</p>
      <a class="btn" href="${escapeHtml(returnUrl)}">${escapeHtml(returnLabel)}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg></a>
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
