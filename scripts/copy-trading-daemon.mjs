// Standalone copy-trading daemon — runs the copy-trading engine WITHOUT the Next
// server, so configs keep mirroring even with the desktop app fully closed
// (collector-style, like scripts/telegram-tip-bot-daemon.mjs). It is the SOLE
// execution host: the Next API route only reads/writes config, so there is never
// a second process mirroring the same target trade.
//
// Bundle (from the repo root, node_modules present):
//   npx esbuild scripts/copy-trading-daemon.mjs --bundle --platform=node \
//     --format=esm --packages=external \
//     --alias:@=./src --alias:server-only=./scripts/shims/empty.mjs \
//     --outfile=dist/copy-trading.mjs
//
// Run: node dist/copy-trading.mjs   (or `pnpm copy-trading:daemon`)
//
// Config lives in ~/.hivemindos/copy-trading.json (written by the UI/route).
// Credentials (ZEROX_API_KEY, optional BASE_RPC_URL / SOLANA_RPC_URL) come from
// ~/.hivemindos/.env via the shared hive env loader.
import net from "node:net";

import { getEngineStatus, startEngine, stopEngine } from "../src/lib/services/copy-trading/engine";
import { readSharedHiveEnvValues } from "../src/lib/services/shared-hive-env";

// Same high-latency-network guard as src/instrumentation.ts (0x/Base RPC handshakes).
net.setDefaultAutoSelectFamilyAttemptTimeout?.(2_500);

// Hydrate process.env from the shared hive env so direct process.env reads
// (BASE_RPC_URL / SOLANA_RPC_URL in the watcher + dex-swap) resolve headlessly.
// Existing process.env always wins.
try {
  const shared = await readSharedHiveEnvValues();
  for (const [key, value] of Object.entries(shared)) {
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
} catch {
  // no shared env file — public RPC fallbacks still work
}

const status = await startEngine({ host: "daemon" });
console.log(`[copy-trading] engine up on ${status.host} (pid ${status.pid}) | ${status.activeConfigs} active config(s)`);

// Heartbeat log so journald/console shows liveness and surfaces config drift.
setInterval(() => {
  const current = getEngineStatus();
  if (current) console.log(`[copy-trading] heartbeat | ${current.activeConfigs} active config(s)`);
}, 60_000);

async function shutdown(signal) {
  console.log(`[copy-trading] ${signal} received, stopping…`);
  await stopEngine().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (error) => console.error(`[copy-trading] uncaught: ${error?.message || error}`));
process.on("unhandledRejection", (error) => console.error(`[copy-trading] unhandled: ${error?.message || error}`));
