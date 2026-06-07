import "server-only";

import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import type { MiroSharkPolymarketDetailData, MiroSharkPolymarketRung } from "@/lib/types/miroshark-polymarket";
import {
  getMiroSharkX402Report,
  getMiroSharkX402Status,
  runMiroSharkX402,
  type MiroSharkX402RunPayload,
  type MiroSharkX402RunResult,
} from "@/lib/services/miroshark/x402-buyer";

type ChatMessageLike = {
  role?: string;
  content?: unknown;
};

export type MiroSharkChatRunDraft = {
  deepResearch: boolean;
  marketUrl?: string;
  maxPaymentUsd: number;
  payload: MiroSharkX402RunPayload;
  seed: string;
  seedKind: "prompt" | "url" | "article";
  title: string;
};

export type MiroSharkChatRunSnapshot = {
  report?: unknown;
  reportMarkdown?: string;
  status?: unknown;
  timedOut?: boolean;
};

export type MiroSharkChatSimulationCardPayload = {
  miroshark: {
    amountUsd?: number;
    deepResearch?: boolean;
    network?: string;
    paid?: boolean;
    paymentLabel?: string;
    polymarketDetail?: MiroSharkPolymarketDetailData;
    reportMarkdown?: string;
    reportUrl?: string;
    runId?: string;
    seed: string;
    status: string;
    statusUrl?: string;
    title: string;
    waitUrl?: string;
  };
};

const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/gi;
const POLYMARKET_EVENT_PATTERN = /https:\/\/(?:www\.)?polymarket\.com\/event\/[A-Za-z0-9_-]+/i;
const DEFAULT_MIROSHARK_MAX_USD = 1;
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 9.25 * 60 * 1000;
const TERMINAL_STATUS_PATTERN = /\b(?:complete|completed|success|succeeded|ready|failed|failure|error|cancelled|canceled|stopped)\b/i;
const SUCCESS_STATUS_PATTERN = /\b(?:complete|completed|success|succeeded|ready)\b/i;

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function messageText(message?: ChatMessageLike) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => isRecord(part) ? optionalString(part.text) : "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function latestUserMessage(messages: ChatMessageLike[]) {
  return [...messages].reverse().find((message) => message.role === "user" && messageText(message).trim());
}

