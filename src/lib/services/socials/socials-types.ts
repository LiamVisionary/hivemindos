import type { KanbanTaskAttachment } from "@/lib/types/kanban";

/**
 * Socials — shared types for the social command center.
 *
 * Pure types only (importable from server, client, and hermetic .mjs tests via
 * the ts loader). The policy invariant that shapes several of these types:
 * nothing ever posts without an explicit human action or an explicit,
 * per-account auto-mode opt-in — the queue engine re-checks approval at fire
 * time, fail-closed.
 */

export const SOCIAL_PLATFORMS = ["x", "telegram", "farcaster", "linkedin", "reddit", "facebook"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_CONNECT_METHODS = ["managed-oauth", "oauth", "api-token", "mcp", "browser-profile"] as const;
export type SocialConnectMethod = (typeof SOCIAL_CONNECT_METHODS)[number];

export const SOCIAL_CAPABILITIES = ["read", "post", "search", "reply", "quote"] as const;
export type SocialCapability = (typeof SOCIAL_CAPABILITIES)[number];

export type SocialCapabilitySupport = "supported" | "limited" | "unsupported";

/** Posting window, mirroring the quiet-hours shape in AgentCallPreferences. */
export type SocialAwakeHours = {
  enabled: boolean;
  /** "09:00" 24h local-to-timezone */
  start: string;
  /** "22:00" — may wrap past midnight like quiet hours */
  end: string;
  /** IANA zone, e.g. "America/New_York" */
  timezone: string;
  /** JS day numbers (0 = Sunday); rendered Monday-first like dailyCallDays */
  days: number[];
};

export type SocialContextSourceKind = "github" | "website" | "x-account" | "local-folder" | "local-file";

export type SocialContextSource = {
  id: string;
  kind: SocialContextSourceKind;
  /** repo URL / site URL / @handle / absolute path */
  ref: string;
  /** Human note, e.g. "pull recent commits", "tone reference" */
  note?: string;
  addedAt: string;
};

export type SocialAccountStatus = "connected" | "needs-attention" | "disconnected";
export type SocialPostingMode = "manual" | "auto";

export const SOCIAL_DRAFT_CADENCE_HOURS = [6, 12, 24, 48, 168] as const;
export type SocialDraftCadenceHours = (typeof SOCIAL_DRAFT_CADENCE_HOURS)[number];

export const SOCIAL_DRAFTS_PER_RUN = [1, 2, 3, 4, 5] as const;
export type SocialDraftsPerRun = (typeof SOCIAL_DRAFTS_PER_RUN)[number];

export const SOCIAL_ENGAGEMENT_DRAFTS_PER_RUN = [0, 1, 2, 3, 4, 5] as const;
export type SocialEngagementDraftsPerRun = (typeof SOCIAL_ENGAGEMENT_DRAFTS_PER_RUN)[number];

export const SOCIAL_QUOTE_DRAFTS_PER_RUN = [0, 1, 2] as const;
export type SocialQuoteDraftsPerRun = (typeof SOCIAL_QUOTE_DRAFTS_PER_RUN)[number];

export const SOCIAL_ENGAGEMENT_LOOKBACK_HOURS = [12, 24, 48, 72, 168] as const;
export type SocialEngagementLookbackHours = (typeof SOCIAL_ENGAGEMENT_LOOKBACK_HOURS)[number];

/** Per-account autonomous drafting policy. Drafting and publishing are separate gates. */
export type SocialDraftingPolicy = {
  enabled: boolean;
  cadenceHours: SocialDraftCadenceHours;
  draftsPerRun: SocialDraftsPerRun;
  /** Find relevant live posts and draft contextual, review-only engagement. */
  engagementEnabled: boolean;
  replyDraftsPerRun: SocialEngagementDraftsPerRun;
  quoteDraftsPerRun: SocialQuoteDraftsPerRun;
  engagementLookbackHours: SocialEngagementLookbackHours;
  updatedAt: string;
  updatedBy: "human" | "system";
};

export type SocialGeneratedDraftKind = "post" | "reply" | "quote";

/** Public source snapshot retained with a reply/quote suggestion for informed review. */
export type SocialEngagementTarget = {
  platform: "x";
  externalId: string;
  url: string;
  authorHandle: string;
  authorName?: string;
  authorVerified?: boolean;
  text: string;
  createdAt: string;
  discoveredAt: string;
  source: "timeline" | "search";
  sourceQuery?: string;
  metrics: {
    likes: number;
    reposts: number;
    replies: number;
    quotes: number;
    views?: number;
  };
};

/**
 * A connected social account. Definitions replicate through the shared vault
 * (Operations/Socials/socials.json); secrets never live here — credentials
 * stay in the shared hive env and non-secret bindings live in `binding`.
 */
export type SocialAccount = {
  /** Provider-encoded id like agent mailboxes: "x:liamvisionary", "telegram:-100123..." */
  id: string;
  platform: SocialPlatform;
  handle: string;
  displayName?: string;
  method: SocialConnectMethod;
  status: SocialAccountStatus;
  /** Vault soul reference like "Skills/liam-x-soul" — a pointer, never a copy. */
  soulPath?: string;
  /** DEFAULT "manual". "auto" requires autoOptIn (enforced by the store + queue engine). */
  postingMode: SocialPostingMode;
  /** Explicit human opt-in trail; REQUIRED when postingMode === "auto". */
  autoOptIn?: { enabledAt: string; enabledBy: "human"; note?: string };
  /** Generates queue suggestions on a durable cadence. It never bypasses postingMode. */
  drafting: SocialDraftingPolicy;
  awakeHours: SocialAwakeHours;
  contextSources: SocialContextSource[];
  /** Daily budget for metered read ops (X managed reads cost credits). 0 = never auto-refresh. */
  maxDailyReadOps: number;
  /**
   * Non-secret platform bindings: telegram { chatId }, farcaster { fid, signerUuid },
   * x-managed { connectionSlug, creditAccountId, creditSlug }, x Agent Reach
   * { xSessionMode, env:TWITTER_AUTH_TOKEN, env:TWITTER_CT0 }, reddit
   * { defaultSubreddit }. An `env:<CANONICAL_KEY>` entry re-points that
   * credential at a differently-named shared env key for this account only
   * (adapters resolve via accountEnvValue); values are key NAMES, never secrets.
   */
  binding?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export const SOCIAL_QUEUE_ITEM_STATES = [
  "draft",
  "suggested",
  "approved",
  "scheduled",
  "posting",
  "posted",
  "canceled",
  "failed",
] as const;
export type SocialQueueItemState = (typeof SOCIAL_QUEUE_ITEM_STATES)[number];

export type SocialQueueApproval =
  | { at: string; by: "human" }
  | { at: string; by: "auto-mode"; optInAt: string };

export type SocialQueueItem = {
  id: string;
  accountId: string;
  platform: SocialPlatform;
  state: SocialQueueItemState;
  text: string;
  /** Required for Reddit link/self posts; ignored by other platforms. */
  title?: string;
  /** Per-item subreddit override; falls back to account.binding.defaultSubreddit. */
  subreddit?: string;
  media?: Array<{ path: string; alt?: string }>;
  /** External post id this replies to. */
  replyTo?: string;
  /** External post id this quotes. */
  quoteOf?: string;
  origin: "agent" | "human";
  /** Non-secret provenance for model-created drafts. */
  generation?: {
    generatedAt: string;
    model: string;
    contextSourceIds: string[];
    kind: SocialGeneratedDraftKind;
    rationale?: string;
    relevanceScore?: number;
    target?: SocialEngagementTarget;
  };
  /** True only when fired by auto mode — drives the automated/manual badge in history. */
  automated: boolean;
  /** Agent-suggested time (manual mode: advisory only, never fires anything). */
  suggestedFor?: string;
  /** The actual fire time; only meaningful in state "scheduled". */
  scheduledFor?: string;
  /** Auto-mode posts remain cancelable until this instant. */
  cancelWindowEndsAt?: string;
  approval?: SocialQueueApproval;
  result?: { externalId: string; url?: string; postedAt: string; metrics?: Record<string, number> };
  /** Persisted before the external call, so recovery never guesses whether a send happened. */
  delivery?: { idempotencyKey: string; attempt: number; startedAt: string };
  retryAt?: string;
  failure?: {
    at: string;
    error: string;
    attempts: number;
    /** ambiguous means the provider may have accepted the post; only a human may retry it. */
    kind?: "definite" | "ambiguous";
    retryable?: boolean;
  };
  canceledAt?: string;
  stateHistory: Array<{ state: SocialQueueItemState; at: string; by: "human" | "agent" | "tick" }>;
  createdAt: string;
  updatedAt?: string;
};

export type SocialQueueEngineSettings = {
  enabled: boolean;
  updatedAt: string;
  updatedBy: "human" | "system";
};

export type SocialQueueEngineMeta = {
  settings: SocialQueueEngineSettings;
  lastTickAt?: string;
  lastPostedAt?: string;
  lastError?: string;
};

/** Per-machine runtime receipt for one account's autonomous drafting loop. */
export type SocialDraftingRuntime = {
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  nextRunAt?: string;
  inFlightSince?: string;
  lastError?: string;
  lastModel?: string;
  lastGeneratedCount?: number;
  lastPostGeneratedAt?: string;
  lastEngagementGeneratedAt?: string;
  lastPostGeneratedCount?: number;
  lastReplyGeneratedCount?: number;
  lastQuoteGeneratedCount?: number;
  lastDiscoveryAt?: string;
  lastDiscoveryBackend?: "agent-reach-twitter-cli";
  lastDiscoveredCount?: number;
  lastEngagementError?: string;
  totalGenerated: number;
  consecutiveFailures: number;
};

export type SocialXDiscoveryStatus = {
  available: boolean;
  authenticated: boolean;
  backend: "agent-reach-twitter-cli";
  checkedAt: string;
  accountHandle?: string;
  detail: string;
};

export type SocialLearningScope = "account" | "platform" | "global";

export type SocialLearning = {
  id: string;
  text: string;
  scope: SocialLearningScope;
  /** Required when scope !== "global". */
  platform?: SocialPlatform;
  /** Required when scope === "account". */
  accountId?: string;
  skills?: string[];
  attachments?: KanbanTaskAttachment[];
  source: "inject" | "reject";
  /** Queue item id when captured from a correction on a specific post. */
  postRef?: string;
  createdAt: string;
};

export type SocialMetricSnapshot = {
  at: string;
  accountId: string;
  /** Absent = account-level snapshot (followers/members/karma). */
  externalId?: string;
  metrics: Record<string, number>;
};

export type SocialReadUsage = {
  at: string;
  accountId: string;
  operations: number;
  source: "analytics-refresh";
};

/** Client-facing projection of one platform's matrix row. */
export type SocialPlatformCapabilityDto = {
  platform: SocialPlatform;
  label: string;
  methods: Array<{
    method: SocialConnectMethod;
    label: string;
    envKeys: string[];
    /** Known same-meaning alternate env key names per canonical key — the connect modal auto-detects and binds these. */
    envKeyAliases?: Record<string, string[]>;
    setupFields?: string[];
    oauthStartPath?: string;
    /** browser-profile methods: managed persistent-profile naming + login/probe URLs (no secrets — the session lives in the profile). */
    browserProfile?: { namePrefix: string; loginUrl: string; probeUrl: string; signedInCookie?: string };
    notes?: string;
  }>;
  capabilities: Record<SocialCapability, SocialCapabilitySupport>;
  limits: string[];
  analytics: { postMetrics: string[]; accountMetrics: string[]; note: string };
};
