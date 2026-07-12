import "server-only";

import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import type { McpToolInfo } from "@/lib/services/mcp/client";
import {
  clearRobinhoodMcpVault,
  readRobinhoodMcpVault,
  updateRobinhoodMcpVault,
  type RobinhoodMcpPendingOAuth,
} from "@/lib/services/mcp/robinhood-mcp-vault";
import {
  ROBINHOOD_ORDER_FIELD_ALIASES,
  buildRobinhoodEquityOrderArgs,
  robinhoodSchemaAliasKey,
  type RobinhoodEquityOrderInput,
} from "@/lib/services/trading/robinhood-agentic-order";

export const ROBINHOOD_TRADING_MCP_URL = "https://agent.robinhood.com/mcp/trading";

export const ROBINHOOD_AGENTIC_READ_TOOLS = [
  "get_accounts",
  "get_portfolio",
  "get_realized_pnl",
  "get_pnl_trade_history",
  "search",
  "get_watchlists",
  "get_watchlist_items",
  "get_option_watchlist",
  "get_popular_watchlists",
  "get_equity_historicals",
  "get_equity_fundamentals",
  "get_equity_technical_indicators",
  "get_earnings_results",
  "get_earnings_calendar",
  "get_indexes",
  "get_index_quotes",
  "get_equity_positions",
  "get_equity_quotes",
  "get_equity_orders",
  "get_equity_tradability",
  "get_option_level_upgrade_info",
  "get_option_chains",
  "get_option_instruments",
  "get_option_quotes",
  "get_option_positions",
  "get_option_orders",
  "get_scans",
  "run_scan",
] as const;

const ROBINHOOD_AGENTIC_TRADE_TOOLS = new Set([
  "review_equity_order",
  "place_equity_order",
  "cancel_equity_order",
]);
const READ_TOOL_SET = new Set<string>(ROBINHOOD_AGENTIC_READ_TOOLS);

export type RobinhoodAgenticAccount = {
  id: string;
  label: string;
  agentic: boolean;
};

export type RobinhoodAgenticStatus = {
  connected: boolean;
  authorizationPending: boolean;
  authorizationUrl?: string;
  selectedAccountId?: string;
  accounts: RobinhoodAgenticAccount[];
  tools: McpToolInfo[];
  missingTools: string[];
  error?: string;
};

type LiveConnection = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  tools: McpToolInfo[];
};

let liveConnection: LiveConnection | null = null;
let reconnectPromise: Promise<LiveConnection> | null = null;

class RobinhoodOAuthProvider implements OAuthClientProvider {
  private authorizationUrl?: string;

  constructor(
    private readonly pending: RobinhoodMcpPendingOAuth,
  ) {}

  get redirectUrl() {
    return this.pending.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "HivemindOS",
      client_uri: "https://hivemindos.com",
      redirect_uris: [this.pending.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "internal",
    };
  }

  state() {
    return this.pending.state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await readRobinhoodMcpVault()).clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    await updateRobinhoodMcpVault((current) => ({ ...current, clientInformation }));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await readRobinhoodMcpVault()).tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    await updateRobinhoodMcpVault((current) => ({ ...current, tokens }));
  }

  async redirectToAuthorization(authorizationUrl: URL) {
    this.authorizationUrl = authorizationUrl.toString();
    await updateRobinhoodMcpVault((current) => ({
      ...current,
      pending: current.pending ? { ...current.pending, authorizationUrl: this.authorizationUrl } : this.pending,
    }));
  }

  async saveCodeVerifier(codeVerifier: string) {
    await updateRobinhoodMcpVault((current) => ({
      ...current,
      pending: current.pending ? { ...current.pending, codeVerifier } : { ...this.pending, codeVerifier },
    }));
  }

  async codeVerifier() {
    const codeVerifier = (await readRobinhoodMcpVault()).pending?.codeVerifier;
    if (!codeVerifier) throw new Error("Robinhood authorization verifier is missing. Start the connection again.");
    return codeVerifier;
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState) {
    await updateRobinhoodMcpVault((current) => ({ ...current, discoveryState }));
  }

  async discoveryState() {
    return (await readRobinhoodMcpVault()).discoveryState;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    await updateRobinhoodMcpVault((current) => {
      const next = { ...current };
      if (scope === "all" || scope === "client") delete next.clientInformation;
      if (scope === "all" || scope === "tokens") delete next.tokens;
      if (scope === "all" || scope === "verifier") {
        if (next.pending) next.pending = { ...next.pending, codeVerifier: undefined };
      }
      if (scope === "all" || scope === "discovery") delete next.discoveryState;
      return next;
    });
  }

  get capturedAuthorizationUrl() {
    return this.authorizationUrl;
  }
}

