import "server-only";

import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { homedir } from "@/lib/home-dir";

type ManagedCloudTokenRecord = {
  accountId: string;
  iv: string;
  tag: string;
  encryptedToken: string;
  updatedAt: string;
};

type ManagedCloudTokenVault = {
  version: 1;
  official?: ManagedCloudTokenRecord;
  pendingSettlement?: {
    quoteId: string;
    transactionHash: string;
    createdAt: string;
  };
};

export const MANAGED_CLOUD_TOKEN_VAULT_PATH = path.join(homedir(), ".hivemindos", "managed-cloud-agent-token-vault.json");
const keyPath = path.join(homedir(), ".hivemindos", "managed-cloud-agent-token-vault.key");
let writeQueue = Promise.resolve();

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

function decodeBase64Url(value: string) {
  return toUint8Array(Buffer.from(value, "base64url"));
}

async function ensureKey(): Promise<Buffer> {
  await fs.mkdir(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  try {
    return createHash("sha256").update((await fs.readFile(keyPath, "utf8")).trim()).digest();
  } catch {
    const generated = randomBytes(32).toString("base64url");
    await fs.writeFile(keyPath, generated, { mode: 0o600 });
    return createHash("sha256").update(generated).digest();
  }
}

async function readVault(): Promise<ManagedCloudTokenVault> {
  try {
    const value = JSON.parse(await fs.readFile(MANAGED_CLOUD_TOKEN_VAULT_PATH, "utf8")) as Partial<ManagedCloudTokenVault>;
    return value.version === 1
      ? { version: 1, official: value.official, pendingSettlement: value.pendingSettlement }
      : { version: 1 };
  } catch {
    return { version: 1 };
  }
}

async function writeVault(vault: ManagedCloudTokenVault): Promise<void> {
  const directory = path.dirname(MANAGED_CLOUD_TOKEN_VAULT_PATH);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `managed-cloud-agent-token-vault.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(vault, null, 2), { mode: 0o600 });
  await fs.rename(temporary, MANAGED_CLOUD_TOKEN_VAULT_PATH);
}

function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

export async function storeManagedCloudAccountToken(input: { accountId: string; token: string }): Promise<void> {
  await withWriteLock(async () => {
    const key = await ensureKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", createSecretKey(toUint8Array(key)), toUint8Array(iv));
    const encrypted = concatBytes([toUint8Array(cipher.update(input.token, "utf8")), toUint8Array(cipher.final())]);
    const current = await readVault();
    await writeVault({
      version: 1,
      pendingSettlement: current.pendingSettlement,
      official: {
        accountId: input.accountId,
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        encryptedToken: Buffer.from(encrypted).toString("base64url"),
        updatedAt: new Date().toISOString(),
      },
    });
  });
}

export async function storePendingManagedCloudSettlement(input: { quoteId: string; transactionHash: string }): Promise<void> {
  await withWriteLock(async () => {
    const vault = await readVault();
    await writeVault({
      ...vault,
      pendingSettlement: {
        quoteId: input.quoteId,
        transactionHash: input.transactionHash,
        createdAt: new Date().toISOString(),
      },
    });
  });
}

export async function getPendingManagedCloudSettlement(): Promise<{ quoteId: string; transactionHash: string; createdAt: string } | null> {
  return (await readVault()).pendingSettlement || null;
}

export async function clearPendingManagedCloudSettlement(): Promise<void> {
  await withWriteLock(async () => {
    const vault = await readVault();
    if (!vault.pendingSettlement) return;
    delete vault.pendingSettlement;
    await writeVault(vault);
  });
}

export async function getManagedCloudAccountCredential(): Promise<{ accountId: string; token: string } | null> {
  const record = (await readVault()).official;
  if (!record) return null;
  const key = await ensureKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createSecretKey(toUint8Array(key)),
    decodeBase64Url(record.iv),
  );
  decipher.setAuthTag(decodeBase64Url(record.tag));
  const token = Buffer.from(concatBytes([
    toUint8Array(decipher.update(decodeBase64Url(record.encryptedToken))),
    toUint8Array(decipher.final()),
  ])).toString("utf8");
  return { accountId: record.accountId, token };
}
