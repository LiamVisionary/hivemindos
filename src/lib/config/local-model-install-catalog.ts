export type LocalModelDownloadState = "queued" | "downloading" | "completed" | "failed" | "cancelled" | "unknown";

export type LocalModelInstallCatalogEntry = {
  id: string;
  displayName: string;
  provider: "huggingface";
  hfRepo: string;
  sourceUrl: string;
  quantization: string;
  filename: string;
  params: string;
  sizeGb: number;
  minRamGb: number;
  contextLength?: number;
  description: string;
  roles: string[];
  capabilities: string[];
  tags: string[];
  matchKeys: string[];
};

export type LocalModelInstallCatalogStatus = LocalModelInstallCatalogEntry & {
  installed?: boolean;
  loaded?: boolean;
  installedModelKey?: string;
  loadedInstanceIds?: string[];
};

export type LocalModelDownloadJob = {
  jobId: string;
  modelId: string;
  displayName?: string;
  state: LocalModelDownloadState;
  received?: number;
  total?: number;
  bytesPerSec?: number;
  etaMs?: number | null;
  progressPercent?: number;
  message?: string;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
};

export type LocalModelHardwareSnapshot = {
  totalRamGb?: number;
  freeRamGb?: number;
  platform?: string;
  arch?: string;
  appleSilicon?: boolean;
};

export type LocalOpenAICompatibleServerModel = {
  id: string;
  displayName?: string;
  type?: "llm" | "embedding" | string;
  loaded?: boolean;
};

export type LocalOpenAICompatibleServerKind = "lm-studio" | "llama-cpp" | "ollama" | "vllm" | "openai-compatible";

export type LocalOpenAICompatibleServer = {
  id: string;
  label: string;
  kind: LocalOpenAICompatibleServerKind;
  baseUrl: string;
  chatPath: string;
  statusPath: string;
  port?: number;
  reachable: boolean;
  models: LocalOpenAICompatibleServerModel[];
  error?: string;
  checkedAt: string;
};

export type LocalRuntimeProviderId = "lm-studio" | "ollama" | "llama-cpp";

export type LocalRuntimeProviderSetupStatus = {
  id: LocalRuntimeProviderId;
  label: string;
  present: boolean;
  ready: boolean;
  running?: boolean;
  version?: string;
  detail?: string;
  error?: string;
  installable?: boolean;
  installCommand?: string;
  manualInstallUrl?: string;
};

export type LocalRuntimeSetupStatus = {
  recommendedProvider: LocalRuntimeProviderId;
  recommendedLabel: string;
  recommendationReason: string;
  ready: boolean;
  installable: boolean;
  installCommand?: string;
  manualInstallUrl?: string;
  serverUrl?: string;
  hardware: LocalModelHardwareSnapshot;
  providers: LocalRuntimeProviderSetupStatus[];
  checkedAt: string;
};

export const LOCAL_MODEL_INSTALL_CATALOG: LocalModelInstallCatalogEntry[] = [
  {
    id: "swarm-scout-12b-q4-k-m",
    displayName: "Swarm Scout 12B",
    provider: "huggingface",
    hfRepo: "LiamVisionary/swarm-sovereign-scout-12b-GGUF",
    sourceUrl: "https://huggingface.co/LiamVisionary/swarm-sovereign-scout-12b-GGUF",
    quantization: "Q4_K_M",
    filename: "swarm-sovereign-scout-Q4_K_M.gguf",
    params: "12B",
    sizeGb: 7.4,
    minRamGb: 16,
    description: "Coding and agentic local model tuned for terminal workflows, reasoning, and autonomous task loops.",
    roles: ["chat"],
    capabilities: ["text-generation", "tool-use", "coding"],
    tags: ["coding", "agentic", "reasoning", "GGUF"],
    matchKeys: [
      "swarm-scout-12b-q4-k-m",
      "swarm-sovereign-scout-Q4_K_M.gguf",
      "swarm-sovereign-scout-Q4_K_M",
      "LiamVisionary/swarm-sovereign-scout-12b-GGUF",
      "swarm-sovereign-scout-12b-GGUF:Q4_K_M",
    ],
  },
];

export function localModelInstallCatalogEntry(id: string) {
  return LOCAL_MODEL_INSTALL_CATALOG.find((entry) => entry.id === id);
}

export function lmStudioDownloadArgsForCatalogEntry(entry: LocalModelInstallCatalogEntry) {
  return ["get", `${entry.sourceUrl}@${entry.quantization}`, "--gguf", "-y"];
}
