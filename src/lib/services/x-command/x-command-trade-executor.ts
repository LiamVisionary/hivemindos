import "server-only";

import {
  executeStockTrade,
  discoverStockTradeQuote,
  stockTradeConfirmation,
  type BuyStockPolicy,
} from "@/lib/services/trading/buy-stock";
import {
  SWAP_CONFIRMATION,
  executeDexSwap,
  quoteDexSwap,
  type DexSwapInput,
} from "@/lib/services/trading/dex-swap";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import type { XCommandTradeRequest } from "@/lib/types/x-command";
import {
  completeXCommandTradeReceipt,
  readXCommandWalletPolicy,
  reserveXCommandTrade,
  type XCommandTradeReceipt,
  type XCommandWalletPolicy,
} from "./x-command-wallet-policy";

type SigningAccount = XCommandWalletPolicy["accounts"][number];

function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isSolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function tokenAccount(policy: XCommandWalletPolicy, asset: string): SigningAccount {
  const accounts = policy.accounts;
  const preferred = isSolanaAddress(asset)
    ? accounts.find((account) => account.network === "solana:mainnet")
    : isEvmAddress(asset)
      ? accounts.find((account) => account.network === "eip155:8453")
        ?? accounts.find((account) => account.network === "eip155:4663")
      : accounts.find((account) => account.network === "eip155:8453")
        ?? accounts.find((account) => account.network === "solana:mainnet")
        ?? accounts.find((account) => account.network === "eip155:4663");
  if (!preferred) throw new Error("The selected HivemindOSBot wallet has no compatible account for this token.");
  return preferred;
}

function stockAccount(policy: XCommandWalletPolicy): SigningAccount & { venue: "xstocks" | "robinhood-chain" } {
  const robinhood = policy.accounts.find((account) => account.network === "eip155:4663");
  if (robinhood) return { ...robinhood, venue: "robinhood-chain" };
  const solana = policy.accounts.find((account) => account.network === "solana:mainnet");
  if (solana) return { ...solana, venue: "xstocks" };
  throw new Error("This HivemindOSBot wallet has no Robinhood Chain or Solana account for on-chain stocks.");
}

async function signer(account: SigningAccount) {
  const stored = await getWalletSecret(account.walletId);
  if (!stored) throw new Error("The selected HivemindOSBot wallet no longer has a local signing key.");
  if (stored.info.network !== account.network || stored.info.address.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("The selected HivemindOSBot wallet changed after authorization. Re-authorize it before trading.");
  }
  return stored;
}

