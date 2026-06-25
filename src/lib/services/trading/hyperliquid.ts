import "server-only";

import net from "node:net";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import type { ApproveBuilderFeeSuccessResponse, OrderParameters, OrderSuccessResponse } from "@nktkas/hyperliquid/api/exchange";
import type { ClearinghouseStateResponse, FrontendOpenOrdersResponse, MetaResponse } from "@nktkas/hyperliquid/api/info";
import { validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";
import { evaluateSpend, resolveSpendGovernance, shouldEvaluateSpend } from "@/lib/services/wallet/spend-governance";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";

// Match the wider connection window used by the local swap rail. Hyperliquid's
// API is latency sensitive, but a too-small happy-eyeballs timeout can fail
// before this network has completed a viable TCP handshake.
(net as unknown as { setDefaultAutoSelectFamilyAttemptTimeout?: (ms: number) => void })
  .setDefaultAutoSelectFamilyAttemptTimeout?.(3000);

export const HYPERLIQUID_ORDER_CONFIRMATION = "CONFIRM_HYPERLIQUID_ORDER";
export const HYPERLIQUID_BUILDER_CONFIRMATION = "CONFIRM_HYPERLIQUID_BUILDER";
export const DEFAULT_HYPERLIQUID_BUILDER_FEE_TENTH_BPS = 5;
export const MAX_HYPERLIQUID_PERP_BUILDER_FEE_TENTH_BPS = 100;
export const DEFAULT_HYPERLIQUID_MARKET_SLIPPAGE_BPS = 50;
// Official builds keep the builder recipient in HivemindOS-controlled policy;
// self-hosters replace this source in their fork/build rather than env at runtime.
export const DEFAULT_HYPERLIQUID_BUILDER_POLICY_URL = "https://hivemindos-paid-agent-gateway.hivemindos.workers.dev/api/hyperliquid/builder-policy";
export const HYPERLIQUID_BUILDER_POLICY_STATUS_KEY = "official-hivemindos-hyperliquid-builder-policy";

type BuilderAddress = `0x${string}`;
type HyperliquidBuilder = NonNullable<OrderParameters["builder"]>;
type HyperliquidSdkOrder = OrderParameters["orders"][number];
type LocalEvmAccount = ReturnType<typeof privateKeyToAccount> | ReturnType<typeof mnemonicToAccount>;

export type HyperliquidSide = "long" | "short";
export type HyperliquidOrderType = "market" | "limit";

export type HyperliquidTradePolicy = Pick<AgentWalletConfig, "enabled" | "maxPaymentUsd" | "maxTradeUsd">;

export type HyperliquidBuilderConfig = {
  configured: boolean;
  official: boolean;
  source: "official-policy";
  policyUrl: string;
  builderAddress?: BuilderAddress;
  builderFeeTenthBps: number;
  builderFeeBps: number;
  maxBuilderFeeTenthBps: number;
  maxBuilderFeeRate: `${string}%`;
  isTestnet: boolean;
  apiUrl?: string;
  missing: string[];
  detail: string;
};

export type HyperliquidBuilderApprovalStatus = {
  configured: boolean;
  builderAddress?: BuilderAddress;
  approved: boolean;
  approvedMaxFeeTenthBps: number;
  requiredFeeTenthBps: number;
  maxApprovalFeeTenthBps: number;
  maxApprovalFeeRate: `${string}%`;
  activeApprovalSlot: boolean;
  approvedBuilders: string[];
  missing: string[];
  error?: string;
  detail: string;
};

export type HyperliquidOrderInput = {
  agentId: string;
  walletAddress: string;
  walletNetwork: string;
  secret?: string;
  policy?: HyperliquidTradePolicy;
  coin: string;
  side: HyperliquidSide | string;
  notionalUsd?: number;
  size?: number;
  orderType?: HyperliquidOrderType;
  limitPrice?: number;
  reduceOnly?: boolean;
  slippageBps?: number;
  confirmation?: string;
  approvalToken?: string;
};

export type HyperliquidOrderSummary = {
  coin: string;
  assetId: number;
  side: HyperliquidSide;
  orderType: HyperliquidOrderType;
  timeInForce: "Gtc" | "Ioc";
  reduceOnly: boolean;
  price: string;
  size: string;
  midPrice: number;
  notionalUsd: number;
};

export type HyperliquidQuote = {
  network: "mainnet" | "testnet";
  walletAddress: string;
  order: HyperliquidOrderSummary;
  builder?: HyperliquidBuilder;
  builderConfig: HyperliquidBuilderConfig;
  builderApproval: HyperliquidBuilderApprovalStatus;
  detail: string;
};

export type HyperliquidBuilderApprovalResult = {
  ok: true;
  network: "mainnet" | "testnet";
  builderAddress: BuilderAddress;
  maxFeeRate: `${string}%`;
  response: ApproveBuilderFeeSuccessResponse;
  detail: string;
};

export type HyperliquidOrderResult = {
  ok: true;
  network: "mainnet" | "testnet";
  walletAddress: string;
  order: HyperliquidOrderSummary;
  builder?: HyperliquidBuilder;
  statuses: OrderSuccessResponse["response"]["data"]["statuses"];
  reference: string;
  detail: string;
};

export type HyperliquidPositionSummary = {
  coin: string;
  side: "long" | "short" | "flat";
  size: number;
  entryPrice?: number;
  positionValueUsd?: number;
  unrealizedPnlUsd?: number;
  liquidationPrice?: number;
  leverage?: number;
  marginMode?: string;
};

export type HyperliquidAccountStatus = {
  ok: true;
  network: "mainnet" | "testnet";
  walletAddress: string;
  accountValueUsd?: number;
  withdrawableUsd?: number;
  positions: HyperliquidPositionSummary[];
  openOrders: FrontendOpenOrdersResponse;
  builderConfig: HyperliquidBuilderConfig;
  builderApproval: HyperliquidBuilderApprovalStatus;
  detail: string;
};

type HyperliquidOrderDraft = {
  config: HyperliquidBuilderConfig;
  client: InfoClient;
  order: HyperliquidSdkOrder;
  builder?: HyperliquidBuilder;
  summary: HyperliquidOrderSummary;
};

const EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0";
const POLICY_CACHE_MS = 60_000;

type HostedHyperliquidBuilderPolicy = {
  ok?: boolean;
  official?: boolean;
  enabled?: unknown;
  configured?: unknown;
  network?: unknown;
  builderAddress?: unknown;
  builder?: { address?: unknown };
  builderFeeTenthBps?: unknown;
  feeTenthBps?: unknown;
  maxBuilderFeeTenthBps?: unknown;
  maxApprovalFeeTenthBps?: unknown;
  apiUrl?: unknown;
  missing?: unknown;
  detail?: unknown;
};

export type HyperliquidPolicyPresence = {
  key: typeof HYPERLIQUID_BUILDER_POLICY_STATUS_KEY;
  present: boolean;
  source: "official-policy";
};

let builderPolicyCache: { expiresAt: number; policy: HostedHyperliquidBuilderPolicy | null } | null = null;

export async function hyperliquidPolicyPresence(): Promise<HyperliquidPolicyPresence[]> {
  const config = await readHyperliquidBuilderConfig();
  return [{
    key: HYPERLIQUID_BUILDER_POLICY_STATUS_KEY,
    present: config.configured,
    source: "official-policy",
  }];
}

export async function readHyperliquidBuilderConfig(): Promise<HyperliquidBuilderConfig> {
  const policyUrl = DEFAULT_HYPERLIQUID_BUILDER_POLICY_URL;
  const policy = await fetchHyperliquidBuilderPolicy(policyUrl).catch(() => null);
  const missing: string[] = [];
  const source = "official-policy" as const;

  let builderAddress: BuilderAddress | undefined;
  const rawBuilderAddress = stringFrom(policy?.builderAddress ?? policy?.builder?.address);
  if (!policy?.ok) {
    missing.push("Official HivemindOS Hyperliquid builder policy is unavailable.");
  } else if (!rawBuilderAddress) {
    missing.push("Official HivemindOS Hyperliquid builder address is not configured yet.");
  } else {
    try {
      builderAddress = normalizeEvmAddress(rawBuilderAddress, "Hyperliquid builder address");
    } catch (error) {
      missing.push(errorMessage(error));
    }
  }

  let builderFeeTenthBps = DEFAULT_HYPERLIQUID_BUILDER_FEE_TENTH_BPS;
  try {
    builderFeeTenthBps = parseBuilderFeeTenthBps(
      String(policy?.builderFeeTenthBps ?? policy?.feeTenthBps ?? DEFAULT_HYPERLIQUID_BUILDER_FEE_TENTH_BPS),
      "Hyperliquid builder fee",
    );
  } catch (error) {
    builderFeeTenthBps = 0;
    missing.push(errorMessage(error));
  }

  let maxBuilderFeeTenthBps = builderFeeTenthBps;
  try {
    maxBuilderFeeTenthBps = parseBuilderFeeTenthBps(
      String(policy?.maxBuilderFeeTenthBps ?? policy?.maxApprovalFeeTenthBps ?? builderFeeTenthBps),
      "Hyperliquid max builder approval fee",
    );
  } catch (error) {
    missing.push(errorMessage(error));
  }
  maxBuilderFeeTenthBps = Math.max(maxBuilderFeeTenthBps, builderFeeTenthBps);

  const isTestnet = parsePolicyNetwork(policy?.network);
  const apiUrl = stringFrom(policy?.apiUrl) || undefined;
  const enabled = booleanFrom(policy?.enabled ?? policy?.configured, false);
  const policyMissing = Array.isArray(policy?.missing) ? policy.missing.map(String).filter(Boolean) : [];
  missing.push(...policyMissing);
  if (policy?.ok && !enabled) missing.push("Official HivemindOS Hyperliquid builder policy is disabled.");
  const configured = Boolean(policy?.ok) && enabled && Boolean(builderAddress) && builderFeeTenthBps > 0 && missing.length === 0;
  const detail = configured
    ? `Official HivemindOS Hyperliquid ${isTestnet ? "testnet" : "mainnet"} builder ${shortAddress(builderAddress)} charges ${formatBuilderFee(builderFeeTenthBps)} per perp fill.`
    : stringFrom(policy?.detail) || "Official HivemindOS Hyperliquid builder policy is not fully configured.";

  return {
    configured,
    official: true,
    source,
    policyUrl,
    builderAddress,
    builderFeeTenthBps,
    builderFeeBps: builderFeeTenthBps / 10,
    maxBuilderFeeTenthBps,
    maxBuilderFeeRate: builderFeeTenthBpsToPercentString(maxBuilderFeeTenthBps),
    isTestnet,
    apiUrl,
    missing: [...new Set(missing)],
    detail,
  };
}

export async function getHyperliquidBuilderApprovalStatus(input: {
  walletAddress: string;
  config?: HyperliquidBuilderConfig;
  client?: InfoClient;
}): Promise<HyperliquidBuilderApprovalStatus> {
  const config = input.config ?? await readHyperliquidBuilderConfig();
  if (!config.configured || !config.builderAddress) {
    return {
      configured: false,
      approved: false,
      approvedMaxFeeTenthBps: 0,
      requiredFeeTenthBps: config.builderFeeTenthBps,
      maxApprovalFeeTenthBps: config.maxBuilderFeeTenthBps,
      maxApprovalFeeRate: config.maxBuilderFeeRate,
      activeApprovalSlot: false,
      approvedBuilders: [],
      missing: config.missing,
      detail: config.missing.join(" ") || "Builder fee approval is unavailable until the builder is configured.",
    };
  }

  const user = normalizeEvmAddress(input.walletAddress, "Hyperliquid user address");
  const client = input.client ?? createInfoClient(config);
  const [maxFeeResult, approvedResult] = await Promise.allSettled([
    client.maxBuilderFee({ user, builder: config.builderAddress }),
    client.approvedBuilders({ user }),
  ]);
  const approvedMaxFeeTenthBps = maxFeeResult.status === "fulfilled" ? Number(maxFeeResult.value) || 0 : 0;
  const approvedBuilders = approvedResult.status === "fulfilled"
    ? approvedResult.value.map((address) => String(address).toLowerCase())
    : [];
  const activeApprovalSlot = approvedBuilders.includes(config.builderAddress.toLowerCase());
  const approved = approvedMaxFeeTenthBps >= config.builderFeeTenthBps;
  const errors = [maxFeeResult, approvedResult]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => errorMessage(result.reason));

  return {
    configured: true,
    builderAddress: config.builderAddress,
    approved,
    approvedMaxFeeTenthBps,
    requiredFeeTenthBps: config.builderFeeTenthBps,
    maxApprovalFeeTenthBps: config.maxBuilderFeeTenthBps,
    maxApprovalFeeRate: config.maxBuilderFeeRate,
    activeApprovalSlot,
    approvedBuilders,
    missing: approved ? [] : [`Approve ${formatBuilderFee(config.maxBuilderFeeTenthBps)} max builder fee for ${shortAddress(config.builderAddress)}.`],
    error: errors.length ? errors.join(" ") : undefined,
    detail: approved
      ? `Builder ${shortAddress(config.builderAddress)} is approved for up to ${formatBuilderFee(approvedMaxFeeTenthBps)}.`
      : `Builder ${shortAddress(config.builderAddress)} is not approved for the required ${formatBuilderFee(config.builderFeeTenthBps)} per-order fee.`,
  };
}

