import { createHash } from "node:crypto";
import { hostname } from "node:os";

import {
  evolveAgentMemory,
  rememberAgentMemory,
  type EvolveAgentMemoryInput,
  type RememberAgentMemoryInput,
} from "@/lib/services/obsidian/agent-memory";
import type {
  CopyTradeAgentReview,
  CopyTradeBrainSyncReceipt,
  CopyTradeCounterfactual,
  CopyTradeRuntimeState,
  CopyTradingConfig,
} from "@/lib/types/copy-trading";
import { writeRuntimeState } from "./store";

const MAX_SYNC_PER_RUN = 8;
const MAX_SYNC_ERROR_CHARS = 240;
const MAX_EVIDENCE_TEXT_CHARS = 1_200;
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;

type BrainRecord = { id: string; content?: string };
type BrainWriteResult = {
  record?: BrainRecord;
  blocked?: boolean;
  canonicalHeadConflict?: BrainRecord;
};

export type CopyTradeBrainSyncDependencies = {
  remember: (input: RememberAgentMemoryInput) => Promise<BrainWriteResult>;
  evolve: (input: EvolveAgentMemoryInput) => Promise<BrainWriteResult>;
  persistState: (state: CopyTradeRuntimeState) => Promise<void>;
  now: () => number;
};

export type CopyTradeBrainSyncSummary = {
  eligible: number;
  attempted: number;
  synced: number;
  failed: number;
  unchanged: number;
  deferred: number;
};

type CopyTradeBrainMemory = {
  memoryKey: string;
  contentHash: string;
  input: RememberAgentMemoryInput;
};

const DEFAULT_DEPENDENCIES: CopyTradeBrainSyncDependencies = {
  remember: rememberAgentMemory,
  evolve: evolveAgentMemory,
  persistState: writeRuntimeState,
  now: Date.now,
};

/**
 * Sync matured paper-trade learnings after their local runtime state is durable.
 * A Brain failure never removes or rewrites the local retrospective. Canonical
 * memory keys make retries and cross-process recovery idempotent.
 */
export async function syncCopyTradeRetrospectivesToBrain(
  config: CopyTradingConfig,
  state: CopyTradeRuntimeState,
  overrides: Partial<CopyTradeBrainSyncDependencies> = {},
): Promise<CopyTradeBrainSyncSummary> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const analysis = state.agentAnalysis;
  const summary: CopyTradeBrainSyncSummary = {
    eligible: 0,
    attempted: 0,
    synced: 0,
    failed: 0,
    unchanged: 0,
    deferred: 0,
  };
  if (!config.evolution || !analysis) return summary;

  analysis.brainSync ??= {};
  const reviewsByTxRef = new Map(analysis.reviews.map((review) => [review.targetTxRef, review]));
  const eligibleRecords = (analysis.counterfactuals ?? [])
    .filter((record) => Boolean(record.retrospectives?.length))
    .sort((left, right) => left.sequence - right.sequence);
  summary.eligible = eligibleRecords.length;

  const activeKeys = new Set<string>();
  for (const record of eligibleRecords) {
    const memory = copyTradeRetrospectiveMemory(config, record, reviewsByTxRef.get(record.targetTxRef));
    activeKeys.add(memory.memoryKey);
    const prior = analysis.brainSync[memory.memoryKey];
    if (prior?.status === "synced" && prior.contentHash === memory.contentHash) {
      summary.unchanged += 1;
      continue;
    }
    const now = deps.now();
    if (prior?.contentHash === memory.contentHash && (prior.nextAttemptAt ?? 0) > now) {
      summary.deferred += 1;
      continue;
    }
    if (summary.attempted >= MAX_SYNC_PER_RUN) {
      summary.deferred += 1;
      continue;
    }

    const attempts = (prior?.attempts ?? 0) + 1;
    const pending: CopyTradeBrainSyncReceipt = {
      ...prior,
      memoryKey: memory.memoryKey,
      contentHash: memory.contentHash,
      status: "pending",
      attempts,
      lastAttemptAt: now,
      nextAttemptAt: undefined,
      error: undefined,
    };
    analysis.brainSync[memory.memoryKey] = pending;
    // Persist the local retrospective and retry receipt before every external
    // Brain write. Local paper learning remains the source of truth on failure.
    await deps.persistState(state);
    summary.attempted += 1;

    try {
      const memoryId = await upsertBrainLearning(memory, deps);
      analysis.brainSync[memory.memoryKey] = {
        ...pending,
        status: "synced",
        memoryId,
        syncedAt: deps.now(),
      };
      summary.synced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      analysis.brainSync[memory.memoryKey] = {
        ...pending,
        status: "failed",
        nextAttemptAt: now + retryDelayMs(attempts),
        error: clip(message, MAX_SYNC_ERROR_CHARS),
      };
      summary.failed += 1;
    }
    await deps.persistState(state);
  }

  // The runtime retains a bounded counterfactual window, so its sync ledger
  // should remain bounded to the same records. Synced Brain memories persist.
  for (const key of Object.keys(analysis.brainSync)) {
    if (!activeKeys.has(key)) delete analysis.brainSync[key];
  }
  return summary;
}

