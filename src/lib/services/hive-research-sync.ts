// Hive Research -> shared brain sync (web -> app direction of the brain
// bridge). The user pairs once with a one-time code from
// hivemindos.app/research; this service exchanges it for a long-lived
// READ-ONLY "hrsync_" token on the research gateway, then pull-syncs learned
// frameworks and completed analyses into typed Agent Memory. Imports are
// idempotent through explicit memoryKeys ("hive-research:<kind>:<id>") plus a
// local imported-version ledger, so re-pulls and cursor resets never
// duplicate. The gateway token can only export — it grants no write, billing,
// or analysis-run capability, and disconnect self-revokes it remotely.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { homedir } from "@/lib/home-dir";
import { optionalEnv } from "@/lib/config/env";
import {
  evolveAgentMemory,
  rememberAgentMemory,
} from "@/lib/services/obsidian/agent-memory";

const STATE_PATH = join(homedir(), ".hivemindos", "hive-research-sync.json");
const DEFAULT_BASE_URL = "https://hivemindos-research-gateway.hivemindos.workers.dev";
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";
const MAX_PAGES_PER_RUN = 20;
const MAX_REPORT_CHARS = 6000;
const MEMORY_SOURCE = "hive-research-gateway";
const MEMORY_PROJECT = "hive-research";

export type HiveResearchSyncState = {
  syncToken: string;
  walletAddress: string | null;
  connectedAt: string;
  cursors: { frameworks: string; analyses: string; theses: string };
  // Idempotency ledgers: framework id -> highest imported version; analysis
  // ids already written; thesis version ids already applied. memoryKeys give
  // a second, vault-side guarantee.
  importedFrameworkVersions: Record<string, number>;
  importedAnalysisIds: string[];
  importedThesisIds: string[];
  lastSyncAt?: string;
  lastError?: string;
};

export type HiveResearchSyncStatus = {
  connected: boolean;
  walletAddress?: string | null;
  connectedAt?: string;
  lastSyncAt?: string;
  lastError?: string;
  importedFrameworks?: number;
  importedAnalyses?: number;
};

type SyncFramework = {
  id: string;
  name: string;
  version: number;
  source: string;
  body: {
    stance: string;
    dimensionWeights?: Partial<Record<
      "product_delivery" | "launch_contract_integrity" | "market_distribution" | "utility_value_capture" | "adoption_governance",
      number
    >>;
    focus: string[];
    redFlags: { rule: string; severity: string }[];
    greenFlags: string[];
    reRatingTriggers: { watch: string; condition: string; action: string }[];
    verdictBias: string;
    notes: string[];
  };
  createdAt: string;
};

type SyncAnalysis = {
  id: string;
  chain: string;
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  verdict: string | null;
  score: number | null;
  reportMd: string | null;
  frameworkId: string;
  frameworkVersion: number;
  finishedAt: string | null;
};

// One VERSION of the user's evolving thesis about a token (research-gateway
// thesis_memories rows; see that worker's src/thesis-memory.ts). Versions
// arrive oldest-first on the theses cursor; each one evolves the SAME
// canonical local memory instead of minting a sibling.
type SyncThesis = {
  id: string;
  memoryKey: string | null; // server canonical key; local derivation is the fallback
  analysisId: string;
  chain: string;
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  verdict: string | null;
  score: number | null;
  depthTier: string;
  contentMd: string;
  evolutionReason: string | null;
  createdAt: string;
};

type SyncExportPage = {
  ok: boolean;
  error?: string;
  account?: { walletAddress: string | null };
  frameworks?: SyncFramework[];
  analyses?: SyncAnalysis[];
  thesisMemories?: SyncThesis[];
  nextCursor?: { frameworks: string; analyses: string; theses?: string };
  hasMore?: boolean;
};

