import { Buffer } from "node:buffer";

import { bankrApiKey } from "@/lib/services/bankr-llm";

export const BANKR_ACTION_CONFIRMATION = "BANKR_ACTION";
export const BANKR_ACTION_TOOL_NAME = "bankr_action";

export const BANKR_ACTION_INTENTS = [
  "portfolio",
  "swap",
  "token-launch",
  "polymarket",
  "hyperliquid",
  "automation",
  "nft",
  "agent-job",
  "claim-fees",
] as const;

export type BankrActionIntent = typeof BANKR_ACTION_INTENTS[number];

export type BankrActionDraft = {
  intent: BankrActionIntent;
  prompt: string;
  readOnly: boolean;
  jobId?: string;
  /** Continue an existing Bankr conversation so multi-step flows (perps collateral
   *  bridge → open, etc.) keep context across calls instead of starting fresh. */
  threadId?: string;
};

export type BankrActionResult = {
  ok: boolean;
  intent: BankrActionIntent;
  readOnly: boolean;
  summary: string;
  jobId?: string;
  threadId?: string;
  status?: string;
  raw?: unknown;
};

type BankrActionDeps = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  pollMs?: number;
  timeoutMs?: number;
};

const BANKR_API_BASE = "https://api.bankr.bot";
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_MS = 2_000;
const MAX_SUMMARY_CHARS = 2_000;

const INTENT_LABELS: Record<BankrActionIntent, string> = {
  portfolio: "Wallet portfolio",
  swap: "Swap or trade",
  "token-launch": "Token launch",
  polymarket: "Polymarket",
  hyperliquid: "Hyperliquid",
  automation: "Bankr automation",
  nft: "NFT action",
  "agent-job": "Bankr Agent API job",
  "claim-fees": "Claim trading fees",
};

const READ_ONLY_WORDS = /\b(show|check|view|list|what|which|search|find|look\s*up|lookup|status|balance|balances|portfolio|pnl|positions?|orders?|automations?|history|quote|price|prices|info|details)\b/i;
const SIDE_EFFECT_WORDS = /\b(buy|sell|swap|trade|long|short|close|open|launch|deploy|create|set\s*up|start|cancel|pause|resume|redeem|claim|mint|transfer|send|withdraw|deposit|bridge)\b/i;

export function normalizeBankrActionIntent(value: unknown): BankrActionIntent | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "token" || normalized === "launch") return "token-launch";
  if (normalized === "poly" || normalized === "prediction-market") return "polymarket";
  if (normalized === "hyper" || normalized === "perps" || normalized === "perp") return "hyperliquid";
  if (normalized === "automations" || normalized === "dca" || normalized === "twap" || normalized === "limit-order" || normalized === "stop-order") return "automation";
  if (normalized === "nfts") return "nft";
  if (normalized === "agent" || normalized === "job" || normalized === "agent-api") return "agent-job";
  if (normalized === "claim" || normalized === "claim-fee" || normalized === "fees" || normalized === "creator-fees" || normalized === "claim-creator-fees") return "claim-fees";
  return (BANKR_ACTION_INTENTS as readonly string[]).includes(normalized) ? normalized as BankrActionIntent : null;
}

