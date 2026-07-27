import { existsSync } from "node:fs";
import { homedir } from "@/lib/home-dir";
import { join } from "node:path";
import { listHivemindosModelCreditTokenSummaries } from "@/lib/services/hivemindos-model-credit-vault";
import {
  DEFAULT_MANAGED_X_API_BASE_URL,
  MANAGED_X_API_BASE_URL_ENV,
} from "@/lib/services/managed-x-api-client";
import {
  X_DOCS_MCP_URL,
  X_MCP_API_URL,
  X_MCP_CLIENT_ID_ENV,
  X_MCP_CLIENT_SECRET_ENV,
  X_MCP_REDIRECT_URI_ENV,
} from "@/lib/services/mcp/x-mcp";
import { hiveEnvPresence } from "@/lib/services/shared-hive-env";

/**
 * Static X / Twitter integration briefing, gated on a connected X path.
 *
 * Like the Bankr and ClawBank briefings, this keeps an agent's knowledge of
 * the X rails from depending on a latency-raced capability search. X is not
 * provider-specific: any agent on any runtime can use it through one of three
 * shared paths — the official xurl CLI's OAuth cache, a bring-your-own X
 * developer app (X_MCP_* keys in the shared hive env), or the managed
 * HivemindOS X API gateway (Sign in with X, hosted credit tokens stored
 * locally). The gate is presence of any path, never the agent profile. When
 * none is configured, a short instruction is
 * injected so agents tell the user to connect X under Integrations > MCP
 * Servers rather than role-playing X API actions.
 *
 * The facts arrays are reused verbatim by the context-index entry so
 * retrieval and this briefing never drift apart. Presence checks are local
 * only (shared-hive-env file and the encrypted credit-token vault) and report
 * credentials by key name and set/missing status — never values.
 */

const X_PRESENCE_TTL_MS = 30_000;

type XIntegrationPresence = {
  xurlCachePresent: boolean;
  byoCredentialsReady: boolean;
  managedCreditTokenStored: boolean;
};

let presenceCache: { presence: XIntegrationPresence; checkedAt: number } | null = null;

async function xIntegrationPresence(): Promise<XIntegrationPresence> {
  const now = Date.now();
  if (presenceCache && now - presenceCache.checkedAt < X_PRESENCE_TTL_MS) {
    return presenceCache.presence;
  }
  const [credentials, creditTokens] = await Promise.all([
    hiveEnvPresence([X_MCP_CLIENT_ID_ENV, X_MCP_CLIENT_SECRET_ENV]).catch(() => []),
    listHivemindosModelCreditTokenSummaries().catch(() => []),
  ]);
  const presence: XIntegrationPresence = {
    xurlCachePresent: existsSync(join(homedir(), ".xurl")),
    byoCredentialsReady: credentials.length > 0 && credentials.every((item) => item.present),
    managedCreditTokenStored: creditTokens.length > 0,
  };
  presenceCache = { presence, checkedAt: now };
  return presence;
}

export function clearXMcpPresenceCache() {
  presenceCache = null;
}

/** One fact per line; reused verbatim by the context-index entry so retrieval
 *  and the baked-in briefing never drift apart. */
export const X_MCP_PLATFORM_FACTS = [
  `X/Twitter has three shared paths: the official xurl CLI using its local OAuth session, the official X API MCP (${X_MCP_API_URL}) using a bring-your-own X developer app, and the managed HivemindOS X API gateway (hosted official-hosted-client mode) where the user completes Sign in with X, OAuth tokens stay in server-side custody, and calls are paid from hosted HivemindOS credits.`,
  `X API MCP capabilities: post search, user lookup, timelines, mentions, bookmarks, trends and news, and drafting or publishing Articles — all acting as the signed-in X account. The separate X Docs MCP (${X_DOCS_MCP_URL}) is read-only documentation search and needs no credentials.`,
  "Queen Bee and native HivemindOS chat expose read_x_account for authenticated, read-only latest-post, latest-reply, mentions, timeline, bookmarks, likes, search, and post-lookup operations backed by xurl.",
  `BYO path: save an X developer app client id/secret as ${X_MCP_CLIENT_ID_ENV} / ${X_MCP_CLIENT_SECRET_ENV} (optional ${X_MCP_REDIRECT_URI_ENV}) in the shared hive env, finish browser OAuth through the x-mcp-bridge script (an xurl wrapper; token cache at ~/.xurl), then sync the xapi MCP server into runtime configs for claude, codex, gemini, openclaw, hermes, and aeon.`,
  `Managed path: the hosted gateway (default ${DEFAULT_MANAGED_X_API_BASE_URL}, override ${MANAGED_X_API_BASE_URL_ENV}) bills each call to a hosted HivemindOS credit token stored encrypted under ~/.hivemindos per wallet/credit account, and reports the remaining credit balance in USD.`,
  "Write gate: any non-GET X API call through the managed proxy requires confirmation CONFIRM_X_API_CALL — the /api/integrations/x-managed route rejects unconfirmed writes and the hivemind-mcp x_api tool enforces the same token.",
] as const;

