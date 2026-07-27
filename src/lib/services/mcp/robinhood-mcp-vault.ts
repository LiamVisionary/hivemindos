import "server-only";

import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";

import { homedir } from "@/lib/home-dir";
import type { McpToolInfo } from "@/lib/services/mcp/client";

export type RobinhoodMcpPendingOAuth = {
  redirectUri: string;
  state: string;
  codeVerifier?: string;
  authorizationUrl?: string;
  createdAt: string;
};

export type RobinhoodMcpVaultState = {
  redirectUri?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  discoveryState?: OAuthDiscoveryState;
  pending?: RobinhoodMcpPendingOAuth;
  selectedAccountId?: string;
  tools?: McpToolInfo[];
  connectedAt?: string;
  updatedAt?: string;
};

type EncryptedVault = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

const directory = path.join(homedir(), ".hivemindos");
export const ROBINHOOD_MCP_VAULT_PATH = path.join(directory, "robinhood-mcp-vault.json");
const keyPath = path.join(directory, "robinhood-mcp-vault.key");
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

async function ensureKey(): Promise<Buffer> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    return createHash("sha256").update((await fs.readFile(keyPath, "utf8")).trim()).digest();
  } catch {
    const generated = randomBytes(32).toString("base64url");
    await fs.writeFile(keyPath, generated, { mode: 0o600 });
    return createHash("sha256").update(generated).digest();
  }
}

async function readEnvelope(): Promise<EncryptedVault | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(ROBINHOOD_MCP_VAULT_PATH, "utf8")) as Partial<EncryptedVault>;
    if (parsed.version !== 1 || !parsed.iv || !parsed.tag || !parsed.ciphertext) return null;
    return parsed as EncryptedVault;
  } catch {
    return null;
  }
}

export async function readRobinhoodMcpVault(): Promise<RobinhoodMcpVaultState> {
  const envelope = await readEnvelope();
  if (!envelope) return {};
  try {
    const key = await ensureKey();
    const decipher = createDecipheriv("aes-256-gcm", createSecretKey(bytes(key)), bytes(Buffer.from(envelope.iv, "base64url")));
    decipher.setAuthTag(bytes(Buffer.from(envelope.tag, "base64url")));
    const plaintext = Buffer.from(concatBytes([
      bytes(decipher.update(bytes(Buffer.from(envelope.ciphertext, "base64url")))),
      bytes(decipher.final()),
    ])).toString("utf8");
    const parsed = JSON.parse(plaintext) as RobinhoodMcpVaultState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeRobinhoodMcpVault(state: RobinhoodMcpVaultState): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const key = await ensureKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createSecretKey(bytes(key)), bytes(iv));
  const plaintext = JSON.stringify({ ...state, updatedAt: new Date().toISOString() });
  const ciphertext = concatBytes([bytes(cipher.update(plaintext, "utf8")), bytes(cipher.final())]);
  const envelope: EncryptedVault = {
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: Buffer.from(ciphertext).toString("base64url"),
  };
  const temporary = path.join(directory, `robinhood-mcp-vault.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, ROBINHOOD_MCP_VAULT_PATH);
}

export function updateRobinhoodMcpVault(
  update: (current: RobinhoodMcpVaultState) => RobinhoodMcpVaultState | Promise<RobinhoodMcpVaultState>,
): Promise<void> {
  const operation = writeQueue.then(async () => {
    const current = await readRobinhoodMcpVault();
    await writeRobinhoodMcpVault(await update(current));
  }, async () => {
    const current = await readRobinhoodMcpVault();
    await writeRobinhoodMcpVault(await update(current));
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function clearRobinhoodMcpVault(): Promise<void> {
  await updateRobinhoodMcpVault(() => ({}));
}
