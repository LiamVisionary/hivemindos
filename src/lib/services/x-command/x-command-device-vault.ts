import "server-only";

import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { homedir } from "@/lib/home-dir";

export type XCommandDeviceCredential = {
  id: string;
  name: string;
  token: string;
  pairedAt: string;
};

type StoredVault = {
  version: 1;
  record: null | {
    id: string;
    name: string;
    pairedAt: string;
    iv: string;
    tag: string;
    encryptedToken: string;
  };
};

const vaultDir = path.join(homedir(), ".hivemindos");
const vaultPath = path.join(vaultDir, "x-command-device-vault.json");
const keyPath = path.join(vaultDir, "x-command-device-vault.key");
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

async function key(): Promise<Buffer> {
  await fs.mkdir(vaultDir, { recursive: true, mode: 0o700 });
  try {
    return createHash("sha256").update((await fs.readFile(keyPath, "utf8")).trim()).digest();
  } catch {
    const generated = randomBytes(32).toString("base64url");
    await fs.writeFile(keyPath, generated, { mode: 0o600 });
    return createHash("sha256").update(generated).digest();
  }
}

async function readVault(): Promise<StoredVault> {
  try {
    const parsed = JSON.parse(await fs.readFile(vaultPath, "utf8")) as StoredVault;
    if (parsed.version === 1 && (parsed.record === null || typeof parsed.record === "object")) return parsed;
  } catch {
    // Missing or corrupt local pairing is treated as unpaired; the hosted
    // device can still be revoked from another authenticated HivemindOS client.
  }
  return { version: 1, record: null };
}

async function writeVault(vault: StoredVault): Promise<void> {
  await fs.mkdir(vaultDir, { recursive: true, mode: 0o700 });
  const temporary = path.join(vaultDir, `x-command-device-vault.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(vault, null, 2), { mode: 0o600 });
  await fs.rename(temporary, vaultPath);
}

function locked<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

export async function storeXCommandDevice(credential: XCommandDeviceCredential): Promise<void> {
  return locked(async () => {
    const secret = await key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", createSecretKey(bytes(secret)), bytes(iv));
    const encrypted = concatBytes([bytes(cipher.update(credential.token, "utf8")), bytes(cipher.final())]);
    await writeVault({
      version: 1,
      record: {
        id: credential.id,
        name: credential.name,
        pairedAt: credential.pairedAt,
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        encryptedToken: Buffer.from(encrypted).toString("base64url"),
      },
    });
  });
}

export async function readXCommandDevice(): Promise<XCommandDeviceCredential | null> {
  const stored = (await readVault()).record;
  if (!stored) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createSecretKey(bytes(await key())),
      bytes(Buffer.from(stored.iv, "base64url")),
    );
    decipher.setAuthTag(bytes(Buffer.from(stored.tag, "base64url")));
    const token = Buffer.from(concatBytes([
      bytes(decipher.update(bytes(Buffer.from(stored.encryptedToken, "base64url")))),
      bytes(decipher.final()),
    ])).toString("utf8");
    return { id: stored.id, name: stored.name, pairedAt: stored.pairedAt, token };
  } catch {
    return null;
  }
}

export async function clearXCommandDevice(): Promise<void> {
  return locked(() => writeVault({ version: 1, record: null }));
}
