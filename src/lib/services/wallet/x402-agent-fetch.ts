import "server-only";

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { wrapFetchWithPaymentFromConfig, type Network, type PaymentRequired, type PaymentRequirements } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { ExactSvmScheme } from "@x402/svm";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { homedir } from "@/lib/home-dir";
import {
  evaluateSpend,
  loadGovernanceWallet,
  shouldEvaluateSpend,
} from "@/lib/services/wallet/spend-governance";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";

export type X402Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type X402FetchPolicy = Pick<
  AgentWalletConfig,
  "enabled" | "provider" | "network" | "maxPaymentUsd" | "approvalRequiredOverUsd" | "autoPayEnabled" | "x402BaseUrl"
>;

export type X402FetchInput = {
  agentId: string;
  network: string;
  secret: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  policy: X402FetchPolicy;
  confirmation?: string;
  /** Granted approval id, supplied when retrying an escalated x402 payment. */
  approvalToken?: string;
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
  paymentResponse?: string;
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
  createdAt: string;
};

const spendLogPath = path.join(homedir(), ".hivemindos", "x402-spend-log.json");
const supportedEvmNetworks = new Set(["eip155:8453", "eip155:84532"]);
const supportedSvmNetworks = new Set(["solana:mainnet", "solana:devnet"]);

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
    throw new Error("x402 execution currently supports local Base, Base Sepolia, Solana mainnet, and Solana devnet wallets.");
  }
  if (input.policy.network !== input.network) throw new Error("Stored wallet network does not match the x402 policy network.");
  assertPaidUrl(input.url, input.policy.x402BaseUrl);

  // Governance pre-flight: company kill switch, cumulative budgets, approval
  // escalation. Skipped for agents with no governance configured so default
  // behaviour and request count are unchanged.
  const governance = await loadGovernanceWallet(input.agentId);
  let approvalGrantId: string | undefined;
  let spendCompanyId: string | undefined;
  if (governance && (await shouldEvaluateSpend(governance.wallet, input.policy.maxPaymentUsd))) {
    const preflightAmountUsd = await discoverX402AmountUsd(input);
    if (preflightAmountUsd != null && preflightAmountUsd > 0) {
      const decision = await evaluateSpend({
        wallet: governance.wallet,
        agentName: governance.agentName,
        kind: "x402",
        asset: "USDC",
        amountUsd: preflightAmountUsd,
        target: input.url,
        approvalToken: input.approvalToken,
      });
      if (decision.decision !== "allow") throw new Error(decision.reason);
      approvalGrantId = decision.grant?.id;
      spendCompanyId = decision.companyId;
    }
  }

  const method = parseX402Method(input.method);
  let selectedAmountUsd = 0;
  let paid = false;
  const network = x402Network(input.network);
  const scheme = supportedEvmNetworks.has(input.network)
    ? new ExactEvmScheme(privateKeyToAccount(input.secret as `0x${string}`))
    : new ExactSvmScheme(
      await createKeyPairSignerFromBytes(base58.decode(input.secret)),
      { rpcUrl: svmRpc(input.network) },
    );

  // Adapted from coinbase/x402's @x402/fetch wrapper: first request, parse 402
  // requirements, sign the selected payment, and retry with x402 payment headers.
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network, client: scheme }],
    paymentRequirementsSelector: (version: number, accepts: PaymentRequirements[]) => {
      const selected = selectRequirement(input.policy, input.confirmation)(version, accepts);
      selectedAmountUsd = amountFromRequirement(selected);
      paid = true;
      return selected;
    },
  });

  const response = await fetchWithPayment(input.url, {
    method,
    headers: {
      ...redactHeaders(input.headers),
      ...(input.body == null ? {} : { "Content-Type": "application/json" }),
    },
    body: input.body == null || method === "GET" ? undefined : JSON.stringify(input.body),
    signal: AbortSignal.timeout(60_000),
  });
  const preview = await responsePreview(response);
  const result: X402FetchResult = {
    ok: response.ok,
    status: response.status,
    url: input.url,
    method,
    network,
    amountUsd: selectedAmountUsd,
    paid,
    paymentResponse: response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE") ?? undefined,
    ...preview,
  };
  if (paid) {
    await appendSpendRecord({
      agentId: input.agentId,
      url: input.url,
      network: input.network,
      method,
      amountUsd: selectedAmountUsd,
      status: response.status,
      paid,
      createdAt: new Date().toISOString(),
    });
    await appendSpend({
      agentId: input.agentId,
      companyId: spendCompanyId,
      kind: "x402",
      asset: "USDC",
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
    throw new Error("x402 execution currently supports local Base, Base Sepolia, Solana mainnet, and Solana devnet wallets.");
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
