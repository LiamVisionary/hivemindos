export type HiveComputeBinaryStatus = {
  name: string;
  installed: boolean;
  version?: string;
  error?: string;
};

export type HiveComputeEnvPresence = {
  name: string;
  present: boolean;
  source?: "process" | "shared-hive-env" | "local-session";
};

export type HiveComputeModelOption = {
  id: string;
  name?: string;
  subtitle?: string;
  group?: string;
  badge?: string;
  trust?: "confidential-verified";
  performance?: HiveComputeModelPerformance;
  disabled?: boolean;
  disabledReason?: string;
};

export type HiveComputeModelPerformance = {
  model: string;
  samples: number;
  completionTokens: number;
  tokensPerSecond: number;
  timeToFirstTokenMs: number;
  durationMs: number;
  speedTier: "unmeasured" | "warming" | "heavy" | "balanced" | "fast";
  updatedAt?: string;
};

export type HiveComputeGatewayStatus = {
  configured: boolean;
  baseUrl?: string;
  openAiBaseUrl?: string;
  apiKey: HiveComputeEnvPresence;
  capacity?: {
    liveWorkers: number;
    totalSlots?: number;
    busySlots?: number;
    availableSlots?: number;
    hardwareTeeWorkers?: number;
    confidentialWorkers?: number;
    confidentialModels: string[];
    liveModels: string[];
    keyRelayModels: string[];
    modelPerformance: HiveComputeModelPerformance[];
    fallbackConfigured: boolean;
    pendingJobs: number;
    pricing?: {
      providerBounds: {
        inputUsdMicroPerMTok: { min: number; max: number };
        outputUsdMicroPerMTok: { min: number; max: number };
        minimumJobUsdMicro: { min: number; max: number };
      };
      centralizedCeiling: {
        inputUsdMicroPerMTok: number;
        outputUsdMicroPerMTok: number;
      };
      platformFeeBps: number;
    };
    statusLabel: string;
    statusTone: "live" | "fallback" | "empty";
  };
  health?: {
    ok: boolean;
    status?: number;
    message?: string;
  };
  models?: {
    ok: boolean;
    count: number;
    ids: string[];
    status?: number;
    message?: string;
  };
};

export type HiveComputePaymentRail = "x402" | "mpp" | "prepaid" | "self-hosted";

export type HiveComputePaymentStatus = {
  defaultRail: HiveComputePaymentRail;
  railEnv: string;
  x402: {
    ready: boolean;
    message: string;
  };
  mpp: {
    enabled: boolean;
    ready: boolean;
    enabledEnv: string;
    policyUrlEnv: string;
    sessionTokenEnv: string;
    requireSessionEnv: string;
    policyUrl?: string;
    sessionToken: HiveComputeEnvPresence;
    requireSession: boolean;
    message: string;
  };
};

export type HiveComputePrivacyStatus = {
  mode: "standard" | "tee-required" | "attestation-policy";
  verifiedOnly: boolean;
  teeRequiredEnv: string;
  confidentialModeEnv: string;
  attestationPolicyUrlEnv: string;
  teeProviderEnv: string;
  attestationFileEnv: string;
  attestationCommandEnv: string;
  attestationFormatEnv: string;
  measurementEnv: string;
  imageDigestEnv: string;
  encryptionPublicKeyEnv: string;
  decryptionPrivateKeyFileEnv: string;
  attestationPolicyUrl?: string;
  teeProvider?: string;
  attestationReady: boolean;
  encryptedDeliveryReady: boolean;
  evidenceSource?: "file" | "command";
  message: string;
};

export type HiveComputeWorkerModuleStatus = {
  root: string;
  installed: boolean;
  packageJsonPath: string;
  workerPath: string;
  readmePath: string;
  nodeModulesInstalled: boolean;
  packageName: string;
  version: string;
  installedVersion?: string;
  updateAvailable: boolean;
  runCommand: string;
  dependencyInstallCommand: string;
};

export type HiveComputeHostWhen = "idle" | "always" | "sched";

/** Local-time hosting window for hostWhen "sched". The window is
 * [startHour, endHour) in the worker machine's local time; endHour ≤ startHour
 * wraps past midnight, and startHour === endHour means all day. */
export type HiveComputeHostSchedule = {
  startHour: number;
  endHour: number;
};

export type HiveComputePricingStrategy = "competitive" | "balanced" | "max-earnings" | "custom";

export type HiveComputeModelBenchmark = {
  inputTokensPerSecond: number;
  outputTokensPerSecond: number;
  measuredAt: string;
  sampleSize: number;
  methodVersion: number;
  warmupCompleted: boolean;
  source: "local-benchmark";
};

export type HiveComputeModelPrice = {
  inputUsdMicroPerMTok: number;
  outputUsdMicroPerMTok: number;
  minimumJobUsdMicro: number;
};

export type HiveComputePricingConfig = {
  pricingStrategy: HiveComputePricingStrategy;
  targetHourlyUsd: number;
  modelPrices: Record<string, HiveComputeModelPrice>;
  modelBenchmarks: Record<string, HiveComputeModelBenchmark>;
};

export type HiveComputeHostRunConfig = HiveComputePricingConfig & {
  /** Read only during migration from the retired bulk-markdown pricing control. */
  markdown?: number;
  maxConcurrency: number;
  selectedModelIds: string[] | null;
  hostWhen: HiveComputeHostWhen;
  schedule: HiveComputeHostSchedule | null;
  dailyCapUsd: number | null;
  pauseOnBattery: boolean;
  yieldToUser: boolean;
};

export type HiveComputeLocalBackendKind = "lmstudio" | "openai" | "ollama";

