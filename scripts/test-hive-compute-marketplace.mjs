#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const requiredFiles = [
  "src/lib/config/hive-compute-marketplace.ts",
  "src/lib/services/hive-compute-marketplace.ts",
  "src/lib/services/hive-compute-pricing.ts",
  "src/lib/services/hive-compute-benchmark.ts",
  "src/lib/services/hive-compute-marketplace/gateway-status.ts",
  "src/lib/services/hive-compute-marketplace/backend-discovery.ts",
  "src/lib/services/hive-compute-marketplace/earnings.ts",
  "src/lib/services/hive-compute-marketplace/shared-io.ts",
  "src/lib/services/hive-compute-output-e2ee.ts",
  "src/lib/services/hive-compute-artifact-e2ee.ts",
  "src/lib/services/hive-compute-artifact-wire.ts",
  "src/lib/services/hive-compute-input-artifact-spool.ts",
  "src/lib/services/hive-compute-confidential-chat.ts",
  "src/lib/services/hive-compute-workloads.ts",
  "src/lib/services/hive-compute-marketplace/gateway-client.ts",
  "src/lib/services/hive-compute-marketplace/job-key-vault.ts",
  "src/lib/types/hive-compute-marketplace.ts",
  "src/app/api/hive-compute/marketplace/route.ts",
  "src/app/api/hive-compute/chat/completions/route.ts",
  "src/app/api/hive-compute/capabilities/route.ts",
  "src/app/api/hive-compute/jobs/route.ts",
  "src/app/api/hive-compute/jobs/[jobId]/route.ts",
  "src/app/api/hive-compute/jobs/[jobId]/submit/route.ts",
  "src/app/api/hive-compute/jobs/[jobId]/artifacts/[artifactId]/route.ts",
  "src/components/fleet/hive-compute-host-modal.tsx",
  "src/components/fleet/hive-compute-host-console.tsx",
  "src/components/fleet/hive-compute-host-earnings.tsx",
  "src/components/fleet/hive-compute-benchmark-recovery.ts",
  "src/components/fleet/hive-compute-concurrency.ts",
  "src/components/fleet/hive-compute-price-draft.ts",
  "src/components/fleet/hive-compute-host-modal.module.css",
  "src/features/dashboard/views/HiveComputePanel.tsx",
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
const pricing = read("src/lib/services/hive-compute-pricing.ts");
const benchmark = read("src/lib/services/hive-compute-benchmark.ts");
const gatewayStatus = read("src/lib/services/hive-compute-marketplace/gateway-status.ts");
const outputE2ee = read("src/lib/services/hive-compute-output-e2ee.ts");
const workerModule = read("src/lib/services/hive-compute-marketplace/worker-module.ts");
const config = read("src/lib/config/hive-compute-marketplace.ts");
const gatewayCatalog = read("src/lib/config/model-provider-gateways.ts");
const runtimeIntegrations = read("src/lib/services/runtime-integrations.ts");
const streamHttp = read("src/app/api/chat/agent-runtime/stream-http-runtime.ts");
const openAiProfile = read("src/app/api/chat/agent-runtime/openai-compatible-profile.ts");
const openAiTools = read("src/app/api/chat/agent-runtime/openai-compatible-tools.ts");
const marketplaceRoute = read("src/app/api/hive-compute/marketplace/route.ts");
const computeRentalsConfig = read("src/lib/config/compute-rentals.ts");
const fleetView = read("src/components/fleet/FleetView.tsx");
const fleetHiveView = read("src/components/fleet-hive/FleetHiveView.tsx");
const hiveHostModal = read("src/components/fleet/hive-compute-host-modal.tsx");
const hiveHostConsole = read("src/components/fleet/hive-compute-host-console.tsx");
const benchmarkRecovery = read("src/components/fleet/hive-compute-benchmark-recovery.ts");
const concurrency = read("src/components/fleet/hive-compute-concurrency.ts");
const priceDraft = read("src/components/fleet/hive-compute-price-draft.ts");
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
const artifactWire = read("src/lib/services/hive-compute-artifact-wire.ts");
const artifactRoute = read("src/app/api/hive-compute/jobs/[jobId]/artifacts/[artifactId]/route.ts");

