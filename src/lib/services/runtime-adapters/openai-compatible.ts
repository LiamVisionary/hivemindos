import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { arch, freemem, platform, totalmem } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { HIVEMIND_OS_RUNTIME, type AgentProfile } from "@/lib/types/agent-runtime";
import {
  LOCAL_MODEL_INSTALL_CATALOG,
  lmStudioDownloadArgsForCatalogEntry,
  localModelMatchesCatalogEntry,
  localModelInstallCatalogEntry,
  type LocalModelDownloadJob,
  type LocalModelDownloadState,
  type LocalModelHardwareSnapshot,
  type LocalModelInstallCatalogStatus,
  type LocalOpenAICompatibleServer,
  type LocalOpenAICompatibleServerKind,
  type LocalRuntimeProviderSetupStatus,
  type LocalRuntimeSetupStatus,
} from "@/lib/config/local-model-install-catalog";
import {
  HIVEMINDOS_WALLET_PAID_MODELS_NAME,
} from "@/lib/config/hivemindos-wallet-paid-models";
import { bankrLlmAuthHeaders, isBankrLlmProfile } from "@/lib/services/bankr-llm";
import {
  hivemindosWalletPaidModelOptions,
  isHivemindosWalletPaidModelProfile,
} from "@/lib/services/hivemindos-wallet-paid-models";
import { checkUsePodModels, isUsePodProfile, resolveUsePodRuntimeConfig } from "@/lib/services/usepod";
import { checkVeniceModels, isVeniceProfile, resolveVeniceRuntimeConfig } from "@/lib/services/venice";
import { sanitizeProcessEnv } from "@/lib/utils/safe-process-env";
import type { RuntimeAdapter } from "./types";
import { discoverSieProviderModels, runSieAction, type SieProviderStatus } from "./sie";

const execFileAsync = promisify(execFile);

type OpenAIModelList = {
  data?: Array<{
    id?: string;
    object?: string;
    owned_by?: string;
  }>;
  error?: { message?: string } | string;
};

type LmStudioRawModel = {
  key?: string;
  modelKey?: string;
  display_name?: string;
  displayName?: string;
  type?: string;
  loaded_instances?: Array<{ id?: string }>;
  loadedInstanceIds?: string[];
  max_context_length?: number;
  maxContextLength?: number;
  params_string?: string | null;
  paramsString?: string | null;
  size_bytes?: number | null;
  sizeBytes?: number | null;
  format?: string | null;
  deviceIdentifier?: string | null;
};

type LmStudioModelInventory = {
  models?: LmStudioRawModel[];
  error?: { message?: string } | string;
};

type LmStudioLinkStatus = {
  peers?: Array<{
    deviceIdentifier?: string;
    deviceName?: string;
    loadedModels?: unknown[];
  }>;
};

export type NormalizedLmStudioModel = {
  key: string;
  displayName: string;
  type: string;
  loaded: boolean;
  loadedInstanceIds: string[];
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
};

type LmStudioDownloadJobRecord = {
  job: LocalModelDownloadJob;
  child?: ReturnType<typeof spawn>;
  log: string[];
};

type ModelEndpointProbe = {
  ok: boolean;
  modelCount?: number;
  models?: string[];
  error?: string;
};

const ACTIVE_DOWNLOAD_STATES = new Set<LocalModelDownloadState>(["queued", "downloading"]);
const COMMON_LOCAL_OPENAI_SERVER_PORTS = [1234, 1244, 8000, 8080, 11434];
const lmStudioDownloadJobs = new Map<string, LmStudioDownloadJobRecord>();

function cleanBaseUrl(profile: AgentProfile) {
  return (profile.gatewayUrl || "http://127.0.0.1:1234").trim().replace(/\/+$/, "");
}

function buildRuntimeUrl(profile: AgentProfile, path: string) {
  const base = cleanBaseUrl(profile);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

function errorMessage(data: OpenAIModelList | null, fallback: string) {
  if (typeof data?.error === "string") return data.error;
  return data?.error?.message || fallback;
}

function providerName(profile: AgentProfile) {
  return isUsePodProfile(profile)
    ? "UsePod"
    : isVeniceProfile(profile)
      ? "Venice AI"
    : isBankrLlmProfile(profile)
      ? "Bankr LLM"
      : isHivemindosWalletPaidModelProfile(profile)
        ? HIVEMINDOS_WALLET_PAID_MODELS_NAME
      : profile.provider === "ollama"
        ? "Ollama"
        : profile.provider === "vllm"
          ? "vLLM"
          : profile.provider === "llamacpp"
            ? "llama.cpp"
            : profile.provider === "lm-studio"
              ? "Local"
              : profile.provider === "sie"
                ? "SIE"
              : "OpenAI-compatible";
}

function configuredModelFallback(profile: AgentProfile) {
  const model = profile.model?.trim();
  return model ? [model] : [];
}

function authHeaders(profile: AgentProfile): Record<string, string> {
  return profile.token ? { Authorization: `Bearer ${profile.token}` } : {};
}

export function localOpenAIProviderProfile(profile: AgentProfile): AgentProfile {
  if (profile.runtime === HIVEMIND_OS_RUNTIME) return profile;
  return {
    ...profile,
    runtime: HIVEMIND_OS_RUNTIME,
    gatewayUrl: process.env.NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL ?? "http://127.0.0.1:1234",
    chatPath: "/v1/chat/completions",
    statusPath: "/v1/models",
    provider: "lm-studio",
    token: "",
  };
}

function lmsProcessEnv() {
  return sanitizeProcessEnv(process.env, {
    PATH: [join(homedir(), ".lmstudio", "bin"), process.env.PATH].filter(Boolean).join(delimiter),
  });
}

async function resolveLmsBin() {
  const candidates = [
    join(homedir(), ".lmstudio", "bin", "lms"),
    "/opt/homebrew/bin/lms",
    "/usr/local/bin/lms",
    "lms",
  ];
  for (const candidate of candidates) {
    if (candidate === "lms") return candidate;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next common LM Studio CLI location.
    }
  }
  return "lms";
}

async function execText(command: string, args: string[], timeout = 8_000, env = sanitizeProcessEnv(process.env)) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout,
    maxBuffer: 4_000_000,
    env,
  });
  return [stdout, stderr].map((chunk) => String(chunk || "").trim()).filter(Boolean).join("\n").trim();
}

async function runLmsText(args: string[], timeout = 15_000) {
  return execText(await resolveLmsBin(), args, timeout, lmsProcessEnv());
}

function compactCommandOutput(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" · ");
}

function compactError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  return compactCommandOutput(error.message).slice(0, 280) || fallback;
}

function commandOutputSaysRunning(value: string) {
  if (/\b(not running|not started|stopped|offline|down)\b/i.test(value)) return false;
  return /\b(running|started|listening|ready)\b/i.test(value);
}

