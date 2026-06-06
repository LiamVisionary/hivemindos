import "server-only";

import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { executeX402Fetch, type X402FetchPolicy, type X402FetchResult } from "@/lib/services/wallet/x402-agent-fetch";

export const MIROSHARK_X402_BASE_URL = "https://x402.miroshark.xyz";

export type MiroSharkX402PredictionMarket = string | {
  question: string;
  outcome_a?: string;
  outcome_b?: string;
  initial_probability?: number;
};

export type MiroSharkX402RunRequest = {
  agentId?: string;
  prompt?: unknown;
  url?: unknown;
  article?: unknown;
  deep_research?: unknown;
  deepResearch?: unknown;
  prediction_market?: unknown;
  predictionMarket?: unknown;
  affiliate?: unknown;
  policy?: Partial<AgentWalletConfig>;
  confirmation?: unknown;
};

export type MiroSharkX402RunPayload = {
  prompt?: string;
  url?: string;
  article?: string;
  deep_research?: boolean;
  prediction_market?: MiroSharkX402PredictionMarket;
  affiliate?: string;
};

export type MiroSharkX402RunResult = {
  result: X402FetchResult;
  miroshark: unknown;
};

const RUN_ID_PATTERN = /^run_[a-zA-Z0-9_-]+$/;
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function assertLength(label: string, value: string, min: number, max: number) {
  if (value.length < min || value.length > max) {
    throw new Error(`${label} must be ${min}-${max} characters.`);
  }
}

function assertHttpUrl(label: string, value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`${label} must use HTTP or HTTPS.`);
}

function normalizePredictionMarket(value: unknown): MiroSharkX402PredictionMarket | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") {
    const question = value.trim();
    assertLength("prediction_market question", question, 4, 300);
    return question;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("prediction_market must be a question string or object.");
  }
  const record = value as Record<string, unknown>;
  const question = optionalString(record.question);
  assertLength("prediction_market.question", question, 4, 300);
  const market: Exclude<MiroSharkX402PredictionMarket, string> = { question };
  const outcomeA = optionalString(record.outcome_a);
  const outcomeB = optionalString(record.outcome_b);
  if (outcomeA) market.outcome_a = outcomeA.slice(0, 80);
  if (outcomeB) market.outcome_b = outcomeB.slice(0, 80);
  if (record.initial_probability != null && record.initial_probability !== "") {
    const initialProbability = Number(record.initial_probability);
    if (!Number.isFinite(initialProbability) || initialProbability <= 0 || initialProbability >= 1) {
      throw new Error("prediction_market.initial_probability must be greater than 0 and less than 1.");
    }
    market.initial_probability = Math.min(0.9, Math.max(0.1, initialProbability));
  }
  return market;
}

export function normalizeMiroSharkX402RunPayload(input: MiroSharkX402RunRequest): MiroSharkX402RunPayload {
  const prompt = optionalString(input.prompt);
  const url = optionalString(input.url);
  const article = optionalString(input.article);
  const seeds = [prompt, url, article].filter(Boolean);
  if (seeds.length !== 1) throw new Error("Provide exactly one MiroShark seed: prompt, url, or article.");

  const payload: MiroSharkX402RunPayload = {};
  if (prompt) {
    assertLength("prompt", prompt, 4, 4000);
    payload.prompt = prompt;
  }
  if (url) {
    assertHttpUrl("url", url);
    payload.url = url;
  }
  if (article) {
    assertLength("article", article, 4, 200000);
    payload.article = article;
  }
  if (input.deep_research === true || input.deepResearch === true) payload.deep_research = true;

  const predictionMarket = normalizePredictionMarket(input.prediction_market ?? input.predictionMarket);
  if (predictionMarket) payload.prediction_market = predictionMarket;

  const affiliate = optionalString(input.affiliate);
  if (affiliate) {
    if (!EVM_ADDRESS_PATTERN.test(affiliate)) throw new Error("affiliate must be a valid EVM 0x address.");
    payload.affiliate = affiliate;
  }
  return payload;
}

function positiveMoney(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePolicy(policy: Partial<AgentWalletConfig> | undefined, network: string): X402FetchPolicy {
  return {
    enabled: Boolean(policy?.enabled),
    provider: policy?.provider ?? "manual",
    network: policy?.network || network,
    maxPaymentUsd: positiveMoney(policy?.maxPaymentUsd, 1),
    approvalRequiredOverUsd: positiveMoney(policy?.approvalRequiredOverUsd, 0),
    autoPayEnabled: Boolean(policy?.autoPayEnabled),
    x402BaseUrl: policy?.x402BaseUrl || MIROSHARK_X402_BASE_URL,
  };
}

export async function runMiroSharkX402(input: MiroSharkX402RunRequest): Promise<MiroSharkX402RunResult> {
  const agentId = optionalString(input.agentId);
  if (!agentId) throw new Error("agentId is required for paid MiroShark x402 runs.");
  const stored = await getWalletSecret(agentId);
  if (!stored) throw new Error("No local wallet exists for this agent.");

  const payload = normalizeMiroSharkX402RunPayload(input);
  const result = await executeX402Fetch({
    agentId,
    network: stored.info.network,
    secret: stored.secret,
    url: `${MIROSHARK_X402_BASE_URL}/run`,
    method: "POST",
    body: payload,
    policy: normalizePolicy(input.policy, stored.info.network),
    confirmation: optionalString(input.confirmation),
  });
  return { result, miroshark: result.bodyJson };
}

export async function suggestMiroSharkX402(promptInput: unknown) {
  const prompt = optionalString(promptInput);
  assertLength("prompt", prompt, 2, 4000);
  const response = await fetch(`${MIROSHARK_X402_BASE_URL}/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(`MiroShark suggest failed: HTTP ${response.status}`);
  return payload;
}

export function normalizeMiroSharkRunId(value: unknown) {
  const runId = optionalString(value);
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("runId must be a MiroShark run id such as run_abc123.");
  return runId;
}

export async function getMiroSharkX402Status(runIdInput: unknown) {
  const runId = normalizeMiroSharkRunId(runIdInput);
  const response = await fetch(`${MIROSHARK_X402_BASE_URL}/status/${encodeURIComponent(runId)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(`MiroShark status failed: HTTP ${response.status}`);
  return payload;
}

export async function getMiroSharkX402Report(runIdInput: unknown, formatInput: unknown) {
  const runId = normalizeMiroSharkRunId(runIdInput);
  const format = optionalString(formatInput) === "md" ? "md" : "json";
  const response = await fetch(`${MIROSHARK_X402_BASE_URL}/report/${encodeURIComponent(runId)}?format=${format}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`MiroShark report failed: HTTP ${response.status}`);
  if (format === "md") {
    return {
      success: true,
      data: {
        run_id: runId,
        report_markdown: await response.text(),
      },
    };
  }
  return response.json().catch(() => null) as Promise<unknown>;
}
