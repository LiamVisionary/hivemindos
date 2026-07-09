import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AgentProfile, AgentRuntime, RuntimeCapabilities } from "@/lib/types/agent-runtime";
import { MODEL_PROVIDER_GATEWAYS } from "@/lib/config/model-provider-gateways";
import { HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER } from "@/lib/config/hivemindos-wallet-paid-models";
import { RUNTIME_CAPABILITIES } from "@/lib/types/agent-runtime";
import { getRuntimeAdapter } from "@/lib/services/runtime-adapters/registry";
import { discoverLmStudioProviderModels, localModelHubStatus, localOpenAIProviderProfile, localRuntimeSetupStatus, runLmStudioAction } from "@/lib/services/runtime-adapters/openai-compatible";
import type { LocalModelDownloadJob, LocalModelHardwareSnapshot, LocalModelInstallCatalogStatus, LocalOpenAICompatibleServer, LocalRuntimeSetupStatus } from "@/lib/config/local-model-install-catalog";
import { bankrLlmAccessStatus, bankrLlmModelOptions, isBankrLlmLowCreditError, listBankrLlmModels } from "@/lib/services/bankr-llm";
import {
  hivemindosWalletPaidModelOptions,
} from "@/lib/services/hivemindos-wallet-paid-models";
import {
  readHiveComputeMarketplaceStatus,
} from "@/lib/services/hive-compute-marketplace";
import { HIVE_COMPUTE_PROVIDER_SLUG } from "@/lib/config/hive-compute-marketplace";
import { mergeRuntimeSessions, previewSessionText } from "@/lib/services/runtime-session-utils";
import { sanitizeProcessEnv } from "@/lib/utils/safe-process-env";
import { startXaiOAuthLogin } from "@/lib/services/xai-oauth";
import type { RuntimeModelSelection } from "./runtime-adapters/types";

const execFileAsync = promisify(execFile);
const HERMES_HOME = join(homedir(), ".hermes");
const HERMES_AGENT_DIR = join(HERMES_HOME, "hermes-agent");
const HERMES_PYTHON = join(HERMES_AGENT_DIR, "venv", "bin", "python");
const HERMES_DB = join(HERMES_HOME, "state.db");
const HIVE_ENV = join(homedir(), ".hivemindos", ".env");
const OPENCLAW_CONFIG = join(homedir(), ".openclaw", "openclaw.json");
const OPENCLAW_AGENTS = join(homedir(), ".openclaw", "agents");
const RUN_LOG_ROOT = join(homedir(), ".hivemindos", "runtime-runs");

export type RuntimeIntegrationKey =
  | "sessionSearch"
  | "backgroundTasks"
  | "xSearch"
  | "socialPosting"
  | "imageGeneration"
  | "ttsGeneration"
  | "musicGeneration"
  | "sfxGeneration"
  | "model3dGeneration"
  | "videoGeneration"
  | "codexRuntime"
  | "kanbanDecompose";

export type RuntimeIntegrationStatus = {
  runtime: AgentRuntime;
  capabilities: RuntimeCapabilities;
  integrations: Record<RuntimeIntegrationKey, {
    supported: boolean;
    enabled: boolean;
    detail: string;
  }>;
  diagnostics: string[];
  /** Present when Queen Bee voice turns are bypassing this agent's configured
   *  model (runtime turn failing → the OpenAI fallback model answering). */
  queenVoiceBrain?: import("@/lib/services/queen-bee/voice-brain-status").QueenVoiceBrainStatus;
  modelSelection?: RuntimeModelSelection;
  providerStatus?: {
    usePod?: {
      tokenEnvName?: string;
      tokenPresent?: boolean;
      tokenSource?: string;
      depositAddress?: string;
      depositCode?: string;
      dashboardUrl?: string;
      balanceRemaining?: string;
      route?: string;
      checkedAt?: string;
      status?: string;
      message?: string;
      httpStatus?: number;
      modelCount?: number;
    };
    venice?: {
      authMode?: string;
      walletVaultId?: string;
      walletAddress?: string;
      walletNetwork?: string;
      apiKeyEnvName?: string;
      keyPresent?: boolean;
      balanceUsd?: string;
      diemBalanceUsd?: string;
      minimumTopUpUsd?: string;
      suggestedTopUpUsd?: string;
      checkedAt?: string;
      status?: string;
      message?: string;
      httpStatus?: number;
      modelCount?: number;
    };
    bankr?: {
      creditsBalanceUsd?: number | null;
      balanceLabel?: string;
      clubActive?: boolean | null;
      lowCredits?: boolean;
      checkedAt?: string;
      error?: string;
      modelError?: string;
    };
    lmStudio?: {
      baseUrl?: string;
      models?: Array<{
        key: string;
        displayName?: string;
        type?: "llm" | "embedding" | string;
        loaded?: boolean;
        loadedInstanceIds?: string[];
        maxContextLength?: number;
        paramsString?: string | null;
        sizeBytes?: number | null;
        format?: string | null;
        remote?: boolean;
        source?: "lm-studio" | "lm-link" | "openai-server";
        sourceLabel?: string;
        serverId?: string;
        baseUrl?: string;
        chatPath?: string;
        statusPath?: string;
        canLoad?: boolean;
        canUnload?: boolean;
      }>;
      servers?: LocalOpenAICompatibleServer[];
      catalog?: LocalModelInstallCatalogStatus[];
      downloads?: LocalModelDownloadJob[];
      hardware?: LocalModelHardwareSnapshot;
      setup?: LocalRuntimeSetupStatus;
      error?: string;
      checkedAt?: string;
    };
    hivemindosModels?: {
      status?: string;
      message?: string;
      modelCount?: number;
      checkedAt?: string;
    };
    hiveCompute?: {
      status?: string;
      message?: string;
      modelCount?: number;
      checkedAt?: string;
      gatewayConfigured?: boolean;
      workerInstalled?: boolean;
      workerReady?: boolean;
      liveWorkers?: number;
      liveModels?: string[];
      keyRelayModels?: string[];
      fallbackConfigured?: boolean;
      pendingJobs?: number;
      capacityLabel?: string;
      capacityTone?: "live" | "fallback" | "empty";
    };
  };
};

