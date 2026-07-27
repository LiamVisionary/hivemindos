import "server-only";

import { createCipheriv, createDecipheriv, createSecretKey, randomBytes, randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";

import { homedir } from "@/lib/home-dir";

const VAULT_VERSION = 1 as const;
const ENCRYPTION_ALGORITHM = "aes-256-gcm" as const;
const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_LOCK_MS = 30_000;
const DEFAULT_LOCK_RETRY_MS = 20;
const JOB_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;

type StoredJobKeyRecord = {
  jobId: string;
  publicKeySha256: string;
  createdAt: string;
  expiresAt: string;
  algorithm: typeof ENCRYPTION_ALGORITHM;
  iv: string;
  tag: string;
  ciphertext: string;
};

type JobKeyVaultFile = {
  version: typeof VAULT_VERSION;
  records: Record<string, StoredJobKeyRecord>;
};

export type HiveComputeJobKeyBinding = {
  jobId: string;
  publicKeySha256: string;
};

export type StoreHiveComputeJobKeyInput = HiveComputeJobKeyBinding & {
  privateKeyPkcs8: Uint8Array;
  expiresAt: string | number | Date;
};

export type HiveComputeJobPrivateKey = HiveComputeJobKeyBinding & {
  privateKeyPkcs8: Uint8Array;
  createdAt: string;
  expiresAt: string;
};

export type HiveComputeJobKeyVaultOptions = {
  rootDir?: string;
  now?: () => number;
  lockTimeoutMs?: number;
  staleLockMs?: number;
  lockRetryMs?: number;
};

export type HiveComputeJobKeyVaultPaths = {
  rootDir: string;
  vaultFile: string;
  masterKeyFile: string;
  lockDir: string;
};

export type HiveComputeJobKeyVault = {
  paths: HiveComputeJobKeyVaultPaths;
  store(input: StoreHiveComputeJobKeyInput): Promise<HiveComputeJobKeyBinding & { createdAt: string; expiresAt: string }>;
  get(binding: HiveComputeJobKeyBinding): Promise<HiveComputeJobPrivateKey | null>;
  delete(binding: HiveComputeJobKeyBinding): Promise<boolean>;
  cleanupExpired(): Promise<number>;
};

export const DEFAULT_HIVE_COMPUTE_JOB_KEY_VAULT_DIR = path.join(
  homedir(),
  ".hivemindos",
  "hive-compute",
  "job-key-vault",
);

export function createHiveComputeJobKeyVault(options: HiveComputeJobKeyVaultOptions = {}): HiveComputeJobKeyVault {
  const rootDir = path.resolve(options.rootDir ?? DEFAULT_HIVE_COMPUTE_JOB_KEY_VAULT_DIR);
  const paths: HiveComputeJobKeyVaultPaths = {
    rootDir,
    vaultFile: path.join(rootDir, "job-keys.json"),
    masterKeyFile: path.join(rootDir, "master.key"),
    lockDir: path.join(rootDir, ".job-keys.lock"),
  };
  const now = options.now ?? Date.now;
  const lockOptions = {
    timeoutMs: positiveDuration(options.lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS),
    staleMs: positiveDuration(options.staleLockMs, DEFAULT_STALE_LOCK_MS),
    retryMs: positiveDuration(options.lockRetryMs, DEFAULT_LOCK_RETRY_MS),
  };

  return {
    paths,

    async store(input) {
      const binding = normalizeBinding(input);
      const expiresAtMs = normalizeExpiry(input.expiresAt);
      const currentTime = now();
      if (expiresAtMs <= currentTime) {
        throw new Error("Hive Compute job private key expiry must be in the future.");
      }
      const pkcs8 = copyBytes(input.privateKeyPkcs8);
      if (!pkcs8.byteLength) throw new Error("Hive Compute job private key PKCS8 bytes are required.");

      try {
        return await withFilesystemLock(paths, lockOptions, async () => {
          const vault = await readVault(paths);
          removeExpiredRecords(vault, currentTime);
          const existing = vault.records[binding.jobId];
          if (existing && existing.publicKeySha256 !== binding.publicKeySha256) {
            throw new Error("Hive Compute job key is already bound to a different public key.");
          }

          let masterKey: Uint8Array | undefined;
          try {
            masterKey = await ensureMasterKey(paths);
            const createdAt = new Date(currentTime).toISOString();
            const expiresAt = new Date(expiresAtMs).toISOString();
            const iv = toUint8Array(randomBytes(IV_BYTES));
            const cipher = createCipheriv(ENCRYPTION_ALGORITHM, createSecretKey(masterKey), iv);
            cipher.setAAD(toUint8Array(Buffer.from(recordAad({ ...binding, expiresAt }), "utf8")));
            const ciphertext = concatBytes([
              toUint8Array(cipher.update(pkcs8)),
              toUint8Array(cipher.final()),
            ]);
            vault.records[binding.jobId] = {
              ...binding,
              createdAt,
              expiresAt,
              algorithm: ENCRYPTION_ALGORITHM,
              iv: Buffer.from(iv).toString("base64url"),
              tag: cipher.getAuthTag().toString("base64url"),
              ciphertext: Buffer.from(ciphertext).toString("base64url"),
            };
            await writeVault(paths, vault);
            return { ...binding, createdAt, expiresAt };
          } finally {
            masterKey?.fill(0);
          }
        });
      } finally {
        pkcs8.fill(0);
      }
    },

    async get(input) {
      const binding = normalizeBinding(input);
      return withFilesystemLock(paths, lockOptions, async () => {
        const vault = await readVault(paths);
        const record = vault.records[binding.jobId];
        if (!record) return null;
        if (Date.parse(record.expiresAt) <= now()) {
          delete vault.records[binding.jobId];
          await writeVault(paths, vault);
          return null;
        }
        assertBinding(record, binding);
        const masterKey = await ensureMasterKey(paths);
        let plaintext: Uint8Array | undefined;
        try {
          const decipher = createDecipheriv(
            ENCRYPTION_ALGORITHM,
            createSecretKey(masterKey),
            decodeBase64Url(record.iv, IV_BYTES, "iv"),
          );
          decipher.setAAD(toUint8Array(Buffer.from(recordAad(record), "utf8")));
          decipher.setAuthTag(decodeBase64Url(record.tag, 16, "authentication tag"));
          plaintext = concatBytes([
            toUint8Array(decipher.update(decodeBase64Url(record.ciphertext, undefined, "ciphertext"))),
            toUint8Array(decipher.final()),
          ]);
          return {
            ...binding,
            privateKeyPkcs8: copyBytes(plaintext),
            createdAt: record.createdAt,
            expiresAt: record.expiresAt,
          };
        } catch (error) {
          throw new Error("Hive Compute job private key failed authenticated decryption.", { cause: error });
        } finally {
          plaintext?.fill(0);
          masterKey.fill(0);
        }
      });
    },

    async delete(input) {
      const binding = normalizeBinding(input);
      return withFilesystemLock(paths, lockOptions, async () => {
        const vault = await readVault(paths);
        const record = vault.records[binding.jobId];
        if (!record) return false;
        assertBinding(record, binding);
        delete vault.records[binding.jobId];
        await writeVault(paths, vault);
        return true;
      });
    },

    async cleanupExpired() {
      return withFilesystemLock(paths, lockOptions, async () => {
        const vault = await readVault(paths);
        const removed = removeExpiredRecords(vault, now());
        if (removed) await writeVault(paths, vault);
        return removed;
      });
    },
  };
}

const defaultVault = createHiveComputeJobKeyVault();

export function storeHiveComputeJobPrivateKey(input: StoreHiveComputeJobKeyInput) {
  return defaultVault.store(input);
}

export function getHiveComputeJobPrivateKey(binding: HiveComputeJobKeyBinding) {
  return defaultVault.get(binding);
}

export function deleteHiveComputeJobPrivateKey(binding: HiveComputeJobKeyBinding) {
  return defaultVault.delete(binding);
}

export function cleanupExpiredHiveComputeJobKeys() {
  return defaultVault.cleanupExpired();
}

function normalizeBinding(input: HiveComputeJobKeyBinding): HiveComputeJobKeyBinding {
  const jobId = String(input.jobId ?? "").trim();
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error("Hive Compute job id must be 1-128 safe identifier characters.");
  }
  const publicKeySha256 = String(input.publicKeySha256 ?? "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(publicKeySha256)) {
    throw new Error("Hive Compute output public key SHA-256 must be 64 hexadecimal characters.");
  }
  return { jobId, publicKeySha256 };
}