function cleanUrl(value: string) {
  return value.trim().replace(/[`\]).,;:]+$/, "");
}

function urlsFromText(text: string) {
  return Array.from(text.matchAll(URL_PATTERN)).map((match) => cleanUrl(match[0]));
}

function titleFromPolymarketUrl(url: string) {
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    const words = slug
      .replace(/ipo/g, "IPO")
      .replace(/spacex/g, "SpaceX")
      .split("-")
      .filter(Boolean);
    if (!words.length) return "Polymarket simulation";
    const phrase = words.map((word) => {
      if (/^(IPO|SEC|ETF|BTC|ETH|AI|US|USA)$/i.test(word)) return word.toUpperCase();
      if (/^SpaceX$/i.test(word)) return "SpaceX";
      return word.slice(0, 1).toUpperCase() + word.slice(1);
    }).join(" ");
    return /\babove\b/i.test(phrase) ? `${phrase.replace(/\babove\b/i, "above")} ___ ?` : `${phrase}?`;
  } catch {
    return "Polymarket simulation";
  }
}

function subjectFromText(text: string, fallback = "MiroShark simulation") {
  const withoutUrls = text.replace(URL_PATTERN, "").replace(/\s+/g, " ").trim();
  const afterColon = withoutUrls.match(/(?:this|scenario|prompt|market|polymarket)\s*:\s*(.+)$/i)?.[1]?.trim();
  const clean = (afterColon || withoutUrls)
    .replace(/^(yo\s+)?(?:please\s+)?(?:run|start|launch|simulate)\s+(?:a\s+)?(?:miroshark\s+)?(?:sim|simulation)\s+(?:on|for|of|about)?\s*/i, "")
    .replace(/^(?:this\s+)?(?:polymarket|prediction\s+market)\s*:?\s*/i, "")
    .trim();
  if (clean.length >= 4 && clean.length <= 180) return clean;
  return fallback;
}

function isMiroSharkRunRequest(text: string) {
  const normalized = text.toLowerCase();
  if (!/\b(run|start|launch|simulate|sim)\b/.test(normalized)) return false;
  if (/\b(status|report|open|show|preview|card|modal)\b/.test(normalized) && !/\brun\b/.test(normalized)) return false;
  return /\bmiroshark\b/.test(normalized)
    || /\b(run|start|launch)\s+(?:a\s+)?(?:sim|simulation)\b/.test(normalized)
    || /\bpolymarket\b/.test(normalized)
    || /\bprediction\s+market\b/.test(normalized);
}

function maxPaymentFromText(text: string, wallet?: AgentWalletConfig) {
  const explicit = text.match(/\b(?:max|cap|limit)(?:imum)?(?:\s+(?:payment|spend|of|at))?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USD)?/i)?.[1];
  const parsed = Number(explicit);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return Math.min(Math.max(Number(wallet?.maxPaymentUsd) || DEFAULT_MIROSHARK_MAX_USD, DEFAULT_MIROSHARK_MAX_USD), DEFAULT_MIROSHARK_MAX_USD);
}

export function findMiroSharkChatRunRequest(messages: ChatMessageLike[], wallet?: AgentWalletConfig): MiroSharkChatRunDraft | null {
  const latest = latestUserMessage(messages);
  const text = messageText(latest).trim();
  if (!text || !isMiroSharkRunRequest(text)) return null;

  const urls = urlsFromText(text);
  const polymarketUrl = urls.find((url) => POLYMARKET_EVENT_PATTERN.test(url));
  const seedUrl = polymarketUrl ?? urls[0];
  const deepResearch = /\bdeep\s+research\b|\bresearch\b/i.test(text);
  const maxPaymentUsd = maxPaymentFromText(text, wallet);

  if (seedUrl) {
    const title = polymarketUrl ? titleFromPolymarketUrl(polymarketUrl) : subjectFromText(text, "URL simulation");
    return {
      deepResearch,
      marketUrl: polymarketUrl,
      maxPaymentUsd,
      payload: {
        url: seedUrl,
        ...(deepResearch ? { deep_research: true } : {}),
        ...(polymarketUrl ? { prediction_market: title } : {}),
      },
      seed: seedUrl,
      seedKind: "url",
      title,
    };
  }

  const seed = subjectFromText(text);
  if (seed.length < 4) return null;
  const seedKind = seed.length > 1_200 ? "article" : "prompt";
  return {
    deepResearch,
    maxPaymentUsd,
    payload: {
      [seedKind]: seed,
      ...(deepResearch ? { deep_research: true } : {}),
    },
    seed,
    seedKind,
    title: seed.length <= 120 ? seed : "MiroShark simulation",
  };
}

export function validateMiroSharkChatRun(wallet: AgentWalletConfig | undefined, draft: MiroSharkChatRunDraft) {
  if (!wallet) return "No wallet is configured for this agent.";
  if (!wallet.enabled) return "Wallet spending is off for this agent. Enable Spend on before running a paid MiroShark simulation.";
  if (wallet.provider !== "x402") return "Set this agent's payment provider to x402 before running paid MiroShark simulations.";
  if (!wallet.autoPayEnabled) return "Direct MiroShark chat runs need Allow auto-use on for the $1 x402 payment.";
  if (!/^eip155:8453$|^eip155:84532$|^solana:(?:mainnet|devnet)$/.test(wallet.network || "")) {
    return "MiroShark x402 runs need a supported local x402 wallet network.";
  }
  if (draft.maxPaymentUsd > wallet.maxPaymentUsd) {
    return `MiroShark needs up to ${draft.maxPaymentUsd.toFixed(2)} USDC, above this agent's ${wallet.maxPaymentUsd.toFixed(2)} USDC cap.`;
  }
  if (wallet.maxPaymentUsd < DEFAULT_MIROSHARK_MAX_USD) {
    return `MiroShark runs cost about ${DEFAULT_MIROSHARK_MAX_USD.toFixed(2)} USDC, above this agent's ${wallet.maxPaymentUsd.toFixed(2)} USDC cap.`;
  }
  return "";
}

export async function executeMiroSharkChatRun(agentId: string, wallet: AgentWalletConfig, draft: MiroSharkChatRunDraft) {
  return runMiroSharkX402({
    agentId,
    ...draft.payload,
    policy: {
      ...wallet,
      maxPaymentUsd: Math.min(wallet.maxPaymentUsd, Math.max(DEFAULT_MIROSHARK_MAX_USD, draft.maxPaymentUsd)),
      provider: "x402",
      autoPayEnabled: wallet.autoPayEnabled,
    },
    confirmation: "PAY_X402",
  });
}

export function extractMiroSharkRunId(...sources: unknown[]) {
  return firstStringByKeys(sources, ["run_id", "runId", "run", "id", "simulation_id", "simulationId"], /^(?:run|sim)_[A-Za-z0-9_-]+$/i);
}

export async function waitForMiroSharkCompletion(
  runId: string,
  onStatus: (status: unknown, statusLabel: string) => Promise<void>,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<MiroSharkChatRunSnapshot> {
  if (!/^run_[A-Za-z0-9_-]+$/.test(runId)) return { timedOut: true };
  const startedAt = Date.now();
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? POLL_TIMEOUT_MS;
  let latestStatus: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    latestStatus = await getMiroSharkX402Status(runId);
    const statusLabel = statusText(latestStatus);
    await onStatus(latestStatus, statusLabel);
    if (TERMINAL_STATUS_PATTERN.test(statusLabel)) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const finalStatus = statusText(latestStatus);
  if (latestStatus && !SUCCESS_STATUS_PATTERN.test(finalStatus) && TERMINAL_STATUS_PATTERN.test(finalStatus)) {
    return { status: latestStatus };
  }
  if (!latestStatus || !SUCCESS_STATUS_PATTERN.test(finalStatus)) {
    return { status: latestStatus, timedOut: true };
  }

  const report = await getMiroSharkX402Report(runId, "json").catch(() => null);
  const reportMarkdown = reportMarkdownFromPayload(report)
    || await getMiroSharkX402Report(runId, "md")
      .then(reportMarkdownFromPayload)
      .catch(() => "");
  return { report, reportMarkdown, status: latestStatus };
}

export function buildMiroSharkChatCard(input: {
  draft: MiroSharkChatRunDraft;
  elapsedMs: number;
  paidRun?: MiroSharkX402RunResult;
  runId?: string;
  snapshot?: MiroSharkChatRunSnapshot;
}): MiroSharkChatSimulationCardPayload {
  const sources = [input.snapshot?.report, input.snapshot?.status, input.paidRun?.miroshark, input.paidRun?.result.bodyJson];
  const runId = input.runId || extractMiroSharkRunId(...sources) || "";
  const status = input.snapshot?.timedOut
    ? "running"
    : statusText(input.snapshot?.status) || (input.snapshot?.report || input.snapshot?.reportMarkdown ? "complete" : "running");
  const reportMarkdown = input.snapshot?.reportMarkdown || reportMarkdownFromPayload(input.snapshot?.report) || "";
  const reportUrl = firstStringByKeys(sources, ["report_url", "reportUrl", "report"], /^https?:\/\//i);
  const statusUrl = firstStringByKeys(sources, ["status_url", "statusUrl", "status"], /^https?:\/\//i);
  const waitUrl = firstStringByKeys(sources, ["wait_url", "waitUrl", "wait"], /^https?:\/\//i);
  const title = titleFromSources(sources, input.draft.title);
  const detail = buildPolymarketDetailData({
    draft: input.draft,
    report: input.snapshot?.report,
    reportMarkdown,
    status: input.snapshot?.status,
    title,
  });

  return {
    miroshark: {
      amountUsd: input.paidRun?.result.amountUsd,
      deepResearch: input.draft.deepResearch,
      network: input.paidRun?.result.network,
      paid: input.paidRun?.result.paid,
      paymentLabel: input.paidRun?.result.amountUsd ? `$${input.paidRun.result.amountUsd.toFixed(2)} USDC` : "$1.00 USDC",
      polymarketDetail: detail,
      reportMarkdown: reportMarkdown || (input.snapshot?.timedOut
        ? `### ${title}\n\nMiroShark accepted the paid run and it is still running. Ask the agent to check status for run \`${runId}\` when it finishes.`
        : ""),
      reportUrl,
      runId,
      seed: input.draft.seed,
      status,
      statusUrl,
      title,
      waitUrl,
    },
  };
}

function titleFromSources(sources: unknown[], fallback: string) {
  return firstStringByKeys(sources, ["market", "market_title", "marketTitle", "question", "title", "name", "scenario", "prompt"], undefined, 180)
    || fallback;
}

function statusText(value: unknown) {
  if (!value) return "";
  const direct = typeof value === "string" ? value : "";
  if (direct) return direct;
  return firstStringByKeys([value], ["status", "state", "runner_status", "runnerStatus", "phase", "message"], undefined, 80);
}

function reportMarkdownFromPayload(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const direct = firstStringByKeys([value], ["report_markdown", "reportMarkdown", "markdown", "report_md", "reportMd"], undefined, 200_000);
  if (direct) return direct;
  const report = firstValueByKeys([value], ["report"]);
  return typeof report === "string" && report.includes("\n") ? report.trim() : "";
}

function firstValueByKeys(sources: unknown[], keys: string[]): unknown {
  const wanted = new Set(keys.map(normalizeKey));
  const seen = new Set<unknown>();
  const visit = (value: unknown): unknown => {
    if (!isRecord(value) && !Array.isArray(value)) return undefined;
    if (seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    for (const [key, child] of Object.entries(value)) {
      if (wanted.has(normalizeKey(key))) return child;
    }
    for (const child of Object.values(value)) {
      const found = visit(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  for (const source of sources) {
    const found = visit(source);
    if (found !== undefined) return found;
  }
  return undefined;
}

function firstStringByKeys(sources: unknown[], keys: string[], pattern?: RegExp, maxLength = 500) {
  const found = firstValueByKeys(sources, keys);
  const direct = optionalString(found);
  if (direct && direct.length <= maxLength && (!pattern || pattern.test(direct))) return direct;

  const seen = new Set<unknown>();
  const visit = (value: unknown): string => {
    if (typeof value === "string") {
      const clean = value.trim();
      return clean && clean.length <= maxLength && (!pattern || pattern.test(clean)) ? clean : "";
    }
    if (!isRecord(value) && !Array.isArray(value)) return "";
    if (seen.has(value)) return "";
    seen.add(value);
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) {
      const foundChild = visit(child);
      if (foundChild) return foundChild;
    }
    return "";
  };
  for (const source of sources) {
    const foundAny = visit(source);
    if (foundAny) return foundAny;
  }
  return "";
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function payloadArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["items", "data", "results", "markets", "rungs", "ladder", "thresholds", "outcomes", "recommendations", "best_bets"]) {
    const child = value[key];
    if (Array.isArray(child)) return child;
    if (isRecord(child)) {
      const nested = payloadArray(child);
      if (nested.length) return nested;
    }
  }
  return [];
}

function collectArraysByKeys(sources: unknown[], keys: string[]) {
  const wanted = new Set(keys.map(normalizeKey));
  const arrays: unknown[][] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (!isRecord(value) && !Array.isArray(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (wanted.has(normalizeKey(key))) {
        const array = payloadArray(child);
        if (array.length) arrays.push(array);
      }
      visit(child);
    }
  };
  sources.forEach(visit);
  return arrays;
}

function numericValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key] ?? record[camelKey(key)];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[%¢$,]/g, "").trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function stringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key] ?? record[camelKey(key)];
    const clean = optionalString(value);
    if (clean) return clean;
  }
  return "";
}

function camelKey(value: string) {
  return value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function probability(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return undefined;
  if (value > 0 && value <= 1) return +(value * 100).toFixed(2);
  return +value.toFixed(2);
}

function cents(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return undefined;
  if (value > 0 && value <= 1) return +(value * 100).toFixed(2);
  return +value.toFixed(2);
}

function thresholdFromRecord(record: Record<string, unknown>) {
  const explicit = stringValue(record, ["threshold", "thr", "target", "strike", "level", "outcome"]);
  if (explicit) return explicit;
  const text = stringValue(record, ["question", "title", "name", "market"]);
  const trillion = text.match(/\b(?:above|over|>|greater than)\s+\$?([0-9.]+)\s*T\b/i)?.[1];
  if (trillion) return `>$${trillion}T`;
  const billion = text.match(/\b(?:above|over|>|greater than)\s+\$?([0-9.]+)\s*B\b/i)?.[1];
  if (billion) return `>$${billion}B`;
  return text.slice(0, 42);
}

function callFromValue(value: string): "no" | "yes" | "skip" | undefined {
  if (/\bno\b|short|fade|sell/i.test(value)) return "no";
  if (/\byes\b|long|buy/i.test(value)) return "yes";
  if (/skip|hold|neutral|none/i.test(value)) return "skip";
  return undefined;
}

function rungFromRecord(value: unknown): MiroSharkPolymarketRung | null {
  if (!isRecord(value)) return null;
  const threshold = thresholdFromRecord(value);
  if (!threshold) return null;
  const yesPrice = cents(numericValue(value, ["yes_price", "yesPrice", "yes", "price", "last_price", "lastPrice"]));
  const noPrice = cents(numericValue(value, ["no_price", "noPrice", "no"]));
  const crowdProbability = probability(numericValue(value, [
    "crowd_probability",
    "crowdProbability",
    "market_probability",
    "marketProbability",
    "implied_probability",
    "impliedProbability",
    "probability",
    "pct",
    "yes_probability",
    "yesProbability",
  ])) ?? yesPrice;
  const simProbability = probability(numericValue(value, [
    "sim_probability",
    "simProbability",
    "model_probability",
    "modelProbability",
    "miroshark_probability",
    "mirosharkProbability",
    "fair_probability",
    "fairProbability",
    "fair",
    "sim",
  ]));
  const edge = numericValue(value, ["edge", "edge_pp", "edgePp"]);
  const derivedEdge = edge ?? (crowdProbability != null && simProbability != null ? +(crowdProbability - simProbability).toFixed(2) : undefined);
  const call = callFromValue(stringValue(value, ["call", "recommendation", "side", "action"]))
    ?? (derivedEdge == null ? "skip" : derivedEdge >= 1.8 ? "no" : derivedEdge <= -1.8 ? "yes" : "skip");
  const resolvedNoPrice = noPrice ?? (yesPrice == null ? undefined : +(100 - yesPrice).toFixed(2));
  const expectedValue = numericValue(value, ["expected_value", "expectedValue", "ev"])
    ?? (call === "no" && resolvedNoPrice && simProbability != null ? (1 - simProbability / 100) / (resolvedNoPrice / 100) - 1 : undefined)
    ?? (call === "yes" && yesPrice && simProbability != null ? (simProbability / 100) / (yesPrice / 100) - 1 : undefined);
  if (crowdProbability == null && simProbability == null && yesPrice == null && resolvedNoPrice == null) return null;
  return {
    call,
    crowdProbability,
    edge: derivedEdge,
    expectedValue: expectedValue == null ? undefined : +expectedValue.toFixed(4),
    noPrice: resolvedNoPrice,
    simProbability,
    strength: derivedEdge == null ? undefined : Math.abs(derivedEdge) >= 8 ? 3 : Math.abs(derivedEdge) >= 4 ? 2 : Math.abs(derivedEdge) >= 1.8 ? 1 : 0,
    threshold,
    volume: stringValue(value, ["volume", "vol", "liquidity", "volume_24h", "volume24h"]),
    yesPrice,
  };
}

function collectRungs(sources: unknown[]) {
  const arrays = collectArraysByKeys(sources, ["ladder", "rungs", "thresholds", "outcomes", "markets", "recommendations", "best_bets", "bestBets"]);
  const rungs = arrays.flatMap((array) => array.map(rungFromRecord).filter(Boolean) as MiroSharkPolymarketRung[]);
  const byThreshold = new Map<string, MiroSharkPolymarketRung>();
  for (const rung of rungs) {
    const key = rung.threshold.toLowerCase();
    const existing = byThreshold.get(key);
    byThreshold.set(key, { ...(existing ?? {}), ...rung });
  }
  return [...byThreshold.values()].slice(0, 48);
}

function bestBetsFromSources(sources: unknown[], rungs: MiroSharkPolymarketRung[]) {
  const explicit = collectArraysByKeys(sources, ["best_bets", "bestBets", "recommendations", "top_picks", "topPicks"])
    .flatMap((array) => array.map(rungFromRecord).filter(Boolean) as MiroSharkPolymarketRung[]);
  const pool = explicit.length ? explicit : rungs.filter((rung) => rung.call && rung.call !== "skip");
  return pool
    .sort((a, b) => (b.expectedValue ?? 0) - (a.expectedValue ?? 0))
    .slice(0, 3)
    .map((rung, index) => ({ ...rung, rank: index + 1 }));
}

function firstNumberByKeys(sources: unknown[], keys: string[]) {
  const value = firstValueByKeys(sources, keys);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[%,$]/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function risksFromSources(sources: unknown[]) {
  const arrays = collectArraysByKeys(sources, ["risks", "risk", "warnings"]);
  return arrays.flatMap((array) => array.flatMap((item) => {
    if (typeof item === "string") return [{ label: "Risk", value: item, detail: "" }];
    if (!isRecord(item)) return [];
    const label = stringValue(item, ["label", "name", "risk", "title"]) || "Risk";
    const value = stringValue(item, ["value", "level", "severity"]) || label;
    const detail = stringValue(item, ["detail", "description", "body", "text"]);
    const levelText = `${value} ${detail}`;
    const level = /high/i.test(levelText) ? "high" : /med/i.test(levelText) ? "med" : /low/i.test(levelText) ? "low" : undefined;
    return [{ label, value, detail, level }];
  })).slice(0, 4);
}

function factionsFromSources(sources: unknown[]) {
  const arrays = collectArraysByKeys(sources, ["factions", "cohorts", "agents", "personas"]);
  return arrays.flatMap((array) => array.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const name = stringValue(item, ["name", "label", "group", "persona"]) || `Group ${index + 1}`;
    const value = stringValue(item, ["value", "median", "position", "stance", "estimate"]) || stringValue(item, ["summary"]);
    if (!value) return [];
    return [{
      color: ["var(--cyan)", "var(--pm-no)", "var(--honey)", "var(--fg-2)"][index % 4],
      count: numericValue(item, ["count", "n", "agents"]),
      name,
      value,
    }];
  })).slice(0, 6);
}

function attributionFromSources(sources: unknown[]) {
  const arrays = collectArraysByKeys(sources, ["attribution", "drivers", "factors", "why"]);
  const items = arrays.flatMap((array) => array.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = stringValue(item, ["name", "label", "factor", "title"]);
    const amount = numericValue(item, ["amount", "impact", "delta", "pp"]);
    return name && amount != null ? [{ name, amount }] : [];
  })).slice(0, 6);
  if (!items.length) return undefined;
  return {
    items,
    base: firstNumberByKeys(sources, ["crowd_probability", "crowdProbability", "base_probability", "baseProbability"]),
    baseLabel: firstStringByKeys(sources, ["base_label", "baseLabel"], undefined, 80),
    net: firstNumberByKeys(sources, ["sim_probability", "simProbability", "net_probability", "netProbability"]),
    netLabel: firstStringByKeys(sources, ["net_label", "netLabel"], undefined, 80),
  };
}

