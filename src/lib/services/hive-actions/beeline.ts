import { z } from "zod";
import { defineHiveAction } from "./define";

export const beelineProfilesAction = defineHiveAction({
  id: "beeline.profiles",
  title: "Resolve Beeline family profile",
  description: "Resolve a family-member alias and inspect consent, allowed capabilities, and non-secret connection metadata.",
  schema: z.object({
    query: z.string().optional().describe("Person name, relationship, or request text such as 'my mom'."),
  }),
  sideEffects: ["read", "filesystem"],
  risk: "low",
  readOnly: true,
  tags: ["beeline", "family", "profile", "delegation", "consent"],
  aliases: ["beeline_profiles", "family profile", "resolve my mom"],
  mcp: { expose: true, compact: true, toolName: "beeline_profiles" },
  contextIndex: {
    summary: "Resolve Beeline family profiles without exposing credentials.",
    retrievalText:
      "Use beeline_profiles before acting for a family member. It resolves aliases and returns consent, permitted capabilities, Chrome binding, and setup state only. It never returns passwords, cookies, OAuth tokens, or secret values.",
    route: "/api/beeline/actions",
    methods: ["GET"],
  },
});

export const beelineOpenBrowserAction = defineHiveAction({
  id: "beeline.open-browser",
  title: "Open Beeline Chrome profile",
  description: "Open the Chrome profile explicitly bound to a confirmed Beeline family profile.",
  schema: z.object({
    profileId: z.string().describe("Beeline profile id returned by beeline_profiles."),
    confirmation: z.literal("CONFIRM_BEELINE_BROWSER"),
  }),
  sideEffects: ["write", "filesystem", "credential"],
  risk: "high",
  tags: ["beeline", "family", "browser", "chrome", "delegation"],
  aliases: ["beeline_open_browser", "open family chrome profile"],
  confirmation: {
    token: "CONFIRM_BEELINE_BROWSER",
    reason:
      "Opening a family member's authenticated browser profile can expose private account state. The route also requires confirmed Beeline authority and browser capability.",
    when: "always",
  },
  mcp: { expose: true, compact: true, toolName: "beeline_open_browser" },
  contextIndex: {
    summary: "Confirmation-gated launch of a bound Beeline Chrome profile.",
    retrievalText:
      "Use beeline_open_browser only after beeline_profiles confirms the intended person, authority, browser capability, and a bound Chrome profile. Requires exact confirmation CONFIRM_BEELINE_BROWSER. Opening the browser does not approve bookings, messages, purchases, healthcare actions, or other consequential work.",
    route: "/api/beeline/actions",
    methods: ["POST"],
  },
});

export const beelineBrowserUseAction = defineHiveAction({
  id: "beeline.browser-use",
  title: "Automate Beeline browser profile",
  description: "Run a bounded Browser Use action through a family member's trusted-agent Chrome binding.",
  schema: z.object({
    profileId: z.string(),
    browserAction: z.enum(["open", "state", "click", "input", "type", "screenshot"]),
    url: z.string().optional(),
    index: z.number().int().min(0).optional(),
    text: z.string().optional(),
    confirmation: z.literal("CONFIRM_BEELINE_BROWSER_ACTION"),
  }),
  sideEffects: ["write", "filesystem", "credential", "network"],
  risk: "high",
  tags: ["beeline", "family", "browser", "chrome", "browser-use", "automation"],
  aliases: ["beeline_browser_use", "automate family chrome profile"],
  confirmation: {
    token: "CONFIRM_BEELINE_BROWSER_ACTION",
    reason: "Authenticated browser automation can inspect private pages and cause real-world account changes.",
    when: "always",
  },
  mcp: { expose: true, compact: true, toolName: "beeline_browser_use" },
  contextIndex: {
    summary: "Confirmation-gated Browser Use actions through a family-scoped real Chrome profile.",
    retrievalText:
      "Use beeline_browser_use only when the family profile has confirmed browser capability, a dedicated Chrome binding in trusted-agent mode, Browser Use Full permissions, and CONFIRM_BEELINE_BROWSER_ACTION for the exact action and website. Supported actions are open, state, click, input, type, and screenshot. It never supplies stored passwords; manual-first login or an existing authenticated Chrome session is required. Booking, healthcare, messaging, and purchasing consequences still require clear operation-specific user intent.",
    route: "/api/beeline/actions",
    methods: ["POST"],
  },
});

export const beelineLocalCredentialsAction = defineHiveAction({
  id: "beeline.local-credentials",
  title: "List Beeline local credentials",
  description: "List secret-free local credential metadata for a confirmed Beeline family profile.",
  schema: z.object({
    profileId: z.string().describe("Confirmed Beeline profile id returned by beeline_profiles."),
  }),
  sideEffects: ["read", "filesystem"],
  risk: "low",
  readOnly: true,
  tags: ["beeline", "family", "credential", "keychain", "local", "login"],
  aliases: ["beeline_local_credentials", "family local credentials", "find family login"],
  mcp: { expose: true, compact: true, toolName: "beeline_local_credentials" },
  contextIndex: {
    summary: "List opaque local login/API credential handles for a family profile.",
    retrievalText:
      "Use beeline_local_credentials after resolving a confirmed family profile. It returns opaque ids, labels, credential kind, exact HTTPS origin, and flexible/restricted policy metadata only—never usernames, passwords, tokens, cookies, or secret values. The agent should infer the matching credential; the user does not need to name an operation or credential id.",
    route: "/api/beeline/local-credentials",
    methods: ["GET"],
  },
});

