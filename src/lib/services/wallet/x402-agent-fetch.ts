import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { wrapFetchWithPayment, x402Client, type Network, type PaymentRequired, type PaymentRequirements } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { ExactSvmScheme } from "@x402/svm";
import { BuilderCodeClientExtension } from "@x402/extensions/builder-code";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import { base58 } from "@scure/base";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import type { ReasoningTrail } from "@/lib/types/reasoning-trail";
import { homedir } from "@/lib/home-dir";
import {
  evaluateSpend,
  resolveSpendGovernance,
  shouldEvaluateSpend,
} from "@/lib/services/wallet/spend-governance";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";
import {
  X402_CLIENT_BUILDER_CODE_ENV_KEYS,
  x402BuilderCodeFromEnvForNetwork,
} from "@/lib/services/wallet/x402-builder-code";
import {
  assertTradingPlatformFeeReady,
  collectTradingPlatformFee,
  type PlatformFeeCollection,
} from "@/lib/services/wallet/platform-fees";

export type X402Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type X402FetchPolicy = Pick<
  AgentWalletConfig,
  "enabled" | "provider" | "network" | "maxPaymentUsd" | "approvalRequiredOverUsd" | "autoPayEnabled" | "x402BaseUrl"
>;

export type X402FetchInput = {
  agentId: string;
  network: string;
  secret: string;
  fromAddress: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  policy: X402FetchPolicy;
  confirmation?: string;
  /** Granted approval id, supplied when retrying an escalated x402 payment. */
  approvalToken?: string;
  /** True when the caller already completed a concrete server-side user approval for this exact spend. */
  approvalThresholdSatisfied?: boolean;
  /** Human-facing context to attach if this paid request needs approval. */
  approvalContext?: Partial<ReasoningTrail>;
  /** Active Work Board company task id. Omit for ordinary user/agent spending. */
  companyTaskId?: string;
  /** Use plain fetch without x402 discovery/wrapping when an upstream bearer/prepaid token should decide access. */
  skipPaymentDiscovery?: boolean;
  /** True when the endpoint price already includes HivemindOS revenue, so the generic local platform fee should not be collected. */
  skipPlatformFee?: boolean;
  timeoutMs?: number;
};

export type X402PaymentDiscoveryInput = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  policy: X402FetchPolicy;
};

export type X402PaymentDiscovery = {
  status: number;
  url: string;
  method: X402Method;
  network: string;
  amountUsd: number;
  requirement: PaymentRequirements;
};

export type X402FetchResult = {
  ok: boolean;
  status: number;
  url: string;
  method: X402Method;
  network: string;
  amountUsd: number;
  paid: boolean;
  paymentAttempted?: boolean;
  paymentSettled?: boolean;
  builderCode?: string;
  platformFee?: PlatformFeeCollection;
  paymentResponse?: string;
  responseHeaders: Record<string, string>;
  contentType: string;
  bodyPreview: string;
  bodyJson?: unknown;
};

type X402SpendRecord = {
  agentId: string;
  url: string;
  network: string;
  method: X402Method;
  amountUsd: number;
  status: number;
  paid: boolean;
  builderCode?: string;
  createdAt: string;
};

const spendLogPath = path.join(homedir(), ".hivemindos", "x402-spend-log.json");
const supportedEvmNetworks = new Set(["eip155:8453", "eip155:84532", "eip155:4663"]);
const supportedSvmNetworks = new Set(["solana:mainnet", "solana:devnet"]);
const EVM_RECOVERY_PATH = "m/44'/60'/0'/0/0";

