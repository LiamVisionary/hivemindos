export const SYNTO_CLOUD_MODEL_ID = "qwen/qwen3-235b-a22b-2507";
export const SYNTO_CLOUD_PROVIDER = "openrouter";
export const SYNTO_CLOUD_PROVIDER_URL = "https://openrouter.ai/api/v1";
export const SYNTO_CLOUD_API_KEY_ENV = "OPENROUTER_API_KEY";
export const SYNTO_LOCAL_PROVIDER_NAME = "lm_studio";
export const SYNTO_LOCAL_PROVIDER_URL = "http://127.0.0.1:1234/v1";
export const SYNTO_DEFAULT_LOCAL_MODEL_ID = "synto-qwen3-30b-a3b-q4-k-m";

export type SyntoModelRoute = "cloud-best" | "local-recommended" | "local-light";

export const SYNTO_LOCAL_MODEL_IDS = [
  "synto-qwen3-5-9b-q4-k-m",
  "synto-qwen3-30b-a3b-q4-k-m",
  "synto-qwen3-6-27b-q4-k-m",
  "synto-qwen3-6-35b-a3b-q4-k-m",
] as const;

export type SyntoLocalModelId = typeof SYNTO_LOCAL_MODEL_IDS[number];

export const SYNTO_LOCAL_MODEL_ID_SET = new Set<string>(SYNTO_LOCAL_MODEL_IDS);

export const SYNTO_COMPARE_MODEL_OPTIONS = [
  { value: "llama3.1:8b", label: "llama3.1:8b" },
  { value: "qwen2.5:14b", label: "qwen2.5:14b" },
  { value: "gemma4:e4b", label: "gemma4:e4b" },
  { value: "mistral-nemo:12b", label: "mistral-nemo:12b" },
  { value: "deepseek-r1:8b", label: "deepseek-r1:8b" },
  { value: "qwen3:30b", label: "Qwen3 30B A3B" },
  { value: "qwen3.6:27b", label: "Qwen3.6 27B" },
  { value: SYNTO_CLOUD_MODEL_ID, label: "Qwen3 235B via OpenRouter" },
];

export const SYNTO_CLOUD_ENDPOINT_PROVIDERS = [
  "DeepInfra",
  "Novita",
  "Parasail",
  "Alibaba",
  "Venice",
  "Nebius",
  "Together",
  "Friendli",
  "AtlasCloud",
  "StreamLake",
  "Google",
  "GMICloud",
];

export const SYNTO_LOCAL_ROUTE_OPTIONS = [
  {
    route: "local-light" as const,
    modelId: "synto-qwen3-5-9b-q4-k-m" as const,
    compareModel: "qwen3.5:9b",
    title: "Local Light",
    subtitle: "Qwen3.5 9B Q4_K_M",
    sizeLabel: "5.6 GB download",
    ramLabel: "16 GB+ RAM",
    description:
      "Lowest resource Syntho path. Good for private background synthesis on smaller machines, with review kept on.",
  },
  {
    route: "local-recommended" as const,
    modelId: "synto-qwen3-30b-a3b-q4-k-m" as const,
    compareModel: "qwen3:30b",
    title: "Local Recommended",
    subtitle: "Qwen3 30B A3B Q4_K_M",
    sizeLabel: "18.6 GB download",
    ramLabel: "32 GB+ RAM",
    description:
      "Best tested local Syntho tier so far: high-quality synthesis without the 235B cloud bill.",
  },
];

export const SYNTO_LOCAL_EXTRA_OPTIONS = [
  {
    modelId: "synto-qwen3-6-27b-q4-k-m" as const,
    title: "Qwen3.6 27B",
    sizeLabel: "16.6 GB download",
    ramLabel: "32 GB+ RAM",
    description: "Experimental middle lane; only use with thinking disabled and human review.",
  },
  {
    modelId: "synto-qwen3-6-35b-a3b-q4-k-m" as const,
    title: "Qwen3.6 35B A3B",
    sizeLabel: "21.2 GB download",
    ramLabel: "32 GB+ RAM",
    description: "High-ceiling local candidate for larger machines; still needs fixture wins before becoming default.",
  },
];
