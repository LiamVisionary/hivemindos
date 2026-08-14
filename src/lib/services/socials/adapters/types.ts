import type {
  SocialAccount,
  SocialCapability,
  SocialCapabilitySupport,
  SocialPlatform,
  SocialQueueItem,
} from "@/lib/services/socials/socials-types";

/**
 * Per-platform adapter contract. The Socials UI and queue engine are
 * platform-agnostic; everything platform-specific lives behind this interface
 * (agent-mailboxes provider-registry pattern).
 *
 * `ctx.env` is a shared-hive-env snapshot the caller reads once per request;
 * `ctx.fetchImpl` exists so the hermetic suites can run every adapter without
 * network. Secrets never leave the server: adapters run server-side only.
 */
export type SocialAdapterContext = {
  env: Record<string, string>;
  fetchImpl?: typeof fetch;
  /** Hermetic override for the local Agent Reach X session command runner. */
  xAgentReachRun?: (args: string[]) => Promise<unknown>;
};

export type SocialConnectProbe = {
  ok: boolean;
  detail: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
};

export type SocialPostInput = {
  account: SocialAccount;
  text: string;
  title?: string;
  subreddit?: string;
  media?: SocialQueueItem["media"];
  replyTo?: string;
  quoteOf?: string;
  /** Stable queue-item key. Providers with native idempotency must forward it. */
  idempotencyKey: string;
};

export type SocialPostResult = { externalId: string; url?: string };

export class SocialPostError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly ambiguous: boolean;

  constructor(message: string, input: { status?: number; retryable?: boolean; ambiguous?: boolean } = {}) {
    super(message);
    this.name = "SocialPostError";
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.ambiguous = input.ambiguous ?? false;
  }
}

export async function socialPostResponseError(platform: SocialPlatform, response: Response): Promise<SocialPostError> {
  const body = await response.text().catch(() => "");
  const compact = body.replace(/\s+/g, " ").trim().slice(0, 500);
  const suffix = compact ? `: ${compact}` : "";
  return new SocialPostError(`${platform} rejected the post (HTTP ${response.status})${suffix}`, {
    status: response.status,
    retryable: response.status === 429,
    // A timeout/5xx response can arrive after the provider committed a write.
    // Adapters with native idempotency explicitly downgrade this to retryable.
    ambiguous: response.status === 408 || response.status === 425 || response.status >= 500,
  });
}

export type SocialPostMetrics = {
  externalId: string;
  at: string;
  metrics: Record<string, number>;
  /** Metric names the platform API does not expose — rendered as "unavailable", never zero. */
  unavailable?: string[];
};

export interface SocialPlatformAdapter {
  platform: SocialPlatform;
  connectStatus(account: SocialAccount, ctx: SocialAdapterContext): Promise<SocialConnectProbe>;
  post(input: SocialPostInput, ctx: SocialAdapterContext): Promise<SocialPostResult>;
  fetchPostMetrics(account: SocialAccount, externalIds: string[], ctx: SocialAdapterContext): Promise<SocialPostMetrics[]>;
  fetchAccountMetrics(account: SocialAccount, ctx: SocialAdapterContext): Promise<Record<string, number>>;
  capabilities(account: SocialAccount): Record<SocialCapability, SocialCapabilitySupport>;
}

/**
 * Resolve a credential for an account: the connect modal's per-variable env
 * picker can bind a differently-named shared env key to this account via a
 * non-secret `env:<CANONICAL_KEY>` binding entry; absent that, the matrix's
 * canonical key name is read directly.
 */
export function accountEnvValue(account: SocialAccount, ctx: SocialAdapterContext, canonicalKey: string): string {
  const override = (account.binding?.[`env:${canonicalKey}`] ?? "").trim();
  const key = override || canonicalKey;
  return (process.env[key] ?? ctx.env[key] ?? "").trim();
}

/** Shared helper: a fetch with a hard timeout, mirroring provider-connections' 6s probes. */
export async function probeFetch(
  ctx: SocialAdapterContext,
  url: string,
  init?: RequestInit,
  timeoutMs = 6000,
): Promise<Response> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
