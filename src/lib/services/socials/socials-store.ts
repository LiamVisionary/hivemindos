import "server-only";

import { promises as fs, statSync } from "node:fs";
import { homedir } from "@/lib/home-dir";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { normalizeXProfileImageUrl } from "@/lib/services/socials/social-profile-image";
import { validAwakeHoursConfiguration } from "@/lib/services/socials/social-queue-domain";
import { socialPlatformRow } from "@/lib/services/socials/social-platform-matrix";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import {
  SOCIAL_DRAFT_CADENCE_HOURS,
  SOCIAL_DRAFTS_PER_RUN,
  SOCIAL_ENGAGEMENT_DRAFTS_PER_RUN,
  SOCIAL_ENGAGEMENT_LOOKBACK_HOURS,
  SOCIAL_QUOTE_DRAFTS_PER_RUN,
  SOCIAL_QUEUE_ITEM_STATES,
  SOCIAL_PLATFORMS,
  type SocialAccount,
  type SocialAwakeHours,
  type SocialContextSource,
  type SocialDraftingPolicy,
  type SocialDraftingRuntime,
  type SocialEngagementTarget,
  type SocialGeneratedDraftKind,
  type SocialPlatform,
  type SocialMetricSnapshot,
  type SocialReadUsage,
  type SocialQueueEngineMeta,
  type SocialQueueItem,
} from "@/lib/services/socials/socials-types";

/**
 * Socials store — vault-primary definitions + local hot overlay, mirroring the
 * companies-store storage model:
 *
 * - ACCOUNT DEFINITIONS (handle, method, soul ref, awake hours, context
 *   sources, posting mode + opt-in trail) live in the Syncthing-replicated
 *   shared vault at Operations/Socials/socials.json so every fleet machine
 *   sees the same accounts.
 * - QUEUE ITEMS (tick-level churn) live per machine in
 *   ~/.hivemindos/socials-runtime.json and never touch sync.
 * - With no vault available, definitions fall back to
 *   ~/.hivemindos/socials.json.
 *
 * Policy invariant enforced here (and re-checked by the queue engine at fire
 * time): postingMode "auto" is unwritable without an autoOptIn trail record.
 */

export const SOCIALS_LOCAL_PATH = path.join(homedir(), ".hivemindos", "socials.json");
export const SOCIALS_RUNTIME_PATH = path.join(homedir(), ".hivemindos", "socials-runtime.json");
const VAULT_SOCIALS_FILE = path.join("Operations", "Socials", "socials.json");

type SocialsStorage = { source: "obsidian" | "local"; file: string };

function resolveSocialsStorage(): SocialsStorage {
  const configured = DEFAULT_SHARED_VAULT.vaultPath?.trim();
  if (configured) {
    const root = resolveObsidianVaultPath(configured);
    try {
      if (statSync(root).isDirectory()) return { source: "obsidian", file: path.join(root, VAULT_SOCIALS_FILE) };
    } catch {
      // Vault unavailable — fall back to the local file.
    }
  }
  return { source: "local", file: SOCIALS_LOCAL_PATH };
}

type SocialsRuntimeOverlay = {
  version: 6;
  queue: SocialQueueItem[];
  metricSnapshots: SocialMetricSnapshot[];
  readUsage: SocialReadUsage[];
  drafting: Record<string, SocialDraftingRuntime>;
  engine: SocialQueueEngineMeta;
  /** Tick heartbeat, surfaced in the UI as queue liveness ("last tick at"). */
  lastTickAt?: string;
  lastPostedAt?: string;
  lastError?: string;
};

/** Thrown when a present socials file is unparseable — fail closed, never overwrite. */
export class SocialsFileCorruptError extends Error {
  readonly file: string;
  readonly reason?: unknown;
  constructor(file: string, reason?: unknown) {
    super(
      `[socials-store] refusing to read a corrupt socials file at ${file}. ` +
        `Nothing was wiped or overwritten. Restore from a sibling ${path.basename(file)}.bak.N backup ` +
        `or fix the JSON, then retry.`,
    );
    this.name = "SocialsFileCorruptError";
    this.file = file;
    this.reason = reason;
  }
}

const DEFINITIONS_BACKUP_COUNT = 5;
const RUNTIME_BACKUP_COUNT = 3;

export const DEFAULT_SOCIAL_AWAKE_HOURS: SocialAwakeHours = {
  enabled: false,
  start: "09:00",
  end: "22:00",
  timezone: "America/New_York",
  days: [1, 2, 3, 4, 5, 6, 0],
};

export const DEFAULT_MAX_DAILY_READ_OPS = 20;

export function defaultSocialDraftingPolicy(platform: SocialPlatform, now = new Date()): SocialDraftingPolicy {
  const defaults = socialPlatformRow(platform).drafting;
  return {
    enabled: defaults.defaultEnabled,
    cadenceHours: defaults.defaultCadenceHours,
    draftsPerRun: defaults.defaultDraftsPerRun,
    engagementEnabled: defaults.engagement.defaultEnabled,
    replyDraftsPerRun: defaults.engagement.defaultReplyDraftsPerRun,
    quoteDraftsPerRun: defaults.engagement.defaultQuoteDraftsPerRun,
    engagementLookbackHours: defaults.engagement.defaultLookbackHours,
    updatedAt: now.toISOString(),
    updatedBy: "system",
  };
}

function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

