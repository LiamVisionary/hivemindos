#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");

const config = read("src/lib/config/plume-options.ts");
assert.match(config, /48782a23278ff07c065b1420a827d1a4661853e8/, "registry must pin the reviewed upstream commit");
assert.match(config, /mainnetStatus: "rollout-pending"/, "mainnet must remain explicitly gated");
assert.match(config, /0xD1E3aFaeCaA514A33eeCF6F8781432c655873226/, "TSLA call must match the pinned registry");
assert.match(config, /0x44aFc68ef17799683F044EFDd0021a9E78d200be/, "AMD put must match the pinned registry");
assert.match(config, /0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E/, "TSLA underlying must match the pinned registry");
assert.match(config, /0x2a70add445b877583b3354e9014387d966d95e57/, "oracle feed must match the pinned registry");

const service = read("src/lib/services/trading/plume-options.ts");
assert.match(service, /getBytecode/, "status must verify deployed bytecode");
assert.match(service, /totalLocked/, "status must read collateral telemetry");
assert.match(service, /getContractEvents/, "market discovery must derive series from contract events");
assert.match(service, /simulateContract/, "every mutation must be simulated before signing");
assert.match(service, /writeContract/, "testnet lifecycle actions must sign the reviewed contract call");
assert.match(service, /waitForTransactionReceipt/, "execution must wait for a mined receipt");
assert.match(service, /findSettlementRound/, "settlement must resolve the earliest valid oracle round");

const route = read("src/app/api/trading/plume/route.ts");
assert.match(route, /requireAuth\(request\)/, "status API must require dashboard auth");
assert.match(route, /export async function GET/, "status API must expose market and portfolio reads");
assert.match(route, /export async function POST/, "status API must expose governed prepare and execute modes");
assert.match(route, /getWalletSecret\(agentId\)/, "the server must resolve the authoritative signer from the encrypted vault");
assert.match(route, /jurisdictionAttestation/, "execution must require the Plume jurisdiction attestation");
assert.match(route, /approvalThresholdSatisfied/, "direct user confirmation must bind the governance review");
assert.match(route, /reviewFingerprint/, "execution must bind signing to the exact prepared review");
assert.match(route, /normalizeAction/, "the route must accept both the nested dashboard payload and flat agent-tool payload");

const view = read("src/components/trade/TradeView.tsx");
assert.match(
  view,
  /"crypto" \| "stocks" \| "liquidity" \| "options" \| "prediction"/,
  "Trade desk must preserve Options alongside the merged liquidity and prediction segments",
);
assert.match(view, /<PlumeOptionsPanel \/>/, "Options segment must render the Plume panel");

const panel = read("src/components/trade/PlumeOptionsPanel.tsx");
assert.match(panel, /Browse offers/, "panel must expose the public offer board");
assert.match(panel, /Write options/, "panel must expose covered-call and cash-secured-put writing");
assert.match(panel, /My positions/, "panel must expose holder and writer lifecycle actions");
assert.match(panel, /jurisdiction/i, "panel must disclose upstream jurisdiction restrictions");
assert.match(panel, /method:\s*"POST"/, "panel must prepare and execute through the governed API");
for (const action of ["write", "buy", "cancel", "buy-to-close", "exercise", "settle", "settle-worthless", "redeem", "reclaim"]) {
  assert.match(panel, new RegExp(`"${action}"`), `panel must expose the ${action} lifecycle action`);
}
assert.match(panel, /Review pinned registry/, "panel must expose provenance");

const actionCatalog = read("src/lib/services/hive-actions/catalog.ts");
const actions = read("src/lib/services/hive-actions/plume-options-action.ts");
assert.match(actionCatalog, /plumeOptionsAction/, "the shared agent catalog must register Plume options");
assert.match(actions, /id: "wallet\.plume-options"/, "agent capability discovery must include Plume options");
assert.match(actions, /toolName: "plume_options"/, "the Plume options capability must be exposed to MCP runtimes");
assert.match(actions, /CONFIRM_OPTION_WRITE/, "agent execution must advertise the exact confirmation gate");
assert.match(actions, /\/api\/trading\/plume/, "agent execution must route through the governed API");

const css = read("src/components/trade/PlumeOptionsPanel.module.css");
assert.match(css, /\.card/, "options surface must have scoped route styling");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.offerGrid/, "options surface must include a responsive layout");

const activity = read("src/components/trade/adapt-trade.ts");
assert.match(activity, /plume-options/, "mined option receipts must appear in the stock activity feed");

console.log("Plume options integration contract passed.");