export async function quoteHyperliquidOrder(input: HyperliquidOrderInput): Promise<HyperliquidQuote> {
  assertEvmWallet(input.walletNetwork);
  const walletAddress = normalizeEvmAddress(input.walletAddress, "Hyperliquid wallet address");
  const draft = await buildHyperliquidOrderDraft(input);
  const builderApproval = await getHyperliquidBuilderApprovalStatus({
    walletAddress,
    config: draft.config,
    client: draft.client,
  });
  return {
    network: draft.config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    order: draft.summary,
    builder: draft.builder,
    builderConfig: draft.config,
    builderApproval,
    detail: orderDetail(draft.summary, draft.builder, draft.config, builderApproval),
  };
}

export async function approveHyperliquidBuilderFee(input: Pick<HyperliquidOrderInput, "walletAddress" | "walletNetwork" | "secret" | "confirmation">): Promise<HyperliquidBuilderApprovalResult> {
  if (input.confirmation !== HYPERLIQUID_BUILDER_CONFIRMATION) {
    throw new Error(`Hyperliquid builder approvals need confirmation. Type ${HYPERLIQUID_BUILDER_CONFIRMATION} to approve the configured max builder fee.`);
  }
  const config = await readHyperliquidBuilderConfig();
  if (!config.configured || !config.builderAddress) {
    throw new Error(config.missing.join(" ") || "Hyperliquid builder codes are not configured.");
  }
  const account = assertEvmSigningAccount(input);
  const client = createExchangeClient(config, account);
  const response = await client.approveBuilderFee({
    builder: config.builderAddress,
    maxFeeRate: config.maxBuilderFeeRate,
  });
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    builderAddress: config.builderAddress,
    maxFeeRate: config.maxBuilderFeeRate,
    response,
    detail: `Approved ${shortAddress(config.builderAddress)} to charge up to ${formatBuilderFee(config.maxBuilderFeeTenthBps)} on Hyperliquid ${config.isTestnet ? "testnet" : "mainnet"}.`,
  };
}