function normalizeEngagementTarget(raw: unknown): SocialEngagementTarget | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const metrics = record.metrics && typeof record.metrics === "object" && !Array.isArray(record.metrics)
    ? record.metrics as Record<string, unknown>
    : null;
  const nonNegativeMetric = (key: string, optional = false): number | undefined | null => {
    const value = metrics?.[key];
    if (value === undefined && optional) return undefined;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const likes = nonNegativeMetric("likes");
  const reposts = nonNegativeMetric("reposts");
  const replies = nonNegativeMetric("replies");
  const quotes = nonNegativeMetric("quotes");
  const views = nonNegativeMetric("views", true);
  if (record.platform !== "x"
    || typeof record.externalId !== "string" || !/^\d+$/.test(record.externalId)
    || typeof record.authorHandle !== "string" || !/^[A-Za-z0-9_]{1,15}$/.test(record.authorHandle)
    || typeof record.text !== "string" || !record.text.trim()
    || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))
    || typeof record.discoveredAt !== "string" || !Number.isFinite(Date.parse(record.discoveredAt))
    || (record.source !== "timeline" && record.source !== "search")
    || !metrics || likes === null || reposts === null || replies === null || quotes === null || views === null) {
    return null;
  }
  const expectedUrl = `https://x.com/${record.authorHandle}/status/${record.externalId}`;
  if (record.url !== expectedUrl) return null;
  if (record.authorName !== undefined && typeof record.authorName !== "string") return null;
  if (record.authorVerified !== undefined && typeof record.authorVerified !== "boolean") return null;
  if (record.sourceQuery !== undefined && typeof record.sourceQuery !== "string") return null;
  const authorAvatarUrl = normalizeXProfileImageUrl(record.authorAvatarUrl);
  return {
    platform: "x",
    externalId: record.externalId,
    url: expectedUrl,
    authorHandle: record.authorHandle,
    ...(typeof record.authorName === "string" && record.authorName.trim() ? { authorName: record.authorName.trim() } : {}),
    ...(typeof record.authorVerified === "boolean" ? { authorVerified: record.authorVerified } : {}),
    ...(authorAvatarUrl ? { authorAvatarUrl } : {}),
    text: record.text.trim(),
    createdAt: record.createdAt,
    discoveredAt: record.discoveredAt,
    source: record.source,
    ...(typeof record.sourceQuery === "string" && record.sourceQuery.trim() ? { sourceQuery: record.sourceQuery.trim() } : {}),
    metrics: { likes: likes!, reposts: reposts!, replies: replies!, quotes: quotes!, ...(views !== undefined ? { views } : {}) },
  };
}

