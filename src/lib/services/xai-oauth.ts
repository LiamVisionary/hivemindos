import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join, resolve } from "node:path";

import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { writeSharedHiveEnvValues } from "@/lib/services/hive-env-write";

const XAI_OAUTH_ISSUER = "https://auth.x.ai";
const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
const XAI_OAUTH_AUTHORIZE_URL = `${XAI_OAUTH_ISSUER}/oauth2/authorize`;
const XAI_OAUTH_TOKEN_URL = `${XAI_OAUTH_ISSUER}/oauth2/token`;
const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
const XAI_OAUTH_REDIRECT_HOST = "127.0.0.1";
const XAI_OAUTH_REDIRECT_PORT = 56121;
const XAI_OAUTH_REDIRECT_PATH = "/callback";
const XAI_OAUTH_REDIRECT_URI = `http://${XAI_OAUTH_REDIRECT_HOST}:${XAI_OAUTH_REDIRECT_PORT}${XAI_OAUTH_REDIRECT_PATH}`;
const XAI_OAUTH_BASE_URL = "https://api.x.ai/v1";
const LOGIN_FLOW_TTL_MS = 10 * 60_000;

export const XAI_OAUTH_ENV_KEYS = {
  accessToken: "XAI_OAUTH_ACCESS_TOKEN",
  refreshToken: "XAI_OAUTH_REFRESH_TOKEN",
  idToken: "XAI_OAUTH_ID_TOKEN",
  tokenType: "XAI_OAUTH_TOKEN_TYPE",
  expiresAt: "XAI_OAUTH_EXPIRES_AT",
  baseUrl: "XAI_OAUTH_BASE_URL",
} as const;

type XaiOAuthLoginState =
  | { phase: "idle" }
  | { phase: "pending"; authorizeUrl: string; startedAt: number }
  | { phase: "connected"; connectedAt: number; warnings?: string[] }
  | { phase: "error"; error: string };

type ParsedOAuthCallback = {
  code: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
};

type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
};

type XaiTokenPayload = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string | { message?: string };
  error_description?: string;
};

type ExistingHermesOAuth = {
  home: string;
  tokens: XaiTokenPayload & { refresh_token: string };
  discovery: Discovery;
  lastRefresh: string;
  accessTokenExpiresAt: number | null;
};

type LoginFlow = {
  state: XaiOAuthLoginState;
  server: Server | null;
  verifier: string;
  challenge: string;
  oauthState: string;
  nonce: string;
  discovery: Discovery;
  hermesHomes: string[];
};

let loginFlow: LoginFlow | null = null;

