import type { ConnectionProviderKey } from "@/lib/types/integrations";
import type { HiveActionRisk, HiveActionSideEffect } from "@/lib/services/hive-actions/types";
import {
  GOOGLE_CLIENT_ID_ENV,
  GOOGLE_CLIENT_SECRET_ENV,
  GOOGLE_CLOUD_CLIENT_ID_ENV,
  GOOGLE_CLOUD_CLIENT_SECRET_ENV,
  AZURE_OAUTH_CLIENT_ID_ENV,
  SLACK_OAUTH_CLIENT_ID_ENV,
} from "@/lib/services/integrations/provider-connection-env";
import { CLAWBANK_TOKEN_ENV_NAMES } from "@/lib/services/clawbank";

// "oauth-user-token": a PKCE public-client sign-in that yields a long-lived user
// token (no refresh token, no pasted client) — e.g. Slack.
export type ConnectorAuthMode = "api-token" | "oauth-refresh-token" | "oauth-user-token";

export type ConnectorAuthManifest = {
  mode: ConnectorAuthMode;
  tokenEnvKey: string;
  tokenEnvAliases?: string[];
  tokenHint: string;
  tokenPlaceholder: string;
  oauthClientEnvKeys?: string[];
};

export type ConnectorOperationManifest = {
  id: string;
  label: string;
  description: string;
  methods: string[];
  sideEffects: HiveActionSideEffect[];
  risk: HiveActionRisk;
  readOnly?: boolean;
  requiredClaims?: string[];
};

export type ConnectorManifest = {
  key: ConnectionProviderKey;
  label: string;
  detail: string;
  tags: string[];
  auth: ConnectorAuthManifest;
  operations: ConnectorOperationManifest[];
};

const READ_CONNECTION_OPERATION: ConnectorOperationManifest = {
  id: "connection-status",
  label: "Connection status",
  description: "Read set/missing credential status and connector metadata without exposing secret values.",
  methods: ["GET"],
  sideEffects: ["read"],
  risk: "low",
  readOnly: true,
  requiredClaims: ["connectors:read"],
};

const READ_API_OPERATION: ConnectorOperationManifest = {
  id: "read-provider-api",
  label: "Read provider API",
  description: "Call read-only provider API endpoints through server-held credentials.",
  methods: ["GET", "POST"],
  sideEffects: ["read", "network"],
  risk: "medium",
  readOnly: true,
  requiredClaims: ["connectors:invoke"],
};