function freshPending(redirectUri: string): RobinhoodMcpPendingOAuth {
  return {
    redirectUri,
    state: randomBytes(24).toString("base64url"),
    createdAt: new Date().toISOString(),
  };
}

function makeTransport(provider: OAuthClientProvider) {
  return new StreamableHTTPClientTransport(new URL(ROBINHOOD_TRADING_MCP_URL), { authProvider: provider });
}

async function establishConnection(provider: RobinhoodOAuthProvider): Promise<LiveConnection> {
  if (liveConnection) return liveConnection;
  if (reconnectPromise) return reconnectPromise;
  reconnectPromise = (async () => {
    const transport = makeTransport(provider);
    const client = new Client({ name: "hivemindos-robinhood", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    const listed = await client.listTools();
    const tools: McpToolInfo[] = (listed.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations as Record<string, unknown> | undefined,
    }));
    liveConnection = { client, transport, tools };
    await updateRobinhoodMcpVault((current) => ({
      ...current,
      pending: undefined,
      tools,
      connectedAt: new Date().toISOString(),
    }));
    return liveConnection;
  })();
  try {
    return await reconnectPromise;
  } finally {
    reconnectPromise = null;
  }
}

async function closeLiveConnection() {
  const connection = liveConnection;
  liveConnection = null;
  if (!connection) return;
  await connection.client.close().catch(() => undefined);
}

export async function startRobinhoodAgenticOAuth(redirectUri: string): Promise<RobinhoodAgenticStatus> {
  const callback = new URL(redirectUri);
  if (!/^https?:$/.test(callback.protocol)) throw new Error("Robinhood OAuth callback must use HTTP or HTTPS.");
  await closeLiveConnection();
  const pending = freshPending(callback.toString());
  await updateRobinhoodMcpVault((current) => ({ ...current, redirectUri: pending.redirectUri, pending }));
  const provider = new RobinhoodOAuthProvider(pending);
  try {
    await establishConnection(provider);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
  }
  const status = await robinhoodAgenticStatus({ reconnect: false, includeAccounts: false });
  const authorizationUrl = provider.capturedAuthorizationUrl || (await readRobinhoodMcpVault()).pending?.authorizationUrl;
  if (!status.connected && !authorizationUrl) throw new Error("Robinhood did not return an authorization URL.");
  return { ...status, authorizationUrl };
}

export async function finishRobinhoodAgenticOAuth(input: { code: string; state: string }): Promise<RobinhoodAgenticStatus> {
  const stored = await readRobinhoodMcpVault();
  const pending = stored.pending;
  if (!pending || !input.code || input.state !== pending.state) {
    throw new Error("Robinhood authorization expired or did not match this HivemindOS session. Start the connection again.");
  }
  const provider = new RobinhoodOAuthProvider(pending);
  const authTransport = makeTransport(provider);
  await authTransport.finishAuth(input.code);
  await establishConnection(provider);
  return robinhoodAgenticStatus({ reconnect: false, includeAccounts: true });
}

async function reconnectFromVault(): Promise<LiveConnection> {
  const stored = await readRobinhoodMcpVault();
  if (!stored.tokens) throw new Error("Connect Robinhood Agentic Trading in Integrations first.");
  const pending = stored.pending ?? freshPending(stored.redirectUri || "http://127.0.0.1/api/integrations/robinhood-mcp/callback");
  return establishConnection(new RobinhoodOAuthProvider(pending));
}

async function requireConnection() {
  return liveConnection ?? reconnectFromVault();
}

export async function disconnectRobinhoodAgentic(): Promise<void> {
  await closeLiveConnection();
  await clearRobinhoodMcpVault();
}

