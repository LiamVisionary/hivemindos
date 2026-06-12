import "server-only";

import { randomBytes } from "node:crypto";
import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes, createSignableMessage } from "@solana/kit";
import { privateKeyToAccount } from "viem/accounts";
import { homedir } from "@/lib/home-dir";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import type { AgentProfile, VeniceAgentConfig } from "@/lib/types/agent-runtime";

export const VENICE_API_BASE = "https://api.venice.ai/api/v1";
export const VENICE_DEFAULT_KEY_ENV = "VENICE_API_KEY";
export const VENICE_FUNDING_URL = "https://venice.ai/settings/api";
export const VENICE_WALLET_VAULT_PREFIX = "venice:";

const VENICE_DOMAIN = "api.venice.ai";
const VENICE_SIWX_STATEMENT = "Sign in to Venice AI";
const VENICE_SIWX_EXPIRY_MS = 5 * 60 * 1000;
const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const HERMES_ENV_FILE = join(homedir(), ".hermes", ".env");

export type VeniceAuthMode = "x402" | "api-key";
export type VeniceCheckStatus = "ready" | "missing-wallet" | "missing-key" | "needs-funding" | "provider-unavailable" | "error";

export type VeniceModel = {
  id: string;
  name?: string;
};

export type VeniceWalletBinding = {
  vaultId: string;
  address: string;
  network: string;
  secret: string;
};

export type VeniceRuntimeConfig = {
  authMode: VeniceAuthMode;
  baseUrl: string;
  chatPath: string;
  statusPath: string;
  headers: Record<string, string>;
  walletAddress: string;
  walletNetwork: string;
  apiKeyEnvName: string;
};

export type VeniceBalance = {
  canConsume: boolean;
  balanceUsd: string;
  diemBalanceUsd: string;
  minimumTopUpUsd: string;
  suggestedTopUpUsd: string;
};

export type VeniceCheckResult = {
  ok: boolean;
  status: VeniceCheckStatus;
  message: string;
  authMode: VeniceAuthMode;
  walletVaultId: string;
  walletAddress: string;
  walletNetwork: string;
  apiKeyEnvName: string;
  keyPresent: boolean;
  balanceUsd: string;
  diemBalanceUsd: string;
  minimumTopUpUsd: string;
  suggestedTopUpUsd: string;
  modelCount: number;
  models: VeniceModel[];
  checkedAt: string;
  httpStatus?: number;
};

export type VeniceTopUpResult = {
  ok: boolean;
  message: string;
  paidUsd: number;
  network: string;
  balanceUsd: string;
  httpStatus?: number;
};

function parseEnvFileValue(raw: string, key: string) {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.*)\\s*$`, "m");
  const match = raw.match(pattern);
  if (!match) return "";
  const value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

async function readSharedEnvValue(key: string) {
  const existing = process.env[key]?.trim();
  if (existing) return existing;
  for (const path of [HIVE_ENV_FILE, HERMES_ENV_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    const value = parseEnvFileValue(raw, key);
    if (value) return value;
  }
  return "";
}

export function isVeniceProfile(profile: Pick<AgentProfile, "provider">) {
  return profile.provider?.trim().toLowerCase() === "venice";
}

export function isEvmWalletNetwork(network = "") {
  return network.startsWith("eip155:");
}

export function isSolanaWalletNetwork(network = "") {
  return network.startsWith("solana:");
}

export function veniceAuthMode(config?: VeniceAgentConfig): VeniceAuthMode {
  if (config?.authMode === "api-key") return "api-key";
  if (config?.authMode === "x402") return "x402";
  return config?.walletVaultId ? "x402" : "api-key";
}

export function veniceApiKeyEnvName(config?: VeniceAgentConfig) {
  return config?.apiKeyEnvName?.trim() || VENICE_DEFAULT_KEY_ENV;
}

function siwxNonce() {
  return randomBytes(12).toString("hex").slice(0, 16);
}

// EIP-4361 / Sign-In-With-X message body, matching veniceai/x402-client's
// SiweMessage.prepareMessage() output so the Venice verifier accepts it.
function siwxMessage(params: {
  accountKind: "Ethereum" | "Solana";
  address: string;
  uri: string;
  chainId: string | number;
  issuedAt: string;
  expirationTime: string;
  nonce: string;
}) {
  return [
    `${VENICE_DOMAIN} wants you to sign in with your ${params.accountKind} account:`,
    params.address,
    "",
    VENICE_SIWX_STATEMENT,
    "",
    `URI: ${params.uri}`,
    "Version: 1",
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expiration Time: ${params.expirationTime}`,
  ].join("\n");
}