assert(config.includes('HIVE_COMPUTE_PROVIDER_SLUG = "hive-compute"'), "Provider slug constant must be hive-compute.");
assert(config.includes('HIVE_COMPUTE_WORKER_VERSION = "0.3.0"'), "Confidential workload protocol changes must refresh stale managed workers.");
assert(config.includes("HIVE_COMPUTE_MODEL_ID_RE.test(trimmed) ? trimmed : HIVE_COMPUTE_DEFAULT_MODEL"), "Direct Hive Compute model ids must not silently normalize back to Auto.");
assert(!gatewayCatalog.includes("[HIVE_COMPUTE_PROVIDER_SLUG]"), "Hive Compute should not appear as a separate model-provider picker.");
assert(runtimeIntegrations.includes("readHiveComputeMarketplaceStatus"), "Runtime integration status must expose Hive Compute readiness.");
assert(runtimeIntegrations.includes("capacityLabel"), "Runtime integration status must expose Hive Compute capacity labels.");
assert(runtimeIntegrations.includes("provider.slug !== HIVE_COMPUTE_PROVIDER_SLUG"), "Runtime integrations must filter stale Hive Compute picker rows.");
assert(streamHttp.includes("isHiveComputeProfile(profile)"), "HTTP runtime must route Hive Compute profiles through the OpenAI-compatible path.");
assert(openAiProfile.includes("resolveHiveComputeRuntimeConfig"), "OpenAI-compatible profiles must resolve Hive Compute to the local proxy.");
assert(openAiTools.includes('paidHeader === "hive-compute"'), "Chat billing must recognize Hive Compute routed HivemindOS model responses.");
assert(marketplaceRoute.includes('"run-worker"') && marketplaceRoute.includes("startHiveComputeWorker"), "Hive Compute marketplace route must expose in-app worker go-live.");
assert(marketplaceRoute.includes('"stop-worker"') && marketplaceRoute.includes("stopHiveComputeWorker"), "Hive Compute marketplace route must expose in-app worker stop.");
assert(marketplaceRoute.includes('"open-mpp-session"') && marketplaceRoute.includes("openHiveComputeMppSession"), "Hive Compute marketplace route must expose in-app MPP session opening.");
assert(marketplaceRoute.includes('"setup-hosting"') && marketplaceRoute.includes("setupHiveComputeHosting"), "Hive Compute marketplace route must expose one-click hosting setup.");
assert(marketplaceRoute.includes('"benchmark-pricing"') && marketplaceRoute.includes("benchmarkHiveComputeHostingPrices"), "Hive Compute marketplace route must expose explicit local pricing benchmarks.");
assert(marketplaceRoute.includes("export const maxDuration = 600"), "The benchmark API route must publish a server duration compatible with multi-model measurement.");
assert(computeRentalsConfig.includes("NEXT_PUBLIC_HIVEMINDOS_USEPOD_COMPUTE_RENTALS_ENABLED") && computeRentalsConfig.includes("=== \"1\""), "UsePod compute rentals must stay behind an explicit public flag.");
assert(fleetView.includes("USEPOD_COMPUTE_RENTALS_ENABLED") && fleetView.includes("HiveComputeHostModal"), "Legacy Fleet compute rental entry must default to Hive Compute with UsePod flag fallback.");
assert(fleetHiveView.includes("USEPOD_COMPUTE_RENTALS_ENABLED") && fleetHiveView.includes("HiveComputeHostModal"), "Hive Fleet compute rental entry must default to Hive Compute with UsePod flag fallback.");
assert(hiveHostModal.includes("HiveComputeHostConsole") && dashboardComputePanel.includes("HiveComputeHostConsole"), "Fleet and dashboard surfaces must share one Hive Compute host console.");
assert(hiveHostConsole.includes("Set up hosting") && hiveHostConsole.includes("Advanced diagnostics") && hiveHostConsole.includes("Open MPP session") && hiveHostConsole.includes("Privacy:"), "Shared Hive Compute host UI must keep one-click setup primary while surfacing MPP and TEE privacy gates.");
assert(hiveHostConsole.includes("selectedModelIds: null") && hiveHostConsole.includes("Models to advertise") && hiveHostConsole.includes("aria-pressed") && hiveHostConsole.includes("Enable all"), "Shared Hive Compute host UI must expose default-on model advertising chips.");
assert(hiveHostConsole.includes("maxConcurrency: 1"), "Hive Compute host controls must default concurrency to one slot.");
assert(hiveHostConsole.includes("Benchmark models") && hiveHostConsole.includes("Exact per-model asks are active — edit them below."), "Hive Compute hosting must expose model benchmarking and exact asks inline under the Custom pricing toggle.");
assert(!hiveHostConsole.includes("Advanced pricing · exact per-model asks"), "Exact per-model asks must not live in a separate bottom section — they render below the Custom toggle.");
assert(hiveHostConsole.includes("Pricing mode") && hiveHostConsole.includes("Automatic") && hiveHostConsole.includes("Custom"), "Hive Compute pricing must present only Automatic and Custom modes.");
assert(hiveHostConsole.includes("Starts below comparable hosted-model prices") && hiveHostConsole.includes('aria-pressed={config.pricingStrategy !== "custom"}'), "Automatic pricing must explain its below-market outcome and expose selected state.");
assert(hiveHostConsole.includes("Automatic · below market"), "Automatic model cards must distinguish competitive asks from raw benchmark measurements.");
assert(hiveHostConsole.includes("Not priced yet") && hiveHostConsole.includes("Benchmark required"), "Unbenchmarked models must not display low placeholder dollar prices.");
assert(hiveHostConsole.includes("pricingReady") && hiveHostConsole.includes("Benchmark to estimate"), "Projected earnings must wait for every advertised model to be benchmarked.");
assert(hiveHostConsole.includes("Benchmark selected models") && hiveHostConsole.includes("Prices and earnings appear after measurement."), "Unmeasured hosting must present benchmarking as the next required step.");
assert(hiveHostConsole.includes('busy === "benchmark-pricing"') && hiveHostConsole.includes('label: "Benchmark models"'), "The primary hosting action must run the benchmark before Go live is offered.");
assert(hiveHostConsole.includes("waitForHiveComputeBenchmarkCompletion") && hiveHostConsole.includes("isHiveComputeBenchmarkProxyTimeout"), "The host UI must recover a benchmark that continues after the dev proxy times out.");
assert(benchmarkRecovery.includes('code === "DEV_PROXY_TIMEOUT"') && benchmarkRecovery.includes("waitForHiveComputeBenchmarkCompletion"), "Benchmark timeout recovery must stay in one tested helper.");
assert(hiveHostConsole.includes("priceEditorList"), "The exact-asks editor must render (inside the benchmark-gated pricing branch, Custom mode only).");
assert(!hiveHostConsole.includes('"Starter estimate"'), "Starter-price jargon must not imply that placeholder amounts are real model asks.");
assert(hiveHostConsole.includes("Estimated provider earnings") && hiveHostConsole.includes("net est."), "Post-fee provider projections must remain explicit in the host UI.");
assert(hiveHostConsole.includes("concurrencyAfterAdvertisedModelChange"), "Advertised-model changes must preserve or advance the user's concurrency cap intent.");
assert(hiveHostConsole.includes("{concurrency}/{enabledCount}"), "Concurrency must display the active and available slot counts together.");
assert(concurrency.includes("concurrencyAfterAdvertisedModelChange"), "Concurrency-cap behavior must stay in one tested helper.");
assert(hiveHostConsole.includes("priceDrafts") && hiveHostConsole.includes("onBlur") && hiveHostConsole.includes("parseHiveComputePriceDraft"), "Advanced custom-price inputs must allow empty editing drafts and commit on blur.");
assert(priceDraft.includes("parseHiveComputePriceDraft"), "Custom-price draft normalization must stay in one focused helper.");
assert(!hiveHostConsole.includes("Competitive") && !hiveHostConsole.includes("Max earnings") && !hiveHostConsole.includes("Desired earnings while busy") && !hiveHostConsole.includes("Target gross / active hour") && !hiveHostConsole.includes("Benchmark prices"), "Hourly-target, strategy, and price-formula controls must not return to the primary host UI.");
assert(!hiveHostConsole.includes("List markdown"), "Retired list-markdown pricing jargon must not remain in the host UI.");
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
assert(hivemindosModelsRoute.includes("confidentialMarketplaceRows") && hivemindosModelsRoute.includes("fallbackRoute"), "HivemindOS model list must return verified confidential capacity before routes that can fall back.");
assert(hivemindosModelsRoute.includes("readHiveComputeMarketplaceStatus") && hivemindosModelsRoute.includes("hiveComputeHostedModelId(id)"), "HivemindOS model list must include live Hive Compute marketplace models as direct route rows.");
assert(hivemindosChatRoute.includes("proxyHiveComputeChatCompletion"), "HivemindOS model chat route must try Hive Compute before OpenRouter fallback.");
assert(hivemindosChatRoute.includes("fetchPreferredHiveComputeCompletion") && hivemindosChatRoute.includes("X-HivemindOS-Model-Route"), "HivemindOS model chat route must expose Hive Compute response billing/routing headers.");
assert(guidedHivemindosSetup.includes("staticCatalogModels") && guidedHivemindosSetup.includes("matchingAllModels"), "Guided setup must blend SALE routes into the unified All models catalog.");
assert(guidedHivemindosSetup.includes("pinConfidentialVerifiedFirst") && guidedHivemindosSetup.includes("Confidential verified"), "Guided setup must pin verified confidential models first and display their trust label.");
assert(modelPillSelector.includes("data-confidential-verified") && modelPillSelector.includes("ShieldCheck"), "Shared model pills must visibly distinguish server-verified confidential models.");
assert(guidedHivemindosSetup.includes("allModelCount") && guidedHivemindosSetup.includes("sale: computeFirst || computeHosted"), "Guided setup must mark GPU-first and live Hive Compute model chips as SALE routes inside All models.");
assert(!guidedHivemindosSetup.includes("GPU-first routes") && !guidedHivemindosSetup.includes("Hosted routes"), "Guided setup must not split GPU-first or hosted models into separate sections.");
assert(docs.includes("not the authority for official") && docs.includes("marketplace value"), "User docs must explain that official marketplace authority is not local.");
assert(docs.includes("prepaid client balance") && docs.includes("centralized fallback"), "User docs must mention hosted balance and fallback marketplace capabilities.");
assert(docs.includes("provider bonds") && docs.includes("canary accounting"), "User docs must mention hosted trust and canary marketplace capabilities.");
assert(docs.includes("TEE") && docs.includes("MPP") && docs.includes("Open MPP session") && docs.includes("encrypted job payloads"), "User docs must explain TEE privacy and MPP payment boundaries.");
assert(workersReadme.includes("Hive Compute marketplace routing"), "Hosted-service boundary docs must mention Hive Compute.");
assert(contextIndex.includes("hiveComputeContextIndexItem"), "Context index must include the Hive Compute static capability item.");
assert(staticToolItems.includes("tool-schema:hive-compute-marketplace") && staticToolItems.includes("MPP") && staticToolItems.includes("TEE"), "Static context item must advertise Hive Compute, MPP, and TEE capability discovery.");
assert(service.includes("Official jobs require gateway-verified hardware TEE execution") && service.includes("plaintext is self-hosted compatibility only"), "Worker setup must describe the official fail-closed privacy boundary.");
assert(artifactWire.includes('"HIVEART1"') && artifactWire.includes("getHiveComputeJobPrivateKey") && artifactWire.includes("ciphertextSha256"), "Artifact wire must support framed local decryption with renter-key and signed-hash binding.");
assert(!artifactRoute.includes("searchParams.get(\"grant\")"), "Artifact grants must never be accepted through leak-prone query parameters.");
assert(service.includes("prepaid balances") && service.includes("key relays") && service.includes("reputation"), "Public status boundary must name hosted commercial authority surfaces.");
assert(service.includes("startHiveComputeWorker") && service.includes("HIVE_COMPUTE_MODEL_MAP_JSON"), "Hive Compute service must start the managed worker with a local model map.");
assert(service.includes("HIVE_COMPUTE_MODEL_LISTINGS_JSON") && service.includes("workerModelListings"), "Hive Compute service must send authenticated per-model asks to the managed worker.");
assert(service.includes("benchmarkHiveComputePricingConfig") && service.includes("benchmarkHiveComputeModel"), "Hive Compute service must benchmark selected local models before auto-priced hosting.");
assert(!service.includes('requestedConfig.pricingStrategy === "custom"'), "Custom asks must not bypass the model benchmark required for capacity and routing.");
assert(service.includes("isHiveComputeBenchmarkCurrent") && pricing.includes("HIVE_COMPUTE_AUTOMATIC_UNDERCUT_RATIO") && pricing.includes("automaticMarketReferenceForModel"), "Old measurements must expire and Automatic pricing must undercut a model-aware market reference.");
assert(benchmark.includes("HIVE_COMPUTE_BENCHMARK_SAMPLE_COUNT") && benchmark.includes("median(") && benchmark.includes("warmupCompleted: true"), "Local pricing benchmarks must warm the model and use repeated median samples.");
assert(benchmark.includes("benchmarkWithModelCleanup") && benchmark.includes("loadedLmStudioInstances") && benchmark.includes("loadedOllamaModels") && benchmark.includes("keep_alive: 0"), "Each benchmark-owned LM Studio or Ollama model must unload before the next benchmark can start.");
assert(service.includes("selectedModelIds") && service.includes("advertisedWorkerModels") && service.includes("selectedHostModels"), "Hive Compute service must persist selected advertised models.");
assert(service.includes("HIVE_COMPUTE_MODELS: host.advertisedModels.join") && service.includes("HIVE_COMPUTE_WORKER_MAX_CONCURRENCY"), "Hive Compute service must pass advertised models and slots into the worker env.");
assert(service.includes("installedHiveComputeWorkerVersion") && service.includes("workerModule.updateAvailable") && service.includes("installHiveComputeWorkerModule({ force: true })"), "Hive Compute service must refresh stale managed worker modules before hosting.");
assert(service.includes("setupHiveComputeHosting") && service.includes("installHiveComputeWorkerDependencies") && service.includes("openHiveComputeMppSession"), "Hive Compute service must provide one-click setup that installs dependencies and opens MPP sessions when available.");
assert(service.includes("HIVE_COMPUTE_MPP_POLICY_URL_ENV") && service.includes("HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV"), "Hive Compute service must expose MPP and TEE attestation capability gates.");
assert(service.includes("forwardedHiveComputePrivacyHeaders") && service.includes("X-HivemindOS-Compute-Output-Encryption"), "Hive Compute proxy must forward output E2EE request headers.");
assert(service.includes("openHiveComputeMppSession") && service.includes("HIVE_COMPUTE_MPP_SESSION_FILE"), "Hive Compute service must open and store local MPP session authorizations.");
assert(workerModule.includes('import WebSocket from "ws"'), "Generated worker must use the native WebSocket client.");
assert(workerModule.includes("/hive-compute/worker/ws"), "Generated worker must default to the hosted marketplace WebSocket path.");
assert(workerModule.includes('"worker.register"') && workerModule.includes('"job.assign"'), "Generated worker must use the hosted marketplace message protocol.");
assert(workerModule.includes("HIVE_COMPUTE_MODEL_LISTINGS_JSON") && workerModule.includes("listings: modelListings"), "Generated worker must register and heartbeat exact per-model listings.");
assert(workerModule.includes("HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL"), "Generated worker must support LM Studio/OpenAI-compatible local servers.");
assert(workerModule.includes("runOpenAICompatibleJob"), "Generated worker must route jobs to the OpenAI-compatible adapter when configured.");
assert(workerModule.includes("validateJobPayment") && workerModule.includes("MPP session payment proof is required"), "Generated worker must enforce gateway payment proofs for MPP sessions.");
assert(workerModule.includes("collectAttestation") && workerModule.includes("worker.attestation.challenge"), "Generated worker must answer TEE attestation challenges.");
assert(workerModule.includes("decryptPayload") && workerModule.includes("x25519-chacha20-poly1305") && workerModule.includes("dir-a256gcm") && workerModule.includes("rsa-oaep-a256gcm"), "Generated worker must support encrypted prompt payload delivery for TEE jobs.");
assert(workerModule.includes("encryptedOutputDelivery: true") && workerModule.includes("hostConfidentialOutput: false") && workerModule.includes("job.encrypted_token"), "Ordinary worker transport encryption must never claim host-confidential output.");
assert(workerModule.includes("emitJobComplete(input, finalText, finalUsage)") && workerModule.includes("usageWithCompletionEstimate"), "Generated worker must report usage while keeping E2EE output ciphertext-only to the gateway.");
assert(workerModule.includes("teeAttestation") && workerModule.includes("mppPolicyUrl"), "Generated worker must advertise TEE and MPP capability hints.");
assert(workerModule.includes("positiveInteger(process.env.HIVE_COMPUTE_WORKER_MAX_CONCURRENCY, 1)") && workerModule.includes("maxConcurrency"), "Generated worker must default to one slot and advertise configured max concurrency.");
assert(service.includes("capacityFromHealth") && gatewayStatus.includes("providerBounds"), "Hive Compute status must parse live marketplace capacity and provider-price bounds.");
assert(gatewayStatus.includes("confidentialModels") && service.includes('trust: "confidential-verified"'), "Hive Compute status must derive confidential model trust from the hosted gateway.");
assert(gatewayStatus.includes("totalSlots") && gatewayStatus.includes("availableSlots"), "Hive Compute status must parse marketplace slot capacity.");
assert(gatewayStatus.includes("modelPerformanceArray") && gatewayStatus.includes("tokensPerSecond") && gatewayStatus.includes("modelPerformanceLabel"), "Hive Compute status must parse and display measured model speed.");
assert(gatewayStatus.includes('performance.speedTier === "warming") return "Measuring speed"'), "Hive Compute must not show tiny warming samples as numeric tok/s benchmarks.");
assert(hiveHostConsole.includes("modelChipPrice") && guidedHivemindosSetup.includes("sale: computeFirst || computeHosted"), "Dashboard model surfaces must keep measured Hive Compute price metadata visible.");
assert(service.includes("Live worker model"), "Hive Compute model options must include live worker model metadata.");
assert(!service.includes("socket.io-client"), "Generated worker must not depend on Socket.IO.");
assert(outputE2ee.includes("generateHiveComputeOutputKeyPair") && outputE2ee.includes("decryptHiveComputeOutputEnvelope"), "Public client helper must generate output E2EE keys and decrypt envelopes.");
assert(outputE2ee.includes("X-HivemindOS-Compute-Output-Public-Key"), "Public client helper must expose the gateway output public-key header.");

