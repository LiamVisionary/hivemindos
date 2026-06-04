import "server-only";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import {
  LOCAL_WALLET_VAULT_KEY_PATH,
  LOCAL_WALLET_VAULT_PATH,
} from "@/lib/services/wallet/local-wallet-vault";

const execFileAsync = promisify(execFile);
const DEFAULT_SECURE_FOLDER = "Operations/Secure";
const BACKUP_FILE = "hive.wallet-vault.gpg";
const REFERENCE_FILE = "hive.wallet-vault.md";

export type WalletVaultBackupStatus = {
  vaultPath: string;
  keyPath: string;
  vaultExists: boolean;
  keyExists: boolean;
  envKeyConfigured: boolean;
  backupPath: string;
  backupExists: boolean;
  referencePath: string;
  referenceExists: boolean;
  gpgAvailable: boolean;
  recipientConfigured: boolean;
  recordCount: number;
  updatedAt?: string;
  error?: string;
};

type VaultRecordPublic = {
  agentId: string;
  address: string;
  network: string;
  custodyMode: string;
  createdAt: string;
};

type PublicWalletVaultRecord = Pick<VaultRecordPublic, "agentId" | "address" | "network" | "custodyMode" | "createdAt">;

type BackupEnvelope = {
  version: 1;
  kind: "hivemindos-wallet-vault";
  createdAt: string;
  createdBy: string;
  vault: unknown;
  keyMaterial: string;
  keySource: "env" | "file" | "missing";
};

async function fileExists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function secureDir(vaultPath?: string) {
  const configured = process.env.HIVE_WALLET_VAULT_BACKUP_DIR?.trim() || process.env.HIVE_ENV_BACKUP_DIR?.trim();
  if (configured) return configured.replace(/^~(?=$|\/)/, process.env.HOME || "");
  const root = resolveObsidianVaultPath(vaultPath, { requireWritable: true });
  const folder = process.env.HIVE_NOTE_SECURE_FOLDER?.trim() || DEFAULT_SECURE_FOLDER;
  return join(root, folder);
}

async function gpgAvailable() {
  try {
    await execFileAsync("gpg", ["--version"], { timeout: 5_000, maxBuffer: 64_000 });
    return true;
  } catch {
    return false;
  }
}

async function importPublicKey(path: string) {
  const show = await execFileAsync("gpg", ["--with-colons", "--import-options", "show-only", "--import", path], {
    timeout: 10_000,
    maxBuffer: 1_000_000,
  }).catch(() => null);
  if (!show) return "";
  const fingerprint = show.stdout
    .split(/\r?\n/)
    .map((line) => line.split(":"))
    .find((parts) => parts[0] === "fpr" && parts[9])?.[9] ?? "";
  if (fingerprint) {
    await execFileAsync("gpg", ["--import", path], { timeout: 10_000, maxBuffer: 1_000_000 }).catch(() => null);
  }
  return fingerprint;
}

async function backupRecipient(directory: string) {
  const explicit = process.env.HIVE_WALLET_GPG_RECIPIENT?.trim() || process.env.HIVE_ENV_GPG_RECIPIENT?.trim();
  if (explicit) return explicit;
  const candidates = [
    process.env.HIVE_WALLET_PUBLIC_KEY?.trim(),
    process.env.HIVE_ENV_PUBLIC_KEY?.trim(),
    join(directory, "hive-wallet-public-key.asc"),
    join(directory, "hive-env-public-key.asc"),
    join(directory, "liam-hermes-env-public-key.asc"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (!(await fileExists(candidate))) continue;
    const fingerprint = await importPublicKey(candidate);
    if (fingerprint) return fingerprint;
  }
  return "";
}

async function publicRecords() {
  const raw = await readFile(LOCAL_WALLET_VAULT_PATH, "utf8").catch(() => "");
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw) as { records?: Record<string, VaultRecordPublic> };
  return Object.values(parsed.records ?? {}).map((record): PublicWalletVaultRecord => ({
    agentId: record.agentId,
    address: record.address,
    network: record.network,
    custodyMode: record.custodyMode,
    createdAt: record.createdAt,
  }));
}

async function readUpdatedAt(path: string) {
  const stats = await stat(path).catch(() => null);
  return stats ? stats.mtime.toISOString() : undefined;
}

export async function getWalletVaultBackupStatus(vaultPath?: string): Promise<WalletVaultBackupStatus> {
  const directory = secureDir(vaultPath);
  const backupPath = join(directory, BACKUP_FILE);
  const referencePath = join(directory, REFERENCE_FILE);
  const [vaultExists, keyExists, backupExists, referenceExists, gpg, records, updatedAt, recipient] = await Promise.all([
    fileExists(LOCAL_WALLET_VAULT_PATH),
    fileExists(LOCAL_WALLET_VAULT_KEY_PATH),
    fileExists(backupPath),
    fileExists(referencePath),
    gpgAvailable(),
    publicRecords().catch(() => []),
    readUpdatedAt(backupPath),
    backupRecipient(directory).catch(() => ""),
  ]);
  return {
    vaultPath: LOCAL_WALLET_VAULT_PATH,
    keyPath: LOCAL_WALLET_VAULT_KEY_PATH,
    vaultExists,
    keyExists,
    envKeyConfigured: Boolean(process.env.HIVEMINDOS_WALLET_VAULT_KEY?.trim()),
    backupPath,
    backupExists,
    referencePath,
    referenceExists,
    gpgAvailable: gpg,
    recipientConfigured: Boolean(recipient),
    recordCount: records.length,
    updatedAt,
  };
}

