import "server-only";

import net from "node:net";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import type {
  ApproveBuilderFeeSuccessResponse,
  CancelSuccessResponse,
  ModifySuccessResponse,
  OrderParameters,
  OrderSuccessResponse,
  ScheduleCancelSuccessResponse,
  SpotSendSuccessResponse,
  TwapCancelSuccessResponse,
  TwapOrderSuccessResponse,
  UpdateIsolatedMarginSuccessResponse,
  UpdateLeverageSuccessResponse,
  UsdClassTransferSuccessResponse,
  UsdSendSuccessResponse,
  Withdraw3SuccessResponse,
} from "@nktkas/hyperliquid/api/exchange";
import type {
  ClearinghouseStateResponse,
  FrontendOpenOrdersResponse,
  MetaResponse,
  OrderStatusResponse,
  SpotClearinghouseStateResponse,
  SpotMetaResponse,
  UserFeesResponse,
  UserFillsResponse,
} from "@nktkas/hyperliquid/api/info";
import { validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";
import { evaluateSpend, resolveSpendGovernance, shouldEvaluateSpend } from "@/lib/services/wallet/spend-governance";
import { hyperliquidOrderReasoning, hyperliquidValueTransferReasoning } from "@/lib/services/trading/hyperliquid-reasoning";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
type CompanyTaskSpendContext = { companyTaskId?: string };
// Match the wider connection window used by the local swap rail. Hyperliquid's
// API is latency sensitive, but a too-small happy-eyeballs timeout can fail
// before this network has completed a viable TCP handshake.
(net as unknown as { setDefaultAutoSelectFamilyAttemptTimeout?: (ms: number) => void })
  .setDefaultAutoSelectFamilyAttemptTimeout?.(3000);

export const HYPERLIQUID_ORDER_CONFIRMATION = "CONFIRM_HYPERLIQUID_ORDER";
export const HYPERLIQUID_BUILDER_CONFIRMATION = "CONFIRM_HYPERLIQUID_BUILDER";
export const HYPERLIQUID_CANCEL_CONFIRMATION = "CONFIRM_HYPERLIQUID_CANCEL";
export const HYPERLIQUID_ACCOUNT_CONFIRMATION = "CONFIRM_HYPERLIQUID_ACCOUNT";
export const HYPERLIQUID_TRANSFER_CONFIRMATION = "CONFIRM_HYPERLIQUID_TRANSFER";
export const HYPERLIQUID_TWAP_CONFIRMATION = "CONFIRM_HYPERLIQUID_TWAP";
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
export type HyperliquidMarketType = "perp" | "spot";
export type HyperliquidSide = "long" | "short" | "buy" | "sell";
export type HyperliquidOrderType = "market" | "limit" | "trigger";
export type HyperliquidTimeInForce = "Gtc" | "Ioc" | "Alo" | "FrontendMarket";
export type HyperliquidTriggerType = "tp" | "sl";
export type HyperliquidOrderGrouping = "na" | "normalTpsl" | "positionTpsl";
export type HyperliquidTransferType = "usd-class" | "usd-send" | "spot-send" | "withdraw";
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
  marketType?: HyperliquidMarketType;
  side: HyperliquidSide | string;
  notionalUsd?: number;
  size?: number;
  orderType?: HyperliquidOrderType;
  limitPrice?: number;
  timeInForce?: HyperliquidTimeInForce | string;
  triggerPx?: number;
  triggerType?: HyperliquidTriggerType | string;
  triggerIsMarket?: boolean;
  grouping?: HyperliquidOrderGrouping | string;
  clientOrderId?: string;
  reduceOnly?: boolean;
  slippageBps?: number;
  confirmation?: string;
  approvalToken?: string;
} & CompanyTaskSpendContext;

