import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

async function source(path) {
  return readFile(join(root, path), "utf8");
}

// The chat agent-runtime route was decomposed into sibling modules (route.ts +
// stream-*/wallet-*/messages/… on 2026-07-02); the wallet-paid contract spans
// them, so read the whole route directory as one haystack.
async function sourceDir(dir) {
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(join(root, dir))).filter((name) => name.endsWith(".ts"));
  const contents = await Promise.all(names.map((name) => readFile(join(root, dir, name), "utf8")));
  return contents.join("\n");
}

function includes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} should include ${needle}`);
}

const [
  gatewayConfig,
  runtimeRoute,
  walletPaidService,
  proxyRoute,
  modelsRoute,
  setupWalletRoute,
  setupComponent,
  setupStyles,
  walletSelectModal,
  walletPickables,
  walletPanel,
  walletsView,
  agentRuntimeTypes,
  agentSettingsTypes,
  agentSettingsPrimitives,
  agentSettingsModal,
  safeProcessEnv,
  chatRuntimeRoute,
  runtimeIntegrations,
  contextIndex,
  x402Executor,
  walletPaidModelsConfig,
  creditRoute,
  creditVault,
  paidAgentCloudClient,
  tauriCargo,
  tauriConfig,
  tauriLib,
  tauriDesktopNavigation,
  officialCreditTopUpRoute,
  officialCreditCheckoutRoute,
  officialCreditBalanceRoute,
  chatBillingTypes,
  runtimeSessionStore,
  dashboardTypes,
  dashboardApp,
  dashboardStorage,
  statusChatInputController,
  messageThread,
  chatExchangeStyles,
] = await Promise.all([
  source("src/lib/config/model-provider-gateways.ts"),
  sourceDir("src/app/api/chat/agent-runtime"),
  source("src/lib/services/hivemindos-wallet-paid-models.ts"),
  source("src/app/api/hivemindos/models/chat/completions/route.ts"),
  source("src/app/api/hivemindos/models/models/route.ts"),
  source("src/app/api/hivemindos/models/wallet/route.ts"),
  source("src/features/dashboard/views/chat/GuidedHivemindosModelsSetup.tsx"),
  source("src/features/dashboard/views/chat/HivemindosModelsSetup.module.css"),
  source("src/features/dashboard/views/trade/WalletSelectModal.tsx"),
  source("src/features/dashboard/views/trade/wallet-pickables.ts"),
  source("src/features/dashboard/views/WalletPanel.tsx"),
  source("src/components/wallets-drop-in/WalletsView.tsx"),
  source("src/lib/types/agent-runtime.ts"),
  source("src/features/dashboard/agent-settings-types.ts"),
  source("src/features/dashboard/views/chat/AgentSettingsModalPrimitives.tsx"),
  source("src/features/dashboard/views/chat/AgentSettingsModal.tsx"),
  source("src/lib/utils/safe-process-env.ts"),
  sourceDir("src/app/api/chat/agent-runtime"),
  source("src/lib/services/runtime-integrations.ts"),
  source("src/lib/services/context-index.ts"),
  source("src/lib/services/wallet/x402-agent-fetch.ts"),
  source("src/lib/config/hivemindos-wallet-paid-models.ts"),
  source("src/app/api/hivemindos/models/credits/route.ts"),
  source("src/lib/services/hivemindos-model-credit-vault.ts"),
  source("src/lib/services/paid-agent-cloud-client.ts"),
  source("src-tauri/Cargo.toml"),
  source("src-tauri/tauri.conf.json"),
  source("src-tauri/src/lib.rs"),
  source("src-tauri/src/desktop_navigation.rs"),
  source("src/app/api/official-paid-agents/[slug]/credits/top-up/route.ts"),
  source("src/app/api/official-paid-agents/[slug]/credits/checkout/route.ts"),
  source("src/app/api/official-paid-agents/[slug]/credits/balance/route.ts"),
  source("src/lib/types/chat-billing.ts"),
  source("src/lib/services/chat/runtime-session-store.ts"),
  source("src/features/dashboard/dashboard-types.ts"),
  source("src/features/dashboard/DashboardApp.tsx"),
  source("src/features/dashboard/dashboard-storage.ts"),
  source("src/features/dashboard/hooks/use-status-chat-input-controller.tsx"),
  source("src/features/dashboard/views/chat/exchange/MessageThread.tsx"),
  source("src/features/dashboard/views/chat/exchange/chat-exchange.css"),
]);

includes(gatewayConfig, "HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER", "provider gateway config");
includes(gatewayConfig, "Free + wallet-paid models · no API key", "provider gateway copy");

includes(runtimeIntegrations, "hivemindosWalletPaidModelOptions", "runtime provider model discovery");
includes(runtimeIntegrations, "/api/hivemindos/models/models", "runtime provider model source");

includes(runtimeRoute, "resolveHivemindosWalletPaidModelRuntimeConfig", "chat runtime");
includes(runtimeRoute, "if (isHivemindosWalletPaidModelProfile(profile))", "chat runtime wallet-paid Hermes bypass");
includes(runtimeRoute, "return streamOpenAICompatibleRuntime(profile, messages, userText", "chat runtime wallet-paid OpenAI-compatible stream");
includes(runtimeRoute, "telemetryUrl: \"\"", "chat runtime wallet-paid dashboard-local proxy routing");
includes(runtimeRoute, "hivemindosModelsBillingFromHeaders", "chat runtime model billing headers");
includes(runtimeRoute, "X-HivemindOS-Models-Credit-Debited-Usd", "chat runtime model credit debit header");
includes(runtimeRoute, "ssePayload({ billing: responseBilling })", "chat runtime streams model billing");
includes(runtimeRoute, "extractOpenAIToolCalls", "chat runtime extracts non-stream OpenAI tool calls");
includes(runtimeRoute, "runNonStreamToolCalls", "chat runtime executes non-stream model tool calls");
includes(runtimeRoute, "const toolCalls = winningRequest?.sentTools ? extractOpenAIToolCalls(json) : []", "chat runtime checks non-stream JSON for tool calls before text fallback");
includes(runtimeRoute, "nonStream: true", "chat runtime records non-stream command tool telemetry");
includes(walletPaidService, "X-HivemindOS-Wallet-Agent-Id", "wallet-paid runtime resolver");
includes(walletPaidService, "funding.walletVaultId", "wallet-paid runtime resolver setup wallet id");
includes(walletPaidService, "funding.creditAccountId", "wallet-paid runtime resolver hosted credit account id");
includes(walletPaidService, "/api/hivemindos/models", "wallet-paid runtime resolver");
includes(walletPaidService, "!fundingAccountId && !isFreeHivemindosWalletPaidModel(model)", "wallet-paid runtime resolver skips funding requirement for the free model");

includes(modelsRoute, "hivemindosWalletPaidModelOptions", "models list route");
includes(modelsRoute, "owned_by: \"hivemindos\"", "models list route ownership");
includes(modelsRoute, "fetchOfficialPaidAgentModelList", "models list route pulls hosted gateway inventory");
includes(modelsRoute, "customHivemindosWalletPaidModelId", "models list route exposes gateway models as custom ids");
includes(walletPaidModelsConfig, "upstreamHivemindosWalletPaidModel", "wallet-paid model upstream alias mapping");
includes(walletPaidModelsConfig, "gpt-5.4-mini", "wallet-paid default upstream model id");
includes(walletPaidModelsConfig, "gpt-5.4-nano", "wallet-paid fast upstream model id");
includes(walletPaidModelsConfig, "gpt-5.5", "wallet-paid frontier upstream model id");
includes(walletPaidModelsConfig, "claude-opus-4.8", "wallet-paid research upstream model id");
includes(walletPaidModelsConfig, "hivemindos/swarm-sovereign-scout", "free model id");
includes(walletPaidModelsConfig, "swarm-sovereign-scout-12b", "free model upstream id");
includes(walletPaidModelsConfig, "tier: \"free\"", "free model tier");
includes(walletPaidModelsConfig, "HIVEMINDOS_CUSTOM_MODEL_PREFIX", "custom gateway model prefix");
includes(walletPaidModelsConfig, "isFreeHivemindosWalletPaidModel", "free model predicate");
includes(walletPaidModelsConfig, "HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL = HIVEMINDOS_FREE_MODEL_ID", "free model is the provider default");

includes(agentRuntimeTypes, "interface HivemindosModelsAgentConfig", "agent profile wallet-paid config");
includes(agentRuntimeTypes, "hivemindosModels?: HivemindosModelsAgentConfig", "agent profile wallet-paid config field");
includes(agentRuntimeTypes, "fundingMode?: \"credits\" | \"wallet\"", "agent profile HivemindOS Models funding mode");
includes(agentRuntimeTypes, "creditAccountId?: string", "agent profile hosted credit account id");
includes(agentRuntimeTypes, "fundingWalletKind?: \"personal\" | \"agent\"", "agent profile funding source kind");
includes(agentRuntimeTypes, "fundingWalletLabel?: string", "agent profile funding source label");
includes(agentRuntimeTypes, "lastCheckoutSessionId?: string", "agent profile card checkout session metadata");
includes(agentRuntimeTypes, "lastCreditBalanceUsd?: string", "agent profile wallet-paid model credit balance");
includes(agentRuntimeTypes, "lastCreditBalanceLabel?: string", "agent profile wallet-paid model credit balance label");
includes(agentSettingsTypes, "hivemindosModels?: HivemindosModelsAgentConfig", "agent create draft wallet-paid config");

includes(setupWalletRoute, "storeWalletSecret", "setup wallet route stores local wallet secret");
includes(setupWalletRoute, "writeWalletRecord", "setup wallet route writes Wallets ledger");
includes(setupWalletRoute, "readWalletLedger", "setup wallet route preserves linked wallet records");
includes(setupWalletRoute, "refreshWalletVaultBackup", "setup wallet route refreshes encrypted wallet backup");
includes(setupWalletRoute, "hivemindos-models", "setup wallet route durable setup wallet prefix");
includes(setupWalletRoute, "agentId?.trim() || \"\"", "setup wallet route accepts draft/final agent ids");
includes(setupWalletRoute, "!trimmed.startsWith(\"new-\")", "setup wallet route avoids draft ids");
includes(setupWalletRoute, "hivemindosModelsFundingWallet", "setup wallet route normalizes model funding wallets");
includes(setupWalletRoute, "existingWallet", "setup wallet route preserves existing linked wallet settings");
includes(setupWalletRoute, "provider: \"manual\" as const", "setup wallet route defaults new model funding wallets to manual provider");
assert.ok(!setupWalletRoute.includes("provider: \"x402\""), "setup wallet route should not mutate model funding wallets into general x402 providers");
assert.ok(!setupWalletRoute.includes("autoPayEnabled: true"), "setup wallet route should not enable general wallet auto-pay for model funding");

includes(setupComponent, "/api/hivemindos/models/wallet", "guided setup wallet route");
includes(setupComponent, "fetchPersonalWalletRecords", "guided setup personal wallet source");
includes(setupComponent, "fetchPersonalWalletBalance", "guided setup personal wallet live balances");
includes(setupComponent, "getDisplayWalletBalanceUsd", "guided setup saved wallet balance display");
includes(setupComponent, "groupedUserPickables", "guided setup user-wallet picker source");
includes(setupComponent, "agentPickable", "guided setup agent-wallet picker source");
includes(setupComponent, "resolvePickableAccount", "guided setup resolves grouped wallet accounts");
includes(setupComponent, "Funding address", "guided setup funding flow");
includes(setupComponent, "Saved to Wallets", "guided setup wallet persistence copy");
includes(setupComponent, "savedFundingBalanceCopy", "guided setup saved wallet balance copy");
includes(setupComponent, "/api/hivemindos/models/credits", "guided setup model credits route");
includes(setupComponent, "Card credits", "guided setup card credit mode");
includes(setupComponent, "Crypto wallet", "guided setup crypto wallet mode");
includes(setupComponent, "CARD_CREDIT_AMOUNT_OPTIONS = [10, 25, 50, 100]", "guided setup card credit presets");
includes(setupComponent, "CardCreditAmountOption", "guided setup card custom amount state");
includes(setupComponent, "Custom amount", "guided setup custom card amount input");
includes(setupComponent, "amountUsd: cardTopUpAmountUsd", "guided setup uses selected card amount for checkout");
includes(setupComponent, "openCheckoutUrl", "guided setup opens Stripe checkout through the app browser bridge");
includes(setupComponent, "/api/system/browsers/open", "guided setup opens Stripe checkout in the system browser for Tauri");
includes(setupComponent, "window.open(trimmedUrl", "guided setup keeps web fallback for checkout links");
includes(setupComponent, "CARD_CHECKOUT_POLL_WINDOW_MS = 10 * 60 * 1000", "guided setup auto-polls card checkout for ten minutes");
includes(setupComponent, "setCardCheckoutPollUntil(Date.now() + CARD_CHECKOUT_POLL_WINDOW_MS", "guided setup starts card checkout polling");
includes(setupComponent, "hivemindos:models-credits-return", "guided setup listens for desktop checkout return deep links");
includes(setupComponent, "persistModelCreditBalance", "guided setup persists refreshed model credit balances");
includes(setupComponent, "lastCreditBalanceLabel: balanceLabel", "guided setup writes refreshed balance labels back to the agent");
includes(setupComponent, "hasFundedModelCredits", "guided setup waits for actual funded credits");
assert.ok(!setupComponent.includes("creditState.checkoutSessionId\n      || creditState.configured"), "guided setup should not treat an opened checkout session as funded credits");
assert.ok(!setupComponent.includes("lastTestStatus: \"ready\",\n        lastStatusMessage: data.message || \"Card checkout opened"), "guided setup should not mark opened card checkout as ready");
assert.ok(!setupComponent.includes("successUrl: returnUrl"), "guided setup should not send the local dashboard as Stripe success URL");
assert.ok(!setupComponent.includes("cancelUrl: returnUrl"), "guided setup should not send the local dashboard as Stripe cancel URL");
includes(setupComponent, "Fund with crypto", "guided setup crypto top-up action");
includes(setupComponent, "modelCreditLabel", "guided setup model credits balance label");
includes(setupComponent, "const selectedModelIsFree = isFreeHivemindosWalletPaidModel(selectedModel)", "guided setup detects the free model");
assert.ok(!setupComponent.includes("async function finishSetup"), "embedded panel has no Done handler of its own — every change persists immediately via onComplete");
assert.ok(!setupComponent.includes("onCancel: () => void"), "embedded panel takes no onCancel prop (only the wallet browser's internal Back remains)");
includes(setupComponent, "const fundingConfigured = walletReady || cardFundingReady", "guided setup derives one funded flag for the balance pill and paid-model gate");
includes(setupComponent, ".filter((option) => option.tier !== \"free\")", "guided setup keeps the free model out of the routing-tier chips (it is the hero card)");
includes(setupComponent, "styles.freeHero", "guided setup renders the free Scout hero card row");
includes(setupComponent, "styles.balancePill", "guided setup renders the tappable balance pill that opens funding");
includes(setupComponent, "styles.chipGrid", "guided setup renders routing tiers and gateway models as chip grids");
includes(setupComponent, "Routing tiers", "guided setup routing-tiers subhead");
includes(setupComponent, "All models", "guided setup all-models subhead");
includes(setupComponent, "styles.fundOverlay", "guided setup funding modal overlay");
includes(setupComponent, "fund.gate ? (", "funding modal shows the requires-credits gate banner");
includes(setupComponent, "setFund({ gate: true, pendingModel: modelId })", "picking a paid model while unfunded opens the funding modal as a gate");
includes(setupComponent, "pendingModelRef.current = \"\";", "the gated pending model applies once and clears after funding");
includes(setupComponent, "HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS", "guided setup model route selection");
includes(setupComponent, "/api/hivemindos/models/models", "guided setup pulls the dynamic gateway model list");
includes(setupComponent, "function sortGatewayModels", "gateway grid supports sorting");
includes(setupComponent, "scoreModelStrength", "Top sort ranks by the canonical model-strength matrix");
includes(setupComponent, "GATEWAY_MODEL_SORTS", "sort pill options (Top/New/Cheapest/Priciest/A–Z)");
includes(setupComponent, "WalletSelectPanel", "guided setup embedded wallet picker");
includes(setupComponent, "HivemindosModelsSetup.module.css", "guided setup dark honey stylesheet");
includes(setupComponent, "isLocalPaymentSigningWallet", "guided setup local signing wallet gate");
assert.ok(!setupComponent.includes("/api/wallet/browse"), "guided setup should use live Wallets/Trade picker sources, not the zero-balance browse endpoint");
assert.ok(!setupComponent.includes("styles.browseActions"), "guided setup browse picker should not show a separate New wallet action");
assert.ok(!setupComponent.includes("UsePodSetup.module.css"), "guided setup should not reuse UsePod setup styling");
assert.ok(!setupComponent.includes("styles.wallets"), "guided setup should not render the old custom wallet list");
assert.ok(!setupComponent.includes("Use my own API key"), "HivemindOS Models setup should not expose BYOK copy");

includes(setupStyles, "--honey", "guided setup honey tokens");
includes(setupStyles, "fundingModes", "guided setup funding mode switch styling");
includes(setupStyles, "cardAmounts", "guided setup card amount presets styling");
includes(setupStyles, "customAmount", "guided setup custom card amount styling");
includes(setupStyles, "freeHero", "guided setup free hero card styling");
includes(setupStyles, "balancePill", "guided setup balance pill styling");
includes(setupStyles, "chipGrid", "guided setup model chip grid styling");
includes(setupStyles, "fundOverlay", "guided setup funding modal overlay styling");
includes(setupStyles, "gateBanner", "guided setup funding gate banner styling");
includes(setupStyles, "walletSelectorEmbed", "guided setup embedded wallet picker styling");
includes(setupStyles, "[data-theme=\"hive-light\"]", "guided setup light theme token bridge");
assert.ok(!setupStyles.includes("browseActions"), "guided setup styles should not keep the hidden browse New wallet action");
assert.ok(!setupStyles.includes("min-height: min(720px"), "guided setup shell should not reserve a tall empty modal body after compact wallet setup");

includes(walletSelectModal, "export function WalletSelectPanel", "wallet picker embedded panel export");
includes(walletSelectModal, "panelClassName", "wallet picker embedded panel class hook");
includes(walletSelectModal, "confirmDisabled", "wallet picker embedded panel busy gate");
includes(walletPickables, "export function groupedUserPickables", "wallet picker shared user mapping");
includes(walletPickables, "export function agentPickable", "wallet picker shared agent mapping");
includes(walletPickables, "export function resolvePickableAccount", "wallet picker grouped account resolver");
includes(walletPickables, "export function isLocalPaymentSigningWallet", "wallet picker local signing wallet predicate");

includes(agentSettingsModal, "GuidedHivemindosModelsSetup", "agent settings modal setup component");
includes(agentSettingsModal, "walletsByAgent={walletsByAgent}", "agent settings modal passes live wallet map");
includes(agentSettingsModal, "sharedVault={sharedVault}", "agent settings modal passes shared vault");
includes(agentSettingsModal, "const shouldShowHivemindosModelsSetup = hivemindosModelsSelected", "agent settings modal always renders the HivemindOS Models panel inline while the provider is selected");
assert.ok(!agentSettingsModal.includes("hivemindosModelsSetupOpen"), "agent settings modal has no separate open/close setup state for HivemindOS Models");
includes(agentSettingsModal, "hivemindosModelsCreateBlocked", "agent settings modal create gate");
includes(agentSettingsModal, "selectHivemindosModelsProvider", "agent settings modal provider select handler");
includes(agentSettingsModal, "applyHivemindosModelsSetupProfile", "agent settings modal setup profile apply");
includes(agentSettingsModal, "creditAccountId", "agent settings modal preserves hosted credit account id");
includes(agentSettingsModal, "fundingMode", "agent settings modal preserves HivemindOS Models funding mode");
includes(agentSettingsModal, "lastCreditBalanceLabel", "agent settings modal preserves HivemindOS Models credit balance");
assert.ok(!agentSettingsModal.includes(") : hivemindosModelsSelected ? ("), "agent settings modal should not render completed HivemindOS Models setup solely because the provider is selected");
includes(agentSettingsPrimitives, "moneyValue(config.lastCreditBalanceUsd) > 0", "agent settings readiness requires funded hosted credits");
includes(agentSettingsPrimitives, "if (isFreeHivemindosWalletPaidModel(model)) return true", "agent settings readiness treats the free model as ready");
assert.ok(!agentSettingsPrimitives.includes("config.lastCheckoutSessionId\n      || config.lastCreditBalanceUsd"), "agent settings readiness should not treat an opened checkout session as ready");
includes(walletPanel, "buildLlmFundingSourceMeta", "wallet panel LLM funding source metadata");
includes(walletPanel, "Hosted model credits", "wallet panel card-funded LLM funding source metadata");
includes(walletPanel, "onOpenLlmFundingSource", "wallet panel funding source action");
includes(walletPanel, "WalletSelectModal", "wallet panel funding source selector");
includes(walletPanel, "/api/hivemindos/models/wallet", "wallet panel persists linked funding wallets");
includes(walletsView, "LLM Funding Source", "wallet detail funding source card");

includes(proxyRoute, "loadGovernanceWallet", "wallet-paid proxy");
includes(proxyRoute, "getWalletSecret", "wallet-paid proxy");
includes(proxyRoute, "executeX402Fetch", "wallet-paid proxy");
includes(proxyRoute, "upstreamHivemindosWalletPaidModel", "wallet-paid proxy maps public model aliases to upstream ids");
includes(proxyRoute, "getHivemindosModelCreditToken", "wallet-paid proxy reads prepaid model credit token");
includes(proxyRoute, "X-HivemindOS-Credit-Token", "wallet-paid proxy forwards hosted credit token");
includes(proxyRoute, "fetchWithHostedCredits", "wallet-paid proxy uses stored credits without a local wallet secret");
includes(proxyRoute, "X-HivemindOS-Models-Credit-Balance-Usd", "wallet-paid proxy exposes hosted model credit balance");
includes(proxyRoute, "const upstreamModel = upstreamHivemindosWalletPaidModel(model)", "wallet-paid proxy derives upstream model id");
includes(proxyRoute, "model: upstreamModel", "wallet-paid proxy sends upstream model id");
includes(proxyRoute, "return { ...payload, model }", "wallet-paid proxy preserves public HivemindOS model id in OpenAI-compatible responses");
includes(proxyRoute, "LLM funding is separate from the agent's general wallet provider", "wallet-paid proxy separates model funding from general x402 provider settings");
includes(proxyRoute, "autoPayEnabled: true", "wallet-paid proxy treats the selected funding wallet as approval for model billing");
includes(proxyRoute, "wallet.custodyMode !== \"local\"", "wallet-paid proxy local custody gate");
includes(proxyRoute, "/api/official-paid-agents/${slug}/chat/completions", "wallet-paid proxy official target");
includes(proxyRoute, "stream: false", "wallet-paid proxy settlement mode");
includes(proxyRoute, "isFreeHivemindosWalletPaidModel(model)", "free model branch skips credits and wallets");
includes(proxyRoute, "fetchFreeModelCompletion", "free model rail handler");
includes(proxyRoute, "X-HivemindOS-Free-Device", "free model rail sends the anonymous device id");
includes(proxyRoute, "freeModelChatCompletionsUrl", "free model rail targets the hosted free-models surface");
assert.ok(!proxyRoute.includes("wallet.provider !== \"x402\""), "wallet-paid proxy should not require the selected LLM funding wallet to be the general x402 provider");

assert.ok(!/payTo\s*[:=]/.test(proxyRoute), "wallet-paid proxy must not accept or set client-side payTo");
assert.ok(!/facilitator\s*[:=]/i.test(proxyRoute), "wallet-paid proxy must not accept or set client-side facilitator config");
assert.ok(!proxyRoute.includes("agentId.startsWith(\"user:\") ? false"), "wallet-paid proxy should not disable explicit personal-wallet model funding solely by user-wallet id");

includes(x402Executor, "timeoutMs?: number", "x402 executor");
includes(x402Executor, "skipPaymentDiscovery?: boolean", "x402 executor prepaid bypass");
includes(x402Executor, "responseHeaders: Record<string, string>", "x402 executor exposes selected response headers");
includes(x402Executor, "if (input.skipPaymentDiscovery)", "x402 executor avoids x402 wrapper for prepaid token calls");
includes(x402Executor, "AbortSignal.timeout(input.timeoutMs ?? 60_000)", "x402 executor timeout override");

includes(creditVault, "hivemindos-model-credit-vault.json", "credit token vault path");
includes(creditVault, "aes-256-gcm", "credit token vault encryption");
includes(creditVault, "storeHivemindosModelCreditToken", "credit token vault stores tokens");
includes(creditVault, "getHivemindosModelCreditToken", "credit token vault reads tokens");

includes(creditRoute, "storeHivemindosModelCreditToken", "model credits route persists hosted credit token");
includes(creditRoute, "getHivemindosModelCreditToken", "model credits route reads hosted credit token");
includes(creditRoute, "method === \"card\"", "model credits route supports card checkout funding");
includes(creditRoute, "creditAccountId", "model credits route accepts hosted credit account ids");
includes(creditRoute, "executeX402Fetch", "model credits route signs official top-up");
includes(creditRoute, "MODEL_CREDIT_TOP_UP_CAP_USD", "model credits route uses explicit top-up cap");
includes(creditRoute, "approvalRequiredOverUsd: 0", "model credits route treats top-up click as model-credit approval");
includes(creditRoute, "/api/official-paid-agents/${slug}/credits/top-up", "model credits route calls official top-up endpoint");
includes(creditRoute, "/api/official-paid-agents/${slug}/credits/checkout", "model credits route calls official card checkout endpoint");
includes(creditRoute, "/api/official-paid-agents/${slug}/credits/balance", "model credits route calls official balance endpoint");
includes(creditRoute, "officialPaidAgentCheckoutReturnUrl(\"success\", slug)", "model credits route uses hosted success return URL");
includes(creditRoute, "officialPaidAgentCheckoutReturnUrl(\"cancel\", slug)", "model credits route uses hosted cancel return URL");
assert.ok(!creditRoute.includes("creditToken,"), "model credits route should not return the hosted bearer token to the client as a bare field");

includes(chatBillingTypes, "export type ChatResponseBilling", "chat billing metadata type");
includes(chatBillingTypes, "normalizeChatResponseBilling", "chat billing metadata normalizer");
includes(runtimeSessionStore, "billing?: ChatResponseBilling", "runtime session persists response billing");
includes(runtimeSessionStore, "updateRuntimeChatSessionLastAssistantBilling", "runtime session can update streamed assistant billing");
includes(dashboardTypes, "billing?: ChatResponseBilling", "dashboard chat messages include response billing");
includes(dashboardApp, "normalizeChatResponseBilling(message.billing)", "dashboard session hydration preserves response billing");
includes(dashboardStorage, "billing: normalizeChatResponseBilling(message.billing)", "dashboard storage preserves response billing");
includes(statusChatInputController, "attachBillingToActiveAssistant", "live chat stream applies response billing");
includes(messageThread, "responseBillingText(message.billing)", "chat thread renders response billing");
includes(chatExchangeStyles, "fr-chat-response-billing", "chat billing subtle footer style");

includes(paidAgentCloudClient, "proxyOfficialPaidAgentCreditTopUpRequest", "official paid-agent proxy top-up helper");
includes(paidAgentCloudClient, "proxyOfficialPaidAgentCreditCheckoutRequest", "official paid-agent proxy checkout helper");
includes(paidAgentCloudClient, "proxyOfficialPaidAgentCreditBalanceRequest", "official paid-agent proxy balance helper");
includes(paidAgentCloudClient, "officialPaidAgentCheckoutReturnUrl", "official paid-agent client builds checkout return URLs");
includes(paidAgentCloudClient, "models\", \"credits\", \"return", "official paid-agent checkout return URL path");
includes(paidAgentCloudClient, "x-hivemindos-credit-token", "official paid-agent proxy forwards credit token header");
includes(paidAgentCloudClient, "x-hivemindos-credit-balance-usd", "official paid-agent proxy exposes credit balance header");
includes(paidAgentCloudClient, "fetchOfficialPaidAgentModelList", "official paid-agent client lists gateway models");
includes(paidAgentCloudClient, "freeModelChatCompletionsUrl", "official paid-agent client resolves the free-models surface");
includes(paidAgentCloudClient, "FREE_MODELS_BASE_URL_ENV", "free-models base override env");
includes(officialCreditTopUpRoute, "proxyOfficialPaidAgentCreditTopUpRequest", "official credit top-up route");
includes(officialCreditCheckoutRoute, "proxyOfficialPaidAgentCreditCheckoutRequest", "official credit checkout route");
includes(officialCreditBalanceRoute, "proxyOfficialPaidAgentCreditBalanceRequest", "official credit balance route");

includes(tauriCargo, "tauri-plugin-deep-link", "Tauri desktop enables the deep-link plugin");
includes(tauriConfig, "\"schemes\": [\"hivemindos\"]", "Tauri desktop registers the hivemindos URL scheme");
includes(tauriLib, "tauri_plugin_deep_link::init()", "Tauri desktop initializes deep linking");
includes(tauriLib, "setup_deep_links(_app)", "Tauri desktop wires deep link setup");
includes(tauriDesktopNavigation, "hivemindos:models-credits-return", "Tauri desktop emits model credit return events");
includes(tauriDesktopNavigation, "url.scheme() != \"hivemindos\"", "Tauri desktop handles the hivemindos scheme");
includes(tauriDesktopNavigation, "get_current()", "Tauri desktop handles cold-start deep link URLs");

includes(safeProcessEnv, "replace(/\\0/g, \"\")", "safe process env strips null bytes");
includes(safeProcessEnv, "ENV_KEY_PATTERN", "safe process env validates keys");
includes(chatRuntimeRoute, "sanitizeProcessEnv()", "chat runtime sanitizes inherited env");
includes(chatRuntimeRoute, "env: lmStudioCliEnv()", "chat runtime uses sanitized LM Studio env");
includes(runtimeIntegrations, "sanitizeProcessEnv", "runtime integrations sanitize child process env");

includes(contextIndex, "tool-schema:hivemindos-wallet-paid-models", "capability index");
includes(contextIndex, "hivemindos-models", "capability index provider slug");

console.log("wallet-paid HivemindOS Models contract checks passed");
