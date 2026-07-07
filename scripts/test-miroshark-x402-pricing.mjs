#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  HIVEMINDOS_MIROSHARK_X402_PROXY_BASE_URL,
  MIROSHARK_X402_HIVEMINDOS_CUT_USD,
  MIROSHARK_X402_SIMULATION_PRICE_LABEL,
  MIROSHARK_X402_SIMULATION_PRICE_USD,
  MIROSHARK_X402_UPSTREAM_BASE_URL,
} from "../src/lib/config/miroshark-x402.ts";

const ROOT = new URL("../", import.meta.url);
const paths = [
  "src/lib/services/miroshark/x402-buyer.ts",
  "src/lib/services/miroshark/x402-chat-run.ts",
  "src/app/api/chat/agent-runtime/wallet-x402-rails.ts",
  "src/features/dashboard/views/SwarmPanel.tsx",
  "src/components/simulation/Composer.tsx",
  "src/components/simulation/SimulationView.tsx",
  "src/components/simulation/sim-context.tsx",
  "src/lib/services/context-index.ts",
  "docs/for-users/features/miroshark-and-openclaw.md",
];
const files = Object.fromEntries(await Promise.all(
  paths.map(async (path) => [path, await readFile(new URL(path, ROOT), "utf8")]),
));

assert.equal(MIROSHARK_X402_SIMULATION_PRICE_USD, 1.2);
assert.equal(MIROSHARK_X402_HIVEMINDOS_CUT_USD, 0.2);
assert.equal(MIROSHARK_X402_SIMULATION_PRICE_LABEL, "$1.20 USDC");
assert.equal(MIROSHARK_X402_UPSTREAM_BASE_URL, "https://x402.miroshark.xyz");
assert.equal(HIVEMINDOS_MIROSHARK_X402_PROXY_BASE_URL, "https://hivemindos-paid-agent-gateway.hivemindos.workers.dev/api/miroshark/x402");

assert.match(files["src/lib/services/miroshark/x402-buyer.ts"], /MIROSHARK_X402_SIMULATION_PRICE_USD/);
assert.match(files["src/lib/services/miroshark/x402-buyer.ts"], /MIROSHARK_X402_RUN_BASE_URL/);
assert.match(files["src/lib/services/miroshark/x402-buyer.ts"], /url: `\$\{MIROSHARK_X402_RUN_BASE_URL\}\/run`/);
assert.match(files["src/lib/services/miroshark/x402-chat-run.ts"], /MIROSHARK_X402_SIMULATION_PRICE_LABEL/);
assert.match(files["src/app/api/chat/agent-runtime/wallet-x402-rails.ts"], /MIROSHARK_X402_SIMULATION_PRICE_USD/);
assert.match(files["src/features/dashboard/views/SwarmPanel.tsx"], /MIROSHARK_X402_SIMULATION_PRICE_LABEL/);
assert.match(files["src/components/simulation/Composer.tsx"], /Paid · \$1\.20/);
assert.match(files["src/components/simulation/SimulationView.tsx"], /MIROSHARK_X402_SIMULATION_PRICE_LABEL/);
assert.match(files["src/components/simulation/sim-context.tsx"], /MIROSHARK_X402_SIMULATION_PRICE_LABEL/);
assert.match(files["src/lib/services/context-index.ts"], /expected \$1\.20 payment/);
assert.match(files["src/lib/services/context-index.ts"], /HivemindOS-hosted MiroShark proxy/);
assert.match(files["docs/for-users/features/miroshark-and-openclaw.md"], /\*\*\$1\.20 USDC\*\*/);
assert.match(files["docs/for-users/features/miroshark-and-openclaw.md"], /\*\*\$0\.20\*\* HivemindOS cut/);
assert.match(files["docs/for-users/features/miroshark-and-openclaw.md"], /HivemindOS-hosted proxy/);

const stalePricingPattern = /~\$1(?:\s|\.00\s)?USDC|\$1 payment|\$1 charge|expected \$1 USDC|Paid · \$1(?!\.20)/;
for (const [path, text] of Object.entries(files)) {
  assert.doesNotMatch(text, stalePricingPattern, `${path} still contains stale $1 MiroShark pricing copy`);
}

console.log("MiroShark x402 pricing checks passed.");
