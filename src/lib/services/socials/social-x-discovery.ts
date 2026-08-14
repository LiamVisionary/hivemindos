import "server-only";

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import path from "node:path";
import { promisify } from "node:util";

import { optionalEnv } from "@/lib/config/env";
import { readSharedAgentEnv } from "@/lib/services/integrations/shared-env";
import {
  socialXSessionBinding,
  validSocialXSessionEnvKey,
} from "@/lib/services/socials/social-x-session-binding";
import { normalizeXProfileImageUrl } from "@/lib/services/socials/social-profile-image";
import type {
  SocialAccount,
  SocialEngagementTarget,
  SocialQueueItem,
  SocialXDiscoveryStatus,
} from "@/lib/services/socials/socials-types";

const execFileAsync = promisify(execFile);
const TWITTER_TIMEOUT_MS = 45_000;
const TWITTER_MAX_BUFFER = 4 * 1024 * 1024;
const STATUS_CACHE_MS = 60_000;
const PROFILE_CACHE_MS = 15 * 60_000;
const MAX_PROFILE_CACHE_ENTRIES = 256;
const MAX_TARGET_HANDLES = 16;
const MAX_QUERIES = 4;
const MAX_CANDIDATES = 60;

export type SocialXDiscoveryRejected = {
  invalid: number;
  duplicate: number;
  self: number;
  stale: number;
  seen: number;
  retweet: number;
};

export type SocialXDiscoveryResult = {
  backend: "agent-reach-twitter-cli";
  authenticatedAs: string;
  candidates: SocialEngagementTarget[];
  queries: string[];
  targetHandles: string[];
  rejected: SocialXDiscoveryRejected;
};

export type TwitterCliRun = (args: string[]) => Promise<unknown>;
export type TwitterCliExecute = (
  command: string,
  args: string[],
  options: {
    timeout: number;
    maxBuffer: number;
    windowsHide: boolean;
    env?: NodeJS.ProcessEnv;
  },
) => Promise<{ stdout: string }>;

let statusCache: { expiresAt: number; value: SocialXDiscoveryStatus } | null = null;
const accountStatusCache = new Map<string, { expiresAt: number; value: SocialXDiscoveryStatus }>();
const publicProfileCache = new Map<string, { expiresAt: number; value: SocialXPublicProfile | null }>();

export type SocialXPublicProfile = {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
};

function cachePublicProfile(key: string, value: SocialXPublicProfile | null): void {
  const now = Date.now();
  for (const [cachedKey, cached] of publicProfileCache) {
    if (cached.expiresAt <= now) publicProfileCache.delete(cachedKey);
  }
  if (!publicProfileCache.has(key) && publicProfileCache.size >= MAX_PROFILE_CACHE_ENTRIES) {
    const oldestKey = publicProfileCache.keys().next().value;
    if (oldestKey) publicProfileCache.delete(oldestKey);
  }
  publicProfileCache.set(key, { expiresAt: now + PROFILE_CACHE_MS, value });
}

async function existingFile(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next portable location.
    }
  }
  return null;
}

async function resolveTwitterCommand(): Promise<string> {
  const configured = optionalEnv("HIVEMINDOS_TWITTER_CLI_PATH");
  if (configured) return configured;
  const binary = process.platform === "win32" ? "twitter.exe" : "twitter";
  const local = await existingFile([
    path.join(homedir(), ".local", "bin", binary),
    ...(process.platform === "win32" ? [path.join(homedir(), "AppData", "Roaming", "Python", "Scripts", binary)] : []),
  ]);
  return local ?? binary;
}

function structuredTwitterError(stdout: unknown): string {
  if (typeof stdout !== "string" || !stdout.trim()) return "";
  try {
    const parsed = JSON.parse(stdout) as { error?: { message?: unknown } };
    return typeof parsed.error?.message === "string"
      ? parsed.error.message.replace(/\s+/g, " ").trim().slice(0, 500)
      : "";
  } catch {
    return "";
  }
}

/** Execute the installed Agent Reach X CLI with argv isolation and JSON output. */
async function executeTwitterCli(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv | undefined,
  executeImpl: TwitterCliExecute,
): Promise<unknown> {
  try {
    const { stdout } = await executeImpl(command, args, {
      timeout: TWITTER_TIMEOUT_MS,
      maxBuffer: TWITTER_MAX_BUFFER,
      windowsHide: true,
      ...(env ? { env } : {}),
    });
    return JSON.parse(stdout);
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
    if (candidate.code === "ENOENT") {
      throw new Error("X engagement needs the audited twitter-cli backend. Enable X in Apps & Services → Agent Reach, then authenticate it.");
    }
    if (candidate.killed) throw new Error("The Agent Reach X operation timed out.");
    const detail = structuredTwitterError(candidate.stdout)
      || candidate.stderr?.replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error(detail || (error instanceof Error ? error.message : "twitter-cli failed."));
  }
}

