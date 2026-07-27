import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { access } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { join, resolve } from "node:path";

import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { removeSharedHiveEnvValues } from "@/lib/services/hive-env-write";
import {
  hermesXaiOAuthStorePath,
  nativeXaiOAuthStorePath,
  resolveXaiOAuthTokenStoreAccess,
  selectXaiOAuthAuthority,
  selectedXaiOAuthAuthority,
  storeXaiOAuthTokens,
  xaiOAuthTokenStoreStatus,
  type XaiOAuthAuthority,
  type XaiOAuthTokenStoreAccess,
  type XaiOAuthTokenStoreStatus,
} from "@/lib/services/xai-oauth-token-store";

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
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

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

export type XaiOAuthAccess = {
  accessToken: string;
  tokenType: string;
  expiresAt: number | null;
  baseUrl: string;
};

type LoginFlow = {
  state: XaiOAuthLoginState;
  server: Server | null;
  verifier: string;
  challenge: string;
  oauthState: string;
  nonce: string;
  discovery: Discovery;
};

let loginFlow: LoginFlow | null = null;
let accessTokenRefreshPromise: Promise<XaiOAuthAccess> | null = null;
let cachedAccess: XaiOAuthAccess | null = null;

function base64Url(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function xaiPkceVerifier() {
  // Hermes uses a high-entropy RFC 7636 verifier; mirror that shape here.
  return base64Url(randomBytes(48));
}

function validatedXaiOAuthEndpoint(value: string, fallback: string) {
  const candidate = value.trim() || fallback;
  const parsed = new URL(candidate);
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || (host !== "x.ai" && !host.endsWith(".x.ai"))) {
    throw new Error("xAI OAuth discovery returned an endpoint outside the x.ai HTTPS origin.");
  }
  return candidate;
}

