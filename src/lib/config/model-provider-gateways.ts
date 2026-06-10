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
};

export const USER_MODEL_PROVIDER_GATEWAY_IDS = Object.keys(MODEL_PROVIDER_GATEWAYS);

export function modelProviderGateway(slug?: string | null) {
  return slug ? MODEL_PROVIDER_GATEWAYS[slug] : undefined;
}