export const beelineLocalCredentialUseAction = defineHiveAction({
  id: "beeline.local-credential-use",
  title: "Use Beeline local credential",
  description: "Have the native broker use a family-scoped website login or HTTP credential without returning its value.",
  schema: z.object({
    profileId: z.string(),
    credentialId: z.string().optional().describe("Optional opaque id. Omit when person + website origin identify one credential."),
    usage: z.enum(["browser-login", "http"]),
    destinationUrl: z.string().url().describe("Exact HTTPS destination the agent needs for the user's request."),
    capability: z.enum(["browser", "calendar", "healthcare", "messaging", "shopping", "travel"]),
    method: z.string().optional().describe("HTTP method; defaults to GET for http usage."),
    headers: z.record(z.string(), z.string()).optional().describe("Non-credential HTTP headers. Authentication, cookie, and transport headers are rejected."),
    body: z.unknown().optional(),
    usernameElement: z.number().int().min(0).optional().describe("Browser Use element index for the username field."),
    passwordElement: z.number().int().min(0).optional().describe("Browser Use element index for the password field."),
    submitElement: z.number().int().min(0).optional().describe("Optional Browser Use submit button index; Enter is used when omitted."),
    confirmation: z.literal("CONFIRM_BEELINE_LOCAL_CREDENTIAL").optional().describe("Required only when the saved credential has extra-restricted mode enabled."),
  }),
  sideEffects: ["write", "network", "credential"],
  risk: "high",
  tags: ["beeline", "family", "credential", "keychain", "browser", "http", "delegation"],
  aliases: ["beeline_local_credential_use", "use family login", "authenticate as family profile"],
  mcp: { expose: true, compact: true, toolName: "beeline_local_credential_use" },
  contextIndex: {
    summary: "Flexible-by-default native use of a family credential without exposing the secret.",
    retrievalText:
      "Use beeline_local_credential_use after beeline_profiles and beeline_local_credentials. Infer the credential and HTTP/browser steps from the user's goal; do not ask the user to choose narrow operations. Flexible credentials may be used only at their exact saved public HTTPS origin. Extra-restricted credentials additionally require CONFIRM_BEELINE_LOCAL_CREDENTIAL and allowed-method checks. Browser login talks directly to the authenticated Beeline Browser Use session; HTTP use disables redirects and private-address access. Neither path returns the credential. Consequential bookings, healthcare submissions, purchases, or messages still require the user's clear intent and their applicable action approval.",
    route: "/api/beeline/local-credentials",
    methods: ["POST"],
  },
});

export const beelineConnectionsAction = defineHiveAction({
  id: "beeline.connections",
  title: "List Beeline connections",
  description: "List non-secret OAuth and MCP connection metadata for one confirmed Beeline profile.",
  schema: z.object({
    profileId: z.string().describe("Confirmed Beeline profile id returned by beeline_profiles."),
  }),
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["beeline", "family", "oauth", "mcp", "connections"],
  aliases: ["beeline_connections", "family integrations"],
  mcp: { expose: true, compact: true, toolName: "beeline_connections" },
  contextIndex: {
    summary: "Read family-scoped connection metadata without returning credentials.",
    retrievalText:
      "Use beeline_connections after beeline_profiles resolves a confirmed family profile. It returns opaque connection ids, labels, providers, and capability scopes. It never returns OAuth tokens, bearer tokens, passwords, cookies, or refresh grants.",
    route: "/api/beeline/broker",
    methods: ["GET"],
  },
});

export const beelineCalendarListAction = defineHiveAction({
  id: "beeline.calendar-list",
  title: "Read Beeline calendar",
  description: "Read events from a Google Calendar connection bound to a confirmed Beeline profile.",
  schema: z.object({
    action: z.literal("calendar-list").default("calendar-list"),
    profileId: z.string(),
    connectionId: z.string(),
    calendarId: z.string().optional(),
    timeMin: z.string().optional(),
    timeMax: z.string().optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
  }),
  sideEffects: ["read", "network"],
  risk: "medium",
  readOnly: true,
  tags: ["beeline", "family", "calendar", "google"],
  aliases: ["beeline_calendar_list", "read family calendar"],
  mcp: { expose: true, compact: true, toolName: "beeline_calendar_list" },
  contextIndex: {
    summary: "Read a confirmed family profile's Google Calendar through agent-opaque OAuth custody.",
    retrievalText:
      "Use beeline_calendar_list with profileId and a google-calendar connectionId from beeline_connections. The local route re-checks confirmed authority and the calendar capability, while the hosted broker performs the OAuth call without returning its token.",
    route: "/api/beeline/broker",
    methods: ["POST"],
  },
});

