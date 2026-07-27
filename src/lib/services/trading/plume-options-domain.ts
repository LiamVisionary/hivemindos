import { encodeAbiParameters, formatUnits, keccak256, parseUnits } from "viem";

import type { PlumeOptionKind } from "@/lib/config/plume-options";

export const PLUME_ACTION_CONFIRMATIONS = {
  write: "CONFIRM_OPTION_WRITE",
  buy: "CONFIRM_OPTION_BUY",
  cancel: "CONFIRM_OPTION_CANCEL",
  "buy-to-close": "CONFIRM_OPTION_CLOSE",
  exercise: "CONFIRM_OPTION_EXERCISE",
  settle: "CONFIRM_OPTION_SETTLE",
  "settle-worthless": "CONFIRM_OPTION_SETTLE_WORTHLESS",
  redeem: "CONFIRM_OPTION_REDEEM",
  reclaim: "CONFIRM_OPTION_RECLAIM",
} as const;

export type PlumeOptionActionName = keyof typeof PLUME_ACTION_CONFIRMATIONS;
export type PlumeOptionSymbol = "TSLA" | "AMD";

type PlumeActionBase = {
  action: PlumeOptionActionName;
  symbol: string;
  kind: PlumeOptionKind;
};

export type PlumeOptionAction =
  | (PlumeActionBase & {
    action: "write";
    strikePrice: string;
    expiry: number;
    amount: string;
    premiumPerOption: string;
  })
  | (PlumeActionBase & {
    action: "buy";
    offerId: string;
    amount: string;
    /** Read from the contract by the server; never trusted as price authority. */
    listedPremiumPerOptionAtomic?: string;
  })
  | (PlumeActionBase & { action: "cancel"; offerId: string; amount: string })
  | (PlumeActionBase & { action: "buy-to-close" | "exercise" | "redeem"; seriesId: string; amount: string })
  | (PlumeActionBase & { action: "settle"; seriesId: string; roundId?: string })
  | (PlumeActionBase & { action: "settle-worthless" | "reclaim"; seriesId: string });

export type PlumeActionContext = {
  nowSeconds: number;
  feedDecimals: number;
  underlyingDecimals: number;
  quoteDecimals: number;
};

export type PlumeActionReview = {
  action: PlumeOptionActionName;
  symbol: PlumeOptionSymbol;
  kind: PlumeOptionKind;
  confirmation: (typeof PLUME_ACTION_CONFIRMATIONS)[PlumeOptionActionName];
  summary: string;
  amountAtomic?: string;
  collateralAtomic?: string;
  premiumAtomic?: string;
  premiumPerOptionAtomic?: string;
  strikeAtomic?: string;
  expiry?: number;
  offerId?: string;
  seriesId?: `0x${string}`;
  roundId?: string;
};

const OPTION_DECIMALS = 18;
const MAX_TENOR_SECONDS = 30 * 24 * 60 * 60;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT40 = (1n << 40n) - 1n;

function positiveDecimal(value: string, label: string, decimals: number): bigint {
  const normalized = String(value ?? "").trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) throw new Error(`${label} must be a positive number.`);
  const atomic = parseUnits(normalized, decimals);
  if (atomic <= 0n) throw new Error(`${label} must be greater than zero.`);
  return atomic;
}