function amount(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function duplicateResult(receipt: XCommandTradeReceipt): string {
  if (receipt.status === "complete" && receipt.resultText) return receipt.resultText;
  if (receipt.status === "failed") throw new Error(receipt.error || "This X trade already failed and will not be submitted twice.");
  throw new Error("This X trade was already started, but its final chain outcome is not proven. HivemindOS will not submit it twice; inspect the selected wallet's activity.");
}

function shortReference(reference: string): string {
  return reference.length > 22 ? `${reference.slice(0, 10)}…${reference.slice(-8)}` : reference;
}

async function executeTokenTrade(jobId: string, request: XCommandTradeRequest, policy: XCommandWalletPolicy): Promise<string> {
  if (request.side === "swap") throw new Error("X token swaps need a buy or sell direction; use “buy $5 of TOKEN” or “sell 1 TOKEN”.");
  const asset = request.asset?.trim() || "";
  if (!asset) throw new Error("The X trade did not identify a token symbol, contract address, or mint.");
  const account = tokenAccount(policy, asset);
  const stored = await signer(account);
  const stable = account.network === "eip155:4663" ? "USDG" : "USDC";
  const input: DexSwapInput = {
    agentId: account.walletId,
    network: account.network,
    fromAddress: stored.info.address,
    secret: stored.secret,
    sellToken: request.side === "buy" ? stable : asset,
    buyToken: request.side === "buy" ? asset : stable,
    amountHuman: request.side === "buy"
      ? amount(request.amountUsd, "Token buys from X need a USD amount")
      : amount(request.quantity, "Token sells from X need a token quantity"),
    slippageBps: policy.slippageBps,
  };
  const quote = await quoteDexSwap({ ...input, secret: undefined });
  const reservation = await reserveXCommandTrade({
    jobId,
    amountUsd: quote.valueUsd,
    expectedPolicyRevision: policy.revision,
    accountWalletId: account.walletId,
    network: account.network,
  });
  if (reservation.duplicate) return duplicateResult(reservation.receipt);
  try {
    const result = await executeDexSwap({
      ...input,
      confirmation: SWAP_CONFIRMATION,
      approvalThresholdSatisfied: true,
    });
    const verb = request.side === "buy" ? "Bought" : "Sold";
    const resultText = `${verb} ~$${result.valueUsd.toFixed(2)} of ${asset} from ${policy.walletName} on ${account.network}. Transaction ${shortReference(result.reference)}.`;
    await completeXCommandTradeReceipt(jobId, {
      status: "complete",
      resultText,
      reference: result.reference,
      valueUsd: result.valueUsd,
    });
    return resultText;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The local token trade failed.";
    await completeXCommandTradeReceipt(jobId, { status: "uncertain", error: message });
    throw new Error(`${message} HivemindOS will not automatically submit this X trade again; inspect the wallet activity before retrying manually.`);
  }
}

async function executeStockCommand(jobId: string, request: XCommandTradeRequest, policy: XCommandWalletPolicy): Promise<string> {
  if (request.side === "swap") throw new Error("Stock swaps from X need a buy or sell direction.");
  const ticker = request.asset?.trim().toUpperCase() || "";
  if (!ticker) throw new Error("The X trade did not identify a stock ticker.");
  const notionalUsd = amount(request.amountUsd, "Stock trades from X need a USD amount");
  const account = stockAccount(policy);
  const stored = await signer(account);
  const side = request.side === "sell" ? "sell" : "buy";
  const tradePolicy: BuyStockPolicy = {
    agentId: account.walletId,
    enabled: true,
    network: account.network,
    tradingVenue: account.venue,
    maxTradeUsd: policy.maxTradeUsd,
    maxPaymentUsd: policy.maxTradeUsd,
  };
  await discoverStockTradeQuote({
    side,
    policy: tradePolicy,
    ticker,
    notionalUsd,
    slippageBps: policy.slippageBps,
  });
  const reservation = await reserveXCommandTrade({
    jobId,
    amountUsd: notionalUsd,
    expectedPolicyRevision: policy.revision,
    accountWalletId: account.walletId,
    network: account.network,
  });
  if (reservation.duplicate) return duplicateResult(reservation.receipt);
  try {
    const result = await executeStockTrade({
      agentId: account.walletId,
      side,
      policy: tradePolicy,
      ticker,
      notionalUsd,
      confirmation: stockTradeConfirmation(side),
      approvalThresholdSatisfied: true,
      network: account.network,
      secret: stored.secret,
      fromAddress: stored.info.address,
      slippageBps: policy.slippageBps,
    });
    const verb = side === "buy" ? "Bought" : "Sold";
    const resultText = `${verb} ~$${result.notionalUsd.toFixed(2)} of ${result.ticker} from ${policy.walletName} via ${result.venue}. Transaction ${shortReference(result.reference)}.`;
    await completeXCommandTradeReceipt(jobId, {
      status: "complete",
      resultText,
      reference: result.reference,
      valueUsd: result.notionalUsd,
    });
    return resultText;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The local stock trade failed.";
    await completeXCommandTradeReceipt(jobId, { status: "uncertain", error: message });
    throw new Error(`${message} HivemindOS will not automatically submit this X trade again; inspect the wallet activity before retrying manually.`);
  }
}

export async function executeXCommandTrade(input: {
  jobId: string;
  tradeRequest: XCommandTradeRequest;
}): Promise<string> {
  const policy = await readXCommandWalletPolicy();
  if (!policy?.enabled) throw new Error("Automatic X trades are off. Authorize a HivemindOSBot wallet in the app first.");
  return input.tradeRequest.assetClass === "stock"
    ? executeStockCommand(input.jobId, input.tradeRequest, policy)
    : executeTokenTrade(input.jobId, input.tradeRequest, policy);
}