export async function buildVeniceSiwxHeader(wallet: Pick<VeniceWalletBinding, "address" | "network" | "secret">, resourceUrl = VENICE_API_BASE) {
  const now = new Date();
  const issuedAt = now.toISOString();
  const expirationTime = new Date(now.getTime() + VENICE_SIWX_EXPIRY_MS).toISOString();
  const nonce = siwxNonce();
  if (isEvmWalletNetwork(wallet.network)) {
    const account = privateKeyToAccount(wallet.secret as `0x${string}`);
    const message = siwxMessage({
      accountKind: "Ethereum",
      address: account.address,
      uri: resourceUrl,
      chainId: 8453,
      issuedAt,
      expirationTime,
      nonce,
    });
    const signature = await account.signMessage({ message });
    return Buffer.from(JSON.stringify({
      address: account.address,
      message,
      signature,
      timestamp: now.getTime(),
      chainId: 8453,
    }), "utf8").toString("base64");
  }
  if (isSolanaWalletNetwork(wallet.network)) {
    const signer = await createKeyPairSignerFromBytes(base58.decode(wallet.secret));
    const message = siwxMessage({
      accountKind: "Solana",
      address: signer.address,
      uri: resourceUrl,
      chainId: SOLANA_MAINNET_CAIP2,
      issuedAt,
      expirationTime,
      nonce,
    });
    const [signatures] = await signer.signMessages([createSignableMessage(new TextEncoder().encode(message))]);
    const signatureBytes = signatures[signer.address];
    if (!signatureBytes) throw new Error("Solana wallet did not return a Sign-In-With-X signature.");
    return Buffer.from(JSON.stringify({
      address: signer.address,
      message,
      signature: base58.encode(new Uint8Array(signatureBytes)),
      timestamp: now.getTime(),
      chainId: SOLANA_MAINNET_CAIP2,
      type: "ed25519",
    }), "utf8").toString("base64");
  }
  throw new Error(`Venice x402 supports Base and Solana wallets; got network "${wallet.network}".`);
}

export async function resolveVeniceWalletBinding(config?: VeniceAgentConfig): Promise<VeniceWalletBinding> {
  const vaultId = config?.walletVaultId?.trim();
  if (!vaultId) throw new Error("Connect a wallet in Venice setup before using x402 authentication.");
  const record = await getWalletSecret(vaultId);
  if (!record) throw new Error(`No local wallet found for "${vaultId}". Re-run Venice setup to connect a wallet.`);
  return {
    vaultId,
    address: record.info.address,
    network: record.info.network,
    secret: record.secret,
  };
}

export async function buildVeniceAuthHeaders(profile: AgentProfile, resourceUrl?: string): Promise<{ headers: Record<string, string>; mode: VeniceAuthMode; wallet?: VeniceWalletBinding }> {
  const mode = veniceAuthMode(profile.venice);
  if (mode === "api-key") {
    const envName = veniceApiKeyEnvName(profile.venice);
    const key = profile.token?.trim() || await readSharedEnvValue(envName);
    if (!key) {
      throw new Error(`${envName} is required before this Venice agent can run inference. Save an API key in Venice setup, or connect a wallet for x402.`);
    }
    return { mode, headers: { Authorization: `Bearer ${key}` } };
  }
  const wallet = await resolveVeniceWalletBinding(profile.venice);
  const header = await buildVeniceSiwxHeader(wallet, resourceUrl ?? `${VENICE_API_BASE}/chat/completions`);
  return { mode, wallet, headers: { "X-Sign-In-With-X": header } };
}

export async function resolveVeniceRuntimeConfig(profile: AgentProfile): Promise<VeniceRuntimeConfig | null> {
  if (!isVeniceProfile(profile)) return null;
  const auth = await buildVeniceAuthHeaders(profile, `${VENICE_API_BASE}/chat/completions`);
  return {
    authMode: auth.mode,
    baseUrl: VENICE_API_BASE,
    chatPath: "/chat/completions",
    statusPath: "/models",
    headers: auth.headers,
    walletAddress: auth.wallet?.address ?? profile.venice?.walletAddress ?? "",
    walletNetwork: auth.wallet?.network ?? profile.venice?.walletNetwork ?? "",
    apiKeyEnvName: veniceApiKeyEnvName(profile.venice),
  };
}

export function summarizeVeniceResponseHeaders(headers: Headers) {
  const balanceRemaining = headers.get("X-Balance-Remaining") ?? headers.get("x-balance-remaining") ?? "";
  if (!balanceRemaining) return null;
  return { balanceRemaining };
}