export type RuntimeSessionSearchResult = {
  id: string;
  runtime: AgentRuntime;
  title: string;
  source?: string;
  model?: string | null;
  startedAt?: string;
  updatedAt?: string;
  excerpt: string;
  path?: string;
};

type HermesSessionRow = {
  id: string;
  source: string;
  model: string | null;
  title: string | null;
  started_at: number;
  updated_at: number | null;
  system_prompt: string | null;
  excerpt: string | null;
};

/**
 * Short TTL memo for the expensive, agent-independent halves of integration
 * status (hermes CLI sweep, LM Studio inventory). The status route is hit
 * once per agent — the phone warms every fleet agent at launch and the
 * desktop modal re-reads on every open — and without this each request
 * re-spawns CLIs and re-hits provider APIs for a catalog that's identical
 * across agents on the same machine. Failures are never cached, and the
 * per-agent overlay (current selection, enabled tools) stays uncached.
 */
const CATALOG_CACHE_TTL_MS = 60_000;
const catalogCache = new Map<string, { at: number; value: Promise<unknown> }>();

function catalogMemo<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = catalogCache.get(key);
  if (hit && Date.now() - hit.at < CATALOG_CACHE_TTL_MS) return hit.value as Promise<T>;
  const value = compute();
  catalogCache.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (catalogCache.get(key)?.value === value) catalogCache.delete(key);
  });
  return value;
}

export async function getRuntimeIntegrationStatus(runtime: AgentRuntime, agent?: AgentProfile): Promise<RuntimeIntegrationStatus> {
  const adapter = getRuntimeAdapter(runtime);
  const capabilities = { ...(RUNTIME_CAPABILITIES[runtime] ?? adapter?.capabilities ?? {}), ...(agent?.runtimeCapabilities ?? {}) };
  if (runtime !== "hermes") {
    let modelSelection: RuntimeModelSelection | undefined;
    let providerStatus: RuntimeIntegrationStatus["providerStatus"] | undefined;
    const diagnostics: string[] = [];
    if (adapter?.getStatus && agent) {
      try {
        const status = await adapter.getStatus(agent, {});
        if (status && typeof status === "object" && "modelSelection" in status) {
          modelSelection = (status as { modelSelection?: RuntimeModelSelection }).modelSelection;
        }
        if (status && typeof status === "object" && "providerStatus" in status) {
          providerStatus = (status as { providerStatus?: RuntimeIntegrationStatus["providerStatus"] }).providerStatus;
        }
        if (status && typeof status === "object" && "diagnostics" in status) {
          const statusDiagnostics = (status as { diagnostics?: unknown }).diagnostics;
          if (Array.isArray(statusDiagnostics)) {
            diagnostics.push(...statusDiagnostics.filter((item): item is string => typeof item === "string"));
          }
        }
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : `${adapter.label} status check failed.`);
      }
    }
    ({ modelSelection, providerStatus } = await augmentGatewayModelProviders(modelSelection, diagnostics, agent, providerStatus));
    return {
      runtime,
      capabilities,
      modelSelection,
      providerStatus,
      integrations: integrationDefaults(capabilities),
      diagnostics,
    };
  }

  // Agent-independent: CLI spawns + config read + model inventory — memoized
  // briefly so a burst of per-agent status requests does the sweep once.
  // Cached diagnostics ride along; copied below so per-request pushes don't
  // mutate the cached array.
  const hermesBase = await catalogMemo("hermes-base", async () => {
    const sweepDiagnostics: string[] = [];
    const [version, tools, config, baseModelSelection] = await Promise.all([
      runHermes(["--version"]).catch((error) => {
        sweepDiagnostics.push(error instanceof Error ? error.message : "Hermes version check failed.");
        return "";
      }),
      runHermes(["tools", "list"]).catch(() => ""),
      readFile(join(HERMES_HOME, "config.yaml"), "utf8").catch(() => ""),
      getHermesModelSelection().catch((error) => {
        sweepDiagnostics.push(error instanceof Error ? error.message : "Hermes model inventory failed.");
        return undefined;
      }),
    ]);
    return { version, tools, config, baseModelSelection, diagnostics: sweepDiagnostics };
  });
  const { version, tools, config, baseModelSelection } = hermesBase;
  const diagnostics: string[] = [...hermesBase.diagnostics];
  const { modelSelection, providerStatus } = await augmentGatewayModelProviders(baseModelSelection, diagnostics, agent);
  const toolEnabled = (name: string) => new RegExp(`✓\\s+enabled\\s+${escapeRegExp(name)}\\b`).test(tools);
  const codexConfigured = /provider:\s*openai-codex\b|codex_app_server|codex-runtime/i.test(config);
  const kanbanAuto = /auto_decompose:\s*true/i.test(config);
  if (version.trim()) diagnostics.push(version.trim());

  return {
    runtime,
    capabilities,
    modelSelection,
    providerStatus,
    integrations: {
      sessionSearch: {
        supported: true,
        enabled: existsSync(HERMES_DB),
        detail: existsSync(HERMES_DB) ? "Hermes session store is readable." : "Hermes session store was not found.",
      },
      backgroundTasks: {
        supported: true,
        enabled: Boolean(version.trim()),
        detail: version.trim() ? "Run Hermes tasks in the background while chat stays available." : "Hermes CLI was not found.",
      },
      xSearch: {
        supported: true,
        enabled: toolEnabled("x_search"),
        detail: toolEnabled("x_search") ? "x_search is enabled for CLI." : "Enable x_search after xAI OAuth or XAI_API_KEY is configured.",
      },
      socialPosting: {
        supported: false,
        enabled: false,
        detail: "Hermes exposes X search natively here; posting should remain a skill/plugin action.",
      },
      imageGeneration: {
        supported: true,
        enabled: toolEnabled("image_gen"),
        detail: toolEnabled("image_gen") ? "image_generate is enabled for CLI." : "Enable image_gen before asking Hermes to create images.",
      },
      ttsGeneration: {
        supported: false,
        enabled: false,
        detail: "tts_gen is reserved for future runtime speech-generation support.",
      },
      musicGeneration: {
        supported: false,
        enabled: false,
        detail: "music-gen is reserved for future runtime music-generation support.",
      },
      sfxGeneration: {
        supported: false,
        enabled: false,
        detail: "sfx_gen is reserved for future runtime sound-effect generation support.",
      },
      model3dGeneration: {
        supported: false,
        enabled: false,
        detail: "3d_gen is reserved for future runtime 3D-generation support.",
      },
      videoGeneration: {
        supported: true,
        enabled: toolEnabled("video_gen"),
        detail: toolEnabled("video_gen") ? "video_generate is enabled for CLI." : "Enable video_gen before asking Hermes to create videos.",
      },
      codexRuntime: {
        supported: true,
        enabled: codexConfigured,
        detail: codexConfigured ? "Codex/OpenAI path is present in Hermes config." : "Use Hermes Codex auth/runtime setup before routing coding work through Codex.",
      },
      kanbanDecompose: {
        supported: true,
        enabled: kanbanAuto,
        detail: kanbanAuto ? "Hermes auto_decompose is on." : "Hermes can decompose Kanban triage tasks manually.",
      },
    },
    diagnostics,
  };
}