export type HyperliquidOrderSummary = {
  coin: string;
  assetId: number;
  marketType: HyperliquidMarketType;
  side: HyperliquidSide;
  orderType: HyperliquidOrderType;
  timeInForce?: HyperliquidTimeInForce;
  triggerPx?: string;
  triggerType?: HyperliquidTriggerType;
  triggerIsMarket?: boolean;
  grouping: HyperliquidOrderGrouping;
  clientOrderId?: string;
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

export type HyperliquidSpotBalanceSummary = {
  coin: string;
  token?: number;
  total: number;
  hold: number;
  available: number;
  entryNotionalUsd?: number;
};

export type HyperliquidAccountStatus = {
  ok: true;
  network: "mainnet" | "testnet";
  walletAddress: string;
  accountValueUsd?: number;
  withdrawableUsd?: number;
  positions: HyperliquidPositionSummary[];
  spotBalances: HyperliquidSpotBalanceSummary[];
  openOrders: FrontendOpenOrdersResponse;
  builderConfig: HyperliquidBuilderConfig;
  builderApproval: HyperliquidBuilderApprovalStatus;
  detail: string;
};

export type HyperliquidReadResult = {
  ok: true;
  network: "mainnet" | "testnet";
  walletAddress: string;
  action: "open-orders" | "fills" | "fees" | "order-status";
  openOrders?: FrontendOpenOrdersResponse;
  fills?: UserFillsResponse;
  fees?: UserFeesResponse;
  status?: OrderStatusResponse;
  detail: string;
};

export type HyperliquidSignedActionResult = {
  ok: true;
  network: "mainnet" | "testnet";
  walletAddress: string;
  action: "cancel" | "cancel-by-cloid" | "modify" | "schedule-cancel" | "leverage" | "margin" | "usd-class" | "usd-send" | "spot-send" | "withdraw" | "twap-order" | "twap-cancel";
  response: CancelSuccessResponse | ModifySuccessResponse | ScheduleCancelSuccessResponse | UpdateLeverageSuccessResponse | UpdateIsolatedMarginSuccessResponse | UsdClassTransferSuccessResponse | UsdSendSuccessResponse | SpotSendSuccessResponse | Withdraw3SuccessResponse | TwapOrderSuccessResponse | TwapCancelSuccessResponse;
  order?: HyperliquidOrderSummary;
  reference?: string;
  detail: string;
};

export type HyperliquidSignedActionInput = {
  agentId: string;
  walletAddress: string;
  walletNetwork: string;
  secret?: string;
  policy?: HyperliquidTradePolicy;
  coin: string;
  marketType?: HyperliquidMarketType;
  assetId?: number;
  side: HyperliquidSide | string;
  notionalUsd?: number;
  size?: number;
  orderType?: HyperliquidOrderType;
  limitPrice?: number;
  timeInForce?: HyperliquidTimeInForce | string;
  triggerPx?: number;
  triggerType?: HyperliquidTriggerType | string;
  triggerIsMarket?: boolean;
  grouping?: HyperliquidOrderGrouping | string;
  clientOrderId?: string;
  reduceOnly?: boolean;
  slippageBps?: number;
  orderId?: number | string;
  cloid?: string;
  fastCancel?: boolean;
  alwaysPlace?: boolean;
  scheduleCancelTime?: number | null;
  leverage?: number;
  marginMode?: "cross" | "isolated" | string;
  isCross?: boolean;
  marginDeltaUsd?: number;
  transferType?: HyperliquidTransferType | string;
  amount?: number;
  amountUsd?: number;
  destination?: string;
  token?: string;
  toPerp?: boolean;
  twapMinutes?: number;
  twapRandomize?: boolean;
  twapId?: number | string;
  confirmation?: string;
  approvalToken?: string;
} & CompanyTaskSpendContext;

type HyperliquidOrderDraft = {
  config: HyperliquidBuilderConfig;
  client: InfoClient;
  order: HyperliquidSdkOrder;
  builder?: HyperliquidBuilder;
  grouping: HyperliquidOrderGrouping;
  summary: HyperliquidOrderSummary;
};

type HyperliquidMarket = {
  assetId: number;
  coin: string;
  marketType: HyperliquidMarketType;
  szDecimals: number;
  midKeys: string[];
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
    ? `Official HivemindOS Hyperliquid ${isTestnet ? "testnet" : "mainnet"} builder ${shortAddress(builderAddress)} charges ${formatBuilderFee(builderFeeTenthBps)} per eligible fill.`
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
    grouping: draft.grouping,
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
    target: shortTarget(`hyperliquid:${draft.summary.marketType}:${draft.summary.coin} ${draft.summary.side}`),
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
    detail: `Placed ${draft.summary.marketType} ${draft.summary.side} ${draft.summary.size} ${draft.summary.coin} at ${draft.summary.price} on Hyperliquid. ${reference}.`,
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
  const [stateResult, spotStateResult, openOrdersResult, approval] = await Promise.all([
    client.clearinghouseState({ user: walletAddress }),
    client.spotClearinghouseState({ user: walletAddress }),
    client.frontendOpenOrders({ user: walletAddress }),
    getHyperliquidBuilderApprovalStatus({ walletAddress, config, client }),
  ]);
  const state = stateResult as ClearinghouseStateResponse;
  const spotState = spotStateResult as SpotClearinghouseStateResponse;
  const positions = summarizePositions(state);
  const spotBalances = summarizeSpotBalances(spotState);
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    accountValueUsd: numericString(state.marginSummary?.accountValue),
    withdrawableUsd: numericString(state.withdrawable),
    positions,
    spotBalances,
    openOrders: openOrdersResult,
    builderConfig: config,
    builderApproval: approval,
    detail: `Hyperliquid ${config.isTestnet ? "testnet" : "mainnet"} account ${shortAddress(walletAddress)} has ${positions.length} open perp position${positions.length === 1 ? "" : "s"} and ${spotBalances.length} spot balance${spotBalances.length === 1 ? "" : "s"}.`,
  };
}

export async function getHyperliquidOpenOrders(input: {
  walletAddress: string;
  walletNetwork: string;
}): Promise<HyperliquidReadResult> {
  const { config, client, walletAddress } = await readContext(input);
  const openOrders = await client.frontendOpenOrders({ user: walletAddress });
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    action: "open-orders",
    openOrders,
    detail: `Found ${openOrders.length} open Hyperliquid order${openOrders.length === 1 ? "" : "s"} for ${shortAddress(walletAddress)}.`,
  };
}

export async function getHyperliquidFills(input: {
  walletAddress: string;
  walletNetwork: string;
  aggregateByTime?: boolean;
}): Promise<HyperliquidReadResult> {
  const { config, client, walletAddress } = await readContext(input);
  const fills = await client.userFills({ user: walletAddress, aggregateByTime: Boolean(input.aggregateByTime) });
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    action: "fills",
    fills,
    detail: `Loaded ${fills.length} recent Hyperliquid fill${fills.length === 1 ? "" : "s"} for ${shortAddress(walletAddress)}.`,
  };
}