function normalizeQueueItemRecord(raw: unknown): SocialQueueItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const accountId = typeof record.accountId === "string" ? record.accountId.trim() : "";
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const state = typeof record.state === "string" && (SOCIAL_QUEUE_ITEM_STATES as readonly string[]).includes(record.state)
    ? record.state as SocialQueueItem["state"]
    : null;
  const origin = record.origin === "human" || record.origin === "agent" ? record.origin : null;
  const createdAt = typeof record.createdAt === "string" && Number.isFinite(Date.parse(record.createdAt)) ? record.createdAt : "";
  if (!id || !accountId || !text || !state || !origin || !createdAt || !isSocialPlatform(record.platform) || typeof record.automated !== "boolean") {
    return null;
  }
  const stateHistory = Array.isArray(record.stateHistory)
    ? record.stateHistory.filter((entry): entry is SocialQueueItem["stateHistory"][number] => {
        if (!entry || typeof entry !== "object") return false;
        const candidate = entry as Record<string, unknown>;
        return typeof candidate.state === "string"
          && (SOCIAL_QUEUE_ITEM_STATES as readonly string[]).includes(candidate.state)
          && typeof candidate.at === "string"
          && Number.isFinite(Date.parse(candidate.at))
          && (candidate.by === "human" || candidate.by === "agent" || candidate.by === "tick");
      })
    : [];
  if (!stateHistory.length || stateHistory.length !== (record.stateHistory as unknown[])?.length) return null;

  const rawApproval = record.approval;
  const approval = rawApproval && typeof rawApproval === "object"
    ? (() => {
        const candidate = rawApproval as Record<string, unknown>;
        if (typeof candidate.at !== "string" || !Number.isFinite(Date.parse(candidate.at))) return undefined;
        if (candidate.by === "human") return { at: candidate.at, by: "human" as const };
        if (candidate.by === "auto-mode" && typeof candidate.optInAt === "string" && Number.isFinite(Date.parse(candidate.optInAt))) {
          return { at: candidate.at, by: "auto-mode" as const, optInAt: candidate.optInAt };
        }
        return undefined;
      })()
    : undefined;
  if (rawApproval !== undefined && !approval) return null;

  const rawDelivery = record.delivery;
  const delivery = rawDelivery && typeof rawDelivery === "object"
    ? (() => {
        const candidate = rawDelivery as Record<string, unknown>;
        if (typeof candidate.idempotencyKey !== "string" || !candidate.idempotencyKey.trim()) return undefined;
        if (!Number.isInteger(candidate.attempt) || Number(candidate.attempt) < 1) return undefined;
        if (typeof candidate.startedAt !== "string" || !Number.isFinite(Date.parse(candidate.startedAt))) return undefined;
        return { idempotencyKey: candidate.idempotencyKey, attempt: Number(candidate.attempt), startedAt: candidate.startedAt };
      })()
    : undefined;
  if (rawDelivery !== undefined && !delivery) return null;
  if (state === "posting" && !delivery) return null;

  const rawFailure = record.failure;
  const failure = rawFailure && typeof rawFailure === "object"
    ? (() => {
        const candidate = rawFailure as Record<string, unknown>;
        if (typeof candidate.at !== "string" || !Number.isFinite(Date.parse(candidate.at))) return undefined;
        if (typeof candidate.error !== "string" || !candidate.error.trim()) return undefined;
        if (!Number.isInteger(candidate.attempts) || Number(candidate.attempts) < 1) return undefined;
        if (candidate.kind !== undefined && candidate.kind !== "definite" && candidate.kind !== "ambiguous") return undefined;
        if (candidate.retryable !== undefined && typeof candidate.retryable !== "boolean") return undefined;
        return {
          at: candidate.at,
          error: candidate.error,
          attempts: Number(candidate.attempts),
          ...(candidate.kind ? { kind: candidate.kind } : {}),
          ...(typeof candidate.retryable === "boolean" ? { retryable: candidate.retryable } : {}),
        } as SocialQueueItem["failure"];
      })()
    : undefined;
  if (rawFailure !== undefined && !failure) return null;
  if (state === "failed" && !failure) return null;

  const rawGeneration = record.generation;
  const generation = rawGeneration && typeof rawGeneration === "object"
    ? (() => {
        const candidate = rawGeneration as Record<string, unknown>;
        if (typeof candidate.generatedAt !== "string" || !Number.isFinite(Date.parse(candidate.generatedAt))) return undefined;
        if (typeof candidate.model !== "string" || !candidate.model.trim()) return undefined;
        if (!Array.isArray(candidate.contextSourceIds) || candidate.contextSourceIds.some((id) => typeof id !== "string" || !id.trim())) return undefined;
        const kind: SocialGeneratedDraftKind = candidate.kind === undefined
          ? "post"
          : candidate.kind as SocialGeneratedDraftKind;
        if (kind !== "post" && kind !== "reply" && kind !== "quote") return undefined;
        if (candidate.rationale !== undefined && typeof candidate.rationale !== "string") return undefined;
        if (candidate.relevanceScore !== undefined
          && (typeof candidate.relevanceScore !== "number" || !Number.isFinite(candidate.relevanceScore) || candidate.relevanceScore < 0 || candidate.relevanceScore > 100)) return undefined;
        const target = candidate.target === undefined ? undefined : normalizeEngagementTarget(candidate.target);
        if (candidate.target !== undefined && !target) return undefined;
        if (kind !== "post" && !target) return undefined;
        return {
          generatedAt: candidate.generatedAt,
          model: candidate.model.trim(),
          contextSourceIds: candidate.contextSourceIds.map((id) => String(id).trim()),
          kind,
          ...(typeof candidate.rationale === "string" && candidate.rationale.trim() ? { rationale: candidate.rationale.trim() } : {}),
          ...(typeof candidate.relevanceScore === "number" ? { relevanceScore: candidate.relevanceScore } : {}),
          ...(target ? { target } : {}),
        };
      })()
    : undefined;
  if (rawGeneration !== undefined && !generation) return null;
  if (generation?.kind === "reply" && record.replyTo !== generation.target?.externalId) return null;
  if (generation?.kind === "quote" && record.quoteOf !== generation.target?.externalId) return null;

  const item = record as unknown as SocialQueueItem;
  return {
    ...item,
    id,
    accountId,
    platform: record.platform,
    state,
    text,
    origin,
    automated: record.automated,
    stateHistory,
    createdAt,
    ...(approval ? { approval } : { approval: undefined }),
    ...(delivery ? { delivery } : { delivery: undefined }),
    ...(failure ? { failure } : { failure: undefined }),
    ...(generation ? { generation } : { generation: undefined }),
    ...(typeof record.title === "string" && record.title.trim() ? { title: record.title.trim() } : { title: undefined }),
    ...(typeof record.subreddit === "string" && record.subreddit.trim() ? { subreddit: record.subreddit.trim() } : { subreddit: undefined }),
    ...(typeof record.replyTo === "string" && record.replyTo.trim() ? { replyTo: record.replyTo.trim() } : { replyTo: undefined }),
    ...(typeof record.quoteOf === "string" && record.quoteOf.trim() ? { quoteOf: record.quoteOf.trim() } : { quoteOf: undefined }),
  };
}

function normalizeDraftingRuntimeRecord(raw: unknown): SocialDraftingRuntime | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const optionalInstant = (key: string): string | undefined | null => {
    const value = record[key];
    if (value === undefined) return undefined;
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
  };
  const lastAttemptAt = optionalInstant("lastAttemptAt");
  const lastSuccessAt = optionalInstant("lastSuccessAt");
  const nextRunAt = optionalInstant("nextRunAt");
  const inFlightSince = optionalInstant("inFlightSince");
  const lastDiscoveryAt = optionalInstant("lastDiscoveryAt");
  const lastPostGeneratedAt = optionalInstant("lastPostGeneratedAt");
  const lastEngagementGeneratedAt = optionalInstant("lastEngagementGeneratedAt");
  if (lastAttemptAt === null || lastSuccessAt === null || nextRunAt === null || inFlightSince === null || lastDiscoveryAt === null
    || lastPostGeneratedAt === null || lastEngagementGeneratedAt === null) return null;
  if (!Number.isInteger(record.totalGenerated) || Number(record.totalGenerated) < 0) return null;
  if (!Number.isInteger(record.consecutiveFailures) || Number(record.consecutiveFailures) < 0) return null;
  if (record.lastGeneratedCount !== undefined && (!Number.isInteger(record.lastGeneratedCount) || Number(record.lastGeneratedCount) < 0)) return null;
  for (const key of ["lastPostGeneratedCount", "lastReplyGeneratedCount", "lastQuoteGeneratedCount", "lastDiscoveredCount"] as const) {
    if (record[key] !== undefined && (!Number.isInteger(record[key]) || Number(record[key]) < 0)) return null;
  }
  if (record.lastError !== undefined && typeof record.lastError !== "string") return null;
  if (record.lastEngagementError !== undefined && typeof record.lastEngagementError !== "string") return null;
  if (record.lastModel !== undefined && typeof record.lastModel !== "string") return null;
  if (record.lastDiscoveryBackend !== undefined && record.lastDiscoveryBackend !== "agent-reach-twitter-cli") return null;
  return {
    ...(lastAttemptAt ? { lastAttemptAt } : {}),
    ...(lastSuccessAt ? { lastSuccessAt } : {}),
    ...(nextRunAt ? { nextRunAt } : {}),
    ...(inFlightSince ? { inFlightSince } : {}),
    ...(lastDiscoveryAt ? { lastDiscoveryAt } : {}),
    ...(lastPostGeneratedAt ? { lastPostGeneratedAt } : {}),
    ...(lastEngagementGeneratedAt ? { lastEngagementGeneratedAt } : {}),
    ...(typeof record.lastError === "string" && record.lastError.trim() ? { lastError: record.lastError.trim() } : {}),
    ...(typeof record.lastModel === "string" && record.lastModel.trim() ? { lastModel: record.lastModel.trim() } : {}),
    ...(typeof record.lastGeneratedCount === "number" ? { lastGeneratedCount: record.lastGeneratedCount } : {}),
    ...(typeof record.lastPostGeneratedCount === "number" ? { lastPostGeneratedCount: record.lastPostGeneratedCount } : {}),
    ...(typeof record.lastReplyGeneratedCount === "number" ? { lastReplyGeneratedCount: record.lastReplyGeneratedCount } : {}),
    ...(typeof record.lastQuoteGeneratedCount === "number" ? { lastQuoteGeneratedCount: record.lastQuoteGeneratedCount } : {}),
    ...(record.lastDiscoveryBackend === "agent-reach-twitter-cli" ? { lastDiscoveryBackend: record.lastDiscoveryBackend } : {}),
    ...(typeof record.lastDiscoveredCount === "number" ? { lastDiscoveredCount: record.lastDiscoveredCount } : {}),
    ...(typeof record.lastEngagementError === "string" && record.lastEngagementError.trim() ? { lastEngagementError: record.lastEngagementError.trim() } : {}),
    totalGenerated: Number(record.totalGenerated),
    consecutiveFailures: Number(record.consecutiveFailures),
  };
}