export function classifyBankrActionPrompt(text: string): BankrActionDraft | null {
  const prompt = text.trim();
  if (!prompt || /\bwhat\s+can\s+(?:i|you|bankr)\s+do\b/i.test(prompt)) return null;
  const lower = prompt.toLowerCase();
  const mentionsBankr = /\bbankr\b|\bbnkr\b|\bhive\b/.test(lower);
  const jobId = prompt.match(/\bjob_[A-Za-z0-9_-]+\b/)?.[0];

  if (jobId && /\b(bankr|agent|job|status|check)\b/i.test(prompt)) {
    return { intent: "agent-job", prompt, jobId, readOnly: true };
  }
  if (/\bportfolio|balances?|wallet|pnl\b/i.test(prompt) && (mentionsBankr || /\bmy\s+(?:wallet|portfolio|balances?)\b/i.test(prompt))) {
    return { intent: "portfolio", prompt, readOnly: true };
  }
  if (/\bpolymarket|prediction market|bet\b/i.test(prompt)) {
    return { intent: "polymarket", prompt, readOnly: isReadOnlyPrompt(prompt) };
  }
  if (/\bhyperliquid|perps?|leverage|long\s+\$?\d|short\s+\$?\d\b/i.test(prompt)) {
    return { intent: "hyperliquid", prompt, readOnly: isReadOnlyPrompt(prompt) };
  }
  if (/\bnft|collectible|opensea\b/i.test(prompt)) {
    return { intent: "nft", prompt, readOnly: isReadOnlyPrompt(prompt) };
  }
  if (/\bautomation|automations|dca|twap|limit order|stop order|stop-loss|recurring\b/i.test(prompt)) {
    return { intent: "automation", prompt, readOnly: isReadOnlyPrompt(prompt) };
  }
  if (/\blaunch\s+(?:a\s+)?token|deploy\s+(?:a\s+)?token|token\s+launch\b/i.test(prompt)) {
    return { intent: "token-launch", prompt, readOnly: false };
  }
  if (/\bclaim\b.*\bfees?\b|\bfees?\b.*\bclaim\b|\bcreator\s+fees?\b|\bfee\s+nft\b/i.test(prompt)) {
    return { intent: "claim-fees", prompt, readOnly: isReadOnlyPrompt(prompt) };
  }
  if (/\bswap\b|\bbridge\b|\btrade\b|\bbuy\s+\$?\d|\bsell\s+\$?\d/i.test(prompt)) {
    if (mentionsBankr || /\b(crypto|token|eth|btc|sol|usdc|hype|bnkr|base|solana|polygon|unichain|arbitrum)\b/i.test(prompt)) {
      return { intent: "swap", prompt, readOnly: isReadOnlyPrompt(prompt) };
    }
  }
  if (/\b(?:ask|run|send)\s+bankr\b|\bbankr\s+agent\b|\bagent api\b/i.test(prompt)) {
    return { intent: "agent-job", prompt: prompt.replace(/^\s*(?:ask|run|send)\s+bankr\s*/i, "").trim() || prompt, readOnly: isReadOnlyPrompt(prompt) };
  }
  return null;
}

export function bankrActionRequiresConfirmation(draft: BankrActionDraft) {
  return !draft.readOnly;
}

export function bankrActionDraftMessage(draft: BankrActionDraft, validation = "") {
  if (validation) return ["**Bankr action unavailable**", "", validation, "", "Fix this blocker, then ask again."].join("\n");
  const payload = Buffer.from(JSON.stringify(draft), "utf8").toString("base64url");
  return [
    "**Bankr action ready**",
    "",
    `Intent \`${draft.intent}\` · ${INTENT_LABELS[draft.intent]}`,
    draft.readOnly ? "Read only. No spend approval needed." : "This can move funds, open a position, place a bet, create an automation, launch a token, or mutate Bankr state.",
    draft.jobId ? `Job \`${draft.jobId}\`` : "",
    "",
    "Prompt:",
    `> ${draft.prompt.replace(/\s+/g, " ")}`,
    "",
    `Bankr payload \`${payload}\``,
    draft.readOnly ? "Running now." : "Reply `confirm` to send this to Bankr.",
  ].filter(Boolean).join("\n");
}