export async function executeHyperliquidOrder(input: HyperliquidOrderInput): Promise<HyperliquidOrderResult> {
  if (input.confirmation !== HYPERLIQUID_ORDER_CONFIRMATION) {
    throw new Error(`Hyperliquid orders need confirmation. Type ${HYPERLIQUID_ORDER_CONFIRMATION} to place the order.`);
  }
  const account = assertEvmSigningAccount(input);
  const draft = await buildHyperliquidOrderDraft(input);
  const builderApproval = await getHyperliquidBuilderApprovalStatus({
    walletAddress: input.walletAddress,
    config: draft.config,
    client: draft.client,
  });
  if (draft.builder && !builderApproval.approved) {
    throw new Error(`${builderApproval.detail} Type ${HYPERLIQUID_BUILDER_CONFIRMATION} first to sign the one-time builder approval from the main wallet.`);
  }
  const governance = await hyperliquidGovernance(input, draft.summary);
  const client = createExchangeClient(draft.config, account);
  const response = await client.order({
    orders: [draft.order],
    grouping: "na",
    builder: draft.builder,
  });
  const statuses = response.response.data.statuses;
  const errors = statuses
    .map((status) => typeof status === "object" && status && "error" in status ? String(status.error) : "")
    .filter(Boolean);
  if (errors.length) throw new Error(`Hyperliquid rejected the order: ${errors.join("; ")}`);
  const reference = orderReference(statuses);

  await appendSpend({
    agentId: input.agentId,
    companyId: governance.companyId,
    kind: "trade",
    asset: "USDC",
    amountUsd: draft.summary.reduceOnly ? 0 : draft.summary.notionalUsd,
    assetAmount: draft.summary.reduceOnly ? draft.summary.notionalUsd : undefined,
    target: shortTarget(`hyperliquid:${draft.summary.coin} ${draft.summary.side}`),
    status: "executed",
    approvalId: governance.approvalGrantId,
  }).catch(() => {});

  return {
    ok: true,
    network: draft.config.isTestnet ? "testnet" : "mainnet",
    walletAddress: normalizeEvmAddress(input.walletAddress, "Hyperliquid wallet address"),
    order: draft.summary,
    builder: draft.builder,
    statuses,
    reference,
    detail: `Placed ${draft.summary.side} ${draft.summary.size} ${draft.summary.coin} at ${draft.summary.price} on Hyperliquid. ${reference}.`,
  };
}