// Guardrail enforcement, earnings ledger, multimodal passthrough, and lifecycle
// (v0.2.0 worker protocol). The worker e2e suite (test:hive-compute-worker)
// exercises these live; the anchors below keep them from being silently removed.
const backendDiscovery = read("src/lib/services/hive-compute-marketplace/backend-discovery.ts");
const earningsModule = read("src/lib/services/hive-compute-marketplace/earnings.ts");
const instrumentation = read("src/instrumentation.ts");
const hiveHostEarnings = read("src/components/fleet/hive-compute-host-earnings.tsx");
assert(workerModule.includes("jobRefusalReason") && workerModule.includes("worker-unavailable: "), "Generated worker must enforce guardrails locally and refuse with a reroutable reason.");
assert(workerModule.includes("HIVE_COMPUTE_WORKER_PAUSE_ON_BATTERY") && workerModule.includes("HIVE_COMPUTE_WORKER_YIELD_TO_USER") && workerModule.includes("HIVE_COMPUTE_WORKER_DAILY_CAP_USD"), "Generated worker must read and enforce the battery, user-activity, and daily-cap guardrails.");
assert(workerModule.includes("HIVE_COMPUTE_WORKER_SCHEDULE_JSON") && workerModule.includes("withinSchedule"), "Generated worker must enforce the scheduled hosting window.");
assert(workerModule.includes("activeJobs.size >= maxConcurrency"), "Generated worker must enforce its concurrency cap locally, not just advertise it.");
assert(workerModule.includes("earnings-summary.json") && workerModule.includes("recordEarning"), "Generated worker must persist gateway earnings to the local summary ledger.");
assert(workerModule.includes("modalities: MODALITIES") && workerModule.includes("workerAvailability"), "Generated worker must advertise modalities and live availability.");
assert(workerModule.includes("Array.isArray(message.content)") && workerModule.includes("ollamaMessage"), "Generated worker must pass multimodal content parts through to both engines.");
assert(workerModule.includes("HIVE_COMPUTE_MODEL_ENGINES_JSON") && workerModule.includes("engineForModel"), "Generated worker must route each model to its own engine.");
assert(earningsModule.includes("earnings-summary.json") && earningsModule.includes("summarizeHiveComputeEarnings"), "Dashboard earnings reader must aggregate the worker ledger file.");
assert(backendDiscovery.includes("discoverHiveComputeBackend") && backendDiscovery.includes("backends"), "Backend discovery must probe and merge every local backend, not pick one.");
assert(service.includes("readHiveComputeEarningsSummary") && service.includes("lastBenchmark"), "Host status must expose actual earnings and the last benchmark report.");
assert(service.includes("benchmarkedModelIds") && service.includes("failures.push"), "Benchmarks must tolerate per-model failures instead of blocking the whole run.");
assert(service.includes("attachHiveComputeWorkerChild") && service.includes("WORKER_MAX_AUTO_RESTARTS"), "Worker crashes must auto-respawn with backoff instead of silently ending hosting.");
assert(service.includes("resumeHiveComputeWorker") && service.includes("shouldRun"), "Hosting intent must survive app restarts through the resume path.");
assert(marketplaceRoute.includes('"resume-worker"') && marketplaceRoute.includes('"save-config"') && marketplaceRoute.includes("onlyModels"), "Marketplace route must expose resume, config save, and per-model benchmarks.");
assert(instrumentation.includes("resume-worker") && instrumentation.includes("HIVEMINDOS_HIVE_COMPUTE_RESUME"), "Server boot must resume hosting when the saved intent says it was live.");
assert(hiveHostConsole.includes("benchmarkModelsSequentially") && hiveHostConsole.includes("setSetupDetail"), "Setup progress must be real per-stage/per-model progress, not timer-faked.");
assert(hiveHostConsole.includes("Daily earnings cap") && hiveHostConsole.includes("schedule"), "Host controls must expose the daily cap and schedule guardrails.");
assert(hiveHostConsole.includes("HiveComputeHostEarningsView"), "The earnings step must render through the shared earnings view.");
assert(hiveHostEarnings.includes("Earned today") && hiveHostEarnings.includes("Actual earnings"), "The earnings view must show actual ledger earnings, not only projections.");
assert(hiveHostModal.includes("FOCUSABLE_SELECTOR") && hiveHostModal.includes("previouslyFocused"), "The host modal must trap focus and restore it on close.");
assert(pricing.includes("HIVE_COMPUTE_BENCHMARK_MAX_AGE_MS") && pricing.includes("hiveComputeAvailabilityFactor"), "Benchmarks must expire with age and projections must respect hosting availability.");