export async function getHyperliquidFees(input: {
  walletAddress: string;
  walletNetwork: string;
}): Promise<HyperliquidReadResult> {
  const { config, client, walletAddress } = await readContext(input);
  const fees = await client.userFees({ user: walletAddress });
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    action: "fees",
    fees,
    detail: `Loaded Hyperliquid fee schedule for ${shortAddress(walletAddress)}.`,
  };
}

export async function getHyperliquidOrderStatus(input: {
  walletAddress: string;
  walletNetwork: string;
  orderId?: number | string;
  cloid?: string;
}): Promise<HyperliquidReadResult> {
  const { config, client, walletAddress } = await readContext(input);
  const oid = normalizeOid(input.orderId ?? input.cloid, "Hyperliquid order id");
  const status = await client.orderStatus({ user: walletAddress, oid });
  const label = status.status === "order" ? status.order.status : "unknown order";
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    action: "order-status",
    status,
    detail: `Hyperliquid order ${String(oid)} is ${label}.`,
  };
}

export async function executeHyperliquidCancel(input: HyperliquidSignedActionInput): Promise<HyperliquidSignedActionResult> {
  assertConfirmation(input.confirmation, HYPERLIQUID_CANCEL_CONFIRMATION, "Hyperliquid cancels");
  assertHyperliquidPolicy(input.policy, "Hyperliquid cancel");
  const { config, exchangeClient, infoClient, walletAddress } = await signedContext(input);
  const assetId = await resolveActionAssetId(infoClient, input);
  const fastCancel = input.fastCancel ? { f: true as const } : {};
  const response = input.cloid
    ? await exchangeClient.cancelByCloid({
        cancels: [{ asset: assetId, cloid: normalizeCloid(input.cloid) }],
        ...fastCancel,
      })
    : await exchangeClient.cancel({
        cancels: [{ a: assetId, o: normalizePositiveInteger(input.orderId, "Hyperliquid order id") }],
        ...fastCancel,
      });
  assertCancelStatuses(response);
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    action: input.cloid ? "cancel-by-cloid" : "cancel",
    response,
    detail: `Canceled Hyperliquid ${input.cloid ? `client order ${input.cloid}` : `order ${input.orderId}`} on asset ${assetId}.`,
  };
}

export async function executeHyperliquidModify(input: HyperliquidSignedActionInput): Promise<HyperliquidSignedActionResult> {
  assertConfirmation(input.confirmation, HYPERLIQUID_ORDER_CONFIRMATION, "Hyperliquid order modifications");
  const draft = await buildHyperliquidOrderDraft(orderInputFromSigned(input));
  const governance = await hyperliquidGovernance(orderInputFromSigned(input), draft.summary);
  const { exchangeClient, walletAddress } = await signedContext(input, draft.config);
  const oid = normalizeOid(input.orderId ?? input.cloid, "Hyperliquid order id to modify");
  const params = input.alwaysPlace ? { oid, order: draft.order, a: true as const } : { oid, order: draft.order };
  const response = await exchangeClient.modify(params);
  return {
    ok: true,
    network: draft.config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    action: "modify",
    response,
    order: draft.summary,
    reference: governance.approvalGrantId,
    detail: `Modified Hyperliquid order ${String(oid)} to ${draft.summary.side} ${draft.summary.size} ${draft.summary.coin} at ${draft.summary.price}.`,
  };
}

export async function executeHyperliquidScheduleCancel(input: HyperliquidSignedActionInput): Promise<HyperliquidSignedActionResult> {
  assertConfirmation(input.confirmation, HYPERLIQUID_CANCEL_CONFIRMATION, "Hyperliquid scheduled cancels");
  assertHyperliquidPolicy(input.policy, "Hyperliquid scheduled cancel");
  const { config, exchangeClient, walletAddress } = await signedContext(input);
  const time = input.scheduleCancelTime === null || input.scheduleCancelTime === undefined
    ? undefined
    : normalizeScheduleCancelTime(input.scheduleCancelTime);
  const response = time ? await exchangeClient.scheduleCancel({ time }) : await exchangeClient.scheduleCancel();
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    action: "schedule-cancel",
    response,
    detail: time ? `Scheduled Hyperliquid cancel-all for ${new Date(time).toISOString()}.` : "Cleared Hyperliquid scheduled cancel-all.",
  };
}

export async function executeHyperliquidLeverage(input: HyperliquidSignedActionInput): Promise<HyperliquidSignedActionResult> {
  assertConfirmation(input.confirmation, HYPERLIQUID_ACCOUNT_CONFIRMATION, "Hyperliquid leverage updates");
  assertHyperliquidPolicy(input.policy, "Hyperliquid leverage update");
  const { config, exchangeClient, infoClient, walletAddress } = await signedContext(input);
  const market = resolvePerpMarket(await infoClient.meta(), requiredString(input.coin, "A Hyperliquid perp symbol is required."));
  const leverage = clampInteger(positiveNumber(input.leverage, "Leverage"), 1, 100);
  const isCross = normalizeMarginMode(input.marginMode, input.isCross);
  const response = await exchangeClient.updateLeverage({ asset: market.assetId, isCross, leverage });
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    action: "leverage",
    response,
    detail: `Set ${market.coin} ${isCross ? "cross" : "isolated"} leverage to ${leverage}x on Hyperliquid.`,
  };
}

