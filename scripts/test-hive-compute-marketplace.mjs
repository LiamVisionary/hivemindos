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
  "src/components/fleet/hive-compute-host-modal.tsx",
  "src/components/fleet/hive-compute-host-modal.module.css",
  "src/features/dashboard/views/HiveComputePanel.tsx",
  "src/features/dashboard/views/HiveComputePanel.module.css",
  "src/lib/config/compute-rentals.ts",
  "src/lib/services/context-index/static-tool-items.ts",
  "src/lib/services/hive-compute-marketplace/worker-module.ts",
  "docs/for-users/features/hive-compute.md",
];

for (const file of requiredFiles) {
  assert(existsSync(join(root, file)), `Missing required Hive Compute file: ${file}`);
}

const read = (file) => readFileSync(join(root, file), "utf8");
const service = read("src/lib/services/hive-compute-marketplace.ts");
const workerModule = read("src/lib/services/hive-compute-marketplace/worker-module.ts");
const config = read("src/lib/config/hive-compute-marketplace.ts");
const gatewayCatalog = read("src/lib/config/model-provider-gateways.ts");
const runtimeIntegrations = read("src/lib/services/runtime-integrations.ts");
const streamHttp = read("src/app/api/chat/agent-runtime/stream-http-runtime.ts");
const streamOpenAi = read("src/app/api/chat/agent-runtime/stream-openai-compatible.ts");
const marketplaceRoute = read("src/app/api/hive-compute/marketplace/route.ts");
const computeRentalsConfig = read("src/lib/config/compute-rentals.ts");
const fleetView = read("src/components/fleet/FleetView.tsx");
const fleetHiveView = read("src/components/fleet-hive/FleetHiveView.tsx");
const hiveHostModal = read("src/components/fleet/hive-compute-host-modal.tsx");
const dashboardComputePanel = read("src/features/dashboard/views/HiveComputePanel.tsx");
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
const staticToolItems = read("src/lib/services/context-index/static-tool-items.ts");