export function researchGatewayBaseUrl(): string {
  return (optionalEnv("HIVEMINDOS_RESEARCH_GATEWAY_BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

// --- state file ----------------------------------------------------------------

async function readState(): Promise<HiveResearchSyncState | null> {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, "utf8")) as HiveResearchSyncState;
    if (!parsed || typeof parsed.syncToken !== "string" || !parsed.syncToken.startsWith("hrsync_")) return null;
    return {
      ...parsed,
      cursors: {
        frameworks: parsed.cursors?.frameworks || EPOCH_ISO,
        analyses: parsed.cursors?.analyses || EPOCH_ISO,
        // Pre-thesis state files default to the epoch; the ledger + vault
        // canonical keys keep the catch-up pull idempotent.
        theses: parsed.cursors?.theses || EPOCH_ISO,
      },
      importedFrameworkVersions: parsed.importedFrameworkVersions ?? {},
      importedAnalysisIds: Array.isArray(parsed.importedAnalysisIds) ? parsed.importedAnalysisIds : [],
      importedThesisIds: Array.isArray(parsed.importedThesisIds) ? parsed.importedThesisIds : [],
    };
  } catch {
    return null;
  }
}

async function writeState(state: HiveResearchSyncState): Promise<void> {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, STATE_PATH);
}

async function clearState(): Promise<void> {
  // Delete outright — a kept copy would retain a possibly-still-valid token
  // on disk if the remote revoke failed.
  await rm(STATE_PATH, { force: true }).catch(() => undefined);
  await rm(`${STATE_PATH}.tmp`, { force: true }).catch(() => undefined);
}

// --- gateway calls ----------------------------------------------------------------

