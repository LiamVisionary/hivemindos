export type CodexAppServerModel = {
  id: string;
  name?: string;
  subtitle?: string;
  isDefault: boolean;
};

export type CodexAppServerModelDiscovery = {
  models: CodexAppServerModel[];
  defaultModel: string;
};

export type CodexRuntimeModelSelection = {
  provider: "openai-codex";
  model: string;
  providers: Array<{
    slug: "openai-codex";
    name: "OpenAI Codex";
    models: Array<{ id: string; name?: string; subtitle?: string }>;
    totalModels: number;
    isCurrent: true;
    isUserDefined: true;
    source: string;
  }>;
};

export function buildCodexRuntimeModelSelection(options?: {
  configuredModel?: string;
  discovery?: CodexAppServerModelDiscovery;
  source?: string;
}): CodexRuntimeModelSelection;

export function discoverCodexAppServerModels(options?: {
  command?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<CodexAppServerModelDiscovery>;

export function readCodexRuntimeIntegrationStatus(options?: {
  command?: string;
  env?: NodeJS.ProcessEnv;
  configuredModel?: string;
  capabilities?: Record<string, boolean>;
}): Promise<{
  ok: boolean;
  runtime: "codex";
  capabilities: Record<string, boolean>;
  detail: string;
  modelSelection: CodexRuntimeModelSelection;
  integrations: {
    modelSelection: { supported: true; enabled: boolean; detail: string };
  };
  diagnostics: string[];
}>;