async function augmentGatewayModelProviders(
  modelSelection: RuntimeModelSelection | undefined,
  diagnostics: string[],
  agent?: AgentProfile,
  providerStatus?: RuntimeIntegrationStatus["providerStatus"],
) {
  if (!agent) return { modelSelection, providerStatus };
  const bankrGateway = MODEL_PROVIDER_GATEWAYS.bankr;
  const lmStudioGateway = MODEL_PROVIDER_GATEWAYS["lm-studio"];
  const walletPaidGateway = MODEL_PROVIDER_GATEWAYS[HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER];
  // Run the independent gateway probes concurrently: Bankr model discovery +
  // Bankr access status (network) and LM Studio discovery (`lms ls`/REST,
  // memoized per resolved endpoint) no longer serialize, so the settings status
  // sweep waits the slowest probe instead of their sum.
  const lmStudioProfile = localOpenAIProviderProfile(agent);
  const [bankr, bankrAccess, lmStudio, hiveCompute] = await Promise.all([
    listBankrLlmModels(agent).catch((error) => ({
      models: [],
      error: error instanceof Error ? error.message : "Bankr LLM model discovery failed.",
    })),
    bankrLlmAccessStatus().catch((error) => ({
      clubActive: null,
      creditsBalanceUsd: null,
      error: error instanceof Error ? error.message : "Bankr access check failed.",
    })),
    catalogMemo(
      `lm-studio::${lmStudioProfile.gatewayUrl ?? ""}::${lmStudioProfile.token ?? ""}`,
      () => discoverLmStudioProviderModels(lmStudioProfile),
    ).catch((error) => ({
      runtimeProfile: lmStudioProfile,
      lmStudioModels: [],
      servers: [],
      modelDiscoveryError: error instanceof Error ? error.message : "Local model discovery failed.",
      lmStudioModelSource: "",
      models: [],
    })),
    readHiveComputeMarketplaceStatus().catch((error) => ({
      error: error instanceof Error ? error.message : "Hive Compute status failed.",
      models: [],
      routing: { ready: false, message: "Hive Compute status failed.", chatPath: "/api/hive-compute/chat/completions" },
      gateway: { configured: false },
      workerModule: { installed: false },
      earning: { ready: false },
    })),
  ]);
  const lmStudioSetup = await localRuntimeSetupStatus(lmStudioProfile).catch(() => undefined);
  if (bankr.error) diagnostics.push(`Bankr LLM models unavailable: ${bankr.error}`);
  if (bankrAccess.error) diagnostics.push(`Bankr access status unavailable: ${bankrAccess.error}`);
  if (lmStudio.modelDiscoveryError) diagnostics.push(`Local model discovery unavailable: ${lmStudio.modelDiscoveryError}`);
  if ("error" in hiveCompute && hiveCompute.error) diagnostics.push(`Hive Compute unavailable: ${hiveCompute.error}`);
  const providers = (modelSelection?.providers ?? []).filter((provider) => provider.slug !== HIVE_COMPUTE_PROVIDER_SLUG);
  const lmStudioModels = lmStudio.models.length
    ? lmStudio.models
    : agent.provider === "lm-studio" && agent.model?.trim()
      ? [agent.model.trim()]
      : [];
  const lmStudioProvider = {
    slug: "lm-studio",
    name: lmStudioGateway.name,
    models: lmStudioModels.map((id) => {
      const model = lmStudio.lmStudioModels.find((item) => item.key === id);
      return model
        ? {
          id,
          name: model.displayName,
          subtitle: model.source === "openai-server" ? "Serving" : model.loaded ? "Loaded" : model.remote ? "Available" : "Downloaded",
          group: model.paramsString || undefined,
          badge: model.source === "openai-server" ? "Server" : model.remote ? "LM Link" : "Local",
        }
        : { id };
    }),
    totalModels: lmStudioModels.length,
    isCurrent: agent.provider === "lm-studio",
    isUserDefined: true,
    source: lmStudio.lmStudioModelSource || `${lmStudioGateway.hermes?.baseUrl || "http://127.0.0.1:1234/v1"}/models`,
  };
  const lmStudioIndex = providers.findIndex((provider) => provider.slug === "lm-studio");
  if (lmStudioIndex >= 0) providers[lmStudioIndex] = { ...providers[lmStudioIndex], ...lmStudioProvider };
  else providers.push(lmStudioProvider);
  const bankrModels = bankrLlmModelOptions(bankr.models, bankr.error, bankrAccess);
  const bankrProvider = {
    slug: "bankr",
    name: bankrGateway.name,
    models: bankrModels,
    totalModels: bankrModels.length,
    isCurrent: agent.provider === "bankr",
    isUserDefined: true,
    source: `${bankrGateway.hermes?.baseUrl || "https://llm.bankr.bot/v1"}/models`,
  };
  const existingIndex = providers.findIndex((provider) => provider.slug === "bankr");
  if (existingIndex >= 0) providers[existingIndex] = { ...providers[existingIndex], ...bankrProvider };
  else providers.push(bankrProvider);
  const walletPaidModels = hivemindosWalletPaidModelOptions();
  const walletPaidProvider = {
    slug: walletPaidGateway.slug,
    name: walletPaidGateway.name,
    models: walletPaidModels,
    totalModels: walletPaidModels.length,
    isCurrent: agent.provider === HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
    isUserDefined: false,
    source: "/api/hivemindos/models/models",
  };
  const walletPaidIndex = providers.findIndex((provider) => provider.slug === HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER);
  if (walletPaidIndex >= 0) providers[walletPaidIndex] = { ...providers[walletPaidIndex], ...walletPaidProvider };
  else providers.push(walletPaidProvider);
  const nextProviderStatus = {
    ...providerStatus,
    bankr: {
      creditsBalanceUsd: bankrAccess.creditsBalanceUsd,
      balanceLabel: bankrAccess.creditsBalanceUsd === null ? undefined : `$${bankrAccess.creditsBalanceUsd.toFixed(2)}`,
      clubActive: bankrAccess.clubActive,
      lowCredits: bankrAccess.creditsBalanceUsd === 0 || (bankrAccess.creditsBalanceUsd === null && isBankrLlmLowCreditError(bankr.error)),
      checkedAt: new Date().toISOString(),
      error: bankrAccess.error || undefined,
      modelError: bankr.error || undefined,
    },
    lmStudio: {
      baseUrl: lmStudio.runtimeProfile.gatewayUrl?.trim().replace(/\/+$/, ""),
      models: lmStudio.lmStudioModels,
      servers: lmStudio.servers,
      ...localModelHubStatus(lmStudio.lmStudioModels),
      setup: lmStudioSetup,
      error: lmStudio.modelDiscoveryError || undefined,
      checkedAt: new Date().toISOString(),
    },
    hivemindosModels: {
      status: "ready",
      message: "Free Swarm Sovereign Scout by default; hosted credits or an x402 wallet unlock wallet-paid routes.",
      modelCount: walletPaidModels.length,
      checkedAt: new Date().toISOString(),
    },
    hiveCompute: {
      status: !("error" in hiveCompute) && hiveCompute.routing.ready ? "ready" : "setup",
      message: "error" in hiveCompute ? hiveCompute.error : hiveCompute.routing.message,
      modelCount: !("error" in hiveCompute) ? (hiveCompute.gateway.models?.count ?? 0) : 0,
      checkedAt: new Date().toISOString(),
      gatewayConfigured: !("error" in hiveCompute) && hiveCompute.gateway.configured,
      workerInstalled: !("error" in hiveCompute) && hiveCompute.workerModule.installed,
      workerReady: !("error" in hiveCompute) && hiveCompute.earning.ready,
      liveWorkers: !("error" in hiveCompute) ? hiveCompute.gateway.capacity?.liveWorkers : undefined,
      liveModels: !("error" in hiveCompute) ? hiveCompute.gateway.capacity?.liveModels : undefined,
      keyRelayModels: !("error" in hiveCompute) ? hiveCompute.gateway.capacity?.keyRelayModels : undefined,
      fallbackConfigured: !("error" in hiveCompute) ? hiveCompute.gateway.capacity?.fallbackConfigured : undefined,
      pendingJobs: !("error" in hiveCompute) ? hiveCompute.gateway.capacity?.pendingJobs : undefined,
      capacityLabel: !("error" in hiveCompute) ? hiveCompute.gateway.capacity?.statusLabel : undefined,
      capacityTone: !("error" in hiveCompute) ? hiveCompute.gateway.capacity?.statusTone : undefined,
    },
  };
  return {
    modelSelection: {
      provider: modelSelection?.provider || agent.provider || "",
      model: modelSelection?.model || agent.model || "",
      providers,
    },
    providerStatus: nextProviderStatus,
  };
}