async function gatewayFetch(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  return fetch(`${researchGatewayBaseUrl()}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
}

export async function connectHiveResearchSync(code: string): Promise<HiveResearchSyncStatus> {
  const trimmed = String(code ?? "").trim();
  if (!trimmed.startsWith("hrsc_")) {
    throw new Error("Paste the sync code from hivemindos.app/research (it starts with hrsc_).");
  }
  // Re-pairing: self-revoke the previous token first so it can't be orphaned
  // alive on the gateway (best-effort — a fresh pair proceeds regardless).
  const previous = await readState();
  if (previous) {
    await gatewayFetch("/v1/sync/revoke", { method: "POST", token: previous.syncToken, body: "{}" })
      .catch(() => undefined);
  }
  const response = await gatewayFetch("/v1/sync/exchange", {
    method: "POST",
    body: JSON.stringify({ code: trimmed, label: hostname() }),
  });
  const payload = await response.json().catch(() => null) as
    | { ok?: boolean; error?: string; syncToken?: string; sync?: { walletAddress?: string | null } }
    | null;
  if (!response.ok || !payload?.ok || !payload.syncToken) {
    throw new Error(payload?.error || "The research gateway rejected the sync code.");
  }
  const state: HiveResearchSyncState = {
    syncToken: payload.syncToken,
    walletAddress: payload.sync?.walletAddress ?? null,
    connectedAt: new Date().toISOString(),
    cursors: { frameworks: EPOCH_ISO, analyses: EPOCH_ISO, theses: EPOCH_ISO },
    importedFrameworkVersions: {},
    importedAnalysisIds: [],
    importedThesisIds: [],
  };
  await writeState(state);
  return runHiveResearchSync();
}

export async function disconnectHiveResearchSync(): Promise<HiveResearchSyncStatus> {
  const state = await readState();
  if (state) {
    // Best-effort remote self-revoke; local disconnect proceeds regardless.
    await gatewayFetch("/v1/sync/revoke", { method: "POST", token: state.syncToken, body: "{}" })
      .catch(() => undefined);
  }
  await clearState();
  return { connected: false };
}

export async function hiveResearchSyncStatus(): Promise<HiveResearchSyncStatus> {
  const state = await readState();
  if (!state) return { connected: false };
  return statusFromState(state);
}

function statusFromState(state: HiveResearchSyncState): HiveResearchSyncStatus {
  return {
    connected: true,
    walletAddress: state.walletAddress,
    connectedAt: state.connectedAt,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError,
    importedFrameworks: Object.keys(state.importedFrameworkVersions).length,
    importedAnalyses: state.importedAnalysisIds.length,
  };
}

// --- import mapping ----------------------------------------------------------------

export function frameworkMemoryKey(frameworkId: string): string {
  return `hive-research:framework:${frameworkId}`;
}

export function analysisMemoryKey(analysisId: string): string {
  return `hive-research:analysis:${analysisId}`;
}

// One canonical memory per token thesis — deliberately NOT per analysis id,
// so every new run of the same token EVOLVES the same memory. The engine's
// canonicalMemoryKey normalization splits on both ":" and "/", so this local
// form and the gateway's `hive-research/thesis/<chain>/<token>` key resolve
// to the identical canonical identity.
export function thesisSyncMemoryKey(thesis: Pick<SyncThesis, "memoryKey" | "chain" | "tokenAddress">): string {
  return thesis.memoryKey || `hive-research:thesis:${thesis.chain}:${thesis.tokenAddress}`;
}

export function frameworkMemoryContent(framework: SyncFramework): string {
  const body = framework.body;
  const lines = [
    `Hive Research lens "${framework.name}" (version ${framework.version}, ${framework.source}), learned on hivemindos.app/research.`,
    `Stance: ${body.stance}`,
    `Verdict bias: ${body.verdictBias}`,
  ];
  if (body.dimensionWeights) {
    const labels = {
      product_delivery: "product/delivery",
      launch_contract_integrity: "launch/contract",
      market_distribution: "market/distribution",
      utility_value_capture: "utility/value capture",
      adoption_governance: "adoption/governance",
    } as const;
    const weights = Object.entries(labels).flatMap(([id, label]) => {
      const value = body.dimensionWeights?.[id as keyof typeof labels];
      return typeof value === "number" && Number.isFinite(value) ? [`${label} ${value}%`] : [];
    });
    if (weights.length) lines.push(`Dimension weights: ${weights.join("; ")}`);
  }
  if (body.focus.length) lines.push(`Weighs heavily: ${body.focus.join("; ")}`);
  if (body.redFlags.length) {
    lines.push(`Red flags: ${body.redFlags.map((flag) => `[${flag.severity}] ${flag.rule}`).join("; ")}`);
  }
  if (body.greenFlags.length) lines.push(`Green flags: ${body.greenFlags.join("; ")}`);
  if (body.reRatingTriggers.length) {
    lines.push(`Re-rating triggers: ${body.reRatingTriggers.map((t) => `watch ${t.watch}, when ${t.condition} -> ${t.action}`).join("; ")}`);
  }
  if (body.notes.length) lines.push(`Learned notes: ${body.notes.join(" | ")}`);
  lines.push(`Source: research-gateway framework ${framework.id} v${framework.version}.`);
  return lines.join("\n");
}

export function analysisMemoryContent(analysis: SyncAnalysis): string {
  const tokenLabel = analysis.tokenSymbol || analysis.tokenName || analysis.tokenAddress;
  const header = [
    `Hive Research crew verdict for ${tokenLabel} (${analysis.chain} ${analysis.tokenAddress}): ${analysis.verdict ?? "unknown"}${analysis.score !== null ? ` (score ${analysis.score}/100)` : ""}.`,
    `Analyzed ${analysis.finishedAt ?? "recently"} with framework ${analysis.frameworkId} v${analysis.frameworkVersion} on hivemindos.app/research (analysis ${analysis.id}).`,
  ].join("\n");
  const report = (analysis.reportMd ?? "").trim();
  if (!report) return header;
  const clipped = report.length > MAX_REPORT_CHARS
    ? `${report.slice(0, MAX_REPORT_CHARS)}\n\n[Report truncated for memory; full report lives in the Hive Research account.]`
    : report;
  return `${header}\n\n${clipped}`;
}

export function frameworkMemoryTitle(framework: SyncFramework): string {
  return `Hive Research lens: ${framework.name}`;
}

export function analysisMemoryTitle(analysis: SyncAnalysis): string {
  const tokenLabel = analysis.tokenSymbol || analysis.tokenName || analysis.tokenAddress.slice(0, 12);
  return `Hive Research: ${tokenLabel} — ${analysis.verdict ?? "unknown"}${analysis.score !== null ? ` (${analysis.score})` : ""}`;
}

export function thesisMemoryTitle(thesis: SyncThesis): string {
  const tokenLabel = thesis.tokenSymbol || thesis.tokenName || thesis.tokenAddress.slice(0, 12);
  return `Hive Research thesis: ${tokenLabel} — ${thesis.verdict ?? "unknown"}${thesis.score !== null ? ` (${thesis.score})` : ""}`;
}

export function thesisMemoryContent(thesis: SyncThesis): string {
  const tokenLabel = thesis.tokenSymbol || thesis.tokenName || thesis.tokenAddress;
  const header = `Hive Research evolving thesis for ${tokenLabel} (${thesis.chain} ${thesis.tokenAddress}), `
    + `updated by ${thesis.depthTier} run ${thesis.analysisId} on hivemindos.app/research.`;
  const body = (thesis.contentMd ?? "").trim();
  if (!body) return header;
  const clipped = body.length > MAX_REPORT_CHARS
    ? `${body.slice(0, MAX_REPORT_CHARS)}\n\n[Thesis truncated for memory; the full chain lives in the Hive Research account.]`
    : body;
  return `${header}\n\n${clipped}`;
}

const SHARED_MEMORY_FIELDS = {
  source: MEMORY_SOURCE,
  memoryOrigin: "imported",
  project: MEMORY_PROJECT,
  agentName: "Hive Research Sync",
  runtime: "hivemindos-app",
  proof: "auto" as const,
  allowDuplicate: true,
};

async function importFramework(framework: SyncFramework): Promise<void> {
  const input = {
    ...SHARED_MEMORY_FIELDS,
    type: "preference",
    title: frameworkMemoryTitle(framework),
    content: frameworkMemoryContent(framework),
    memoryKey: frameworkMemoryKey(framework.id),
    tags: ["hive-research", "research-framework"],
  };
  const result = await rememberAgentMemory(input);
  if ("blocked" in result && result.blocked && result.canonicalHeadConflict) {
    // A fresh ledger (reconnect, second machine) re-sees versions the vault
    // already holds — evolving with identical content would mint a spurious
    // version, so evolve only when the lens actually changed.
    const head = result.canonicalHeadConflict as { id: string; content?: string };
    if (typeof head.content === "string" && head.content.trim() === input.content.trim()) return;
    await evolveAgentMemory({
      ...input,
      memoryId: head.id,
      evolutionReason: `Hive Research lens updated to version ${framework.version} (${framework.source}).`,
    });
  }
}

// The Time Machine import: the first version of a token thesis plants the
// memory; every later version EVOLVES it through the real Agent Memory
// evolution engine (supersedes/evolution chain), carrying the gateway's
// code-computed delta as the evolution reason. Identical content (fresh
// ledger re-seeing an already-imported version) is a no-op, mirroring the
// framework import above.
async function importThesis(thesis: SyncThesis): Promise<void> {
  const input = {
    ...SHARED_MEMORY_FIELDS,
    type: "learning",
    title: thesisMemoryTitle(thesis),
    content: thesisMemoryContent(thesis),
    memoryKey: thesisSyncMemoryKey(thesis),
    tags: ["hive-research", "research-thesis", thesis.chain],
  };
  const result = await rememberAgentMemory(input);
  if ("blocked" in result && result.blocked && result.canonicalHeadConflict) {
    const head = result.canonicalHeadConflict as { id: string; content?: string };
    if (typeof head.content === "string" && head.content.trim() === input.content.trim()) return;
    await evolveAgentMemory({
      ...input,
      memoryId: head.id,
      evolutionReason: thesis.evolutionReason
        || `Hive Research re-ran ${thesis.tokenSymbol || thesis.tokenAddress} (analysis ${thesis.analysisId}).`,
    });
  }
}

async function importAnalysis(analysis: SyncAnalysis): Promise<void> {
  const result = await rememberAgentMemory({
    ...SHARED_MEMORY_FIELDS,
    type: "artifact",
    title: analysisMemoryTitle(analysis),
    content: analysisMemoryContent(analysis),
    memoryKey: analysisMemoryKey(analysis.id),
    tags: ["hive-research", "research-verdict", analysis.chain],
  });
  if ("blocked" in result && result.blocked) {
    // Same analysis already in the vault (canonical key) — that IS success.
    return;
  }
}

// --- sync run ----------------------------------------------------------------

export async function runHiveResearchSync(): Promise<HiveResearchSyncStatus> {
  const state = await readState();
  if (!state) return { connected: false };

  try {
    for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
      const query = new URLSearchParams({
        frameworksSince: state.cursors.frameworks,
        analysesSince: state.cursors.analyses,
        thesesSince: state.cursors.theses,
      });
      const response = await gatewayFetch(`/v1/sync/export?${query}`, { token: state.syncToken });
      const payload = await response.json().catch(() => null) as SyncExportPage | null;
      if (response.status === 401) {
        throw new Error("The sync token was revoked. Reconnect with a fresh code from hivemindos.app/research.");
      }
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Research gateway sync failed (${response.status}).`);
      }

      // Scope widening: a wallet linked AFTER pairing makes the whole
      // account's older data visible, but our cursors already passed it.
      // Restart from the epoch once; the ledgers keep re-imports no-ops.
      const wallet = payload.account?.walletAddress ?? null;
      if (wallet && wallet !== state.walletAddress
        && (state.cursors.frameworks !== EPOCH_ISO || state.cursors.analyses !== EPOCH_ISO
          || state.cursors.theses !== EPOCH_ISO)) {
        state.walletAddress = wallet;
        state.cursors = { frameworks: EPOCH_ISO, analyses: EPOCH_ISO, theses: EPOCH_ISO };
        await writeState(state);
        continue;
      }
      state.walletAddress = wallet ?? state.walletAddress;

      for (const framework of payload.frameworks ?? []) {
        const imported = state.importedFrameworkVersions[framework.id] ?? 0;
        if (framework.version <= imported) continue;
        await importFramework(framework);
        state.importedFrameworkVersions[framework.id] = framework.version;
      }
      for (const analysis of payload.analyses ?? []) {
        if (state.importedAnalysisIds.includes(analysis.id)) continue;
        await importAnalysis(analysis);
        state.importedAnalysisIds.push(analysis.id);
      }
      // Thesis versions must apply oldest-first so the local memory evolves
      // through the same chain the gateway recorded (the export is ordered;
      // this sort is a cheap belt-and-braces).
      const theses = [...(payload.thesisMemories ?? [])]
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      for (const thesis of theses) {
        if (state.importedThesisIds.includes(thesis.id)) continue;
        await importThesis(thesis);
        state.importedThesisIds.push(thesis.id);
      }
      // The ledgers are a fast path, not the source of truth — the vault-side
      // canonical memoryKey guard makes a re-import of a trimmed id a no-op.
      if (state.importedAnalysisIds.length > 5000) {
        state.importedAnalysisIds = state.importedAnalysisIds.slice(-4000);
      }
      if (state.importedThesisIds.length > 5000) {
        state.importedThesisIds = state.importedThesisIds.slice(-4000);
      }
      // Merge, don't replace: a gateway that predates the theses collection
      // omits that cursor field, and it must not be knocked back to undefined.
      if (payload.nextCursor) state.cursors = { ...state.cursors, ...payload.nextCursor };
      // Persist progress after every page so a crash never re-imports — but
      // never resurrect a connection that was disconnected mid-run.
      if (!(await readState())) return { connected: false };
      state.lastSyncAt = new Date().toISOString();
      state.lastError = undefined;
      await writeState(state);
      if (!payload.hasMore) break;
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    await writeState(state).catch(() => undefined);
  }
  return statusFromState(state);
}