function renderReference(records: PublicWalletVaultRecord[], status: WalletVaultBackupStatus) {
  const lines = [
    "# HivemindOS Encrypted Wallet Vault",
    "",
    "This note is reference metadata only. The wallet secrets are stored in the adjacent GPG file.",
    "",
    `- **Encrypted vault**: \`${status.backupPath}\``,
    `- **Local vault path**: \`${status.vaultPath}\``,
    `- **Local key path**: \`${status.keyPath}\``,
    `- **Last refreshed**: ${new Date().toISOString()}`,
    `- **Refreshed from**: \`${hostname()}\``,
    `- **Wallet records**: ${records.length}`,
    "",
    "## Records",
    "",
    ...records.flatMap((record) => [
      `- \`${record.agentId}\``,
      `  - Address: \`${record.address}\``,
      `  - Network: ${record.network}`,
      `  - Custody: ${record.custodyMode}`,
      `  - Created: ${record.createdAt}`,
    ]),
    records.length ? "" : "_No local wallet records found yet._",
  ];
  return `${lines.join("\n")}\n`;
}

export async function refreshWalletVaultBackup(vaultPath?: string) {
  const directory = secureDir(vaultPath);
  await mkdir(directory, { recursive: true });
  const recipient = await backupRecipient(directory);
  if (!recipient) throw new Error(`No HIVE_WALLET_GPG_RECIPIENT, HIVE_ENV_GPG_RECIPIENT, or public key found in ${directory}.`);
  if (!(await gpgAvailable())) throw new Error("gpg is not installed; cannot encrypt wallet vault backup.");
  if (!(await fileExists(LOCAL_WALLET_VAULT_PATH))) throw new Error("No local wallet vault exists yet.");

  const vault = JSON.parse(await readFile(LOCAL_WALLET_VAULT_PATH, "utf8")) as unknown;
  const envKey = process.env.HIVEMINDOS_WALLET_VAULT_KEY?.trim();
  const fileKey = await readFile(LOCAL_WALLET_VAULT_KEY_PATH, "utf8").catch(() => "");
  const envelope: BackupEnvelope = {
    version: 1,
    kind: "hivemindos-wallet-vault",
    createdAt: new Date().toISOString(),
    createdBy: hostname(),
    vault,
    keyMaterial: envKey || fileKey.trim(),
    keySource: envKey ? "env" : fileKey.trim() ? "file" : "missing",
  };
  if (!envelope.keyMaterial) {
    throw new Error("Wallet vault key material is missing; cannot create a restorable backup.");
  }

  const tmpPlain = join(directory, `.wallet-vault-${randomUUID()}.json`);
  const tmpEncrypted = join(directory, `.wallet-vault-${randomUUID()}.gpg`);
  const backupPath = join(directory, BACKUP_FILE);
  try {
    await writeFile(tmpPlain, JSON.stringify(envelope, null, 2), { mode: 0o600 });
    await execFileAsync("gpg", [
      "--batch",
      "--yes",
      "--trust-model",
      "always",
      "--encrypt",
      "--recipient",
      recipient,
      "--output",
      tmpEncrypted,
      tmpPlain,
    ], { timeout: 30_000, maxBuffer: 1_000_000 });
    await rename(tmpEncrypted, backupPath);
    const status = await getWalletVaultBackupStatus(vaultPath);
    const records = await publicRecords().catch(() => []);
    await writeFile(join(directory, REFERENCE_FILE), renderReference(records, status), "utf8");
    return getWalletVaultBackupStatus(vaultPath);
  } finally {
    await unlink(tmpPlain).catch(() => undefined);
    await unlink(tmpEncrypted).catch(() => undefined);
  }
}

export async function restoreWalletVaultBackup(vaultPath?: string) {
  const directory = secureDir(vaultPath);
  const backupPath = join(directory, BACKUP_FILE);
  if (!(await fileExists(backupPath))) throw new Error(`Encrypted wallet vault backup not found: ${backupPath}`);
  if (!(await gpgAvailable())) throw new Error("gpg is not installed; cannot decrypt wallet vault backup.");

  const decrypted = await execFileAsync("gpg", ["--decrypt", backupPath], {
    timeout: 60_000,
    maxBuffer: 20_000_000,
  }).catch((error: Error & { stderr?: string; stdout?: string }) => {
    throw new Error(error.stderr?.trim() || error.stdout?.trim() || "Could not decrypt wallet vault backup.");
  });
  const envelope = JSON.parse(decrypted.stdout) as Partial<BackupEnvelope>;
  if (envelope.version !== 1 || envelope.kind !== "hivemindos-wallet-vault" || !envelope.vault || !envelope.keyMaterial) {
    throw new Error("Encrypted wallet vault backup has an unsupported format.");
  }

  await mkdir(dirname(LOCAL_WALLET_VAULT_PATH), { recursive: true, mode: 0o700 });
  await writeFile(LOCAL_WALLET_VAULT_PATH, JSON.stringify(envelope.vault, null, 2), { mode: 0o600 });
  await writeFile(LOCAL_WALLET_VAULT_KEY_PATH, envelope.keyMaterial, { mode: 0o600 });
  return getWalletVaultBackupStatus(vaultPath);
}