export async function searchRuntimeSessions(runtime: AgentRuntime, query: string, limit = 20): Promise<RuntimeSessionSearchResult[]> {
  if (runtime === "hermes") return searchHermesSessions(query, limit);
  if (runtime === "openclaw") return searchOpenClawSessions(query, limit);
  return [];
}

export async function runRuntimeIntegrationAction(runtime: AgentRuntime, action: string, input: Record<string, unknown> = {}, agent?: AgentProfile) {
  if ((action === "load-model" || action === "unload-model" || action === "download-model" || action === "cancel-download" || action === "install-local-runtime" || action === "start-local-runtime" || action === "smoke-test-local-model") && agent?.provider === "lm-studio") {
    const result = await runLmStudioAction(agent, action, input);
    catalogCache.clear();
    return result;
  }
  if (runtime === "openclaw" && action === "set-model") {
    const provider = String(input.provider ?? "").trim();
    const model = String(input.model ?? "").trim();
    if (!provider || !model) return { ok: false, error: "Provider and model are required." };
    if (provider === "hive-fusion") return { ok: false, error: "Hive Fusion is a HivemindOS-native compound model and cannot be set as a CLI runtime model." };
    await setOpenClawModel(provider, model);
    return { ok: true, message: `OpenClaw default model set to ${provider}/${model}.` };
  }
  if (runtime !== "hermes") {
    const adapter = getRuntimeAdapter(runtime);
    if (adapter?.runIntegrationAction) {
      return adapter.runIntegrationAction(agent, action, input, {});
    }
    return { ok: false, error: `${runtime} does not expose this dashboard integration action yet.` };
  }
  if (action === "enable-tool") {
    const tool = String(input.tool ?? "");
    if (!["x_search", "video_gen"].includes(tool)) return { ok: false, error: "Unsupported Hermes tool." };
    await runHermes(["tools", "enable", tool], 20_000);
    return { ok: true, message: `Enabled Hermes ${tool}.` };
  }
  if (action === "disable-tool") {
    const tool = String(input.tool ?? "");
    if (!["x_search", "video_gen"].includes(tool)) return { ok: false, error: "Unsupported Hermes tool." };
    await runHermes(["tools", "disable", tool], 20_000);
    return { ok: true, message: `Disabled Hermes ${tool}.` };
  }
  if (action === "xai-login") {
    const profileEnv = hermesProfileEnv(agent);
    const { authorizeUrl } = await startXaiOAuthLogin({
      hermesHomes: profileEnv?.HERMES_HOME ? [profileEnv.HERMES_HOME] : undefined,
    });
    return {
      ok: true,
      authorizeUrl,
      statusEndpoint: "/api/xai-oauth",
      message: "Open the xAI sign-in page in your browser to connect Grok.",
    };
  }
  if (action === "hermes-update") {
    const output = await runHermes(["update"], 300_000);
    return { ok: true, message: "Hermes update completed.", output };
  }
  if (action === "set-model") {
    const provider = String(input.provider ?? "").trim();
    const model = String(input.model ?? "").trim();
    if (!provider || !model) return { ok: false, error: "Provider and model are required." };
    if (provider === "hive-fusion") return { ok: false, error: "Hive Fusion is a HivemindOS-native compound model and cannot be set as a CLI runtime model." };
    // The shared gateway default in ~/.hermes/config.yaml is owned by the
    // gateway, never by the app. Model picks are agent-scoped: agents with
    // their own profile home get model.default in that profile's config.yaml,
    // and every hermes chat also passes the model per-run via `-m/--provider`.
    const profileEnv = hermesProfileEnv(agent);
    // Venice x402 wallet mode can't be reached with a bearer key — Hermes must
    // route through the collector's local signing proxy, which injects the
    // SIWX header. Point the provider's base_url there with no key_env.
    const veniceProxyBase = provider === "venice" ? veniceWalletProxyBase(agent) : null;
    const gateway = MODEL_PROVIDER_GATEWAYS[provider];
    if (gateway && !gateway.hermes) {
      // Dashboard-internal gateways (hivemindos-models: custom wallet-agent
      // headers against the local app origin) cannot be expressed as a hermes
      // provider block — writing one anyway creates a base_url-less entry the
      // CLI rejects with "Unknown provider". Dashboard chat executes these
      // server-side (isHivemindosWalletPaidModelProfile in stream-http-runtime),
      // so record NOTHING in the hermes config and say where the model runs.
      return {
        ok: true,
        message: `${provider}/${model} is served by HivemindOS itself for ${agent?.name || "this agent"} — dashboard chats use it directly; no hermes CLI config was changed. Runs driven through the hermes CLI outside the dashboard keep the CLI's own default model.`,
      };
    }
    if (gateway?.hermes) {
      await addHermesProvider(provider, model, profileEnv, veniceProxyBase ? { base_url: veniceProxyBase, key_env: "" } : undefined);
    } else await addHermesModel(provider, model, undefined, profileEnv);
    if (profileEnv) {
      await setHermesProfileModel(provider, model, profileEnv);
      return { ok: true, message: `Hermes model set to ${provider}/${model} for ${agent?.name || "this agent"} only. Gateway default unchanged.` };
    }
    return { ok: true, message: `Hermes model ${provider}/${model} registered for ${agent?.name || "this agent"}; chats pass it per-session. Gateway default unchanged.` };
  }
  if (action === "provider-setup-options") {
    const providers = await getHermesProviderSetupOptions();
    return { ok: true, providers };
  }
  if (action === "add-provider") {
    const provider = String(input.provider ?? "").trim();
    const model = String(input.model ?? "").trim();
    if (!provider || !model) return { ok: false, error: "Provider and model are required." };
    await addHermesProvider(provider, model);
    return { ok: true, provider, model, message: `Added Hermes provider ${provider} with ${model}.` };
  }
  if (action === "add-model") {
    const provider = String(input.provider ?? "").trim();
    const model = String(input.model ?? "").trim();
    const contextLength = Number(input.contextLength ?? 0);
    if (!provider || !model) return { ok: false, error: "Provider and model are required." };
    await addHermesModel(provider, model, Number.isFinite(contextLength) && contextLength > 0 ? contextLength : undefined);
    return { ok: true, message: `Added ${model} to Hermes provider ${provider}.` };
  }
  if (action === "background") {
    const prompt = String(input.prompt ?? "").trim();
    if (!prompt) return { ok: false, error: "Background prompt is required." };
    const id = `hermes-${Date.now().toString(36)}`;
    const logPath = join(RUN_LOG_ROOT, `${id}.log`);
    await mkdir(dirname(logPath), { recursive: true });
    const child = spawn("hermes", ["-z", prompt], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: sanitizeProcessEnv(),
    });
    const write = (chunk: Buffer) => void writeFile(logPath, chunk.toString(), { flag: "a" }).catch(() => undefined);
    child.stdout.on("data", write);
    child.stderr.on("data", write);
    child.unref();
    return { ok: true, id, logPath, message: "Started Hermes background task." };
  }
  if (action === "kanban-decompose") {
    const taskId = String(input.taskId ?? "").trim();
    const args = ["kanban", "decompose", "--json"];
    if (taskId) args.push(taskId);
    else args.push("--all");
    const output = await runHermes(args, 120_000);
    return { ok: true, output };
  }
  return { ok: false, error: `Unsupported Hermes action: ${action}` };
}

