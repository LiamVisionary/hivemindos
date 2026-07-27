import { CAPABILITY_APPROVAL_CONTINUATION_MARKER } from "@/lib/types/capability-approval";
import type { ChatPermissionMode } from "@/lib/types/chat-permissions";
import { chatPermissionModeAllowsUnlistedCommands } from "@/lib/types/chat-permissions";
import {
  hiveActionInputSchema,
  hiveActionMcpName,
  listHiveActions,
} from "@/lib/services/hive-actions";
import type {
  HiveActionConfirmation,
  HiveActionDefinition,
  HiveActionSideEffect,
} from "@/lib/services/hive-actions/types";
import { actionIntegrationConnected } from "@/lib/services/integrations/hive-action-connection";
import { readSharedAgentEnv } from "@/lib/services/integrations/shared-env";
import {
  mcpClientStatus,
  type McpServerStatus,
} from "@/lib/services/mcp/client";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

export const INVOKE_HIVE_CAPABILITY_TOOL_NAME = "invoke_hive_capability";

type McpStatus = { enabled: boolean; servers: McpServerStatus[] };
type CapabilitySurface = "mcp" | "connected_app" | "hive_action";
type CapabilityOperation = "list" | "invoke";

type CapabilityToolInput = {
  surface?: CapabilitySurface;
  operation?: CapabilityOperation;
  query?: string;
  serverId?: string;
  toolName?: string;
  appId?: string;
  serviceKind?: string;
  capabilityId?: string;
  method?: string;
  path?: string;
  arguments?: Record<string, unknown>;
  reason?: string;
};

type CapabilityToolContext = {
  origin: string;
  permissionMode: ChatPermissionMode;
  userText: string;
  /**
   * Bare Hive Action ids (e.g. "apps.build") already selected by the approved
   * capability plan for this turn. When omitted, they are recovered from the
   * approved-plan continuation block inside userText.
   */
  plannedCapabilities?: string[];
};

type CapabilityToolDependencies = {
  authHeaders?: () => Record<string, string>;
  fetcher?: typeof fetch;
  listActions?: () => HiveActionDefinition[];
  mcpStatus?: () => McpStatus;
  readSharedEnv?: () => Promise<Record<string, string>>;
};

export type CapabilityToolOutcome = {
  toolResultContent: string;
  fallbackText: string;
  ok: boolean;
  operation?: CapabilityOperation;
  target?: string;
  approvalRequired?: boolean;
  /** The model produced a malformed or misaddressed call; nothing was run. */
  invalidRequest?: boolean;
};

function capabilityRuntimeDetail(outcome: CapabilityToolOutcome) {
  if (!outcome.ok) {
    const clarifier = outcome.invalidRequest && !outcome.approvalRequired
      ? " The agent produced an invalid capability request; nothing was run."
      : "";
    return `${outcome.fallbackText}${clarifier}`.trim() || outcome.target || "";
  }
  return outcome.target || outcome.fallbackText;
}

export function invokeHiveCapabilityRuntimeEvent(outcome: CapabilityToolOutcome) {
  return {
    type: "chat.tool.done",
    toolName: INVOKE_HIVE_CAPABILITY_TOOL_NAME,
    name: INVOKE_HIVE_CAPABILITY_TOOL_NAME,
    message: outcome.ok ? outcome.operation === "invoke" ? "Hive capability completed" : "Hive capability inspected" : outcome.approvalRequired ? "Hive capability approval required" : "Hive capability failed",
    detail: capabilityRuntimeDetail(outcome),
    status: outcome.ok ? "completed" : outcome.approvalRequired ? "running" : "failed",
    operation: outcome.operation,
  };
}

const MUTATING_EFFECTS = new Set<HiveActionSideEffect>([
  "write",
  "filesystem",
  "remote-machine",
  "wallet",
  "payment",
  "credential",
  "public-message",
]);

