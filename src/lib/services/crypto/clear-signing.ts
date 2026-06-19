import "server-only";

import { createHash } from "node:crypto";
import type { AgentSpendCapAsset, AgentWalletConfig, X402PaymentRequirement } from "@/lib/types/agent-wallet";

export type ClearSigningActionKind =
  | "x402"
  | "send"
  | "private-transfer"
  | "bankr-action"
  | "crosschain-intent"
  | "agent-identity"
  | "raw-transaction";

export type ClearSigningRiskLevel = "info" | "warning" | "blocker";

export type ClearSigningRisk = {
  level: ClearSigningRiskLevel;
  code: string;
  message: string;
};

export type ClearSigningReviewInput = {
  kind?: ClearSigningActionKind | string;
  intent?: string;
  provider?: string;
  agentId?: string;
  network?: string;
  asset?: AgentSpendCapAsset | string;
  amount?: number | string;
  amountUsd?: number;
  recipientAddress?: string;
  toAddress?: string;
  url?: string;
  method?: string;
  prompt?: string;
  confirmation?: string;
  policy?: Partial<AgentWalletConfig>;
  paymentRequirement?: Partial<X402PaymentRequirement> & Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type ClearSigningReview = {
  generatedAt: string;
  kind: ClearSigningActionKind;
  intent?: string;
  provider?: string;
  agentId?: string;
  title: string;
  summary: string;
  network?: string;
  asset?: string;
  amount?: string;
  amountUsd?: number;
  spendCapUsd?: number;
  recipientAddress?: string;
  url?: string;
  method?: string;
  counterparty?: string;
  paymentRequirement?: {
    network?: string;
    scheme?: string;
    asset?: string;
    amount?: string;
    description?: string;
  };
  sideEffects: string[];
  risks: ClearSigningRisk[];
  blocked: boolean;
  confirmation?: string;
  fingerprint: string;
};

const SPEND_KINDS = new Set<ClearSigningActionKind>([
  "x402",
  "send",
  "private-transfer",
  "bankr-action",
  "crosschain-intent",
  "raw-transaction",
]);

export function normalizeClearSigningKind(value: unknown): ClearSigningActionKind {
  if (typeof value !== "string") return "raw-transaction";
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (normalized === "paid-api" || normalized === "private-paid-api" || normalized === "paywall") return "x402";
  if (normalized === "private" || normalized === "private-send" || normalized === "private-payment") return "private-transfer";
  if (normalized === "bankr" || normalized === "trade" || normalized === "swap" || normalized === "token-launch") return "bankr-action";
  if (normalized === "crosschain" || normalized === "cross-chain" || normalized === "bridge" || normalized === "crosschain-swap" || normalized === "cross-chain-swap" || normalized === "crosschain-bridge" || normalized === "cross-chain-bridge") return "crosschain-intent";
  if (normalized === "identity" || normalized === "agent-identity" || normalized === "erc8004" || normalized === "ens8004") return "agent-identity";
  if (isClearSigningActionKind(normalized)) return normalized;
  return "raw-transaction";
}

export function buildClearSigningReview(input: ClearSigningReviewInput): ClearSigningReview {
  const kind = normalizeClearSigningKind(input.kind ?? input.intent);
  const urlInfo = parseUrlInfo(input.url);
  const amount = cleanAmount(input.amount);
  const amountUsd = positiveMoney(input.amountUsd);
  const spendCapUsd = positiveMoney(input.policy?.maxPaymentUsd);
  const recipientAddress = cleanText(input.recipientAddress ?? input.toAddress);
  const paymentRequirement = normalizePaymentRequirement(input.paymentRequirement);
  const risks = reviewRisks(kind, input, {
    amount,
    amountUsd,
    spendCapUsd,
    recipientAddress,
    urlInfo,
    paymentRequirement,
  });
  const canonical = {
    kind,
    intent: cleanText(input.intent),
    provider: cleanText(input.provider),
    agentId: cleanText(input.agentId),
    network: cleanText(input.network ?? input.policy?.network ?? paymentRequirement?.network),
    asset: cleanText(input.asset ?? paymentRequirement?.asset),
    amount,
    amountUsd,
    recipientAddress,
    url: urlInfo.url,
    method: cleanText(input.method)?.toUpperCase(),
    counterparty: urlInfo.host,
    paymentRequirement,
    confirmation: cleanText(input.confirmation),
  };
  return {
    generatedAt: new Date().toISOString(),
    kind,
    intent: canonical.intent,
    provider: canonical.provider,
    agentId: canonical.agentId,
    title: titleForKind(kind, canonical.provider),
    summary: summaryForKind(kind, canonical),
    network: canonical.network,
    asset: canonical.asset,
    amount: canonical.amount,
    amountUsd: canonical.amountUsd,
    spendCapUsd,
    recipientAddress,
    url: urlInfo.url,
    method: canonical.method,
    counterparty: urlInfo.host,
    paymentRequirement,
    sideEffects: sideEffectsForKind(kind),
    risks,
    blocked: risks.some((risk) => risk.level === "blocker"),
    confirmation: canonical.confirmation || confirmationForKind(kind, canonical.provider),
    fingerprint: fingerprint(canonical),
  };
}

function reviewRisks(
  kind: ClearSigningActionKind,
  input: ClearSigningReviewInput,
  normalized: {
    amount?: string;
    amountUsd?: number;
    spendCapUsd?: number;
    recipientAddress?: string;
    urlInfo: { url?: string; host?: string; invalid?: boolean; protocol?: string };
    paymentRequirement?: ClearSigningReview["paymentRequirement"];
  },
) {
  const risks: ClearSigningRisk[] = [];
  if (SPEND_KINDS.has(kind) && !cleanText(input.agentId)) {
    risks.push({ level: "warning", code: "missing-agent", message: "No agent id was supplied for the spend review." });
  }
  if ((kind === "send" || kind === "private-transfer") && !normalized.recipientAddress) {
    risks.push({ level: "blocker", code: "missing-recipient", message: "Recipient address is required before this transfer can be signed." });
  }
  if (normalized.recipientAddress && !looksLikeWalletAddress(normalized.recipientAddress)) {
    risks.push({ level: "blocker", code: "recipient-format", message: "Recipient address does not look like a supported EVM or Solana address." });
  }
  if (SPEND_KINDS.has(kind) && !normalized.amount && normalized.amountUsd == null && !normalized.paymentRequirement?.amount) {
    risks.push({ level: kind === "x402" ? "warning" : "blocker", code: "missing-amount", message: "No amount was supplied for this spend review." });
  }
  if (normalized.amountUsd != null && normalized.spendCapUsd != null && normalized.amountUsd > normalized.spendCapUsd) {
    risks.push({ level: "blocker", code: "cap-exceeded", message: `Amount $${normalized.amountUsd.toFixed(2)} exceeds the wallet cap of $${normalized.spendCapUsd.toFixed(2)}.` });
  }
  if (SPEND_KINDS.has(kind) && normalized.spendCapUsd == null) {
    risks.push({ level: "warning", code: "missing-cap", message: "No per-payment wallet cap was supplied with the review." });
  }
  if (kind === "x402" && normalized.urlInfo.invalid) {
    risks.push({ level: "blocker", code: "invalid-url", message: "The x402 URL is not a valid absolute URL." });
  }
  if (kind === "x402" && normalized.urlInfo.protocol && normalized.urlInfo.protocol !== "https:" && !isLocalHost(normalized.urlInfo.host)) {
    risks.push({ level: "warning", code: "non-https-url", message: "The paid API URL is not HTTPS." });
  }
  if (kind === "x402" && normalized.paymentRequirement?.network && input.policy?.network && normalized.paymentRequirement.network !== input.policy.network) {
    risks.push({ level: "blocker", code: "network-mismatch", message: `Payment requirement network ${normalized.paymentRequirement.network} does not match wallet network ${input.policy.network}.` });
  }
  if (kind === "private-transfer" && input.provider !== "veil") {
    risks.push({ level: "info", code: "privacy-provider", message: "Private transfers should route through a provider with private-transfer capability." });
  }
  if (input.policy?.autoPayEnabled) {
    risks.push({ level: "info", code: "auto-use", message: "Wallet auto-use is enabled; confirm the cap and intended target still match." });
  }
  return risks;
}

function titleForKind(kind: ClearSigningActionKind, provider?: string) {
  if (kind === "x402") return "Review paid API call";
  if (kind === "send") return "Review wallet send";
  if (kind === "private-transfer") return "Review private transfer";
  if (kind === "bankr-action") return `Review ${provider || "Bankr"} action`;
  if (kind === "crosschain-intent") return "Review crosschain intent";
  if (kind === "agent-identity") return "Review agent identity claim";
  return "Review raw transaction";
}

function summaryForKind(kind: ClearSigningActionKind, input: Record<string, unknown>) {
  const amount = [input.amount, input.amountUsd == null ? undefined : `$${Number(input.amountUsd).toFixed(2)}`].filter(Boolean).join(" / ");
  if (kind === "x402") return `Pay ${amount || "the requested amount"} to access ${input.counterparty || input.url || "the paid endpoint"}.`;
  if (kind === "send" || kind === "private-transfer") return `Send ${amount || "funds"} to ${input.recipientAddress || "an unspecified recipient"}.`;
  if (kind === "bankr-action") return `Prepare a provider-mediated crypto action${input.intent ? ` for ${input.intent}` : ""}.`;
  if (kind === "crosschain-intent") return `Prepare a crosschain route${input.network ? ` on ${input.network}` : ""}.`;
  if (kind === "agent-identity") return "Publish or update an agent identity/listing claim.";
  return "Review transaction metadata before signing.";
}

function sideEffectsForKind(kind: ClearSigningActionKind) {
  if (kind === "agent-identity") return ["Publishes or changes discoverable agent identity metadata."];
  if (kind === "x402") return ["Signs a payment authorization", "Sends a paid HTTP request"];
  if (kind === "bankr-action") return ["May create a trade, bet, token launch, automation, NFT action, or provider job after confirmation"];
  if (kind === "crosschain-intent") return ["May route assets across chains or venues after provider confirmation"];
  if (kind === "private-transfer") return ["May shield funds", "Withdraws privately to a public recipient"];
  if (kind === "send") return ["Transfers wallet funds to a recipient"];
  return ["May sign or broadcast an on-chain transaction"];
}

function confirmationForKind(kind: ClearSigningActionKind, provider?: string) {
  if (kind === "send") return "SEND_USDC";
  if (kind === "private-transfer") return "CONFIRM_VEIL_TRANSFER";
  if (kind === "x402" && provider === "veil") return "VEIL_X402";
  if (kind === "bankr-action" || kind === "crosschain-intent") return "CONFIRM_BANKR_ACTION";
  return undefined;
}

function normalizePaymentRequirement(requirement: ClearSigningReviewInput["paymentRequirement"]): ClearSigningReview["paymentRequirement"] | undefined {
  if (!requirement || typeof requirement !== "object") return undefined;
  return {
    network: cleanText(requirement.network),
    scheme: cleanText(requirement.scheme),
    asset: cleanText(requirement.asset),
    amount: cleanAmount(requirement.maxAmountRequired ?? requirement.amount),
    description: cleanText(requirement.description),
  };
}

function parseUrlInfo(value: unknown) {
  const text = cleanText(value);
  if (!text) return {};
  try {
    const parsed = new URL(text);
    return { url: parsed.toString(), host: parsed.host, protocol: parsed.protocol };
  } catch {
    return { url: text, invalid: true };
  }
}

function looksLikeWalletAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function isLocalHost(host?: string) {
  return Boolean(host && /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(host));
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cleanAmount(value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? String(value) : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return undefined;
}

function positiveMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function isClearSigningActionKind(value: string): value is ClearSigningActionKind {
  return ["x402", "send", "private-transfer", "bankr-action", "crosschain-intent", "agent-identity", "raw-transaction"].includes(value);
}
