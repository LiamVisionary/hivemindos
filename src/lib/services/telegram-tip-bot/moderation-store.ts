import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { emptyModerationState, ensureModerationChat, type TipBotModerationState } from "./moderation-state";
import { homedir } from "@/lib/home-dir";

const STORE_DIR = path.join(homedir(), ".hivemindos");
const STORE_PATH = path.join(STORE_DIR, "telegram-tip-bot-moderation.json");

export const TELEGRAM_TIP_BOT_MODERATION_STORE_PATH = STORE_PATH;

function normalizeState(state: TipBotModerationState): TipBotModerationState {
  if (state?.version !== 1) return emptyModerationState();
  state.chats ??= {};
  state.audit ??= [];
  for (const chatId of Object.keys(state.chats)) ensureModerationChat(state, chatId);
  return state;
}

async function loadState(): Promise<TipBotModerationState> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return normalizeState(JSON.parse(raw) as TipBotModerationState);
  } catch {
    return emptyModerationState();
  }
}

async function persistState(state: TipBotModerationState) {
  await fs.mkdir(STORE_DIR, { recursive: true, mode: 0o700 });
  const tempPath = `${STORE_PATH}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tempPath, STORE_PATH);
}

const globalState = globalThis as typeof globalThis & {
  __hivemindTipBotModerationQueue?: Promise<TipBotModerationState>;
};

function queue(): Promise<TipBotModerationState> {
  if (!globalState.__hivemindTipBotModerationQueue) globalState.__hivemindTipBotModerationQueue = loadState();
  return globalState.__hivemindTipBotModerationQueue;
}

export async function readTipBotModerationState(): Promise<TipBotModerationState> {
  const state = await queue().catch(loadState);
  return structuredClone(state);
}

export async function mutateTipBotModerationState<T>(
  mutate: (state: TipBotModerationState) => T | Promise<T>,
): Promise<T> {
  let result!: T;
  let thrown: unknown;
  globalState.__hivemindTipBotModerationQueue = queue()
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
  await globalState.__hivemindTipBotModerationQueue;
  if (thrown) throw thrown;
  return result;
}
