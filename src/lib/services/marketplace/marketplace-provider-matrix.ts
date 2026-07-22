import {
  MARKETPLACE_CAPABILITIES,
  MARKETPLACE_PROVIDERS,
  type MarketplaceCapability,
  type MarketplaceCapabilitySupport,
  type MarketplaceConnectMethod,
  type MarketplaceExecutionStyle,
  type MarketplaceProvider,
  type MarketplaceProviderCapabilityDto,
} from "@/lib/services/marketplace/marketplace-types";

/**
 * MARKETPLACE_PROVIDER_MATRIX — the single source of truth for how each
 * marketplace connects, what it can do, and how its operations execute.
 *
 * Follows the SOCIAL_PLATFORM_MATRIX / CRYPTO_PROVIDER_MATRIX convention:
 * behavior that varies by provider lives in a row here, not in scattered
 * conditionals. Adding a provider means adding one row and an adapter — the
 * load-time invariant below (and scripts/test-marketplace-matrix.mjs) fails
 * fast when a row is incomplete.
 */

export type MarketplaceMethodSpec = {
  method: MarketplaceConnectMethod;
  label: string;
  /** Shared hive env keys this method needs (oauth/api-token providers). */
  envKeys: string[];
  /** For oauth methods: the dashboard route that starts the flow. */
  oauthStartPath?: string;
  /**
   * For browser-profile methods: the managed browser-use profile naming scheme
   * and the URLs the connect flow opens/probes. The session cookie jar lives in
   * the persistent profile on the bound fleet machine — never in env or records.
   */
  browserProfile?: { namePrefix: string; loginUrl: string; probeUrl: string; signedInCookie?: string };
  notes?: string;
};

export type MarketplaceProviderMatrixRow = {
  provider: MarketplaceProvider;
  label: string;
  methods: MarketplaceMethodSpec[];
  capabilities: Record<MarketplaceCapability, MarketplaceCapabilitySupport>;
  execution: MarketplaceExecutionStyle;
  /** Ops that require an explicit approved decision record before the adapter will execute them. */
  gatedOps: Array<{ op: "createListing"; gate: string }>;
  /** Human-readable provider quirks, surfaced as UI tooltips. */
  limits: string[];
};

/** Approval gate shared by listing creation: adapters refuse to post without an approved decision. */
export const MARKETPLACE_LISTING_APPROVAL_GATE = "listing-approval-required";

export const MARKETPLACE_PROVIDER_MATRIX = {
  facebook: {
    provider: "facebook",
    label: "Facebook Marketplace",
    methods: [
      {
        method: "browser-profile",
        label: "Managed browser sign-in",
        envKeys: [],
        browserProfile: {
          namePrefix: "marketplace-facebook",
          // Plain facebook.com: the /marketplace login bounce feeds FB's ?_rdr
          // redirect loop on a fresh cookie-less profile.
          loginUrl: "https://www.facebook.com/",
          probeUrl: "https://www.facebook.com/marketplace/you/selling",
          // Presence-only signal for the passive sign-in poll (never navigates).
          signedInCookie: "c_user",
        },
        notes:
          "Sign in once in a dedicated managed browser window; the agent reuses that persistent profile on the machine you connected from. Facebook's Graph API does not cover personal Marketplace, so a signed-in browser session is the only rail.",
      },
    ],
    capabilities: {
      listListings: "supported",
      createListing: "supported",
      updateListing: "limited",
      endListing: "supported",
      readConversations: "supported",
      sendMessage: "supported",
      syncCatalog: "supported",
    },
    execution: "browser-agent",
    gatedOps: [{ op: "createListing", gate: MARKETPLACE_LISTING_APPROVAL_GATE }],
    limits: [
      "No official API for personal Marketplace — everything runs through your signed-in browser session, so Facebook layout changes can require a retry.",
      "Facebook may occasionally ask you to sign in again (session checkpoint); the account shows needs-attention until you do.",
      "Listing edits beyond price and description are limited; some changes require ending and re-listing.",
    ],
  },
} as const satisfies Record<MarketplaceProvider, MarketplaceProviderMatrixRow>;

