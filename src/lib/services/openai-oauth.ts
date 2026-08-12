import "server-only";

import { createServer, type Server } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { writeSharedHiveEnvValues } from "@/lib/services/hive-env-write";
import { resilientHttpsFetch } from "@/lib/net/resilient-https-fetch";
import {
  buildOpenAiOAuthResponsesInput,
  buildOpenAiOAuthToolContinuationInput,
  type OpenAiOAuthChatMessage,
  type OpenAiOAuthToolContinuation,
} from "@/lib/services/openai-oauth-payload";

/**
 * ChatGPT OAuth for HivemindOS: the user's subscription credentials as a
 * first-class, fleet-shared provider — separate from OPENAI_API_KEY.
 *
 * Tokens live in the SHARED HIVE ENV (~/.hivemindos/.env), NOT the brain
 * vault: env keys replicate to every machine automatically (hive-env-add
 * tailnet sync + collector pull-reconcile), and the vault's standing rule is
 * status notes only, never plaintext secrets. Keys:
 *   OPENAI_OAUTH_ACCESS_TOKEN / OPENAI_OAUTH_REFRESH_TOKEN /
 *   OPENAI_OAUTH_ACCOUNT_ID / OPENAI_OAUTH_EXPIRES_AT
 * Override: OPENAI_PREFER_API_KEY=1 forces key-based calls even when OAuth
 * is connected.
 *
 * The sign-in flow, endpoints, and client id are the Codex CLI's PUBLIC OAuth
 * client (PKCE; its registered redirect is http://localhost:1455/auth/callback,
 * so the login listener must bind port 1455 for the duration of the flow).
 * HivemindOS runs its OWN grant — it never reads or refreshes ~/.codex tokens,
 * so it cannot invalidate the Codex CLI's session (refresh tokens rotate).
 * This is a beta/unofficial surface: every call fails loudly (degradation
 * alerts upstream), never silently.
 */