function integrationDefaults(capabilities: RuntimeCapabilities, overrides: Partial<Record<RuntimeIntegrationKey, string>> = {}) {
  const keys: RuntimeIntegrationKey[] = ["sessionSearch", "backgroundTasks", "xSearch", "socialPosting", "imageGeneration", "ttsGeneration", "musicGeneration", "sfxGeneration", "model3dGeneration", "videoGeneration", "codexRuntime", "kanbanDecompose"];
  return Object.fromEntries(keys.map((key) => [
    key,
    {
      supported: Boolean(capabilities[key]),
      enabled: Boolean(capabilities[key]),
      detail: overrides[key] ?? (capabilities[key] ? "Supported by this runtime adapter." : "Not exposed by this runtime adapter."),
    },
  ])) as RuntimeIntegrationStatus["integrations"];
}

async function searchHermesSessions(query: string, limit: number) {
  if (!existsSync(HERMES_DB)) return [];
  const q = query.trim();
  const pattern = `%${q.replace(/'/g, "''")}%`;
  const sql = `
    select s.id, s.source, s.model, s.title, s.started_at, coalesce(s.ended_at, s.started_at) as updated_at, s.system_prompt,
      (
        select m.content from messages m
        where m.session_id = s.id and m.content is not null and trim(m.content) != ''
        ${q ? `and lower(m.content) like lower('${pattern}')` : ""}
        order by m.timestamp, m.id
        limit 1
      ) as excerpt
    from sessions s
    ${q ? `where lower(coalesce(s.title, '') || ' ' || coalesce(s.system_prompt, '') || ' ' || s.id) like lower('${pattern}')
      or exists (
        select 1 from messages m
        where m.session_id = s.id and lower(coalesce(m.content, '')) like lower('${pattern}')
      )` : ""}
    order by started_at desc
    limit ${Math.max(1, Math.min(100, limit))};
  `;
  const { stdout } = await execFileAsync("sqlite3", ["-json", HERMES_DB, sql], { timeout: 5_000, maxBuffer: 2_000_000 });
  const rows = JSON.parse(stdout || "[]") as HermesSessionRow[];
  return mergeRuntimeSessions({
    secondary: rows.map((row) => ({
      id: row.id,
      title: row.title || row.id,
      preview: previewSessionText(row.excerpt || row.system_prompt),
      lastActive: toIso(row.updated_at || row.started_at),
      messageCount: 0,
      source: row.source,
      sortTimestamp: Number(row.updated_at || row.started_at || 0),
    })),
  }).map((session) => {
    const row = rows.find((item) => item.id === session.id)!;
    return {
    id: row.id,
    runtime: "hermes" as const,
    title: String(session.title || row.id),
    source: row.source,
    model: row.model,
    startedAt: toIso(row.started_at),
    updatedAt: toIso(row.updated_at || row.started_at),
    excerpt: String(session.preview || row.excerpt || row.system_prompt || "").replace(/\s+/g, " ").slice(0, 280),
    };
  });
}

