import { sendApprovedWalletUsdc, type WalletSendUsdcResponse } from "./send-usdc-client";

/**
 * Shared client-side "fund an agent" rail. The Wallets route and the chat
 * route's agent-asset popover both fund agents through this one guard chain,
 * so asset/network/source rules cannot drift between surfaces.
 *
 * Sources and personal-wallet records arrive from mixed vault/native/HTTP
 * readers, so fields are read defensively rather than trusted.
 */
type PersonalWalletTokenLike = { symbol?: unknown; balance?: unknown };

export type PersonalWalletRecordLike = {
  id?: unknown;
  agentId?: unknown;
  address?: unknown;
  custodyMode?: unknown;
  network?: unknown;
  tokens?: PersonalWalletTokenLike[] | unknown;
};

/** GroupedPersonalWallet-shaped source card (seed root + per-chain accounts). */
export type FundingSourceLike = {
  id?: unknown;
  spendId?: unknown;
  addr?: unknown;
  canSpend?: unknown;
  accounts?: Array<{ id?: unknown }> | unknown;
  addresses?: Array<unknown[]> | unknown;
};

export type FundingRecipientWalletLike = {
  walletAddress?: unknown;
  vaultAddress?: unknown;
  address?: unknown;
  network?: unknown;
};

export function stableSendAssetForNetwork(network: string): "USDC" | "USDG" {
  return String(network || "").toLowerCase() === "eip155:4663" ? "USDG" : "USDC";
}

export function isStableSendAsset(asset: string): asset is "USDC" | "USDG" {
  return asset === "USDC" || asset === "USDG";
}

export function fundingNetworkLabel(network: string): string {
  if (network === "eip155:8453") return "Base";
  if (network === "eip155:84532") return "Base Sepolia";
  if (network === "eip155:4663") return "Robinhood Chain";
  if (network === "eip155:46630") return "Robinhood Chain Testnet";
  if (network === "solana:mainnet") return "Solana";
  if (network === "solana:devnet") return "Solana devnet";
  if (network.startsWith("eip155:")) return "EVM";
  if (network.startsWith("solana:")) return "Solana";
  return network || "Unknown network";
}

function tokenSymbol(token: PersonalWalletTokenLike | null | undefined): string {
  return String(token?.symbol || "").trim().toUpperCase();
}

function tokenBalanceForAsset(wallet: PersonalWalletRecordLike | null | undefined, asset: string): number {
  const tokens = Array.isArray(wallet?.tokens) ? (wallet.tokens as PersonalWalletTokenLike[]) : [];
  const match = tokens.find((token) => tokenSymbol(token) === asset);
  return Number(match?.balance ?? 0) || 0;
}

function personalWalletSupportsAsset(wallet: PersonalWalletRecordLike | null | undefined, asset: string): boolean {
  if (tokenBalanceForAsset(wallet, asset) > 0) return true;
  return stableSendAssetForNetwork(String(wallet?.network || "")) === asset;
}

export function resolvePersonalWalletRecordForAsset(
  source: FundingSourceLike | null | undefined,
  asset: string,
  wallets: PersonalWalletRecordLike[],
): PersonalWalletRecordLike | null {
  const ids = new Set<string>([
    String(source?.spendId || ""),
    String(source?.id || ""),
    ...(Array.isArray(source?.accounts) ? source.accounts.map((account: { id?: unknown }) => String(account?.id || "")) : []),
  ].filter(Boolean));
  const addresses = new Set<string>([
    String(source?.addr || "").toLowerCase(),
    ...(Array.isArray(source?.addresses) ? source.addresses.map((row: unknown[]) => String(row?.[1] || "").toLowerCase()) : []),
  ].filter(Boolean));
  const candidates = wallets.filter((wallet) => {
    const id = String(wallet?.id || wallet?.agentId || "");
    const address = String(wallet?.address || "").toLowerCase();
    return (id && ids.has(id)) || (address && addresses.has(address));
  });
  const localCandidates = candidates.filter((wallet) => wallet?.custodyMode === "local");
  const funded = localCandidates.find((wallet) => tokenBalanceForAsset(wallet, asset) > 0);
  const supported = localCandidates.find((wallet) => personalWalletSupportsAsset(wallet, asset));
  return funded ?? supported ?? null;
}

export function resolvePersonalWalletAgentIdForAsset(
  source: FundingSourceLike | null | undefined,
  asset: string,
  wallets: PersonalWalletRecordLike[],
): string {
  const wallet = resolvePersonalWalletRecordForAsset(source, asset, wallets);
  return String(wallet?.id || wallet?.agentId || source?.spendId || source?.id || "");
}

export type ExecuteAgentFundingInput = {
  source: FundingSourceLike | null | undefined;
  recipientAgentId: string;
  recipientWallet: FundingRecipientWalletLike | null | undefined;
  asset: string;
  amountUsd: number;
  confirmation?: string;
  personalWallets: PersonalWalletRecordLike[];
};

export type ExecuteAgentFundingResult = WalletSendUsdcResponse & { toAddress: string };

/**
 * Guarded stable-asset transfer from a local personal wallet to an agent's
 * deposit address. Personal wallets never auto-spend, so the caller supplies
 * the explicit confirmation string and the route mints/consumes a short-lived
 * approval token. Throws with a user-facing message on any guard failure.
 */
export async function executeAgentFunding(input: ExecuteAgentFundingInput): Promise<ExecuteAgentFundingResult> {
  const asset = String(input.asset || "USDC").toUpperCase();
  if (!isStableSendAsset(asset)) throw new Error("Agent funding is wired for USDC or USDG transfers only.");
  if (input.source?.canSpend === false) throw new Error("This personal wallet is watch-only. Reimport it locally before funding agents.");
  const wallet = input.recipientWallet ?? {};
  const toAddress = String(wallet.walletAddress || wallet.vaultAddress || wallet.address || "");
  if (!toAddress) throw new Error("That agent does not have a deposit address yet.");
  const recipientAsset = stableSendAssetForNetwork(String(wallet.network || ""));
  if (asset !== recipientAsset) throw new Error(`That agent wallet receives ${recipientAsset} on ${fundingNetworkLabel(String(wallet.network || ""))}.`);
  const sourceAgentId = resolvePersonalWalletAgentIdForAsset(input.source, asset, input.personalWallets);
  if (!sourceAgentId) throw new Error(`No local ${asset} wallet is available to fund this agent.`);
  const amountUsd = Number(input.amountUsd);
  const data = await sendApprovedWalletUsdc({
    agentId: sourceAgentId,
    toAddress,
    amountUsd,
    autoPayEnabled: false,
    confirmation: input.confirmation,
    maxPaymentUsd: amountUsd || undefined,
    // The receiving agent sponsors only a missing Base gas reserve, so a
    // gas-dry personal wallet can still fund it (recipient-only sponsorship).
    gasSponsorAgentId: input.recipientAgentId,
  });
  if (!data?.ok) throw new Error(data?.error || "Could not fund agent.");
  return { ...data, toAddress };
}