export async function executeHyperliquidMargin(input: HyperliquidSignedActionInput): Promise<HyperliquidSignedActionResult> {
  assertConfirmation(input.confirmation, HYPERLIQUID_ACCOUNT_CONFIRMATION, "Hyperliquid isolated margin updates");
  assertHyperliquidPolicy(input.policy, "Hyperliquid isolated margin update");
  const { config, exchangeClient, infoClient, walletAddress } = await signedContext(input);
  const market = resolvePerpMarket(await infoClient.meta(), requiredString(input.coin, "A Hyperliquid perp symbol is required."));
  const side = normalizeOrderSide(input.side || "long", "perp");
  const marginDeltaUsd = signedNumber(input.marginDeltaUsd, "Margin delta USD");
  if (Math.abs(marginDeltaUsd) < 0.000001) throw new Error("Margin delta USD must not be zero.");
  const governance = marginDeltaUsd > 0
    ? await hyperliquidAmountGovernance(input, marginDeltaUsd, `hyperliquid:margin:${market.coin}`)
    : {};
  const response = await exchangeClient.updateIsolatedMargin({
    asset: market.assetId,
    isBuy: side === "long",
    ntli: Math.round(marginDeltaUsd * 1e6),
  });
  await appendHyperliquidSpend(input, governance, Math.max(0, marginDeltaUsd), `hyperliquid:margin:${market.coin}`, marginDeltaUsd);
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    action: "margin",
    response,
    detail: `${marginDeltaUsd > 0 ? "Added" : "Removed"} $${Math.abs(marginDeltaUsd).toFixed(2)} isolated margin for ${market.coin} ${side}.`,
  };
}

export async function executeHyperliquidTransfer(input: HyperliquidSignedActionInput): Promise<HyperliquidSignedActionResult> {
  assertConfirmation(input.confirmation, HYPERLIQUID_TRANSFER_CONFIRMATION, "Hyperliquid transfers and withdrawals");
  assertHyperliquidPolicy(input.policy, "Hyperliquid transfer");
  const { config, exchangeClient, walletAddress } = await signedContext(input);
  const transferType = normalizeTransferType(input.transferType);
  const amount = positiveNumber(input.amount ?? input.amountUsd, "Transfer amount");
  const amountText = formatDecimalAmount(amount);
  const amountUsd = estimateTransferUsd(input, amount);
  const governance = await hyperliquidAmountGovernance(input, amountUsd, `hyperliquid:${transferType}:${input.destination || "internal"}`);

  if (transferType === "usd-class") {
    const response = await exchangeClient.usdClassTransfer({ amount: amountText, toPerp: input.toPerp !== false });
    await appendHyperliquidSpend(input, governance, amountUsd, "hyperliquid:usd-class", amount);
    return signedTransferResult(config, walletAddress, "usd-class", response, `Moved ${amountText} USDC ${input.toPerp === false ? "from perps to spot" : "from spot to perps"} on Hyperliquid.`);
  }

  const destination = normalizeEvmAddress(requiredString(input.destination, "A destination address is required."), "Hyperliquid destination");
  if (transferType === "usd-send") {
    const response = await exchangeClient.usdSend({ destination, amount: amountText });
    await appendHyperliquidSpend(input, governance, amountUsd, `hyperliquid:usd-send:${destination}`, amount);
    return signedTransferResult(config, walletAddress, "usd-send", response, `Sent ${amountText} USDC to ${shortAddress(destination)} on Hyperliquid.`);
  }
  if (transferType === "withdraw") {
    const response = await exchangeClient.withdraw3({ destination, amount: amountText });
    await appendHyperliquidSpend(input, governance, amountUsd, `hyperliquid:withdraw:${destination}`, amount);
    return signedTransferResult(config, walletAddress, "withdraw", response, `Requested ${amountText} USDC withdrawal to ${shortAddress(destination)} from Hyperliquid.`);
  }

  const token = requiredString(input.token, "A Hyperliquid spot token id is required, such as USDC:0x...");
  const response = await exchangeClient.spotSend({ destination, token, amount: amountText });
  await appendHyperliquidSpend(input, governance, amountUsd, `hyperliquid:spot-send:${destination}`, amount);
  return signedTransferResult(config, walletAddress, "spot-send", response, `Sent ${amountText} ${token.split(":")[0] || "spot"} to ${shortAddress(destination)} on Hyperliquid.`);
}