export async function selectRobinhoodAgenticAccount(accountId: string): Promise<void> {
  const accounts = await listRobinhoodAgenticAccounts();
  if (!accounts.some((account) => account.id === accountId)) throw new Error("Choose an account returned by Robinhood.");
  await updateRobinhoodMcpVault((current) => ({ ...current, selectedAccountId: accountId }));
}

export async function callRobinhoodAgenticReadTool(tool: string, args: Record<string, unknown> = {}) {
  if (!READ_TOOL_SET.has(tool)) throw new Error(`Robinhood tool "${tool}" is not in the read-only allowlist.`);
  const connection = await requireConnection();
  if (!connection.tools.some((candidate) => candidate.name === tool)) throw new Error(`Robinhood did not expose the ${tool} tool for this account.`);
  return unwrapMcpResult(await connection.client.callTool({ name: tool, arguments: args }));
}

async function callTradeTool(tool: string, args: Record<string, unknown>) {
  if (!ROBINHOOD_AGENTIC_TRADE_TOOLS.has(tool)) throw new Error(`Robinhood trading tool "${tool}" is not allowed.`);
  const connection = await requireConnection();
  if (!connection.tools.some((candidate) => candidate.name === tool)) throw new Error(`Robinhood did not expose the ${tool} tool for this account.`);
  return unwrapMcpResult(await connection.client.callTool({ name: tool, arguments: args }));
}