assert(config.includes('HIVE_COMPUTE_PROVIDER_SLUG = "hive-compute"'), "Provider slug constant must be hive-compute.");
assert(config.includes("HIVE_COMPUTE_MODEL_ID_RE.test(trimmed) ? trimmed : HIVE_COMPUTE_DEFAULT_MODEL"), "Direct Hive Compute model ids must not silently normalize back to Auto.");
assert(!gatewayCatalog.includes("[HIVE_COMPUTE_PROVIDER_SLUG]"), "Hive Compute should not appear as a separate model-provider picker.");
assert(runtimeIntegrations.includes("readHiveComputeMarketplaceStatus"), "Runtime integration status must expose Hive Compute readiness.");
assert(runtimeIntegrations.includes("capacityLabel"), "Runtime integration status must expose Hive Compute capacity labels.");
assert(runtimeIntegrations.includes("provider.slug !== HIVE_COMPUTE_PROVIDER_SLUG"), "Runtime integrations must filter stale Hive Compute picker rows.");
assert(streamHttp.includes("isHiveComputeProfile(profile)"), "HTTP runtime must route Hive Compute profiles through the OpenAI-compatible path.");
assert(streamOpenAi.includes("resolveHiveComputeRuntimeConfig"), "OpenAI-compatible stream must resolve Hive Compute to the local proxy.");
assert(streamOpenAi.includes('paidHeader === "hive-compute"'), "Chat billing must recognize Hive Compute routed HivemindOS model responses.");
assert(marketplaceRoute.includes('"run-worker"') && marketplaceRoute.includes("startHiveComputeWorker"), "Hive Compute marketplace route must expose in-app worker go-live.");
assert(marketplaceRoute.includes('"stop-worker"') && marketplaceRoute.includes("stopHiveComputeWorker"), "Hive Compute marketplace route must expose in-app worker stop.");
assert(marketplaceRoute.includes('"open-mpp-session"') && marketplaceRoute.includes("openHiveComputeMppSession"), "Hive Compute marketplace route must expose in-app MPP session opening.");
assert(marketplaceRoute.includes('"setup-hosting"') && marketplaceRoute.includes("setupHiveComputeHosting"), "Hive Compute marketplace route must expose one-click hosting setup.");
assert(computeRentalsConfig.includes("NEXT_PUBLIC_HIVEMINDOS_USEPOD_COMPUTE_RENTALS_ENABLED") && computeRentalsConfig.includes("=== \"1\""), "UsePod compute rentals must stay behind an explicit public flag.");
assert(fleetView.includes("USEPOD_COMPUTE_RENTALS_ENABLED") && fleetView.includes("HiveComputeHostModal"), "Legacy Fleet compute rental entry must default to Hive Compute with UsePod flag fallback.");
assert(fleetHiveView.includes("USEPOD_COMPUTE_RENTALS_ENABLED") && fleetHiveView.includes("HiveComputeHostModal"), "Hive Fleet compute rental entry must default to Hive Compute with UsePod flag fallback.");
assert(hiveHostModal.includes("Set up hosting") && hiveHostModal.includes("Advanced diagnostics") && hiveHostModal.includes("Open MPP session") && hiveHostModal.includes("Privacy:"), "Hive Compute host modal must keep one-click setup primary while surfacing MPP and TEE privacy gates.");
assert(dashboardComputePanel.includes("Set up hosting") && dashboardComputePanel.includes("Advanced diagnostics") && dashboardComputePanel.includes("Open MPP session") && dashboardComputePanel.includes("Privacy:"), "Hive Compute dashboard must keep one-click setup primary while surfacing MPP and TEE privacy gates.");
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
assert(docs.includes("TEE") && docs.includes("MPP") && docs.includes("Open MPP session") && docs.includes("encrypted job payloads"), "User docs must explain TEE privacy and MPP payment boundaries.");
assert(workersReadme.includes("Hive Compute marketplace routing"), "Hosted-service boundary docs must mention Hive Compute.");
assert(contextIndex.includes("hiveComputeContextIndexItem"), "Context index must include the Hive Compute static capability item.");
assert(staticToolItems.includes("tool-schema:hive-compute-marketplace") && staticToolItems.includes("MPP") && staticToolItems.includes("TEE"), "Static context item must advertise Hive Compute, MPP, and TEE capability discovery.");
assert(service.includes("prompt contents for jobs they accept"), "Worker setup must warn that workers can see accepted prompt contents.");
assert(service.includes("prepaid balances") && service.includes("key relays") && service.includes("reputation"), "Public status boundary must name hosted commercial authority surfaces.");
assert(service.includes("startHiveComputeWorker") && service.includes("HIVE_COMPUTE_MODEL_MAP_JSON"), "Hive Compute service must start the managed worker with a local model map.");
assert(service.includes("setupHiveComputeHosting") && service.includes("installHiveComputeWorkerDependencies") && service.includes("openHiveComputeMppSession"), "Hive Compute service must provide one-click setup that installs dependencies and opens MPP sessions when available.");
assert(service.includes("HIVE_COMPUTE_MPP_POLICY_URL_ENV") && service.includes("HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV"), "Hive Compute service must expose MPP and TEE attestation capability gates.");
assert(service.includes("openHiveComputeMppSession") && service.includes("HIVE_COMPUTE_MPP_SESSION_FILE"), "Hive Compute service must open and store local MPP session authorizations.");
assert(workerModule.includes('import WebSocket from "ws"'), "Generated worker must use the native WebSocket client.");
assert(workerModule.includes("/hive-compute/worker/ws"), "Generated worker must default to the hosted marketplace WebSocket path.");
assert(workerModule.includes('"worker.register"') && workerModule.includes('"job.assign"'), "Generated worker must use the hosted marketplace message protocol.");
assert(workerModule.includes("HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL"), "Generated worker must support LM Studio/OpenAI-compatible local servers.");
assert(workerModule.includes("runOpenAICompatibleJob"), "Generated worker must route jobs to the OpenAI-compatible adapter when configured.");
assert(workerModule.includes("validateJobPayment") && workerModule.includes("MPP session payment proof is required"), "Generated worker must enforce gateway payment proofs for MPP sessions.");
assert(workerModule.includes("collectAttestation") && workerModule.includes("worker.attestation.challenge"), "Generated worker must answer TEE attestation challenges.");
assert(workerModule.includes("decryptPayload") && workerModule.includes("x25519-chacha20-poly1305") && workerModule.includes("dir-a256gcm"), "Generated worker must support encrypted prompt payload delivery for TEE jobs.");
assert(workerModule.includes("teeAttestation") && workerModule.includes("mppPolicyUrl"), "Generated worker must advertise TEE and MPP capability hints.");
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