export function parseBankrActionDraftMessage(text: string): BankrActionDraft | null {
  if (!/\*{0,2}Bankr action ready\*{0,2}/i.test(text)) return null;
  const payload = text.match(/Bankr payload\s+`([A-Za-z0-9_-]+)`/i)?.[1];
  if (!payload) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<BankrActionDraft>;
    const intent = normalizeBankrActionIntent(parsed.intent);
    const prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
    if (!intent || !prompt) return null;
    return {
      intent,
      prompt,
      readOnly: parsed.readOnly === true,
      jobId: typeof parsed.jobId === "string" ? parsed.jobId.trim() : undefined,
      threadId: typeof parsed.threadId === "string" ? parsed.threadId.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export function isBankrActionConfirmationText(text: string) {
  return /^(confirm|confirmed|yes|yes,?\s*confirm|go ahead|run it|execute|send it)$/i.test(text.trim());
}

export async function validateBankrActionReadiness(deps: BankrActionDeps = {}) {
  const key = deps.apiKey ?? await bankrApiKey();
  return key ? "" : "Set BANKR_API_KEY, BANKR_LLM_KEY, or BANKR_MANAGEMENT_KEY before using Bankr actions.";
}

export async function executeBankrAction(draft: BankrActionDraft, deps: BankrActionDeps = {}): Promise<BankrActionResult> {
  const apiKey = deps.apiKey ?? await bankrApiKey();
  if (!apiKey) throw new Error("Set BANKR_API_KEY, BANKR_LLM_KEY, or BANKR_MANAGEMENT_KEY before using Bankr actions.");
  if (draft.intent === "portfolio") return readBankrPortfolio(draft, apiKey, deps);
  if (draft.jobId) return readBankrJob(draft, apiKey, deps);
  return runBankrAgentPrompt(draft, apiKey, deps);
}

export function bankrActionToolDefinition() {
  return {
    type: "function",
    function: {
      name: BANKR_ACTION_TOOL_NAME,
      description:
        "Use Bankr for wallet portfolio reads and reviewed Bankr Agent API actions. " +
        "Read-only portfolio/status/search requests may run immediately. Swaps, token launches, Polymarket, Hyperliquid, automations, NFT actions, transfers, claims, and other state-changing actions are prepared only and require the user to reply confirm before execution.",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            enum: [...BANKR_ACTION_INTENTS],
            description: "The Bankr capability needed for this request.",
          },
          prompt: {
            type: "string",
            description: "The exact natural-language instruction to send to Bankr or prepare for confirmation.",
          },
          jobId: {
            type: "string",
            description: "Optional Bankr Agent API job id to inspect.",
          },
        },
        required: ["prompt"],
      },
    },
  };
}

export async function runBankrActionTool(args: Record<string, unknown>, deps: BankrActionDeps = {}) {
  const explicitIntent = normalizeBankrActionIntent(args.intent);
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const inferred = classifyBankrActionPrompt(prompt);
  const draft: BankrActionDraft | null = explicitIntent && prompt
    ? { intent: explicitIntent, prompt, readOnly: inferred?.readOnly ?? defaultReadOnlyForIntent(explicitIntent, prompt), jobId: typeof args.jobId === "string" ? args.jobId.trim() : inferred?.jobId }
    : inferred;
  if (!draft) return { ok: false, error: "That does not look like a Bankr action." };
  const validation = await validateBankrActionReadiness(deps);
  if (validation) return { ok: false, error: validation };
  if (bankrActionRequiresConfirmation(draft)) {
    return { ok: true, prepared: true, draft, message: bankrActionDraftMessage(draft) };
  }
  const result = await executeBankrAction(draft, deps);
  return { ok: true, result, message: bankrActionResultMessage(result) };
}

export function bankrActionResultMessage(result: BankrActionResult) {
  return [
    `**Bankr ${result.readOnly ? "read" : "action"} complete** · ${INTENT_LABELS[result.intent]}`,
    "",
    result.status ? `Status \`${result.status}\`` : "",
    result.jobId ? `Job \`${result.jobId}\`` : "",
    result.threadId ? `Thread \`${result.threadId}\`` : "",
    "",
    result.summary,
  ].filter(Boolean).join("\n");
}