const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OAUTH_REDIRECT_PORT = 1455;
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_REDIRECT_PORT}/auth/callback`;
const OAUTH_SCOPE = "openid profile email offline_access";
export const OPENAI_OAUTH_RESPONSES_BASE_URL = "https://chatgpt.com/backend-api/codex";
const RESPONSES_URL = `${OPENAI_OAUTH_RESPONSES_BASE_URL}/responses`;
// Refresh slightly early so a turn never rides an expiring token.
const TOKEN_EXPIRY_SLACK_MS = 60_000;
const LOGIN_FLOW_TTL_MS = 10 * 60_000;

export const OPENAI_OAUTH_ENV_KEYS = {
  accessToken: "OPENAI_OAUTH_ACCESS_TOKEN",
  refreshToken: "OPENAI_OAUTH_REFRESH_TOKEN",
  accountId: "OPENAI_OAUTH_ACCOUNT_ID",
  expiresAt: "OPENAI_OAUTH_EXPIRES_AT",
} as const;

export type OpenAiOAuthLoginState =
  | { phase: "idle" }
  | { phase: "pending"; authorizeUrl: string; startedAt: number }
  | { phase: "connected"; connectedAt: number }
  | { phase: "error"; error: string };

type LoginFlow = {
  state: OpenAiOAuthLoginState;
  server: Server | null;
  verifier: string;
  oauthState: string;
  expiresAt: number;
};

let loginFlow: LoginFlow | null = null;
// Serialize refreshes in this process: OpenAI rotates refresh tokens, so two
// concurrent refreshes would invalidate each other. (Cross-machine races are
// mitigated, not eliminated: refreshes are rare — tokens last hours — and the
// rotated pair is written back to the shared env immediately, which syncs.)
let refreshInFlight: Promise<string> | null = null;

function base64Url(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1] ?? "";
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function accountIdFromIdToken(idToken: string | undefined): string {
  if (!idToken) return "";
  const claims = decodeJwtClaims(idToken);
  const auth = claims?.["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
  const accountId = auth?.chatgpt_account_id;
  return typeof accountId === "string" ? accountId : "";
}

export async function openAiOAuthConfigured(): Promise<boolean> {
  const refresh = await hiveEnvValue(OPENAI_OAUTH_ENV_KEYS.refreshToken).catch(() => "");
  return Boolean(refresh);
}

export async function preferOpenAiApiKey(): Promise<boolean> {
  const raw =
    process.env.OPENAI_PREFER_API_KEY?.trim() ||
    (await hiveEnvValue("OPENAI_PREFER_API_KEY").catch(() => ""));
  return raw === "1" || raw.toLowerCase() === "true";
}

export async function openAiOAuthStatus() {
  const [refresh, accountId, expiresAtRaw] = await Promise.all([
    hiveEnvValue(OPENAI_OAUTH_ENV_KEYS.refreshToken).catch(() => ""),
    hiveEnvValue(OPENAI_OAUTH_ENV_KEYS.accountId).catch(() => ""),
    hiveEnvValue(OPENAI_OAUTH_ENV_KEYS.expiresAt).catch(() => ""),
  ]);
  return {
    connected: Boolean(refresh),
    accountIdPresent: Boolean(accountId),
    accessTokenExpiresAt: Number(expiresAtRaw) || null,
    preferApiKey: await preferOpenAiApiKey(),
    login: loginFlow?.state ?? ({ phase: "idle" } as const),
  };
}

async function exchangeToken(body: Record<string, string>) {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    error?: { message?: string } | string;
    error_description?: string;
  } | null;
  if (!response.ok || !data?.access_token) {
    const detail =
      data?.error_description ||
      (typeof data?.error === "string" ? data.error : data?.error?.message);
    throw new Error(detail || `OpenAI OAuth token endpoint returned HTTP ${response.status}.`);
  }
  return data;
}

async function persistTokens(data: {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}) {
  const expiresAt = Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000;
  const values: Record<string, string> = {
    [OPENAI_OAUTH_ENV_KEYS.accessToken]: data.access_token,
    [OPENAI_OAUTH_ENV_KEYS.expiresAt]: String(expiresAt),
  };
  if (data.refresh_token) values[OPENAI_OAUTH_ENV_KEYS.refreshToken] = data.refresh_token;
  const accountId = accountIdFromIdToken(data.id_token);
  if (accountId) values[OPENAI_OAUTH_ENV_KEYS.accountId] = accountId;
  await writeSharedHiveEnvValues(values);
  return expiresAt;
}

function closeLoginServer() {
  try {
    loginFlow?.server?.close();
  } catch {
    /* already closed */
  }
  if (loginFlow) loginFlow.server = null;
}

/**
 * Start (or restart) the sign-in flow: binds the OAuth client's registered
 * localhost callback port for up to 10 minutes and returns the authorize URL
 * for the user's browser. If another process owns port 1455 (e.g. a Codex CLI
 * login in progress), this fails with a clear message — it NEVER kills the
 * port owner.
 */
export async function startOpenAiOAuthLogin(): Promise<{ authorizeUrl: string }> {
  closeLoginServer();
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const oauthState = base64Url(randomBytes(24));
  const authorizeUrl = `${OAUTH_AUTHORIZE_URL}?${new URLSearchParams({
    response_type: "code",
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    scope: OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: oauthState,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
  }).toString()}`;

  const flow: LoginFlow = {
    state: { phase: "pending", authorizeUrl, startedAt: Date.now() },
    server: null,
    verifier,
    oauthState,
    expiresAt: Date.now() + LOGIN_FLOW_TTL_MS,
  };

  await new Promise<void>((resolve, reject) => {
    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", `http://localhost:${OAUTH_REDIRECT_PORT}`);
        if (url.pathname !== "/auth/callback") {
          response.writeHead(404).end("Not found");
          return;
        }
        const finish = (status: number, message: string) => {
          response
            .writeHead(status, { "content-type": "text/html; charset=utf-8" })
            .end(`<!doctype html><body style="font-family:system-ui;padding:3rem;text-align:center"><h2>${message}</h2><p>You can close this tab and return to HivemindOS.</p></body>`);
        };
        try {
          const error = url.searchParams.get("error_description") || url.searchParams.get("error");
          if (error) throw new Error(error);
          if (url.searchParams.get("state") !== flow.oauthState) {
            throw new Error("OAuth state mismatch — restart the sign-in from HivemindOS.");
          }
          const code = url.searchParams.get("code") ?? "";
          if (!code) throw new Error("The OAuth callback carried no authorization code.");
          const tokens = await exchangeToken({
            grant_type: "authorization_code",
            code,
            redirect_uri: OAUTH_REDIRECT_URI,
            client_id: OAUTH_CLIENT_ID,
            code_verifier: flow.verifier,
          });
          await persistTokens(tokens as { access_token: string });
          flow.state = { phase: "connected", connectedAt: Date.now() };
          finish(200, "ChatGPT connected ✓");
        } catch (callbackError) {
          const message =
            callbackError instanceof Error ? callbackError.message : String(callbackError);
          flow.state = { phase: "error", error: message };
          finish(400, `Sign-in failed: ${message}`);
        } finally {
          closeLoginServer();
        }
      })();
    });
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          error.code === "EADDRINUSE"
            ? `Port ${OAUTH_REDIRECT_PORT} is in use (another OAuth login — possibly Codex CLI — may be running). Finish or stop it, then retry; HivemindOS never frees the port by killing its owner.`
            : error.message,
        ),
      );
    });
    server.listen(OAUTH_REDIRECT_PORT, "127.0.0.1", () => resolve());
    flow.server = server;
    // The flow self-expires; the timer must not keep the process alive.
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

