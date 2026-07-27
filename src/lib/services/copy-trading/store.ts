import "server-only";

/* Dedicated on-disk store for copy-trading, split into TWO files so the Next
   API route and the standalone daemon never contend on the same file:

     ~/.hivemindos/copy-trading.json        — configs; written ONLY by the route/UI,
                                               read by the daemon each loop.
     ~/.hivemindos/copy-trading-state.json  — runtime state + engine heartbeat;
                                               written ONLY by the daemon, read by
                                               the route for status.

   Single writer per file → lock-free across processes (atomic temp+rename means
   a reader never sees a torn file). Within a process, writes serialize through a
   globalThis-anchored queue so concurrent mutations can't lose each other. */

import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "@/lib/home-dir";
import {
  COPY_TRADE_EVOLUTION_MODEL,
  COPY_TRADE_EVOLUTION_POLICY_VERSION,
  DEFAULT_COPY_POLL_MS,
  MAX_COPY_TRADE_USD,
  MIN_COPY_POLL_MS,
  isCopyTradeNetwork,
  type CopyTradeEngineStatus,
  type CopyTradeRuntimeState,
  type CopyTradingConfig,
} from "@/lib/types/copy-trading";

const CONFIG_FILE = join(homedir(), ".hivemindos", "copy-trading.json");
const STATE_FILE = join(homedir(), ".hivemindos", "copy-trading-state.json");

const MAX_EVENTS_PER_CONFIG = 50;
const MAX_CONSUMED_REFS = 400;

type ConfigFile = { version: 1; configs: CopyTradingConfig[]; updatedAt: string };
type StateFile = {
  version: 1;
  engine: CopyTradeEngineStatus | null;
  states: Record<string, CopyTradeRuntimeState>;
  updatedAt: string;
};

function emptyConfigFile(): ConfigFile {
  return { version: 1, configs: [], updatedAt: new Date(0).toISOString() };
}

function emptyStateFile(): StateFile {
  return { version: 1, engine: null, states: {}, updatedAt: new Date(0).toISOString() };
}

// ── serialized write queues (one per file), anchored on globalThis ───────────
type Queues = { config: Promise<unknown>; state: Promise<unknown> };
function queues(): Queues {
  const slot = globalThis as typeof globalThis & { __hivemindCopyTradeQueues?: Queues };
  if (!slot.__hivemindCopyTradeQueues) {
    slot.__hivemindCopyTradeQueues = { config: Promise.resolve(), state: Promise.resolve() };
  }
  return slot.__hivemindCopyTradeQueues;
}

function runQueued<T>(which: keyof Queues, fn: () => Promise<T>): Promise<T> {
  const q = queues();
  const next = q[which].catch(() => undefined).then(fn);
  q[which] = next.catch(() => undefined);
  return next;
}

async function readJsonFile<T>(file: string, fallback: () => T): Promise<T> {
  try {
    const raw = await readFile(file, "utf8");
    if (!raw.trim()) return fallback();
    return JSON.parse(raw) as T;
  } catch {
    return fallback();
  }
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
}

// ── config normalization (defensive clamps on every write) ───────────────────
function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeConfig(input: CopyTradingConfig, touchUpdatedAt = true): CopyTradingConfig {
  const now = Date.now();
  const maxCopyUsd = clamp(num(input.maxCopyUsd, MAX_COPY_TRADE_USD), 0.5, MAX_COPY_TRADE_USD);
  return {
    id: String(input.id),
    label: typeof input.label === "string" ? input.label.slice(0, 80) : "",
    agentId: String(input.agentId),
    walletAddress: String(input.walletAddress),
    network: isCopyTradeNetwork(input.network) ? input.network : "eip155:8453",
    targetAddress: String(input.targetAddress || "").trim(),
    copyMode: input.copyMode === "proportional" ? "proportional" : "fixed",
    fixedUsd: clamp(num(input.fixedUsd, 5), 0.5, MAX_COPY_TRADE_USD),
    copyPercent: clamp(num(input.copyPercent, 25), 1, 100),
    minCopyUsd: clamp(num(input.minCopyUsd, 1), 0.5, MAX_COPY_TRADE_USD),
    maxCopyUsd,
    slippageBps: clamp(Math.round(num(input.slippageBps, 100)), 10, 2_000),
    copySells: input.copySells !== false,
    takeProfitPct: input.takeProfitPct == null ? null : clamp(num(input.takeProfitPct, 0), 1, 1_000),
    stopLossPct: input.stopLossPct == null ? null : clamp(num(input.stopLossPct, 0), 1, 100),
    maxOpenPositions: clamp(Math.round(num(input.maxOpenPositions, 6)), 1, 50),
    maxPerTokenUsd: clamp(num(input.maxPerTokenUsd, MAX_COPY_TRADE_USD), 0.5, 10_000),
    cooldownMs: clamp(Math.round(num(input.cooldownMs, 1_200)), 0, 600_000),
    pollIntervalMs: clamp(Math.round(num(input.pollIntervalMs, DEFAULT_COPY_POLL_MS)), MIN_COPY_POLL_MS, 600_000),
    minLiquidityUsd: input.minLiquidityUsd == null ? null : Math.max(0, num(input.minLiquidityUsd, 0)),
    // Preserve case — Solana mints are case-sensitive; the engine compares EVM
    // entries case-insensitively.
    blacklist: Array.isArray(input.blacklist)
      ? Array.from(new Set(input.blacklist.map((t) => String(t).trim()).filter(Boolean))).slice(0, 200)
      : [],
    enabled: Boolean(input.enabled),
    dryRun: input.dryRun !== false,
    paperStartUsd: input.paperStartUsd == null ? null : Math.max(0, num(input.paperStartUsd, 0)),
    evolution: input.evolution?.sourceConfigId
      ? {
          sourceConfigId: String(input.evolution.sourceConfigId),
          model: COPY_TRADE_EVOLUTION_MODEL,
          reasoningEffort: "medium",
          minCloseConfidence: clamp(num(input.evolution.minCloseConfidence, 0.7), 0.5, 1),
          policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION,
          createdAt: num(input.evolution.createdAt, now),
        }
      : undefined,
    createdAt: num(input.createdAt, now),
    updatedAt: touchUpdatedAt ? now : num(input.updatedAt, now),
  };
}