export async function getHyperliquidAccountStatus(input: {
  walletAddress: string;
  walletNetwork: string;
}): Promise<HyperliquidAccountStatus> {
  assertEvmWallet(input.walletNetwork);
  const walletAddress = normalizeEvmAddress(input.walletAddress, "Hyperliquid wallet address");
  const config = await readHyperliquidBuilderConfig();
  const client = createInfoClient(config);
  const [stateResult, openOrdersResult, approval] = await Promise.all([
    client.clearinghouseState({ user: walletAddress }),
    client.frontendOpenOrders({ user: walletAddress }),
    getHyperliquidBuilderApprovalStatus({ walletAddress, config, client }),
  ]);
  const state = stateResult as ClearinghouseStateResponse;
  const positions = summarizePositions(state);
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    accountValueUsd: numericString(state.marginSummary?.accountValue),
    withdrawableUsd: numericString(state.withdrawable),
    positions,
    openOrders: openOrdersResult,
    builderConfig: config,
    builderApproval: approval,
    detail: `Hyperliquid ${config.isTestnet ? "testnet" : "mainnet"} account ${shortAddress(walletAddress)} has ${positions.length} open perp position${positions.length === 1 ? "" : "s"}.`,
  };
}

export function builderFeeTenthBpsToPercentString(feeTenthBps: number): `${string}%` {
  return `${trimFixed((Math.max(0, feeTenthBps) / 1000), 3)}%` as `${string}%`;
}

