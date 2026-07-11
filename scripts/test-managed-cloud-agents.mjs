import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contract = await readFile("src/lib/services/managed-cloud-agents-contract.ts", "utf8");
const service = await readFile("src/lib/services/managed-cloud-agents.ts", "utf8");
const vault = await readFile("src/lib/services/managed-cloud-agent-token-vault.ts", "utf8");
const route = await readFile("src/app/api/managed-cloud-agents/route.ts", "utf8");
const panel = await readFile("src/features/dashboard/views/ManagedCloudAgentsPanel.tsx", "utf8");
const panelStyles = await readFile("src/features/dashboard/views/ManagedCloudAgentsPanel.module.css", "utf8");
const navigation = await readFile("src/features/dashboard/dashboard-navigation.ts", "utf8");
const contextItems = await readFile("src/lib/services/context-index/static-tool-items.ts", "utf8");

assert.match(contract, /https:\/\/hivemindos-managed-agents\.hivemindos\.workers\.dev/);
assert.match(contract, /eip155:8453/);
assert.match(contract, /0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/);
assert.match(service, /resolveSpendGovernance/);
assert.match(service, /evaluateSpend/);
assert.match(service, /sendUsdStable/);
assert.match(service, /appendSpend/);
assert.doesNotMatch(service, /collectTradingPlatformFee/);
assert.match(vault, /createCipheriv/);
assert.match(vault, /mode: 0o600/);
assert.match(vault, /pendingSettlement/);
assert.match(route, /requireAuth/);
assert.match(route, /okJson/);
assert.match(route, /errorJson/);
assert.doesNotMatch(route, /payTo\s*:/);
assert.doesNotMatch(route, /baseUrl\s*:/);
assert.match(panel, /Fund \$\{formatUsd\(topUpUsd\)\} & deploy/);
assert.match(panel, /MANAGED_CLOUD_FUND_CONFIRMATION/);
assert.match(panel, /LoadingBar/);
assert.match(panel, /Spinner/);
assert.doesNotMatch(panel, /localStorage|sessionStorage|IndexedDB/);
assert.match(panel, /What works while devices sleep/);
assert.match(panel, /Connect this agent to your Tailnet/);
assert.match(panel, /Pair this machine&apos;s Shared Brain/);
assert.match(panel, /Promote a cloud-native remote MCP/);
for (const action of [
  "recover_payment",
  "list_integrations",
  "connect_tailnet",
  "pair_brain",
  "add_mcp",
  "remove_integration",
]) {
  assert.match(route, new RegExp(`action === ["']${action}["']`));
}
assert.doesNotMatch(route, /HIVEMINDOS_MANAGED_AGENT_PAY_TO|OPENROUTER_API_KEY|HCLOUD_TOKEN/);
assert.match(panelStyles, /data-theme="hive-light"/);
assert.match(navigation, /cloud: \{ label: "Cloud Agents"/);
assert.match(contextItems, /tool-schema:managed-cloud-agents/);

console.log("Managed-cloud-agent client trust-boundary checks passed.");