export function openAiOAuthLoginState(): OpenAiOAuthLoginState {
  return loginFlow?.state ?? { phase: "idle" };
}

/** Valid access token, refreshing (and re-persisting the rotated pair) when
 *  needed. Throws with a human-readable reason when OAuth is not connected. */
export async function getOpenAiOAuthAccess(): Promise<{ accessToken: string; accountId: string }> {
  const [access, refresh, accountId, expiresAtRaw] = await Promise.all([
    hiveEnvValue(OPENAI_OAUTH_ENV_KEYS.accessToken).catch(() => ""),
    hiveEnvValue(OPENAI_OAUTH_ENV_KEYS.refreshToken).catch(() => ""),
    hiveEnvValue(OPENAI_OAUTH_ENV_KEYS.accountId).catch(() => ""),
    hiveEnvValue(OPENAI_OAUTH_ENV_KEYS.expiresAt).catch(() => ""),
  ]);
  if (!refresh) {
    throw new Error("ChatGPT OAuth is not connected (no OPENAI_OAUTH_REFRESH_TOKEN in the shared hive env). Connect it from Calls settings.");
  }
  const expiresAt = Number(expiresAtRaw) || 0;
  if (access && Date.now() < expiresAt - TOKEN_EXPIRY_SLACK_MS) {
    return { accessToken: access, accountId };
  }
  refreshInFlight ??= (async () => {
    try {
      const tokens = await exchangeToken({
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: OAUTH_CLIENT_ID,
        scope: OAUTH_SCOPE,
      });
      await persistTokens(tokens as { access_token: string });
      return tokens.access_token as string;
    } finally {
      refreshInFlight = null;
    }
  })();
  const accessToken = await refreshInFlight;
  const refreshedAccountId =
    accountId || (await hiveEnvValue(OPENAI_OAUTH_ENV_KEYS.accountId).catch(() => ""));
  return { accessToken, accountId: refreshedAccountId };
}

function openAiOAuthRequestUrl(input: RequestInfo | URL): URL {
  const value =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(value);
  const baseUrl = new URL(OPENAI_OAUTH_RESPONSES_BASE_URL);
  const staysWithinBackend =
    url.origin === baseUrl.origin &&
    (url.pathname === baseUrl.pathname || url.pathname.startsWith(`${baseUrl.pathname}/`));
  if (!staysWithinBackend) {
    throw new Error("Refusing to send ChatGPT OAuth credentials outside the Codex backend.");
  }
  return url;
}

/**
 * Canonical authenticated transport for every ChatGPT OAuth Responses caller.
 * It owns token refresh, account routing, headers, and the credential boundary.
 */
export async function openAiOAuthFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  openAiOAuthRequestUrl(input);
  const { accessToken, accountId } = await getOpenAiOAuthAccess();
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "text/event-stream");
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("originator", "codex_cli_rs");
  headers.set("session_id", randomUUID());
  if (accountId) headers.set("chatgpt-account-id", accountId);
  else headers.delete("chatgpt-account-id");
  return resilientHttpsFetch(input, { ...init, headers });
}

/**
 * Authenticated request to the ChatGPT/Codex Responses backend. Keeping this
 * transport here ensures chat and media capabilities share token refresh,
 * account routing, and the exact Codex client headers.
 */
