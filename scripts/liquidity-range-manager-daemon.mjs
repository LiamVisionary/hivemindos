// Shadow-only Uniswap v3 range monitor. It reads Base position NFTs, evaluates
// the deterministic fee-versus-cost policy, and updates a virtual target range.
// It never imports a signer, creates calldata, or submits a transaction.
import net from "node:net";

import {
  getLiquidityRangeEngineStatus,
  startLiquidityRangeEngine,
  stopLiquidityRangeEngine,
} from "../src/lib/services/trading/liquidity-range-engine";
import { readSharedHiveEnvValues } from "../src/lib/services/shared-hive-env";

net.setDefaultAutoSelectFamilyAttemptTimeout?.(2_500);

try {
  const shared = await readSharedHiveEnvValues();
  for (const [key, value] of Object.entries(shared)) {
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
} catch {
  // BASE_RPC_URL is optional; the reader retains bounded public Base fallbacks.
}

const status = await startLiquidityRangeEngine({ host: "daemon" });
console.log(`[liquidity-range] shadow engine up (pid ${status.pid}) | ${status.activeConfigs} active monitor(s)`);

setInterval(() => {
  const current = getLiquidityRangeEngineStatus();
  if (current) console.log(`[liquidity-range] heartbeat | ${current.activeConfigs} active monitor(s) | no signing authority`);
}, 60_000);

async function shutdown(signal) {
  console.log(`[liquidity-range] ${signal} received, stopping…`);
  await stopLiquidityRangeEngine().catch(() => undefined);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (error) => console.error(`[liquidity-range] uncaught: ${error?.message || error}`));
process.on("unhandledRejection", (error) => console.error(`[liquidity-range] unhandled: ${error?.message || error}`));