const defaultTwitterCliExecute: TwitterCliExecute = (command, args, options) =>
  execFileAsync(command, args, options) as Promise<{ stdout: string }>;

/** Execute the machine-default Agent Reach X session. */
export async function runTwitterCli(args: string[]): Promise<unknown> {
  return executeTwitterCli(await resolveTwitterCommand(), args, undefined, defaultTwitterCliExecute);
}

function accountTwitterCliEnv(
  account: SocialAccount,
  sharedEnv: Record<string, string>,
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const session = socialXSessionBinding(account);
  const env = { ...baseEnv };
  if (session.mode === "machine-default") {
    if (!env.TWITTER_AUTH_TOKEN?.trim() && sharedEnv.TWITTER_AUTH_TOKEN?.trim()) {
      env.TWITTER_AUTH_TOKEN = sharedEnv.TWITTER_AUTH_TOKEN.trim();
    }
    if (!env.TWITTER_CT0?.trim() && sharedEnv.TWITTER_CT0?.trim()) {
      env.TWITTER_CT0 = sharedEnv.TWITTER_CT0.trim();
    }
    return env;
  }
  if (!validSocialXSessionEnvKey(session.authTokenEnvKey)) {
    throw new Error("This Socials account has an invalid TWITTER_AUTH_TOKEN env binding.");
  }
  if (!validSocialXSessionEnvKey(session.ct0EnvKey)) {
    throw new Error("This Socials account has an invalid TWITTER_CT0 env binding.");
  }
  const authToken = (baseEnv[session.authTokenEnvKey] ?? sharedEnv[session.authTokenEnvKey] ?? "").trim();
  const ct0 = (baseEnv[session.ct0EnvKey] ?? sharedEnv[session.ct0EnvKey] ?? "").trim();
  const missing = [
    ...(!authToken ? [session.authTokenEnvKey] : []),
    ...(!ct0 ? [session.ct0EnvKey] : []),
  ];
  if (missing.length) {
    throw new Error(`This Socials account's Agent Reach session is missing Shared Hive Env ${missing.join(" and ")}.`);
  }
  env.TWITTER_AUTH_TOKEN = authToken;
  env.TWITTER_CT0 = ct0;
  delete env.TWITTER_CHROME_PROFILE;
  return env;
}

/**
 * Resolve one immutable account-scoped twitter-cli runner. Shared-env values
 * are loaded once, then only the selected cookie pair is mapped onto the
 * canonical variables read by twitter-cli.
 */