function normalizeExpiry(value: string | number | Date) {
  const parsed = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Hive Compute job private key expiry is invalid.");
  return Math.floor(parsed);
}

function positiveDuration(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

function recordAad(binding: HiveComputeJobKeyBinding & { expiresAt: string }) {
  return JSON.stringify([
    "hivemindos-hive-compute-job-key-v1",
    binding.jobId,
    binding.publicKeySha256,
    binding.expiresAt,
  ]);
}

function assertBinding(record: StoredJobKeyRecord, binding: HiveComputeJobKeyBinding) {
  if (record.jobId !== binding.jobId || record.publicKeySha256 !== binding.publicKeySha256) {
    throw new Error("Hive Compute job private key binding does not match the requested job and public key.");
  }
}

function copyBytes(value: Uint8Array) {
  return Uint8Array.from(value);
}

function toUint8Array(value: ArrayLike<number>) {
  const copy = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) copy[index] = value[index] ?? 0;
  return copy;
}

function concatBytes(chunks: Uint8Array[]) {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeBase64Url(value: string, expectedBytes: number | undefined, label: string) {
  const decoded = toUint8Array(Buffer.from(value, "base64url"));
  if (!decoded.byteLength || (expectedBytes !== undefined && decoded.byteLength !== expectedBytes)) {
    throw new Error(`Hive Compute job key vault ${label} is invalid.`);
  }
  return decoded;
}

async function ensurePrivateDirectory(rootDir: string) {
  await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
  await fs.chmod(rootDir, 0o700);
}

async function ensureMasterKey(paths: HiveComputeJobKeyVaultPaths) {
  await ensurePrivateDirectory(paths.rootDir);
  try {
    const encoded = (await fs.readFile(paths.masterKeyFile, "utf8")).trim();
    await fs.chmod(paths.masterKeyFile, 0o600);
    return decodeBase64Url(encoded, MASTER_KEY_BYTES, "master key");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const key = toUint8Array(randomBytes(MASTER_KEY_BYTES));
  await atomicWrite(paths.rootDir, paths.masterKeyFile, `${Buffer.from(key).toString("base64url")}\n`);
  return key;
}

async function readVault(paths: HiveComputeJobKeyVaultPaths): Promise<JobKeyVaultFile> {
  await ensurePrivateDirectory(paths.rootDir);
  let raw: string;
  try {
    raw = await fs.readFile(paths.vaultFile, "utf8");
    await fs.chmod(paths.vaultFile, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyVault();
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Hive Compute job key vault JSON is corrupt.", { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Hive Compute job key vault must be a JSON object.");
  }
  const candidate = parsed as Partial<JobKeyVaultFile>;
  if (candidate.version !== VAULT_VERSION || !candidate.records || typeof candidate.records !== "object" || Array.isArray(candidate.records)) {
    throw new Error("Hive Compute job key vault version or records are invalid.");
  }
  const records: Record<string, StoredJobKeyRecord> = {};
  for (const [jobId, value] of Object.entries(candidate.records)) {
    records[jobId] = parseStoredRecord(jobId, value);
  }
  return { version: VAULT_VERSION, records };
}

function parseStoredRecord(jobId: string, value: unknown): StoredJobKeyRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Hive Compute job key record ${jobId} is invalid.`);
  }
  const record = value as Partial<StoredJobKeyRecord>;
  const normalized = normalizeBinding({
    jobId: String(record.jobId ?? ""),
    publicKeySha256: String(record.publicKeySha256 ?? ""),
  });
  if (normalized.jobId !== jobId) throw new Error(`Hive Compute job key record ${jobId} has a mismatched id.`);
  if (record.algorithm !== ENCRYPTION_ALGORITHM) throw new Error(`Hive Compute job key record ${jobId} uses an unsupported algorithm.`);
  const createdAt = String(record.createdAt ?? "");
  const expiresAt = String(record.expiresAt ?? "");
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(expiresAt))) {
    throw new Error(`Hive Compute job key record ${jobId} has invalid timestamps.`);
  }
  const iv = String(record.iv ?? "");
  const tag = String(record.tag ?? "");
  const ciphertext = String(record.ciphertext ?? "");
  decodeBase64Url(iv, IV_BYTES, "iv");
  decodeBase64Url(tag, 16, "authentication tag");
  decodeBase64Url(ciphertext, undefined, "ciphertext");
  return { ...normalized, createdAt, expiresAt, algorithm: ENCRYPTION_ALGORITHM, iv, tag, ciphertext };
}

function emptyVault(): JobKeyVaultFile {
  return { version: VAULT_VERSION, records: {} };
}

function removeExpiredRecords(vault: JobKeyVaultFile, now: number) {
  let removed = 0;
  for (const [jobId, record] of Object.entries(vault.records)) {
    if (Date.parse(record.expiresAt) > now) continue;
    delete vault.records[jobId];
    removed += 1;
  }
  return removed;
}

async function writeVault(paths: HiveComputeJobKeyVaultPaths, vault: JobKeyVaultFile) {
  await atomicWrite(paths.rootDir, paths.vaultFile, `${JSON.stringify(vault, null, 2)}\n`);
}

async function atomicWrite(rootDir: string, destination: string, contents: string) {
  await ensurePrivateDirectory(rootDir);
  const temporary = path.join(rootDir, `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, destination);
    await fs.chmod(destination, 0o600);
    await syncDirectory(rootDir);
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function syncDirectory(directory: string) {
  const handle = await fs.open(directory, fsConstants.O_RDONLY).catch(() => null);
  if (!handle) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function withFilesystemLock<T>(
  paths: HiveComputeJobKeyVaultPaths,
  options: { timeoutMs: number; staleMs: number; retryMs: number },
  operation: () => Promise<T>,
): Promise<T> {
  await ensurePrivateDirectory(paths.rootDir);
  const token = randomUUID();
  const deadline = Date.now() + options.timeoutMs;
  while (true) {
    try {
      await fs.mkdir(paths.lockDir, { mode: 0o700 });
      await fs.writeFile(path.join(paths.lockDir, "owner"), `${JSON.stringify({ token, pid: process.pid })}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await removeStaleLock(paths.lockDir, options.staleMs);
      if (Date.now() >= deadline) throw new Error("Timed out waiting for the Hive Compute job key vault lock.");
      await delay(options.retryMs);
    }
  }
  try {
    return await operation();
  } finally {
    const owner = await readLockOwner(paths.lockDir);
    if (owner?.token === token) await fs.rm(paths.lockDir, { recursive: true, force: true });
  }
}

async function removeStaleLock(lockDir: string, staleMs: number) {
  const lockStat = await fs.stat(lockDir).catch(() => null);
  if (!lockStat || Date.now() - lockStat.mtimeMs <= staleMs) return;
  const ownerText = await fs.readFile(path.join(lockDir, "owner"), "utf8").catch(() => "");
  const owner = parseLockOwner(ownerText);
  if (owner && processIsAlive(owner.pid)) return;
  const latestOwnerText = await fs.readFile(path.join(lockDir, "owner"), "utf8").catch(() => "");
  if (latestOwnerText !== ownerText) return;
  await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
}

async function readLockOwner(lockDir: string) {
  const text = await fs.readFile(path.join(lockDir, "owner"), "utf8").catch(() => "");
  return parseLockOwner(text);
}

function parseLockOwner(value: string): { token: string; pid: number } | null {
  try {
    const parsed = JSON.parse(value) as { token?: unknown; pid?: unknown };
    const token = typeof parsed.token === "string" ? parsed.token : "";
    const pid = Number(parsed.pid);
    return token && Number.isInteger(pid) && pid > 0 ? { token, pid } : null;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
