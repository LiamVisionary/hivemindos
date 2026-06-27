import "server-only";

import { randomBytes, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { readTipBotCloudState, tipBotCloudStoreConfig, writeTipBotCloudState } from "./cloud-store";
import { emptyTipBotState, type TipBotState } from "./ledger";
import { homedir } from "@/lib/home-dir";

const STORE_DIR = path.join(homedir(), ".hivemindos");
const STORE_PATH = path.join(STORE_DIR, "telegram-tip-bot.json");
const LOCAL_MIRROR_PATH = path.join(STORE_DIR, "telegram-tip-bot.local-mirror.json");

export const TELEGRAM_TIP_BOT_STORE_PATH = STORE_PATH;

async function loadState(): Promise<TipBotState> {
  const cloud = await tipBotCloudStoreConfig();
  if (cloud.enabled) {
    const cloudState = await readTipBotCloudState(cloud);
    if (cloudState) {
      await writeLocalMirror(cloudState).catch(() => undefined);
      return normalizeState(cloudState);
    }
  }
  return loadLocalState();
}

async function loadLocalState(): Promise<TipBotState> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as TipBotState;
    return normalizeState(parsed);
  } catch {
    return emptyTipBotState();
  }
}

function normalizeState(state: TipBotState): TipBotState {
  if (state?.version !== 1) return emptyTipBotState();
  state.bounties ??= {};
  state.memberTags ??= { chatIds: [], lastSynced: {} };
  state.memberTags.chatIds ??= [];
  state.memberTags.lastSynced ??= {};
  return state;
}

async function persistState(state: TipBotState) {
  const cloud = await tipBotCloudStoreConfig();
  if (cloud.enabled) {
    await writeTipBotCloudState(cloud, state);
    await writeLocalMirror(state).catch(() => undefined);
    return;
  }
  await writeLocalState(STORE_PATH, state);
}

async function writeLocalMirror(state: TipBotState) {
  await writeLocalState(LOCAL_MIRROR_PATH, state);
}

async function writeLocalState(filePath: string, state: TipBotState) {
  await fs.mkdir(STORE_DIR, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

// Promise-queue serialization, same shape as dashboard-state.ts. Mutations run
// against a clone so a thrown transition never leaves a half-applied state in
// memory or on disk.
const globalState = globalThis as typeof globalThis & {
  __hivemindTipBotQueue?: Promise<TipBotState>;
};

function queue(): Promise<TipBotState> {
  if (!globalState.__hivemindTipBotQueue) globalState.__hivemindTipBotQueue = loadState();
  return globalState.__hivemindTipBotQueue;
}

export async function readTipBotState(): Promise<TipBotState> {
  const state = await queue().catch(loadState);
  return structuredClone(state);
}

export async function mutateTipBotState<T>(mutate: (state: TipBotState) => T | Promise<T>): Promise<T> {
  let result!: T;
  let thrown: unknown;
  globalState.__hivemindTipBotQueue = queue()
    .catch(loadState)
    .then(async (state) => {
      const draft = structuredClone(state);
      try {
        result = await mutate(draft);
      } catch (error) {
        thrown = error;
        return state;
      }
      draft.updatedAt = new Date().toISOString();
      await persistState(draft);
      return draft;
    });
  await globalState.__hivemindTipBotQueue;
  if (thrown) throw thrown;
  return result;
}

export function newLedgerEntryId(): string {
  return randomUUID();
}

// Short, chat-friendly id for withdrawals (admins type it into /approve).
export function newWithdrawalId(): string {
  return `w${randomBytes(4).toString("hex")}`;
}

export function newBountyId(): string {
  return `b${randomBytes(4).toString("hex")}`;
}

export function newBountyBoostId(): string {
  return `bb${randomBytes(4).toString("hex")}`;
}

export function newBountySubmissionId(): string {
  return `s${randomBytes(4).toString("hex")}`;
}

// Deep-link payloads allow [A-Za-z0-9_-]{1,64}; base64url fits exactly.
export function newClaimToken(): string {
  return randomBytes(16).toString("base64url");
}
