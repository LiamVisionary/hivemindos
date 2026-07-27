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
const brainModules = read("src/features/dashboard/brain-modules.tsx");
const syntoService = read("src/lib/services/brain/synto.ts");
const runtimeTypes = read("src/lib/types/agent-runtime.ts");
const syntoConfig = read("src/lib/config/synto-config.ts");
const statusRoute = read("src/app/api/brain/synto/status/route.ts");

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
assert.match(tierPanel, /Syntho 0\.4 cannot enforce OpenRouter ZDR per request/);
assert.match(tierPanel, /LmStudioModelManager/);
assert.match(tierPanel, /catalogFilter=\{\(entry\) => SYNTO_LOCAL_MODEL_ID_SET\.has\(entry\.id\)\}/);
assert.match(tierPanel, /selectedRoute !== "cloud-best" && refreshRuntimeIntegrations/);
assert.match(lmStudioManager, /catalogFilter\?: \(entry: LocalModelInstallCatalogStatus\) => boolean/);
assert.match(lmStudioManager, /filter\(\(entry\) => !catalogFilter \|\| catalogFilter\(entry\)\)/);
assert.match(vaultPanel, /import \{ SyntoModelTierSettings \}/);
assert.match(vaultPanel, /setup:\s*\(\s*<SyntoModelTierSettings/);
assert.match(vaultPanel, /runRuntimeIntegrationAction=\{runRuntimeIntegrationAction\}/);
assert.doesNotMatch(vaultPanel, /ollama pull gemma4:e4b/);
assert.match(brainModules, /setup\?: ReactNode/);
assert.match(brainModules, /brainModule\.setup/);
assert.match(runtimeTypes, /DEFAULT_SYNTO_CONFIG/);
assert.match(syntoConfig, /modelRoute: SyntoModelRoute/);
assert.match(syntoConfig, /cloudModel: string/);
assert.match(syntoConfig, /localLoadedModelKey: string/);
assert.match(syntoService, /prepareSyntoModelRoute\(root, config\)/);
assert.match(syntoService, /SYNTO_CLOUD_API_KEY_ENV/);
assert.match(syntoService, /SYNTO_LOCAL_PROVIDER_NAME/);
assert.match(syntoService, /--fast-model/);
assert.match(statusRoute, /params\.has\("modelRoute"\)/);
assert.match(dashboardApp, /refreshRuntimeIntegrations, refreshSyntoStatus/);
assert.match(dashboardApp, /runRuntimeIntegrationAction, runSyntoAction/);
assert.match(dashboardApp, /runtimeIntegrationBusy, runtimeIntegrationMessage, runtimeIntegrationStatus/);

console.log("Syntho model tier settings static checks passed.");
