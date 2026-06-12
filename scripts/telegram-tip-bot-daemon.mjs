// Standalone Telegram tip bot daemon for headless hosts (e.g. the Hetzner
// VPS) — runs the bot without the Next server, collector-style.
//
// Bundle (from the repo root, node_modules present):
//   npx esbuild scripts/telegram-tip-bot-daemon.mjs --bundle --platform=node \
//     --format=esm --packages=external \
//     --alias:@=./src --alias:server-only=./scripts/shims/empty.mjs \
//     --outfile=dist/telegram-tip-bot.mjs
//
// Run: node dist/telegram-tip-bot.mjs
// Config comes from ~/.hivemindos/.env (token, admin ids, limits) via the
// shared hive env loader inside the runner.
import net from "node:net";

import { getTelegramTipBotStatus, startTelegramTipBot, stopTelegramTipBot } from "../src/lib/services/telegram-tip-bot/runner";

// Same high-latency-network guard as src/instrumentation.ts.
net.setDefaultAutoSelectFamilyAttemptTimeout?.(2_500);

const status = await startTelegramTipBot();
console.log(
  `[tip-bot] running as @${status.botUsername} | provider ${status.withdrawalProvider} | treasury ${status.treasuryAddress}`,
);

// Surface runner errors into journald; also guarantees an active timer keeps
// the process alive between long-poll cycles.
let lastReportedError = "";
setInterval(() => {
  const current = getTelegramTipBotStatus();
  if (current.lastError && current.lastError !== lastReportedError) {
    lastReportedError = current.lastError;
    console.error(`[tip-bot] error: ${current.lastError}`);
  }
}, 60_000);

async function shutdown(signal) {
  console.log(`[tip-bot] ${signal} received, stopping...`);
  await stopTelegramTipBot();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
