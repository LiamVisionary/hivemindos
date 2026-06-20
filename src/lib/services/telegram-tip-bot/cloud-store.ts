import "server-only";

import { emptyTipBotState, type TipBotState } from "./ledger";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";

export type TipBotCloudStoreConfig = {
  enabled: boolean;
  apiUrl: string;
  token: string;
};

type CloudStateResponse = {
  state?: TipBotState;
};

const BACKEND_ENV_NAMES = [
  "TELEGRAM_TIP_BOT_STATE_BACKEND",
  "HIVEMINDOS_TELEGRAM_TIP_BOT_STATE_BACKEND",
  "HIVEMINDOS_TIP_BOT_STATE_BACKEND",
] as const;

const API_URL_ENV_NAMES = [
  "TELEGRAM_TIP_BOT_CLOUDFLARE_API_URL",
  "HIVEMINDOS_TELEGRAM_TIP_BOT_CLOUDFLARE_API_URL",
  "HIVEMINDOS_TIP_BOT_CLOUDFLARE_API_URL",
] as const;

const TOKEN_ENV_NAMES = [
  "TELEGRAM_TIP_BOT_CLOUDFLARE_API_TOKEN",
  "HIVEMINDOS_TELEGRAM_TIP_BOT_CLOUDFLARE_API_TOKEN",
  "HIVEMINDOS_TIP_BOT_CLOUDFLARE_API_TOKEN",
] as const;

async function firstEnvValue(names: readonly string[]): Promise<string> {
  for (const name of names) {
    const value = await hiveEnvValue(name).catch(() => "");
    if (value) return value;
  }
  return "";
}

export async function tipBotCloudStoreConfig(): Promise<TipBotCloudStoreConfig> {
  const backend = (await firstEnvValue(BACKEND_ENV_NAMES)).trim().toLowerCase();
  const apiUrl = (await firstEnvValue(API_URL_ENV_NAMES)).trim().replace(/\/+$/, "");
  const token = await firstEnvValue(TOKEN_ENV_NAMES);
  const enabled = ["cloudflare", "cloud", "remote"].includes(backend) || Boolean(apiUrl || token);
  if (!enabled) return { enabled: false, apiUrl: "", token: "" };
  if (!apiUrl) throw new Error("Telegram tip bot Cloudflare state backend is enabled but TELEGRAM_TIP_BOT_CLOUDFLARE_API_URL is missing.");
  if (!token) throw new Error("Telegram tip bot Cloudflare state backend is enabled but TELEGRAM_TIP_BOT_CLOUDFLARE_API_TOKEN is missing.");
  return { enabled: true, apiUrl, token };
}

export async function readTipBotCloudState(config: TipBotCloudStoreConfig): Promise<TipBotState | null> {
  const response = await fetch(`${config.apiUrl}/state`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Cloudflare tip bot state read failed: HTTP ${response.status}`);
  const payload = (await response.json()) as CloudStateResponse;
  if (!payload.state) return emptyTipBotState();
  return normalizeCloudState(payload.state);
}

export async function writeTipBotCloudState(config: TipBotCloudStoreConfig, state: TipBotState): Promise<void> {
  const response = await fetch(`${config.apiUrl}/state`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Cloudflare tip bot state write failed: HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
  }
}

function normalizeCloudState(state: TipBotState): TipBotState {
  if (state?.version !== 1) return emptyTipBotState();
  state.bounties ??= {};
  state.memberTags ??= { chatIds: [], lastSynced: {} };
  state.memberTags.chatIds ??= [];
  state.memberTags.lastSynced ??= {};
  return state;
}