export async function createAccountTwitterCliRun(
  account: SocialAccount,
  input: {
    sharedEnv?: Record<string, string>;
    baseEnv?: NodeJS.ProcessEnv;
    command?: string;
    executeImpl?: TwitterCliExecute;
  } = {},
): Promise<TwitterCliRun> {
  const [sharedEnv, command] = await Promise.all([
    input.sharedEnv ? Promise.resolve(input.sharedEnv) : readSharedAgentEnv(),
    input.command ? Promise.resolve(input.command) : resolveTwitterCommand(),
  ]);
  let env: NodeJS.ProcessEnv | null = null;
  let setupError: Error | null = null;
  try {
    env = accountTwitterCliEnv(account, sharedEnv, input.baseEnv ?? process.env);
  } catch (error) {
    setupError = error instanceof Error ? error : new Error(String(error));
  }
  const executeImpl = input.executeImpl ?? defaultTwitterCliExecute;
  return async (args) => {
    if (setupError) throw setupError;
    return executeTwitterCli(command, args, env!, executeImpl);
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function responseData(value: unknown): unknown {
  const record = objectRecord(value);
  return record && Object.hasOwn(record, "data") ? record.data : value;
}

function statusFromResponse(value: unknown, checkedAt: string): SocialXDiscoveryStatus {
  const record = objectRecord(responseData(value));
  const authenticated = record?.authenticated === true;
  const user = objectRecord(record?.user);
  const handle = typeof user?.screenName === "string" ? user.screenName.trim() : "";
  const displayName = typeof user?.name === "string" ? user.name.trim() : "";
  const avatarUrl = normalizeXProfileImageUrl(user?.profileImageUrl);
  return {
    available: true,
    authenticated,
    backend: "agent-reach-twitter-cli",
    checkedAt,
    ...(handle ? { accountHandle: handle } : {}),
    ...(displayName ? { accountDisplayName: displayName } : {}),
    ...(avatarUrl ? { accountAvatarUrl: avatarUrl } : {}),
    detail: authenticated
      ? `Authenticated X discovery${handle ? ` as @${handle}` : ""}.`
      : "twitter-cli is installed, but its X session is not authenticated. Finish X auth in Apps & Services → Agent Reach.",
  };
}

export async function getXDiscoveryStatus(input: { force?: boolean; runTwitterImpl?: TwitterCliRun } = {}): Promise<SocialXDiscoveryStatus> {
  const now = Date.now();
  if (!input.runTwitterImpl && !input.force && statusCache && statusCache.expiresAt > now) return statusCache.value;
  const checkedAt = new Date(now).toISOString();
  let value: SocialXDiscoveryStatus;
  try {
    value = statusFromResponse(await (input.runTwitterImpl ?? runTwitterCli)(["status", "--json"]), checkedAt);
  } catch (error) {
    value = {
      available: false,
      authenticated: false,
      backend: "agent-reach-twitter-cli",
      checkedAt,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!input.runTwitterImpl) statusCache = { expiresAt: now + STATUS_CACHE_MS, value };
  return value;
}

/** Verify that the resolved account session really belongs to this account. */
export function bindXDiscoveryStatusToAccount(
  account: SocialAccount,
  status: SocialXDiscoveryStatus,
): SocialXDiscoveryStatus {
  if (account.platform !== "x" || !status.available || !status.authenticated) return status;
  const session = socialXSessionBinding(account);
  const connectedHandle = account.handle.trim().replace(/^@/, "");
  const sessionHandle = (status.accountHandle ?? "").trim().replace(/^@/, "");
  if (sessionHandle && sessionHandle.toLowerCase() === connectedHandle.toLowerCase()) {
    return session.mode === "account-env"
      ? { ...status, detail: `Authenticated X discovery as @${sessionHandle} using this account's isolated session.` }
      : status;
  }
  const recovery = session.mode === "account-env"
    ? `Update this account's Agent Reach X session with credentials for @${connectedHandle}`
    : `Bind per-account credentials for @${connectedHandle}, or sign the machine-default Agent Reach session into that account`;
  return {
    ...status,
    authenticated: false,
    accountDisplayName: undefined,
    accountAvatarUrl: undefined,
    detail: `Agent Reach is authenticated as @${sessionHandle || "unknown"}, but this Socials account is connected as @${connectedHandle}. Comment finder and X engagement require the same account. ${recovery} before finding or publishing replies and quote posts.`,
  };
}

export async function getXDiscoveryStatusForAccount(
  account: SocialAccount,
  input: { force?: boolean; runTwitterImpl?: TwitterCliRun } = {},
): Promise<SocialXDiscoveryStatus> {
  const now = Date.now();
  const session = socialXSessionBinding(account);
  const cacheKey = `${account.id}:${session.mode}:${session.mode === "account-env" ? `${session.authTokenEnvKey}:${session.ct0EnvKey}` : "default"}`;
  if (!input.runTwitterImpl && !input.force) {
    const cached = accountStatusCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;
  }
  const runImpl = input.runTwitterImpl ?? await createAccountTwitterCliRun(account);
  const value = bindXDiscoveryStatusToAccount(
    account,
    await getXDiscoveryStatus({ force: true, runTwitterImpl: runImpl }),
  );
  if (!input.runTwitterImpl) accountStatusCache.set(cacheKey, { expiresAt: now + STATUS_CACHE_MS, value });
  return value;
}

export function invalidateXDiscoveryStatus(accountId?: string): void {
  statusCache = null;
  if (!accountId) {
    accountStatusCache.clear();
    return;
  }
  for (const key of accountStatusCache.keys()) {
    if (key.startsWith(`${accountId}:`)) accountStatusCache.delete(key);
  }
}

function validHandle(value: string): string | null {
  const handle = value.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

/** Resolve the requested public X profile, independent of which account owns the read session. */
export async function getXPublicProfile(
  account: SocialAccount,
  handle: string,
  input: { force?: boolean; runTwitterImpl?: TwitterCliRun } = {},
): Promise<SocialXPublicProfile | null> {
  if (account.platform !== "x") return null;
  const requestedHandle = validHandle(handle);
  if (!requestedHandle) return null;
  const cacheKey = `${account.id}:${requestedHandle.toLowerCase()}`;
  const cached = publicProfileCache.get(cacheKey);
  if (!input.force && !input.runTwitterImpl && cached && cached.expiresAt > Date.now()) return cached.value;
  let value: SocialXPublicProfile | null = null;
  try {
    const runImpl = input.runTwitterImpl ?? await createAccountTwitterCliRun(account);
    const record = objectRecord(responseData(await runImpl(["user", requestedHandle, "--json"])));
    const returnedHandle = typeof record?.screenName === "string" ? validHandle(record.screenName) : null;
    if (returnedHandle?.toLowerCase() === requestedHandle.toLowerCase()) {
      const displayName = typeof record?.name === "string" ? record.name.trim() : "";
      const avatarUrl = normalizeXProfileImageUrl(record?.profileImageUrl);
      value = {
        handle: returnedHandle,
        ...(displayName ? { displayName } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
      };
    }
  } catch {
    // Public identity decoration is best-effort and never changes connection authority.
  }
  if (!input.runTwitterImpl) cachePublicProfile(cacheKey, value);
  return value;
}

export function getXPublicProfileForAccount(
  account: SocialAccount,
  input: { force?: boolean; runTwitterImpl?: TwitterCliRun } = {},
): Promise<SocialXPublicProfile | null> {
  return getXPublicProfile(account, account.handle, input);
}

function addHandle(output: string[], seen: Set<string>, value: string, self: string): void {
  const handle = validHandle(value);
  const key = handle?.toLowerCase() ?? "";
  if (!handle || key === self || seen.has(key) || output.length >= MAX_TARGET_HANDLES) return;
  seen.add(key);
  output.push(handle);
}

/** Prioritize explicit X context sources, then voice-memory lines that name engagement targets. */
export function extractEngagementTargetHandles(account: SocialAccount, contextText: string): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  const self = account.handle.replace(/^@/, "").toLowerCase();
  for (const source of account.contextSources) {
    if (source.kind === "x-account") addHandle(output, seen, source.ref, self);
  }
  for (const line of contextText.split(/\r?\n/)) {
    if (!/(?:engagement|reply|quote|comment)\s+(?:targets?|accounts?|network)|tier[- ]?1/i.test(line)) continue;
    for (const match of line.matchAll(/@([A-Za-z0-9_]{1,15})/g)) addHandle(output, seen, match[1], self);
  }
  return output;
}

function boundedQueries(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const query = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
    const key = query.toLowerCase();
    if (!query || query.startsWith("-") || seen.has(key)) continue;
    seen.add(key);
    output.push(query);
    if (output.length >= MAX_QUERIES) break;
  }
  return output;
}

function metric(record: Record<string, unknown> | null, key: string): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

type RawCandidate = { target: SocialEngagementTarget; isRetweet: boolean };

function normalizeCandidate(raw: unknown, source: SocialEngagementTarget["source"], sourceQuery: string | undefined, now: Date): RawCandidate | null {
  const record = objectRecord(raw);
  const author = objectRecord(record?.author);
  const metrics = objectRecord(record?.metrics);
  const externalId = typeof record?.id === "string" ? record.id.trim() : "";
  const text = typeof record?.text === "string" ? record.text.trim() : "";
  const authorHandle = typeof author?.screenName === "string" ? validHandle(author.screenName) : null;
  const authorAvatarUrl = normalizeXProfileImageUrl(author?.profileImageUrl);
  const createdValue = typeof record?.createdAtISO === "string" ? record.createdAtISO : record?.createdAt;
  const created = typeof createdValue === "string" ? Date.parse(createdValue) : Number.NaN;
  if (!/^\d+$/.test(externalId) || !text || !authorHandle || !Number.isFinite(created)) return null;
  return {
    isRetweet: record?.isRetweet === true,
    target: {
      platform: "x",
      externalId,
      url: `https://x.com/${authorHandle}/status/${externalId}`,
      authorHandle,
      ...(typeof author?.name === "string" && author.name.trim() ? { authorName: author.name.trim() } : {}),
      ...(typeof author?.verified === "boolean" ? { authorVerified: author.verified } : {}),
      ...(authorAvatarUrl ? { authorAvatarUrl } : {}),
      text,
      createdAt: new Date(created).toISOString(),
      discoveredAt: now.toISOString(),
      source,
      ...(sourceQuery ? { sourceQuery } : {}),
      metrics: {
        likes: metric(metrics, "likes"),
        reposts: metric(metrics, "retweets"),
        replies: metric(metrics, "replies"),
        quotes: metric(metrics, "quotes"),
        ...(Object.hasOwn(metrics ?? {}, "views") ? { views: metric(metrics, "views") } : {}),
      },
    },
  };
}

function candidateScore(target: SocialEngagementTarget, trustedHandles: Set<string>, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - Date.parse(target.createdAt)) / 3_600_000);
  const engagement = target.metrics.likes
    + target.metrics.reposts * 2
    + target.metrics.replies * 1.5
    + target.metrics.quotes * 2
    + Math.log10((target.metrics.views ?? 0) + 1) * 4;
  return engagement / Math.max(1, Math.sqrt(ageHours + 1))
    + (trustedHandles.has(target.authorHandle.toLowerCase()) ? 30 : 0);
}

async function concurrentMap<T>(values: T[], limit: number, task: (value: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      await task(values[index]);
    }
  }));
}

