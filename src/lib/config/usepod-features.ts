export type UsePodApiCompatibility = "openai" | "anthropic";
export type UsePodRoutingMode = "auto" | "marketplace-only";
export type UsePodFundingCurrency = "USDC" | "SOL";

export type UsePodCompatibilityFeature = {
  id: UsePodApiCompatibility;
  label: string;
  baseUrlTemplate: string;
  envName: string;
  endpoints: readonly string[];
  docsUrl: string;
};

export type UsePodRoutingFeature = {
  id: UsePodRoutingMode;
  label: string;
  summary: string;
  requestControl: "default" | "dashboard";
};

export type UsePodSupplyFeature = {
  id: "provider-agent" | "key-relay";
  label: string;
  summary: string;
  docsUrl: string;
  actionUrl: string;
  commands?: readonly string[];
};

export type UsePodFundingFeature = {
  id: UsePodFundingCurrency;
  label: string;
  network: string;
  summary: string;
  directTransaction: boolean;
};

export const USEPOD_API_BASE = "https://api.usepod.ai";
export const USEPOD_HOST_URL = "https://usepod.ai/host";
export const USEPOD_HOST_START_URL = "https://usepod.ai/host/start";
export const USEPOD_ONCHAIN_PROGRAM_ID = "BBAdcqUkg68JXNiPQ1HR1wujfZuayyK3eQTQSYAh6FSW";
export const USEPOD_SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USEPOD_PROVIDER_EARN_SHARE = 0.8;
export const USEPOD_PROVIDER_BOND_USDC = 50;

export const USEPOD_COMPATIBILITY_MATRIX = {
  openai: {
    id: "openai",
    label: "OpenAI-compatible",
    baseUrlTemplate: `${USEPOD_API_BASE}/proxy/<token>/v1`,
    envName: "OPENAI_BASE_URL",
    endpoints: ["/v1/chat/completions", "/v1/models"],
    docsUrl: "https://docs.usepod.ai/using/drop-in-api/",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic-compatible",
    baseUrlTemplate: `${USEPOD_API_BASE}/proxy/<token>`,
    envName: "ANTHROPIC_BASE_URL",
    endpoints: ["/v1/messages"],
    docsUrl: "https://docs.usepod.ai/using/drop-in-api/",
  },
} as const satisfies Record<UsePodApiCompatibility, UsePodCompatibilityFeature>;

export const USEPOD_ROUTING_MATRIX = {
  auto: {
    id: "auto",
    label: "Auto",
    summary: "Prefer the cheapest eligible marketplace or key-relay route, then fall back to the centralized router when needed.",
    requestControl: "default",
  },
  "marketplace-only": {
    id: "marketplace-only",
    label: "Marketplace only",
    summary: "Restrict to marketplace and key-relay providers so a no-provider-at-price result is returned instead of centralized fallback.",
    requestControl: "dashboard",
  },
} as const satisfies Record<UsePodRoutingMode, UsePodRoutingFeature>;

export const USEPOD_SUPPLY_MATRIX = {
  "provider-agent": {
    id: "provider-agent",
    label: "Host machine compute",
    summary: "Run usepod-agent on a machine with a local OpenAI-compatible backend such as vLLM, llama.cpp, LM Studio, or Ollama.",
    docsUrl: "https://docs.usepod.ai/providers/agent/",
    actionUrl: USEPOD_HOST_START_URL,
    commands: [
      "mkdir -p \"$HOME/.local/bin\"",
      "curl -fsSL https://usepod.ai/install.sh | USEPOD_PREFIX=\"$HOME/.local\" sh",
      "\"$HOME/.local/bin/usepod-agent\" setup",
    ],
  },
  "key-relay": {
    id: "key-relay",
    label: "Resell API keys",
    summary: "Enroll an upstream key and model catalog so UsePod can route eligible paid requests through your key relay.",
    docsUrl: "https://docs.usepod.ai/providers/resell-keys/",
    actionUrl: USEPOD_HOST_URL,
  },
} as const satisfies Record<UsePodSupplyFeature["id"], UsePodSupplyFeature>;

export const USEPOD_FUNDING_MATRIX = {
  USDC: {
    id: "USDC",
    label: "Solana USDC",
    network: "solana:mainnet",
    summary: "UsePod credits the token through its on-chain deposit instruction, not a plain SPL transfer memo.",
    directTransaction: true,
  },
  SOL: {
    id: "SOL",
    label: "SOL via Jupiter",
    network: "solana:mainnet",
    summary: "UsePod documents a SOL-to-USDC swap composed into the same on-chain deposit transaction.",
    directTransaction: false,
  },
} as const satisfies Record<UsePodFundingCurrency, UsePodFundingFeature>;

export function usePodBaseUrlTemplate(kind: UsePodApiCompatibility) {
  return USEPOD_COMPATIBILITY_MATRIX[kind].baseUrlTemplate;
}
