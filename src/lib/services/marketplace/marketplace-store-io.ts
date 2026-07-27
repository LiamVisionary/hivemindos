import "server-only";

import { promises as fs, statSync } from "node:fs";
import path from "node:path";

import { homedir } from "@/lib/home-dir";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";

/**
 * Marketplace store plumbing — vault-primary definitions + local fallback,
 * transcribed from the socials-store storage model:
 *
 * - DEFINITIONS (accounts, directives, listings, conversations, decisions)
 *   live in the Syncthing-replicated shared vault under
 *   Operations/Marketplace/ so every fleet machine sees the same state and
 *   approval cards render wherever the human is.
 * - Listing PHOTOS are binary files under Operations/Marketplace/Photos/
 *   (referenced by vault-relative path, never base64 inside JSON — replication
 *   also carries them to the profile-owning machine for upload).
 * - HOT tick state (nextPollAt, in-flight ops, research jobs) lives per
 *   machine in ~/.hivemindos/marketplace-runtime.json and never touches sync.
 * - With no vault available, definitions fall back to ~/.hivemindos/marketplace/.
 */

export const MARKETPLACE_LOCAL_DIR = path.join(homedir(), ".hivemindos", "marketplace");
export const MARKETPLACE_RUNTIME_PATH = path.join(homedir(), ".hivemindos", "marketplace-runtime.json");
const VAULT_MARKETPLACE_DIR = path.join("Operations", "Marketplace");

export type MarketplaceStorage = { source: "obsidian" | "local"; file: string };

export function resolveMarketplaceStorage(fileName: string): MarketplaceStorage {
  const configured = DEFAULT_SHARED_VAULT.vaultPath?.trim();
  if (configured) {
    const root = resolveObsidianVaultPath(configured);
    try {
      if (statSync(root).isDirectory()) return { source: "obsidian", file: path.join(root, VAULT_MARKETPLACE_DIR, fileName) };
    } catch {
      // Vault unavailable — fall back to the local directory.
    }
  }
  return { source: "local", file: path.join(MARKETPLACE_LOCAL_DIR, fileName) };
}

/** Root directory where listing photos live (vault when available). */
export function resolveMarketplacePhotosRoot(): MarketplaceStorage {
  const storage = resolveMarketplaceStorage("Photos");
  return storage;
}

/** Thrown when a present marketplace file is unparseable — fail closed, never overwrite. */
export class MarketplaceFileCorruptError extends Error {
  readonly file: string;
  readonly reason?: unknown;
  constructor(file: string, reason?: unknown) {
    super(
      `[marketplace-store] refusing to read a corrupt marketplace file at ${file}. ` +
        `Nothing was wiped or overwritten. Restore from a sibling ${path.basename(file)}.bak.N backup ` +
        `or fix the JSON, then retry.`,
    );
    this.name = "MarketplaceFileCorruptError";
    this.file = file;
    this.reason = reason;
  }
}

const DEFINITIONS_BACKUP_COUNT = 5;

export async function writeFileAtomic(file: string, contents: string): Promise<void> {
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

export async function writeDurableDefinitions(file: string, contents: string): Promise<void> {
  await rotateDefinitionsBackups(file);
  await writeFileAtomic(file, contents);
}

/** Serializes read-modify-write cycles within the process (socials/companies-store pattern). */
let marketplaceWriteQueue: Promise<unknown> = Promise.resolve();
export function enqueueMarketplaceWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = marketplaceWriteQueue.then(fn, fn);
  marketplaceWriteQueue = next.catch(() => undefined);
  return next;
}

type CorruptFilePolicy = "throw" | "empty";

/**
 * Read a JSON array file of records through a normalizer. One malformed record
 * degrades to a skipped record, not a store-wide throw; a corrupt FILE fails
 * closed so backups are never clobbered by a rewrite.
 */
export async function readRecordsFile<T>(
  file: string,
  normalizer: (raw: unknown) => T | null,
  onCorrupt: CorruptFilePolicy = "throw",
): Promise<T[]> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    if (onCorrupt === "throw") throw new MarketplaceFileCorruptError(file, error);
    return [];
  }
  const trimmed = text.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    if (onCorrupt === "throw") {
      console.error(`[marketplace-store] CORRUPT marketplace file at ${file} — refusing to overwrite (restore from .bak.N):`, error);
      throw new MarketplaceFileCorruptError(file, error);
    }
    return [];
  }
  if (!Array.isArray(parsed)) {
    if (onCorrupt === "throw") throw new MarketplaceFileCorruptError(file);
    return [];
  }
  const out: T[] = [];
  let dropped = 0;
  for (const raw of parsed) {
    const record = normalizer(raw);
    if (record) out.push(record);
    else dropped++;
  }
  if (dropped > 0) {
    console.error(`[marketplace-store] dropped ${dropped} malformed record(s) from ${file}`);
  }
  return out;
}

/** Generic mutate helper: serialized read-modify-write against one definitions file. */
export async function mutateRecordsFile<T>(
  fileName: string,
  normalizer: (raw: unknown) => T | null,
  mutate: (records: T[]) => T[] | Promise<T[]>,
): Promise<T[]> {
  return enqueueMarketplaceWrite(async () => {
    const storage = resolveMarketplaceStorage(fileName);
    const records = await readRecordsFile(storage.file, normalizer);
    const next = await mutate(records);
    await writeDurableDefinitions(storage.file, JSON.stringify(next, null, 2));
    return next;
  });
}