export const CONNECTOR_MANIFESTS: ConnectorManifest[] = [
  {
    key: "github",
    label: "GitHub",
    detail: "Code, issues, pull requests, and releases.",
    tags: ["code", "issues", "pull-requests", "releases"],
    auth: {
      mode: "api-token",
      tokenEnvKey: "GH_GLOBAL",
      tokenHint: "GitHub -> Settings -> Developer settings -> Personal access tokens.",
      tokenPlaceholder: "ghp_... or github_pat_...",
      oauthClientEnvKeys: ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET", "GH_OAUTH_CLIENT_ID", "GH_OAUTH_CLIENT_SECRET"],
    },
    operations: [READ_CONNECTION_OPERATION, READ_API_OPERATION],
  },
  {
    key: "linear",
    label: "Linear",
    detail: "Tasks, projects, and triage queues.",
    tags: ["tasks", "projects", "triage"],
    auth: {
      mode: "api-token",
      tokenEnvKey: "LINEAR_API_KEY",
      tokenHint: "Linear -> Settings -> Security & access -> Personal API keys.",
      tokenPlaceholder: "lin_api_...",
    },
    operations: [READ_CONNECTION_OPERATION, READ_API_OPERATION],
  },
  {
    key: "slack",
    label: "Slack",
    detail: "Channels, mentions, and approval messages.",
    tags: ["messaging", "approvals", "channels", "oauth"],
    auth: {
      // PKCE public-client sign-in -> a Slack user token (xoxp-), stored in the
      // same SLACK_BOT_TOKEN key the send/verify paths already read.
      mode: "oauth-user-token",
      tokenEnvKey: "SLACK_BOT_TOKEN",
      tokenHint: "One-time setup so you can sign in with your Slack account.",
      tokenPlaceholder: "",
      oauthClientEnvKeys: [SLACK_OAUTH_CLIENT_ID_ENV],
    },
    operations: [
      READ_CONNECTION_OPERATION,
      {
        ...READ_API_OPERATION,
        id: "read-slack-api",
        label: "Read Slack API",
      },
      {
        id: "send-slack-message",
        label: "Send Slack message",
        description: "Send a message through Slack after policy approval.",
        methods: ["POST"],
        sideEffects: ["network", "public-message"],
        risk: "high",
        requiredClaims: ["messages:publish"],
      },
    ],
  },
  {
    key: "notion",
    label: "Notion",
    detail: "Docs, project pages, and task databases.",
    tags: ["docs", "databases", "workspace"],
    auth: {
      mode: "api-token",
      tokenEnvKey: "NOTION_API_KEY",
      tokenHint: "notion.so/profile/integrations -> New integration -> Internal integration secret.",
      tokenPlaceholder: "ntn_... or secret_...",
    },
    operations: [READ_CONNECTION_OPERATION, READ_API_OPERATION],
  },
  {
    key: "google",
    label: "Google",
    detail: "Drive, Gmail, and Calendar context.",
    tags: ["drive", "gmail", "calendar", "oauth"],
    auth: {
      mode: "oauth-refresh-token",
      tokenEnvKey: "GOOGLE_OAUTH_REFRESH_TOKEN",
      tokenHint: "One-time setup so you can sign in with your Google account.",
      tokenPlaceholder: "",
      oauthClientEnvKeys: [GOOGLE_CLIENT_ID_ENV, GOOGLE_CLIENT_SECRET_ENV],
    },
    operations: [READ_CONNECTION_OPERATION, READ_API_OPERATION],
  },
  {
    key: "google-cloud",
    label: "Google Cloud",
    detail: "Billing budgets + API quota caps.",
    tags: ["cloud", "billing", "quotas", "oauth"],
    auth: {
      mode: "oauth-refresh-token",
      tokenEnvKey: "GOOGLE_CLOUD_OAUTH_REFRESH_TOKEN",
      tokenHint: "One-time setup so you can sign in with your Google account.",
      tokenPlaceholder: "",
      oauthClientEnvKeys: [GOOGLE_CLOUD_CLIENT_ID_ENV, GOOGLE_CLOUD_CLIENT_SECRET_ENV],
    },
    operations: [READ_CONNECTION_OPERATION, READ_API_OPERATION],
  },
  {
    key: "azure",
    label: "Microsoft Azure",
    detail: "Subscriptions, resource groups, resources, and local Azure management tools.",
    tags: ["cloud", "resources", "subscriptions", "oauth", "mcp"],
    auth: {
      mode: "oauth-refresh-token",
      tokenEnvKey: "AZURE_OAUTH_REFRESH_TOKEN",
      tokenHint: "Sign in with Microsoft. Hosted access is read-only; the optional local MCP installs separately and starts read-only.",
      tokenPlaceholder: "",
      oauthClientEnvKeys: [AZURE_OAUTH_CLIENT_ID_ENV],
    },
    operations: [
      READ_CONNECTION_OPERATION,
      {
        ...READ_API_OPERATION,
        id: "read-azure-resources",
        label: "Read Azure resources",
        description: "List subscriptions, resource groups, and resources through Azure Resource Manager.",
      },
      {
        id: "configure-azure-mcp",
        label: "Configure Azure MCP",
        description: "Install Microsoft's official Azure MCP locally and register it with selected agent runtimes.",
        methods: ["POST"],
        sideEffects: ["network", "filesystem", "write"],
        risk: "medium",
        requiredClaims: ["connectors:invoke"],
      },
    ],
  },
  {
    key: "posthog",
    label: "PostHog",
    detail: "Per-company product analytics (funnels, events, visitors) via HogQL.",
    tags: ["analytics", "hogql", "funnels", "events"],
    auth: {
      mode: "api-token",
      tokenEnvKey: "POSTHOG_PERSONAL_API_KEY",
      tokenHint: "PostHog -> Settings -> Personal API keys. Grant query:read (and user:read so we can verify + show your account).",
      tokenPlaceholder: "phx_...",
    },
    operations: [READ_CONNECTION_OPERATION, READ_API_OPERATION],
  },
  {
    key: "plausible",
    label: "Plausible",
    detail: "Privacy-friendly web analytics. The key is checked against each company's site when its Analytics tab loads.",
    tags: ["analytics", "web", "privacy"],
    auth: {
      mode: "api-token",
      tokenEnvKey: "PLAUSIBLE_API_KEY",
      tokenHint: "Plausible -> Settings -> API keys. Validated per site at query time (Plausible can't check a key without a site).",
      tokenPlaceholder: "",
    },
    operations: [READ_CONNECTION_OPERATION, READ_API_OPERATION],
  },
  {
    key: "clawbank",
    label: "ClawBank",
    detail: "Banking, a self-custody wallet, trading, LLC formation, and USD off-ramp for your agents.",
    tags: ["banking", "wallet", "trading", "legal"],
    auth: {
      mode: "api-token",
      tokenEnvKey: CLAWBANK_TOKEN_ENV_NAMES[0],
      tokenEnvAliases: CLAWBANK_TOKEN_ENV_NAMES.slice(1),
      tokenHint: "Use the guided email setup, or paste an API token minted by `clawbank login`.",
      tokenPlaceholder: "ClawBank API token",
    },
    operations: [
      READ_CONNECTION_OPERATION,
      READ_API_OPERATION,
      {
        id: "clawbank-money-action",
        label: "Money action",
        description: "Transfer, trade, or otherwise move money through ClawBank behind wallet/payment governance.",
        methods: ["POST"],
        sideEffects: ["network", "wallet", "payment"],
        risk: "critical",
        requiredClaims: ["wallet:spend"],
      },
    ],
  },
];

export const CONNECTOR_MANIFESTS_BY_KEY = Object.fromEntries(
  CONNECTOR_MANIFESTS.map((manifest) => [manifest.key, manifest]),
) as Record<ConnectionProviderKey, ConnectorManifest>;

export function connectorManifest(key: string) {
  return CONNECTOR_MANIFESTS.find((manifest) => manifest.key === key);
}
