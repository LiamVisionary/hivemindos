import type { ConnectionProviderKey, ConnectionSetupField } from "@/lib/types/integrations";
import type { HiveActionRisk, HiveActionSideEffect } from "@/lib/services/hive-actions/types";
import {
  GOOGLE_CLIENT_ID_ENV,
  GOOGLE_CLIENT_SECRET_ENV,
  GOOGLE_CLOUD_CLIENT_ID_ENV,
  GOOGLE_CLOUD_CLIENT_SECRET_ENV,
  AZURE_OAUTH_CLIENT_ID_ENV,
  MONID_API_KEY_ENV,
  SLACK_OAUTH_CLIENT_ID_ENV,
} from "@/lib/services/integrations/provider-connection-env";
import { CLAWBANK_TOKEN_ENV_NAMES } from "@/lib/services/clawbank/constants";

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
  setupFields?: Array<ConnectionSetupField & { envKey: string }>;
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
    detail: "Drive, editable Slides, Gmail, and Calendar context.",
    tags: ["drive", "slides", "presentations", "gmail", "calendar", "oauth", "mcp"],
    auth: {
      mode: "oauth-refresh-token",
      tokenEnvKey: "GOOGLE_OAUTH_REFRESH_TOKEN",
      tokenHint: "One-time setup so you can sign in with your Google account.",
      tokenPlaceholder: "",
      oauthClientEnvKeys: [GOOGLE_CLIENT_ID_ENV, GOOGLE_CLIENT_SECRET_ENV],
    },
    operations: [
      READ_CONNECTION_OPERATION,
      READ_API_OPERATION,
      {
        id: "edit-google-slides",
        label: "Edit Google Slides",
        description: "Create or edit presentations through the HivemindOS MCP after explicit confirmation.",
        methods: ["POST"],
        sideEffects: ["network", "write"],
        risk: "high",
        requiredClaims: ["connectors:invoke"],
      },
    ],
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
      setupFields: [{
        id: "baseUrl",
        envKey: "PLAUSIBLE_BASE_URL",
        label: "Plausible base URL",
        placeholder: "https://plausible.io",
        hint: "Leave the managed-cloud default, or enter the origin of your self-hosted Community Edition instance.",
        required: false,
      }],
    },
    operations: [READ_CONNECTION_OPERATION, READ_API_OPERATION],
  },
  {
    key: "calcom",
    label: "Cal.com",
    detail: "Scheduling links, event types, availability, and bookings.",
    tags: ["calendar", "scheduling", "bookings", "availability"],
    auth: {
      mode: "api-token",
      tokenEnvKey: "CALCOM_API_KEY",
      tokenHint: "Create an API key in Cal.com Settings -> Security, or in the matching settings page of your self-hosted instance.",
      tokenPlaceholder: "cal_live_...",
      setupFields: [{
        id: "baseUrl",
        envKey: "CALCOM_API_BASE_URL",
        label: "Cal.com API base URL",
        placeholder: "https://api.cal.com/v2",
        hint: "Leave the hosted default, or enter the /v2 API base URL for your self-hosted instance.",
        required: false,
      }],
    },
    operations: [READ_CONNECTION_OPERATION, READ_API_OPERATION],
  },
  {
    key: "shopify",
    label: "Shopify",
    detail: "Store identity, product catalog, collections, inventory context, and orders through the Admin GraphQL API.",
    tags: ["commerce", "store", "products", "catalog", "orders", "graphql"],
    auth: {
      mode: "api-token",
      tokenEnvKey: "SHOPIFY_ADMIN_ACCESS_TOKEN",
      tokenHint: "Create or install a custom app in Shopify Admin, grant only the scopes you need, then copy its Admin API access token.",
      tokenPlaceholder: "shpat_...",
      setupFields: [{
        id: "shopDomain",
        envKey: "SHOPIFY_STORE_DOMAIN",
        label: "Shop domain",
        placeholder: "your-store.myshopify.com",
        hint: "Use the permanent *.myshopify.com domain, not a customer-facing custom domain.",
        required: true,
      }],
    },
    operations: [
      READ_CONNECTION_OPERATION,
      {
        ...READ_API_OPERATION,
        id: "read-shopify-admin",
        label: "Read Shopify store and catalog",
        description: "Read store identity and product catalog through server-held Admin API credentials.",
      },
    ],
  },
  {
    key: "medusa",
    label: "Medusa",
    detail: "Products, regions, and storefront context from a hosted or self-hosted Medusa Store API.",
    tags: ["commerce", "store", "products", "catalog", "self-hosted"],
    auth: {
      mode: "api-token",
      tokenEnvKey: "MEDUSA_PUBLISHABLE_API_KEY",
      tokenHint: "Create or copy a publishable API key in Medusa Admin -> Settings -> Publishable API Keys.",
      tokenPlaceholder: "pk_...",
      setupFields: [{
        id: "baseUrl",
        envKey: "MEDUSA_API_BASE_URL",
        label: "Medusa API base URL",
        placeholder: "http://127.0.0.1:9000",
        hint: "Enter the origin of your hosted or self-hosted Medusa backend.",
        required: false,
      }],
    },
    operations: [
      READ_CONNECTION_OPERATION,
      {
        ...READ_API_OPERATION,
        id: "read-medusa-store",
        label: "Read Medusa store data",
        description: "Read products and regions through server-held Store API credentials.",
      },
    ],
  },
  {
    key: "monid",
    label: "Monid",
    detail: "Discover and run data tools, including AKTA Pro private-company intelligence, through one connected workspace.",
    tags: ["research", "data", "private-companies", "akta-pro"],
    auth: {
      mode: "api-token",
      tokenEnvKey: MONID_API_KEY_ENV,
      tokenHint: "Create an API key in the Monid dashboard. HivemindOS checks it against your workspace balance before saving it.",
      tokenPlaceholder: "Monid API key",
    },
    operations: [
      READ_CONNECTION_OPERATION,
      {
        ...READ_API_OPERATION,
        id: "discover-inspect-monid",
        label: "Discover and inspect data tools",
        description: "Search Monid's live catalog and inspect endpoint schemas and current prices without executing a paid request.",
      },
      {
        id: "run-monid-tool",
        label: "Run a data tool",
        description: "Execute a reviewed Monid endpoint against the connected workspace balance after price verification and confirmation.",
        methods: ["POST"],
        sideEffects: ["network", "payment"],
        risk: "high",
        requiredClaims: ["wallet:spend"],
      },
    ],
  },
  {
    key: "telegram-social",
    label: "Telegram (Socials)",
    detail: "Publish to a Telegram channel from the Socials route. Shares TELEGRAM_BOT_TOKEN with the notification/messaging rail; the channel chat id is a non-secret binding stored by the Socials route.",
    tags: ["social", "telegram", "publishing"],
    auth: {
      mode: "api-token",
      tokenEnvKey: "TELEGRAM_BOT_TOKEN",
      tokenHint: "Create a bot with @BotFather in Telegram, then paste its bot token.",
      tokenPlaceholder: "123456789:AA...",
    },
    operations: [
      READ_CONNECTION_OPERATION,
      {
        ...READ_API_OPERATION,
        id: "read-telegram-bot",
        label: "Read Telegram bot identity",
        description: "Read the bot identity and channel metadata through the Telegram Bot API.",
      },
      {
        id: "post-telegram-channel",
        label: "Post to Telegram channel",
        description: "Publish a message to the bound Telegram channel after policy approval.",
        methods: ["POST"],
        sideEffects: ["network", "public-message"],
        risk: "high",
        requiredClaims: ["messages:publish"],
      },
    ],
  },
  {
    key: "farcaster",
    label: "Farcaster (Neynar)",
    detail: "Publish casts and read Farcaster context through Neynar. The signer UUID and fid live as non-secret bindings in the Socials route.",
    tags: ["social", "farcaster", "neynar", "publishing"],
    auth: {
      mode: "api-token",
      tokenEnvKey: "NEYNAR_API_KEY",
      tokenHint: "Create an API key in the Neynar developer portal (dev.neynar.com).",
      tokenPlaceholder: "Neynar API key",
    },
    operations: [
      READ_CONNECTION_OPERATION,
      {
        ...READ_API_OPERATION,
        id: "read-farcaster-api",
        label: "Read Farcaster API",
        description: "Read users, casts, and feeds through the Neynar API.",
      },
      {
        id: "post-farcaster-cast",
        label: "Publish a cast",
        description: "Publish a cast through the bound Neynar signer after policy approval.",
        methods: ["POST"],
        sideEffects: ["network", "public-message"],
        risk: "high",
        requiredClaims: ["messages:publish"],
      },
    ],
  },
  {
    // GitHub's model: the OAuth flow mints a long-lived access token stored in
    // the token key, and pasting a token works too — so mode stays "api-token"
    // with oauthClientEnvKeys, not "oauth-refresh-token" (which here means the
    // stored credential is a refresh token exchanged at verify time).
    key: "linkedin",
    label: "LinkedIn",
    detail: "Publish member posts and read profile identity through the LinkedIn API.",
    tags: ["social", "linkedin", "publishing", "oauth"],
    auth: {
      mode: "api-token",
      tokenEnvKey: "LINKEDIN_ACCESS_TOKEN",
      tokenHint: "Sign in with LinkedIn, or paste an access token minted for your LinkedIn app.",
      tokenPlaceholder: "",
      oauthClientEnvKeys: ["LINKEDIN_OAUTH_CLIENT_ID", "LINKEDIN_OAUTH_CLIENT_SECRET"],
    },
    operations: [
      READ_CONNECTION_OPERATION,
      {
        ...READ_API_OPERATION,
        id: "read-linkedin-profile",
        label: "Read LinkedIn profile",
        description: "Read the signed-in member's profile identity through the LinkedIn API.",
      },
      {
        id: "post-linkedin-share",
        label: "Publish a LinkedIn post",
        description: "Publish a member post through the LinkedIn API after policy approval.",
        methods: ["POST"],
        sideEffects: ["network", "public-message"],
        risk: "high",
        requiredClaims: ["messages:publish"],
      },
    ],
  },
  {
    key: "reddit",
    label: "Reddit",
    detail: "Submit posts and read identity through the Reddit API using a script app (password grant).",
    tags: ["social", "reddit", "publishing"],
    auth: {
      mode: "api-token",
      tokenEnvKey: "REDDIT_CLIENT_SECRET",
      tokenHint: "Create a \"script\" app at reddit.com/prefs/apps, then paste its client secret here.",
      tokenPlaceholder: "Reddit app client secret",
      setupFields: [
        {
          id: "clientId",
          envKey: "REDDIT_CLIENT_ID",
          label: "Client ID",
          placeholder: "abc123DEF456",
          hint: "The short id shown under the app name at reddit.com/prefs/apps.",
          required: true,
        },
        {
          id: "username",
          envKey: "REDDIT_USERNAME",
          label: "Reddit username",
          placeholder: "your-username",
          hint: "The account that owns the script app (without the u/ prefix).",
          required: true,
        },
        {
          id: "password",
          envKey: "REDDIT_PASSWORD",
          label: "Reddit password",
          placeholder: "",
          hint: "Needed for the script-app password grant. Stored only in the shared hive env.",
          required: true,
        },
      ],
    },
    operations: [
      READ_CONNECTION_OPERATION,
      {
        ...READ_API_OPERATION,
        id: "read-reddit-api",
        label: "Read Reddit API",
        description: "Read identity, subreddits, and posts through the Reddit API.",
      },
      {
        id: "post-reddit-submission",
        label: "Submit a Reddit post",
        description: "Submit a post to a subreddit after policy approval.",
        methods: ["POST"],
        sideEffects: ["network", "public-message"],
        risk: "high",
        requiredClaims: ["messages:publish"],
      },
    ],
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