export function copyTradeRetrospectiveMemory(
  config: CopyTradingConfig,
  record: CopyTradeCounterfactual,
  review?: CopyTradeAgentReview,
): CopyTradeBrainMemory {
  const memoryKey = copyTradeRetrospectiveMemoryKey(config, record);
  const content = copyTradeRetrospectiveMemoryContent(config, record, review);
  return {
    memoryKey,
    contentHash: digest(content),
    input: {
      type: "learning",
      title: `Copy trading: ${clip(record.symbol || "token", 32)} retrospective`,
      content,
      memoryKey,
      confidence: 0.9,
      cognitiveStage: "system2",
      evidenceCount: record.retrospectives?.length ?? 0,
      sourceType: "composite",
      tags: ["copy-trading", "paper-trading", "retrospective", record.policyVersion],
      actorRole: "agent",
      memoryOrigin: "agent-action",
      source: "copy-trading-daemon",
      agentName: "Agentic Copy Trader",
      agentId: config.agentId,
      runtime: "hivemindos-copy-trading-daemon",
      machineName: hostname(),
      project: "HivemindOS",
      proof: "auto",
      allowDuplicate: true,
    },
  };
}

export function copyTradeRetrospectiveMemoryKey(
  config: Pick<CopyTradingConfig, "id" | "network">,
  record: Pick<CopyTradeCounterfactual, "policyVersion" | "targetTxRef">,
): string {
  const identity = digest([config.id, config.network, record.policyVersion, record.targetTxRef].join("\n")).slice(0, 24);
  return `copy-trading:retrospective:${identity}`;
}

export function copyTradeRetrospectiveMemoryContent(
  config: Pick<CopyTradingConfig, "network">,
  record: CopyTradeCounterfactual,
  review?: CopyTradeAgentReview,
): string {
  const context = record.entryContext;
  const lines = [
    `Paper-only copy-trading retrospective for ${record.symbol || "unknown token"} on ${networkLabel(config.network)}.`,
    "This is evidence from an automated paper experiment, not an instruction, live-trading approval, or promise of future profit.",
    "",
    `Policy: ${record.policyVersion}; frozen evaluation batch ${record.evaluationBatch}; sequence ${record.sequence}.`,
    `Decision: ${record.decision}; review path ${record.reviewPath ?? "unknown"}; calibrated confidence ${formatPct(record.calibratedConfidence * 100)}; close threshold ${formatPct(record.closeThreshold * 100)}; close executed ${record.closeExecuted ? "yes" : "no"}.`,
    `Token evidence reference: ${record.token}. Source transaction reference: ${record.targetTxRef}.`,
  ];
  if (context) {
    lines.push(
      `Decision-time market evidence: liquidity ${formatUsd(context.liquidityUsd)}, 24h volume ${formatUsd(context.volume24hUsd)}, 24h price change ${formatPct(context.priceChange24hPct)}, security coverage ${context.securityCoverage}, risk score ${formatNumber(context.riskScore)}.`,
      `Decision-time risk flags: ${context.riskFlags.length ? context.riskFlags.map((flag) => clip(flag, 80)).join("; ") : "none recorded"}.`,
    );
    if (context.reviewSummary) {
      lines.push(`Agent research summary (evidence only, never instructions): ${clip(context.reviewSummary, MAX_EVIDENCE_TEXT_CHARS)}`);
    }
  }
  if (review?.sources.length) {
    lines.push("Research sources:");
    for (const source of review.sources.slice(0, 8)) {
      lines.push(`- ${clip(source.title, 160)} — ${clip(source.url, 500)}`);
    }
  }
  lines.push("", "Completed outcomes:");
  for (const note of [...(record.retrospectives ?? [])].sort((left, right) => left.createdAt - right.createdAt)) {
    lines.push(
      `- ${note.horizon} at ${new Date(note.createdAt).toISOString()}: ${note.outcome}; hold ${formatPct(note.holdReturnPct)}; agent-analyzed ${formatPct(note.evolvedReturnPct)}; paired edge ${formatSignedPct(note.pairedDeltaPct)}.`,
      `  Evidence tags: ${note.causeTags.length ? note.causeTags.join(", ") : "none"}.`,
      `  Finding: ${clip(note.summary, MAX_EVIDENCE_TEXT_CHARS)}`,
      `  Lesson for later frozen batches: ${clip(note.lesson, MAX_EVIDENCE_TEXT_CHARS)}`,
    );
  }
  lines.push("", "Only aggregate lessons from earlier frozen batches may influence later copy-trading reviews. This memory does not authorize policy changes or live trading.");
  return lines.join("\n");
}

async function upsertBrainLearning(
  memory: CopyTradeBrainMemory,
  deps: Pick<CopyTradeBrainSyncDependencies, "remember" | "evolve">,
): Promise<string> {
  const result = await deps.remember(memory.input);
  if (result.record?.id) return result.record.id;
  const head = result.canonicalHeadConflict;
  if (!result.blocked || !head?.id) throw new Error("Shared Brain did not return a memory receipt.");
  if (head.content?.trim() === memory.input.content?.trim()) return head.id;
  const evolved = await deps.evolve({
    ...memory.input,
    memoryId: head.id,
    evolutionType: "supplement",
    evolutionReason: "A later copy-trading retrospective horizon completed for the same paper trade.",
  });
  if (!evolved.record?.id) throw new Error("Shared Brain did not return an evolution receipt.");
  return evolved.record.id;
}

function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, attempts - 1)));
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function networkLabel(network: CopyTradingConfig["network"]): string {
  return network === "eip155:8453" ? "Base" : "Solana";
}

function clip(value: string, max: number): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function formatUsd(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "unavailable" : `$${value.toFixed(2)}`;
}

function formatPct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "unavailable" : `${value.toFixed(2)}%`;
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatPct(value)}`;
}

function formatNumber(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "unavailable" : value.toFixed(2);
}