const x402SvmNetworkByWalletNetwork: Record<string, string> = {
  "solana:mainnet": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "solana:devnet": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

export function parseX402Method(value?: string): X402Method {
  const method = (value || "GET").trim().toUpperCase();
  if (method === "GET" || method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") return method;
  throw new Error("Unsupported x402 HTTP method.");
}

export function assertPaidUrl(url: string, baseUrl?: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("x402 URL is invalid.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("x402 URL must use HTTP or HTTPS.");
  if (baseUrl?.trim()) {
    const base = new URL(baseUrl);
    if (parsed.origin !== base.origin || !parsed.pathname.startsWith(base.pathname.replace(/\/$/, ""))) {
      throw new Error("x402 URL is outside this agent's configured paid API base URL.");
    }
  }
}

function redactHeaders(headers: Record<string, string> = {}) {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/^(authorization|cookie|set-cookie|x-api-key)$/i.test(key)) continue;
    next[key] = value;
  }
  return next;
}

export function amountFromRequirement(requirement: PaymentRequirements): number {
  const extended = requirement as PaymentRequirements & { maxAmountRequired?: string | number | bigint; value?: string | number | bigint };
  const raw = requirement.amount ?? extended.maxAmountRequired ?? extended.value ?? 0;
  if (typeof raw === "bigint") return Number(raw) / 1_000_000;
  if (typeof raw === "number") return raw > 10_000 ? raw / 1_000_000 : raw;
  const trimmed = String(raw).trim();
  if (!trimmed) return 0;
  if (trimmed.includes(".")) return Number(trimmed);
  return Number(BigInt(trimmed)) / 1_000_000;
}

export function x402Network(network: string): Network {
  return (x402SvmNetworkByWalletNetwork[network] ?? network) as Network;
}

function svmRpc(network: string) {
  if (network === "solana:devnet") return process.env.SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com";
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

function evmAccountFromLocalSecret(secret: string) {
  const compact = secret.trim();
  const prefixed = compact.startsWith("0x") ? compact : `0x${compact}`;
  if (/^0x[a-fA-F0-9]{64}$/.test(prefixed)) return privateKeyToAccount(prefixed as `0x${string}`);

  const mnemonic = compact.toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(mnemonic, englishWordlist)) {
    throw new Error("Stored EVM signer must be an EVM private key or recovery phrase.");
  }
  return mnemonicToAccount(mnemonic, { path: EVM_RECOVERY_PATH });
}

function selectRequirement(policy: X402FetchPolicy, confirmation?: string) {
  return (_version: number, accepts: PaymentRequirements[]) => {
    const network = x402Network(policy.network);
    const matching = accepts.filter((requirement) => requirement.network === network);
    if (!matching.length) {
      throw new Error(`No x402 payment option matched ${network}.`);
    }
    const sorted = matching.sort((a, b) => amountFromRequirement(a) - amountFromRequirement(b));
    const selected = sorted[0];
    const amountUsd = amountFromRequirement(selected);
    if (amountUsd > policy.maxPaymentUsd) {
      throw new Error(`x402 payment would exceed this agent's per-payment cap ($${policy.maxPaymentUsd.toFixed(2)}).`);
    }
    if (!policy.autoPayEnabled && confirmation !== "PAY_X402") {
      throw new Error(`x402 auto-use is off. Type PAY_X402 to approve up to $${policy.maxPaymentUsd.toFixed(2)}.`);
    }
    return selected;
  };
}

function paymentRequiredHeader(response: Response): string {
  return response.headers.get("PAYMENT-REQUIRED") ?? response.headers.get("X-PAYMENT-REQUIRED") ?? "";
}

function decodePaymentRequiredHeader(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return JSON.parse(Buffer.from(trimmed, "base64").toString("utf8")) as unknown;
  }
}

async function paymentRequiredFromResponse(response: Response): Promise<PaymentRequired> {
  const header = paymentRequiredHeader(response);
  const parsed = header ? decodePaymentRequiredHeader(header) : await response.json().catch(() => null) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("x402 endpoint did not return a readable payment requirement.");
  const required = parsed as PaymentRequired;
  if (!Array.isArray(required.accepts) || required.accepts.length === 0) {
    throw new Error("x402 payment requirement did not include any accepted payment options.");
  }
  return required;
}

async function appendSpendRecord(record: X402SpendRecord) {
  await fs.mkdir(path.dirname(spendLogPath), { recursive: true, mode: 0o700 });
  let records: X402SpendRecord[] = [];
  try {
    records = JSON.parse(await fs.readFile(spendLogPath, "utf8")) as X402SpendRecord[];
    if (!Array.isArray(records)) records = [];
  } catch {
    records = [];
  }
  records.push(record);
  await fs.writeFile(spendLogPath, JSON.stringify(records.slice(-500), null, 2), { mode: 0o600 });
}

async function responsePreview(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (contentType.includes("application/json")) {
    try {
      return { contentType, bodyPreview: text.slice(0, 8000), bodyJson: JSON.parse(text) as unknown };
    } catch {
      return { contentType, bodyPreview: text.slice(0, 8000) };
    }
  }
  return { contentType, bodyPreview: text.slice(0, 8000) };
}

function responseHeaderRecord(headers: Headers) {
  const record: Record<string, string> = {};
  for (const [key, value] of headers.entries()) record[key.toLowerCase()] = value;
  return record;
}

/**
 * Tolerant pre-flight: returns the USD amount this call would pay, or null when
 * the endpoint does not require payment. The unpaid 402 carries no side effect,
 * so this is safe even for POST.
 */
