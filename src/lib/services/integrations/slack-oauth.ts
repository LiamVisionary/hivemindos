import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { writeSharedHiveEnvValues } from "@/lib/services/hive-env-write";
import { SLACK_OAUTH_CLIENT_ID_ENV, SLACK_TOKEN_ENV } from "@/lib/services/integrations/provider-connection-env";

/**
 * Slack OAuth for HivemindOS — the CONFIDENTIAL-client broker model (like the
 * Google Cloud connector), because HivemindOS is a DISTRIBUTED desktop app.
 *
 * Why not the localhost/PKCE flow: Slack requires an HTTPS, EXACT-match redirect
 * (no loopback-port wildcard, unlike Google desktop clients), and it requires a
 * client_secret unless the app is marked a public/PKCE client — a one-way switch
 * we don't want on thousands of installs. So instead the client stays confidential
 * and the secret lives ONLY in the hosted exchange Worker (never in this binary or
 * the MIT repo), exactly like google-cloud-oauth.ts.
 *
 * Flow (see the Worker's /slack/* routes):
 *   1. start: mint a public session id `sid` + a private `pollSecret`; pre-register
 *      {sid, sha256(pollSecret)} at the Worker; open Slack's consent with the
 *      Worker's HTTPS /slack/callback as redirect_uri and state=sid.
 *   2. Slack redirects the browser to the Worker; the Worker exchanges the code
 *      WITH the client_secret it holds, stashing the xoxp- user token in KV.
 *   3. poll: the app fetches the token from the Worker, proving ownership with
 *      `pollSecret` (which never traversed the browser/Slack), then stores it in
 *      the shared hive env under SLACK_TOKEN_ENV ("SLACK_BOT_TOKEN").
 *
 * `pollSecret` is kept SERVER-SIDE here (a module-level map keyed by sid); the UI
 * only ever holds the public `sid`. The token never appears in any URL.
 */

const SLACK_OAUTH_CLIENT_ID_PLACEHOLDER = "REPLACE_WITH_HIVEMINDOS_SLACK_CLIENT_ID";
// Public HivemindOS Slack app client id (a client id is not a secret — it rides
// in every authorize URL). Override per-machine with the SLACK_OAUTH_CLIENT_ID env
// var. The client SECRET is never here; it lives only in the exchange Worker.
const SLACK_OAUTH_CLIENT_ID_DEFAULT = "11552592014514.11552619377954";

const OAUTH_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
// The hosted exchange Worker (holds SLACK_CLIENT_SECRET). Same Worker the Google
// Cloud connector uses; override with SLACK_OAUTH_BROKER_URL.
const OAUTH_BROKER_URL_DEFAULT = "https://hivemindos-google-oauth-exchange.hivemindos.workers.dev";
const SLACK_CALLBACK_PATH = "/slack/callback";
// Minimal user scope: post messages as the connecting user. Widen here later.
const OAUTH_USER_SCOPE = "chat:write";
const FLOW_TTL_MS = 10 * 60_000;

/** The effective client id: env override wins, else the baked-in default. */
export function slackOAuthClientId(): string {
  return (process.env[SLACK_OAUTH_CLIENT_ID_ENV]?.trim() || SLACK_OAUTH_CLIENT_ID_DEFAULT).trim();
}

/** True once a usable (non-placeholder) client id is baked in or supplied via env. */
export function slackOAuthClientReady(): boolean {
  const clientId = slackOAuthClientId();
  return Boolean(clientId) && clientId !== SLACK_OAUTH_CLIENT_ID_PLACEHOLDER;
}

function slackBrokerUrl(): string {
  return (
    process.env.SLACK_OAUTH_BROKER_URL?.trim() ||
    process.env.GOOGLE_CLOUD_OAUTH_EXCHANGE_URL?.trim() ||
    OAUTH_BROKER_URL_DEFAULT
  ).replace(/\/+$/, "");
}