function recoverDraftKindReceipts(
  runtime: SocialDraftingRuntime,
  queue: SocialQueueItem[],
  accountId: string,
): SocialDraftingRuntime {
  const generated = queue
    .filter((item) => item.accountId === accountId && item.generation)
    .sort((left, right) => Date.parse(right.generation!.generatedAt) - Date.parse(left.generation!.generatedAt));
  const latestPostAt = generated.find((item) => item.generation?.kind === "post")?.generation?.generatedAt;
  const latestEngagementAt = generated.find((item) => item.generation?.kind === "reply" || item.generation?.kind === "quote")?.generation?.generatedAt;
  const postPack = latestPostAt ? generated.filter((item) => item.generation?.generatedAt === latestPostAt) : [];
  const engagementPack = latestEngagementAt ? generated.filter((item) => item.generation?.generatedAt === latestEngagementAt) : [];
  return {
    ...runtime,
    ...(!runtime.lastPostGeneratedAt && latestPostAt
      ? {
          lastPostGeneratedAt: latestPostAt,
          lastPostGeneratedCount: postPack.filter((item) => item.generation?.kind === "post").length,
        }
      : {}),
    ...(!runtime.lastEngagementGeneratedAt && latestEngagementAt
      ? {
          lastEngagementGeneratedAt: latestEngagementAt,
          lastReplyGeneratedCount: engagementPack.filter((item) => item.generation?.kind === "reply").length,
          lastQuoteGeneratedCount: engagementPack.filter((item) => item.generation?.kind === "quote").length,
          lastDiscoveryAt: runtime.lastDiscoveryAt ?? latestEngagementAt,
          lastDiscoveryBackend: runtime.lastDiscoveryBackend ?? "agent-reach-twitter-cli" as const,
          lastDiscoveredCount: runtime.lastDiscoveredCount
            ?? new Set(engagementPack.flatMap((item) => item.generation?.target?.externalId ?? [])).size,
        }
      : {}),
  };
}

function normalizeMetricSnapshotRecord(raw: unknown): SocialMetricSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.at !== "string" || !Number.isFinite(Date.parse(record.at)) || typeof record.accountId !== "string" || !record.accountId.trim()) return null;
  if (!record.metrics || typeof record.metrics !== "object" || Array.isArray(record.metrics)) return null;
  const metrics = Object.fromEntries(Object.entries(record.metrics).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
  if (Object.keys(metrics).length !== Object.keys(record.metrics).length) return null;
  return {
    at: record.at,
    accountId: record.accountId.trim(),
    ...(typeof record.externalId === "string" && record.externalId.trim() ? { externalId: record.externalId.trim() } : {}),
    metrics,
  };
}

function normalizeReadUsageRecord(raw: unknown): SocialReadUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.at !== "string" || !Number.isFinite(Date.parse(record.at))) return null;
  if (typeof record.accountId !== "string" || !record.accountId.trim()) return null;
  if (!Number.isInteger(record.operations) || Number(record.operations) < 1) return null;
  if (record.source !== "analytics-refresh") return null;
  return { at: record.at, accountId: record.accountId.trim(), operations: Number(record.operations), source: record.source };
}

function localDateKey(at: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    throw new Error(`Invalid social account timezone: ${timezone}`);
  }
}

/**
 * Stable identity + platform or the record is dropped; auto mode without an
 * opt-in trail degrades to manual (never silently auto). One malformed record
 * degrades to a skipped account, not a store-wide throw.
 */