function formatUsd(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(numeric)) return "";
  return numeric.toFixed(2);
}

function extractErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
  if (record.error && typeof record.error === "object") {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim()) return nested.message.trim();
  }
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  return fallback;
}

export async function checkVeniceWalletBalance(wallet: Pick<VeniceWalletBinding, "address" | "network" | "secret">): Promise<VeniceBalance> {
  const resourceUrl = `${VENICE_API_BASE}/x402/balance/${wallet.address}`;
  const header = await buildVeniceSiwxHeader(wallet, resourceUrl);
  const response = await fetch(resourceUrl, {
    method: "GET",
    headers: { "X-Sign-In-With-X": header },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => "") })) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, `Venice balance check returned HTTP ${response.status}.`));
  }
  // Live responses wrap the balance in { success, data: {...} }.
  const body = (data.data && typeof data.data === "object" ? data.data : data) as Record<string, unknown>;
  return {
    canConsume: Boolean(body.canConsume),
    balanceUsd: formatUsd(body.balanceUsd),
    diemBalanceUsd: formatUsd(body.diemBalanceUsd),
    minimumTopUpUsd: formatUsd(body.minimumTopUpUsd),
    suggestedTopUpUsd: formatUsd(body.suggestedTopUpUsd),
  };
}

function extractVeniceModels(data: unknown): VeniceModel[] {
  if (!data || typeof data !== "object") return [];
  const items = Array.isArray((data as Record<string, unknown>).data) ? (data as { data: unknown[] }).data : [];
  const models: VeniceModel[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id) continue;
    // Venice's /models returns text, image, audio, and embedding models; the
    // chat agent picker only wants text models when the type is present.
    const type = typeof source.type === "string" ? source.type : "";
    if (type && type !== "text") continue;
    models.push({ id });
  }
  return models;
}

function categorizeVeniceError(status: number, detail: string): VeniceCheckStatus {
  const text = detail.toLowerCase();
  if (status === 401 || status === 403) return "missing-key";
  if (status === 402 || text.includes("balance") || text.includes("fund") || text.includes("top up") || text.includes("top-up")) return "needs-funding";
  if (status >= 500) return "provider-unavailable";
  return "error";
}

function baseCheckResult(profile: AgentProfile): Omit<VeniceCheckResult, "ok" | "status" | "message"> {
  const config = profile.venice;
  return {
    authMode: veniceAuthMode(config),
    walletVaultId: config?.walletVaultId ?? "",
    walletAddress: config?.walletAddress ?? "",
    walletNetwork: config?.walletNetwork ?? "",
    apiKeyEnvName: veniceApiKeyEnvName(config),
    keyPresent: false,
    balanceUsd: config?.lastBalanceUsd ?? "",
    diemBalanceUsd: config?.lastDiemBalanceUsd ?? "",
    minimumTopUpUsd: config?.lastMinimumTopUpUsd ?? "",
    suggestedTopUpUsd: config?.lastSuggestedTopUpUsd ?? "",
    modelCount: 0,
    models: [],
    checkedAt: new Date().toISOString(),
  };
}