function base64Url(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function xaiPkceVerifier() {
  // Hermes uses a high-entropy RFC 7636 verifier; mirror that shape here.
  return base64Url(randomBytes(48));
}

async function xaiOAuthDiscovery(): Promise<Discovery> {
  const response = await fetch(XAI_OAUTH_DISCOVERY_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as Partial<Discovery> | null;
  return {
    authorization_endpoint: typeof data?.authorization_endpoint === "string" && data.authorization_endpoint
      ? data.authorization_endpoint
      : XAI_OAUTH_AUTHORIZE_URL,
    token_endpoint: typeof data?.token_endpoint === "string" && data.token_endpoint
      ? data.token_endpoint
      : XAI_OAUTH_TOKEN_URL,
  };
}

function buildAuthorizeUrl(flow: LoginFlow) {
  return `${flow.discovery.authorization_endpoint}?${new URLSearchParams({
    response_type: "code",
    client_id: XAI_OAUTH_CLIENT_ID,
    redirect_uri: XAI_OAUTH_REDIRECT_URI,
    scope: XAI_OAUTH_SCOPE,
    code_challenge: flow.challenge,
    code_challenge_method: "S256",
    state: flow.oauthState,
    nonce: flow.nonce,
    plan: "generic",
    referrer: "hivemindos",
  }).toString()}`;
}

function parseOAuthCallbackInput(raw: string): ParsedOAuthCallback {
  const stripped = raw.trim();
  const result: ParsedOAuthCallback = {
    code: null,
    state: null,
    error: null,
    errorDescription: null,
  };
  if (!stripped) return result;
  let query = "";
  if (stripped.startsWith("http://") || stripped.startsWith("https://")) {
    try {
      const parsed = new URL(stripped);
      query = parsed.search.slice(1);
    } catch {
      return result;
    }
  } else if (stripped.startsWith("?")) {
    query = stripped.slice(1);
  } else if (stripped.includes("=")) {
    query = stripped;
  } else {
    result.code = stripped;
    return result;
  }
  const params = new URLSearchParams(query);
  result.code = params.get("code");
  result.state = params.get("state");
  result.error = params.get("error");
  result.errorDescription = params.get("error_description");
  return result;
}

async function exchangeCodeForTokens(code: string, flow: LoginFlow): Promise<Required<Pick<XaiTokenPayload, "access_token" | "refresh_token">> & XaiTokenPayload> {
  const response = await fetch(flow.discovery.token_endpoint, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: XAI_OAUTH_REDIRECT_URI,
      client_id: XAI_OAUTH_CLIENT_ID,
      code_verifier: flow.verifier,
      // xAI validates these at token time; Hermes sends them too.
      code_challenge: flow.challenge,
      code_challenge_method: "S256",
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => null) as XaiTokenPayload | null;
  if (!response.ok || !data?.access_token || !data.refresh_token) {
    const detail =
      data?.error_description ||
      (typeof data?.error === "string" ? data.error : data?.error?.message);
    if (response.status === 403) {
      throw new Error(
        `xAI OAuth connected but this account is not authorized for xAI API access${detail ? `: ${detail}` : "."} Use XAI_API_KEY if your subscription tier does not include OAuth API access.`,
      );
    }
    throw new Error(detail || `xAI OAuth token endpoint returned HTTP ${response.status}.`);
  }
  return data as Required<Pick<XaiTokenPayload, "access_token" | "refresh_token">> & XaiTokenPayload;
}

function closeLoginServer() {
  try {
    loginFlow?.server?.close();
  } catch {
    // Already closed.
  }
  if (loginFlow) loginFlow.server = null;
}

function normalizeHermesHome(raw: string) {
  const trimmed = raw.trim().replace(/^~(?=$|\/)/, homedir());
  if (!trimmed) return "";
  const hermesRoot = resolve(join(homedir(), ".hermes"));
  const candidate = resolve(trimmed);
  if (candidate !== hermesRoot && !candidate.startsWith(`${hermesRoot}/`)) return "";
  return candidate;
}

function hermesHomesFromInput(input?: unknown, options: { preferInput?: boolean } = {}): string[] {
  const homes = new Set<string>();
  const defaultHome = join(homedir(), ".hermes");
  const addHome = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const normalized = normalizeHermesHome(raw);
    if (normalized) homes.add(normalized);
  };
  if (!options.preferInput) homes.add(defaultHome);
  if (typeof input === "string") addHome(input);
  if (Array.isArray(input)) {
    for (const item of input) addHome(item);
  }
  if (options.preferInput) homes.add(defaultHome);
  return [...homes];
}

async function readAuthStore(authPath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(authPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  if (!raw.trim()) return { version: 2, providers: {} };
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") return { version: 2, providers: {} };
  if (!parsed.providers || typeof parsed.providers !== "object" || Array.isArray(parsed.providers)) {
    parsed.providers = {};
  }
  return parsed;
}

async function writeJsonPrivate(path: string, data: Record<string, unknown>) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp.${process.pid}.${randomUUID()}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => undefined);
  await rename(tmp, path);
  await chmod(path, 0o600).catch(() => undefined);
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function discoveryFromRecord(value: unknown): Discovery {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    authorization_endpoint: stringField(record, "authorization_endpoint") || XAI_OAUTH_AUTHORIZE_URL,
    token_endpoint: stringField(record, "token_endpoint") || XAI_OAUTH_TOKEN_URL,
  };
}