async function getHermesModelSelection(): Promise<RuntimeModelSelection | undefined> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_AGENT_DIR)) return undefined;
  const script = `
import json
from hermes_cli.config import load_config
from hermes_cli.inventory import build_models_payload, load_picker_context
cfg = load_config()
payload = build_models_payload(load_picker_context(), max_models=200)
configured = {}
model_cfg = cfg.get("model", {})
if isinstance(model_cfg, dict) and model_cfg.get("provider") and model_cfg.get("default"):
    configured[model_cfg.get("provider")] = True
providers = cfg.get("providers", {})
if isinstance(providers, dict):
    for slug, provider_cfg in providers.items():
        if not isinstance(provider_cfg, dict):
            continue
        models = provider_cfg.get("models")
        has_models = (
            bool(models)
            if isinstance(models, (list, dict))
            else bool(provider_cfg.get("model") or provider_cfg.get("default_model"))
        )
        if has_models:
            configured[slug] = True
payload["configured_providers"] = sorted(configured.keys())
print(json.dumps(payload))
`;
  const { stdout } = await execFileAsync(HERMES_PYTHON, ["-c", script], {
    cwd: HERMES_AGENT_DIR,
    env: sanitizeProcessEnv(process.env, { PYTHONPATH: HERMES_AGENT_DIR }),
    timeout: 20_000,
    maxBuffer: 5_000_000,
  });
  const payload = JSON.parse(stdout || "{}") as {
    provider?: string;
    model?: string;
    configured_providers?: string[];
    providers?: Array<{
      slug?: string;
      name?: string;
      models?: Array<string | { id?: string; name?: string }>;
      total_models?: number;
      totalModels?: number;
      is_current?: boolean;
      is_user_defined?: boolean;
      source?: string;
    }>;
  };
  const configuredProviders = new Set(payload.configured_providers ?? []);
  return {
    provider: payload.provider ?? "",
    model: payload.model ?? "",
    providers: (payload.providers ?? [])
      .filter((provider) => provider.slug && configuredProviders.has(provider.slug))
      .map((provider) => ({
        slug: provider.slug ?? "",
        name: provider.name || provider.slug || "Provider",
        models: (provider.models ?? []).map((model) => (
          typeof model === "string" ? { id: model } : { id: model.id ?? "", name: model.name }
        )).filter((model) => model.id),
        totalModels: provider.total_models ?? provider.totalModels ?? provider.models?.length ?? 0,
        isCurrent: provider.is_current,
        isUserDefined: provider.is_user_defined,
        source: provider.source,
      })),
  };
}

/**
 * HERMES_HOME override pointing at the agent's own profile home, or undefined
 * when the agent lives in the shared gateway home. Config writes against the
 * shared home's model default are forbidden — the gateway owns that file.
 */
// Venice x402 wallet-mode agents route through the collector's local signing
// proxy (it injects the SIWX header). The proxy runs on the collector host
// where Hermes also runs, so 127.0.0.1:<collectorPort> is correct regardless
// of how the dashboard reaches the collector. Returns null for api-key mode.
function veniceWalletProxyBase(agent?: AgentProfile): string | null {
  const venice = agent?.venice;
  const vaultId = String(venice?.walletVaultId ?? "").trim();
  if (!vaultId || venice?.authMode === "api-key") return null;
  let port = 8787;
  try {
    const parsed = new URL(String(agent?.telemetryUrl ?? ""));
    if (parsed.port) port = Number(parsed.port);
  } catch {
    // No/invalid telemetry URL → default collector port.
  }
  return `http://127.0.0.1:${port}/venice-x402/${encodeURIComponent(vaultId)}`;
}