export async function executeHyperliquidTwapOrder(input: HyperliquidSignedActionInput): Promise<HyperliquidSignedActionResult> {
  assertConfirmation(input.confirmation, HYPERLIQUID_TWAP_CONFIRMATION, "Hyperliquid TWAP orders");
  const config = await readHyperliquidBuilderConfig();
  const infoClient = createInfoClient(config);
  const market = await resolveMarket(infoClient, normalizeMarketType(input.marketType), requiredString(input.coin, "A Hyperliquid market symbol is required."));
  const midPrice = await marketMidPrice(infoClient, market);
  const side = normalizeOrderSide(input.side || "long", market.marketType);
  const size = input.size && Number(input.size) > 0
    ? formatHyperliquidSize(Number(input.size), market.szDecimals)
    : formatHyperliquidSize(positiveNumber(input.notionalUsd, "Notional USD") / midPrice, market.szDecimals);
  const notionalUsd = Number(size) * midPrice;
  const summary: HyperliquidOrderSummary = {
    coin: market.coin,
    assetId: market.assetId,
    marketType: market.marketType,
    side,
    orderType: "market",
    grouping: "na",
    reduceOnly: Boolean(input.reduceOnly) && market.marketType === "perp",
    price: formatHyperliquidPerpPrice(midPrice, market.szDecimals),
    size,
    midPrice,
    notionalUsd,
  };
  const orderInput = { ...orderInputFromSigned({ ...input, coin: market.coin }), policy: input.policy };
  const governance = await hyperliquidGovernance(orderInput, summary);
  const { exchangeClient, walletAddress } = await signedContext(input, config);
  const response = await exchangeClient.twapOrder({
    twap: {
      a: market.assetId,
      b: sideIsBuy(side),
      s: size,
      r: summary.reduceOnly,
      m: clampInteger(positiveNumber(input.twapMinutes ?? 5, "TWAP minutes"), 5, 1440),
      t: Boolean(input.twapRandomize),
    },
  });
  await appendHyperliquidSpend(input, governance, summary.reduceOnly ? 0 : notionalUsd, `hyperliquid:twap:${market.coin}`, notionalUsd);
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    action: "twap-order",
    response,
    order: summary,
    detail: `Placed TWAP ${summary.side} ${summary.size} ${summary.coin} over ${input.twapMinutes ?? 5} minutes on Hyperliquid.`,
  };
}

