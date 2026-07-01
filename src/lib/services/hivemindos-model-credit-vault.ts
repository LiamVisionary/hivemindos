import "server-only";

import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { homedir } from "@/lib/home-dir";

type CreditTokenRecord = {
  walletAgentId: string;
  slug: string;
  iv: string;
  tag: string;
  encryptedToken: string;
  updatedAt: string;
};

type CreditTokenVault = {
  version: 1;
  records: Record<string, CreditTokenRecord>;
};

const vaultDir = path.join(homedir(), ".hivemindos");
const vaultPath = path.join(vaultDir, "hivemindos-model-credit-vault.json");
const keyPath = path.join(vaultDir, "hivemindos-model-credit-vault.key");

let writeQueue = Promise.resolve();

function recordKey(walletAgentId: string, slug: string) {
  return `${walletAgentId.trim()}::${slug.trim().toLowerCase() || "default"}`;
}

function toUint8Array(value: ArrayLike<number>) {
  const copy = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    copy[index] = value[index] ?? 0;
  }
  return copy;
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlDecode(value: string) {
  return toUint8Array(Buffer.from(value, "base64url"));
}

async function ensureKey(): Promise<Buffer> {
  await fs.mkdir(vaultDir, { recursive: true, mode: 0o700 });
  try {
    const existing = await fs.readFile(keyPath, "utf8");
    return createHash("sha256").update(existing.trim()).digest();
  } catch {
    const generated = randomBytes(32).toString("base64url");
    await fs.writeFile(keyPath, generated, { mode: 0o600 });
    return createHash("sha256").update(generated).digest();
  }
}

async function readVault(): Promise<CreditTokenVault> {
  await fs.mkdir(vaultDir, { recursive: true, mode: 0o700 });
  try {
    const parsed = JSON.parse(await fs.readFile(vaultPath, "utf8")) as Partial<CreditTokenVault>;
    if (parsed.version === 1 && parsed.records && typeof parsed.records === "object") {
      return { version: 1, records: parsed.records };
    }
  } catch {
    /* empty vault */
  }
  return { version: 1, records: {} };
}

async function writeVault(vault: CreditTokenVault) {
  await fs.mkdir(vaultDir, { recursive: true, mode: 0o700 });
  const tempPath = path.join(vaultDir, `hivemindos-model-credit-vault.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, JSON.stringify(vault, null, 2), { mode: 0o600 });
  await fs.rename(tempPath, vaultPath);
}

function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

export async function storeHivemindosModelCreditToken(input: {
  walletAgentId: string;
  slug: string;
  token: string;
}) {
  return withWriteLock(async () => {
    const key = await ensureKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", createSecretKey(toUint8Array(key)), toUint8Array(iv));
    const encrypted = concatBytes([
      toUint8Array(cipher.update(input.token, "utf8")),
      toUint8Array(cipher.final()),
    ]);
    const vault = await readVault();
    vault.records[recordKey(input.walletAgentId, input.slug)] = {
      walletAgentId: input.walletAgentId,
      slug: input.slug,
      iv: base64UrlEncode(toUint8Array(iv)),
      tag: base64UrlEncode(toUint8Array(cipher.getAuthTag())),
      encryptedToken: base64UrlEncode(encrypted),
      updatedAt: new Date().toISOString(),
    };
    await writeVault(vault);
  });
}

export async function getHivemindosModelCreditToken(walletAgentId: string, slug: string): Promise<string> {
  const key = await ensureKey();
  const vault = await readVault();
  const record = vault.records[recordKey(walletAgentId, slug)];
  if (!record) return "";
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createSecretKey(toUint8Array(key)),
    base64UrlDecode(record.iv),
  );
  decipher.setAuthTag(base64UrlDecode(record.tag));
  return Buffer.from(concatBytes([
    toUint8Array(decipher.update(base64UrlDecode(record.encryptedToken))),
    toUint8Array(decipher.final()),
  ])).toString("utf8");
}
