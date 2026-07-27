import { readFile } from "node:fs/promises";

import {
  HONEY_LEGACY_HIVE_PER_HONEY,
  HONEY_LEGACY_TIP_SEED_VERSION,
  legacyHoneyMicroFromHiveRaw,
} from "../src/lib/services/telegram-tip-bot/honey-recognition.ts";
import { tipLeaderboard } from "../src/lib/services/telegram-tip-bot/ledger.ts";

const apply = process.argv.includes("--apply");
const stateFileIndex = process.argv.indexOf("--state-file");
const stateFile = stateFileIndex >= 0 ? process.argv[stateFileIndex + 1] : "";

const state = stateFile ? await readStateFile(stateFile) : await readRemoteState();
const entries = buildSeedEntries(state);
const seedHoneyMicro = entries.reduce(
  (total, entry) => total + legacyHoneyMicroFromHiveRaw(entry.hiveReceivedRaw, state.settings.tokenDecimals),
  0n,
);
const summary = {
  mode: apply ? "apply" : "dry-run",
  seedVersion: HONEY_LEGACY_TIP_SEED_VERSION,
  ratio: `1 HONEY per ${HONEY_LEGACY_HIVE_PER_HONEY.toLocaleString()} historical HIVE received`,
  participants: entries.length,
  recipients: entries.filter((entry) => BigInt(entry.hiveReceivedRaw) > 0n).length,
  seededHoney: Number(seedHoneyMicro) / 1_000_000,
  sourceUpdatedAt: state.updatedAt,
};

if (!apply) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write("Dry run only. Re-run with --apply after the compute-gateway migration is deployed and backed up.\n");
  process.exit(0);
}

const communityApiUrl = cleanUrl(
  process.env.TELEGRAM_TIP_BOT_HONEY_COMMUNITY_API_URL
    || process.env.HONEY_COMMUNITY_API_URL
    || "https://hivemindos-compute-gateway.hivemindos.workers.dev",
);
const migrationToken = process.env.HONEY_COMMUNITY_MIGRATION_TOKEN || "";
if (!communityApiUrl || !migrationToken) {
  throw new Error("Apply mode requires HONEY_COMMUNITY_MIGRATION_TOKEN.");
}
const response = await fetch(`${communityApiUrl}/community/legacy-tip-seed`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${migrationToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ seedVersion: HONEY_LEGACY_TIP_SEED_VERSION, entries }),
});
const result = await response.json().catch(() => null);
if (!response.ok || !result?.ok) {
  throw new Error(result?.error || `Historical HONEY seed failed (${response.status}).`);
}
process.stdout.write(`${JSON.stringify({ ...summary, result }, null, 2)}\n`);

async function readStateFile(path) {
  if (!path) throw new Error("--state-file requires a path.");
  const parsed = JSON.parse(await readFile(path, "utf8"));
  return validateState(parsed.state || parsed);
}

async function readRemoteState() {
  const apiUrl = cleanUrl(process.env.TELEGRAM_TIP_BOT_CLOUDFLARE_API_URL);
  const apiToken = process.env.TELEGRAM_TIP_BOT_CLOUDFLARE_API_TOKEN || "";
  if (!apiUrl || !apiToken) {
    throw new Error("Remote state requires TELEGRAM_TIP_BOT_CLOUDFLARE_API_URL and TELEGRAM_TIP_BOT_CLOUDFLARE_API_TOKEN.");
  }
  const response = await fetch(`${apiUrl}/state`, { headers: { Authorization: `Bearer ${apiToken}` } });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.state) throw new Error(result?.error || `Tip-bot state request failed (${response.status}).`);
  return validateState(result.state);
}

function validateState(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.ledger) || !value.users || !value.settings) {
    throw new Error("Tip-bot state is missing the required version, users, settings, or ledger.");
  }
  return value;
}

function buildSeedEntries(value) {
  const leaderboard = tipLeaderboard(value);
  const received = new Map(leaderboard.receivers.map((row) => [row.userId, row.totalRaw]));
  const given = new Map(leaderboard.tippers.map((row) => [row.userId, row.totalRaw]));
  return [...new Set([...received.keys(), ...given.keys()])]
    .map((userId) => ({
      telegramUserId: userId,
      publicLabel: publicLabel(value.users[userId], userId),
      hiveReceivedRaw: received.get(userId) || "0",
      hiveGivenRaw: given.get(userId) || "0",
    }))
    .filter((entry) => BigInt(entry.hiveReceivedRaw) > 0n || BigInt(entry.hiveGivenRaw) > 0n);
}

function publicLabel(user, userId) {
  if (user?.username) return `@${String(user.username).replace(/^@/, "").slice(0, 63)}`;
  const firstName = String(user?.firstName || "").replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return (firstName || `member-${userId}`).slice(0, 64);
}

function cleanUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" || ["127.0.0.1", "localhost"].includes(url.hostname)
      ? url.toString().replace(/\/+$/, "")
      : "";
  } catch {
    return "";
  }
}