export type HiveComputeLocalBackendStatus = {
  kind: HiveComputeLocalBackendKind;
  label: string;
  host: string;
  reachable: boolean;
  message: string;
};

export type HiveComputeHostModel = {
  id: string;
  name?: string;
  providerModelId: string;
  backendKind: HiveComputeLocalBackendKind;
  inputPer1m: number;
  outputPer1m: number;
  minimumJobUsdMicro: number;
  pricingSource: "benchmark" | "custom" | "starter";
  benchmark?: HiveComputeModelBenchmark;
  /** On-disk model size in bytes when the backend reports it (Ollama tags,
   * LM Studio /api/v0/models) — used for memory-fit warnings, best-effort. */
  sizeBytes?: number;
  /** True when this model is not served from the discovering machine's own disk
   * (an LM Studio LM Link model shared by a linked device, or a model discovered
   * on a remote fleet machine's backend over the collector). */
  remote?: boolean;
  /** Friendly name of the machine/device that actually runs this model —
   * the LM Link peer's device name, or the targeted remote fleet machine. */
  hostDeviceName?: string;
  /** Best-effort location label of the serving machine (e.g. "New York relay"). */
  hostLocation?: string;
};

/** Which machine's backend a Hive Compute host status was discovered from. */
export type HiveComputeHostDiscovery = {
  /** Display name of the machine whose models were discovered. */
  machineName?: string;
  /** True when discovery targeted a remote fleet machine over its collector. */
  remote: boolean;
  /** Collector base URL used for remote discovery. */
  collectorUrl?: string;
  /** Location label of the discovered machine (remote targets only). */
  location?: string;
};

/** Optional target passed to marketplace status reads to discover a specific
 * fleet machine's local models instead of the dashboard host's. */
export type HiveComputeHostTarget = {
  collectorUrl?: string;
  machineName?: string;
  location?: string;
  isSelf?: boolean;
};

export type HiveComputeWorkerRunStatus = {
  status: "idle" | "starting" | "running" | "stopped" | "failed";
  output: string;
  error: string;
  startedAt: number;
  pid?: number;
  /** Automatic in-process restarts after unexpected worker exits. */
  restarts?: number;
};

export type HiveComputeEarningsModelTotal = {
  model: string;
  usdMicro: number;
  jobs: number;
};

export type HiveComputeEarningsEvent = {
  at: string;
  jobId: string;
  model?: string;
  usdMicro: number;
};

/** Aggregated view of the worker-maintained local earnings summary file. */
export type HiveComputeEarningsSummary = {
  totalUsdMicro: number;
  totalJobs: number;
  todayUsdMicro: number;
  todayJobs: number;
  last7dUsdMicro: number;
  last30dUsdMicro: number;
  byModel: HiveComputeEarningsModelTotal[];
  recent: HiveComputeEarningsEvent[];
  updatedAt?: string;
};

export type HiveComputeBenchmarkFailure = {
  modelId: string;
  message: string;
};

/** Result of the most recent local benchmark run, persisted alongside the run
 * config so the UI can explain which models were excluded and why. */
export type HiveComputeBenchmarkReport = {
  at: string;
  benchmarkedModelIds: string[];
  failures: HiveComputeBenchmarkFailure[];
};

export type HiveComputeHostContext = {
  /** Primary backend (first reachable with models); see backends for all probed. */
  backend: HiveComputeLocalBackendStatus;
  /** Every probed local backend — LM Studio/OpenAI-compatible and Ollama can
   * both serve models at once; models[] merges them with per-model backendKind. */
  backends: HiveComputeLocalBackendStatus[];
  models: HiveComputeHostModel[];
  advertisedModels: string[];
  config: HiveComputeHostRunConfig;
  canRun: boolean;
  message: string;
  run?: HiveComputeWorkerRunStatus;
  /** Which machine's backend these models were discovered from. */
  discoveredFrom?: HiveComputeHostDiscovery;
  /** Local worker earnings actually received from the gateway, when any. */
  earnings?: HiveComputeEarningsSummary | null;
  /** Most recent benchmark run report, including per-model failures. */
  lastBenchmark?: HiveComputeBenchmarkReport | null;
  /** Total physical memory of the discovered machine (self-targets only). */
  machineMemoryBytes?: number;
};

export type HiveComputeMarketplaceStatus = {
  productName: string;
  providerSlug: string;
  defaultModel: string;
  gatewayEnv: string;
  openAiBaseEnv: string;
  apiKeyEnv: string;
  workerTokenEnv: string;
  estimatedEarningsEnv: string;
  estimatedEarningsLabel?: string;
  checkedAt: string;
  gateway: HiveComputeGatewayStatus;
  payments: HiveComputePaymentStatus;
  privacy: HiveComputePrivacyStatus;
  workerToken: HiveComputeEnvPresence;
  workerModule: HiveComputeWorkerModuleStatus;
  host: HiveComputeHostContext;
  prerequisites: {
    node: HiveComputeBinaryStatus;
    ollama: HiveComputeBinaryStatus;
  };
  models: HiveComputeModelOption[];
  routing: {
    ready: boolean;
    message: string;
    chatPath: string;
  };
  earning: {
    ready: boolean;
    message: string;
    cta: string;
  };
  boundary: {
    mode: "client-module";
    officialAuthority: string;
    selfHosted: string;
    promptPrivacy: string;
    confidentialCompute: string;
    micropayments: string;
  };
};

export type HiveComputeInstallResult = {
  installed: boolean;
  wrote: string[];
  skipped: string[];
  status: HiveComputeMarketplaceStatus;
};
