import "server-only";

import { getWalletSecret } from "./local-wallet-vault";
import { executeX402Fetch } from "./x402-agent-fetch";

export const OFFICIAL_TESTNET_FAUCET_ORIGIN = "https://hivemindos-paid-agent-gateway.hivemindos.workers.dev";
export const OFFICIAL_TESTNET_FAUCET_ASSETS_URL = `${OFFICIAL_TESTNET_FAUCET_ORIGIN}/api/x402/testnet-faucet/assets`;
export const OFFICIAL_TESTNET_FAUCET_CLAIMS_URL = `${OFFICIAL_TESTNET_FAUCET_ORIGIN}/api/x402/testnet-faucet/claims`;

type FaucetAddressKind = "evm" | "solana" | "stellar";

type FaucetCatalogPair = {
  network: string;
  networkLabel: string;
  asset: string;
  assetLabel: string;
  amount: string;
  provider: "cdp" | "paxos";
  priceUsd: number;
  recipientAddressKind: FaucetAddressKind;
};

export type MiniAppTestnetFaucetInput = {
  walletId: string;
  address: string;
  network: string;
  asset: string;
  recipient: string;
  idempotencyKey: string;
  confirmation: string;
};

function boundedText(value: string, pattern: RegExp, label: string): string {
  const normalized = value.trim();
  if (!pattern.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function validRecipient(recipient: string, kind: FaucetAddressKind): boolean {
  if (kind === "evm") return /^0x[a-fA-F0-9]{40}$/.test(recipient);
  if (kind === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient);
  return /^G[A-Z2-7]{55}$/.test(recipient);
}

function parseCatalogPair(value: unknown, network: string, asset: string): FaucetCatalogPair | null {
  if (!value || typeof value !== "object") return null;
  const pair = value as Record<string, unknown>;
  if (pair.network !== network || pair.asset !== asset) return null;
  if (pair.provider !== "cdp" && pair.provider !== "paxos") return null;
  if (pair.recipientAddressKind !== "evm" && pair.recipientAddressKind !== "solana" && pair.recipientAddressKind !== "stellar") return null;
  const priceUsd = Number(pair.priceUsd);
  if (!Number.isFinite(priceUsd) || priceUsd < 0.01 || priceUsd > 0.99) return null;
  for (const field of ["networkLabel", "assetLabel", "amount"] as const) {
    if (typeof pair[field] !== "string" || !pair[field].trim()) return null;
  }
  return {
    network,
    networkLabel: String(pair.networkLabel),
    asset,
    assetLabel: String(pair.assetLabel),
    amount: String(pair.amount),
    provider: pair.provider,
    priceUsd,
    recipientAddressKind: pair.recipientAddressKind,
  };
}

async function liveCatalogPair(network: string, asset: string): Promise<FaucetCatalogPair> {
  const response = await fetch(OFFICIAL_TESTNET_FAUCET_ASSETS_URL, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as { available?: unknown[] } | null;
  if (!response.ok || !Array.isArray(payload?.available)) {
    throw new Error("The official faucet catalog is temporarily unavailable.");
  }
  const pair = payload.available
    .map((entry) => parseCatalogPair(entry, network, asset))
    .find((entry): entry is FaucetCatalogPair => entry !== null);
  if (!pair) throw new Error("That testnet network and asset pair is not currently available.");
  return pair;
}

export async function executeMiniAppTestnetFaucet(input: MiniAppTestnetFaucetInput) {
  if (input.confirmation !== "TESTNET_FAUCET") {
    throw new Error("Confirm the reviewed Mini faucet payment before continuing.");
  }
  const walletId = boundedText(input.walletId, /^[A-Za-z0-9._:-]{1,240}$/, "Wallet id");
  const address = boundedText(input.address, /^0x[a-fA-F0-9]{40}$/, "Wallet address").toLowerCase();
  const network = boundedText(input.network, /^[a-z0-9-]{1,80}$/, "Faucet network").toLowerCase();
  const asset = boundedText(input.asset, /^[a-z0-9-]{1,40}$/, "Faucet asset").toLowerCase();
  const idempotencyKey = boundedText(input.idempotencyKey, /^[A-Za-z0-9._:-]{1,200}$/, "Idempotency key");
  const recipient = input.recipient.trim();

  const stored = await getWalletSecret(walletId);
  if (!stored) throw new Error("The selected Mini wallet has no local signing key.");
  if (stored.info.network !== "eip155:8453") throw new Error("Faucet x402 payments require a local Base wallet.");
  if (stored.info.address.trim().toLowerCase() !== address) throw new Error("The selected Mini wallet does not match its encrypted vault record.");

  const pair = await liveCatalogPair(network, asset);
  if (!validRecipient(recipient, pair.recipientAddressKind)) {
    throw new Error(`Enter a valid ${pair.recipientAddressKind} recipient for this faucet route.`);
  }

  const result = await executeX402Fetch({
    agentId: walletId,
    network: "eip155:8453",
    secret: stored.secret,
    fromAddress: stored.info.address,
    url: OFFICIAL_TESTNET_FAUCET_CLAIMS_URL,
    method: "POST",
    body: { network, asset, recipient, idempotencyKey },
    policy: {
      enabled: true,
      provider: "x402",
      network: "eip155:8453",
      maxPaymentUsd: pair.priceUsd,
      approvalRequiredOverUsd: 0,
      autoPayEnabled: false,
      x402BaseUrl: OFFICIAL_TESTNET_FAUCET_CLAIMS_URL,
    },
    confirmation: "PAY_X402",
    skipPlatformFee: true,
    timeoutMs: 120_000,
    approvalContext: {
      summary: `Request ${pair.amount} ${pair.assetLabel} on ${pair.networkLabel}.`,
      whyNow: "The user approved this exact HivemindOS Mini faucet route and its live server-owned price.",
      impact: `The wallet may spend up to $${pair.priceUsd.toFixed(2)} USDC on Base for programmatic faucet routing.`,
      requestedAction: "Approve only if the selected route, recipient, and price match the Mini review.",
      evidence: [
        `Route: ${pair.network}/${pair.asset}`,
        `Recipient: ${recipient}`,
        `Maximum payment: $${pair.priceUsd.toFixed(2)} USDC`,
      ],
      source: "HivemindOS Mini Testnet Faucet",
    },
  });

  if (!result.ok || !result.paid || !result.bodyJson) {
    throw new Error(result.bodyPreview || "The paid faucet request did not complete.");
  }
  return { pair, payment: result, claim: result.bodyJson };
}
