import "server-only";

import { promises as fs, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import {
  SOCIAL_PLATFORMS,
  type SocialAccount,
  type SocialAwakeHours,
  type SocialContextSource,
  type SocialPlatform,
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
  version: 1;
  queue: SocialQueueItem[];
  /** Tick heartbeat, surfaced in the UI as queue liveness ("last tick at"). */
  lastTickAt?: string;
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

export const DEFAULT_SOCIAL_AWAKE_HOURS: SocialAwakeHours = {
  enabled: false,
  start: "09:00",
  end: "22:00",
  timezone: "America/New_York",
  days: [1, 2, 3, 4, 5, 6, 0],
};

export const DEFAULT_MAX_DAILY_READ_OPS = 20;

function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
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

async function rotateDefinitionsBackups(file: string): Promise<void> {
  try {
    await fs.access(file);
  } catch {
    return;
  }
  for (let i = DEFINITIONS_BACKUP_COUNT - 1; i >= 0; i--) {
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
  await rotateDefinitionsBackups(file);
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
  try {
    const text = await fs.readFile(SOCIALS_RUNTIME_PATH, "utf8");
    const parsed = JSON.parse(text) as SocialsRuntimeOverlay;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.queue)) return { ...parsed, version: 1, queue: parsed.queue };
  } catch {
    // missing/corrupt overlay resets to empty — queue items are per-machine hot state
  }
  return { version: 1, queue: [] };
}

async function writeRuntimeOverlay(overlay: SocialsRuntimeOverlay): Promise<void> {
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

export async function createSocialAccount(input: CreateSocialAccountInput): Promise<SocialAccount> {
  const now = new Date().toISOString();
  const account: SocialAccount = {
    id: socialAccountId(input.platform, input.handle),
    platform: input.platform,
    handle: input.handle.replace(/^@/, "").trim(),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    method: input.method,
    status: "disconnected",
    ...(input.soulPath ? { soulPath: input.soulPath } : {}),
    postingMode: "manual",
    awakeHours: { ...DEFAULT_SOCIAL_AWAKE_HOURS, ...(input.awakeHours ?? {}) },
    contextSources: [],
    maxDailyReadOps: DEFAULT_MAX_DAILY_READ_OPS,
    ...(input.binding ? { binding: { ...input.binding } } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await mutateSocialAccounts((accounts) => {
    if (accounts.some((existing) => existing.id === account.id)) {
      throw new Error(`Social account already exists: ${account.id}`);
    }
    return [...accounts, account];
  });
  return account;
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
  // Drop this account's queue items from the local overlay too.
  await enqueueSocialsWrite(async () => {
    const overlay = await readRuntimeOverlay();
    const queue = overlay.queue.filter((item) => item.accountId !== id);
    if (queue.length !== overlay.queue.length) await writeRuntimeOverlay({ ...overlay, queue });
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
// Queue (per-machine hot overlay) — full engine lands in Phase 2; Phase 1
// exposes read/replace so the UI can render an (empty) timeline honestly.
// ---------------------------------------------------------------------------

export async function readSocialQueue(): Promise<SocialQueueItem[]> {
  const overlay = await readRuntimeOverlay();
  return overlay.queue;
}

export async function readSocialQueueMeta(): Promise<{ lastTickAt?: string }> {
  const overlay = await readRuntimeOverlay();
  return overlay.lastTickAt ? { lastTickAt: overlay.lastTickAt } : {};
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
      ...(options.markTick ? { lastTickAt: new Date().toISOString() } : {}),
    });
    return queue;
  });
}