export async function executeHyperliquidTwapCancel(input: HyperliquidSignedActionInput): Promise<HyperliquidSignedActionResult> {
  assertConfirmation(input.confirmation, HYPERLIQUID_TWAP_CONFIRMATION, "Hyperliquid TWAP cancels");
  assertHyperliquidPolicy(input.policy, "Hyperliquid TWAP cancel");
  const { config, exchangeClient, infoClient, walletAddress } = await signedContext(input);
  const assetId = await resolveActionAssetId(infoClient, input);
  const twapId = normalizePositiveInteger(input.twapId, "Hyperliquid TWAP id");
  const response = await exchangeClient.twapCancel({ a: assetId, t: twapId });
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    action: "twap-cancel",
    response,
    detail: `Canceled Hyperliquid TWAP ${twapId} on asset ${assetId}.`,
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
  const marketType = normalizeMarketType(input.marketType);
  const market = await resolveMarket(client, marketType, input.coin);
  const midPrice = await marketMidPrice(client, market);
  const side = normalizeOrderSide(input.side, market.marketType);
  const orderType = normalizeOrderType(input.orderType);
  const timeInForce = normalizeTimeInForce(input.timeInForce, orderType);
  const trigger = orderType === "trigger"
    ? {
        isMarket: input.triggerIsMarket !== false,
        triggerPx: formatHyperliquidPerpPrice(positiveNumber(input.triggerPx, "Trigger price"), market.szDecimals),
        tpsl: normalizeTriggerType(input.triggerType),
      }
    : undefined;
  const rawPrice = orderType === "limit" || (trigger && !trigger.isMarket)
    ? positiveNumber(input.limitPrice, "Limit price")
    : marketExecutionPrice(midPrice, side, input.slippageBps);
  const price = formatHyperliquidPerpPrice(rawPrice, market.szDecimals);
  const size = input.size && Number(input.size) > 0
    ? formatHyperliquidSize(Number(input.size), market.szDecimals)
    : formatHyperliquidSize(positiveNumber(input.notionalUsd, "Notional USD") / Number(price), market.szDecimals);
  const notionalUsd = Number(size) * midPrice;
  const reduceOnly = market.marketType === "perp" && Boolean(input.reduceOnly);
  if (market.marketType === "spot" && input.reduceOnly) throw new Error("Reduce-only only applies to Hyperliquid perps; spot sell orders sell available spot balance.");
  const grouping = normalizeGrouping(input.grouping, orderType);
  const order: HyperliquidSdkOrder = {
    a: market.assetId,
    b: sideIsBuy(side),
    p: price,
    s: size,
    r: reduceOnly,
    t: trigger ? { trigger } : { limit: { tif: timeInForce } },
  };
  const clientOrderId = normalizeOptionalCloid(input.clientOrderId, "Client order id");
  if (clientOrderId) order.c = clientOrderId;
  const builder = config.configured && config.builderAddress && config.builderFeeTenthBps > 0
    ? { b: config.builderAddress, f: config.builderFeeTenthBps }
    : undefined;

  return {
    config,
    client,
    order,
    builder,
    grouping,
    summary: {
      coin: market.coin,
      assetId: market.assetId,
      marketType: market.marketType,
      side,
      orderType,
      timeInForce: trigger ? undefined : timeInForce,
      triggerPx: trigger?.triggerPx,
      triggerType: trigger?.tpsl,
      triggerIsMarket: trigger?.isMarket,
      grouping,
      clientOrderId,
      reduceOnly,
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
  const governance = await resolveSpendGovernance(input.agentId, { companyTaskId: input.companyTaskId });
  const spendForGovernance = order.reduceOnly ? 0 : order.notionalUsd;
  if (!governance || !(order.reduceOnly || (await shouldEvaluateSpend(governance.wallet, cap, { companyId: governance.companyId })))) return {};
  const decision = await evaluateSpend({
    wallet: governance.wallet,
    agentName: governance.agentName,
    kind: "trade",
    asset: "USDC",
    amountUsd: spendForGovernance,
    target: `hyperliquid:${order.coin} ${order.side}`, approvalToken: input.approvalToken, companyId: governance.companyId,
    explanation: hyperliquidOrderReasoning(order),
  });
  if (decision.decision !== "allow") throw new Error(decision.reason);
  return { companyId: decision.companyId, approvalGrantId: decision.grant?.id };
}

async function hyperliquidAmountGovernance(
  input: HyperliquidSignedActionInput,
  amountUsd: number,
  target: string,
): Promise<{ companyId?: string; approvalGrantId?: string }> {
  const policy = assertHyperliquidPolicy(input.policy, "Hyperliquid value transfer");
  const cap = Number(policy.maxPaymentUsd) || hyperliquidTradeCapUsd(policy);
  if (cap <= 0) throw new Error("Set a max payment amount on this wallet before enabling Hyperliquid value transfers.");
  if (amountUsd > cap + 0.01) {
    throw new Error(`This Hyperliquid action is ~$${amountUsd.toFixed(2)}, over the wallet's $${cap.toFixed(2)} max payment cap.`);
  }
  const governance = await resolveSpendGovernance(input.agentId, { companyTaskId: input.companyTaskId });
  if (!governance || !(await shouldEvaluateSpend(governance.wallet, cap, { companyId: governance.companyId }))) return {};
  const decision = await evaluateSpend({
    wallet: governance.wallet,
    agentName: governance.agentName,
    kind: "trade",
    asset: "USDC",
    amountUsd,
    target, approvalToken: input.approvalToken, companyId: governance.companyId,
    explanation: hyperliquidValueTransferReasoning(amountUsd, target),
  });
  if (decision.decision !== "allow") throw new Error(decision.reason);
  return { companyId: decision.companyId, approvalGrantId: decision.grant?.id };
}

function assertHyperliquidPolicy(policy: HyperliquidTradePolicy | undefined, action: string): HyperliquidTradePolicy {
  if (!policy) throw new Error(`No authoritative wallet policy is configured for this ${action}.`);
  if (policy.enabled === false) throw new Error("This wallet is disabled.");
  return policy;
}

function orderInputFromSigned(input: HyperliquidSignedActionInput): HyperliquidOrderInput {
  return {
    agentId: input.agentId, companyTaskId: input.companyTaskId,
    walletAddress: input.walletAddress,
    walletNetwork: input.walletNetwork,
    secret: input.secret,
    policy: input.policy,
    coin: requiredString(input.coin, "A Hyperliquid market symbol is required."),
    marketType: input.marketType,
    side: input.side || "long",
    notionalUsd: input.notionalUsd,
    size: input.size,
    orderType: input.orderType,
    limitPrice: input.limitPrice,
    timeInForce: input.timeInForce,
    triggerPx: input.triggerPx,
    triggerType: input.triggerType,
    triggerIsMarket: input.triggerIsMarket,
    grouping: input.grouping,
    clientOrderId: input.clientOrderId,
    reduceOnly: input.reduceOnly,
    slippageBps: input.slippageBps,
    confirmation: input.confirmation,
    approvalToken: input.approvalToken,
  };
}

async function appendHyperliquidSpend(
  input: Pick<HyperliquidSignedActionInput, "agentId">,
  governance: { companyId?: string; approvalGrantId?: string },
  amountUsd: number,
  target: string,
  assetAmount?: number,
) {
  await appendSpend({
    agentId: input.agentId,
    companyId: governance.companyId,
    kind: "trade",
    asset: "USDC",
    amountUsd,
    assetAmount,
    target: shortTarget(target),
    status: "executed",
    approvalId: governance.approvalGrantId,
  }).catch(() => {});
}

function signedTransferResult(
  config: HyperliquidBuilderConfig,
  walletAddress: string,
  action: HyperliquidSignedActionResult["action"],
  response: HyperliquidSignedActionResult["response"],
  detail: string,
): HyperliquidSignedActionResult {
  return {
    ok: true,
    network: config.isTestnet ? "testnet" : "mainnet",
    walletAddress,
    action,
    response,
    detail,
  };
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

async function readContext(input: { walletAddress: string; walletNetwork: string }) {
  assertEvmWallet(input.walletNetwork);
  const walletAddress = normalizeEvmAddress(input.walletAddress, "Hyperliquid wallet address");
  const config = await readHyperliquidBuilderConfig();
  return { config, client: createInfoClient(config), walletAddress };
}

async function signedContext(input: Pick<HyperliquidSignedActionInput, "walletAddress" | "walletNetwork" | "secret">, config?: HyperliquidBuilderConfig) {
  const account = assertEvmSigningAccount(input);
  const resolvedConfig = config ?? await readHyperliquidBuilderConfig();
  return {
    config: resolvedConfig,
    infoClient: createInfoClient(resolvedConfig),
    exchangeClient: createExchangeClient(resolvedConfig, account),
    walletAddress: normalizeEvmAddress(input.walletAddress, "Hyperliquid wallet address"),
  };
}

async function resolveMarket(client: InfoClient, marketType: HyperliquidMarketType, coinInput: string): Promise<HyperliquidMarket> {
  return marketType === "spot"
    ? resolveSpotMarket(await client.spotMeta(), coinInput)
    : resolvePerpMarket(await client.meta(), coinInput);
}

function resolvePerpMarket(meta: MetaResponse, coinInput: string): HyperliquidMarket {
  const coin = normalizeCoin(coinInput);
  const assetId = meta.universe.findIndex((asset) => asset.name.toUpperCase() === coin && !asset.isDelisted);
  if (assetId < 0) {
    const active = meta.universe.filter((asset) => !asset.isDelisted).slice(0, 20).map((asset) => asset.name).join(", ");
    throw new Error(`Unknown Hyperliquid perp "${coinInput}". Try one of: ${active}.`);
  }
  const asset = meta.universe[assetId];
  return { assetId, coin: asset.name, marketType: "perp", szDecimals: asset.szDecimals, midKeys: [asset.name] };
}

function resolveSpotMarket(meta: SpotMetaResponse, coinInput: string): HyperliquidMarket {
  const raw = coinInput.trim();
  const normalized = raw.toUpperCase();
  const indexMatch = /^@(\d+)$/.exec(raw);
  const pairMatch = normalized.includes("/")
    ? normalized.split("/").map((part) => part.trim()).filter(Boolean)
    : [normalized.replace(/[-_\s]*(SPOT|USD|USDC)$/i, ""), "USDC"];
  const universe = meta.universe.find((candidate) => {
    if (indexMatch) return candidate.index === Number(indexMatch[1]);
    if (candidate.name.toUpperCase() === normalized) return true;
    const base = meta.tokens.find((token) => token.index === candidate.tokens[0]);
    const quote = meta.tokens.find((token) => token.index === candidate.tokens[1]);
    return base?.name.toUpperCase() === pairMatch[0] && quote?.name.toUpperCase() === pairMatch[1];
  });
  if (!universe) {
    const active = meta.universe.slice(0, 20).map((asset) => asset.name).join(", ");
    throw new Error(`Unknown Hyperliquid spot market "${coinInput}". Try a spot pair such as ${active}.`);
  }
  const base = meta.tokens.find((token) => token.index === universe.tokens[0]);
  const quote = meta.tokens.find((token) => token.index === universe.tokens[1]);
  if (!base) throw new Error(`Hyperliquid spot metadata for "${coinInput}" is missing its base token.`);
  const display = universe.name.startsWith("@") && base && quote ? `${base.name}/${quote.name}` : universe.name;
  return {
    assetId: 10_000 + universe.index,
    coin: display,
    marketType: "spot",
    szDecimals: base.szDecimals,
    midKeys: [universe.name, `@${universe.index}`, display, `${base.name}/${quote?.name || "USDC"}`],
  };
}

async function marketMidPrice(client: InfoClient, market: HyperliquidMarket) {
  const mids = await client.allMids();
  for (const key of market.midKeys) {
    const mid = Number((mids as Record<string, string>)[key]);
    if (Number.isFinite(mid) && mid > 0) return mid;
  }
  throw new Error(`No live Hyperliquid mid price is available for ${market.coin}.`);
}

async function resolveActionAssetId(client: InfoClient, input: Pick<HyperliquidSignedActionInput, "assetId" | "coin" | "marketType">) {
  if (input.assetId !== undefined) return normalizeNonNegativeInteger(input.assetId, "Hyperliquid asset id");
  const coin = requiredString(input.coin, "A Hyperliquid market symbol is required.");
  const market = await resolveMarket(client, normalizeMarketType(input.marketType), coin);
  return market.assetId;
}

function normalizeCoin(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[-_/\s]*(PERP|USD|USDC)$/i, "");
  if (!/^[A-Z0-9]+$/.test(normalized)) throw new Error("Enter a Hyperliquid perp symbol such as BTC, ETH, SOL, or HYPE.");
  return normalized;
}

function normalizeOrderSide(value: string | undefined, marketType: HyperliquidMarketType): HyperliquidSide {
  const side = String(value || "").trim().toLowerCase();
  if (marketType === "spot") {
    if (["buy", "long"].includes(side)) return "buy";
    if (["sell", "short"].includes(side)) return "sell";
    throw new Error("Hyperliquid spot side must be buy or sell.");
  }
  if (["short", "sell"].includes(side)) return "short";
  if (["long", "buy"].includes(side)) return "long";
  throw new Error("Hyperliquid perp side must be long or short.");
}

function sideIsBuy(side: HyperliquidSide) {
  return side === "long" || side === "buy";
}

function normalizeMarketType(value: unknown): HyperliquidMarketType {
  return String(value || "").trim().toLowerCase() === "spot" ? "spot" : "perp";
}

function normalizeOrderType(value: unknown): HyperliquidOrderType {
  const orderType = String(value || "").trim().toLowerCase();
  if (orderType === "trigger") return "trigger";
  if (orderType === "limit") return "limit";
  return "market";
}

function normalizeTimeInForce(value: unknown, orderType: HyperliquidOrderType): HyperliquidTimeInForce {
  const normalized = String(value || "").trim();
  if (["Gtc", "Ioc", "Alo", "FrontendMarket"].includes(normalized)) return normalized as HyperliquidTimeInForce;
  return orderType === "market" ? "Ioc" : "Gtc";
}

function normalizeTriggerType(value: unknown): HyperliquidTriggerType {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "tp" || normalized === "take-profit" || normalized === "take_profit") return "tp";
  if (normalized === "sl" || normalized === "stop-loss" || normalized === "stop_loss") return "sl";
  throw new Error("Trigger orders require triggerType tp or sl.");
}

function normalizeGrouping(value: unknown, orderType: HyperliquidOrderType): HyperliquidOrderGrouping {
  const normalized = String(value || "").trim();
  if (["na", "normalTpsl", "positionTpsl"].includes(normalized)) return normalized as HyperliquidOrderGrouping;
  return orderType === "trigger" ? "normalTpsl" : "na";
}

function marketExecutionPrice(midPrice: number, side: HyperliquidSide, slippageBps: number | undefined) {
  const bps = Math.min(500, Math.max(0, Number(slippageBps) || DEFAULT_HYPERLIQUID_MARKET_SLIPPAGE_BPS));
  const multiplier = sideIsBuy(side) ? 1 + bps / 10_000 : 1 - bps / 10_000;
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

function summarizeSpotBalances(state: SpotClearinghouseStateResponse): HyperliquidSpotBalanceSummary[] {
  return state.balances.map((balance) => {
    const total = Number(balance.total) || 0;
    const hold = Number(balance.hold) || 0;
    const token = "token" in balance ? Number(balance.token) : undefined;
    return {
      coin: balance.coin,
      token: Number.isFinite(token) ? token : undefined,
      total,
      hold,
      available: total - hold,
      entryNotionalUsd: numericString(balance.entryNtl),
    };
  }).filter((balance) => balance.total !== 0 || balance.hold !== 0);
}

function assertConfirmation(actual: string | undefined, expected: string, action: string) {
  if (actual !== expected) {
    throw new Error(`${action} need confirmation. Type ${expected} to continue.`);
  }
}

function assertCancelStatuses(response: CancelSuccessResponse) {
  const errors = (response.response.data.statuses as unknown[])
    .map((status) => typeof status === "object" && status && "error" in status ? String(status.error) : "")
    .filter(Boolean);
  if (errors.length) throw new Error(`Hyperliquid rejected the cancel: ${errors.join("; ")}`);
}

function normalizeOid(value: unknown, label: string): number | `0x${string}` {
  if (typeof value === "string" && value.trim().startsWith("0x")) return normalizeCloid(value);
  return normalizePositiveInteger(value, label);
}

function normalizeCloid(value: unknown): `0x${string}` {
  return normalizeOptionalCloid(value, "Hyperliquid client order id") || (() => {
    throw new Error("Hyperliquid client order id is required.");
  })();
}

function normalizeOptionalCloid(value: unknown, label: string): `0x${string}` | undefined {
  const text = stringFrom(value);
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  if (!/^0x[a-f0-9]{32}$/.test(normalized)) throw new Error(`${label} must be a 16-byte hex string such as 0x00000000000000000000000000000001.`);
  return normalized as `0x${string}`;
}

function normalizePositiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function normalizeNonNegativeInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer.`);
  return parsed;
}

function normalizeScheduleCancelTime(value: unknown) {
  const parsed = normalizePositiveInteger(value, "Schedule cancel time");
  if (parsed < Date.now() + 5_000) throw new Error("Hyperliquid schedule-cancel time must be at least 5 seconds in the future.");
  return parsed;
}

function normalizeMarginMode(value: unknown, isCross?: boolean) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "isolated") return false;
  if (normalized === "cross") return true;
  return isCross !== false;
}

function normalizeTransferType(value: unknown): HyperliquidTransferType {
  const normalized = String(value || "").trim().toLowerCase();
  if (["usd-send", "usdc-send", "send-usdc"].includes(normalized)) return "usd-send";
  if (["spot-send", "send-spot"].includes(normalized)) return "spot-send";
  if (["withdraw", "withdrawal"].includes(normalized)) return "withdraw";
  return "usd-class";
}

function estimateTransferUsd(input: HyperliquidSignedActionInput, amount: number) {
  const explicit = Number(input.amountUsd);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const transferType = normalizeTransferType(input.transferType);
  if (transferType === "spot-send") {
    const token = String(input.token || "").trim().toUpperCase();
    if (token.startsWith("USDC:") || token === "USDC") return amount;
    throw new Error("Set amountUsd for non-USDC spot sends so wallet caps can be enforced.");
  }
  return amount;
}

function formatDecimalAmount(value: number) {
  return trimFixed(value, 8);
}

function signedNumber(value: unknown, label: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`${label} must be a number.`);
  return numeric;
}

function requiredString(value: unknown, label: string) {
  const text = stringFrom(value);
  if (!text) throw new Error(label);
  return text;
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
  const trigger = order.triggerPx ? ` trigger ${order.triggerType?.toUpperCase()} at ${order.triggerPx}` : "";
  return `${order.marketType} ${order.orderType} ${order.side} ${order.size} ${order.coin} near ${order.price}${trigger} (~$${order.notionalUsd.toFixed(2)}) on Hyperliquid ${config.isTestnet ? "testnet" : "mainnet"}.${builderDetail}`;
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