export function invokeHiveCapabilityToolDefinition() {
  return {
    type: "function" as const,
    function: {
      name: INVOKE_HIVE_CAPABILITY_TOOL_NAME,
      description:
        "Inspect or invoke a capability discovered by Hive capability search without hardcoding its provider. " +
        "Supports live in-app MCP tools, connected-app API endpoints, and registered Hive Actions. " +
        "Use operation=list when the exact target/schema is not already in retrieved context, then operation=invoke with the returned identifiers. " +
        "Read-only calls run automatically. Mutating MCP/app calls require Bypass permission unless they expose a HivemindOS confirmation contract; Hive Actions preserve their declared exact confirmation tokens and route-level policy.",
      parameters: {
        type: "object",
        properties: {
          surface: {
            type: "string",
            enum: ["mcp", "connected_app", "hive_action"],
            description: "The registered execution surface selected from capability search.",
          },
          operation: {
            type: "string",
            enum: ["list", "invoke"],
            description: "List/inspect available targets, or invoke one exact target.",
          },
          query: { type: "string", description: "Optional semantic/name filter used by list." },
          serverId: { type: "string", description: "Connected MCP server id." },
          toolName: { type: "string", description: "Exact MCP tool name." },
          appId: { type: "string", description: "Connected app id from capability search." },
          serviceKind: { type: "string", description: "Connected app service kind when no app id is available." },
          capabilityId: { type: "string", description: "Exact Hive Action id, alias, or MCP export name." },
          method: { type: "string", enum: ["GET", "POST"], description: "Declared app/action HTTP method." },
          path: { type: "string", description: "Connected-app relative API path beginning with /. Never pass a full URL." },
          arguments: { type: "object", additionalProperties: true, description: "Arguments validated by the selected tool, app endpoint, or Hive Action schema." },
          reason: { type: "string", description: "Short explanation of why this capability matches the user's goal." },
        },
        required: ["surface", "operation"],
      },
    },
  };
}

const PLANNED_CAPABILITY_LINE_PATTERN = /\bCapability id:\s*hive-action:([\w.-]+)/gi;

/**
 * Recover the Hive Action ids the approved capability plan already selected
 * from the plan-continuation block in the latest user message. Only the
 * canonical `Capability id: hive-action:<id>` lines under the approval marker
 * are trusted — a plain user message (or pasted content echoed into the
 * continuation's "Original task" line) that merely mentions an action id
 * never produces defaults.
 */
export function plannedHiveActionIds(userText: string): string[] {
  if (!userText || !userText.includes(CAPABILITY_APPROVAL_CONTINUATION_MARKER)) return [];
  const ids = new Set<string>();
  for (const match of userText.matchAll(PLANNED_CAPABILITY_LINE_PATTERN)) ids.add(match[1].toLowerCase());
  return [...ids];
}

function normalizedSurface(value: unknown): CapabilitySurface | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (compact === "mcp" || compact.startsWith("mcp_")) return "mcp";
  if (compact.startsWith("connected_app")) return "connected_app";
  if (compact.startsWith("hive_action")) return "hive_action";
  return undefined;
}

function plannedCorrectionFields(planned: string[]) {
  if (!planned.length) return {};
  const target = planned.length === 1 ? planned[0] : "<planned id>";
  return {
    plannedCapabilities: planned.map((id) => `hive-action:${id}`),
    correction: `Retry ${INVOKE_HIVE_CAPABILITY_TOOL_NAME} with exactly this JSON shape: {"surface":"hive_action","operation":"invoke","capabilityId":"${target}","arguments":{<action request fields>}}. Put every action request field inside "arguments"${planned.length === 1 ? "" : `; planned ids: ${planned.join(", ")}`}. Do not invent other capability names.`,
  };
}

function withPlannedCorrection(outcome: CapabilityToolOutcome, planned: string[]): CapabilityToolOutcome {
  if (outcome.ok || !outcome.invalidRequest || !planned.length) return outcome;
  try {
    const payload = JSON.parse(outcome.toolResultContent) as Record<string, unknown>;
    if (payload.correction) return outcome;
    return { ...outcome, toolResultContent: JSON.stringify({ ...payload, ...plannedCorrectionFields(planned) }) };
  } catch {
    return outcome;
  }
}

