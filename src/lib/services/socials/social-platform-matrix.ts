import {
  SOCIAL_CAPABILITIES,
  SOCIAL_PLATFORMS,
  type SocialCapability,
  type SocialCapabilitySupport,
  type SocialConnectMethod,
  type SocialPlatform,
  type SocialPlatformCapabilityDto,
} from "@/lib/services/socials/socials-types";

/**
 * SOCIAL_PLATFORM_MATRIX — the single source of truth for how each social
 * platform connects, what it can do, and what its analytics actually expose.
 *
 * Follows the CRYPTO_PROVIDER_MATRIX convention: behavior that varies by
 * platform lives in a row here, not in scattered conditionals. Adding a
 * platform means adding one row, an adapter, and a connector manifest — the
 * load-time invariant below (and scripts/test-socials-matrix.mjs) fails fast
 * when a row is incomplete.
 */

export type SocialMethodSpec = {
  method: SocialConnectMethod;
  label: string;
  /** Shared hive env keys this method needs (written via writeSharedHiveEnvValues, never client-side). */
  envKeys: string[];
  /**
   * Known same-meaning alternate names for a canonical key (e.g. consumer-key
   * naming for X_API_KEY). The connect modal auto-detects these among saved
   * shared env keys and pre-binds an `env:<CANONICAL>` account override.
   * Synonyms only — never a different-purpose credential that happens to fit.
   */
  envKeyAliases?: Record<string, string[]>;
  /** Connector-manifest setup fields collected in the connect modal (non-secret bindings note included in labels). */
  setupFields?: string[];
  /** For oauth/managed-oauth methods: the dashboard route that starts the flow. */
  oauthStartPath?: string;
  notes?: string;
};

export type SocialPlatformMatrixRow = {
  platform: SocialPlatform;
  label: string;
  methods: SocialMethodSpec[];
  capabilities: Record<SocialCapability, SocialCapabilitySupport>;
  /** Ops that require an explicit approval record before the adapter will execute them. */
  gatedOps: Array<{ op: "post" | "reply" | "quote"; gate: string }>;
  /** Human-readable platform quirks, surfaced as UI tooltips. */
  limits: string[];
  analytics: { postMetrics: string[]; accountMetrics: string[]; note: string };
};

/** Approval gate label shared by every posting op: the queue engine refuses to fire without it. */
export const SOCIAL_POST_APPROVAL_GATE = "queue-approval-required";

