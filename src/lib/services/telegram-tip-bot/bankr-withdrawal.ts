import "server-only";

// Optional gasless withdrawal provider. When TELEGRAM_TIP_BOT_WITHDRAWAL_PROVIDER=bankr
// and BANKR_API_KEY is set (shared hive env), the bot's treasury IS the Bankr
// wallet: deposits go to it, and withdrawals go out via POST /wallet/transfer,
// which Bankr gas-sponsors on Base — no ETH float needed. The API key needs
// Wallet API enabled and must not be read-only (docs/bankr/bankr-platform-reference.md).
// Never log or echo the key; refer to it by name only.

import { hiveEnvValue } from "@/lib/services/shared-hive-env";

const BANKR_API_BASE = "https://api.bankr.bot";

function bankrApiKey(): Promise<string> {
  return hiveEnvValue("BANKR_API_KEY");
}

export async function bankrGaslessConfigured(): Promise<boolean> {
  return Boolean(await bankrApiKey());
}

async function bankrCall<T>(method: "GET" | "POST", endpoint: string, body?: Record<string, unknown>): Promise<T> {
  const key = await bankrApiKey();
  if (!key) throw new Error("BANKR_API_KEY is not set in the shared hive env.");
  const response = await fetch(`${BANKR_API_BASE}${endpoint}`, {
    method,
    headers: { "X-API-Key": key, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || data?.success === false) {
    const detail = typeof data?.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(`Bankr ${endpoint} failed: ${detail}`);
  }
  return data as T;
}

export async function getBankrWalletAddress(): Promise<string> {
  const data = await bankrCall<Record<string, unknown>>("GET", "/wallet/me");
  const wallet = (data.wallet ?? data) as Record<string, unknown>;
  const candidate = [wallet.evmAddress, wallet.address, data.evmAddress, data.address].find(
    (value): value is string => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value),
  );
  if (!candidate) throw new Error("Could not resolve an EVM address from Bankr /wallet/me.");
  return candidate;
}

// Bankr's transfer endpoint takes human-readable amounts, not base units.
export async function sendHiveViaBankr(params: {
  tokenAddress: string;
  toAddress: string;
  amountHuman: string;
}): Promise<{ txHash: string }> {
  const data = await bankrCall<{ success: boolean; txHash?: string }>("POST", "/wallet/transfer", {
    tokenAddress: params.tokenAddress,
    recipientAddress: params.toAddress,
    amount: params.amountHuman,
    isNativeToken: false,
  });
  if (!data.txHash) throw new Error("Bankr transfer returned no txHash.");
  return { txHash: data.txHash };
}