export async function discoverRelevantXPosts(input: {
  account: SocialAccount;
  contextText: string;
  queue: SocialQueueItem[];
  queries: string[];
  now?: Date;
  runTwitterImpl?: TwitterCliRun;
}): Promise<SocialXDiscoveryResult> {
  if (input.account.platform !== "x") throw new Error("Live engagement discovery is currently available for X accounts.");
  const now = input.now ?? new Date();
  const runImpl = input.runTwitterImpl ?? await createAccountTwitterCliRun(input.account);
  const status = await getXDiscoveryStatusForAccount(input.account, { runTwitterImpl: runImpl });
  if (!status.available || !status.authenticated) throw new Error(status.detail);
  const targetHandles = extractEngagementTargetHandles(input.account, input.contextText);
  const queries = boundedQueries(input.queries);
  if (!targetHandles.length && !queries.length) throw new Error("No X discovery targets or search topics were available from the account's voice and context.");
  const seenTargets = new Set(input.queue.flatMap((item) => [item.replyTo, item.quoteOf]).filter((id): id is string => Boolean(id)));
  const trustedHandles = new Set(targetHandles.map((handle) => handle.toLowerCase()));
  const rejected: SocialXDiscoveryRejected = { invalid: 0, duplicate: 0, self: 0, stale: 0, seen: 0, retweet: 0 };
  const collected: RawCandidate[] = [];
  const requests = [
    ...targetHandles.map((handle) => ({ source: "timeline" as const, sourceQuery: handle, args: ["user-posts", handle, "--max", "6", "--json"] })),
    ...queries.map((query) => ({
      source: "search" as const,
      sourceQuery: query,
      args: ["search", query, "--type", "top", "--lang", "en", "--since", new Date(now.getTime() - input.account.drafting.engagementLookbackHours * 3_600_000).toISOString().slice(0, 10), "--exclude", "retweets", "--max", "12", "--json"],
    })),
  ];
  const errors: string[] = [];
  await concurrentMap(requests, 3, async (request) => {
    try {
      const data = responseData(await runImpl(request.args));
      if (!Array.isArray(data)) throw new Error("twitter-cli returned a non-list response.");
      for (const raw of data) {
        const candidate = normalizeCandidate(raw, request.source, request.sourceQuery, now);
        if (candidate) collected.push(candidate);
        else rejected.invalid += 1;
      }
    } catch (error) {
      errors.push(`${request.source} ${request.sourceQuery}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  if (!collected.length && errors.length === requests.length) {
    throw new Error(`Every X discovery request failed. ${errors.slice(0, 3).join(" ")}`);
  }
  const cutoff = now.getTime() - input.account.drafting.engagementLookbackHours * 3_600_000;
  const self = input.account.handle.replace(/^@/, "").toLowerCase();
  const byId = new Map<string, SocialEngagementTarget>();
  for (const candidate of collected) {
    const target = candidate.target;
    if (candidate.isRetweet) { rejected.retweet += 1; continue; }
    if (target.authorHandle.toLowerCase() === self) { rejected.self += 1; continue; }
    if (Date.parse(target.createdAt) < cutoff) { rejected.stale += 1; continue; }
    if (seenTargets.has(target.externalId)) { rejected.seen += 1; continue; }
    const existing = byId.get(target.externalId);
    if (existing) {
      rejected.duplicate += 1;
      if (existing.source === "search" && target.source === "timeline") byId.set(target.externalId, target);
      continue;
    }
    byId.set(target.externalId, target);
  }
  const candidates = [...byId.values()]
    .sort((left, right) => candidateScore(right, trustedHandles, now) - candidateScore(left, trustedHandles, now)
      || Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, MAX_CANDIDATES);
  if (!candidates.length) throw new Error("X discovery found no fresh, unused posts. Broaden the account context or try again later.");
  return {
    backend: "agent-reach-twitter-cli",
    authenticatedAs: status.accountHandle ?? "unknown",
    candidates,
    queries,
    targetHandles,
    rejected,
  };
}