// ── config file: read by daemon, written by route/UI ─────────────────────────
export async function readConfigs(): Promise<CopyTradingConfig[]> {
  const file = await readJsonFile<ConfigFile>(CONFIG_FILE, emptyConfigFile);
  return Array.isArray(file.configs) ? file.configs.map((config) => normalizeConfig(config, false)) : [];
}

async function writeConfigs(configs: CopyTradingConfig[]): Promise<void> {
  await atomicWrite(CONFIG_FILE, { version: 1, configs, updatedAt: new Date().toISOString() } satisfies ConfigFile);
}

export function upsertConfig(config: CopyTradingConfig): Promise<CopyTradingConfig> {
  const normalized = normalizeConfig(config);
  return runQueued("config", async () => {
    const configs = await readConfigs();
    const next = configs.filter((c) => c.id !== normalized.id);
    next.push(normalized);
    await writeConfigs(next);
    return normalized;
  });
}

export function createEvolvedConfig(sourceId: string, id: string): Promise<CopyTradingConfig> {
  return runQueued("config", async () => {
    const configs = await readConfigs();
    const source = configs.find((config) => config.id === sourceId);
    if (!source) throw new Error("No such source copy-trading config.");
    if (source.evolution) throw new Error("Create evolved configs from an original config, not another evolved config.");
    const existing = configs.find((config) => config.evolution?.sourceConfigId === sourceId);
    if (existing) return existing;
    const now = Date.now();
    const evolved = normalizeConfig({
      ...source,
      id,
      label: `${source.label?.trim() || "Copy trader"} · Agent analyzed`,
      // A paper source can start its twin immediately. A live source's clone is
      // deliberately stopped until the user explicitly starts the second rail.
      enabled: source.dryRun ? source.enabled : false,
      evolution: {
        sourceConfigId: source.id,
        model: COPY_TRADE_EVOLUTION_MODEL,
        reasoningEffort: "medium",
        minCloseConfidence: 0.7,
        policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION,
        createdAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    await writeConfigs([...configs, evolved]);
    return evolved;
  });
}

export function removeConfig(id: string): Promise<void> {
  return runQueued("config", async () => {
    const configs = await readConfigs();
    await writeConfigs(configs.filter((c) => c.id !== id));
  }).then(() => removeRuntimeState(id));
}

export function setConfigEnabled(id: string, enabled: boolean): Promise<CopyTradingConfig | null> {
  return runQueued("config", async () => {
    const configs = await readConfigs();
    const target = configs.find((c) => c.id === id);
    if (!target) return null;
    const next = configs.map((c) => (c.id === id ? { ...c, enabled, updatedAt: Date.now() } : c));
    await writeConfigs(next);
    return next.find((c) => c.id === id) ?? null;
  });
}

// ── state file: written by daemon, read by route ─────────────────────────────
export async function readStateFile(): Promise<StateFile> {
  return readJsonFile<StateFile>(STATE_FILE, emptyStateFile);
}

export async function readRuntimeStates(): Promise<Record<string, CopyTradeRuntimeState>> {
  const file = await readStateFile();
  return file.states && typeof file.states === "object" ? file.states : {};
}

export async function readEngineStatus(): Promise<CopyTradeEngineStatus | null> {
  const file = await readStateFile();
  return file.engine ?? null;
}

export function emptyRuntimeState(configId: string): CopyTradeRuntimeState {
  return {
    configId,
    consumedTxRefs: [],
    pendingSignals: [],
    openPositions: {},
    stats: { polls: 0, mirrored: 0, skipped: 0, errors: 0 },
    lastError: null,
    lastPollAt: null,
    running: false,
    events: [],
  };
}

function trimState(state: CopyTradeRuntimeState): CopyTradeRuntimeState {
  return {
    ...state,
    consumedTxRefs: state.consumedTxRefs.slice(-MAX_CONSUMED_REFS),
    pendingSignals: state.pendingSignals?.slice(-100),
    events: state.events.slice(-MAX_EVENTS_PER_CONFIG),
    agentAnalysis: state.agentAnalysis
      ? {
          ...state.agentAnalysis,
          reviews: state.agentAnalysis.reviews.slice(-400),
          counterfactuals: state.agentAnalysis.counterfactuals?.slice(-400),
        }
      : undefined,
  };
}

export function writeRuntimeState(state: CopyTradeRuntimeState): Promise<void> {
  return runQueued("state", async () => {
    const file = await readStateFile();
    file.states[state.configId] = trimState(state);
    file.updatedAt = new Date().toISOString();
    await atomicWrite(STATE_FILE, file);
  });
}

export function removeRuntimeState(id: string): Promise<void> {
  return runQueued("state", async () => {
    const file = await readStateFile();
    delete file.states[id];
    file.updatedAt = new Date().toISOString();
    await atomicWrite(STATE_FILE, file);
  });
}

export function writeEngineStatus(engine: CopyTradeEngineStatus | null): Promise<void> {
  return runQueued("state", async () => {
    const file = await readStateFile();
    file.engine = engine;
    file.updatedAt = new Date().toISOString();
    await atomicWrite(STATE_FILE, file);
  });
}