export async function openAiOAuthResponsesRequest(
  body: Record<string, unknown>,
  options: { timeoutMs?: number; errorContext?: string } = {},
): Promise<Response> {
  const response = await openAiOAuthFetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
  if (response.ok && response.body) return response;

  const text = await response.text().catch(() => "");
  let detail = text.slice(0, 240);
  try {
    const parsed = JSON.parse(text) as { detail?: string; error?: { message?: string } | string };
    detail =
      (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) ||
      parsed.detail ||
      detail;
  } catch {
    /* not json */
  }
  throw new Error(
    detail || `${options.errorContext ?? "ChatGPT OAuth request"} returned HTTP ${response.status}.`,
  );
}

export type OpenAiOAuthToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type OpenAiOAuthChatTurnResult = {
  text: string;
  toolCalls: OpenAiOAuthToolCall[];
};

function responsesTools(tools: Array<Record<string, unknown>> | undefined) {
  return (tools ?? []).map((tool) => {
    const fn = tool.function;
    if (tool.type !== "function" || !fn || typeof fn !== "object") return tool;
    return { type: "function", ...(fn as Record<string, unknown>) };
  });
}

/** Structured conversation turn for callers that need Responses function calls. */
export async function runOpenAiOAuthChatTurnDetailed(
  model: string,
  messages: OpenAiOAuthChatMessage[],
  options: {
    images?: string[];
    maxOutputTokens?: number;
    onTextDelta?: (chunk: string) => void;
    timeoutMs?: number;
    tools?: Array<Record<string, unknown>>;
    assistantText?: string;
    toolResults?: OpenAiOAuthToolContinuation[];
  } = {},
): Promise<OpenAiOAuthChatTurnResult> {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  const input = [
    ...buildOpenAiOAuthResponsesInput(messages, options.images),
    ...buildOpenAiOAuthToolContinuationInput(
      options.assistantText ?? "",
      options.toolResults ?? [],
    ),
  ];
  const response = await openAiOAuthResponsesRequest(
    {
      model,
      instructions: instructions || undefined,
      input,
      stream: true,
      store: false,
      ...(options.tools?.length
        ? { tools: responsesTools(options.tools), tool_choice: "auto" }
        : {}),
      // Voice turns want first tokens fast; the backend accepts the standard
      // Responses reasoning knob for reasoning models and ignores it otherwise.
      // NOTE: the codex backend rejects max_output_tokens ("Unsupported
      // parameter", verified live 2026-07-03) — length is prompt-governed.
      reasoning: { effort: "low" },
    },
    { timeoutMs: options.timeoutMs, errorContext: "ChatGPT OAuth chat" },
  );
  if (!response.body) throw new Error("ChatGPT OAuth chat returned no response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let failure = "";
  const toolCalls: OpenAiOAuthToolCall[] = [];
  const consume = (raw: string) => {
    if (!raw || raw === "[DONE]") return;
    try {
      const event = JSON.parse(raw) as {
        type?: string;
        delta?: string;
        response?: { error?: { message?: string } };
        item?: {
          type?: string;
          id?: string;
          call_id?: string;
          name?: string;
          arguments?: string;
        };
      };
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        text += event.delta;
        options.onTextDelta?.(event.delta);
      } else if (event.type === "response.failed") {
        failure = event.response?.error?.message || "The ChatGPT backend reported a failed response.";
      } else if (
        event.type === "response.output_item.done" &&
        event.item?.type === "function_call" &&
        event.item.name
      ) {
        toolCalls.push({
          id: event.item.call_id || event.item.id || `oauth_tool_${toolCalls.length}`,
          name: event.item.name,
          arguments: event.item.arguments || "{}",
        });
      }
    } catch {
      /* keep-alives and unknown frames are skipped */
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary < 0) break;
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        consume(
          frame
            .split(/\n/)
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n"),
        );
      }
    }
    if (done) break;
  }
  if (failure && !text.trim()) throw new Error(failure);
  return { text: text.trim(), toolCalls };
}

/**
 * One text conversation turn over the ChatGPT backend Responses API using the
 * user's OAuth credentials. Structured callers use the detailed variant above.
 */
export async function runOpenAiOAuthChatTurn(
  model: string,
  messages: OpenAiOAuthChatMessage[],
  options: { images?: string[]; maxOutputTokens?: number; onTextDelta?: (chunk: string) => void; timeoutMs?: number } = {},
): Promise<string> {
  return (await runOpenAiOAuthChatTurnDetailed(model, messages, options)).text;
}
