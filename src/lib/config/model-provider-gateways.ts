export type ModelProviderGateway = {
  slug: string;
  name: string;
  detail: string;
  iconPath: string;
  iconMode: "image" | "mask";
  fallback: string;
  defaultModel: string;
  hermes?: {
    name: string;
    baseUrl: string;
    keyEnv: string;
    models: string[];
  };
};

export const MODEL_PROVIDER_GATEWAYS: Record<string, ModelProviderGateway> = {
  "lm-studio": {
    slug: "lm-studio",
    name: "Local OpenAI",
    detail: "Local OpenAI-compatible models",
    iconPath: "/icons/runtimes/openai.svg",
    iconMode: "mask",
    fallback: "AI",
    defaultModel: process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL ?? "",
    hermes: {
      name: "Local OpenAI",
      baseUrl: process.env.NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL
        ? `${process.env.NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL.replace(/\/+$/, "")}/v1`
        : "http://127.0.0.1:1234/v1",
      keyEnv: "",
      models: process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL ? [process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL] : [],
    },
  },
  bankr: {
    slug: "bankr",
    name: "Bankr LLM",
    detail: "Model gateway",
    iconPath: "/icons/runtimes/bankr.svg",
    iconMode: "image",
    fallback: "BK",
    defaultModel: "",
    hermes: {
      name: "Bankr LLM",
      baseUrl: "https://llm.bankr.bot/v1",
      keyEnv: "BANKR_LLM_KEY",
      models: [],
    },
  },
  venice: {
    slug: "venice",
    name: "Venice AI",
    detail: "Private inference · x402",
    iconPath: "/icons/runtimes/venice-keys.svg",
    iconMode: "image",
    fallback: "VE",
    defaultModel: "llama-3.3-70b",
    hermes: {
      name: "Venice AI",
      baseUrl: "https://api.venice.ai/api/v1",
      keyEnv: "VENICE_API_KEY",
      models: ["llama-3.3-70b"],
    },
  },
  usepod: {
    slug: "usepod",
    name: "UsePod",
    detail: "Marketplace inference",
    iconPath: "/icons/runtimes/usepod.webp",
    iconMode: "image",
    fallback: "UP",
    defaultModel: "gpt-5.5",
    hermes: {
      name: "UsePod",
      baseUrl: "",
      keyEnv: "USEPOD_TOKEN",
      models: ["gpt-5.5"],
    },
  },
  openrouter: {
    slug: "openrouter",
    name: "OpenRouter",
    detail: "Hosted models · incl. Fusion",
    iconPath: "/icons/runtimes/openrouter.svg",
    iconMode: "mask",
    fallback: "OR",
    // Surfaced as a picker tile on every runtime, keyed off OPENROUTER_API_KEY in
    // the shared hive env. The model dropdown also offers Adaptive (best free
    // route). Served by the existing OpenRouter path; no `hermes` block so it is
    // not auto-registered into Hermes provider setup (Hermes manages its own).
    defaultModel: "openrouter/fusion",
  },
  "hive-fusion": {
    slug: "hive-fusion",
    name: "Hive Fusion",
    detail: "Compound model · panel → judge → synthesis",
    iconPath: "/icons/runtimes/hive-fusion.svg",
    iconMode: "mask",
    fallback: "HF",
    // Native compound model: fans out to a panel of your configured providers,
    // judges their answers, then synthesizes. OpenRouter's hosted compound model
    // is offered separately as `openrouter/fusion` under the OpenRouter provider.
    defaultModel: "hive-fusion-native",
  },
};

export const USER_MODEL_PROVIDER_GATEWAY_IDS = Object.keys(MODEL_PROVIDER_GATEWAYS);

export function modelProviderGateway(slug?: string | null) {
  return slug ? MODEL_PROVIDER_GATEWAYS[slug] : undefined;
}