function lmStudioInstallCommand(currentPlatform: string = platform()) {
  if (currentPlatform === "win32") return "irm https://lmstudio.ai/install.ps1 | iex";
  if (currentPlatform === "darwin" || currentPlatform === "linux") return "curl -fsSL https://lmstudio.ai/install.sh | bash";
  return "";
}

function ollamaInstallCommand(currentPlatform: string = platform()) {
  return currentPlatform === "linux" ? "curl -fsSL https://ollama.com/install.sh | sh" : "";
}

function serverPortForProfile(profile: AgentProfile) {
  try {
    const url = new URL(cleanBaseUrl(profile));
    return url.port || (url.protocol === "https:" ? "443" : "80");
  } catch {
    return "1234";
  }
}

async function probeOpenAIModelEndpoint(profile: AgentProfile, timeout = 4_000): Promise<ModelEndpointProbe> {
  try {
    const response = await fetch(buildRuntimeUrl(profile, profile.statusPath || "/v1/models"), {
      headers: authHeaders(profile),
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
    const data = await response.json().catch(() => null) as OpenAIModelList | null;
    if (!response.ok) return { ok: false, error: errorMessage(data, `OpenAI endpoint returned ${response.status}`) };
    const models = (data?.data ?? [])
      .map((model) => String(model?.id ?? "").trim())
      .filter(Boolean);
    return { ok: true, modelCount: models.length, models };
  } catch (error) {
    return { ok: false, error: compactError(error, "OpenAI endpoint is not reachable.") };
  }
}

async function waitForOpenAIModelEndpoint(profile: AgentProfile, timeoutMs = 30_000): Promise<ModelEndpointProbe> {
  const started = Date.now();
  let lastProbe: ModelEndpointProbe = { ok: false, error: "OpenAI endpoint is not reachable yet." };
  while (Date.now() - started < timeoutMs) {
    lastProbe = await probeOpenAIModelEndpoint(profile, 4_000);
    if (lastProbe.ok) return lastProbe;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return lastProbe;
}

function baseUrlPort(value: string) {
  try {
    const parsed = new URL(value);
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    return Number.isInteger(port) ? port : undefined;
  } catch {
    return undefined;
  }
}

function serverKindForPort(port?: number): LocalOpenAICompatibleServerKind {
  if (port === 1234) return "lm-studio";
  if (port === 1244) return "llama-cpp";
  if (port === 11434) return "ollama";
  if (port === 8000 || port === 8080) return "vllm";
  return "openai-compatible";
}

function serverLabelForKind(kind: LocalOpenAICompatibleServerKind, port?: number) {
  if (kind === "lm-studio") return "LM Studio server";
  if (kind === "llama-cpp") return "llama.cpp server";
  if (kind === "ollama") return "Ollama server";
  if (kind === "vllm") return "vLLM server";
  return port ? `OpenAI server :${port}` : "OpenAI-compatible server";
}

function localOpenAIServerCandidates(profile: AgentProfile) {
  const candidates = new Set<string>();
  const add = (value?: string) => {
    const base = value?.trim().replace(/\/+$/, "");
    if (base) candidates.add(base);
  };
  add(cleanBaseUrl(profile));
  add(process.env.LOCAL_OPENAI_BASE_URL);
  add(process.env.NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL);
  for (const port of COMMON_LOCAL_OPENAI_SERVER_PORTS) add(`http://127.0.0.1:${port}`);
  return [...candidates];
}

function modelTypeForOpenAIModelId(id: string) {
  return /(?:^|[-_/])embed(?:ding)?(?:[-_/]|$)|text-embedding/i.test(id) ? "embedding" : "llm";
}

async function discoverOpenAICompatibleServer(baseUrl: string): Promise<LocalOpenAICompatibleServer | null> {
  const port = baseUrlPort(baseUrl);
  const statusPath = "/v1/models";
  const chatPath = "/v1/chat/completions";
  const kind = serverKindForPort(port);
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(`${baseUrl}${statusPath}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    const data = await response.json().catch(() => null) as OpenAIModelList | null;
    if (!response.ok) {
      return {
        id: `${kind}:${baseUrl}`,
        label: serverLabelForKind(kind, port),
        kind,
        baseUrl,
        chatPath,
        statusPath,
        port,
        reachable: false,
        models: [],
        error: errorMessage(data, `OpenAI server returned ${response.status}`),
        checkedAt,
      };
    }
    const models = (data?.data ?? [])
      .map((model) => String(model?.id ?? "").trim())
      .filter(Boolean)
      .map((id) => ({
        id,
        displayName: id,
        type: modelTypeForOpenAIModelId(id),
        loaded: true,
      }));
    if (!models.length) return null;
    return {
      id: `${kind}:${baseUrl}`,
      label: serverLabelForKind(kind, port),
      kind,
      baseUrl,
      chatPath,
      statusPath,
      port,
      reachable: true,
      models,
      checkedAt,
    };
  } catch {
    return null;
  }
}

export async function discoverLocalOpenAICompatibleServers(profile: AgentProfile): Promise<LocalOpenAICompatibleServer[]> {
  const servers = (await Promise.all(
    localOpenAIServerCandidates(profile).map((baseUrl) => discoverOpenAICompatibleServer(baseUrl)),
  )).filter((server): server is LocalOpenAICompatibleServer => Boolean(server?.reachable && server.models.length));
  const byBase = new Map<string, LocalOpenAICompatibleServer>();
  for (const server of servers) {
    if (!byBase.has(server.baseUrl)) byBase.set(server.baseUrl, server);
  }
  return [...byBase.values()];
}

function compactIsoNow() {
  return new Date().toISOString();
}

function cloneDownloadJob(job: LocalModelDownloadJob): LocalModelDownloadJob {
  return { ...job };
}

function patchDownloadJob(jobId: string, patch: Partial<LocalModelDownloadJob>) {
  const record = lmStudioDownloadJobs.get(jobId);
  if (!record) return;
  record.job = {
    ...record.job,
    ...patch,
    updatedAt: compactIsoNow(),
  };
}

function snapshotLmStudioDownloadJobs(): LocalModelDownloadJob[] {
  return [...lmStudioDownloadJobs.values()]
    .map((record) => cloneDownloadJob(record.job))
    .sort((left, right) => String(right.startedAt || "").localeCompare(String(left.startedAt || "")))
    .slice(0, 12);
}

function activeDownloadForModel(modelId: string) {
  return [...lmStudioDownloadJobs.values()].find(
    (record) => record.job.modelId === modelId && ACTIVE_DOWNLOAD_STATES.has(record.job.state),
  );
}

function parseDownloadProgress(message: string) {
  const match = message.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return undefined;
  const progressPercent = Number(match[1]);
  return Number.isFinite(progressPercent) ? Math.max(0, Math.min(100, progressPercent)) : undefined;
}

function rememberDownloadOutput(jobId: string, chunk: unknown) {
  const record = lmStudioDownloadJobs.get(jobId);
  if (!record) return;
  const text = String(chunk ?? "");
  const lines = text.split(/\r?\n|\r/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return;
  record.log.push(...lines);
  if (record.log.length > 20) record.log.splice(0, record.log.length - 20);
  const message = lines.at(-1) || "";
  patchDownloadJob(jobId, {
    message,
    progressPercent: parseDownloadProgress(message) ?? record.job.progressPercent,
  });
}

function latestDownloadMessage(record?: LmStudioDownloadJobRecord) {
  return record?.log.at(-1) || record?.job.message;
}

export function localModelHardwareSnapshot(): LocalModelHardwareSnapshot {
  const bytesToGb = (value: number) => Math.round((value / 1_000_000_000) * 10) / 10;
  const currentPlatform = platform();
  const currentArch = arch();
  return {
    totalRamGb: bytesToGb(totalmem()),
    freeRamGb: bytesToGb(freemem()),
    platform: currentPlatform,
    arch: currentArch,
    appleSilicon: currentPlatform === "darwin" && currentArch === "arm64",
  };
}

export function annotateLocalModelInstallCatalog(
  models: NormalizedLmStudioModel[],
): LocalModelInstallCatalogStatus[] {
  return LOCAL_MODEL_INSTALL_CATALOG.map((entry) => {
    const installed = models.find((model) => model.source !== "openai-server" && !model.remote && localModelMatchesCatalogEntry(model, entry));
    return {
      ...entry,
      installed: Boolean(installed),
      loaded: Boolean(installed?.loaded),
      installedModelKey: installed?.key,
      loadedInstanceIds: installed?.loadedInstanceIds,
    };
  });
}

export function localModelHubStatus(models: NormalizedLmStudioModel[]) {
  return {
    catalog: annotateLocalModelInstallCatalog(models),
    downloads: snapshotLmStudioDownloadJobs(),
    hardware: localModelHardwareSnapshot(),
  };
}

async function detectLmStudioSetup(profile: AgentProfile, hardware: LocalModelHardwareSnapshot): Promise<LocalRuntimeProviderSetupStatus> {
  const installCommand = lmStudioInstallCommand(hardware.platform);
  let present = false;
  let version = "";
  let cliError = "";
  try {
    version = compactCommandOutput(await runLmsText(["--version"], 5_000));
    present = true;
  } catch (error) {
    cliError = compactError(error, "LM Studio CLI is not installed.");
  }

  let daemonRunning = false;
  let serverRunning = false;
  let daemonDetail = "";
  let serverDetail = "";
  if (present) {
    try {
      daemonDetail = compactCommandOutput(await runLmsText(["daemon", "status"], 5_000));
      daemonRunning = commandOutputSaysRunning(daemonDetail);
    } catch (error) {
      daemonDetail = compactError(error, "LM Studio daemon status is unavailable.");
    }
    try {
      serverDetail = compactCommandOutput(await runLmsText(["server", "status"], 5_000));
      serverRunning = commandOutputSaysRunning(serverDetail);
    } catch (error) {
      serverDetail = compactError(error, "LM Studio server status is unavailable.");
    }
  }

  const endpointProbe = await probeOpenAIModelEndpoint(profile);
  const ready = endpointProbe.ok;
  const detail = ready
    ? `OpenAI endpoint is ready${typeof endpointProbe.modelCount === "number" ? ` with ${endpointProbe.modelCount} model${endpointProbe.modelCount === 1 ? "" : "s"}` : ""}.`
    : present
      ? daemonRunning
        ? "LM Studio is installed and the daemon is running, but the local OpenAI server is stopped."
        : "LM Studio is installed, but the daemon/server are not ready."
      : "LM Studio is not installed yet.";
  const status: LocalRuntimeProviderSetupStatus = {
    id: "lm-studio",
    label: "LM Studio",
    present,
    ready,
    running: ready || serverRunning,
    version: version || undefined,
    detail,
    installable: Boolean(installCommand),
    installCommand: installCommand || undefined,
    manualInstallUrl: "https://lmstudio.ai/download",
  };
  const error = ready
    ? ""
    : present
      ? endpointProbe.error || serverDetail || daemonDetail
      : cliError;
  if (error) status.error = error;
  return status;
}

async function detectOllamaSetup(hardware: LocalModelHardwareSnapshot): Promise<LocalRuntimeProviderSetupStatus> {
  let present = false;
  let version = "";
  let cliError = "";
  try {
    version = compactCommandOutput(await execText("ollama", ["--version"], 5_000));
    present = true;
  } catch (error) {
    cliError = compactError(error, "Ollama CLI is not installed.");
  }
  let ready = false;
  let apiError = "";
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (response.ok) {
      ready = true;
      present = true;
    } else {
      apiError = `Ollama API returned ${response.status}.`;
    }
  } catch (error) {
    apiError = compactError(error, "Ollama API is not reachable.");
  }
  const installCommand = ollamaInstallCommand(hardware.platform);
  return {
    id: "ollama",
    label: "Ollama",
    present,
    ready,
    running: ready,
    version: version || undefined,
    detail: ready
      ? "Ollama API is reachable."
      : present
        ? "Ollama is installed, but its local API is not reachable."
        : "Ollama is not installed.",
    error: ready ? undefined : present ? apiError : cliError,
    installable: Boolean(installCommand),
    installCommand: installCommand || undefined,
    manualInstallUrl: "https://ollama.com/download",
  };
}

async function detectLlamaCppSetup(): Promise<LocalRuntimeProviderSetupStatus> {
  let present = false;
  let version = "";
  let cliError = "";
  try {
    version = compactCommandOutput(await execText("llama-server", ["--version"], 5_000));
    present = true;
  } catch (error) {
    cliError = compactError(error, "llama.cpp server CLI is not installed.");
  }
  return {
    id: "llama-cpp",
    label: "llama.cpp",
    present,
    ready: false,
    running: false,
    version: version || undefined,
    detail: present
      ? "llama-server is installed; start an OpenAI-compatible server to use it as a custom Local endpoint."
      : "llama.cpp is not installed.",
    error: present ? undefined : cliError,
    installable: false,
    manualInstallUrl: "https://github.com/ggml-org/llama.cpp",
  };
}

export async function localRuntimeSetupStatus(profile: AgentProfile): Promise<LocalRuntimeSetupStatus> {
  const runtimeProfile = localOpenAIProviderProfile(profile);
  const hardware = localModelHardwareSnapshot();
  const [lmStudio, ollama, llamaCpp] = await Promise.all([
    detectLmStudioSetup(runtimeProfile, hardware),
    detectOllamaSetup(hardware),
    detectLlamaCppSetup(),
  ]);
  return {
    recommendedProvider: "lm-studio",
    recommendedLabel: "LM Studio",
    recommendationReason: "Best fit for this Local provider because HivemindOS can install GGUF models, load/unload them, start the OpenAI-compatible server, and control LM Link through lms.",
    ready: lmStudio.ready,
    installable: Boolean(lmStudio.installable),
    installCommand: lmStudio.installCommand,
    manualInstallUrl: lmStudio.manualInstallUrl,
    serverUrl: cleanBaseUrl(runtimeProfile),
    hardware,
    providers: [lmStudio, ollama, llamaCpp],
    checkedAt: new Date().toISOString(),
  };
}

async function startLmStudioModelDownload(input: Record<string, unknown>) {
  const modelId = String(input.modelId ?? input.model ?? "").trim();
  const entry = localModelInstallCatalogEntry(modelId);
  if (!entry) return { ok: false, error: "Choose a model from the local install catalog." };
  const active = activeDownloadForModel(entry.id);
  if (active) {
    return {
      ok: true,
      message: `${entry.displayName} is already ${active.job.state}.`,
      job: cloneDownloadJob(active.job),
    };
  }
  const now = compactIsoNow();
  const jobId = `${entry.id}-${Date.now()}`;
  const job: LocalModelDownloadJob = {
    jobId,
    modelId: entry.id,
    displayName: entry.displayName,
    state: "queued",
    message: "Queued in LM Studio",
    startedAt: now,
    updatedAt: now,
  };
  lmStudioDownloadJobs.set(jobId, { job, log: [] });
  const child = spawn(await resolveLmsBin(), lmStudioDownloadArgsForCatalogEntry(entry), {
    stdio: ["ignore", "pipe", "pipe"],
    env: lmsProcessEnv(),
  });
  const record = lmStudioDownloadJobs.get(jobId);
  if (record) record.child = child;
  patchDownloadJob(jobId, { state: "downloading", message: "Downloading with LM Studio" });
  child.stdout?.on("data", (chunk) => rememberDownloadOutput(jobId, chunk));
  child.stderr?.on("data", (chunk) => rememberDownloadOutput(jobId, chunk));
  child.on("error", (error) => {
    patchDownloadJob(jobId, {
      state: "failed",
      error: error instanceof Error ? error.message : "LM Studio download failed.",
      message: "Download failed",
    });
  });
  child.on("close", (code, signal) => {
    const current = lmStudioDownloadJobs.get(jobId);
    if (current?.job.state === "cancelled") return;
    if (code === 0) {
      patchDownloadJob(jobId, {
        state: "completed",
        progressPercent: 100,
        message: "Download complete",
      });
      return;
    }
    patchDownloadJob(jobId, {
      state: "failed",
      error: latestDownloadMessage(current) || `LM Studio exited with ${code ?? signal ?? "an error"}.`,
      message: "Download failed",
    });
  });
  return {
    ok: true,
    message: `Started downloading ${entry.displayName} in LM Studio.`,
    job: cloneDownloadJob(lmStudioDownloadJobs.get(jobId)?.job ?? job),
  };
}

async function cancelLmStudioModelDownload(input: Record<string, unknown>) {
  const jobId = String(input.jobId ?? "").trim();
  const modelId = String(input.modelId ?? input.model ?? "").trim();
  const record = jobId
    ? lmStudioDownloadJobs.get(jobId)
    : [...lmStudioDownloadJobs.values()].find(
      (candidate) => candidate.job.modelId === modelId && ACTIVE_DOWNLOAD_STATES.has(candidate.job.state),
    );
  if (!record) return { ok: false, error: "No active local model download was found." };
  record.child?.kill("SIGTERM");
  patchDownloadJob(record.job.jobId, {
    state: "cancelled",
    message: "Download cancelled",
  });
  return {
    ok: true,
    message: `Cancelled ${record.job.displayName || record.job.modelId}.`,
    job: cloneDownloadJob(record.job),
  };
}

async function runLmsJson(args: string[], timeout = 15_000) {
  const { stdout } = await execFileAsync(await resolveLmsBin(), args, {
    timeout,
    maxBuffer: 8_000_000,
    env: lmsProcessEnv(),
  });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as unknown;
}

export type LmStudioLinkMapEntry = {
  remote: boolean;
  deviceIdentifier: string | null;
  hostDeviceName: string | null;
};

/**
 * Classifies each LM Studio model as local-on-disk vs served from a linked
 * device (LM Link) and resolves the linked device's friendly name, using
 * `lms ls --json` (`deviceIdentifier`) + `lms link status --json` (peer names).
 * The OpenAI-compatible `/v1/models` REST endpoint flattens LM Link models as
 * local, so the CLI is the only reliable source. Degrades to empty maps when
 * LM Studio / the `lms` CLI is unavailable so callers stay non-fatal.
 */
export async function readLocalLmStudioLinkMap(): Promise<{
  selfDeviceName: string | null;
  byKey: Map<string, LmStudioLinkMapEntry>;
}> {
  const byKey = new Map<string, LmStudioLinkMapEntry>();
  try {
    const [rawModels, linkStatus] = await Promise.all([
      runLmsJson(["ls", "--json"]).catch(() => []),
      runLmsJson(["link", "status", "--json"]).catch(() => null),
    ]);
    const peerNames = new Map<string, string>();
    let selfDeviceName: string | null = null;
    if (linkStatus && typeof linkStatus === "object") {
      const status = linkStatus as { deviceName?: string; peers?: Array<{ deviceIdentifier?: string; deviceName?: string }> };
      selfDeviceName = typeof status.deviceName === "string" ? status.deviceName : null;
      for (const peer of status.peers ?? []) {
        if (peer?.deviceIdentifier && peer.deviceName) peerNames.set(String(peer.deviceIdentifier), String(peer.deviceName));
      }
    }
    for (const model of Array.isArray(rawModels) ? rawModels : []) {
      if (!model || typeof model !== "object") continue;
      const row = model as { key?: string; modelKey?: string; deviceIdentifier?: string | null };
      const key = (row.key || row.modelKey || "").trim();
      if (!key) continue;
      const deviceIdentifier = row.deviceIdentifier ? String(row.deviceIdentifier) : null;
      const entry: LmStudioLinkMapEntry = {
        remote: Boolean(deviceIdentifier),
        deviceIdentifier,
        hostDeviceName: deviceIdentifier ? peerNames.get(deviceIdentifier) ?? null : null,
      };
      // Prefer a local copy when the same key is both on-disk and shared via LM Link.
      const existing = byKey.get(key);
      if (!existing || (existing.remote && !entry.remote)) byKey.set(key, entry);
    }
    return { selfDeviceName, byKey };
  } catch {
    return { selfDeviceName: null, byKey };
  }
}

async function fetchModels(profile: AgentProfile): Promise<OpenAIModelList> {
  if (isHivemindosWalletPaidModelProfile(profile)) {
    return {
      data: hivemindosWalletPaidModelOptions().map((model) => ({
        id: model.id,
        object: "model",
        owned_by: "hivemindos",
      })),
    };
  }
  const usePodConfig = await resolveUsePodRuntimeConfig(profile);
  const veniceConfig = !usePodConfig ? await resolveVeniceRuntimeConfig(profile) : null;
  const runtimeProfile = usePodConfig
    ? { ...profile, gatewayUrl: usePodConfig.baseUrl, statusPath: usePodConfig.statusPath, token: "" }
    : veniceConfig
      ? { ...profile, gatewayUrl: veniceConfig.baseUrl, statusPath: veniceConfig.statusPath, token: "" }
      : profile;
  const bankrHeaders = isBankrLlmProfile(runtimeProfile) ? await bankrLlmAuthHeaders(runtimeProfile) : {};
  if (isBankrLlmProfile(runtimeProfile) && !bankrHeaders["X-API-Key"]) {
    throw new Error("BANKR_LLM_KEY is required to list Bankr LLM models.");
  }
  const response = await fetch(buildRuntimeUrl(runtimeProfile, runtimeProfile.statusPath || "/v1/models"), {
    headers: {
      ...authHeaders(runtimeProfile),
      ...(veniceConfig?.headers ?? {}),
      ...bankrHeaders,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json().catch(() => null) as OpenAIModelList | null;
  if (!response.ok) throw new Error(errorMessage(data, `OpenAI-compatible runtime returned ${response.status}`));
  return data ?? {};
}

async function fetchLmStudioInventory(profile: AgentProfile): Promise<LmStudioModelInventory> {
  const response = await fetch(buildRuntimeUrl(profile, "/api/v1/models"), {
    headers: authHeaders(profile),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json().catch(() => null) as LmStudioModelInventory | null;
  if (!response.ok) throw new Error(errorMessage(data as OpenAIModelList | null, `LM Studio REST API returned ${response.status}`));
  return data ?? {};
}

function normalizeLmStudioModels(payload: LmStudioModelInventory | LmStudioRawModel[]): NormalizedLmStudioModel[] {
  const rawModels = Array.isArray(payload) ? payload : payload.models ?? [];
  const normalized = rawModels
    .map((model): NormalizedLmStudioModel | null => {
      const key = model.key?.trim() || model.modelKey?.trim() || "";
      if (!key) return null;
      const loadedInstanceIds = Array.isArray(model.loaded_instances)
        ? model.loaded_instances
          .map((instance) => instance.id?.trim())
          .filter((id): id is string => Boolean(id))
        : (model.loadedInstanceIds ?? []).map((id) => id.trim()).filter(Boolean);
      const maxContextLength = Number(model.max_context_length ?? model.maxContextLength);
      const sizeBytes = Number(model.size_bytes ?? model.sizeBytes);
      const source: NormalizedLmStudioModel["source"] = model.deviceIdentifier ? "lm-link" : "lm-studio";
      return {
        key,
        displayName: model.display_name || model.displayName || key,
        type: model.type || "llm",
        loaded: loadedInstanceIds.length > 0,
        loadedInstanceIds,
        maxContextLength: Number.isFinite(maxContextLength) ? maxContextLength : undefined,
        paramsString: model.params_string ?? model.paramsString ?? null,
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
        format: model.format,
        // LM Studio's CLI inventory tags models shared from a linked device
        // (LM Link) with a non-null deviceIdentifier; local on-disk models have
        // null. The REST inventory omits the field, so models stay local there.
        remote: Boolean(model.deviceIdentifier),
        source,
        sourceLabel: model.deviceIdentifier ? "LM Link" : "LM Studio",
        canLoad: true,
        canUnload: true,
      };
    })
    .filter((model): model is NonNullable<typeof model> => Boolean(model));
  // Collapse duplicate keys, preferring the local copy when the same model is
  // both on this disk and shared from a linked device, so it loads locally.
  const byKey = new Map<string, (typeof normalized)[number]>();
  for (const model of normalized) {
    const existing = byKey.get(model.key);
    if (!existing || (existing.remote && !model.remote)) byKey.set(model.key, model);
  }
  return [...byKey.values()];
}

function markLoadedLmStudioModels(models: NormalizedLmStudioModel[], loadedModels: unknown[]) {
  const loadedRefs = new Set(loadedModels.flatMap((model) => {
    if (typeof model === "string") return [model.trim()].filter(Boolean);
    if (!model || typeof model !== "object") return [];
    const row = model as Record<string, unknown>;
    return [row.identifier, row.modelKey, row.key, row.path, row.displayName]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }));
  return models.map((model) => (
    loadedRefs.has(model.key) || loadedRefs.has(model.displayName)
      ? { ...model, loaded: true, loadedInstanceIds: model.loadedInstanceIds.length ? model.loadedInstanceIds : [model.key] }
      : model
  ));
}

function loadedModelsFromLmLinkStatus(payload: unknown) {
  const status = payload as LmStudioLinkStatus | null;
  return (status?.peers ?? []).flatMap((peer) => peer.loadedModels ?? []);
}

async function readLmStudioCliInventory() {
  const [models, loaded, linkStatus] = await Promise.all([
    runLmsJson(["ls", "--json"]),
    runLmsJson(["ps", "--json"]).catch(() => []),
    runLmsJson(["link", "status", "--json"]).catch(() => null),
  ]);
  return markLoadedLmStudioModels(
    normalizeLmStudioModels(Array.isArray(models) ? models as LmStudioRawModel[] : []),
    [
      ...(Array.isArray(loaded) ? loaded : []),
      ...loadedModelsFromLmLinkStatus(linkStatus),
    ],
  );
}

async function runLmStudioCliAction(action: string, input: Record<string, unknown>) {
  if (action === "download-model") {
    return startLmStudioModelDownload(input);
  }
  if (action === "cancel-download") {
    return cancelLmStudioModelDownload(input);
  }
  if (action === "load-model") {
    const model = String(input.model ?? "").trim();
    if (!model) return { ok: false, error: "Model is required." };
    const contextLength = Number(input.contextLength ?? 0);
    const args = ["load", "--identifier", model, "--yes"];
    if (Number.isFinite(contextLength) && contextLength > 0) args.push("--context-length", String(contextLength));
    args.push(model);
    await execFileAsync(await resolveLmsBin(), args, {
      timeout: 180_000,
      maxBuffer: 2_000_000,
      env: lmsProcessEnv(),
    });
    return { ok: true, message: `Loaded ${model} in LM Studio.` };
  }
  if (action === "unload-model") {
    const instanceId = String(input.instanceId ?? input.model ?? "").trim();
    if (!instanceId) return { ok: false, error: "Loaded model instance is required." };
    await execFileAsync(await resolveLmsBin(), ["unload", instanceId], {
      timeout: 60_000,
      maxBuffer: 2_000_000,
      env: lmsProcessEnv(),
    });
    return { ok: true, message: `Unloaded ${instanceId} from LM Studio.` };
  }
  return { ok: false, error: `Unsupported LM Studio action: ${action}` };
}

async function runLmStudioRestAction(profile: AgentProfile, action: string, input: Record<string, unknown>) {
  if (action === "load-model") {
    const model = String(input.model ?? "").trim();
    if (!model) return { ok: false, error: "Model is required." };
    const contextLength = Number(input.contextLength ?? 0);
    const response = await fetch(buildRuntimeUrl(profile, "/api/v1/models/load"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(profile) },
      body: JSON.stringify({
        model,
        ...(Number.isFinite(contextLength) && contextLength > 0 ? { context_length: contextLength } : {}),
        echo_load_config: true,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const data = await response.json().catch(() => null) as { error?: { message?: string } | string; instance_id?: string } | null;
    if (!response.ok) return { ok: false, error: errorMessage(data as OpenAIModelList | null, `LM Studio returned ${response.status}`) };
    return { ok: true, message: `Loaded ${data?.instance_id || model} in LM Studio.` };
  }
  if (action === "unload-model") {
    const instanceId = String(input.instanceId ?? input.model ?? "").trim();
    if (!instanceId) return { ok: false, error: "Loaded model instance is required." };
    const response = await fetch(buildRuntimeUrl(profile, "/api/v1/models/unload"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(profile) },
      body: JSON.stringify({ instance_id: instanceId }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await response.json().catch(() => null) as { error?: { message?: string } | string; instance_id?: string } | null;
    if (!response.ok) return { ok: false, error: errorMessage(data as OpenAIModelList | null, `LM Studio returned ${response.status}`) };
    return { ok: true, message: `Unloaded ${data?.instance_id || instanceId} from LM Studio.` };
  }
  return { ok: false, error: `Unsupported LM Studio action: ${action}` };
}

async function installLmStudioRuntime() {
  const installCommand = lmStudioInstallCommand();
  if (!installCommand) {
    return {
      ok: false,
      error: "This platform does not have an in-app LM Studio installer yet. Use https://lmstudio.ai/download, then refresh Local models.",
    };
  }
  if (platform() === "win32") {
    await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", installCommand], {
      timeout: 900_000,
      maxBuffer: 8_000_000,
      env: sanitizeProcessEnv(process.env),
    });
  } else {
    await execFileAsync("bash", ["-lc", installCommand], {
      timeout: 900_000,
      maxBuffer: 8_000_000,
      env: sanitizeProcessEnv(process.env),
    });
  }
  return {
    ok: true,
    message: "LM Studio installed. Start the Local server before loading a model.",
  };
}

/**
 * Bring up the LM Studio daemon and its OpenAI-compatible HTTP server on
 * `port`, bound to loopback. Opening the LM Studio app does NOT start this
 * server, so any caller that needs `/v1/models` to answer must run this first.
 *
 * Kept free of `AgentProfile` so non-agent surfaces (Hive Compute hosting) can
 * reuse it. Rejects if the `lms` CLI is missing or the server refuses to start.
 */
export async function startLmStudioServerOnPort(port: string) {
  const lmsBin = await resolveLmsBin();
  await execFileAsync(lmsBin, ["daemon", "up"], {
    timeout: 120_000,
    maxBuffer: 2_000_000,
    env: lmsProcessEnv(),
  }).catch(() => undefined);
  await execFileAsync(lmsBin, ["server", "start", "--port", port, "--bind", "127.0.0.1"], {
    timeout: 120_000,
    maxBuffer: 2_000_000,
    env: lmsProcessEnv(),
  });
}

async function startLmStudioRuntime(profile: AgentProfile) {
  const runtimeProfile = localOpenAIProviderProfile(profile);
  const setup = await localRuntimeSetupStatus(runtimeProfile);
  const lmStudio = setup.providers.find((provider) => provider.id === "lm-studio");
  if (!lmStudio?.present) {
    return { ok: false, error: "Install LM Studio before starting the Local server." };
  }
  let startError = "";
  await startLmStudioServerOnPort(serverPortForProfile(runtimeProfile)).catch((error) => {
    startError = compactError(error, "LM Studio server start failed.");
  });
  const probe = await waitForOpenAIModelEndpoint(runtimeProfile, 30_000);
  if (probe.ok) {
    return {
      ok: true,
      message: `Local server is ready at ${cleanBaseUrl(runtimeProfile)}${typeof probe.modelCount === "number" ? ` with ${probe.modelCount} model${probe.modelCount === 1 ? "" : "s"}` : ""}.`,
    };
  }
  return {
    ok: false,
    error: `LM Studio server did not become ready at ${cleanBaseUrl(runtimeProfile)}. ${probe.error || startError || ""}`.trim(),
  };
}

async function verifyLmStudioLoad(profile: AgentProfile, model: string, loadMessage: string) {
  const started = await startLmStudioRuntime(profile);
  if (started.ok === false) return started;
  const probe = await waitForOpenAIModelEndpoint(localOpenAIProviderProfile(profile), 20_000);
  if (!probe.ok) {
    return { ok: false, error: `Loaded ${model}, but the OpenAI endpoint could not be verified. ${probe.error || ""}`.trim() };
  }
  return {
    ok: true,
    message: `${loadMessage} ${started.message || "Local server verified."}`,
  };
}

async function smokeTestLmStudioModel(profile: AgentProfile, input: Record<string, unknown>) {
  const runtimeProfile = localOpenAIProviderProfile(profile);
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim().replace(/\/+$/, "") : "";
  const testProfile = baseUrl
    ? {
      ...runtimeProfile,
      gatewayUrl: baseUrl,
      chatPath: typeof input.chatPath === "string" && input.chatPath.trim() ? input.chatPath.trim() : "/v1/chat/completions",
      statusPath: typeof input.statusPath === "string" && input.statusPath.trim() ? input.statusPath.trim() : "/v1/models",
    }
    : runtimeProfile;
  const model = String(input.model ?? runtimeProfile.model ?? "").trim();
  if (!model) return { ok: false, error: "Choose a loaded model before running a smoke test." };
  if (input.startServer !== false) {
    const server = await startLmStudioRuntime(runtimeProfile);
    if (server.ok === false) return server;
  } else {
    const probe = await probeOpenAIModelEndpoint(testProfile, 4_000);
    if (!probe.ok) return { ok: false, error: probe.error || "Local model server is not reachable." };
  }
  const response = await fetch(buildRuntimeUrl(testProfile, testProfile.chatPath || "/v1/chat/completions"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(testProfile) },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Reply with OK." },
        { role: "user", content: "ping" },
      ],
      max_tokens: 8,
      temperature: 0,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const data = await response.json().catch(() => null) as { error?: { message?: string } | string } | null;
  if (!response.ok) return { ok: false, error: errorMessage(data as OpenAIModelList | null, `Smoke test returned ${response.status}`) };
  return { ok: true, message: `${model} answered the Local smoke test.` };
}

export async function discoverLmStudioProviderModels(profile: AgentProfile) {
  const runtimeProfile = localOpenAIProviderProfile(profile);
  let modelDiscoveryError = "";
  let lmStudioModels: NormalizedLmStudioModel[] = [];
  let lmStudioModelSource = "";
  let servers: LocalOpenAICompatibleServer[] = [];
  try {
    lmStudioModels = await readLmStudioCliInventory();
    if (lmStudioModels.length) lmStudioModelSource = "lms ls --json";
  } catch (error) {
    modelDiscoveryError = error instanceof Error ? error.message : "LM Studio CLI inventory failed.";
  }
  if (!lmStudioModels.length) {
    try {
      lmStudioModels = normalizeLmStudioModels(await fetchLmStudioInventory(runtimeProfile));
      if (lmStudioModels.length) {
        lmStudioModelSource = buildRuntimeUrl(runtimeProfile, "/api/v1/models");
        modelDiscoveryError = "";
      }
    } catch (error) {
      const restError = error instanceof Error ? error.message : "LM Studio REST inventory failed.";
      modelDiscoveryError = modelDiscoveryError ? `${modelDiscoveryError}; ${restError}` : restError;
    }
  }
  // The CLI/REST inventories only list models on this machine's disk. The
  // OpenAI listing also includes models served from linked devices (LM Link),
  // so merge any extra ids as remote entries instead of dropping them.
  try {
    const openAiList = await fetchModels(runtimeProfile);
    const known = new Set(lmStudioModels.map((model) => model.key));
    for (const entry of openAiList.data ?? []) {
      const id = String(entry?.id ?? "").trim();
      if (!id || known.has(id)) continue;
      known.add(id);
      lmStudioModels.push({
        key: id,
        displayName: id,
        type: /embed/i.test(id) ? "embedding" : "llm",
        // Served from a linked device or API passthrough — load state is
        // managed on the owning host, never claimed (or gated) here.
        loaded: false,
        loadedInstanceIds: [],
        remote: true,
      });
    }
  } catch {
    // The OpenAI listing is additive; local inventory already covers offline use.
  }
  try {
    servers = await discoverLocalOpenAICompatibleServers(runtimeProfile);
    const known = new Set(lmStudioModels.map((model) => model.key));
    for (const server of servers) {
      for (const serverModel of server.models) {
        const id = serverModel.id.trim();
        if (!id || known.has(id) || serverModel.type === "embedding") continue;
        known.add(id);
        lmStudioModels.push({
          key: id,
          displayName: serverModel.displayName || id,
          type: serverModel.type || "llm",
          loaded: true,
          loadedInstanceIds: [id],
          paramsString: server.label,
          format: "OpenAI",
          remote: false,
          source: "openai-server",
          sourceLabel: server.label,
          serverId: server.id,
          baseUrl: server.baseUrl,
          chatPath: server.chatPath,
          statusPath: server.statusPath,
          canLoad: false,
          canUnload: false,
        });
      }
    }
  } catch (error) {
    const serverError = error instanceof Error ? error.message : "Local server discovery failed.";
    modelDiscoveryError = modelDiscoveryError ? `${modelDiscoveryError}; ${serverError}` : serverError;
  }
  const llmModels = lmStudioModels.filter((model) => model.type === "llm");
  return {
    runtimeProfile,
    lmStudioModels,
    servers,
    modelDiscoveryError,
    lmStudioModelSource,
    models: llmModels.map((model) => model.key),
  };
}

export async function runLmStudioAction(profile: AgentProfile, action: string, input: Record<string, unknown>) {
  const runtimeProfile = localOpenAIProviderProfile(profile);
  if (action === "install-local-runtime") {
    return installLmStudioRuntime().catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "LM Studio install failed.",
    }));
  }
  if (action === "start-local-runtime") {
    return startLmStudioRuntime(runtimeProfile).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "LM Studio server start failed.",
    }));
  }
  if (action === "smoke-test-local-model") {
    return smokeTestLmStudioModel(runtimeProfile, input).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Local model smoke test failed.",
    }));
  }
  if (action === "download-model" || action === "cancel-download") {
    return runLmStudioCliAction(action, input).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "LM Studio download action failed.",
    }));
  }
  const cliResult = await runLmStudioCliAction(action, input).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "LM Studio CLI action failed.",
  }));
  if (cliResult.ok) {
    if (action === "load-model") return verifyLmStudioLoad(runtimeProfile, String(input.model ?? "").trim(), ("message" in cliResult ? cliResult.message : "") || "Loaded model in LM Studio.");
    return cliResult;
  }
  const restResult = await runLmStudioRestAction(runtimeProfile, action, input).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "LM Studio REST action failed.",
  }));
  if (restResult.ok) {
    if (action === "load-model") return verifyLmStudioLoad(runtimeProfile, String(input.model ?? "").trim(), ("message" in restResult ? restResult.message : "") || "Loaded model in LM Studio.");
    return restResult;
  }
  const cliError = "error" in cliResult ? cliResult.error : "";
  const restError = "error" in restResult ? restResult.error : "";
  return {
    ok: false,
    error: `LM Studio action failed. CLI: ${cliError || "unavailable"} REST: ${restError || "unavailable"}`,
  };
}

export const openAICompatibleAdapter: RuntimeAdapter = {
  runtime: HIVEMIND_OS_RUNTIME,
  label: "HivemindOS",
  kind: "interactive",
  capabilities: {
    status: true,
    chat: true,
    modelSelection: true,
  },
  defaultProfile: {
    gatewayUrl: process.env.NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL ?? "http://127.0.0.1:1234",
    chatPath: "/v1/chat/completions",
    statusPath: "/v1/models",
    provider: "lm-studio",
    model: process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL ?? "",
  },
  async getStatus(profile) {
    const usePodStatus = isUsePodProfile(profile) ? await checkUsePodModels(profile) : null;
    const veniceStatus = !usePodStatus && isVeniceProfile(profile) ? await checkVeniceModels(profile) : null;
    const usePodConfig = !usePodStatus ? await resolveUsePodRuntimeConfig(profile) : null;
    const runtimeProfile = usePodConfig
      ? { ...profile, gatewayUrl: usePodConfig.baseUrl, statusPath: usePodConfig.statusPath, token: "" }
      : veniceStatus
        ? { ...profile, gatewayUrl: "https://api.venice.ai/api/v1", statusPath: "/models", token: "" }
        : profile;
    let modelDiscoveryError = "";
    let modelTelemetryError = "";
    let lmStudioModels: NormalizedLmStudioModel[] = [];
    let sieStatus: SieProviderStatus | undefined;
    let lmStudioModelSource = "";
    let localModelServers: LocalOpenAICompatibleServer[] = [];
    let models = configuredModelFallback(profile);
    if (usePodStatus) {
      models = usePodStatus.models.map((model) => model.id);
    } else if (veniceStatus) {
      models = veniceStatus.models.length ? veniceStatus.models.map((model) => model.id) : configuredModelFallback(profile);
      if (!veniceStatus.ok) modelDiscoveryError = veniceStatus.message;
    } else if (isHivemindosWalletPaidModelProfile(profile)) {
      models = hivemindosWalletPaidModelOptions().map((model) => model.id);
    } else if (profile.provider === "lm-studio") {
      const discovery = await discoverLmStudioProviderModels(runtimeProfile);
      lmStudioModels = discovery.lmStudioModels;
      lmStudioModelSource = discovery.lmStudioModelSource;
      localModelServers = discovery.servers;
      modelDiscoveryError = discovery.modelDiscoveryError;
      models = discovery.models.length ? discovery.models : configuredModelFallback(profile);
    } else if (profile.provider === "sie") {
      sieStatus = await discoverSieProviderModels(runtimeProfile);
      const chatModels = sieStatus.models.filter((model) => model.chatCompatible);
      models = chatModels.length ? chatModels.map((model) => model.key) : configuredModelFallback(profile);
      modelDiscoveryError = sieStatus.error || "";
      modelTelemetryError = sieStatus.healthError || "";
    } else {
      try {
        models = (await fetchModels(runtimeProfile)).data
          ?.map((model) => model.id)
          .filter((model): model is string => Boolean(model)) ?? configuredModelFallback(profile);
      } catch (error) {
        modelDiscoveryError = error instanceof Error ? error.message : "Model discovery failed.";
      }
    }
    const name = providerName(profile);
    return {
      baseUrl: isHivemindosWalletPaidModelProfile(profile) ? "/api/hivemindos/models" : cleanBaseUrl(runtimeProfile),
      chatPath: isHivemindosWalletPaidModelProfile(profile) ? "/chat/completions" : runtimeProfile.chatPath || "/v1/chat/completions",
      models,
      diagnostics: [
        modelDiscoveryError ? `${name} model discovery unavailable: ${modelDiscoveryError}` : "",
        modelTelemetryError ? `${name} health telemetry unavailable: ${modelTelemetryError}` : "",
      ].filter(Boolean),
      providerStatus: usePodStatus ? {
        usePod: {
          tokenEnvName: usePodStatus.tokenEnvName,
          tokenPresent: usePodStatus.tokenPresent,
          tokenSource: usePodStatus.tokenSource,
          depositAddress: usePodStatus.depositAddress,
          depositCode: usePodStatus.depositCode,
          dashboardUrl: usePodStatus.dashboardUrl,
          balanceRemaining: usePodStatus.balanceRemaining,
          route: usePodStatus.route,
          checkedAt: usePodStatus.checkedAt,
          status: usePodStatus.status,
          message: usePodStatus.message,
          httpStatus: usePodStatus.httpStatus,
          modelCount: usePodStatus.modelCount,
        },
      } : veniceStatus ? {
        venice: {
          authMode: veniceStatus.authMode,
          walletVaultId: veniceStatus.walletVaultId,
          walletAddress: veniceStatus.walletAddress,
          walletNetwork: veniceStatus.walletNetwork,
          apiKeyEnvName: veniceStatus.apiKeyEnvName,
          keyPresent: veniceStatus.keyPresent,
          balanceUsd: veniceStatus.balanceUsd,
          diemBalanceUsd: veniceStatus.diemBalanceUsd,
          minimumTopUpUsd: veniceStatus.minimumTopUpUsd,
          suggestedTopUpUsd: veniceStatus.suggestedTopUpUsd,
          checkedAt: veniceStatus.checkedAt,
          status: veniceStatus.status,
          message: veniceStatus.message,
          httpStatus: veniceStatus.httpStatus,
          modelCount: veniceStatus.modelCount,
        },
      } : profile.provider === "lm-studio" ? {
        lmStudio: {
          baseUrl: cleanBaseUrl(runtimeProfile),
          models: lmStudioModels,
          servers: localModelServers,
          ...localModelHubStatus(lmStudioModels),
          setup: await localRuntimeSetupStatus(runtimeProfile).catch(() => undefined),
          error: modelDiscoveryError || undefined,
          checkedAt: new Date().toISOString(),
        },
      } : profile.provider === "sie" && sieStatus ? {
        sie: sieStatus,
      } : undefined,
      modelSelection: {
        provider: profile.provider || "openai-compatible",
        model: profile.model || models[0] || "",
        providers: [{
          slug: profile.provider || "openai-compatible",
          name,
          models: models.map((id) => {
            const lmStudioModel = lmStudioModels.find((model) => model.key === id);
            const sieModel = sieStatus?.models.find((model) => model.key === id);
            return lmStudioModel
              ? {
                id,
                name: lmStudioModel.displayName,
                subtitle: lmStudioModel.source === "openai-server"
                  ? "Serving"
                  : lmStudioModel.remote ? "Remote" : lmStudioModel.loaded ? "Loaded" : "Downloaded",
                group: lmStudioModel.paramsString || undefined,
                badge: lmStudioModel.source === "openai-server"
                  ? "Server"
                  : lmStudioModel.remote ? "Remote" : lmStudioModel.loaded ? "Loaded" : undefined,
              }
              : sieModel
                ? {
                  id,
                  name: sieModel.displayName,
                  subtitle: sieModel.state === "loaded"
                    ? "Warm"
                    : sieModel.state === "loading"
                      ? "Warming"
                      : sieModel.state === "failed"
                        ? "Failed"
                        : "Lazy",
                  group: sieModel.tasks.join(" · "),
                  badge: "SIE",
                }
              : { id };
          }),
          totalModels: models.length,
          isCurrent: true,
          isUserDefined: true,
          source: profile.provider === "lm-studio"
            ? lmStudioModelSource || buildRuntimeUrl(runtimeProfile, "/api/v1/models")
            : profile.provider === "sie"
              ? buildRuntimeUrl(runtimeProfile, "/v1/models")
            : isHivemindosWalletPaidModelProfile(profile)
              ? "/api/hivemindos/models/models"
            : buildRuntimeUrl(runtimeProfile, runtimeProfile.statusPath || "/v1/models"),
        }],
      },
    };
  },
  async runIntegrationAction(profile, action, input) {
    if (!profile) return { ok: false, error: "Agent profile is required." };
    if (profile.provider === "sie") return runSieAction(profile, action, input);
    if (profile.provider !== "lm-studio") return { ok: false, error: `${providerName(profile)} does not expose local model controls here yet.` };
    return runLmStudioAction(profile, action, input);
  },
};