export const SOCIAL_PLATFORM_MATRIX = {
  x: {
    platform: "x",
    label: "X",
    methods: [
      {
        method: "managed-oauth",
        label: "HivemindOS managed sign-in",
        envKeys: [],
        oauthStartPath: "/api/integrations/x-managed",
        notes: "Managed x-api-gateway OAuth. The only method that supports multiple X accounts (connection slugs). Reads/writes are credit-metered.",
      },
      {
        method: "api-token",
        label: "Bring your own X API app",
        envKeys: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"],
        envKeyAliases: {
          X_API_KEY: ["X_API_CONSUMER_KEY", "TWITTER_API_KEY", "TWITTER_CONSUMER_KEY"],
          X_API_SECRET: ["X_API_SECRET_KEY", "X_API_CONSUMER_SECRET", "TWITTER_API_SECRET", "TWITTER_CONSUMER_SECRET"],
          X_ACCESS_TOKEN: ["TWITTER_ACCESS_TOKEN"],
          X_ACCESS_TOKEN_SECRET: ["TWITTER_ACCESS_TOKEN_SECRET", "TWITTER_ACCESS_SECRET"],
        },
        notes: "OAuth1 user-context keys from your own developer app (xurl-compatible).",
      },
      {
        method: "mcp",
        label: "X MCP",
        envKeys: ["X_MCP_CLIENT_ID", "X_MCP_CLIENT_SECRET"],
        notes: "BYO X MCP app registered across agent runtimes; used as an agent-side rail.",
      },
    ],
    capabilities: { read: "supported", post: "supported", search: "supported", reply: "limited", quote: "limited" },
    gatedOps: [
      { op: "post", gate: SOCIAL_POST_APPROVAL_GATE },
      { op: "reply", gate: SOCIAL_POST_APPROVAL_GATE },
      { op: "quote", gate: SOCIAL_POST_APPROVAL_GATE },
    ],
    limits: [
      "Replies and quote posts targeting accounts that do not mention you return 403 at the current API access level; quote posts fall back to appending the target URL.",
      "Managed reads and writes debit HivemindOS credits; per-account daily read budget applies.",
    ],
    analytics: {
      postMetrics: ["likes", "reposts", "replies", "quotes", "bookmarks", "impressions"],
      accountMetrics: ["followers", "following", "posts"],
      note: "Public engagement metrics via the existing X read rails; impressions only where the API exposes them.",
    },
  },
  telegram: {
    platform: "telegram",
    label: "Telegram",
    methods: [
      {
        method: "api-token",
        label: "Bot token",
        envKeys: ["TELEGRAM_BOT_TOKEN"],
        setupFields: ["chatId"],
        notes: "Bot must be an admin of the channel with post rights. chatId is the channel id (-100…).",
      },
    ],
    capabilities: { read: "limited", post: "supported", search: "unsupported", reply: "limited", quote: "unsupported" },
    gatedOps: [{ op: "post", gate: SOCIAL_POST_APPROVAL_GATE }],
    limits: [
      "Bot API exposes no per-post view counts; per-post analytics are unavailable by design.",
      "Replies only work as comment threads when the channel has a linked discussion group.",
    ],
    analytics: {
      postMetrics: [],
      accountMetrics: ["members"],
      note: "Member-count time series only; the Bot API does not expose message views.",
    },
  },
  farcaster: {
    platform: "farcaster",
    label: "Farcaster",
    methods: [
      {
        method: "api-token",
        label: "Neynar API key + signer",
        envKeys: ["NEYNAR_API_KEY"],
        setupFields: ["fid", "signerUuid"],
        notes: "Casts publish through a Neynar-managed signer for your fid.",
      },
    ],
    capabilities: { read: "supported", post: "supported", search: "supported", reply: "supported", quote: "supported" },
    gatedOps: [
      { op: "post", gate: SOCIAL_POST_APPROVAL_GATE },
      { op: "reply", gate: SOCIAL_POST_APPROVAL_GATE },
      { op: "quote", gate: SOCIAL_POST_APPROVAL_GATE },
    ],
    limits: ["Neynar free-tier rate limits apply; replies use the parent cast hash, quotes use embeds."],
    analytics: {
      postMetrics: ["likes", "recasts", "replies"],
      accountMetrics: ["followers", "following"],
      note: "Per-cast reactions via cast lookup; follower counts via user lookup.",
    },
  },
  linkedin: {
    platform: "linkedin",
    label: "LinkedIn",
    methods: [
      {
        method: "oauth",
        label: "LinkedIn sign-in",
        envKeys: ["LINKEDIN_OAUTH_CLIENT_ID", "LINKEDIN_OAUTH_CLIENT_SECRET", "LINKEDIN_ACCESS_TOKEN"],
        oauthStartPath: "/api/integrations/linkedin/oauth/start",
        notes: "Posting needs the w_member_social product on your LinkedIn developer app (app review). Tokens expire after ~60 days; re-verify surfaces needs-attention.",
      },
    ],
    capabilities: { read: "limited", post: "supported", search: "unsupported", reply: "limited", quote: "unsupported" },
    gatedOps: [{ op: "post", gate: SOCIAL_POST_APPROVAL_GATE }],
    limits: [
      "Connect-only until the LinkedIn app review grants w_member_social; posting 403s before that.",
      "Engagement counts only on your own posts; impressions require the Marketing tier.",
    ],
    analytics: {
      postMetrics: ["likes", "comments"],
      accountMetrics: [],
      note: "Own-post social actions only; no impressions without Marketing API access.",
    },
  },
  reddit: {
    platform: "reddit",
    label: "Reddit",
    methods: [
      {
        method: "api-token",
        label: "Script app credentials",
        envKeys: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD"],
        setupFields: ["defaultSubreddit"],
        notes: "Script-app password grant; tokens are re-minted per call (10-minute TTL).",
      },
    ],
    capabilities: { read: "supported", post: "supported", search: "supported", reply: "supported", quote: "limited" },
    gatedOps: [
      { op: "post", gate: SOCIAL_POST_APPROVAL_GATE },
      { op: "reply", gate: SOCIAL_POST_APPROVAL_GATE },
    ],
    limits: ["Each subreddit enforces its own rules and rate limits; crossposting stands in for quoting."],
    analytics: {
      postMetrics: ["score", "upvoteRatio", "comments"],
      accountMetrics: ["linkKarma", "commentKarma"],
      note: "Post score/ratio/comment counts via post info; karma via the identity endpoint.",
    },
  },
} as const satisfies Record<SocialPlatform, SocialPlatformMatrixRow>;

