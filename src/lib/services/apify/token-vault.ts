import "server-only";

import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { homedir } from "@/lib/home-dir";

type ApifyTokenRecord = {
  agentId: string;
  tokenFingerprint: string;
  iv: string;
  tag: string;
  encryptedToken: string;
  purchasedAmountUsd: number;
  remainingBalanceUsd: number;
  expiresAt: string;
  updatedAt: string;
};

type ApifyTokenVault = {
  version: 1;
  records: Record<string, ApifyTokenRecord>;
};

export type ApifyTokenSummary = Omit<ApifyTokenRecord, "iv" | "tag" | "encryptedToken">;

const directory = path.join(homedir(), ".hivemindos");
export const APIFY_TOKEN_VAULT_PATH = path.join(directory, "apify-x402-token-vault.json");
const keyPath = path.join(directory, "apify-x402-token-vault.key");
let writeQueue = Promise.resolve();

function bytes(value: ArrayLike<number>) {
  const copy = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) copy[index] = value[index] ?? 0;
  return copy;
}

function concatBytes(chunks: Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function recordKey(agentId: string) {
  return createHash("sha256").update(agentId.trim()).digest("hex");
}

async function ensureKey() {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const existing = (await fs.readFile(keyPath, "utf8")).trim();
    if (!existing) throw new Error("The Apify token-vault key file is empty.");
    return createHash("sha256").update(existing).digest();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    const generated = randomBytes(32).toString("base64url");
    try {
      await fs.writeFile(keyPath, generated, { mode: 0o600, flag: "wx" });
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException)?.code === "EEXIST") return ensureKey();
      throw writeError;
    }
    return createHash("sha256").update(generated).digest();
  }
}

async function readVault(): Promise<ApifyTokenVault> {
  let text: string;
  try {
    text = await fs.readFile(APIFY_TOKEN_VAULT_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { version: 1, records: {} };
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as Partial<ApifyTokenVault>;
    if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object" || Array.isArray(parsed.records)) {
      throw new Error("invalid schema");
    }
    return { version: 1, records: parsed.records };
  } catch (error) {
    throw new Error(
      `The encrypted Apify token vault is corrupt at ${APIFY_TOKEN_VAULT_PATH}; refusing to overwrite it. ` +
      `Restore or move the file before retrying. (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function writeVault(vault: ApifyTokenVault) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `apify-x402-token-vault.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(vault, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, APIFY_TOKEN_VAULT_PATH);
}

function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

function summary(record: ApifyTokenRecord): ApifyTokenSummary {
  return {
    agentId: record.agentId,
    tokenFingerprint: record.tokenFingerprint,
    purchasedAmountUsd: record.purchasedAmountUsd,
    remainingBalanceUsd: record.remainingBalanceUsd,
    expiresAt: record.expiresAt,
    updatedAt: record.updatedAt,
  };
}

export async function storeApifyToken(input: {
  agentId: string;
  token: string;
  purchasedAmountUsd: number;
  remainingBalanceUsd: number;
  expiresAt: string;
}) {
  return withWriteLock(async () => {
    const key = await ensureKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", createSecretKey(bytes(key)), bytes(iv));
    const ciphertext = concatBytes([bytes(cipher.update(input.token, "utf8")), bytes(cipher.final())]);
    const vault = await readVault();
    const record: ApifyTokenRecord = {
      agentId: input.agentId.trim(),
      tokenFingerprint: createHash("sha256").update(input.token).digest("hex").slice(0, 12),
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      encryptedToken: Buffer.from(ciphertext).toString("base64url"),
      purchasedAmountUsd: input.purchasedAmountUsd,
      remainingBalanceUsd: input.remainingBalanceUsd,
      expiresAt: input.expiresAt,
      updatedAt: new Date().toISOString(),
    };
    vault.records[recordKey(input.agentId)] = record;
    await writeVault(vault);
    return summary(record);
  });
}

export async function readApifyToken(agentId: string): Promise<{ token: string; summary: ApifyTokenSummary } | null> {
  const record = (await readVault()).records[recordKey(agentId)];
  if (!record || record.agentId !== agentId.trim()) return null;
  try {
    const key = await ensureKey();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createSecretKey(bytes(key)),
      bytes(Buffer.from(record.iv, "base64url")),
    );
    decipher.setAuthTag(bytes(Buffer.from(record.tag, "base64url")));
    const token = Buffer.from(concatBytes([
      bytes(decipher.update(bytes(Buffer.from(record.encryptedToken, "base64url")))),
      bytes(decipher.final()),
    ])).toString("utf8");
    return { token, summary: summary(record) };
  } catch {
    throw new Error("The encrypted Apify token vault could not be decrypted.");
  }
}

export async function updateApifyTokenBalance(agentId: string, remainingBalanceUsd: number, expiresAt?: string) {
  return withWriteLock(async () => {
    const vault = await readVault();
    const key = recordKey(agentId);
    const current = vault.records[key];
    if (!current || current.agentId !== agentId.trim()) return null;
    const next: ApifyTokenRecord = {
      ...current,
      remainingBalanceUsd,
      expiresAt: expiresAt ?? current.expiresAt,
      updatedAt: new Date().toISOString(),
    };
    vault.records[key] = next;
    await writeVault(vault);
    return summary(next);
  });
}