async function discoverX402AmountUsd(input: X402FetchInput): Promise<number | null> {
  const method = parseX402Method(input.method);
  const response = await fetch(input.url, {
    method,
    headers: {
      ...redactHeaders(input.headers),
      ...(input.body == null ? {} : { "Content-Type": "application/json" }),
    },
    body: input.body == null || method === "GET" ? undefined : JSON.stringify(input.body),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 402) return null;
  const required = await paymentRequiredFromResponse(response);
  const requirement = selectRequirement({ ...input.policy, autoPayEnabled: true }, "PAY_X402")(required.x402Version, required.accepts);
  return amountFromRequirement(requirement);
}

export async function executeX402Fetch(input: X402FetchInput): Promise<X402FetchResult> {
  if (!input.policy.enabled) throw new Error("This agent's wallet is not enabled.");
  if (input.policy.provider !== "x402") throw new Error("Set this agent's payment provider to x402 before paid HTTP calls.");
  if (!supportedEvmNetworks.has(input.network) && !supportedSvmNetworks.has(input.network)) {
    throw new Error("x402 execution currently supports local Base, Base Sepolia, Robinhood Chain, Solana mainnet, and Solana devnet wallets.");
  }
  if (input.policy.network !== input.network) throw new Error("Stored wallet network does not match the x402 policy network.");
  assertPaidUrl(input.url, input.policy.x402BaseUrl);

  const method = parseX402Method(input.method);
  if (input.skipPaymentDiscovery) {
    const response = await fetch(input.url, {
      method,
      headers: {
        ...redactHeaders(input.headers),
        ...(input.body == null ? {} : { "Content-Type": "application/json" }),
      },
      body: input.body == null || method === "GET" ? undefined : JSON.stringify(input.body),
      signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
    });
    const preview = await responsePreview(response);
    return {
      ok: response.ok,
      status: response.status,
      url: input.url,
      method,
      network: x402Network(input.network),
      amountUsd: 0,
      paid: false,
      paymentAttempted: false,
      paymentSettled: false,
      paymentResponse: response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE") ?? undefined,
      responseHeaders: responseHeaderRecord(response.headers),
      ...preview,
    };
  }

  let discoveredAmountUsd: number | null | undefined;
  const discoverAmount = async () => {
    if (discoveredAmountUsd === undefined) {
      discoveredAmountUsd = await discoverX402AmountUsd(input);
    }
    return discoveredAmountUsd;
  };
  const feePreflightAmountUsd = await discoverAmount();
  if (!input.skipPlatformFee && feePreflightAmountUsd != null && feePreflightAmountUsd > 0) {
    await assertTradingPlatformFeeReady({
      source: "x402-paid-api",
      network: input.network,
      amountUsd: feePreflightAmountUsd,
    });
  }

  // Governance pre-flight. Ordinary calls use only the selected wallet's own
  // policy. Company policy is attached only by a validated active Work Board
  // company task id; company membership by itself never changes a wallet call.
  const governance = await resolveSpendGovernance(input.agentId, { companyTaskId: input.companyTaskId });
  let approvalGrantId: string | undefined;
  let spendCompanyId: string | undefined;
  if (governance && (await shouldEvaluateSpend(governance.wallet, input.policy.maxPaymentUsd, {
    companyId: governance.companyId,
  }))) {
    const preflightAmountUsd = await discoverAmount();
    // Always evaluate an explicit company task (amount 0 when undiscoverable)
    // so its freeze switch binds even when the price cannot be discovered first.
    const decision = await evaluateSpend({
      wallet: governance.wallet,
      agentName: governance.agentName,
      kind: "x402",
      asset: stableAssetSymbol(input.network),
      amountUsd: preflightAmountUsd != null && preflightAmountUsd > 0 ? preflightAmountUsd : 0,
      target: input.url,
      approvalToken: input.approvalToken,
      approvalThresholdSatisfied: input.approvalThresholdSatisfied,
      explanation: input.approvalContext,
      companyId: governance.companyId,
    });
    if (decision.decision !== "allow") throw new Error(decision.reason);
    approvalGrantId = decision.grant?.id;
    spendCompanyId = decision.companyId;
  }

  let selectedAmountUsd = 0;
  let paid = false;
  const network = x402Network(input.network);
  const builderCode = x402BuilderCodeFromEnvForNetwork(network, X402_CLIENT_BUILDER_CODE_ENV_KEYS);
  const scheme = supportedEvmNetworks.has(input.network)
    ? new ExactEvmScheme(evmAccountFromLocalSecret(input.secret))
    : new ExactSvmScheme(
      await createKeyPairSignerFromBytes(base58.decode(input.secret)),
      { rpcUrl: svmRpc(input.network) },
    );
  const client = new x402Client((version: number, accepts: PaymentRequirements[]) => {
    const selected = selectRequirement(input.policy, input.confirmation)(version, accepts);
    selectedAmountUsd = amountFromRequirement(selected);
    paid = true;
    return selected;
  }).register(network, scheme);
  if (builderCode) {
    client.registerExtension(new BuilderCodeClientExtension(builderCode));
  }

  // Adapted from coinbase/x402's @x402/fetch wrapper: first request, parse 402
  // requirements, sign the selected payment, and retry with x402 payment headers.
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const response = await fetchWithPayment(input.url, {
    method,
    headers: {
      ...redactHeaders(input.headers),
      ...(input.body == null ? {} : { "Content-Type": "application/json" }),
    },
    body: input.body == null || method === "GET" ? undefined : JSON.stringify(input.body),
    signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
  });
  const preview = await responsePreview(response);
  const paymentResponse = response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE") ?? undefined;
  const paymentSettled = paid && response.status !== 402 && Boolean(paymentResponse);
  const platformFee = !input.skipPlatformFee && paymentSettled && selectedAmountUsd > 0
    ? await collectTradingPlatformFee({
      agentId: input.agentId,
      network: input.network,
      secret: input.secret,
      fromAddress: input.fromAddress,
      amountUsd: selectedAmountUsd,
      source: "x402-paid-api",
      companyId: spendCompanyId,
    })
    : undefined;
  const result: X402FetchResult = {
    ok: response.ok,
    status: response.status,
    url: input.url,
    method,
    network,
    amountUsd: selectedAmountUsd,
    paid: paymentSettled,
    paymentAttempted: paid,
    paymentSettled,
    builderCode,
    platformFee,
    paymentResponse,
    responseHeaders: responseHeaderRecord(response.headers),
    ...preview,
  };
  if (paymentSettled) {
    await appendSpendRecord({
      agentId: input.agentId,
      url: input.url,
      network: input.network,
      method,
      amountUsd: selectedAmountUsd,
      status: response.status,
      paid: paymentSettled,
      builderCode,
      createdAt: new Date().toISOString(),
    });
    await appendSpend({
      agentId: input.agentId,
      companyId: spendCompanyId,
      kind: "x402",
      asset: stableAssetSymbol(input.network),
      amountUsd: selectedAmountUsd,
      target: shortTarget(input.url),
      status: "executed",
      approvalId: approvalGrantId,
    }).catch(() => {});
  }
  return result;
}

export async function discoverX402Payment(input: X402PaymentDiscoveryInput): Promise<X402PaymentDiscovery> {
  if (!input.policy.enabled) throw new Error("This agent's wallet is not enabled.");
  if (!supportedEvmNetworks.has(input.policy.network) && !supportedSvmNetworks.has(input.policy.network)) {
    throw new Error("x402 execution currently supports local Base, Base Sepolia, Robinhood Chain, Solana mainnet, and Solana devnet wallets.");
  }
  assertPaidUrl(input.url, input.policy.x402BaseUrl);

  const method = parseX402Method(input.method);
  const response = await fetch(input.url, {
    method,
    headers: {
      ...redactHeaders(input.headers),
      ...(input.body == null ? {} : { "Content-Type": "application/json" }),
    },
    body: input.body == null || method === "GET" ? undefined : JSON.stringify(input.body),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 402) {
    throw new Error(`x402 endpoint returned HTTP ${response.status}; expected 402 Payment Required.`);
  }

  const required = await paymentRequiredFromResponse(response);
  const selectionPolicy = { ...input.policy, autoPayEnabled: true };
  const requirement = selectRequirement(selectionPolicy, "PAY_X402")(required.x402Version, required.accepts);
  const amountUsd = amountFromRequirement(requirement);
  return {
    status: response.status,
    url: input.url,
    method,
    network: x402Network(input.policy.network),
    amountUsd,
    requirement,
  };
}

export function summarizeX402Policy(policy: AgentWalletConfig) {
  return [
    `- Provider: ${policy.provider}`,
    `- Enabled: ${policy.enabled ? "yes" : "no"}`,
    `- Network: ${policy.network}`,
    `- Paid API base URL: ${policy.x402BaseUrl || "(not restricted yet)"}`,
    `- Max per x402 payment: $${policy.maxPaymentUsd.toFixed(2)}`,
    `- Approval required over: $${policy.approvalRequiredOverUsd.toFixed(2)} when auto-use is off`,
    `- Allow auto-use within hard cap: ${policy.autoPayEnabled ? "yes" : "no"}`,
  ].join("\n");
}

export type { PaymentRequired };

function stableAssetSymbol(network: string): "USDC" | "USDG" {
  return network === "eip155:4663" ? "USDG" : "USDC";
}