async function xaiOAuthDiscovery(): Promise<Discovery> {
  const response = await fetch(XAI_OAUTH_DISCOVERY_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as Partial<Discovery> | null;
  return {
    authorization_endpoint: validatedXaiOAuthEndpoint(
      typeof data?.authorization_endpoint === "string" ? data.authorization_endpoint : "",
      XAI_OAUTH_AUTHORIZE_URL,
    ),
    token_endpoint: validatedXaiOAuthEndpoint(
      typeof data?.token_endpoint === "string" ? data.token_endpoint : "",
      XAI_OAUTH_TOKEN_URL,
    ),
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

const LEGACY_SHARED_ENV_KEYS = Object.values(XAI_OAUTH_ENV_KEYS);
let legacyEnvRetirementPromise: Promise<void> | null = null;

async function readLegacySharedEnvTokens() {
  const [accessToken, refreshToken, idToken, tokenType, expiresAtRaw] = await Promise.all([
    hiveEnvValue(XAI_OAUTH_ENV_KEYS.accessToken).catch(() => ""),
    hiveEnvValue(XAI_OAUTH_ENV_KEYS.refreshToken).catch(() => ""),
    hiveEnvValue(XAI_OAUTH_ENV_KEYS.idToken).catch(() => ""),
    hiveEnvValue(XAI_OAUTH_ENV_KEYS.tokenType).catch(() => ""),
    hiveEnvValue(XAI_OAUTH_ENV_KEYS.expiresAt).catch(() => ""),
  ]);
  const expiresAt = Number(expiresAtRaw);
  return {
    accessToken: accessToken.trim(),
    refreshToken: refreshToken.trim(),
    idToken: idToken.trim(),
    tokenType: tokenType.trim() || "Bearer",
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
  };
}

async function retireLegacySharedEnvTokens() {
  if (legacyEnvRetirementPromise) return legacyEnvRetirementPromise;
  legacyEnvRetirementPromise = removeSharedHiveEnvValues(LEGACY_SHARED_ENV_KEYS);
  try {
    await legacyEnvRetirementPromise;
  } finally {
    legacyEnvRetirementPromise = null;
  }
}

async function migrateLegacySharedEnvTokens(warnings: string[]) {
  const legacy = await readLegacySharedEnvTokens();
  if (!legacy.accessToken || !legacy.refreshToken) return false;
  const expiresIn = legacy.expiresAt
    ? Math.max(1, Math.ceil((legacy.expiresAt - Date.now()) / 1000))
    : 3600;
  await storeXaiOAuthTokens(
    {
      access_token: legacy.accessToken,
      refresh_token: legacy.refreshToken,
      id_token: legacy.idToken,
      token_type: legacy.tokenType,
      expires_in: expiresIn,
    },
    {
      authorization_endpoint: XAI_OAUTH_AUTHORIZE_URL,
      token_endpoint: XAI_OAUTH_TOKEN_URL,
    },
    XAI_OAUTH_REDIRECT_URI,
  );
  await selectXaiOAuthAuthority({
    source: "hivemindos",
    storePath: nativeXaiOAuthStorePath(),
    hermesHome: null,
  });
  cachedAccess = null;
  try {
    await retireLegacySharedEnvTokens();
  } catch (error) {
    warnings.push(`Could not retire the old shared-env OAuth copy: ${error instanceof Error ? error.message : String(error)}`);
  }
  return true;
}

async function selectExistingHermesOAuth(
  hermesHomes: unknown,
  currentAuthority: XaiOAuthAuthority,
  warnings: string[],
) {
  for (const home of hermesHomesFromInput(hermesHomes, { preferInput: true })) {
    const storePath = hermesXaiOAuthStorePath(home);
    if (storePath === currentAuthority.storePath) continue;
    const exists = await access(storePath).then(() => true).catch(() => false);
    if (!exists) continue;
    try {
      const status = await xaiOAuthTokenStoreStatus(storePath);
      if (!status.credentialsPresent) continue;
      await resolveXaiOAuthTokenStoreAccess(storePath);
      const authority = await selectXaiOAuthAuthority({
        source: "hermes",
        storePath,
        hermesHome: home,
      });
      cachedAccess = null;
      return {
        authority,
        status: await xaiOAuthTokenStoreStatus(storePath),
      };
    } catch (error) {
      warnings.push(`Could not use xAI OAuth from ${home}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return null;
}

async function ensureSelectedOAuthSession(input: { hermesHomes?: unknown; discoverHermes?: boolean; retireLegacyEnv?: boolean } = {}) {
  const warnings: string[] = [];
  let authority = await selectedXaiOAuthAuthority();
  let status = await xaiOAuthTokenStoreStatus(authority.storePath);
  if ((!status.credentialsPresent || status.needsReconnect) && authority.source === "hermes") {
    const nativePath = nativeXaiOAuthStorePath();
    const nativeExists = await access(nativePath).then(() => true).catch(() => false);
    if (nativeExists) {
      try {
        await resolveXaiOAuthTokenStoreAccess(nativePath);
        authority = await selectXaiOAuthAuthority({
          source: "hivemindos",
          storePath: nativePath,
          hermesHome: null,
        });
        status = await xaiOAuthTokenStoreStatus(nativePath);
        cachedAccess = null;
      } catch {
        // Preserve the selected Hermes error; profile discovery may still find another valid authority.
      }
    }
  }
  if ((!status.credentialsPresent || status.needsReconnect) && input.discoverHermes) {
    const selected = await selectExistingHermesOAuth(input.hermesHomes, authority, warnings);
    if (selected) {
      authority = selected.authority;
      status = selected.status;
    }
  }
  if (!status.credentialsPresent) {
    try {
      if (await migrateLegacySharedEnvTokens(warnings)) {
        authority = await selectedXaiOAuthAuthority();
        status = await xaiOAuthTokenStoreStatus(authority.storePath);
      }
    } catch (error) {
      warnings.push(`Could not migrate the previous xAI OAuth session: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (input.retireLegacyEnv) {
    const legacy = await readLegacySharedEnvTokens();
    if (legacy.accessToken || legacy.refreshToken) {
      try {
        await retireLegacySharedEnvTokens();
      } catch (error) {
        warnings.push(`Could not retire the old shared-env OAuth copy: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { authority, status, warnings };
}

async function persistTokens(tokens: XaiTokenPayload, discovery: Discovery) {
  const storePath = nativeXaiOAuthStorePath();
  await storeXaiOAuthTokens(tokens, discovery, XAI_OAUTH_REDIRECT_URI, undefined, storePath);
  await selectXaiOAuthAuthority({ source: "hivemindos", storePath, hermesHome: null });
  cachedAccess = null;
  const warnings: string[] = [];
  try {
    await retireLegacySharedEnvTokens();
  } catch (error) {
    warnings.push(`Could not remove the previous shared-env OAuth copy: ${error instanceof Error ? error.message : String(error)}`);
  }
  return warnings;
}

function publicAccess(access: XaiOAuthTokenStoreAccess): XaiOAuthAccess {
  return {
    accessToken: access.accessToken,
    tokenType: access.tokenType || "Bearer",
    expiresAt: access.expiresAt,
    baseUrl: XAI_OAUTH_BASE_URL,
  };
}

function friendlyXaiOAuthError(value: string | null) {
  const message = value?.trim() || "";
  if (/refresh token (?:has been )?revoked|invalid_grant/i.test(message)) {
    return "Refresh token has been revoked. Reconnect xAI OAuth.";
  }
  return message;
}

/** Return a current access token. Native sessions use HivemindOS' xai.lock;
 * an explicitly selected Hermes session uses that store's auth.lock in place. */
export async function getXaiOAuthAccess(): Promise<XaiOAuthAccess> {
  if (
    cachedAccess?.accessToken &&
    (!cachedAccess.expiresAt || cachedAccess.expiresAt > Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS)
  ) {
    return cachedAccess;
  }
  if (accessTokenRefreshPromise) return accessTokenRefreshPromise;
  accessTokenRefreshPromise = (async () => {
    const selected = await ensureSelectedOAuthSession({ discoverHermes: true });
    try {
      cachedAccess = publicAccess(await resolveXaiOAuthTokenStoreAccess(selected.authority.storePath));
    } catch (initialError) {
      const recovered = await ensureSelectedOAuthSession({ discoverHermes: true });
      if (recovered.authority.storePath === selected.authority.storePath) throw initialError;
      cachedAccess = publicAccess(await resolveXaiOAuthTokenStoreAccess(recovered.authority.storePath));
    }
    return cachedAccess;
  })();
  try {
    return await accessTokenRefreshPromise;
  } finally {
    accessTokenRefreshPromise = null;
  }
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
  const status = await xaiOAuthStatus({ ...input, syncFromHermes: false, validateAccess: true });
  return status.usable;
}

export async function xaiOAuthStatus(input: {
  hermesHomes?: unknown;
  syncFromHermes?: boolean;
  validateAccess?: boolean;
} = {}) {
  let selected = await ensureSelectedOAuthSession({
    hermesHomes: input.hermesHomes,
    discoverHermes: Boolean(input.syncFromHermes),
    retireLegacyEnv: Boolean(input.syncFromHermes),
  });
  let tokenStatus: XaiOAuthTokenStoreStatus = selected.status;
  let usable = tokenStatus.usable;
  let accessError: string | null = null;
  if (tokenStatus.credentialsPresent && input.validateAccess) {
    try {
      usable = Boolean((await getXaiOAuthAccess()).accessToken);
    } catch (error) {
      usable = false;
      accessError = friendlyXaiOAuthError(
        error instanceof Error ? error.message : "xAI OAuth access validation failed.",
      );
    }
    const activeAuthority = await selectedXaiOAuthAuthority();
    if (activeAuthority.storePath !== selected.authority.storePath) {
      selected = {
        ...selected,
        authority: activeAuthority,
      };
    }
    tokenStatus = await xaiOAuthTokenStoreStatus(selected.authority.storePath).catch(() => tokenStatus);
  }
  return {
    connected: usable,
    credentialsPresent: tokenStatus.credentialsPresent,
    usable,
    needsReconnect: tokenStatus.needsReconnect,
    error: accessError || friendlyXaiOAuthError(tokenStatus.error),
    source: tokenStatus.credentialsPresent ? selected.authority.source : null,
    hermesHome: tokenStatus.credentialsPresent ? selected.authority.hermesHome : null,
    accessTokenExpiresAt: tokenStatus.expiresAt,
    warnings: selected.warnings,
    login: loginFlow?.state ?? ({ phase: "idle" } as const),
  };
}

export async function startXaiOAuthLogin(): Promise<{ authorizeUrl: string }> {
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
          const warnings = await persistTokens(tokens, flow.discovery);
          flow.state = { phase: "connected", connectedAt: Date.now(), warnings };
          const page = callbackHtml(
            warnings.length ? "xAI connected with a warning" : "xAI connected",
            warnings.length
              ? "The HivemindOS OAuth session was saved, but an old shared-env copy could not be retired. Return to HivemindOS for details."
              : "Your local xAI OAuth session is connected and will refresh automatically. You can close this tab and return to HivemindOS.",
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

export async function submitXaiOAuthCode(input: { code?: unknown } = {}) {
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
  const tokens = await exchangeCodeForTokens(code, flow);
  const warnings = await persistTokens(tokens, flow.discovery);
  flow.state = { phase: "connected", connectedAt: Date.now(), warnings };
  closeLoginServer();
  return { warnings };
}

export function xaiOAuthLoginState(): XaiOAuthLoginState {
  return loginFlow?.state ?? { phase: "idle" };
}