export function formatBuilderFee(feeTenthBps: number) {
  const bps = feeTenthBps / 10;
  return `${trimFixed(bps, 1)} bps (${builderFeeTenthBpsToPercentString(feeTenthBps)})`;
}

export function formatHyperliquidSize(size: number, szDecimals: number): string {
  const amount = Number(size);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Order size must be greater than zero.");
  const decimals = clampInteger(szDecimals, 0, 12);
  const factor = 10 ** decimals;
  const rounded = Math.floor((amount + Number.EPSILON) * factor) / factor;
  if (rounded <= 0) throw new Error(`Order size is below Hyperliquid's lot size for this market.`);
  return trimFixed(rounded, decimals);
}

export function formatHyperliquidPerpPrice(price: number, szDecimals: number): string {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Order price must be greater than zero.");
  const maxDecimals = Math.max(0, 6 - clampInteger(szDecimals, 0, 12));
  if (Number.isInteger(value)) return String(value);
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const significantDecimals = Math.max(0, 5 - magnitude - 1);
  const decimals = Math.min(maxDecimals, significantDecimals);
  const rounded = Number(value.toFixed(decimals));
  if (rounded <= 0) throw new Error("Order price is below Hyperliquid's tick size for this market.");
  return trimFixed(rounded, decimals);
}