function normalizeAccountRecord(raw: unknown): SocialAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id || !isSocialPlatform(record.platform)) return null;
  const account = { ...(record as unknown as SocialAccount), id };
  if (account.postingMode !== "auto" && account.postingMode !== "manual") account.postingMode = "manual";
  if (account.postingMode === "auto" && !account.autoOptIn) account.postingMode = "manual";
  if (!account.awakeHours || typeof account.awakeHours !== "object") account.awakeHours = { ...DEFAULT_SOCIAL_AWAKE_HOURS };
  if (!Array.isArray(account.contextSources)) account.contextSources = [];
  if (typeof account.maxDailyReadOps !== "number" || !Number.isFinite(account.maxDailyReadOps) || account.maxDailyReadOps < 0) {
    account.maxDailyReadOps = DEFAULT_MAX_DAILY_READ_OPS;
  }
  const createdAt = typeof account.createdAt === "string" && Number.isFinite(Date.parse(account.createdAt))
    ? new Date(account.createdAt)
    : new Date();
  const defaults = defaultSocialDraftingPolicy(account.platform, createdAt);
  const engagementSupported = socialPlatformRow(account.platform).drafting.engagement.supported;
  const drafting = record.drafting && typeof record.drafting === "object" && !Array.isArray(record.drafting)
    ? record.drafting as Partial<SocialDraftingPolicy>
    : undefined;
  const validDrafting = drafting
    && typeof drafting.enabled === "boolean"
    && (SOCIAL_DRAFT_CADENCE_HOURS as readonly number[]).includes(Number(drafting.cadenceHours))
    && (SOCIAL_DRAFTS_PER_RUN as readonly number[]).includes(Number(drafting.draftsPerRun))
    && typeof drafting.updatedAt === "string"
    && Number.isFinite(Date.parse(drafting.updatedAt))
    && (drafting.updatedBy === "human" || drafting.updatedBy === "system");
  const engagementFieldsMissing = drafting?.engagementEnabled === undefined
    && drafting?.replyDraftsPerRun === undefined
    && drafting?.quoteDraftsPerRun === undefined
    && drafting?.engagementLookbackHours === undefined;
  const validEngagement = drafting
    && typeof drafting.engagementEnabled === "boolean"
    && (SOCIAL_ENGAGEMENT_DRAFTS_PER_RUN as readonly number[]).includes(Number(drafting.replyDraftsPerRun))
    && (SOCIAL_QUOTE_DRAFTS_PER_RUN as readonly number[]).includes(Number(drafting.quoteDraftsPerRun))
    && (SOCIAL_ENGAGEMENT_LOOKBACK_HOURS as readonly number[]).includes(Number(drafting.engagementLookbackHours))
    && (engagementSupported || (!drafting.engagementEnabled && drafting.replyDraftsPerRun === 0 && drafting.quoteDraftsPerRun === 0));
  account.drafting = validDrafting
    ? {
        ...defaults,
        ...drafting,
        ...(engagementFieldsMissing
          ? {
              engagementEnabled: defaults.engagementEnabled,
              replyDraftsPerRun: defaults.replyDraftsPerRun,
              quoteDraftsPerRun: defaults.quoteDraftsPerRun,
              engagementLookbackHours: defaults.engagementLookbackHours,
            }
          : validEngagement
            ? {}
            : {
                engagementEnabled: false,
                replyDraftsPerRun: defaults.replyDraftsPerRun,
                quoteDraftsPerRun: defaults.quoteDraftsPerRun,
                engagementLookbackHours: defaults.engagementLookbackHours,
              }),
      } as SocialDraftingPolicy
    : record.drafting === undefined
      ? defaults
      : { ...defaults, enabled: false };
  return account;
}

type CorruptFilePolicy = "throw" | "empty";

async function readAccountsFile(file: string, onCorrupt: CorruptFilePolicy = "throw"): Promise<SocialAccount[]> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    if (onCorrupt === "throw") throw new SocialsFileCorruptError(file, error);
    return [];
  }
  const trimmed = text.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    if (onCorrupt === "throw") {
      console.error(`[socials-store] CORRUPT socials file at ${file} — refusing to overwrite (restore from .bak.N):`, error);
      throw new SocialsFileCorruptError(file, error);
    }
    return [];
  }
  if (!Array.isArray(parsed)) {
    if (onCorrupt === "throw") throw new SocialsFileCorruptError(file);
    return [];
  }
  const out: SocialAccount[] = [];
  let dropped = 0;
  for (const raw of parsed) {
    const record = normalizeAccountRecord(raw);
    if (record) out.push(record);
    else dropped++;
  }
  if (dropped > 0) {
    console.error(`[socials-store] dropped ${dropped} malformed social account record(s) from ${file}`);
  }
  return out;
}

async function writeFileAtomic(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, contents, { mode: 0o600 });
  await fs.rename(tmp, file);
}

async function rotateBackups(file: string, count: number): Promise<void> {
  try {
    await fs.access(file);
  } catch {
    return;
  }
  for (let i = count - 1; i >= 0; i--) {
    const from = i === 0 ? file : `${file}.bak.${i - 1}`;
    const to = `${file}.bak.${i}`;
    try {
      await fs.copyFile(from, to);
    } catch {
      // missing intermediate backup is fine
    }
  }
}

async function writeDurableDefinitions(file: string, contents: string): Promise<void> {
  await rotateBackups(file, DEFINITIONS_BACKUP_COUNT);
  await writeFileAtomic(file, contents);
}

/** Serializes read-modify-write cycles within the process (companies-store pattern). */
let socialsWriteQueue: Promise<unknown> = Promise.resolve();
function enqueueSocialsWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = socialsWriteQueue.then(fn, fn);
  socialsWriteQueue = next.catch(() => undefined);
  return next;
}