/**
 * System nudge injected after repeated malformed calls so a weak tool-calling
 * model sees the exact required JSON once more instead of freestyling.
 */
export function capabilityInvocationCorrectiveSystemPrompt(planned: string[]) {
  const plannedLine = planned.length
    ? `The approved capability plan already selected ${planned.map((id) => `hive-action:${id}`).join(", ")}; reuse ${planned.length === 1 ? `capabilityId "${planned[0]}"` : "one of those ids"} exactly as written.`
    : 'If no exact id is in context, call it with operation="list" first to discover ids.';
  return [
    `Your ${INVOKE_HIVE_CAPABILITY_TOOL_NAME} calls are failing validation before anything runs.`,
    'Every call must be one JSON object with required string fields "surface" (exactly "mcp", "connected_app", or "hive_action") and "operation" (exactly "list" or "invoke").',
    'To invoke a Hive Action send: {"surface":"hive_action","operation":"invoke","capabilityId":"<id>","arguments":{...}} with every action request field inside "arguments".',
    plannedLine,
    "If you cannot produce this tool call, tell the user plainly that the capability did not run — do not invent a different explanation.",
  ].join(" ");
}

/**
 * Honest terminal note appended when a run ends with repeated malformed
 * capability calls and zero executed capabilities, so the model's own closing
 * text cannot silently misreport what happened.
 */
export function capabilityInoperableNotice(invalidCalls: number) {
  return `> HivemindOS: this model produced ${invalidCalls} invalid capability tool call${invalidCalls === 1 ? "" : "s"} and no capability ran, so the reply above may misstate what happened. Nothing was changed. Switching this agent to a stronger tool-calling model is recommended.`;
}

/**
 * Per-request health tracker for the capability tool. `correctiveSystemMessage`
 * fires once per streak of ≥2 consecutive malformed calls (reset by any
 * well-formed call); `inoperableFinalNotice` returns the honest terminal note
 * only when a run made ≥2 invalid calls and executed nothing.
 */
export function createCapabilityToolHealth(input: {
  plannedCapabilityIds: string[];
  onCorrectiveNudge?: (invalidCalls: number) => void;
  onInoperable?: (invalidCalls: number) => void;
}) {
  const state = { invalidCalls: 0, consecutiveInvalid: 0, successes: 0, nudged: false };
  return {
    track(outcome: CapabilityToolOutcome) {
      if (outcome.ok) {
        state.successes += 1;
        state.consecutiveInvalid = 0;
        state.nudged = false;
        return;
      }
      if (outcome.invalidRequest && !outcome.approvalRequired) {
        state.invalidCalls += 1;
        state.consecutiveInvalid += 1;
        return;
      }
      state.consecutiveInvalid = 0;
    },
    correctiveSystemMessage(): Record<string, unknown> | null {
      if (state.consecutiveInvalid < 2 || state.nudged) return null;
      state.nudged = true;
      input.onCorrectiveNudge?.(state.invalidCalls);
      return { role: "system", content: capabilityInvocationCorrectiveSystemPrompt(input.plannedCapabilityIds) };
    },
    inoperableFinalNotice(): string {
      if (state.invalidCalls < 2 || state.successes > 0) return "";
      input.onInoperable?.(state.invalidCalls);
      return capabilityInoperableNotice(state.invalidCalls);
    },
  };
}

function parseInput(raw: string | Record<string, unknown>): CapabilityToolInput {
  if (typeof raw !== "string") return raw as CapabilityToolInput;
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed as CapabilityToolInput : {};
  } catch {
    return {};
  }
}

function jsonOutcome(payload: Record<string, unknown>, fallbackText: string): CapabilityToolOutcome {
  return {
    toolResultContent: JSON.stringify(payload),
    fallbackText,
    ok: payload.ok === true,
    operation: payload.operation === "list" || payload.operation === "invoke" ? payload.operation : undefined,
    target: typeof payload.target === "string" ? payload.target : typeof payload.surface === "string" ? payload.surface : undefined,
    approvalRequired: payload.approvalRequired === true,
    invalidRequest: payload.invalidRequest === true,
  };
}