function hermesProfileEnv(agent?: AgentProfile): Record<string, string> | undefined {
  const raw = String(agent?.localDataDir ?? "").trim();
  if (!raw) return undefined;
  const dir = raw.replace(/^~(?=$|\/)/, homedir());
  if (!dir || dir === HERMES_HOME) return undefined;
  return { HERMES_HOME: dir };
}

async function setHermesProfileModel(provider: string, model: string, profileEnv: Record<string, string>) {
  const script = `
from hermes_cli.config import load_config, save_config
provider = __PROVIDER__
model = __MODEL__
cfg = load_config()
model_cfg = cfg.get("model", {})
if not isinstance(model_cfg, dict):
    model_cfg = {}
model_cfg["provider"] = provider
model_cfg["default"] = model
model_cfg.pop("context_length", None)
if model_cfg.get("base_url"):
    model_cfg["base_url"] = ""
cfg["model"] = model_cfg
save_config(cfg)
`;
  await runHermesPython(script, { __PROVIDER__: provider, __MODEL__: model }, profileEnv);
}

async function setOpenClawModel(provider: string, model: string) {
  const raw = await readFile(OPENCLAW_CONFIG, "utf8").catch(() => "{}");
  const config = parseJsonObject(raw.replace(/\/\/[^\n]*/g, "")) ?? {};
  const fullModel = `${provider}/${model}`;
  ensureOpenClawProvider(config, provider, model);
  const agents = isRecord(config.agents) ? config.agents : {};
  const list = Array.isArray(agents.list) ? agents.list.filter(isRecord) : [];
  const agent = list.find((item) => item.default === true) ?? list[0];
  if (agent) agent.model = fullModel;
  if (!isRecord(config.agents)) config.agents = agents;
  if (!Array.isArray(agents.list)) agents.list = list;
  setNested(config, "agents.defaults.model.primary", fullModel);
  await mkdir(dirname(OPENCLAW_CONFIG), { recursive: true, mode: 0o700 });
  await writeFile(OPENCLAW_CONFIG, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function ensureOpenClawProvider(config: Record<string, unknown>, provider: string, model: string) {
  const gateway = MODEL_PROVIDER_GATEWAYS[provider]?.hermes;
  if (!gateway) return;
  const providers = isRecord(config.models) && isRecord(config.models.providers)
    ? config.models.providers
    : {};
  const entry = isRecord(providers[provider]) ? providers[provider] : {};
  entry.name = typeof entry.name === "string" && entry.name ? entry.name : gateway.name;
  if (gateway.baseUrl && !entry.base_url) entry.base_url = gateway.baseUrl;
  if (gateway.keyEnv && !entry.key_env) entry.key_env = gateway.keyEnv;
  const models = Array.isArray(entry.models)
    ? entry.models.filter((item) => typeof item === "string") as string[]
    : [];
  entry.models = Array.from(new Set([model, ...gateway.models, ...models].filter(Boolean)));
  providers[provider] = entry;
  if (!isRecord(config.models)) config.models = {};
  (config.models as Record<string, unknown>).providers = providers;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function setNested(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(current[part])) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

async function addHermesModel(provider: string, model: string, contextLength?: number, env?: Record<string, string>) {
  const script = `
from hermes_cli.config import load_config, save_config
provider = __PROVIDER__
model = __MODEL__
context_length = __CONTEXT_LENGTH__
cfg = load_config()
providers = cfg.get("providers")
if not isinstance(providers, dict):
    providers = {}
entry = providers.get(provider)
if not isinstance(entry, dict):
    entry = {"name": provider, "models": {}}
models = entry.get("models")
if isinstance(models, list):
    if model not in models:
        models.append(model)
elif isinstance(models, dict):
    meta = models.get(model)
    if not isinstance(meta, dict):
        meta = {}
    if context_length:
        meta["context_length"] = context_length
    models[model] = meta
else:
    models = {model: {"context_length": context_length} if context_length else {}}
entry["models"] = models
entry.setdefault("default_model", model)
providers[provider] = entry
cfg["providers"] = providers
save_config(cfg)
`;
  await runHermesPython(script, {
    __PROVIDER__: provider,
    __MODEL__: model,
    __CONTEXT_LENGTH__: contextLength ?? 0,
  }, env);
}

async function getHermesProviderSetupOptions() {
  const script = `
import json
from hermes_cli.inventory import build_models_payload, load_picker_context
payload = build_models_payload(
    load_picker_context(),
    include_unconfigured=True,
    picker_hints=True,
    canonical_order=True,
    max_models=24,
)
print(json.dumps(payload.get("providers", [])))
`;
  const stdout = await runHermesPython(script, {});
  const rows = JSON.parse(stdout || "[]") as Array<{
    slug?: string;
    name?: string;
    models?: Array<string | { id?: string; name?: string }>;
    total_models?: number;
    totalModels?: number;
    authenticated?: boolean;
    auth_type?: string;
    key_env?: string;
    warning?: string;
  }>;
  const mapped = rows
    .filter((provider) => provider.slug)
    .map((provider) => ({
      slug: provider.slug ?? "",
      name: provider.name || provider.slug || "Provider",
      models: (provider.models ?? []).map((model) => (
        typeof model === "string" ? { id: model } : { id: model.id ?? "", name: model.name }
      )).filter((model) => model.id),
      totalModels: provider.total_models ?? provider.totalModels ?? provider.models?.length ?? 0,
      authenticated: provider.authenticated,
      authType: provider.auth_type,
      keyEnv: provider.key_env,
      warning: provider.warning,
    }));
  const existing = new Set(mapped.map((provider) => provider.slug));
  const env: Record<string, string | undefined> = await hermesProcessEnv();
  for (const gateway of Object.values(MODEL_PROVIDER_GATEWAYS)) {
    if (existing.has(gateway.slug) || !gateway.hermes) continue;
    const keyEnv = gateway.hermes.keyEnv.trim();
    mapped.push({
      slug: gateway.slug,
      name: gateway.name,
      models: gateway.hermes.models.map((id) => ({ id })),
      totalModels: gateway.hermes.models.length,
      authenticated: keyEnv ? Boolean(env[keyEnv]) : true,
      authType: keyEnv ? "api-key" : "none",
      keyEnv,
      warning: gateway.slug === "usepod"
        ? "UsePod uses a tokenized proxy URL; finish UsePod setup in HivemindOS before using this provider."
        : undefined,
    });
  }
  return mapped;
}

async function addHermesProvider(provider: string, model: string, env?: Record<string, string>, providerOverride?: { base_url?: string; key_env?: string }) {
  const script = `
from hermes_cli.config import load_config, save_config
from hermes_cli.models import provider_model_ids
import json
try:
    from hermes_cli.auth import PROVIDER_REGISTRY
except Exception:
    PROVIDER_REGISTRY = {}
provider = __PROVIDER__
model = __MODEL__
provider_defaults = {
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "models": provider_model_ids("openrouter")[:24],
    },
}
gateway_defaults = json.loads(__GATEWAY_DEFAULTS__)
provider_defaults.update(gateway_defaults)
cfg_def = PROVIDER_REGISTRY.get(provider)
if cfg_def:
    key_envs = list(getattr(cfg_def, "api_key_env_vars", ()) or ())
    defaults = {
        "name": getattr(cfg_def, "name", provider),
        "base_url": getattr(cfg_def, "inference_base_url", "") or "",
        "key_env": key_envs[0] if key_envs else "",
        "models": provider_model_ids(provider)[:24],
    }
else:
    defaults = provider_defaults.get(provider, {"name": provider, "base_url": "", "key_env": "", "models": [model]})
models = list(dict.fromkeys([model] + [item for item in defaults.get("models", []) if item]))
cfg = load_config()
providers = cfg.get("providers")
if not isinstance(providers, dict):
    providers = {}
entry = providers.get(provider)
if not isinstance(entry, dict):
    entry = {}
entry["name"] = entry.get("name") or defaults.get("name") or provider
if defaults.get("base_url") and not entry.get("base_url"):
    entry["base_url"] = defaults["base_url"]
if defaults.get("key_env") and not entry.get("key_env"):
    entry["key_env"] = defaults["key_env"]
entry["default_model"] = model
current_models = entry.get("models")
if isinstance(current_models, dict):
    for item in models:
        current_models.setdefault(item, {})
elif isinstance(current_models, list):
    current_models = list(dict.fromkeys(current_models + models))
else:
    current_models = {item: {} for item in models}
entry["models"] = current_models
providers[provider] = entry
cfg["providers"] = providers
save_config(cfg)
`;
  const gatewayDefaults = Object.fromEntries(Object.entries(MODEL_PROVIDER_GATEWAYS)
    .filter(([, gateway]) => gateway.hermes)
    .map(([slug, gateway]) => [slug, {
      name: gateway.hermes?.name,
      base_url: gateway.hermes?.baseUrl,
      key_env: gateway.hermes?.keyEnv,
      models: gateway.hermes?.models,
    }]));
  // Wallet-mode Venice (and similar) override the base_url to the local signing
  // proxy and clear key_env so Hermes sends no bearer.
  if (providerOverride && gatewayDefaults[provider]) {
    if (typeof providerOverride.base_url === "string") gatewayDefaults[provider].base_url = providerOverride.base_url;
    if (typeof providerOverride.key_env === "string") gatewayDefaults[provider].key_env = providerOverride.key_env;
  }
  await runHermesPython(script, {
    __PROVIDER__: provider,
    __MODEL__: model,
    __GATEWAY_DEFAULTS__: JSON.stringify(gatewayDefaults),
  }, env);
}

async function loadHiveEnv() {
  const raw = await readFile(HIVE_ENV, "utf8").catch(() => "");
  const values: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    value = value.replaceAll("\0", "");
    if (value) values[key] = value;
  }
  return sanitizeProcessEnv({ ...values, ...process.env });
}

async function hermesProcessEnv() {
  return sanitizeProcessEnv(await loadHiveEnv(), {
    PYTHONPATH: HERMES_AGENT_DIR,
  });
}

async function runHermesPython(script: string, values: Record<string, string | number>, env?: Record<string, string>) {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_AGENT_DIR)) throw new Error("Hermes Python runtime was not found.");
  let rendered = script;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(key, JSON.stringify(value));
  }
  const { stdout } = await execFileAsync(HERMES_PYTHON, ["-c", rendered], {
    cwd: HERMES_AGENT_DIR,
    env: sanitizeProcessEnv({ ...(await hermesProcessEnv()), ...(env ?? {}) }),
    timeout: 20_000,
    maxBuffer: 2_000_000,
  });
  return stdout.trim();
}

