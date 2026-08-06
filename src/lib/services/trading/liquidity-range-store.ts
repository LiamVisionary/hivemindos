import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "@/lib/home-dir";
import {
  DEFAULT_LIQUIDITY_RANGE_POLL_MS,
  LIQUIDITY_RANGE_MODE,
  LIQUIDITY_RANGE_NETWORK,
  defaultLiquidityRangeConfig,
  type LiquidityRangeConfig,
  type LiquidityRangeEngineStatus,
  type LiquidityRangeRuntimeState,
} from "@/lib/types/liquidity-range-manager";

const CONFIG_FILE = process.env.LIQUIDITY_RANGE_CONFIG_FILE || join(homedir(), ".hivemindos", "liquidity-range-manager.json");
const STATE_FILE = process.env.LIQUIDITY_RANGE_STATE_FILE || join(homedir(), ".hivemindos", "liquidity-range-manager-state.json");
const MAX_EVENTS = 40;

type ConfigFile = { version: 1; configs: LiquidityRangeConfig[]; updatedAt: string };
type StateFile = {
  version: 1;
  engine: LiquidityRangeEngineStatus | null;
  states: Record<string, LiquidityRangeRuntimeState>;
  updatedAt: string;
};

type Queues = { config: Promise<unknown>; state: Promise<unknown> };

function queues(): Queues {
  const slot = globalThis as typeof globalThis & { __hivemindLiquidityRangeQueues?: Queues };
  if (!slot.__hivemindLiquidityRangeQueues) {
    slot.__hivemindLiquidityRangeQueues = { config: Promise.resolve(), state: Promise.resolve() };
  }
  return slot.__hivemindLiquidityRangeQueues;
}

function runQueued<T>(which: keyof Queues, task: () => Promise<T>): Promise<T> {
  const current = queues();
  const next = current[which].catch(() => undefined).then(task);
  current[which] = next.catch(() => undefined);
  return next;
}

export function normalizeLiquidityRangeConfig(input: Partial<LiquidityRangeConfig> & { id: string; tokenId: string }): LiquidityRangeConfig {
  const fallback = defaultLiquidityRangeConfig({
    id: String(input.id),
    tokenId: String(input.tokenId),
    agentId: input.agentId,
    walletAddress: input.walletAddress,
  });
  const createdAt = finiteNumber(input.createdAt, fallback.createdAt);
  return {
    ...fallback,
    id: String(input.id).slice(0, 120),
    label: String(input.label || fallback.label).trim().slice(0, 80),
    agentId: String(input.agentId || "").slice(0, 160),
    walletAddress: validEvmAddress(input.walletAddress) ? String(input.walletAddress) : "",
    network: LIQUIDITY_RANGE_NETWORK,
    protocol: "uniswap-v3",
    tokenId: String(input.tokenId).trim(),
    mode: LIQUIDITY_RANGE_MODE,
    enabled: Boolean(input.enabled),
    pollIntervalMs: clamp(Math.round(finiteNumber(input.pollIntervalMs, DEFAULT_LIQUIDITY_RANGE_POLL_MS)), 30_000, 30 * 60_000),
    targetWidthBps: clamp(Math.round(finiteNumber(input.targetWidthBps, fallback.targetWidthBps)), 100, 10_000),
    triggerBufferBps: clamp(Math.round(finiteNumber(input.triggerBufferBps, fallback.triggerBufferBps)), 10, 2_000),
    minHoursBetweenRebalances: clamp(finiteNumber(input.minHoursBetweenRebalances, fallback.minHoursBetweenRebalances), 1, 168),
    minNetBenefitUsd: clamp(finiteNumber(input.minNetBenefitUsd, fallback.minNetBenefitUsd), 0, 100_000),
    feeAprPct: clamp(finiteNumber(input.feeAprPct, fallback.feeAprPct), 0, 1_000),
    gasCostUsd: clamp(finiteNumber(input.gasCostUsd, fallback.gasCostUsd), 0, 10_000),
    estimatedIlCostUsd: clamp(finiteNumber(input.estimatedIlCostUsd, fallback.estimatedIlCostUsd), 0, 1_000_000),
    evaluationHorizonDays: clamp(Math.round(finiteNumber(input.evaluationHorizonDays, fallback.evaluationHorizonDays)), 1, 90),
    createdAt,
    updatedAt: Date.now(),
  };
}

export function emptyLiquidityRangeRuntimeState(configId: string): LiquidityRangeRuntimeState {
  return {
    configId,
    lastCheckedAt: null,
    lastRebalancedAt: null,
    lastDecision: null,
    lastSnapshot: null,
    shadowRange: null,
    paper: null,
    events: [],
    error: null,
  };
}

