import "server-only";

import type { CryptoCapabilityProvider } from "@/lib/services/crypto-capability-router";

export type CrosschainIntentKind = "crosschain-swap" | "bridge" | "crosschain-payment" | "route-quote";
export type CrosschainIntentProvider = "bankr" | "lifi" | "open-intents" | "jupiter-xstocks";
export type CrosschainIntentStatus = "available" | "planned" | "unsupported";

export type CrosschainIntentInput = {
  kind?: CrosschainIntentKind | string;
  preferredProvider?: CrosschainIntentProvider | CryptoCapabilityProvider | string;
  fromChain?: string;
  toChain?: string;
  fromAsset?: string;
  toAsset?: string;
  amount?: number | string;
  amountUsd?: number;
  recipientAddress?: string;
  prompt?: string;
};

export type CrosschainProviderOption = {
  provider: CrosschainIntentProvider;
  label: string;
  status: CrosschainIntentStatus;
  reason: string;
  endpoint?: {
    method?: string;
    route?: string;
    skill?: string;
  };
  confirmation?: string;
  missing: string[];
};

export type CrosschainIntentPlan = {
  generatedAt: string;
  kind: CrosschainIntentKind;
  selected?: CrosschainProviderOption;
  options: CrosschainProviderOption[];
  normalized: {
    fromChain?: string;
    toChain?: string;
    fromAsset?: string;
    toAsset?: string;
    amount?: string;
    amountUsd?: number;
    recipientAddress?: string;
    prompt?: string;
  };
  sideEffects: string[];
};

export function normalizeCrosschainIntentKind(value: unknown): CrosschainIntentKind {
  if (typeof value !== "string") return "route-quote";
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (["crosschain", "cross-chain", "crosschain-swap", "cross-chain-swap", "bridge-swap", "swap-crosschain"].includes(normalized)) {
    return "crosschain-swap";
  }
  if (["bridge", "asset-bridge", "bridge-transfer", "cross-chain-bridge", "crosschain-bridge"].includes(normalized)) return "bridge";
  if (["crosschain-payment", "cross-chain-payment", "crosschain-pay", "cross-chain-pay"].includes(normalized)) return "crosschain-payment";
  if (["quote", "route", "route-quote", "intent-quote"].includes(normalized)) return "route-quote";
  return "route-quote";
}

export function isCrosschainCryptoIntent(value: unknown) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return [
    "crosschain",
    "cross-chain",
    "crosschain-swap",
    "cross-chain-swap",
    "bridge",
    "asset-bridge",
    "bridge-transfer",
    "crosschain-bridge",
    "cross-chain-bridge",
    "crosschain-payment",
    "cross-chain-payment",
    "route-quote",
  ].includes(normalized);
}

export function planCrosschainIntent(input: CrosschainIntentInput): CrosschainIntentPlan {
  const kind = normalizeCrosschainIntentKind(input.kind);
  const normalized = {
    fromChain: cleanText(input.fromChain),
    toChain: cleanText(input.toChain),
    fromAsset: cleanText(input.fromAsset),
    toAsset: cleanText(input.toAsset),
    amount: cleanAmount(input.amount),
    amountUsd: positiveNumber(input.amountUsd),
    recipientAddress: cleanText(input.recipientAddress),
    prompt: cleanText(input.prompt),
  };
  const options = providerOptions(kind, normalized);
  const preferred = cleanText(input.preferredProvider);
  const selected = options.find((option) => option.provider === preferred)
    ?? options.find((option) => option.status === "available")
    ?? options[0];
  return {
    generatedAt: new Date().toISOString(),
    kind,
    selected,
    options,
    normalized,
    sideEffects: [
      "Crosschain intents are quotes or drafts until a provider route returns a reviewed action.",
      "A prepared provider action can move assets between chains, swap assets, or create an approval transaction.",
      "Execution must pass through the provider's confirmation and wallet spend-governance gates.",
    ],
  };
}

function providerOptions(kind: CrosschainIntentKind, input: CrosschainIntentPlan["normalized"]): CrosschainProviderOption[] {
  const needsRecipient = kind === "crosschain-payment" && !input.recipientAddress;
  return [
    {
      provider: "bankr",
      label: "Bankr Agent API",
      status: kind === "route-quote" ? "unsupported" : "available",
      reason: "Bankr is the configured HivemindOS crosschain action bridge for swaps, trading, and agent-mediated crypto actions.",
      endpoint: { method: "POST", route: "/api/bankr/actions" },
      confirmation: "CONFIRM_BANKR_ACTION",
      missing: [
        ...(input.prompt ? [] : ["Prompt describing the route/action is required for Bankr preparation."]),
        ...(needsRecipient ? ["Recipient address is required for crosschain payments."] : []),
      ],
    },
    {
      provider: "lifi",
      label: "LI.FI",
      status: "planned",
      reason: "Provider slot for direct LI.FI quote/build execution. HivemindOS does not execute LI.FI routes until a credentialed adapter and approval gate are added.",
      missing: ["Direct LI.FI adapter is not configured yet."],
    },
    {
      provider: "open-intents",
      label: "Open Intents",
      status: "planned",
      reason: "Provider slot for Open Intents style solver networks. HivemindOS records the intent shape now and can add solver adapters later.",
      missing: ["Open Intents solver adapter is not configured yet."],
    },
    {
      provider: "jupiter-xstocks",
      label: "Jupiter xStocks",
      status: kind === "crosschain-swap" && input.toAsset?.toLowerCase().endsWith("x") ? "available" : "unsupported",
      reason: "Jupiter xStocks is available only for Solana USDC to verified tokenized equity swaps through the buy-stock rail.",
      endpoint: { skill: "hivemindos-wallet-rails" },
      confirmation: "CONFIRM_BUY",
      missing: input.toAsset?.toLowerCase().endsWith("x") ? [] : ["Target asset is not an xStock symbol."],
    },
  ];
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cleanAmount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? String(value) : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return undefined;
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