function isReadOnlyPrompt(prompt: string) {
  if (SIDE_EFFECT_WORDS.test(prompt) && !/show|check|view|list|status|price|quote|search|find/i.test(prompt)) return false;
  return READ_ONLY_WORDS.test(prompt);
}

function defaultReadOnlyForIntent(intent: BankrActionIntent, prompt: string) {
  if (intent === "portfolio" || (intent === "agent-job" && /\bjob_[A-Za-z0-9_-]+\b/.test(prompt))) return true;
  return isReadOnlyPrompt(prompt);
}

async function readBankrPortfolio(draft: BankrActionDraft, apiKey: string, deps: BankrActionDeps): Promise<BankrActionResult> {
  const data = await bankrFetch("/wallet/portfolio?include=pnl,nfts", apiKey, deps);
  return {
    ok: true,
    intent: draft.intent,
    readOnly: true,
    summary: summarizeUnknown(data),
    raw: data,
  };
}

async function readBankrJob(draft: BankrActionDraft, apiKey: string, deps: BankrActionDeps): Promise<BankrActionResult> {
  const jobId = draft.jobId;
  if (!jobId) throw new Error("No Bankr job id was provided.");
  const data = await bankrFetch(`/agent/job/${encodeURIComponent(jobId)}`, apiKey, deps);
  const record = asRecord(data);
  return {
    ok: true,
    intent: draft.intent,
    readOnly: true,
    jobId,
    status: stringValue(record.status),
    summary: agentResponseSummary(data),
    raw: data,
  };
}

async function runBankrAgentPrompt(draft: BankrActionDraft, apiKey: string, deps: BankrActionDeps): Promise<BankrActionResult> {
  const submitted = await bankrFetch("/agent/prompt", apiKey, deps, {
    method: "POST",
    // Forward threadId to continue an existing conversation (Bankr keeps context,
    // e.g. collateral it just bridged), per the Agent API: { prompt, threadId? }.
    body: JSON.stringify(draft.threadId ? { prompt: draft.prompt, threadId: draft.threadId } : { prompt: draft.prompt }),
  });
  const submittedRecord = asRecord(submitted);
  const jobId = stringValue(submittedRecord.jobId) || stringValue(submittedRecord.id);
  const threadId = stringValue(submittedRecord.threadId);
  if (!jobId) {
    return {
      ok: true,
      intent: draft.intent,
      readOnly: draft.readOnly,
      threadId,
      summary: agentResponseSummary(submitted),
      raw: submitted,
    };
  }
  const completed = await pollBankrJob(jobId, apiKey, deps);
  const completedRecord = asRecord(completed);
  return {
    ok: true,
    intent: draft.intent,
    readOnly: draft.readOnly,
    jobId,
    threadId: stringValue(completedRecord.threadId) || threadId,
    status: stringValue(completedRecord.status),
    summary: agentResponseSummary(completed),
    raw: completed,
  };
}

async function pollBankrJob(jobId: string, apiKey: string, deps: BankrActionDeps) {
  const startedAt = Date.now();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  let latest: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await bankrFetch(`/agent/job/${encodeURIComponent(jobId)}`, apiKey, deps);
    const status = stringValue(asRecord(latest).status).toLowerCase();
    if (!status || /completed|failed|cancelled|canceled|error/.test(status)) return latest;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return latest ?? { jobId, status: "timeout", message: "Bankr job is still running." };
}

