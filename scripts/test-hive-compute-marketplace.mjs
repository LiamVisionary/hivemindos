#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const requiredFiles = [
  "src/lib/config/hive-compute-marketplace.ts",
  "src/lib/services/hive-compute-marketplace.ts",
  "src/lib/types/hive-compute-marketplace.ts",
  "src/app/api/hive-compute/marketplace/route.ts",
  "src/app/api/hive-compute/chat/completions/route.ts",
  "src/features/dashboard/views/HiveComputePanel.tsx",
  "src/features/dashboard/views/HiveComputePanel.module.css",
  "docs/for-users/features/hive-compute.md",
];

for (const file of requiredFiles) {
  assert(existsSync(join(root, file)), `Missing required Hive Compute file: ${file}`);
}

const read = (file) => readFileSync(join(root, file), "utf8");
const service = read("src/lib/services/hive-compute-marketplace.ts");
const config = read("src/lib/config/hive-compute-marketplace.ts");
const gatewayCatalog = read("src/lib/config/model-provider-gateways.ts");
const runtimeIntegrations = read("src/lib/services/runtime-integrations.ts");
const streamHttp = read("src/app/api/chat/agent-runtime/stream-http-runtime.ts");
const streamOpenAi = read("src/app/api/chat/agent-runtime/stream-openai-compatible.ts");
const dashboardNav = read("src/features/dashboard/dashboard-navigation.ts");
const morePanel = read("src/features/dashboard/MorePanel.tsx");
const agentSettingsModal = read("src/features/dashboard/views/chat/AgentSettingsModal.tsx");
const modelPillSelector = read("src/features/dashboard/views/chat/ModelPillSelector.tsx");
const guidedHivemindosSetup = read("src/features/dashboard/views/chat/GuidedHivemindosModelsSetup.tsx");
const walletPaidConfig = read("src/lib/config/hivemindos-wallet-paid-models.ts");
const hivemindosModelsRoute = read("src/app/api/hivemindos/models/models/route.ts");
const hivemindosChatRoute = read("src/app/api/hivemindos/models/chat/completions/route.ts");
const docs = read("docs/for-users/features/hive-compute.md");
const workersReadme = read("workers/README.md");
const contextIndex = read("src/lib/services/context-index.ts");