function accessTokenExpiresAt(providerState: Record<string, unknown>, tokens: XaiTokenPayload) {
  const expiresIn = finiteNumber(tokens.expires_in);
  if (!expiresIn || expiresIn <= 0) return null;
  const lastRefresh = stringField(providerState, "last_refresh");
  const lastRefreshMs = lastRefresh ? Date.parse(lastRefresh) : NaN;
  if (!Number.isFinite(lastRefreshMs)) return null;
  return lastRefreshMs + expiresIn * 1000;
}

function hiveEnvValuesFromTokens(tokens: XaiTokenPayload, expiresAt: number | null = null) {
  const computedExpiresAt = expiresAt ?? Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000;
  const values: Record<string, string> = {
    [XAI_OAUTH_ENV_KEYS.accessToken]: String(tokens.access_token || ""),
    [XAI_OAUTH_ENV_KEYS.refreshToken]: String(tokens.refresh_token || ""),
    [XAI_OAUTH_ENV_KEYS.tokenType]: String(tokens.token_type || "Bearer"),
    [XAI_OAUTH_ENV_KEYS.expiresAt]: String(computedExpiresAt),
    [XAI_OAUTH_ENV_KEYS.baseUrl]: XAI_OAUTH_BASE_URL,
  };
  if (tokens.id_token) values[XAI_OAUTH_ENV_KEYS.idToken] = tokens.id_token;
  return values;
}

async function readExistingHermesOAuth(home: string): Promise<ExistingHermesOAuth | null> {
  const authStore = await readAuthStore(join(home, "auth.json"));
  const providers = authStore.providers as Record<string, unknown>;
  const providerState = providers["xai-oauth"];
  if (!providerState || typeof providerState !== "object" || Array.isArray(providerState)) return null;
  const state = providerState as Record<string, unknown>;
  const tokensRecord = state.tokens && typeof state.tokens === "object" && !Array.isArray(state.tokens)
    ? state.tokens as Record<string, unknown>
    : {};
  const refreshToken = stringField(tokensRecord, "refresh_token");
  if (!refreshToken) return null;
  const expiresIn = finiteNumber(tokensRecord.expires_in);
  const tokens: XaiTokenPayload & { refresh_token: string } = {
    access_token: stringField(tokensRecord, "access_token"),
    refresh_token: refreshToken,
    id_token: stringField(tokensRecord, "id_token"),
    token_type: stringField(tokensRecord, "token_type") || "Bearer",
  };
  if (expiresIn !== null) tokens.expires_in = expiresIn;
  const lastRefresh = stringField(state, "last_refresh") || new Date().toISOString();
  return {
    home,
    tokens,
    discovery: discoveryFromRecord(state.discovery),
    lastRefresh,
    accessTokenExpiresAt: accessTokenExpiresAt(state, tokens),
  };
}