export async function checkVeniceModels(profile: AgentProfile): Promise<VeniceCheckResult> {
  const base = baseCheckResult(profile);
  const mode = veniceAuthMode(profile.venice);
  let auth: Awaited<ReturnType<typeof buildVeniceAuthHeaders>>;
  try {
    auth = await buildVeniceAuthHeaders(profile, `${VENICE_API_BASE}/models`);
  } catch (error) {
    return {
      ...base,
      ok: false,
      status: mode === "api-key" ? "missing-key" : "missing-wallet",
      message: error instanceof Error ? error.message : "Venice authentication is not configured.",
    };
  }

  let balance: VeniceBalance | null = null;
  if (auth.wallet) {
    balance = await checkVeniceWalletBalance(auth.wallet).catch(() => null);
  }
  const balanceFields = balance ? {
    balanceUsd: balance.balanceUsd,
    diemBalanceUsd: balance.diemBalanceUsd,
    minimumTopUpUsd: balance.minimumTopUpUsd,
    suggestedTopUpUsd: balance.suggestedTopUpUsd,
  } : {};

  let response: Response;
  try {
    response = await fetch(`${VENICE_API_BASE}/models`, {
      method: "GET",
      headers: auth.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      ...base,
      ...balanceFields,
      keyPresent: true,
      walletAddress: auth.wallet?.address ?? base.walletAddress,
      walletNetwork: auth.wallet?.network ?? base.walletNetwork,
      ok: false,
      status: "provider-unavailable",
      message: error instanceof Error && error.name === "TimeoutError"
        ? "Venice did not answer the model check in time. Try again in a moment."
        : "HivemindOS could not reach Venice for the model check. Try again in a moment.",
    };
  }
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => "") })) as unknown;
  if (!response.ok) {
    const detail = extractErrorMessage(data, `Venice returned HTTP ${response.status}.`);
    return {
      ...base,
      ...balanceFields,
      keyPresent: true,
      walletAddress: auth.wallet?.address ?? base.walletAddress,
      walletNetwork: auth.wallet?.network ?? base.walletNetwork,
      ok: false,
      status: categorizeVeniceError(response.status, detail),
      message: detail,
      httpStatus: response.status,
    };
  }
  const models = extractVeniceModels(data);
  if (!models.length) {
    return {
      ...base,
      ...balanceFields,
      keyPresent: true,
      walletAddress: auth.wallet?.address ?? base.walletAddress,
      walletNetwork: auth.wallet?.network ?? base.walletNetwork,
      ok: false,
      status: "provider-unavailable",
      message: "Venice is reachable, but no text models were returned.",
      httpStatus: response.status,
    };
  }
  if (balance && !balance.canConsume) {
    return {
      ...base,
      ...balanceFields,
      keyPresent: true,
      walletAddress: auth.wallet?.address ?? base.walletAddress,
      walletNetwork: auth.wallet?.network ?? base.walletNetwork,
      ok: false,
      status: "needs-funding",
      message: balance.minimumTopUpUsd
        ? `This wallet needs a Venice top-up before inference (minimum $${balance.minimumTopUpUsd}).`
        : "This wallet needs a Venice top-up before inference.",
      modelCount: models.length,
      models,
      httpStatus: response.status,
    };
  }
  return {
    ...base,
    ...balanceFields,
    keyPresent: true,
    walletAddress: auth.wallet?.address ?? base.walletAddress,
    walletNetwork: auth.wallet?.network ?? base.walletNetwork,
    ok: true,
    status: "ready",
    message: `Venice returned ${models.length} text model${models.length === 1 ? "" : "s"}.`,
    modelCount: models.length,
    models,
    httpStatus: response.status,
  };
}