async function searchOpenClawSessions(query: string, limit: number) {
  const agents = await readdir(OPENCLAW_AGENTS, { withFileTypes: true }).catch(() => []);
  const q = query.trim().toLowerCase();
  const results: RuntimeSessionSearchResult[] = [];
  for (const agent of agents) {
    if (!agent.isDirectory()) continue;
    const sessionsDir = join(OPENCLAW_AGENTS, agent.name, "sessions");
    const files = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !/\.(json|jsonl)$/i.test(file.name)) continue;
      const path = join(sessionsDir, file.name);
      const raw = await readFile(path, "utf8").catch(() => "");
      const text = raw.replace(/\s+/g, " ");
      if (q && !text.toLowerCase().includes(q) && !file.name.toLowerCase().includes(q)) continue;
      results.push({
        id: `${agent.name}:${file.name.replace(/\.(json|jsonl)$/i, "")}`,
        runtime: "openclaw",
        title: `${agent.name} / ${file.name}`,
        source: agent.name,
        excerpt: text.slice(0, 280),
        path,
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

async function runHermes(args: string[], timeout = 10_000) {
  const { stdout, stderr } = await execFileAsync("hermes", args, {
    timeout,
    maxBuffer: 2_000_000,
    env: await loadHiveEnv(),
  });
  return `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
}

function toIso(seconds: number | null | undefined) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