export const X_MCP_HIVEMIND_INTEGRATION_FACTS = [
  "Manage the X integration in the dashboard under Integrations > MCP Servers (the X account MCP panel): save BYO credentials, start OAuth, sync or remove the xapi runtime configs, connect X through the managed gateway, and watch readiness.",
  "Setup/status route: GET /api/integrations/x-mcp reports credential presence by key name, managed-gateway status, xurl cache, and per-runtime xapi config state; POST supports save-credentials, start-oauth, sync-runtimes, and remove-runtimes.",
  "Managed gateway route: GET /api/integrations/x-managed returns gateway status, stored hosted-credit accounts, credit balance, and X connections; POST supports oauth-start, balance, connections, and proxy. POST /api/integrations/x-managed/mcp proxies managed X MCP traffic billed to the stored credit token.",
  "Agent call path: the hivemind-mcp x_api tool wraps POST /api/integrations/x-managed action proxy (creditAccountId and path required; connectionId, slug, method, query, json optional). Non-GET methods must include confirmation CONFIRM_X_API_CALL.",
  "Discipline: start with reads (search, timelines, lookups, balance, connections). Write calls post or mutate as the connected X account and debit hosted credits, so get explicit user approval plus the CONFIRM_X_API_CALL token first. Refer to credentials by key name and set/missing status only; never print client secrets, OAuth tokens, or credit tokens.",
] as const;

/** Distilled X integration briefing when a path is connected; a
 *  do-not-role-play instruction when no path is configured. */
export async function buildXMcpCapabilityContext(): Promise<string> {
  const presence = await xIntegrationPresence();
  if (!presence.xurlCachePresent && !presence.byoCredentialsReady && !presence.managedCreditTokenStored) {
    return [
      "X / Twitter integration capability status:",
      `- No X integration is configured (no xurl OAuth cache, ${X_MCP_CLIENT_ID_ENV} / ${X_MCP_CLIENT_SECRET_ENV} unset in the shared hive env, and no hosted X credit token stored). If the user asks for anything X/Twitter API-related (posting, timelines, mentions, bookmarks, Articles, X API search), say X must be connected first under Integrations > MCP Servers and do not role-play or claim X API actions.`,
    ].join("\n");
  }
  const readiness = [
    presence.xurlCachePresent
      ? "the official xurl CLI OAuth cache is present (read_x_account available; the tool verifies the live session)"
      : "no local xurl OAuth cache is present",
    presence.byoCredentialsReady
      ? `BYO X developer app credentials are set (${X_MCP_CLIENT_ID_ENV} / ${X_MCP_CLIENT_SECRET_ENV})`
      : `BYO X developer app credentials are not set (${X_MCP_CLIENT_ID_ENV} / ${X_MCP_CLIENT_SECRET_ENV} missing)`,
    presence.managedCreditTokenStored
      ? "a hosted X credit token is stored for the managed gateway"
      : "no hosted X credit token is stored for the managed gateway",
  ].join("; ");
  return [
    "X / Twitter integration capability briefing (static, always available — do not claim you lack X integration knowledge if capability search times out):",
    `- Local readiness: ${readiness}. Live status: GET /api/integrations/x-mcp.`,
    ...X_MCP_PLATFORM_FACTS.map((fact) => `- ${fact}`),
    ...X_MCP_HIVEMIND_INTEGRATION_FACTS.map((fact) => `- ${fact}`),
  ].join("\n");
}