async function readRuntimeOverlay(): Promise<SocialsRuntimeOverlay> {
  const defaultEngine = (): SocialQueueEngineMeta => ({
    settings: { enabled: true, updatedAt: new Date().toISOString(), updatedBy: "system" },
  });
  try {
    const text = await fs.readFile(SOCIALS_RUNTIME_PATH, "utf8");
    let parsed: Partial<SocialsRuntimeOverlay> & { version?: number };
    try {
      parsed = JSON.parse(text) as Partial<SocialsRuntimeOverlay> & { version?: number };
    } catch (error) {
      throw new SocialsFileCorruptError(SOCIALS_RUNTIME_PATH, error);
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.queue)) throw new SocialsFileCorruptError(SOCIALS_RUNTIME_PATH);
    const queue = parsed.queue.map(normalizeQueueItemRecord);
    if (queue.some((item) => !item)) throw new SocialsFileCorruptError(SOCIALS_RUNTIME_PATH);
    const rawSnapshots = Array.isArray(parsed.metricSnapshots) ? parsed.metricSnapshots : [];
    const metricSnapshots = rawSnapshots.map(normalizeMetricSnapshotRecord);
    if (metricSnapshots.some((snapshot) => !snapshot)) throw new SocialsFileCorruptError(SOCIALS_RUNTIME_PATH);
    const rawReadUsage = Array.isArray(parsed.readUsage) ? parsed.readUsage : [];
    const readUsage = rawReadUsage.map(normalizeReadUsageRecord);
    if (readUsage.some((usage) => !usage)) throw new SocialsFileCorruptError(SOCIALS_RUNTIME_PATH);
    const rawDrafting = parsed.drafting === undefined ? {} : parsed.drafting;
    if (!rawDrafting || typeof rawDrafting !== "object" || Array.isArray(rawDrafting)) throw new SocialsFileCorruptError(SOCIALS_RUNTIME_PATH);
    const draftingEntries = Object.entries(rawDrafting).map(([accountId, value]) => [accountId, normalizeDraftingRuntimeRecord(value)] as const);
    if (draftingEntries.some(([accountId, value]) => !accountId.trim() || !value)) throw new SocialsFileCorruptError(SOCIALS_RUNTIME_PATH);
    const legacyLastTickAt = typeof parsed.lastTickAt === "string" ? parsed.lastTickAt : undefined;
    if (parsed.engine?.settings) {
      const settings = parsed.engine.settings as Partial<SocialQueueEngineMeta["settings"]>;
      if (typeof settings.enabled !== "boolean"
        || typeof settings.updatedAt !== "string"
        || !Number.isFinite(Date.parse(settings.updatedAt))
        || (settings.updatedBy !== "human" && settings.updatedBy !== "system")) {
        throw new SocialsFileCorruptError(SOCIALS_RUNTIME_PATH);
      }
    }
    const engine = parsed.engine?.settings
      ? parsed.engine
      : { ...defaultEngine(), ...(legacyLastTickAt ? { lastTickAt: legacyLastTickAt } : {}) };
    const normalizedQueue = queue as SocialQueueItem[];
    const drafting = Object.fromEntries(draftingEntries.map(([accountId, runtime]) => [
      accountId,
      recoverDraftKindReceipts(runtime!, normalizedQueue, accountId),
    ])) as Record<string, SocialDraftingRuntime>;
    return {
      version: 6,
      queue: normalizedQueue,
      metricSnapshots: metricSnapshots as SocialMetricSnapshot[],
      readUsage: readUsage as SocialReadUsage[],
      drafting,
      engine,
      ...(legacyLastTickAt ? { lastTickAt: legacyLastTickAt } : {}),
      ...(typeof parsed.lastPostedAt === "string" ? { lastPostedAt: parsed.lastPostedAt } : {}),
      ...(typeof parsed.lastError === "string" ? { lastError: parsed.lastError } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  return { version: 6, queue: [], metricSnapshots: [], readUsage: [], drafting: {}, engine: defaultEngine() };
}

async function writeRuntimeOverlay(overlay: SocialsRuntimeOverlay): Promise<void> {
  await rotateBackups(SOCIALS_RUNTIME_PATH, RUNTIME_BACKUP_COUNT);
  await writeFileAtomic(SOCIALS_RUNTIME_PATH, JSON.stringify(overlay, null, 2));
}

// ---------------------------------------------------------------------------
// Accounts (vault-replicated definitions)
// ---------------------------------------------------------------------------

export async function readSocialAccounts(): Promise<SocialAccount[]> {
  const storage = resolveSocialsStorage();
  const records = await readAccountsFile(storage.file);
  return records.sort((a, b) => a.platform.localeCompare(b.platform) || a.handle.localeCompare(b.handle));
}

export async function getSocialAccount(id: string): Promise<SocialAccount | null> {
  const accounts = await readSocialAccounts();
  return accounts.find((account) => account.id === id) ?? null;
}

export type CreateSocialAccountInput = {
  platform: SocialPlatform;
  handle: string;
  method: SocialAccount["method"];
  displayName?: string;
  soulPath?: string;
  binding?: Record<string, string>;
  awakeHours?: Partial<SocialAwakeHours>;
};

export function socialAccountId(platform: SocialPlatform, handle: string): string {
  const slug = handle.replace(/^@/, "").trim().toLowerCase();
  return `${platform}:${slug}`;
}

function newSocialAccountDefinition(input: CreateSocialAccountInput, now: string): SocialAccount {
  const awakeHours = { ...DEFAULT_SOCIAL_AWAKE_HOURS, ...(input.awakeHours ?? {}) };
  if (!validAwakeHoursConfiguration(awakeHours)) {
    throw new Error("Awake hours need valid HH:MM start/end times, an IANA timezone, and one or more unique weekdays.");
  }
  return {
    id: socialAccountId(input.platform, input.handle),
    platform: input.platform,
    handle: input.handle.replace(/^@/, "").trim(),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    method: input.method,
    status: "disconnected",
    ...(input.soulPath ? { soulPath: input.soulPath } : {}),
    postingMode: "manual",
    drafting: defaultSocialDraftingPolicy(input.platform, new Date(now)),
    awakeHours,
    contextSources: [],
    maxDailyReadOps: DEFAULT_MAX_DAILY_READ_OPS,
    ...(input.binding ? { binding: { ...input.binding } } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export async function createSocialAccount(input: CreateSocialAccountInput): Promise<SocialAccount> {
  const account = newSocialAccountDefinition(input, new Date().toISOString());
  await mutateSocialAccounts((accounts) => {
    if (accounts.some((existing) => existing.id === account.id)) {
      throw new Error(`Social account already exists: ${account.id}`);
    }
    return [...accounts, account];
  });
  return account;
}

/**
 * Idempotent account connection used by the Connect modal. Reconnecting the
 * same platform/handle updates only its connection rail and optional identity
 * fields while preserving queue policy, context, awake hours, and opt-in state.
 */
export async function connectSocialAccount(input: CreateSocialAccountInput): Promise<SocialAccount> {
  const id = socialAccountId(input.platform, input.handle);
  let connected: SocialAccount | null = null;
  await mutateSocialAccounts((accounts) => {
    const existing = accounts.find((account) => account.id === id);
    if (!existing) {
      connected = newSocialAccountDefinition(input, new Date().toISOString());
      return [...accounts, connected];
    }
    connected = {
      ...existing,
      handle: input.handle.replace(/^@/, "").trim(),
      method: input.method,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.soulPath ? { soulPath: input.soulPath } : {}),
      ...(input.binding ? { binding: { ...(existing.binding ?? {}), ...input.binding } } : {}),
      updatedAt: new Date().toISOString(),
    };
    return accounts.map((account) => account.id === id ? connected! : account);
  });
  if (!connected) throw new Error(`Could not connect social account: ${id}`);
  return connected;
}

/**
 * Field-level mutator (companies-store mutateCompanyDefinition pattern): reads
 * the current definitions inside the serialized write queue, applies `mutate`,
 * and persists — so two concurrent updates can't clobber each other.
 */
export async function mutateSocialAccounts(
  mutate: (accounts: SocialAccount[]) => SocialAccount[] | Promise<SocialAccount[]>,
): Promise<SocialAccount[]> {
  return enqueueSocialsWrite(async () => {
    const storage = resolveSocialsStorage();
    const current = await readAccountsFile(storage.file);
    const next = await mutate(current);
    await writeDurableDefinitions(storage.file, JSON.stringify(next, null, 2));
    return next;
  });
}

export async function updateSocialAccount(
  id: string,
  update: (account: SocialAccount) => SocialAccount,
): Promise<SocialAccount> {
  let updated: SocialAccount | null = null;
  await mutateSocialAccounts((accounts) =>
    accounts.map((account) => {
      if (account.id !== id) return account;
      updated = { ...update({ ...account }), id: account.id, updatedAt: new Date().toISOString() };
      // Policy: auto mode is unwritable without an explicit human opt-in trail.
      if (updated.postingMode === "auto" && !updated.autoOptIn) {
        throw new Error(`Refusing to set auto posting mode without an autoOptIn record (${id}).`);
      }
      return updated;
    }),
  );
  if (!updated) throw new Error(`Unknown social account: ${id}`);
  return updated;
}

export async function deleteSocialAccount(id: string): Promise<void> {
  await mutateSocialAccounts((accounts) => accounts.filter((account) => account.id !== id));
  // Drop this account's queue items and drafting runtime from the local overlay too.
  await enqueueSocialsWrite(async () => {
    const overlay = await readRuntimeOverlay();
    const queue = overlay.queue.filter((item) => item.accountId !== id);
    const drafting = { ...overlay.drafting };
    const hadDrafting = Object.hasOwn(drafting, id);
    if (hadDrafting) delete drafting[id];
    if (queue.length !== overlay.queue.length || hadDrafting) await writeRuntimeOverlay({ ...overlay, queue, drafting });
  });
}

export function newContextSource(input: Omit<SocialContextSource, "id" | "addedAt">): SocialContextSource {
  return { id: `src_${randomUUID()}`, addedAt: new Date().toISOString(), ...input };
}

/**
 * Posting-voice options: soul stacks in the shared vault (Skills/<slug>/ with
 * a SOUL.md, e.g. Skills/liam-x-soul). Accounts store the vault-relative path;
 * the soul itself is edited in the brain, never copied here.
 */
export async function listSocialSoulOptions(): Promise<Array<{ path: string; label: string }>> {
  const configured = DEFAULT_SHARED_VAULT.vaultPath?.trim();
  if (!configured) return [];
  const root = resolveObsidianVaultPath(configured);
  const skillsDir = path.join(root, "Skills");
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[]);
  const options: Array<{ path: string; label: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await fs.access(path.join(skillsDir, entry.name, "SOUL.md"));
      options.push({ path: `Skills/${entry.name}`, label: entry.name });
    } catch {
      // not a soul stack
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Queue (per-machine hot overlay). All mutations are serialized through this
// store so the worker, API, and dashboard cannot overwrite one another.
// ---------------------------------------------------------------------------

export async function readSocialQueue(): Promise<SocialQueueItem[]> {
  const overlay = await readRuntimeOverlay();
  return overlay.queue;
}

export async function readSocialQueueMeta(): Promise<SocialQueueEngineMeta> {
  const overlay = await readRuntimeOverlay();
  return {
    ...overlay.engine,
    ...(overlay.lastTickAt ? { lastTickAt: overlay.lastTickAt } : {}),
    ...(overlay.lastPostedAt ? { lastPostedAt: overlay.lastPostedAt } : {}),
    ...(overlay.lastError ? { lastError: overlay.lastError } : {}),
  };
}

export async function mutateSocialQueue(
  mutate: (queue: SocialQueueItem[]) => SocialQueueItem[] | Promise<SocialQueueItem[]>,
  options: { markTick?: boolean } = {},
): Promise<SocialQueueItem[]> {
  return enqueueSocialsWrite(async () => {
    const overlay = await readRuntimeOverlay();
    const queue = await mutate(overlay.queue);
    await writeRuntimeOverlay({
      ...overlay,
      queue,
      ...(options.markTick
        ? {
            lastTickAt: new Date().toISOString(),
            engine: { ...overlay.engine, lastTickAt: new Date().toISOString() },
          }
        : {}),
    });
    return queue;
  });
}

export async function updateSocialQueueEngineMeta(
  update: (meta: SocialQueueEngineMeta) => SocialQueueEngineMeta,
): Promise<SocialQueueEngineMeta> {
  return enqueueSocialsWrite(async () => {
    const overlay = await readRuntimeOverlay();
    const engine = update({
      ...overlay.engine,
      ...(overlay.lastTickAt ? { lastTickAt: overlay.lastTickAt } : {}),
      ...(overlay.lastPostedAt ? { lastPostedAt: overlay.lastPostedAt } : {}),
      ...(overlay.lastError ? { lastError: overlay.lastError } : {}),
    });
    await writeRuntimeOverlay({
      ...overlay,
      engine,
      lastTickAt: engine.lastTickAt,
      lastPostedAt: engine.lastPostedAt,
      lastError: engine.lastError,
    });
    return engine;
  });
}

export async function setSocialQueueEngineEnabled(enabled: boolean): Promise<SocialQueueEngineMeta> {
  return updateSocialQueueEngineMeta((meta) => ({
    ...meta,
    settings: { enabled, updatedAt: new Date().toISOString(), updatedBy: "human" },
  }));
}

const EMPTY_DRAFTING_RUNTIME: SocialDraftingRuntime = { totalGenerated: 0, consecutiveFailures: 0 };

export async function readSocialDraftingRuntime(accountId: string): Promise<SocialDraftingRuntime> {
  const runtime = (await readRuntimeOverlay()).drafting[accountId];
  return runtime ? { ...runtime } : { ...EMPTY_DRAFTING_RUNTIME };
}

export async function readAllSocialDraftingRuntime(): Promise<Record<string, SocialDraftingRuntime>> {
  const drafting = (await readRuntimeOverlay()).drafting;
  return Object.fromEntries(Object.entries(drafting).map(([accountId, runtime]) => [accountId, { ...runtime }]));
}

export async function mutateSocialDraftingRuntime(
  accountId: string,
  update: (runtime: SocialDraftingRuntime) => SocialDraftingRuntime,
): Promise<SocialDraftingRuntime> {
  return enqueueSocialsWrite(async () => {
    const overlay = await readRuntimeOverlay();
    const current = overlay.drafting[accountId] ?? EMPTY_DRAFTING_RUNTIME;
    const next = update({ ...current });
    await writeRuntimeOverlay({ ...overlay, drafting: { ...overlay.drafting, [accountId]: next } });
    return next;
  });
}

export async function readSocialMetricSnapshots(accountId?: string): Promise<SocialMetricSnapshot[]> {
  const snapshots = (await readRuntimeOverlay()).metricSnapshots;
  return accountId ? snapshots.filter((snapshot) => snapshot.accountId === accountId) : snapshots;
}

export async function appendSocialMetricSnapshots(snapshots: SocialMetricSnapshot[]): Promise<void> {
  if (!snapshots.length) return;
  await enqueueSocialsWrite(async () => {
    const overlay = await readRuntimeOverlay();
    const cutoff = Date.now() - 180 * 24 * 60 * 60_000;
    const retained = [...overlay.metricSnapshots, ...snapshots]
      .filter((snapshot) => Date.parse(snapshot.at) >= cutoff)
      .sort((left, right) => left.at.localeCompare(right.at))
      .slice(-10_000);
    await writeRuntimeOverlay({ ...overlay, metricSnapshots: retained });
  });
}

export async function readSocialReadBudget(
  accountId: string,
  limit: number,
  timezone: string,
  now = new Date(),
): Promise<{ limit: number; used: number; remaining: number }> {
  const day = localDateKey(now, timezone);
  const used = (await readRuntimeOverlay()).readUsage
    .filter((usage) => usage.accountId === accountId && localDateKey(new Date(usage.at), timezone) === day)
    .reduce((total, usage) => total + usage.operations, 0);
  return { limit, used, remaining: Math.max(0, limit - used) };
}

export async function reserveSocialReadOps(
  accountId: string,
  operations: number,
  limit: number,
  timezone: string,
  now = new Date(),
): Promise<{ limit: number; used: number; remaining: number }> {
  if (!Number.isInteger(operations) || operations < 1) throw new Error("Social read operations must be a positive integer.");
  if (!Number.isInteger(limit) || limit < 0) throw new Error("Social read budget must be a non-negative integer.");
  return enqueueSocialsWrite(async () => {
    const overlay = await readRuntimeOverlay();
    const day = localDateKey(now, timezone);
    const used = overlay.readUsage
      .filter((usage) => usage.accountId === accountId && localDateKey(new Date(usage.at), timezone) === day)
      .reduce((total, usage) => total + usage.operations, 0);
    if (used + operations > limit) {
      throw new Error(`Managed social read budget exhausted (${used}/${limit} operations used today). Increase the account budget or wait for the next local day.`);
    }
    const cutoff = now.getTime() - 35 * 24 * 60 * 60_000;
    const readUsage = [...overlay.readUsage, { at: now.toISOString(), accountId, operations, source: "analytics-refresh" as const }]
      .filter((usage) => Date.parse(usage.at) >= cutoff)
      .slice(-10_000);
    await writeRuntimeOverlay({ ...overlay, readUsage });
    const nextUsed = used + operations;
    return { limit, used: nextUsed, remaining: Math.max(0, limit - nextUsed) };
  });
}