function createInfoClient(config: HyperliquidBuilderConfig) {
  return new InfoClient({ transport: createTransport(config) });
}

function createExchangeClient(config: HyperliquidBuilderConfig, wallet: LocalEvmAccount) {
  return new ExchangeClient({ transport: createTransport(config), wallet });
}

function createTransport(config: HyperliquidBuilderConfig) {
  return new HttpTransport({
    isTestnet: config.isTestnet,
    apiUrl: config.apiUrl,
    timeout: 30_000,
    fetchOptions: { cache: "no-store" },
  });
}

async function buildHyperliquidOrderDraft(input: HyperliquidOrderInput): Promise<HyperliquidOrderDraft> {
  const config = await readHyperliquidBuilderConfig();
  const client = createInfoClient(config);
  const [meta, mids] = await Promise.all([client.meta(), client.allMids()]);
  const market = resolvePerpMarket(meta, input.coin);
  const midPrice = Number((mids as Record<string, string>)[market.coin] || 0);
  if (!Number.isFinite(midPrice) || midPrice <= 0) throw new Error(`No live Hyperliquid mid price is available for ${market.coin}.`);

  const side = normalizeSide(input.side);
  const orderType = input.orderType === "limit" ? "limit" : "market";
  const rawPrice = orderType === "limit"
    ? positiveNumber(input.limitPrice, "Limit price")
    : marketExecutionPrice(midPrice, side, input.slippageBps);
  const price = formatHyperliquidPerpPrice(rawPrice, market.szDecimals);
  const size = input.size && Number(input.size) > 0
    ? formatHyperliquidSize(Number(input.size), market.szDecimals)
    : formatHyperliquidSize(positiveNumber(input.notionalUsd, "Notional USD") / Number(price), market.szDecimals);
  const notionalUsd = Number(size) * midPrice;
  const timeInForce = orderType === "market" ? "Ioc" : "Gtc";
  const order: HyperliquidSdkOrder = {
    a: market.assetId,
    b: side === "long",
    p: price,
    s: size,
    r: Boolean(input.reduceOnly),
    t: { limit: { tif: timeInForce } },
  };
  const builder = config.configured && config.builderAddress && config.builderFeeTenthBps > 0
    ? { b: config.builderAddress, f: config.builderFeeTenthBps }
    : undefined;

  return {
    config,
    client,
    order,
    builder,
    summary: {
      coin: market.coin,
      assetId: market.assetId,
      side,
      orderType,
      timeInForce,
      reduceOnly: Boolean(input.reduceOnly),
      price,
      size,
      midPrice,
      notionalUsd,
    },
  };
}