export const beelineCalendarCreateAction = defineHiveAction({
  id: "beeline.calendar-create",
  title: "Create Beeline calendar event",
  description: "Create an event through a Google Calendar connection bound to a confirmed Beeline profile.",
  schema: z.object({
    action: z.literal("calendar-create").default("calendar-create"),
    profileId: z.string(),
    connectionId: z.string(),
    calendarId: z.string().optional(),
    event: z.object({
      summary: z.string(),
      description: z.string().optional(),
      location: z.string().optional(),
      start: z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() }),
      end: z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() }),
    }),
    idempotencyKey: z.string().min(8).max(200).describe("Unique stable key for this exact event-creation attempt; reuse it only when retrying the same event."),
    confirmation: z.literal("CONFIRM_BEELINE_CALENDAR"),
  }),
  sideEffects: ["write", "network", "credential"],
  risk: "high",
  tags: ["beeline", "family", "calendar", "google", "scheduling"],
  aliases: ["beeline_calendar_create", "schedule family event"],
  confirmation: {
    token: "CONFIRM_BEELINE_CALENDAR",
    reason: "Creating an event changes another person's calendar and may affect their schedule.",
    when: "always",
  },
  mcp: { expose: true, compact: true, toolName: "beeline_calendar_create" },
  contextIndex: {
    summary: "Confirmation-gated family calendar event creation through agent-opaque OAuth custody.",
    retrievalText:
      "Use beeline_calendar_create only after resolving the family profile and exact Google Calendar connection. It requires CONFIRM_BEELINE_CALENDAR; this approval covers only the described event, not medical booking, purchases, messages, or future calendar writes.",
    route: "/api/beeline/broker",
    methods: ["POST"],
  },
});

export const beelineMcpReadAction = defineHiveAction({
  id: "beeline.mcp-read",
  title: "Read through Beeline MCP",
  description: "Call an allowlisted read-only method on a family-scoped remote MCP server.",
  schema: z.object({
    action: z.literal("mcp-read").default("mcp-read"),
    profileId: z.string(),
    connectionId: z.string(),
    request: z.object({
      jsonrpc: z.literal("2.0"),
      id: z.union([z.string(), z.number()]).optional(),
      method: z.enum(["initialize", "ping", "tools/list", "resources/list", "resources/templates/list", "resources/read", "prompts/list", "prompts/get"]),
      params: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  sideEffects: ["read", "network"],
  risk: "medium",
  readOnly: true,
  tags: ["beeline", "family", "mcp", "tools", "resources"],
  aliases: ["beeline_mcp_read", "read family mcp"],
  mcp: { expose: true, compact: true, toolName: "beeline_mcp_read" },
  contextIndex: {
    summary: "Read from a family MCP connection without exposing its bearer token.",
    retrievalText:
      "Use beeline_mcp_read for allowlisted MCP discovery and resource methods after resolving the confirmed profile and connection. The route enforces the connection's capability scope and never returns the stored bearer token.",
    route: "/api/beeline/broker",
    methods: ["POST"],
  },
});

export const beelineMcpCallAction = defineHiveAction({
  id: "beeline.mcp-call",
  title: "Run Beeline MCP tool",
  description: "Run a confirmation-gated tools/call operation on a family-scoped remote MCP server.",
  schema: z.object({
    action: z.literal("mcp-call").default("mcp-call"),
    profileId: z.string(),
    connectionId: z.string(),
    request: z.object({
      jsonrpc: z.literal("2.0"),
      id: z.union([z.string(), z.number()]).optional(),
      method: z.literal("tools/call"),
      params: z.record(z.string(), z.unknown()),
    }),
    idempotencyKey: z.string().min(8).max(200).describe("Unique stable key for this exact MCP tool call; reuse it only when retrying the same call."),
    confirmation: z.literal("CONFIRM_BEELINE_MCP_ACTION"),
  }),
  sideEffects: ["write", "network", "credential"],
  risk: "high",
  tags: ["beeline", "family", "mcp", "tools", "delegation"],
  aliases: ["beeline_mcp_call", "run family mcp tool"],
  confirmation: {
    token: "CONFIRM_BEELINE_MCP_ACTION",
    reason: "A remote MCP tool can change another person's accounts or create real-world side effects.",
    when: "always",
  },
  mcp: { expose: true, compact: true, toolName: "beeline_mcp_call" },
  contextIndex: {
    summary: "Confirmation-gated family MCP tool call with broker-held bearer credentials.",
    retrievalText:
      "Use beeline_mcp_call only for the exact family-scoped tool operation the user approved. It requires CONFIRM_BEELINE_MCP_ACTION, profile consent, a matching capability, and a connection id. Healthcare, booking, purchase, and messaging consequences still require clear operation-specific user intent.",
    route: "/api/beeline/broker",
    methods: ["POST"],
  },
});