assert(config.includes('HIVE_COMPUTE_PROVIDER_SLUG = "hive-compute"'), "Provider slug constant must be hive-compute.");
assert(!gatewayCatalog.includes("[HIVE_COMPUTE_PROVIDER_SLUG]"), "Hive Compute should not appear as a separate model-provider picker.");
assert(runtimeIntegrations.includes("readHiveComputeMarketplaceStatus"), "Runtime integration status must expose Hive Compute readiness.");
assert(runtimeIntegrations.includes("capacityLabel"), "Runtime integration status must expose Hive Compute capacity labels.");
assert(runtimeIntegrations.includes("provider.slug !== HIVE_COMPUTE_PROVIDER_SLUG"), "Runtime integrations must filter stale Hive Compute picker rows.");
assert(streamHttp.includes("isHiveComputeProfile(profile)"), "HTTP runtime must route Hive Compute profiles through the OpenAI-compatible path.");
assert(streamOpenAi.includes("resolveHiveComputeRuntimeConfig"), "OpenAI-compatible stream must resolve Hive Compute to the local proxy.");
assert(streamOpenAi.includes('paidHeader === "hive-compute"'), "Chat billing must recognize Hive Compute routed HivemindOS model responses.");
assert(dashboardNav.includes('compute: { label: "Hive Compute"'), "Dashboard route catalog must include Hive Compute.");
assert(morePanel.includes('id: "compute"'), "More launcher must include a Hive Compute tile.");
assert(!agentSettingsModal.includes('selectedProviderSlug === "hive-compute"'), "Agent settings must not special-case a standalone Hive Compute picker.");
assert(!agentSettingsModal.includes("hiveComputeSelected"), "Agent settings must not keep the standalone Hive Compute picker state.");
assert(!modelPillSelector.includes("statusLabel") && !modelPillSelector.includes("modelStatus"), "Model pill selector must not render stale Hive Compute-only capacity status.");
assert(walletPaidConfig.includes('"hivemindos/auto": "hive-compute/auto"'), "HivemindOS Auto must prefer the Hive Compute auto route.");
assert(walletPaidConfig.includes('"hivemindos/fast": "hive-compute/fast"'), "HivemindOS Fast must prefer the Hive Compute fast route.");
assert(walletPaidConfig.includes('"hivemindos/deep": "hive-compute/deep"'), "HivemindOS Deep must prefer the Hive Compute deep route.");
assert(walletPaidConfig.includes('badge: "SALE"'), "GPU-first HivemindOS routes must carry SALE badges.");
assert(walletPaidConfig.includes("preferredHiveComputeModelForHivemindosModel"), "Wallet-paid model config must expose the compute-first route mapping.");
assert(hivemindosModelsRoute.includes("computeFirstRows") && hivemindosModelsRoute.includes("fallbackRoute"), "HivemindOS model list must return GPU-first routes before hosted fallbacks.");
assert(hivemindosModelsRoute.includes("readHiveComputeMarketplaceStatus") && hivemindosModelsRoute.includes("hiveComputeHostedModelId(id)"), "HivemindOS model list must include live Hive Compute marketplace models as direct route rows.");
assert(hivemindosChatRoute.includes("proxyHiveComputeChatCompletion"), "HivemindOS model chat route must try Hive Compute before OpenRouter fallback.");
assert(hivemindosChatRoute.includes("fetchPreferredHiveComputeCompletion") && hivemindosChatRoute.includes("X-HivemindOS-Model-Route"), "HivemindOS model chat route must expose Hive Compute response billing/routing headers.");
assert(guidedHivemindosSetup.includes("staticCatalogModels") && guidedHivemindosSetup.includes("matchingAllModels"), "Guided setup must blend SALE routes into the unified All models catalog.");
assert(guidedHivemindosSetup.includes("...matchingRouteModels, ...matchingComputeMarketplaceModels, ...matchingFallbackStaticModels, ...matchingGatewayModels"), "Guided setup must place live Hive Compute models immediately after the GPU-first routes.");
assert(guidedHivemindosSetup.includes("allModelCount") && guidedHivemindosSetup.includes("sale: computeFirst || computeHosted"), "Guided setup must mark GPU-first and live Hive Compute model chips as SALE routes inside All models.");
assert(!guidedHivemindosSetup.includes("GPU-first routes") && !guidedHivemindosSetup.includes("Hosted routes"), "Guided setup must not split GPU-first or hosted models into separate sections.");
assert(docs.includes("not the authority for official") && docs.includes("marketplace value"), "User docs must explain that official marketplace authority is not local.");
assert(docs.includes("prepaid client balance") && docs.includes("centralized fallback"), "User docs must mention hosted balance and fallback marketplace capabilities.");
assert(docs.includes("provider bonds") && docs.includes("canary accounting"), "User docs must mention hosted trust and canary marketplace capabilities.");
assert(workersReadme.includes("Hive Compute marketplace routing"), "Hosted-service boundary docs must mention Hive Compute.");
assert(contextIndex.includes("tool-schema:hive-compute-marketplace"), "Context index must advertise Hive Compute capability discovery.");
assert(service.includes("prompt contents for jobs they accept"), "Worker setup must warn that workers can see accepted prompt contents.");
assert(service.includes("prepaid balances") && service.includes("key relays") && service.includes("reputation"), "Public status boundary must name hosted commercial authority surfaces.");
assert(service.includes('import WebSocket from "ws"'), "Generated worker must use the native WebSocket client.");
assert(service.includes("/hive-compute/worker/ws"), "Generated worker must default to the hosted marketplace WebSocket path.");
assert(service.includes('"worker.register"') && service.includes('"job.assign"'), "Generated worker must use the hosted marketplace message protocol.");
assert(service.includes("HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL"), "Generated worker must support LM Studio/OpenAI-compatible local servers.");
assert(service.includes("runOpenAICompatibleJob"), "Generated worker must route jobs to the OpenAI-compatible adapter when configured.");
assert(service.includes("capacityFromHealth"), "Hive Compute status must parse live marketplace capacity.");
assert(service.includes("Live worker model"), "Hive Compute model options must include live worker model metadata.");
assert(!service.includes("socket.io-client"), "Generated worker must not depend on Socket.IO.");

for (const forbidden of [
  "TREASURY_PRIVATE_KEY",
  "HIVEMINDOS_HIVE_COMPUTE_PAY_TO",
  "HIVEMINDOS_HIVE_COMPUTE_PAYOUT_PRIVATE_KEY",
  "HONEY_LEDGER_SECRET",
  "PLATFORM_FEE_RECIPIENT",
]) {
  assert(!service.includes(forbidden), `Public Hive Compute service must not contain official authority secret or recipient key: ${forbidden}`);
}

console.log("Hive Compute marketplace guard passed.");

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}