function failure(error: string, extra: Record<string, unknown> = {}): CapabilityToolOutcome {
  return jsonOutcome({ ok: false, error, ...extra }, error);
}

function approvalRequired(target: string, reason: string, tokens: string[] = []) {
  const instruction = tokens.length
    ? `Ask the user to reply with exactly ${tokens.map((token) => `\`${token}\``).join(" or ")}.`
    : "This capability can run only after the user grants Bypass permission for the pending action.";
  return jsonOutcome({
    ok: false,
    approvalRequired: true,
    target,
    reason,
    requiredConfirmation: tokens,
    instruction,
  }, `${target} needs approval before it can run. ${instruction}`);
}

function confirmationTokens(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const confirmation = value as { token?: unknown; tokens?: unknown };
  return [
    typeof confirmation.token === "string" ? confirmation.token.trim() : "",
    ...(Array.isArray(confirmation.tokens)
      ? confirmation.tokens.filter((token): token is string => typeof token === "string").map((token) => token.trim())
      : []),
  ].filter(Boolean);
}

function exactUserConfirmation(userText: string, tokens: string[]) {
  const supplied = userText.trim();
  return tokens.find((token) => supplied === token);
}

function safeMcpRead(annotations?: Record<string, unknown>) {
  return annotations?.readOnlyHint === true && annotations?.destructiveHint !== true;
}

function safeHiveActionRead(action: HiveActionDefinition) {
  return action.readOnly === true
    && action.risk !== "high"
    && action.risk !== "critical"
    && !action.sideEffects.some((effect) => MUTATING_EFFECTS.has(effect));
}

function matchesQuery(query: string, values: Array<string | undefined>) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = values.filter(Boolean).join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function mcpList(status: McpStatus, query: string) {
  const servers = status.servers.map((server) => ({
    id: server.id,
    transport: server.transport,
    tools: server.tools.filter((tool) => matchesQuery(query, [server.id, tool.name, tool.description])).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })),
  })).filter((server) => server.tools.length);
  return jsonOutcome({ ok: true, surface: "mcp", operation: "list", enabled: status.enabled, servers }, `Found ${servers.reduce((sum, server) => sum + server.tools.length, 0)} matching live MCP tools.`);
}

function actionAliases(action: HiveActionDefinition) {
  return [action.id, hiveActionMcpName(action), ...(action.aliases ?? [])];
}

function actionList(actions: HiveActionDefinition[], query: string) {
  const matches = actions.filter((action) => matchesQuery(query, [
    action.id,
    action.title,
    action.description,
    ...(action.aliases ?? []),
    ...action.tags,
  ])).slice(0, 40).map((action) => ({
    id: action.id,
    title: action.title,
    description: action.description,
    aliases: actionAliases(action),
    inputSchema: hiveActionInputSchema(action),
    methods: action.contextIndex?.methods ?? [],
    route: action.contextIndex?.route,
    readOnly: action.readOnly === true,
    risk: action.risk,
    sideEffects: action.sideEffects,
    confirmation: action.confirmation || undefined,
  }));
  return jsonOutcome({ ok: true, surface: "hive_action", operation: "list", actions: matches }, `Found ${matches.length} matching Hive Actions.`);
}

function redactTailnetIps(value: string) {
  return value
    .replace(/\b100\.(\d{1,3})(?:\.\d{1,3}){2}\b/g, (match, secondOctet: string) => {
      const octet = Number(secondOctet);
      return octet >= 64 && octet <= 127 ? "<tailnet-ip>" : match;
    })
    .replace(/\bfd7a:115c:a1e0:[0-9a-f:]+\b/gi, "<tailnet-ipv6>");
}

function compactPayload(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    const redacted = redactTailnetIps(value);
    return redacted.length > 2_000 ? `${redacted.slice(0, 2_000)}...` : redacted;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= 6) return "[nested data omitted]";
  if (Array.isArray(value)) {
    const entries = value.slice(0, 24).map((entry) => compactPayload(entry, depth + 1));
    if (value.length > entries.length) entries.push(`[${value.length - entries.length} more items]`);
    return entries;
  }
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 40);
  return Object.fromEntries(entries.map(([key, entry]) => [key, compactPayload(entry, depth + 1)]));
}

async function responsePayload(response: Response) {
  const text = await response.text();
  if (/json/i.test(response.headers.get("content-type") || "") || /^[\[{]/.test(text.trim())) {
    try {
      return compactPayload(JSON.parse(text) as unknown);
    } catch {
      // Fall through to bounded plain text when an upstream mislabeled JSON.
    }
  }
  const redacted = redactTailnetIps(text);
  return redacted.length > 16_000 ? `${redacted.slice(0, 16_000)}...` : redacted;
}

async function fetchedOutcome(response: Response, surface: CapabilitySurface, target: string) {
  const result = await responsePayload(response);
  if (!response.ok) {
    const detail = result && typeof result === "object" && "error" in result
      ? String((result as { error?: unknown }).error ?? `HTTP ${response.status}`)
      : typeof result === "string" && result.trim() ? result.trim() : `HTTP ${response.status}`;
    return failure(`${target} failed: ${detail}`, { surface, target, status: response.status });
  }
  return jsonOutcome({ ok: true, surface, operation: "invoke", target, untrustedExternalData: true, result }, `Used ${target} successfully.`);
}

function queryUrl(origin: string, route: string, args: Record<string, unknown>) {
  const url = new URL(route, origin);
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, typeof item === "object" ? JSON.stringify(item) : String(item));
      continue;
    }
    url.searchParams.set(key, value !== null && typeof value === "object" ? JSON.stringify(value) : String(value ?? ""));
  }
  return url;
}

async function invokeMcp(
  input: CapabilityToolInput,
  context: CapabilityToolContext,
  dependencies: Required<Pick<CapabilityToolDependencies, "authHeaders" | "fetcher" | "mcpStatus">>,
) {
  const serverId = input.serverId?.trim() || "";
  const toolName = input.toolName?.trim() || "";
  const server = dependencies.mcpStatus().servers.find((candidate) => candidate.id === serverId);
  const tool = server?.tools.find((candidate) => candidate.name === toolName);
  if (!server || !tool) return failure(`Connected MCP tool ${serverId || "(missing server)"}/${toolName || "(missing tool)"} was not found.`, { invalidRequest: true });
  const args = { ...(input.arguments ?? {}) };
  if (!safeMcpRead(tool.annotations)) {
    const tokens = confirmationTokens(tool.annotations?.["hivemindos/confirmation"]);
    const confirmed = exactUserConfirmation(context.userText, tokens);
    if (confirmed) args.confirmation = confirmed;
    if (!confirmed && !chatPermissionModeAllowsUnlistedCommands(context.permissionMode)) {
      return approvalRequired(`MCP ${serverId}/${toolName}`, "The MCP tool is mutating or does not declare itself read-only.", tokens);
    }
  }
  const response = await dependencies.fetcher(new URL("/api/mcp/client", context.origin), {
    method: "POST",
    headers: { "content-type": "application/json", ...dependencies.authHeaders() },
    body: JSON.stringify({ action: "call-tool", id: serverId, name: toolName, args }),
    cache: "no-store",
  });
  return fetchedOutcome(response, "mcp", `MCP ${serverId}/${toolName}`);
}

async function connectedAppsList(
  context: CapabilityToolContext,
  dependencies: Required<Pick<CapabilityToolDependencies, "authHeaders" | "fetcher">>,
) {
  const response = await dependencies.fetcher(new URL("/api/fleet/apps?fast=1&wait=1", context.origin), {
    headers: dependencies.authHeaders(),
    cache: "no-store",
  });
  const payload = await responsePayload(response) as { apps?: Array<Record<string, unknown>> } | null;
  if (!response.ok) return failure(`Connected app discovery failed with HTTP ${response.status}.`);
  const apps = (payload?.apps ?? []).map((app) => ({
    id: app.id,
    name: app.name,
    serviceKind: app.serviceKind,
    machineName: app.machineName,
    online: app.online,
    apiRoutes: Array.isArray(app.apiRoutes) ? app.apiRoutes : [],
  }));
  return jsonOutcome({ ok: true, surface: "connected_app", operation: "list", apps }, `Found ${apps.length} connected apps.`);
}

async function invokeConnectedApp(
  input: CapabilityToolInput,
  context: CapabilityToolContext,
  dependencies: Required<Pick<CapabilityToolDependencies, "authHeaders" | "fetcher">>,
) {
  const method = (input.method || "GET").trim().toUpperCase();
  const path = input.path?.trim() || "";
  if (method !== "GET" && method !== "POST") return failure("Connected app method must be GET or POST.", { invalidRequest: true });
  if (!path.startsWith("/") || path.startsWith("//") || /^https?:\/\//i.test(path)) return failure("Connected app path must be a relative path beginning with /.", { invalidRequest: true });
  if (!input.appId?.trim() && !input.serviceKind?.trim()) return failure("Connected app invocation needs appId or serviceKind.", { invalidRequest: true });
  if (method === "POST" && !chatPermissionModeAllowsUnlistedCommands(context.permissionMode)) {
    return approvalRequired(`connected app ${input.appId || input.serviceKind}${path}`, "Raw connected-app POST requests may mutate external state. Register a confirmed Hive Action for normal automatic routing, or grant Bypass permission for this exact request.");
  }
  const response = await dependencies.fetcher(new URL("/api/fleet/apps/request", context.origin), {
    method: "POST",
    headers: { "content-type": "application/json", ...dependencies.authHeaders() },
    body: JSON.stringify({
      appId: input.appId,
      serviceKind: input.serviceKind,
      method,
      path,
      body: input.arguments ?? {},
    }),
    cache: "no-store",
  });
  return fetchedOutcome(response, "connected_app", `connected app ${input.appId || input.serviceKind}${path}`);
}

function selectedAction(actions: HiveActionDefinition[], capabilityId: string) {
  const normalized = capabilityId.trim().replace(/^hive-action:/i, "").toLowerCase();
  return actions.find((action) => actionAliases(action).some((alias) => alias.toLowerCase() === normalized));
}

async function invokeHiveAction(
  input: CapabilityToolInput,
  context: CapabilityToolContext,
  actions: HiveActionDefinition[],
  dependencies: Required<Pick<CapabilityToolDependencies, "authHeaders" | "fetcher">>,
) {
  const capabilityId = input.capabilityId?.trim() || "";
  const action = selectedAction(actions, capabilityId);
  if (!action) return failure(`Hive Action ${capabilityId || "(missing id)"} was not found or its integration is not connected.`, { invalidRequest: true });
  const route = action.contextIndex?.route;
  if (!route?.startsWith("/api/")) return failure(`Hive Action ${action.id} has no executable dashboard API route.`);
  const methods = (action.contextIndex?.methods ?? []).map((method) => method.toUpperCase());
  const method = (input.method || (safeHiveActionRead(action) && methods.includes("GET") ? "GET" : methods[0] || "POST")).toUpperCase();
  if (!methods.includes(method)) return failure(`Hive Action ${action.id} does not declare ${method}; allowed methods: ${methods.join(", ") || "none"}.`, { invalidRequest: true });
  const args = { ...(input.arguments ?? {}) };
  const tokens = confirmationTokens(action.confirmation as HiveActionConfirmation);
  const confirmed = exactUserConfirmation(context.userText, tokens);
  if (confirmed) args.confirmation = confirmed;
  if (!safeHiveActionRead(action) && !confirmed && !chatPermissionModeAllowsUnlistedCommands(context.permissionMode)) {
    return approvalRequired(`Hive Action ${action.id}`, action.confirmation && typeof action.confirmation === "object" ? action.confirmation.reason : "This Hive Action may mutate state.", tokens);
  }
  const parsed = action.schema.safeParse(args);
  if (!parsed.success) return failure(`Hive Action ${action.id} arguments are invalid: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}`, { invalidRequest: true });
  const url = method === "GET" ? queryUrl(context.origin, route, parsed.data as Record<string, unknown>) : new URL(route, context.origin);
  const response = await dependencies.fetcher(url, {
    method,
    headers: { ...dependencies.authHeaders(), ...(method === "POST" ? { "content-type": "application/json" } : {}) },
    body: method === "POST" ? JSON.stringify(parsed.data) : undefined,
    cache: "no-store",
  });
  return fetchedOutcome(response, "hive_action", `Hive Action ${action.id}`);
}

export async function runInvokeHiveCapabilityTool(
  raw: string | Record<string, unknown>,
  context: CapabilityToolContext,
  overrides: CapabilityToolDependencies = {},
): Promise<CapabilityToolOutcome> {
  const rawInput = parseInput(raw);
  const planned = context.plannedCapabilities ?? plannedHiveActionIds(context.userText);
  const plannedActionId = planned.length === 1 ? planned[0] : undefined;
  // Weak tool-calling models drop the addressing fields the approved
  // capability plan already fixed (confirmed 2026-07-18: five Scout calls
  // failed on missing surface/capabilityId for the planned apps.build action,
  // then confabulated a diagnosis). Default ONLY the addressing fields from
  // the plan; every downstream permission, confirmation-token, and schema
  // gate still runs against the resolved action exactly as for an explicit
  // call, so defaulting cannot widen what is allowed to execute.
  let surface = normalizedSurface(rawInput.surface);
  if (!surface && plannedActionId) surface = "hive_action";
  let operation: CapabilityOperation | undefined = rawInput.operation === "list" || rawInput.operation === "invoke" ? rawInput.operation : undefined;
  let capabilityId = typeof rawInput.capabilityId === "string" ? rawInput.capabilityId.trim() : "";
  if (surface === "hive_action" && plannedActionId && !capabilityId) capabilityId = plannedActionId;
  if (!operation && surface === "hive_action" && plannedActionId) {
    const hasArguments = Boolean(rawInput.arguments && typeof rawInput.arguments === "object" && Object.keys(rawInput.arguments).length);
    operation = hasArguments ? "invoke" : "list";
  }
  const input: CapabilityToolInput = { ...rawInput, surface, operation, capabilityId };
  const finish = (outcome: CapabilityToolOutcome) => withPlannedCorrection(outcome, planned);
  if (!surface) return finish(failure("Capability surface must be mcp, connected_app, or hive_action.", { invalidRequest: true }));
  if (operation !== "list" && operation !== "invoke") return finish(failure("Capability operation must be list or invoke.", { invalidRequest: true }));
  const dependencies = {
    authHeaders: overrides.authHeaders ?? internalApiAuthHeaders,
    fetcher: overrides.fetcher ?? fetch,
    listActions: overrides.listActions ?? listHiveActions,
    mcpStatus: overrides.mcpStatus ?? mcpClientStatus,
    readSharedEnv: overrides.readSharedEnv ?? readSharedAgentEnv,
  };
  try {
    if (surface === "mcp") {
      if (operation === "list") return mcpList(dependencies.mcpStatus(), input.query?.trim() || "");
      return finish(await invokeMcp(input, context, dependencies));
    }
    if (surface === "connected_app") {
      if (operation === "list") return connectedAppsList(context, dependencies);
      return finish(await invokeConnectedApp(input, context, dependencies));
    }
    const sharedEnv = await dependencies.readSharedEnv();
    const actions = dependencies.listActions().filter((action) => actionIntegrationConnected(action, sharedEnv));
    if (operation === "list") return actionList(actions, input.query?.trim() || "");
    return finish(await invokeHiveAction(input, context, actions, dependencies));
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Registered capability invocation failed.", { surface });
  }
}