async function bankrFetch(path: string, apiKey: string, deps: BankrActionDeps, init: RequestInit = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(`${BANKR_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(Math.min(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
  });
  const data = await response.json().catch(async () => ({ text: await response.text().catch(() => "") })) as unknown;
  if (!response.ok) throw new Error(bankrErrorMessage(data, `Bankr returned HTTP ${response.status}.`));
  return data;
}

function agentResponseSummary(data: unknown) {
  const record = asRecord(data);
  const direct = [
    "response",
    "result",
    "message",
    "output",
    "text",
    "summary",
    "error",
  ].map((key) => record[key]).find((value) => typeof value === "string" && value.trim());
  if (typeof direct === "string") return truncate(direct.trim(), MAX_SUMMARY_CHARS);
  return summarizeUnknown(data);
}

function summarizeUnknown(value: unknown) {
  if (typeof value === "string") return truncate(value, MAX_SUMMARY_CHARS);
  try {
    return truncate(JSON.stringify(value, null, 2), MAX_SUMMARY_CHARS);
  } catch {
    return String(value);
  }
}

function bankrErrorMessage(data: unknown, fallback: string) {
  const record = asRecord(data);
  return stringValue(record.error) || stringValue(record.message) || stringValue(record.detail) || fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;
}

// ── Raw transaction submission (Wallet API) ─────────────────────────────────
// Unlike the natural-language /agent/prompt flow, /wallet/submit takes explicit
// calldata and signs+broadcasts from Bankr's own provisioned wallet. This is the
// reliable path for contracts Bankr's agent doesn't natively know (e.g. the
// custom HIVE staking vault) — we build the calldata, Bankr just signs it.

export type BankrSubmitTransaction = {
  to: string;
  data?: string;
  value?: string;
  chainId: number;
};

export type BankrSubmitResult = {
  transactionHash: string;
  status: string;
  signer: string;
};

/**
 * Submit a pre-built EVM transaction through Bankr's Wallet API (/wallet/submit).
 * Requires a read-write key with arbitrary contract calls enabled; a read-only
 * key returns 403 and this throws with Bankr's message. Waits for on-chain
 * confirmation by default and throws if Bankr reports the transaction reverted.
 */
export async function submitBankrTransaction(
  transaction: BankrSubmitTransaction,
  options: { description?: string; waitForConfirmation?: boolean } = {},
  deps: BankrActionDeps = {},
): Promise<BankrSubmitResult> {
  const apiKey = deps.apiKey ?? await bankrApiKey();
  if (!apiKey) throw new Error("Set BANKR_API_KEY, BANKR_LLM_KEY, or BANKR_MANAGEMENT_KEY before using Bankr actions.");
  const waitForConfirmation = options.waitForConfirmation ?? true;
  const data = await bankrFetch("/wallet/submit", apiKey, deps, {
    method: "POST",
    body: JSON.stringify({ transaction, description: options.description, waitForConfirmation }),
  });
  const record = asRecord(data);
  const status = stringValue(record.status).toLowerCase();
  const transactionHash = stringValue(record.transactionHash) || stringValue(record.hash) || stringValue(record.txHash);
  if (status === "reverted") {
    throw new Error(`Bankr transaction reverted${transactionHash ? ` (${transactionHash})` : ""}.`);
  }
  if (waitForConfirmation && !transactionHash) {
    throw new Error(bankrErrorMessage(data, "Bankr did not return a transaction hash for the submitted transaction."));
  }
  return {
    transactionHash,
    status: status || (waitForConfirmation ? "success" : "pending"),
    signer: stringValue(record.signer),
  };
}

/** Probe the Bankr portfolio response for the provisioned EVM wallet address. */
export function extractBankrWalletAddress(raw: unknown): string {
  const record = asRecord(raw);
  const direct = ["address", "walletAddress", "account", "accountAddress", "evmAddress", "ethAddress"]
    .map((key) => stringValue(record[key]))
    .find(Boolean);
  if (direct) return direct;
  const wallet = asRecord(record.wallet);
  return ["address", "walletAddress", "account"].map((key) => stringValue(wallet[key])).find(Boolean) ?? "";
}

/** Read the Bankr-provisioned wallet's EVM address (empty string if unavailable). */
export async function readBankrWalletAddress(deps: BankrActionDeps = {}): Promise<string> {
  const result = await executeBankrAction({ intent: "portfolio", prompt: "portfolio", readOnly: true }, deps);
  return extractBankrWalletAddress((result as { raw?: unknown }).raw);
}