export async function readLiquidityRangeConfigs(): Promise<LiquidityRangeConfig[]> {
  const file = await readJson<ConfigFile>(CONFIG_FILE, { version: 1, configs: [], updatedAt: new Date(0).toISOString() });
  if (!Array.isArray(file.configs)) return [];
  return file.configs
    .filter((config) => config && typeof config.id === "string" && typeof config.tokenId === "string")
    .map((config) => ({ ...normalizeLiquidityRangeConfig(config), updatedAt: finiteNumber(config.updatedAt, Date.now()) }));
}

export function upsertLiquidityRangeConfig(input: Partial<LiquidityRangeConfig> & { id: string; tokenId: string }): Promise<LiquidityRangeConfig> {
  return runQueued("config", async () => {
    const configs = await readLiquidityRangeConfigs();
    const previous = configs.find((config) => config.id === input.id);
    const normalized = normalizeLiquidityRangeConfig({ ...previous, ...input, createdAt: previous?.createdAt ?? input.createdAt });
    await writeConfigs([...configs.filter((config) => config.id !== normalized.id), normalized]);
    return normalized;
  });
}

export function setLiquidityRangeConfigEnabled(id: string, enabled: boolean): Promise<LiquidityRangeConfig | null> {
  return runQueued("config", async () => {
    const configs = await readLiquidityRangeConfigs();
    const current = configs.find((config) => config.id === id);
    if (!current) return null;
    const next = normalizeLiquidityRangeConfig({ ...current, enabled });
    await writeConfigs([...configs.filter((config) => config.id !== id), next]);
    return next;
  });
}

export function removeLiquidityRangeConfig(id: string): Promise<boolean> {
  return runQueued("config", async () => {
    const configs = await readLiquidityRangeConfigs();
    const next = configs.filter((config) => config.id !== id);
    if (next.length === configs.length) return false;
    await writeConfigs(next);
    await updateLiquidityRangeStates((states) => {
      const copy = { ...states };
      delete copy[id];
      return copy;
    });
    return true;
  });
}

export async function readLiquidityRangeStates(): Promise<Record<string, LiquidityRangeRuntimeState>> {
  const file = await readStateFile();
  return file.states && typeof file.states === "object" ? file.states : {};
}

export async function readLiquidityRangeEngineStatus(): Promise<LiquidityRangeEngineStatus | null> {
  return (await readStateFile()).engine ?? null;
}

export function updateLiquidityRangeRuntimeState(
  configId: string,
  update: (state: LiquidityRangeRuntimeState) => LiquidityRangeRuntimeState,
): Promise<LiquidityRangeRuntimeState> {
  return runQueued("state", async () => {
    const file = await readStateFile();
    const current = file.states[configId] ?? emptyLiquidityRangeRuntimeState(configId);
    const next = update(current);
    const normalized = { ...next, configId, events: next.events.slice(-MAX_EVENTS) };
    await writeStateFile({ ...file, states: { ...file.states, [configId]: normalized } });
    return normalized;
  });
}

export function writeLiquidityRangeEngineStatus(engine: LiquidityRangeEngineStatus | null): Promise<void> {
  return runQueued("state", async () => {
    const file = await readStateFile();
    await writeStateFile({ ...file, engine });
  });
}

async function updateLiquidityRangeStates(
  update: (states: Record<string, LiquidityRangeRuntimeState>) => Record<string, LiquidityRangeRuntimeState>,
): Promise<void> {
  return runQueued("state", async () => {
    const file = await readStateFile();
    await writeStateFile({ ...file, states: update(file.states) });
  });
}

async function readStateFile(): Promise<StateFile> {
  return readJson<StateFile>(STATE_FILE, { version: 1, engine: null, states: {}, updatedAt: new Date(0).toISOString() });
}

async function writeConfigs(configs: LiquidityRangeConfig[]): Promise<void> {
  await atomicWrite(CONFIG_FILE, { version: 1, configs, updatedAt: new Date().toISOString() } satisfies ConfigFile);
}

async function writeStateFile(file: Omit<StateFile, "version" | "updatedAt"> & Partial<Pick<StateFile, "version" | "updatedAt">>): Promise<void> {
  await atomicWrite(STATE_FILE, {
    version: 1,
    engine: file.engine ?? null,
    states: file.states ?? {},
    updatedAt: new Date().toISOString(),
  } satisfies StateFile);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf8");
    return raw.trim() ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validEvmAddress(value: unknown): boolean {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}
