import "server-only";

import { createHash, randomUUID } from "crypto";
import { constants } from "fs";
import { appendFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import { hostname, tmpdir } from "os";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";

export const AGENT_MEMORY_TRANSACTION_JOURNAL_PATH = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/Agent Memory Transactions.jsonl`;

const TRANSACTION_SCHEMA = "hivemindos.agent-memory-transaction.v1";
const LOCK_STALE_MS = 2 * 60_000;
const LOCK_WAIT_MS = 12_000;
const LOCK_RETRY_MS = 40;
const MAX_JOURNAL_BYTES = 4 * 1024 * 1024;

type TransactionWrite = {
  path: string;
  temporaryPath: string;
  sha256: string;
  bytes: number;
  mode: number;
};

type TransactionRow = {
  schema: typeof TRANSACTION_SCHEMA;
  transactionId: string;
  operation: string;
  state: "prepared" | "sources-committed" | "committed" | "aborted";
  timestamp: string;
  writes?: TransactionWrite[];
  recovered?: boolean;
  error?: string;
};

const TRANSACTION_STATES = new Set<TransactionRow["state"]>(["prepared", "sources-committed", "committed", "aborted"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/i;

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function assertInside(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path));
  if (rel.startsWith("..")) throw new Error("Memory transaction path escaped the selected vault.");
}

function isSafeRelativePath(value: unknown): value is string {
  return typeof value === "string"
    && Boolean(value)
    && value.length <= 2048
    && !isAbsolute(value)
    && !/[\0\r\n]/.test(value)
    && !value.split(/[\\/]+/).includes("..");
}

function normalizeTransactionRow(value: unknown): TransactionRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<TransactionRow>;
  if (
    row.schema !== TRANSACTION_SCHEMA
    || typeof row.transactionId !== "string"
    || !/^[A-Za-z0-9._-]{8,160}$/.test(row.transactionId)
    || typeof row.operation !== "string"
    || !row.operation.trim()
    || !TRANSACTION_STATES.has(row.state as TransactionRow["state"])
  ) return null;
  if (row.writes !== undefined && (!Array.isArray(row.writes) || row.writes.some((write) => (
    !isSafeRelativePath(write?.path)
    || !isSafeRelativePath(write.temporaryPath)
    || write.path === write.temporaryPath
    || !SHA256_PATTERN.test(write.sha256)
    || !Number.isInteger(write.bytes)
    || write.bytes < 0
    || !Number.isInteger(write.mode)
    || write.mode < 0
  )))) return null;
  return row as TransactionRow;
}

function lockPath(root: string) {
  const key = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 24);
  return join(tmpdir(), "hivemindos-agent-memory-locks", `${key}.lock`);
}

async function processExists(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function staleLockCanBeRemoved(path: string) {
  const st = await stat(path).catch(() => null);
  if (!st?.isFile() || Date.now() - st.mtimeMs <= LOCK_STALE_MS) return false;
  const raw = await readFile(path, "utf8").catch(() => "");
  try {
    const owner = JSON.parse(raw) as { pid?: number; host?: string };
    if (owner.host === hostname() && owner.pid && await processExists(owner.pid)) return false;
  } catch {
    // A stale malformed lock has no live owner evidence.
  }
  return true;
}

type CrossProcessFileLockOptions = {
  /** Extra fields recorded in the lockfile body next to pid/host/acquiredAt. */
  owner?: Record<string, unknown>;
  /** Human-readable lock name used in the acquisition-timeout error. */
  label?: string;
};

async function acquireLock(path: string, options: CrossProcessFileLockOptions = {}) {
  await mkdir(dirname(path), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() <= deadline) {
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString(), ...(options.owner ?? {}) }));
      await handle.close();
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await staleLockCanBeRemoved(path)) {
        await unlink(path).catch(() => undefined);
        continue;
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error(`Timed out waiting for the ${options.label ?? "cross-process file"} lock.`);
}

/**
 * Serializes read-modify-write cycles on a shared file across the multiple
 * server processes that can run on one machine (dev server, agent server,
 * Tauri sidecar). In-process promise queues cannot see each other, so callers
 * mutating a shared store must also hold this O_EXCL lockfile.
 */
export async function withCrossProcessFileLock<T>(
  path: string,
  task: () => Promise<T>,
  options: CrossProcessFileLockOptions = {},
) {
  await acquireLock(path, options);
  try {
    return await task();
  } finally {
    await unlink(path).catch(() => undefined);
  }
}

export async function withAgentMemoryWriteLock<T>(root: string, task: () => Promise<T>) {
  return withCrossProcessFileLock(lockPath(root), task, {
    owner: { rootHash: sha256(resolve(root)) },
    label: "cross-process Shared Brain memory write",
  });
}

async function appendJournal(root: string, row: TransactionRow) {
  const file = join(root, AGENT_MEMORY_TRANSACTION_JOURNAL_PATH);
  assertInside(root, file);
  await mkdir(dirname(file), { recursive: true });
  const before = await stat(file).catch(() => null);
  let prefix = "";
  if (before?.isFile() && before.size > 0) {
    const handle = await open(file, constants.O_RDONLY);
    try {
      const tail = new Uint8Array(1);
      await handle.read(tail, 0, 1, before.size - 1);
      if (tail[0] !== 0x0a) prefix = "\n";
    } finally {
      await handle.close();
    }
  }
  await appendFile(file, `${prefix}${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
  const st = await stat(file).catch(() => null);
  if (st?.isFile() && st.size > MAX_JOURNAL_BYTES) {
    const compacted = [...latestTransactions(await readFile(file, "utf8")).values()];
    const temporary = `${file}.${process.pid}.${randomUUID()}.compact.tmp`;
    await writeFile(temporary, compacted.length ? `${compacted.map((item) => JSON.stringify(item)).join("\n")}\n` : "", { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
  }
}

async function fileMatches(path: string, expectedHash: string) {
  const contents = await readFile(path, "utf8").catch(() => null);
  return contents !== null && sha256(contents) === expectedHash;
}

function latestTransactions(raw: string) {
  const latest = new Map<string, TransactionRow>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = normalizeTransactionRow(JSON.parse(line) as unknown);
      if (row) latest.set(row.transactionId, row);
    } catch {
      // A partial trailing journal row does not invalidate earlier receipts.
    }
  }
  return latest;
}

export async function recoverAgentMemoryFileTransactions(root: string) {
  const file = join(root, AGENT_MEMORY_TRANSACTION_JOURNAL_PATH);
  const raw = await readFile(file, "utf8").catch(() => "");
  const recoveredTransactionIds: string[] = [];
  for (const row of latestTransactions(raw).values()) {
    if (row.state === "committed" || row.state === "aborted" || !row.writes?.length) continue;
    const writeStates = await Promise.all(row.writes.map(async (write) => {
      const destination = join(root, write.path);
      const temporary = join(root, write.temporaryPath);
      assertInside(root, destination);
      assertInside(root, temporary);
      return {
        write,
        destination,
        temporary,
        destinationMatches: await fileMatches(destination, write.sha256),
        temporaryMatches: await fileMatches(temporary, write.sha256),
      };
    }));
    const recoverable = writeStates.every((state) => state.destinationMatches || state.temporaryMatches);
    if (!recoverable) {
      // Preflight every source before promoting any remaining file. This
      // prevents recovery itself from widening a partially staged write and
      // removes staging files that can no longer form a complete set.
      await Promise.all(writeStates
        .filter((state) => state.temporaryMatches)
        .map((state) => unlink(state.temporary).catch(() => undefined)));
      await appendJournal(root, {
        schema: TRANSACTION_SCHEMA,
        transactionId: row.transactionId,
        operation: row.operation,
        state: "aborted",
        timestamp: new Date().toISOString(),
        error: "A staged source file was missing or failed its checksum; generated indexes were not advanced.",
      });
      continue;
    }
    for (const state of writeStates) {
      if (state.destinationMatches) {
        await unlink(state.temporary).catch(() => undefined);
        continue;
      }
      await mkdir(dirname(state.destination), { recursive: true });
      await rename(state.temporary, state.destination);
    }
    await appendJournal(root, {
      schema: TRANSACTION_SCHEMA,
      transactionId: row.transactionId,
      operation: row.operation,
      state: "sources-committed",
      timestamp: new Date().toISOString(),
      writes: row.writes,
      recovered: true,
    });
    recoveredTransactionIds.push(row.transactionId);
  }
  return { recoveredTransactionIds };
}

export async function commitAgentMemoryFileTransaction(input: {
  root: string;
  operation: string;
  files: Array<{ path: string; contents: string; mode?: number }>;
}) {
  if (!input.operation.trim()) throw new Error("Memory file transactions require an operation name.");
  if (!input.files.length) throw new Error("Memory file transactions require at least one source file.");
  const paths = new Set<string>();
  for (const file of input.files) {
    if (!isSafeRelativePath(file.path)) throw new Error("Memory transaction paths must stay relative to the selected vault.");
    if (paths.has(file.path)) throw new Error(`Memory file transaction contains a duplicate destination: ${file.path}`);
    paths.add(file.path);
  }
  const transactionId = `memtxn-${Date.now().toString(36)}-${randomUUID().slice(0, 12)}`;
  const writes: TransactionWrite[] = [];
  let prepared = false;
  try {
    for (const file of input.files) {
      const destination = join(input.root, file.path);
      assertInside(input.root, destination);
      await mkdir(dirname(destination), { recursive: true });
      const temporaryPath = `${file.path}.${transactionId}.tmp`;
      const temporary = join(input.root, temporaryPath);
      assertInside(input.root, temporary);
      const mode = file.mode ?? 0o600;
      await writeFile(temporary, file.contents, { encoding: "utf8", mode });
      writes.push({ path: file.path, temporaryPath, sha256: sha256(file.contents), bytes: Buffer.byteLength(file.contents, "utf8"), mode });
    }
    await appendJournal(input.root, {
      schema: TRANSACTION_SCHEMA,
      transactionId,
      operation: input.operation,
      state: "prepared",
      timestamp: new Date().toISOString(),
      writes,
    });
    prepared = true;
    for (const write of writes) await rename(join(input.root, write.temporaryPath), join(input.root, write.path));
    await appendJournal(input.root, {
      schema: TRANSACTION_SCHEMA,
      transactionId,
      operation: input.operation,
      state: "sources-committed",
      timestamp: new Date().toISOString(),
      writes,
    });
    return { transactionId, writes };
  } catch (error) {
    // Once preparation is journaled, a rename may already have committed a
    // subset of the sources. Keep that transaction recoverable; the next
    // locked writer verifies each destination/staging checksum and finishes
    // the set before publishing an index generation.
    await appendJournal(input.root, {
      schema: TRANSACTION_SCHEMA,
      transactionId,
      operation: input.operation,
      state: prepared ? "prepared" : "aborted",
      timestamp: new Date().toISOString(),
      writes: prepared ? writes : undefined,
      error: error instanceof Error ? error.message.slice(0, 300) : "Memory file transaction failed.",
    }).catch(() => undefined);
    if (!prepared) {
      await Promise.all(writes.map((write) => unlink(join(input.root, write.temporaryPath)).catch(() => undefined)));
    }
    throw error;
  }
}

export async function completeAgentMemoryFileTransaction(root: string, transactionId: string, operation: string, recovered = false) {
  await appendJournal(root, {
    schema: TRANSACTION_SCHEMA,
    transactionId,
    operation,
    state: "committed",
    timestamp: new Date().toISOString(),
    recovered: recovered || undefined,
  });
}