async function syncExistingHermesOAuth(input: { hermesHomes?: unknown; writeSharedEnv?: boolean; writeToHermes?: boolean }) {
  const homes = hermesHomesFromInput(input.hermesHomes, { preferInput: true });
  const warnings: string[] = [];
  let existing: ExistingHermesOAuth | null = null;
  for (const home of homes) {
    try {
      existing = await readExistingHermesOAuth(home);
      if (existing) break;
    } catch (error) {
      warnings.push(`Could not read Hermes auth store at ${home}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!existing) return { existing: null, warnings };

  if (input.writeSharedEnv) {
    try {
      await writeSharedHiveEnvValues(hiveEnvValuesFromTokens(existing.tokens, existing.accessTokenExpiresAt));
    } catch (error) {
      warnings.push(`Could not sync xAI OAuth from Hermes into the shared hive env: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (input.writeToHermes) {
    for (const home of homes) {
      if (home === existing.home) continue;
      try {
        await writeHermesAuthStore(home, existing.tokens, existing.discovery, existing.lastRefresh);
      } catch (error) {
        warnings.push(`Could not mirror xAI OAuth into Hermes auth store at ${home}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { existing, warnings };
}

async function writeHermesAuthStore(home: string, tokens: XaiTokenPayload, discovery: Discovery, lastRefresh: string) {
  const authPath = join(home, "auth.json");
  const authStore = await readAuthStore(authPath);
  const providers = authStore.providers as Record<string, unknown>;
  const priorState = providers["xai-oauth"];
  const state = priorState && typeof priorState === "object" && !Array.isArray(priorState)
    ? { ...(priorState as Record<string, unknown>) }
    : {};
  state.tokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token || "",
    expires_in: tokens.expires_in,
    token_type: tokens.token_type || "Bearer",
  };
  state.last_refresh = lastRefresh;
  state.auth_mode = "oauth_pkce";
  state.discovery = discovery;
  state.redirect_uri = XAI_OAUTH_REDIRECT_URI;
  providers["xai-oauth"] = state;
  authStore.providers = providers;
  authStore.active_provider = "xai-oauth";
  authStore.version = typeof authStore.version === "number" ? authStore.version : 2;
  authStore.updated_at = new Date().toISOString();
  await writeJsonPrivate(authPath, authStore);
}

async function persistTokens(tokens: XaiTokenPayload, discovery: Discovery, hermesHomes: string[]) {
  await writeSharedHiveEnvValues(hiveEnvValuesFromTokens(tokens));

  const warnings: string[] = [];
  const lastRefresh = new Date().toISOString().replace("+00:00", "Z");
  for (const home of hermesHomes) {
    try {
      await writeHermesAuthStore(home, tokens, discovery, lastRefresh);
    } catch (error) {
      warnings.push(`Could not update Hermes auth store at ${home}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return warnings;
}

function callbackHtml(title: string, body: string, status = 200) {
  return {
    status,
    html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0d11;color:#f3f0e9;font-family:system-ui,-apple-system,Segoe UI,sans-serif"><main style="width:min(480px,calc(100vw - 32px));border:1px solid rgba(238,232,220,.14);border-radius:18px;background:#14161c;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.45)"><p style="margin:0 0 10px;color:#e7b45c;font:700 11px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase">HivemindOS</p><h1 style="margin:0 0 10px;font-size:24px">${escapeHtml(title)}</h1><p style="margin:0;color:#a7a39a;line-height:1.55">${escapeHtml(body)}</p></main></body></html>`,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export async function xaiOAuthConfigured(input: { hermesHomes?: unknown } = {}): Promise<boolean> {
  const status = await xaiOAuthStatus({ ...input, syncFromHermes: false });
  return status.connected;
}

export async function xaiOAuthStatus(input: { hermesHomes?: unknown; syncFromHermes?: boolean } = {}) {
  const [refresh, expiresAtRaw] = await Promise.all([
    hiveEnvValue(XAI_OAUTH_ENV_KEYS.refreshToken).catch(() => ""),
    hiveEnvValue(XAI_OAUTH_ENV_KEYS.expiresAt).catch(() => ""),
  ]);
  const envConnected = Boolean(refresh?.trim());
  const hermes = envConnected
    ? { existing: null, warnings: [] as string[] }
    : await syncExistingHermesOAuth({
      hermesHomes: input.hermesHomes,
      writeSharedEnv: Boolean(input.syncFromHermes),
      writeToHermes: Boolean(input.syncFromHermes),
    });
  const existing = hermes.existing;
  const connected = envConnected || Boolean(existing);
  return {
    connected,
    source: envConnected ? "shared-hive-env" : existing ? "hermes" : null,
    hermesHome: existing?.home ?? null,
    accessTokenExpiresAt: Number(expiresAtRaw) || existing?.accessTokenExpiresAt || null,
    warnings: hermes.warnings,
    login: loginFlow?.state ?? ({ phase: "idle" } as const),
  };
}

export async function startXaiOAuthLogin(input: { hermesHomes?: unknown } = {}): Promise<{ authorizeUrl: string }> {
  closeLoginServer();
  const discovery = await xaiOAuthDiscovery();
  const verifier = xaiPkceVerifier();
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const flow: LoginFlow = {
    state: { phase: "idle" },
    server: null,
    verifier,
    challenge,
    oauthState: randomUUID().replaceAll("-", ""),
    nonce: randomUUID().replaceAll("-", ""),
    discovery,
    hermesHomes: hermesHomesFromInput(input.hermesHomes),
  };
  const authorizeUrl = buildAuthorizeUrl(flow);
  flow.state = { phase: "pending", authorizeUrl, startedAt: Date.now() };

  await new Promise<void>((resolvePromise, reject) => {
    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", XAI_OAUTH_REDIRECT_URI);
        if (url.pathname !== XAI_OAUTH_REDIRECT_PATH) {
          response.writeHead(404).end("Not found");
          return;
        }
        try {
          const error = url.searchParams.get("error_description") || url.searchParams.get("error");
          if (error) throw new Error(error);
          if (url.searchParams.get("state") !== flow.oauthState) {
            throw new Error("OAuth state mismatch. Restart the xAI sign-in from HivemindOS.");
          }
          const code = url.searchParams.get("code") ?? "";
          if (!code) throw new Error("The OAuth callback carried no authorization code.");
          const tokens = await exchangeCodeForTokens(code, flow);
          const warnings = await persistTokens(tokens, flow.discovery, flow.hermesHomes);
          flow.state = { phase: "connected", connectedAt: Date.now(), warnings };
          const page = callbackHtml(
            warnings.length ? "xAI connected with a warning" : "xAI connected",
            warnings.length
              ? "Tokens were saved to the shared hive env, but one runtime auth store could not be updated. Return to HivemindOS for details."
              : "Tokens were saved to the shared hive env and Hermes. You can close this tab and return to HivemindOS.",
            warnings.length ? 207 : 200,
          );
          response.writeHead(page.status, { "content-type": "text/html; charset=utf-8" }).end(page.html);
        } catch (callbackError) {
          const message = callbackError instanceof Error ? callbackError.message : String(callbackError);
          flow.state = { phase: "error", error: message };
          const page = callbackHtml("xAI sign-in failed", message, 400);
          response.writeHead(page.status, { "content-type": "text/html; charset=utf-8" }).end(page.html);
        } finally {
          closeLoginServer();
        }
      })();
    });
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          error.code === "EADDRINUSE"
            ? `Port ${XAI_OAUTH_REDIRECT_PORT} is already in use by another xAI OAuth login. Finish that sign-in or close it, then retry.`
            : error.message,
        ),
      );
    });
    server.listen(XAI_OAUTH_REDIRECT_PORT, XAI_OAUTH_REDIRECT_HOST, () => resolvePromise());
    flow.server = server;
    setTimeout(() => {
      if (loginFlow === flow && flow.state.phase === "pending") {
        flow.state = { phase: "error", error: "Sign-in timed out after 10 minutes." };
        closeLoginServer();
      }
    }, LOGIN_FLOW_TTL_MS).unref?.();
  });

  loginFlow = flow;
  return { authorizeUrl };
}