// Image modality (client side of the cross-repo contract with the hosted
// gateway), memory-fit warnings, and the remote quick-host rail.
const remoteHost = read("src/lib/services/hive-compute-marketplace/remote-host.ts");
const remoteHostControls = read("src/components/fleet/hive-compute-remote-host.tsx");
const memoryFit = read("src/components/fleet/hive-compute-memory-fit.ts");
assert(workerModule.includes("HIVE_COMPUTE_WORKLOAD_MANIFEST_ENV") && workerModule.includes("runConfidentialSidecarJob"), "Generated worker must route typed workloads only through the confidential sidecar.");
assert(workerModule.includes("usdMicroPerImage") && workerModule.includes("usdMicroPerUnit"), "Image-v1 listings must retain per-image and generic unit compatibility fields.");
assert(workerModule.includes('"hive-artifact-aes256gcm-v1"') && !workerModule.includes("runImageJob") && !workerModule.includes('response_format: "b64_json"'), "Generated artifacts must remain ciphertext and never return base64 image bodies through the relay.");
assert(workerModule.includes('message.type === "job.cancel"') && workerModule.includes('"job.progress"') && workerModule.includes('"job.confidential_complete"'), "Typed worker jobs must support cancellation, progress, and signed confidential completion.");
assert(service.includes("HIVE_COMPUTE_WORKLOAD_MANIFEST_ENV") && service.includes("HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_URL_ENV"), "Managed go-live must forward the validated workload manifest and sidecar endpoint.");
assert(memoryFit.includes("hiveComputeMemoryFit") && hiveHostConsole.includes("hiveComputeMemoryFit"), "The host console must warn when advertised models cannot fit machine memory.");
assert(backendDiscovery.includes("sizeBytes") && backendDiscovery.includes("lmStudioModelSizes"), "Discovery must capture model sizes best-effort for memory-fit warnings.");
assert(remoteHost.includes("shellBaseFromCollectorUrl") && remoteHost.includes("_hivemind/file"), "Remote quick-host must ride the established linkd shell/file rails.");
assert(remoteHost.includes("hive-env-run -- npm start") && remoteHost.includes("worker.pid"), "Remote go-live must resolve secrets on the remote machine and stop only by recorded pid.");
assert(!remoteHost.includes("pkill") && !remoteHost.includes("lsof"), "Remote stop must never kill by process name or port.");
assert(marketplaceRoute.includes('"remote-run-worker"') && marketplaceRoute.includes("startRemoteHiveComputeWorker"), "Marketplace route must expose remote quick-host actions behind an explicit remote target.");
assert(remoteHostControls.includes("Remote quick-host") && hiveHostConsole.includes("HiveComputeRemoteHostControls"), "The host console must offer remote quick-host for remote machines.");

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
