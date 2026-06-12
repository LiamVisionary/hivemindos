import "server-only";

import { randomBytes, createCipheriv, createDecipheriv, createHash, createSecretKey } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { AgentWalletVaultInfo } from "@/lib/types/agent-wallet";
import { homedir } from "@/lib/home-dir";

type VaultRecord = AgentWalletVaultInfo & {
  iv: string;
  tag: string;
  encryptedSecret: string;
};

type VaultFile = {
  version: 1;
  records: Record<string, VaultRecord>;
};

const vaultDir = path.join(homedir(), ".hivemindos");
const vaultPath = path.join(vaultDir, "wallet-vault.json");
const keyPath = path.join(vaultDir, "wallet-vault.key");

export const LOCAL_WALLET_VAULT_DIR = vaultDir;
export const LOCAL_WALLET_VAULT_PATH = vaultPath;
export const LOCAL_WALLET_VAULT_KEY_PATH = keyPath;

function publicInfo(record: VaultRecord): AgentWalletVaultInfo {
  return {
    agentId: record.agentId,
    address: record.address,
    network: record.network,
    custodyMode: record.custodyMode,
    createdAt: record.createdAt,
  };
}

async function ensureVaultKey(): Promise<Buffer> {
  const envKey = process.env.HIVEMINDOS_WALLET_VAULT_KEY?.trim();
  if (envKey) return createHash("sha256").update(envKey).digest();
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

async function readVault(): Promise<VaultFile> {
  await fs.mkdir(vaultDir, { recursive: true, mode: 0o700 });
  try {
    const raw = await fs.readFile(vaultPath, "utf8");
    const parsed = JSON.parse(raw) as VaultFile;
    return parsed?.version === 1 && parsed.records ? parsed : { version: 1, records: {} };
  } catch {
    return { version: 1, records: {} };
  }
}

async function writeVault(vault: VaultFile) {
  await fs.mkdir(vaultDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(vaultPath, JSON.stringify(vault, null, 2), { mode: 0o600 });
}

export async function storeWalletSecret(params: {
  agentId: string;
  address: string;
  network: string;
  secret: string;
}): Promise<AgentWalletVaultInfo> {
  const key = await ensureVaultKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createSecretKey(key as unknown as Uint8Array), iv as unknown as Uint8Array);
  const encrypted = (Buffer as any).concat([cipher.update(params.secret, "utf8"), cipher.final()]) as Buffer;
  const tag = cipher.getAuthTag();
  const info: AgentWalletVaultInfo = {
    agentId: params.agentId,
    address: params.address,
    network: params.network,
    custodyMode: "local",
    createdAt: new Date().toISOString(),
  };
  const vault = await readVault();
  vault.records[params.agentId] = {
    ...info,
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    encryptedSecret: encrypted.toString("base64url"),
  };
  await writeVault(vault);
  return info;
}

export async function getWalletInfo(agentId: string): Promise<AgentWalletVaultInfo | null> {
  const vault = await readVault();
  const record = vault.records[agentId];
  if (!record) return null;
  return publicInfo(record);
}

export async function listWalletInfos(options: { agentIdPrefix?: string } = {}): Promise<AgentWalletVaultInfo[]> {
  const vault = await readVault();
  return Object.values(vault.records)
    .filter((record) => !options.agentIdPrefix || record.agentId.startsWith(options.agentIdPrefix))
    .map(publicInfo)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function getWalletSecret(agentId: string): Promise<{ info: AgentWalletVaultInfo; secret: string } | null> {
  const key = await ensureVaultKey();
  const vault = await readVault();
  const record = vault.records[agentId];
  if (!record) return null;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createSecretKey(key as unknown as Uint8Array),
    Buffer.from(record.iv, "base64url") as unknown as Uint8Array,
  );
  decipher.setAuthTag(Buffer.from(record.tag, "base64url") as unknown as Uint8Array);
  const secret = ((Buffer as any).concat([
    decipher.update(Buffer.from(record.encryptedSecret, "base64url") as unknown as Uint8Array),
    decipher.final(),
  ]) as Buffer).toString("utf8");
  return { info: publicInfo(record), secret };
}
