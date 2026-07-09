#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const catalog = read("src/lib/config/local-model-install-catalog.ts");
const collector = read("scripts/agent-telemetry-collector.mjs");
const tierConfig = read("src/lib/config/synto-model-tiers.ts");
const tierPanel = read("src/features/dashboard/views/SyntoModelTierSettings.tsx");
const lmStudioManager = read("src/features/dashboard/views/chat/LmStudioModelManager.tsx");
const vaultPanel = read("src/features/dashboard/views/VaultPanel.tsx");
const dashboardApp = read("src/features/dashboard/DashboardApp.tsx");

const syntoLocalModelIds = [
  "synto-qwen3-5-9b-q4-k-m",
  "synto-qwen3-30b-a3b-q4-k-m",
  "synto-qwen3-6-27b-q4-k-m",
  "synto-qwen3-6-35b-a3b-q4-k-m",
];

for (const modelId of syntoLocalModelIds) {
  assert.match(catalog, new RegExp(`id: "${modelId}"`), `catalog should include ${modelId}`);
  assert.match(collector, new RegExp(`id: "${modelId}"`), `collector catalog should include ${modelId}`);
  assert.match(tierConfig, new RegExp(`"${modelId}"`), `tier config should reference ${modelId}`);
}

assert.match(tierConfig, /SYNTO_CLOUD_MODEL_ID = "qwen\/qwen3-235b-a22b-2507"/);
assert.match(tierConfig, /SYNTO_CLOUD_ENDPOINT_PROVIDERS = \[/);
assert.match(tierConfig, /DeepInfra/);
assert.match(tierConfig, /GMICloud/);
assert.match(tierPanel, /OpenRouter prompt\/response logging is off by default/);
assert.match(tierPanel, /Do not label this route E2E\/no-collection unless the selected endpoint is ZDR-confirmed/);
assert.match(tierPanel, /LmStudioModelManager/);
assert.match(tierPanel, /catalogFilter=\{\(entry\) => SYNTO_LOCAL_MODEL_ID_SET\.has\(entry\.id\)\}/);
assert.match(lmStudioManager, /catalogFilter\?: \(entry: LocalModelInstallCatalogStatus\) => boolean/);
assert.match(lmStudioManager, /filter\(\(entry\) => !catalogFilter \|\| catalogFilter\(entry\)\)/);
assert.match(vaultPanel, /import \{ SyntoModelTierSettings \}/);
assert.match(vaultPanel, /<SyntoModelTierSettings/);
assert.match(vaultPanel, /runRuntimeIntegrationAction=\{runRuntimeIntegrationAction\}/);
assert.match(dashboardApp, /refreshRuntimeIntegrations, refreshSyntoStatus/);
assert.match(dashboardApp, /runRuntimeIntegrationAction, runSyntoAction/);
assert.match(dashboardApp, /runtimeIntegrationBusy, runtimeIntegrationMessage, runtimeIntegrationStatus/);

console.log("Syntho model tier settings static checks passed.");