async function hyperliquidGovernance(input: HyperliquidOrderInput, order: HyperliquidOrderSummary): Promise<{ companyId?: string; approvalGrantId?: string }> {
  const policy = input.policy;
  if (!policy) throw new Error("No authoritative wallet policy is configured for this Hyperliquid order.");
  if (policy.enabled === false) throw new Error("This wallet is disabled.");
  const cap = hyperliquidTradeCapUsd(policy);
  if (cap <= 0) throw new Error("Set a max trade amount on this wallet before enabling Hyperliquid execution.");
  if (!order.reduceOnly && order.notionalUsd > cap + 0.01) {
    throw new Error(`This Hyperliquid order is ~$${order.notionalUsd.toFixed(2)}, over the wallet's $${cap.toFixed(2)} max trade cap.`);
  }

  const governance = await resolveSpendGovernance(input.agentId);
  const spendForGovernance = order.reduceOnly ? 0 : order.notionalUsd;
  if (!governance || !(order.reduceOnly || (await shouldEvaluateSpend(governance.wallet, cap)))) return {};
  const decision = await evaluateSpend({
    wallet: governance.wallet,
    agentName: governance.agentName,
    kind: "trade",
    asset: "USDC",
    amountUsd: spendForGovernance,
    target: `hyperliquid:${order.coin} ${order.side}`,
    approvalToken: input.approvalToken,
  });
  if (decision.decision !== "allow") throw new Error(decision.reason);
  return { companyId: decision.companyId, approvalGrantId: decision.grant?.id };
}

function hyperliquidTradeCapUsd(policy: HyperliquidTradePolicy) {
  const maxTradeUsd = Number(policy.maxTradeUsd) || 0;
  if (maxTradeUsd > 0) return maxTradeUsd;
  return Number(policy.maxPaymentUsd) || 0;
}

function assertEvmSigningAccount(input: Pick<HyperliquidOrderInput, "walletAddress" | "walletNetwork" | "secret">): LocalEvmAccount {
  assertEvmWallet(input.walletNetwork);
  if (!input.secret) throw new Error("No local EVM wallet key is available to sign the Hyperliquid action.");
  const account = evmAccountFromSecret(input.secret);
  const expected = normalizeEvmAddress(input.walletAddress, "Hyperliquid wallet address");
  if (account.address.toLowerCase() !== expected) {
    throw new Error(`Local signing key ${shortAddress(account.address)} does not match selected wallet ${shortAddress(expected)}.`);
  }
  return account;
}

function assertEvmWallet(network: string) {
  if (!String(network || "").startsWith("eip155:")) {
    throw new Error("Hyperliquid trading requires a local EVM wallet.");
  }
}

function evmAccountFromSecret(secret: string): LocalEvmAccount {
  const trimmed = secret.trim();
  const compactPrivateKey = trimmed.replace(/^0x/i, "");
  if (/^[a-fA-F0-9]{64}$/.test(compactPrivateKey)) {
    return privateKeyToAccount(`0x${compactPrivateKey}`);
  }
  const mnemonic = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (validateMnemonic(mnemonic, englishWordlist)) {
    return mnemonicToAccount(mnemonic, { path: EVM_DERIVATION_PATH });
  }
  throw new Error("Stored Hyperliquid wallet secret is not an EVM private key or BIP-39 mnemonic.");
}

function resolvePerpMarket(meta: MetaResponse, coinInput: string) {
  const coin = normalizeCoin(coinInput);
  const assetId = meta.universe.findIndex((asset) => asset.name.toUpperCase() === coin && !asset.isDelisted);
  if (assetId < 0) {
    const active = meta.universe.filter((asset) => !asset.isDelisted).slice(0, 20).map((asset) => asset.name).join(", ");
    throw new Error(`Unknown Hyperliquid perp "${coinInput}". Try one of: ${active}.`);
  }
  const asset = meta.universe[assetId];
  return { assetId, coin: asset.name, szDecimals: asset.szDecimals };
}

function normalizeCoin(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[-_/\s]*(PERP|USD|USDC)$/i, "");
  if (!/^[A-Z0-9]+$/.test(normalized)) throw new Error("Enter a Hyperliquid perp symbol such as BTC, ETH, SOL, or HYPE.");
  return normalized;
}

function normalizeSide(value: string): HyperliquidSide {
  const side = value.trim().toLowerCase();
  if (["short", "sell"].includes(side)) return "short";
  if (["long", "buy"].includes(side)) return "long";
  throw new Error("Hyperliquid side must be long or short.");
}

