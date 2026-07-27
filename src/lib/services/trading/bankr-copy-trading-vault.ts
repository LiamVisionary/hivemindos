import "server-only";

import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { homedir } from "@/lib/home-dir";
import type { BankrCopySubscription } from "./bankr-copy-trading-contract";

type VaultRecord = {
  subscription: BankrCopySubscription;
  iv: string;
  tag: string;
  encryptedAccessToken: string;
  updatedAt: string;
};

type RecoveryRecord = {
  iv: string;
  tag: string;
  encryptedRecoveryToken: string;
  updatedAt: string;
};

type VaultFile = {
  version: 1;
  records: Record<string, VaultRecord>;
  recoveries: Record<string, RecoveryRecord>;
};

export const BANKR_COPY_TRADING_VAULT_PATH = path.join(homedir(), ".hivemindos", "bankr-copy-trading-vault.json");
const keyPath = path.join(homedir(), ".hivemindos", "bankr-copy-trading-vault.key");
let writeQueue = Promise.resolve();

function bytes(value: ArrayLike<number>): Uint8Array {
  return Uint8Array.from(value);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function key(): Promise<Buffer> {
  await fs.mkdir(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  try {
    return createHash("sha256").update((await fs.readFile(keyPath, "utf8")).trim()).digest();
  } catch {
    const generated = randomBytes(32).toString("base64url");
    await fs.writeFile(keyPath, generated, { mode: 0o600 });
    return createHash("sha256").update(generated).digest();
  }
}

async function readVault(): Promise<VaultFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(BANKR_COPY_TRADING_VAULT_PATH, "utf8")) as Partial<VaultFile>;
    return parsed.version === 1 && parsed.records && typeof parsed.records === "object"
      ? {
        version: 1,
        records: parsed.records,
        recoveries: parsed.recoveries && typeof parsed.recoveries === "object" ? parsed.recoveries : {},
      }
      : { version: 1, records: {}, recoveries: {} };
  } catch {
    return { version: 1, records: {}, recoveries: {} };
  }
}

async function writeVault(vault: VaultFile): Promise<void> {
  const directory = path.dirname(BANKR_COPY_TRADING_VAULT_PATH);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `bankr-copy-trading-vault.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(vault, null, 2), { mode: 0o600 });
  await fs.rename(temporary, BANKR_COPY_TRADING_VAULT_PATH);
}

function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

export async function storeBankrCopyCredential(input: { subscription: BankrCopySubscription; accessToken: string }): Promise<void> {
  await withWriteLock(async () => {
    const encrypted = await encryptValue(input.accessToken);
    const vault = await readVault();
    vault.records[input.subscription.id] = {
      subscription: input.subscription,
      iv: encrypted.iv,
      tag: encrypted.tag,
      encryptedAccessToken: encrypted.encryptedValue,
      updatedAt: new Date().toISOString(),
    };
    await writeVault(vault);
  });
}

export async function listBankrCopyCredentials(): Promise<Array<{ subscription: BankrCopySubscription; accessToken: string }>> {
  const vault = await readVault();
  return Promise.all(Object.values(vault.records).map(async (record) => ({
    subscription: record.subscription,
    accessToken: await decryptValue(record.iv, record.tag, record.encryptedAccessToken),
  })));
}

export async function getBankrCopyCredential(subscriptionId: string): Promise<{ subscription: BankrCopySubscription; accessToken: string } | null> {
  return (await listBankrCopyCredentials()).find((record) => record.subscription.id === subscriptionId) || null;
}

export async function removeBankrCopyCredential(subscriptionId: string): Promise<void> {
  await withWriteLock(async () => {
    const vault = await readVault();
    if (!vault.records[subscriptionId]) return;
    delete vault.records[subscriptionId];
    await writeVault(vault);
  });
}

export async function storeBankrCopyRecovery(input: { receiptId: string; recoveryToken: string }): Promise<void> {
  await withWriteLock(async () => {
    const encrypted = await encryptValue(input.recoveryToken);
    const vault = await readVault();
    vault.recoveries[input.receiptId] = {
      iv: encrypted.iv,
      tag: encrypted.tag,
      encryptedRecoveryToken: encrypted.encryptedValue,
      updatedAt: new Date().toISOString(),
    };
    await writeVault(vault);
  });
}

export async function listBankrCopyRecoveries(): Promise<Array<{ receiptId: string; recoveryToken: string }>> {
  const vault = await readVault();
  return Promise.all(Object.entries(vault.recoveries).map(async ([receiptId, record]) => ({
    receiptId,
    recoveryToken: await decryptValue(record.iv, record.tag, record.encryptedRecoveryToken),
  })));
}

export async function removeBankrCopyRecovery(receiptId: string): Promise<void> {
  await withWriteLock(async () => {
    const vault = await readVault();
    if (!vault.recoveries[receiptId]) return;
    delete vault.recoveries[receiptId];
    await writeVault(vault);
  });
}

async function encryptValue(value: string): Promise<{ iv: string; tag: string; encryptedValue: string }> {
  const encryptionKey = await key();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createSecretKey(bytes(encryptionKey)), bytes(iv));
  const encrypted = concatBytes([bytes(cipher.update(value, "utf8")), bytes(cipher.final())]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    encryptedValue: Buffer.from(encrypted).toString("base64url"),
  };
}

async function decryptValue(iv: string, tag: string, encryptedValue: string): Promise<string> {
  const encryptionKey = await key();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createSecretKey(bytes(encryptionKey)),
    bytes(Buffer.from(iv, "base64url")),
  );
  decipher.setAuthTag(bytes(Buffer.from(tag, "base64url")));
  return Buffer.from(concatBytes([
    bytes(decipher.update(bytes(Buffer.from(encryptedValue, "base64url")))),
    bytes(decipher.final()),
  ])).toString("utf8");
}