export async function submitXaiOAuthCode(input: { code?: unknown; hermesHomes?: unknown } = {}) {
  const raw = typeof input.code === "string" ? input.code.trim() : "";
  if (!raw) throw new Error("Paste the code xAI showed in the browser.");
  const flow = loginFlow;
  if (!flow || flow.state.phase !== "pending") {
    throw new Error("Start xAI OAuth from HivemindOS before submitting the browser code.");
  }
  const parsed = parseOAuthCallbackInput(raw);
  if (parsed.error) {
    throw new Error(parsed.errorDescription || parsed.error);
  }
  if (parsed.state && parsed.state !== flow.oauthState) {
    throw new Error("xAI OAuth state mismatch. Restart the xAI sign-in from HivemindOS.");
  }
  const code = parsed.code?.trim() ?? "";
  if (!code) throw new Error("The pasted xAI OAuth code was empty.");
  if (Array.isArray(input.hermesHomes) && input.hermesHomes.length) {
    flow.hermesHomes = hermesHomesFromInput(input.hermesHomes);
  }
  const tokens = await exchangeCodeForTokens(code, flow);
  const warnings = await persistTokens(tokens, flow.discovery, flow.hermesHomes);
  flow.state = { phase: "connected", connectedAt: Date.now(), warnings };
  closeLoginServer();
  return { warnings };
}

export function xaiOAuthLoginState(): XaiOAuthLoginState {
  return loginFlow?.state ?? { phase: "idle" };
}