function marketExecutionPrice(midPrice: number, side: HyperliquidSide, slippageBps: number | undefined) {
  const bps = Math.min(500, Math.max(0, Number(slippageBps) || DEFAULT_HYPERLIQUID_MARKET_SLIPPAGE_BPS));
  const multiplier = side === "long" ? 1 + bps / 10_000 : 1 - bps / 10_000;
  return midPrice * multiplier;
}

function summarizePositions(state: ClearinghouseStateResponse): HyperliquidPositionSummary[] {
  return state.assetPositions.map((item) => {
    const position = item.position;
    const size = Number(position.szi) || 0;
    const side: HyperliquidPositionSummary["side"] = size > 0 ? "long" : size < 0 ? "short" : "flat";
    const leverage = typeof position.leverage === "object" && position.leverage ? Number(position.leverage.value) || undefined : undefined;
    return {
      coin: position.coin,
      side,
      size,
      entryPrice: numericString(position.entryPx),
      positionValueUsd: numericString(position.positionValue),
      unrealizedPnlUsd: numericString(position.unrealizedPnl),
      liquidationPrice: numericString(position.liquidationPx),
      leverage,
      marginMode: typeof position.leverage === "object" && position.leverage ? String(position.leverage.type) : undefined,
    };
  }).filter((position) => position.size !== 0);
}

function orderDetail(
  order: HyperliquidOrderSummary,
  builder: HyperliquidBuilder | undefined,
  config: HyperliquidBuilderConfig,
  approval: HyperliquidBuilderApprovalStatus,
) {
  const builderDetail = builder
    ? ` Builder fee ${formatBuilderFee(Number(builder.f))} to ${shortAddress(builder.b)}; ${approval.approved ? "approval is active" : "approval is required"}.`
    : config.missing.length
      ? ` Builder codes are disabled: ${config.missing.join(" ")}`
      : "";
  return `${order.orderType} ${order.side} ${order.size} ${order.coin} near ${order.price} (~$${order.notionalUsd.toFixed(2)}) on Hyperliquid ${config.isTestnet ? "testnet" : "mainnet"}.${builderDetail}`;
}

function orderReference(statuses: OrderSuccessResponse["response"]["data"]["statuses"]) {
  const status = statuses[0];
  if (typeof status === "object" && status && "filled" in status) return `Filled order ${status.filled.oid}`;
  if (typeof status === "object" && status && "resting" in status) return `Resting order ${status.resting.oid}`;
  return "Order accepted";
}

function parseBuilderFeeTenthBps(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be an integer number of tenths of a basis point.`);
  if (parsed > MAX_HYPERLIQUID_PERP_BUILDER_FEE_TENTH_BPS) {
    throw new Error(`${label} must be <= ${MAX_HYPERLIQUID_PERP_BUILDER_FEE_TENTH_BPS} for Hyperliquid perps.`);
  }
  return parsed;
}

function normalizeEvmAddress(value: string, label: string): BuilderAddress {
  const address = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error(`${label} must be a 0x EVM address.`);
  return address as BuilderAddress;
}

function positiveNumber(value: unknown, label: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${label} must be greater than zero.`);
  return numeric;
}

function numericString(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

async function fetchHyperliquidBuilderPolicy(url: string): Promise<HostedHyperliquidBuilderPolicy | null> {
  const now = Date.now();
  if (builderPolicyCache && builderPolicyCache.expiresAt > now) return builderPolicyCache.policy;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Official Hyperliquid builder policy returned HTTP ${response.status}.`);
  const parsed = (await response.json().catch(() => null)) as HostedHyperliquidBuilderPolicy | null;
  builderPolicyCache = { expiresAt: now + POLICY_CACHE_MS, policy: parsed };
  return parsed;
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function booleanFrom(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePolicyNetwork(value: unknown) {
  return String(value || "").trim().toLowerCase() === "testnet";
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)));
}

function trimFixed(value: number, decimals: number) {
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function shortAddress(value?: string) {
  if (!value) return "(none)";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