/** The stable HTTPS redirect registered in the Slack app (the Worker's callback). */
function slackRedirectUri(): string {
  return `${slackBrokerUrl()}${SLACK_CALLBACK_PATH}`;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Server-side pending flows persisted to a small file: sid -> pollSecret. A file
// (not a module-level Map) because the /start and /poll routes are separate route
// modules and Next dev wipes module state on recompile — an in-memory map goes
// empty mid-flow and every poll reports "expired". The UI only holds the public sid.
const HIVE_DIR = join(homedir(), ".hivemindos");
const PENDING_FILE = join(HIVE_DIR, "slack-oauth-pending.json");
type PendingFlow = { pollSecret: string; created: number };
type PendingStore = Record<string, PendingFlow>;

function readPending(): PendingStore {
  let store: PendingStore;
  try {
    store = JSON.parse(readFileSync(PENDING_FILE, "utf8")) as PendingStore;
  } catch {
    return {};
  }
  // Prune expired entries so the file can't grow unbounded.
  const cutoff = Date.now() - FLOW_TTL_MS;
  let changed = false;
  for (const [sid, flow] of Object.entries(store)) {
    if (!flow || typeof flow.created !== "number" || flow.created < cutoff) {
      delete store[sid];
      changed = true;
    }
  }
  if (changed) writePending(store);
  return store;
}

function writePending(store: PendingStore): void {
  try {
    mkdirSync(HIVE_DIR, { recursive: true });
    writeFileSync(PENDING_FILE, JSON.stringify(store), { mode: 0o600 });
  } catch {
    // Best-effort: a write failure just means the next poll reports "expired".
  }
}

/**
 * Begin a Slack connect: pre-register the rendezvous at the Worker and return the
 * authorize URL plus a `flowId` (the public session id) the UI polls with. Returns
 * `missing` (non-empty) when the client isn't configured.
 */
export async function startSlackConnect(): Promise<{ authorizeUrl: string; flowId: string; missing: string[] }> {
  if (!slackOAuthClientReady()) {
    return { authorizeUrl: "", flowId: "", missing: [SLACK_OAUTH_CLIENT_ID_ENV] };
  }

  const sid = base64Url(randomBytes(32));
  const pollSecret = base64Url(randomBytes(32));
  const pollHash = base64Url(createHash("sha256").update(pollSecret).digest());
  const clientId = slackOAuthClientId();
  const redirectUri = slackRedirectUri();

  // Pre-register {sid, sha256(pollSecret)} so the Worker will only release the
  // token to a caller that can present pollSecret.
  const response = await fetch(`${slackBrokerUrl()}/slack/start`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sid, poll_hash: pollHash, client_id: clientId, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Could not start the Slack sign-in (HTTP ${response.status}).`);
  }

  const store = readPending();
  store[sid] = { pollSecret, created: Date.now() };
  writePending(store);

  const authorizeUrl = `${OAUTH_AUTHORIZE_URL}?${new URLSearchParams({
    user_scope: OAUTH_USER_SCOPE,
    client_id: clientId,
    redirect_uri: redirectUri,
    state: sid,
  }).toString()}`;

  return { authorizeUrl, flowId: sid, missing: [] };
}

export type SlackPollStatus = "pending" | "connected" | "expired" | "error";

/**
 * Poll the Worker for the flow's outcome. On "connected" the xoxp- user token has
 * been persisted to the shared hive env under SLACK_TOKEN_ENV. Never returns or
 * logs the token itself.
 */
export async function pollSlackConnect(flowId: string): Promise<{ status: SlackPollStatus; error?: string }> {
  const store = readPending();
  const pending = store[flowId];
  if (!pending) return { status: "expired" };
  const forget = () => {
    delete store[flowId];
    writePending(store);
  };

  const response = await fetch(`${slackBrokerUrl()}/slack/result`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sid: flowId, poll_secret: pending.pollSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => null)) as
    | { ok?: boolean; status?: string; token?: string; error?: string }
    | null;
  if (!response.ok || !data?.ok) {
    // 403 (forbidden) or a transport error — treat as a hard stop.
    forget();
    return { status: "error", error: data?.error || `Sign-in check failed (HTTP ${response.status}).` };
  }

  if (data.status === "pending") return { status: "pending" };
  if (data.status === "expired") {
    forget();
    return { status: "expired" };
  }
  if (data.status === "error") {
    forget();
    return { status: "error", error: data.error };
  }

  // "ready": persist the token, then clear the local pending entry.
  const token = (data.token || "").trim();
  forget();
  if (!token) return { status: "error", error: "Slack returned no user token." };
  // Value travels to hive-env-add over stdin (never logged).
  await writeSharedHiveEnvValues({ [SLACK_TOKEN_ENV]: token });
  return { status: "connected" };
}