function buildPolymarketDetailData(input: {
  draft: MiroSharkChatRunDraft;
  report?: unknown;
  reportMarkdown?: string;
  status?: unknown;
  title: string;
}): MiroSharkPolymarketDetailData | undefined {
  const sources = [input.report, input.status];
  const marketUrl = input.draft.marketUrl
    || firstStringByKeys(sources, ["market_url", "marketUrl", "url"], POLYMARKET_EVENT_PATTERN);
  if (!marketUrl && !/\bpolymarket|prediction market\b/i.test(`${input.draft.seed}\n${input.title}\n${input.reportMarkdown ?? ""}`)) return undefined;
  const rungs = collectRungs(sources);
  const bestBets = bestBetsFromSources(sources, rungs);
  const top = bestBets[0];
  const noCount = rungs.filter((rung) => rung.call === "no").length;
  const bestBand = bestBets.map((bet) => bet.threshold).slice(0, 2).join(" / ");
  return {
    agents: firstNumberByKeys(sources, ["agents", "agent_count", "agentCount", "n_agents", "nAgents"]),
    attribution: attributionFromSources(sources),
    bestBets,
    callout: {
      label: firstStringByKeys(sources, ["callout_label", "calloutLabel"], undefined, 80) || "the sim's call",
      headline: firstStringByKeys(sources, ["verdict", "headline", "summary"], undefined, 120)
        || (top?.call === "no" ? "Crowd overpays the upside" : top?.call === "yes" ? "Crowd underprices the upside" : "Simulation report ready"),
      subhead: firstStringByKeys(sources, ["subhead", "subtitle", "reason"], undefined, 180)
        || (rungs.length ? `${noCount} of ${rungs.length} rungs lean NO${bestBand ? ` · best edge around ${bestBand}` : ""}` : "MiroShark returned the report; structured ladder data was limited."),
    },
    confidence: firstNumberByKeys(sources, ["confidence", "conf", "model_confidence", "modelConfidence"]),
    factions: factionsFromSources(sources),
    market: firstStringByKeys(sources, ["market", "market_title", "marketTitle", "question", "title"], undefined, 140) || input.title,
    marketUrl,
    note: "MiroShark output - synthetic simulation, not financial advice.",
    outcomes: firstNumberByKeys(sources, ["outcomes", "thresholds", "rungs"]) ?? (rungs.length || undefined),
    readRule: firstStringByKeys(sources, ["read_rule", "readRule"], undefined, 180),
    resolves: firstStringByKeys(sources, ["resolves", "resolution", "resolution_date", "resolutionDate"], undefined, 80),
    risks: risksFromSources(sources),
    rungs,
    source: rungs.length || bestBets.length ? "miroshark" : "fallback",
    volume: firstStringByKeys(sources, ["volume", "vol", "liquidity"], undefined, 80),
  };
}
