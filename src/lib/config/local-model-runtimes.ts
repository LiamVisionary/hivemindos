export const SIE_PROVIDER_ID = "sie" as const;
export const LM_STUDIO_PROVIDER_ID = "lm-studio" as const;

export type ManagedLocalModelProviderId = typeof LM_STUDIO_PROVIDER_ID | typeof SIE_PROVIDER_ID;

export type LocalModelRuntimeCapabilities = {
  provider: ManagedLocalModelProviderId;
  label: string;
  detail: string;
  defaultBaseUrl: string;
  chatPath: string;
  modelsPath: string;
  explicitLoad: boolean;
  explicitUnload: boolean;
  downloadCatalog: boolean;
  warmOnDemand: boolean;
  automaticEviction: boolean;
  workerTelemetry: boolean;
};

/**
 * Product capability matrix for local model runtimes. UI actions and server
 * routes must be derived from this contract rather than inferred from a
 * provider name. In particular, SIE intentionally has no public load/unload
 * mutation: inference warms a model and the runtime owns later eviction.
 */
export const LOCAL_MODEL_RUNTIME_CAPABILITIES: Record<ManagedLocalModelProviderId, LocalModelRuntimeCapabilities> = {
  [LM_STUDIO_PROVIDER_ID]: {
    provider: LM_STUDIO_PROVIDER_ID,
    label: "LM Studio",
    detail: "Download and explicitly load local models",
    defaultBaseUrl: process.env.NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL ?? "http://127.0.0.1:1234",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
    explicitLoad: true,
    explicitUnload: true,
    downloadCatalog: true,
    warmOnDemand: false,
    automaticEviction: false,
    workerTelemetry: false,
  },
  [SIE_PROVIDER_ID]: {
    provider: SIE_PROVIDER_ID,
    label: "SIE",
    detail: "Lazy-load multiple model types onto shared GPU capacity",
    defaultBaseUrl: (process.env.NEXT_PUBLIC_SIE_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/v1\/?$/, "").replace(/\/+$/, ""),
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
    explicitLoad: false,
    explicitUnload: false,
    downloadCatalog: false,
    warmOnDemand: true,
    automaticEviction: true,
    workerTelemetry: true,
  },
};

export function localModelRuntimeCapabilities(provider?: string | null) {
  return provider === LM_STUDIO_PROVIDER_ID || provider === SIE_PROVIDER_ID
    ? LOCAL_MODEL_RUNTIME_CAPABILITIES[provider]
    : undefined;
}
