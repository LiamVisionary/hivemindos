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

export const SOCIAL_PLATFORMS = ["x", "telegram", "farcaster", "linkedin", "reddit"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_CONNECT_METHODS = ["managed-oauth", "oauth", "api-token", "mcp"] as const;
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
  awakeHours: SocialAwakeHours;
  contextSources: SocialContextSource[];
  /** Daily budget for metered read ops (X managed reads cost credits). 0 = never auto-refresh. */
  maxDailyReadOps: number;
  /**
   * Non-secret platform bindings: telegram { chatId }, farcaster { fid, signerUuid },
   * x-managed { connectionSlug }, reddit { defaultSubreddit }. An `env:<CANONICAL_KEY>`
   * entry re-points that credential at a differently-named shared env key for this
   * account only (adapters resolve via accountEnvValue); values are key NAMES, never secrets.
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
  media?: Array<{ path: string; alt?: string }>;
  /** External post id this replies to. */
  replyTo?: string;
  /** External post id this quotes. */
  quoteOf?: string;
  origin: "agent" | "human";
  /** True only when fired by auto mode — drives the automated/manual badge in history. */
  automated: boolean;
  /** Agent-suggested time (manual mode: advisory only, never fires anything). */
  suggestedFor?: string;
  /** The actual fire time; only meaningful in state "scheduled". */
  scheduledFor?: string;
  approval?: SocialQueueApproval;
  result?: { externalId: string; url?: string; postedAt: string };
  failure?: { at: string; error: string; attempts: number };
  canceledAt?: string;
  stateHistory: Array<{ state: SocialQueueItemState; at: string; by: "human" | "agent" | "tick" }>;
  createdAt: string;
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
    notes?: string;
  }>;
  capabilities: Record<SocialCapability, SocialCapabilitySupport>;
  limits: string[];
  analytics: { postMetrics: string[]; accountMetrics: string[]; note: string };
};