export function unwrapMcpResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  if (record.structuredContent !== undefined) return record.structuredContent;
  if (!Array.isArray(record.content)) return result;
  const text = record.content
    .map((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text" ? String((item as Record<string, unknown>).text ?? "") : "")
    .filter(Boolean)
    .join("\n");
  if (!text) return result;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function nestedRecords(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) nestedRecords(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const record = value as Record<string, unknown>;
  out.push(record);
  for (const child of Object.values(record)) nestedRecords(child, out);
  return out;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

export function normalizeRobinhoodAccounts(result: unknown): RobinhoodAgenticAccount[] {
  const seen = new Set<string>();
  const accounts: RobinhoodAgenticAccount[] = [];
  for (const record of nestedRecords(result)) {
    const id = firstString(record, ["account_number", "accountNumber", "account_id", "accountId", "id"]);
    if (!id || seen.has(id)) continue;
    const kind = firstString(record, ["account_type", "accountType", "type", "name", "nickname", "title"]);
    const haystack = `${kind} ${JSON.stringify(record)}`.toLowerCase();
    const accountLike = haystack.includes("account") || Object.keys(record).some((key) => /account/i.test(key));
    if (!accountLike) continue;
    seen.add(id);
    const agentic = haystack.includes("agentic");
    accounts.push({ id, agentic, label: kind || (agentic ? "Robinhood Agentic account" : `Robinhood account ${id.slice(-4)}`) });
  }
  return accounts.sort((left, right) => Number(right.agentic) - Number(left.agentic));
}

export async function listRobinhoodAgenticAccounts(): Promise<RobinhoodAgenticAccount[]> {
  return normalizeRobinhoodAccounts(await callRobinhoodAgenticReadTool("get_accounts"));
}

async function selectedAccountId(): Promise<string | undefined> {
  const stored = await readRobinhoodMcpVault();
  if (stored.selectedAccountId) return stored.selectedAccountId;
  const accounts = await listRobinhoodAgenticAccounts();
  const agentic = accounts.filter((account) => account.agentic);
  const selected = agentic.length === 1 ? agentic[0] : accounts.length === 1 ? accounts[0] : undefined;
  if (selected) await updateRobinhoodMcpVault((current) => ({ ...current, selectedAccountId: selected.id }));
  return selected?.id;
}

async function tradeToolArgs(tool: string, input: RobinhoodEquityOrderInput) {
  const connection = await requireConnection();
  const descriptor = connection.tools.find((candidate) => candidate.name === tool);
  if (!descriptor) throw new Error(`Robinhood did not expose ${tool}. Reconnect the integration and check account eligibility.`);
  return buildRobinhoodEquityOrderArgs(descriptor.inputSchema, input);
}

function findReference(value: unknown): string {
  for (const record of nestedRecords(value)) {
    const reference = firstString(record, ["order_id", "orderId", "id", "reference"]);
    if (reference) return reference;
  }
  return "submitted";
}

function conciseResult(value: unknown) {
  if (typeof value === "string") return value.slice(0, 600);
  try {
    return JSON.stringify(value).slice(0, 600);
  } catch {
    return "Robinhood accepted the request.";
  }
}

export async function reviewRobinhoodAgenticEquityOrder(input: Omit<RobinhoodEquityOrderInput, "accountId">) {
  const accountId = await selectedAccountId();
  if (!accountId) throw new Error("Choose the dedicated Agentic account in Integrations before trading.");
  const args = await tradeToolArgs("review_equity_order", { ...input, accountId });
  return callTradeTool("review_equity_order", args);
}

export async function placeRobinhoodAgenticEquityOrder(input: Omit<RobinhoodEquityOrderInput, "accountId">) {
  const accountId = await selectedAccountId();
  if (!accountId) throw new Error("Choose the dedicated Agentic account in Integrations before trading.");
  const review = await reviewRobinhoodAgenticEquityOrder(input);
  const args = await tradeToolArgs("place_equity_order", { ...input, accountId });
  const placed = await callTradeTool("place_equity_order", args);
  return { review, placed, reference: findReference(placed), detail: conciseResult(placed) };
}

export async function cancelRobinhoodAgenticEquityOrder(orderId: string) {
  const connection = await requireConnection();
  const descriptor = connection.tools.find((candidate) => candidate.name === "cancel_equity_order");
  if (!descriptor) throw new Error("Robinhood did not expose cancel_equity_order.");
  const schema = descriptor.inputSchema && typeof descriptor.inputSchema === "object" ? descriptor.inputSchema as { properties?: Record<string, { type?: string }>; required?: string[] } : {};
  const properties = schema.properties ?? {};
  const orderKey = ["order_id", "orderId", "id"].find((key) => Object.prototype.hasOwnProperty.call(properties, key));
  const accountKey = robinhoodSchemaAliasKey(properties, ROBINHOOD_ORDER_FIELD_ALIASES.accountId);
  if (!orderKey) throw new Error("Robinhood's cancel schema does not expose a recognized order id field.");
  const args: Record<string, unknown> = { [orderKey]: orderId };
  if (accountKey) args[accountKey] = await selectedAccountId();
  const missing = (schema.required ?? []).filter((key) => args[key] === undefined);
  if (missing.length) throw new Error(`Robinhood's cancel schema needs fields HivemindOS could not safely derive: ${missing.join(", ")}.`);
  return callTradeTool("cancel_equity_order", args);
}

export async function robinhoodAgenticStatus(options: { reconnect?: boolean; includeAccounts?: boolean } = {}): Promise<RobinhoodAgenticStatus> {
  let error = "";
  const stored = await readRobinhoodMcpVault();
  if (!liveConnection && stored.tokens && options.reconnect !== false) {
    try {
      await reconnectFromVault();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Could not reconnect Robinhood Agentic Trading.";
    }
  }
  const refreshed = await readRobinhoodMcpVault();
  const tools = liveConnection?.tools ?? refreshed.tools ?? [];
  const requiredTools = ["get_accounts", "get_portfolio", "review_equity_order", "place_equity_order", "cancel_equity_order"];
  let accounts: RobinhoodAgenticAccount[] = [];
  if (liveConnection && options.includeAccounts !== false) {
    try {
      accounts = await listRobinhoodAgenticAccounts();
    } catch (cause) {
      error ||= cause instanceof Error ? cause.message : "Could not read Robinhood accounts.";
    }
  }
  return {
    connected: Boolean(liveConnection),
    authorizationPending: Boolean(refreshed.pending?.authorizationUrl),
    authorizationUrl: refreshed.pending?.authorizationUrl,
    selectedAccountId: refreshed.selectedAccountId,
    accounts,
    tools,
    missingTools: requiredTools.filter((name) => !tools.some((tool) => tool.name === name)),
    ...(error ? { error } : {}),
  };
}