function positiveInteger(value: string | undefined, label: string): bigint {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} must be a positive integer.`);
  const parsed = BigInt(normalized);
  if (parsed <= 0n) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function bytes32(value: string): `0x${string}` {
  const normalized = String(value ?? "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) throw new Error("A valid option series id is required.");
  return normalized as `0x${string}`;
}

function supportedSymbol(value: string): PlumeOptionSymbol {
  const symbol = String(value ?? "").trim().toUpperCase();
  if (symbol !== "TSLA" && symbol !== "AMD") throw new Error("Plume testnet execution supports only TSLA or AMD from the pinned registry.");
  return symbol;
}

function mulDivUp(left: bigint, right: bigint, denominator: bigint) {
  const product = left * right;
  return product === 0n ? 0n : (product + denominator - 1n) / denominator;
}

export function plumeSeriesId(strike: bigint, expiry: bigint): `0x${string}` {
  if (strike <= 0n || strike > MAX_UINT128) throw new Error("Strike is outside the contract's uint128 range.");
  if (expiry <= 0n || expiry > MAX_UINT40) throw new Error("Expiry is outside the contract's uint40 range.");
  return keccak256(encodeAbiParameters(
    [{ type: "uint128" }, { type: "uint40" }],
    [strike, Number(expiry)],
  ));
}

export function collateralForWrite(input: {
  kind: PlumeOptionKind;
  amount: bigint;
  strike: bigint;
  underlyingDecimals: number;
  quoteDecimals: number;
  feedDecimals: number;
}): bigint {
  const optionUnit = 10n ** BigInt(OPTION_DECIMALS);
  if (input.kind === "call") {
    return mulDivUp(input.amount, 10n ** BigInt(input.underlyingDecimals), optionUnit);
  }
  const strikeInQuote = mulDivUp(
    input.strike,
    10n ** BigInt(input.quoteDecimals),
    10n ** BigInt(input.feedDecimals),
  );
  return mulDivUp(input.amount, strikeInQuote, optionUnit);
}

function amountSummary(amount: bigint) {
  return Number(formatUnits(amount, OPTION_DECIMALS)).toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function baseReview(action: PlumeOptionAction, symbol: PlumeOptionSymbol): Pick<PlumeActionReview, "action" | "symbol" | "kind" | "confirmation"> {
  return {
    action: action.action,
    symbol,
    kind: action.kind,
    confirmation: PLUME_ACTION_CONFIRMATIONS[action.action],
  };
}

export function preparePlumeAction(action: PlumeOptionAction, context: PlumeActionContext): PlumeActionReview {
  const symbol = supportedSymbol(action.symbol);
  const reviewBase = baseReview(action, symbol);

  if (action.action === "write") {
    const amount = positiveDecimal(action.amount, "Option amount", OPTION_DECIMALS);
    if (amount > MAX_UINT128) throw new Error("Option amount is outside the contract's uint128 range.");
    const strike = positiveDecimal(action.strikePrice, "Strike price", context.feedDecimals);
    if (strike > MAX_UINT128) throw new Error("Strike price is outside the contract's uint128 range.");
    const premiumPerOption = positiveDecimal(action.premiumPerOption, "Premium", context.quoteDecimals);
    if (premiumPerOption > MAX_UINT128) throw new Error("Premium is outside the contract's uint128 range.");
    const expiry = Math.trunc(Number(action.expiry));
    if (!Number.isSafeInteger(expiry) || expiry <= context.nowSeconds) throw new Error("Expiry must be in the future.");
    if (expiry > context.nowSeconds + MAX_TENOR_SECONDS) throw new Error("Expiry cannot be more than 30 days away.");
    const collateral = collateralForWrite({
      kind: action.kind,
      amount,
      strike,
      underlyingDecimals: context.underlyingDecimals,
      quoteDecimals: context.quoteDecimals,
      feedDecimals: context.feedDecimals,
    });
    return {
      ...reviewBase,
      amountAtomic: amount.toString(),
      collateralAtomic: collateral.toString(),
      premiumPerOptionAtomic: premiumPerOption.toString(),
      strikeAtomic: strike.toString(),
      expiry,
      seriesId: plumeSeriesId(strike, BigInt(expiry)),
      summary: `Write and list ${amountSummary(amount)} ${symbol} ${action.kind === "call" ? "covered calls" : "cash-secured puts"}.`,
    };
  }

  if (action.action === "buy") {
    const amount = positiveDecimal(action.amount, "Option amount", OPTION_DECIMALS);
    const offerId = positiveInteger(action.offerId, "Offer id");
    const listedPremium = positiveInteger(action.listedPremiumPerOptionAtomic, "Server-listed premium");
    const premium = (amount * listedPremium) / 10n ** BigInt(OPTION_DECIMALS);
    return {
      ...reviewBase,
      amountAtomic: amount.toString(),
      offerId: offerId.toString(),
      premiumAtomic: premium.toString(),
      premiumPerOptionAtomic: listedPremium.toString(),
      summary: `Buy ${amountSummary(amount)} ${symbol} ${action.kind} options from offer #${offerId}.`,
    };
  }

  if (action.action === "cancel") {
    const amount = positiveDecimal(action.amount, "Option amount", OPTION_DECIMALS);
    const offerId = positiveInteger(action.offerId, "Offer id");
    return { ...reviewBase, amountAtomic: amount.toString(), offerId: offerId.toString(), summary: `Cancel ${amountSummary(amount)} options from offer #${offerId}.` };
  }

  const seriesId = bytes32(action.seriesId);
  if (action.action === "settle") {
    const roundId = action.roundId ? positiveInteger(action.roundId, "Settlement round id").toString() : undefined;
    return { ...reviewBase, seriesId, roundId, summary: `Settle ${symbol} ${action.kind} series ${seriesId.slice(0, 10)}… at the earliest valid oracle round.` };
  }
  if (action.action === "settle-worthless") {
    return { ...reviewBase, seriesId, summary: `Invoke the guarded worthless-settlement fallback for ${symbol} ${action.kind} series ${seriesId.slice(0, 10)}….` };
  }
  if (action.action === "reclaim") {
    return { ...reviewBase, seriesId, summary: `Reclaim available ${symbol} ${action.kind} writer collateral for series ${seriesId.slice(0, 10)}….` };
  }

  if (!("amount" in action)) throw new Error("This option action requires an amount.");
  const amount = positiveDecimal(action.amount, "Option amount", OPTION_DECIMALS);
  const verb = action.action === "buy-to-close" ? "Buy to close" : action.action === "exercise" ? "Exercise" : "Redeem";
  return {
    ...reviewBase,
    seriesId,
    amountAtomic: amount.toString(),
    summary: `${verb} ${amountSummary(amount)} ${symbol} ${action.kind} options.`,
  };
}