export async function testVeniceChat(profile: AgentProfile, model: string): Promise<VeniceCheckResult> {
  const base = baseCheckResult(profile);
  const selectedModel = model.trim() || profile.model?.trim();
  if (!selectedModel) {
    return { ...base, ok: false, status: "error", message: "Choose a Venice model before running a chat test." };
  }
  let auth: Awaited<ReturnType<typeof buildVeniceAuthHeaders>>;
  try {
    auth = await buildVeniceAuthHeaders(profile, `${VENICE_API_BASE}/chat/completions`);
  } catch (error) {
    return {
      ...base,
      ok: false,
      status: veniceAuthMode(profile.venice) === "api-key" ? "missing-key" : "missing-wallet",
      message: error instanceof Error ? error.message : "Venice authentication is not configured.",
    };
  }
  const response = await fetch(`${VENICE_API_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth.headers },
    body: JSON.stringify({
      model: selectedModel,
      messages: [{ role: "user", content: "Reply with ok." }],
      stream: false,
      max_tokens: 2,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => "") })) as unknown;
  const balanceRemaining = summarizeVeniceResponseHeaders(response.headers)?.balanceRemaining ?? "";
  const balanceFields = balanceRemaining ? { balanceUsd: formatUsd(balanceRemaining) || balanceRemaining } : {};
  if (!response.ok) {
    const detail = extractErrorMessage(data, `Venice returned HTTP ${response.status}.`);
    return {
      ...base,
      ...balanceFields,
      keyPresent: true,
      ok: false,
      status: categorizeVeniceError(response.status, detail),
      message: detail,
      httpStatus: response.status,
    };
  }
  return {
    ...base,
    ...balanceFields,
    keyPresent: true,
    ok: true,
    status: "ready",
    message: `Venice completed a tiny test request with ${selectedModel}.`,
    httpStatus: response.status,
  };
}

type VeniceTopUpAccept = {
  network?: string;
  asset?: string;
  amount?: string;
  payTo?: string;
  extra?: Record<string, unknown>;
};

function decodeTopUpRequirements(headerValue: string, body: unknown): { x402Version: number; accepts: VeniceTopUpAccept[] } {
  let parsed: unknown = null;
  const trimmed = headerValue.trim();
  if (trimmed) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      try {
        parsed = JSON.parse(Buffer.from(trimmed, "base64").toString("utf8"));
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed || typeof parsed !== "object") parsed = body;
  const record = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const accepts = Array.isArray(record.accepts) ? record.accepts as VeniceTopUpAccept[] : [];
  if (!accepts.length) throw new Error("Venice did not return any accepted x402 payment options for the top-up.");
  const version = Number(record.x402Version);
  return { x402Version: Number.isFinite(version) && version > 0 ? version : 2, accepts };
}

// Signs a classic x402 "exact" payment on Base (EIP-3009 transferWithAuthorization
// over USDC) the same way veniceai/x402-client does via x402/client, then retries
// the top-up with Venice's X-402-Payment header.
export async function topUpVeniceBalance(wallet: VeniceWalletBinding, amountUsd: number): Promise<VeniceTopUpResult> {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error("Top-up amount must be greater than zero.");
  if (!isEvmWalletNetwork(wallet.network)) {
    throw new Error("Venice top-ups from HivemindOS currently use a Base wallet. Pick or create a Base wallet, or top up this wallet from venice.ai.");
  }
  const topUpUrl = `${VENICE_API_BASE}/x402/top-up`;
  const probe = await fetch(topUpUrl, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const probeBody = await probe.json().catch(() => null) as unknown;
  if (probe.status !== 402) {
    throw new Error(extractErrorMessage(probeBody, `Venice top-up returned HTTP ${probe.status}; expected 402 Payment Required.`));
  }
  const required = decodeTopUpRequirements(probe.headers.get("PAYMENT-REQUIRED") ?? probe.headers.get("X-PAYMENT-REQUIRED") ?? "", probeBody);
  const accept = required.accepts.find((entry) => entry.network === "base")
    ?? required.accepts.find((entry) => String(entry.network ?? "").startsWith("eip155:8453"));
  if (!accept?.payTo || !accept.asset) {
    throw new Error("Venice did not offer a Base USDC payment option for the top-up.");
  }
  const minimumUsd = Number(accept.amount ?? 0) / 1_000_000;
  if (Number.isFinite(minimumUsd) && minimumUsd > 0 && amountUsd < minimumUsd) {
    throw new Error(`Venice top-ups must be at least $${minimumUsd.toFixed(2)}.`);
  }

  const account = privateKeyToAccount(wallet.secret as `0x${string}`);
  const valueBaseUnits = BigInt(Math.round(amountUsd * 1_000_000));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300);
  const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const extra = (accept.extra ?? {}) as { name?: string; version?: string };
  const signature = await account.signTypedData({
    domain: {
      name: extra.name ?? "USD Coin",
      version: extra.version ?? "2",
      chainId: 8453,
      verifyingContract: accept.asset as `0x${string}`,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: accept.payTo as `0x${string}`,
      value: valueBaseUnits,
      validAfter: 0n,
      validBefore,
      nonce,
    },
  });
  const paymentPayload = {
    x402Version: required.x402Version,
    scheme: "exact",
    network: "base",
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: accept.payTo,
        value: valueBaseUnits.toString(),
        validAfter: "0",
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };
  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload), "utf8").toString("base64");
  const response = await fetch(topUpUrl, {
    method: "POST",
    headers: { "X-402-Payment": paymentHeader },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => "") })) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, `Venice top-up returned HTTP ${response.status}.`));
  }
  const nested = (data.data && typeof data.data === "object" ? data.data : {}) as Record<string, unknown>;
  const newBalance = formatUsd(nested.newBalance ?? data.newBalance);
  return {
    ok: true,
    message: newBalance ? `Topped up $${amountUsd.toFixed(2)} USDC. Venice balance is now $${newBalance}.` : `Topped up $${amountUsd.toFixed(2)} USDC.`,
    paidUsd: amountUsd,
    network: wallet.network,
    balanceUsd: newBalance,
    httpStatus: response.status,
  };
}

export async function saveVeniceApiKey(apiKey: string, envName = VENICE_DEFAULT_KEY_ENV) {
  const key = envName.trim() || VENICE_DEFAULT_KEY_ENV;
  const value = apiKey.trim();
  if (!value) throw new Error("Venice API key is required.");
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error("Venice API key env name must be an uppercase env identifier.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.cwd(), "scripts", "hive-env-add"), [
      "--import-stdin",
      "--scope",
      "agent",
      "--runtime",
      "generic",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while saving the Venice API key to shared env."));
    }, 30_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `hive-env-add exited with status ${code ?? "unknown"} while saving the Venice API key.`));
    });
    child.stdin.end(`${key}=${value}\n`);
  });
  return key;
}