/**
 * Load-time invariant (mirrors the crypto matrix): every platform has a row,
 * every method declares env keys or an OAuth start path, every capability key
 * exists, and every posting-capable platform gates "post" on queue approval.
 * Throwing at import keeps a half-added platform from booting quietly.
 */
for (const platform of SOCIAL_PLATFORMS) {
  const row = SOCIAL_PLATFORM_MATRIX[platform] as SocialPlatformMatrixRow;
  if (!row || row.platform !== platform) throw new Error(`SOCIAL_PLATFORM_MATRIX missing or mislabeled row: ${platform}`);
  if (!row.methods.length) throw new Error(`SOCIAL_PLATFORM_MATRIX[${platform}] declares no connect methods`);
  for (const method of row.methods) {
    if (!method.envKeys.length && !method.oauthStartPath) {
      throw new Error(`SOCIAL_PLATFORM_MATRIX[${platform}] method ${method.method} has neither envKeys nor oauthStartPath`);
    }
    for (const aliasedKey of Object.keys(method.envKeyAliases ?? {})) {
      if (!method.envKeys.includes(aliasedKey)) {
        throw new Error(`SOCIAL_PLATFORM_MATRIX[${platform}] method ${method.method} aliases unknown env key: ${aliasedKey}`);
      }
    }
  }
  for (const capability of SOCIAL_CAPABILITIES) {
    if (!row.capabilities[capability]) {
      throw new Error(`SOCIAL_PLATFORM_MATRIX[${platform}] missing capability entry: ${capability}`);
    }
  }
  if (row.capabilities.post !== "unsupported" && !row.gatedOps.some((gated) => gated.op === "post" && gated.gate === SOCIAL_POST_APPROVAL_GATE)) {
    throw new Error(`SOCIAL_PLATFORM_MATRIX[${platform}] supports posting but does not gate it on ${SOCIAL_POST_APPROVAL_GATE}`);
  }
}

export function socialPlatformRow(platform: SocialPlatform): SocialPlatformMatrixRow {
  return SOCIAL_PLATFORM_MATRIX[platform];
}

/** Client projection consumed by the Socials UI and /api/socials/accounts. */
export function socialPlatformCapabilityDtos(): SocialPlatformCapabilityDto[] {
  return SOCIAL_PLATFORMS.map((platform) => {
    const row = socialPlatformRow(platform);
    return {
      platform,
      label: row.label,
      methods: row.methods.map((method) => ({
        method: method.method,
        label: method.label,
        envKeys: [...method.envKeys],
        ...(method.envKeyAliases
          ? { envKeyAliases: Object.fromEntries(Object.entries(method.envKeyAliases).map(([key, aliases]) => [key, [...aliases]])) }
          : {}),
        ...(method.setupFields ? { setupFields: [...method.setupFields] } : {}),
        ...(method.oauthStartPath ? { oauthStartPath: method.oauthStartPath } : {}),
        ...(method.notes ? { notes: method.notes } : {}),
      })),
      capabilities: { ...row.capabilities },
      limits: [...row.limits],
      analytics: {
        postMetrics: [...row.analytics.postMetrics],
        accountMetrics: [...row.analytics.accountMetrics],
        note: row.analytics.note,
      },
    };
  });
}
