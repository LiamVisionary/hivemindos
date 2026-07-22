import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import {
  appendHoneyRecognitionAudit,
  completeHoneyRecognitionAudit,
  emptyHoneyAuditState,
  type HoneyRecognitionAuditEntry,
  type TipBotHoneyAuditState,
} from "./honey-audit-state";
import { homedir } from "@/lib/home-dir";

const STORE_DIR = path.join(homedir(), ".hivemindos");
const STORE_PATH = path.join(STORE_DIR, "telegram-tip-bot-honey-audit.json");

export const TELEGRAM_TIP_BOT_HONEY_AUDIT_STORE_PATH = STORE_PATH;

function normalizeState(state: TipBotHoneyAuditState): TipBotHoneyAuditState {
  if (state?.version !== 1) return emptyHoneyAuditState();
  state.entries ??= [];
  return state;
}

async function loadState(): Promise<TipBotHoneyAuditState> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return normalizeState(JSON.parse(raw) as TipBotHoneyAuditState);
  } catch {
    return emptyHoneyAuditState();
  }
}

async function persistState(state: TipBotHoneyAuditState) {
  await fs.mkdir(STORE_DIR, { recursive: true, mode: 0o700 });
  const tempPath = `${STORE_PATH}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tempPath, STORE_PATH);
}

const globalState = globalThis as typeof globalThis & {
  __hivemindTipBotHoneyAuditQueue?: Promise<TipBotHoneyAuditState>;
};

function queue(): Promise<TipBotHoneyAuditState> {
  if (!globalState.__hivemindTipBotHoneyAuditQueue) globalState.__hivemindTipBotHoneyAuditQueue = loadState();
  return globalState.__hivemindTipBotHoneyAuditQueue;
}

export async function readTipBotHoneyAuditState(): Promise<TipBotHoneyAuditState> {
  const state = await queue().catch(loadState);
  return structuredClone(state);
}

async function mutateTipBotHoneyAuditState<T>(
  mutate: (state: TipBotHoneyAuditState) => T | Promise<T>,
): Promise<T> {
  let result!: T;
  let thrown: unknown;
  globalState.__hivemindTipBotHoneyAuditQueue = queue()
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
  await globalState.__hivemindTipBotHoneyAuditQueue;
  if (thrown) throw thrown;
  return result;
}

export function startHoneyRecognitionAudit(entry: HoneyRecognitionAuditEntry) {
  const write = () => mutateTipBotHoneyAuditState((state) => appendHoneyRecognitionAudit(state, entry));
  return write().catch(write);
}

export function finishHoneyRecognitionAudit(
  id: string,
  patch: Parameters<typeof completeHoneyRecognitionAudit>[2],
) {
  const write = () => mutateTipBotHoneyAuditState((state) => completeHoneyRecognitionAudit(state, id, patch));
  return write().catch(write);
}