/**
 * Load-time invariant (mirrors the socials matrix): every provider has a row,
 * every method declares a credential rail (env keys, an OAuth start path, or a
 * managed browser profile), every capability key exists, and every provider
 * that can create listings gates creation on an approved decision. Throwing at
 * import keeps a half-added provider from booting quietly.
 */
for (const provider of MARKETPLACE_PROVIDERS) {
  const row = MARKETPLACE_PROVIDER_MATRIX[provider] as MarketplaceProviderMatrixRow;
  if (!row || row.provider !== provider) throw new Error(`MARKETPLACE_PROVIDER_MATRIX missing or mislabeled row: ${provider}`);
  if (!row.methods.length) throw new Error(`MARKETPLACE_PROVIDER_MATRIX[${provider}] declares no connect methods`);
  for (const method of row.methods) {
    if (!method.envKeys.length && !method.oauthStartPath && !method.browserProfile) {
      throw new Error(`MARKETPLACE_PROVIDER_MATRIX[${provider}] method ${method.method} declares no credential rail (envKeys, oauthStartPath, or browserProfile)`);
    }
    if (method.method === "browser-profile" && !method.browserProfile) {
      throw new Error(`MARKETPLACE_PROVIDER_MATRIX[${provider}] browser-profile method is missing its browserProfile spec`);
    }
    if (method.browserProfile) {
      const { namePrefix, loginUrl, probeUrl } = method.browserProfile;
      if (!namePrefix || !loginUrl || !probeUrl) {
        throw new Error(`MARKETPLACE_PROVIDER_MATRIX[${provider}] browserProfile spec is incomplete (needs namePrefix, loginUrl, probeUrl)`);
      }
    }
  }
  for (const capability of MARKETPLACE_CAPABILITIES) {
    if (!row.capabilities[capability]) {
      throw new Error(`MARKETPLACE_PROVIDER_MATRIX[${provider}] missing capability entry: ${capability}`);
    }
  }
  if (row.execution !== "browser-agent" && row.execution !== "api") {
    throw new Error(`MARKETPLACE_PROVIDER_MATRIX[${provider}] has an unknown execution style: ${String(row.execution)}`);
  }
  if (
    row.capabilities.createListing !== "unsupported" &&
    !row.gatedOps.some((gated) => gated.op === "createListing" && gated.gate === MARKETPLACE_LISTING_APPROVAL_GATE)
  ) {
    throw new Error(`MARKETPLACE_PROVIDER_MATRIX[${provider}] supports listing creation but does not gate it on ${MARKETPLACE_LISTING_APPROVAL_GATE}`);
  }
}

export function marketplaceProviderRow(provider: MarketplaceProvider): MarketplaceProviderMatrixRow {
  return MARKETPLACE_PROVIDER_MATRIX[provider];
}

export function isMarketplaceProvider(value: unknown): value is MarketplaceProvider {
  return typeof value === "string" && (MARKETPLACE_PROVIDERS as readonly string[]).includes(value);
}

/** Client projection consumed by the Marketplace UI and /api/marketplace/accounts. */
export function marketplaceProviderCapabilityDtos(): MarketplaceProviderCapabilityDto[] {
  return MARKETPLACE_PROVIDERS.map((provider) => {
    const row = marketplaceProviderRow(provider);
    return {
      provider,
      label: row.label,
      methods: row.methods.map((method) => ({
        method: method.method,
        label: method.label,
        envKeys: [...method.envKeys],
        ...(method.oauthStartPath ? { oauthStartPath: method.oauthStartPath } : {}),
        ...(method.browserProfile ? { browserProfile: { ...method.browserProfile } } : {}),
        ...(method.notes ? { notes: method.notes } : {}),
      })),
      capabilities: { ...row.capabilities },
      execution: row.execution,
      limits: [...row.limits],
    };
  });
}
