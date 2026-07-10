import {
  SYNTO_CLOUD_MODEL_ID,
  SYNTO_CLOUD_PROVIDER,
  SYNTO_DEFAULT_LOCAL_MODEL_ID,
} from "./synto-model-tiers";

export type SyntoInstallMode = "optional" | "uv-tool" | "pip-user" | "existing";
export type SyntoMcpMode = "stdio" | "disabled";
export type SyntoSourceAccessMode = "permissive_only" | "all" | "deny";
export type SyntoModelRoute = "cloud-best" | "local-recommended" | "local-light";

export interface SyntoConfig {
  enabled: boolean;
  installMode: SyntoInstallMode;
  cliPath: string;
  mcpMode: SyntoMcpMode;
  sourceAccessMode: SyntoSourceAccessMode;
  modelRoute: SyntoModelRoute;
  cloudProvider: typeof SYNTO_CLOUD_PROVIDER;
  cloudModel: string;
  cloudRequireZdr: boolean;
  localProvider: "lm-studio";
  localModelId: string;
  localLoadedModelKey: string;
  compareHeavyModel: string;
  autoApprove: boolean;
  minConfidence: number;
}

export const DEFAULT_SYNTO_CONFIG: SyntoConfig = {
  enabled: false,
  installMode: "optional",
  cliPath: process.env.NEXT_PUBLIC_SYNTO_CLI_PATH ?? "synto",
  mcpMode: "stdio",
  sourceAccessMode: "deny",
  modelRoute: "cloud-best",
  cloudProvider: SYNTO_CLOUD_PROVIDER,
  cloudModel: SYNTO_CLOUD_MODEL_ID,
  cloudRequireZdr: true,
  localProvider: "lm-studio",
  localModelId: SYNTO_DEFAULT_LOCAL_MODEL_ID,
  localLoadedModelKey: "",
  compareHeavyModel: process.env.NEXT_PUBLIC_SYNTO_COMPARE_HEAVY_MODEL ?? "llama3.1:8b",
  autoApprove: false,
  minConfidence: 0.8,
};
