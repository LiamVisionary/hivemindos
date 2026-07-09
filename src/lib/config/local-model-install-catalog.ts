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
  {
    id: "synto-qwen3-5-9b-q4-k-m",
    displayName: "Syntho Qwen3.5 9B",
    provider: "huggingface",
    hfRepo: "lmstudio-community/Qwen3.5-9B-GGUF",
    sourceUrl: "https://huggingface.co/lmstudio-community/Qwen3.5-9B-GGUF",
    quantization: "Q4_K_M",
    filename: "Qwen3.5-9B-Q4_K_M.gguf",
    params: "9B",
    sizeGb: 5.6,
    minRamGb: 16,
    contextLength: 262144,
    description: "Low-resource Syntho option for lighter machines; fastest local setup, with more review expected.",
    roles: ["synto", "synthesis"],
    capabilities: ["text-generation", "structured-output", "synthesis"],
    tags: ["synto", "qwen3.5", "local", "low-resource", "GGUF"],
    matchKeys: [
      "synto-qwen3-5-9b-q4-k-m",
      "Qwen3.5-9B-Q4_K_M.gguf",
      "Qwen3.5-9B-Q4_K_M",
      "lmstudio-community/Qwen3.5-9B-GGUF",
      "Qwen3.5-9B-GGUF:Q4_K_M",
    ],
  },
  {
    id: "synto-qwen3-30b-a3b-q4-k-m",
    displayName: "Syntho Qwen3 30B A3B",
    provider: "huggingface",
    hfRepo: "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF",
    sourceUrl: "https://huggingface.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF",
    quantization: "Q4_K_M",
    filename: "Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf",
    params: "30B A3B",
    sizeGb: 18.6,
    minRamGb: 32,
    contextLength: 131072,
    description: "Recommended local Syntho tier from the temp-vault trial: strong synthesis quality at a practical memory cost.",
    roles: ["synto", "synthesis"],
    capabilities: ["text-generation", "structured-output", "synthesis"],
    tags: ["synto", "qwen3", "moe", "recommended", "GGUF"],
    matchKeys: [
      "synto-qwen3-30b-a3b-q4-k-m",
      "Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf",
      "Qwen3-30B-A3B-Instruct-2507-Q4_K_M",
      "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF",
      "Qwen3-30B-A3B-Instruct-2507-GGUF:Q4_K_M",
      "qwen3:30b",
    ],
  },
  {
    id: "synto-qwen3-6-27b-q4-k-m",
    displayName: "Syntho Qwen3.6 27B",
    provider: "huggingface",
    hfRepo: "lmstudio-community/Qwen3.6-27B-GGUF",
    sourceUrl: "https://huggingface.co/lmstudio-community/Qwen3.6-27B-GGUF",
    quantization: "Q4_K_M",
    filename: "Qwen3.6-27B-Q4_K_M.gguf",
    params: "27B",
    sizeGb: 16.6,
    minRamGb: 32,
    contextLength: 262144,
    description: "Experimental Syntho option; quality is promising only when reasoning/thinking output is disabled.",
    roles: ["synto", "synthesis"],
    capabilities: ["text-generation", "structured-output", "synthesis"],
    tags: ["synto", "qwen3.6", "experimental", "GGUF"],
    matchKeys: [
      "synto-qwen3-6-27b-q4-k-m",
      "Qwen3.6-27B-Q4_K_M.gguf",
      "Qwen3.6-27B-Q4_K_M",
      "lmstudio-community/Qwen3.6-27B-GGUF",
      "Qwen3.6-27B-GGUF:Q4_K_M",
      "qwen3.6:27b",
    ],
  },
  {
    id: "synto-qwen3-6-35b-a3b-q4-k-m",
    displayName: "Syntho Qwen3.6 35B A3B",
    provider: "huggingface",
    hfRepo: "lmstudio-community/Qwen3.6-35B-A3B-GGUF",
    sourceUrl: "https://huggingface.co/lmstudio-community/Qwen3.6-35B-A3B-GGUF",
    quantization: "Q4_K_M",
    filename: "Qwen3.6-35B-A3B-Q4_K_M.gguf",
    params: "35B A3B",
    sizeGb: 21.2,
    minRamGb: 32,
    contextLength: 262144,
    description: "High-ceiling local Syntho candidate for larger machines; keep review on until it beats the 30B tier in fixtures.",
    roles: ["synto", "synthesis"],
    capabilities: ["text-generation", "structured-output", "synthesis"],
    tags: ["synto", "qwen3.6", "moe", "high-ceiling", "GGUF"],
    matchKeys: [
      "synto-qwen3-6-35b-a3b-q4-k-m",
      "Qwen3.6-35B-A3B-Q4_K_M.gguf",
      "Qwen3.6-35B-A3B-Q4_K_M",
      "lmstudio-community/Qwen3.6-35B-A3B-GGUF",
      "Qwen3.6-35B-A3B-GGUF:Q4_K_M",
      "qwen3.6:35b-a3b",
    ],
  },
];

export function localModelInstallCatalogEntry(id: string) {
  return LOCAL_MODEL_INSTALL_CATALOG.find((entry) => entry.id === id);
}

export function lmStudioDownloadArgsForCatalogEntry(entry: LocalModelInstallCatalogEntry) {
  return ["get", `${entry.sourceUrl}@${entry.quantization}`, "--gguf", "-y"];
}
