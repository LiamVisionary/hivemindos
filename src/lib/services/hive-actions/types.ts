import type { z } from "zod";
import type { AuthorizationMetadata, PrincipalContext } from "@/lib/types/principal";

export type HiveActionCaller =
  | "dashboard"
  | "chat"
  | "mcp"
  | "cli"
  | "queen-bee"
  | "scheduler"
  | "runtime";

export type HiveActionSideEffect =
  | "read"
  | "write"
  | "filesystem"
  | "network"
  | "remote-machine"
  | "wallet"
  | "payment"
  | "credential"
  | "public-message";

export type HiveActionRisk = "low" | "medium" | "high" | "critical";

export type HiveActionConfirmation =
  | false
  | {
      token?: string;
      tokens?: string[];
      reason: string;
      when?: "always" | "unless-auto-policy-allows";
    };

export type HiveActionContext = {
  caller: HiveActionCaller;
  userId?: string;
  principal?: PrincipalContext;
  sessionId?: string;
  signal?: AbortSignal;
};

export type HiveActionLoadHint = {
  type: "file" | "api" | "none";
  target?: string;
  note?: string;
};

export type HiveActionMcpConfig = {
  expose: boolean;
  compact?: boolean;
  toolName?: string;
};

export type HiveActionContextIndexConfig = {
  summary: string;
  retrievalText: string;
  route?: string;
  methods?: string[];
  load?: HiveActionLoadHint;
};

export type HiveActionDefinition<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TResult = unknown,
> = {
  id: string;
  title: string;
  description: string;
  schema: TSchema;
  sideEffects: HiveActionSideEffect[];
  risk: HiveActionRisk;
  tags: string[];
  aliases?: string[];
  readOnly?: boolean;
  mcp?: HiveActionMcpConfig;
  contextIndex?: HiveActionContextIndexConfig;
  confirmation?: HiveActionConfirmation;
  // Env credential keys this action's backing integration needs to be usable.
  // When set, the action is surfaced in capability search ONLY if at least one of
  // these keys is present in the shared hive env (i.e. the integration is
  // connected). Omit for always-available core tools. Governance (claims,
  // confirmation, route enforcement) is unaffected — this only controls whether
  // the capability is advertised.
  requiresConnection?: string[];
  run?: (input: z.infer<TSchema>, ctx: HiveActionContext) => Promise<TResult>;
};

export type HiveMcpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
    "hivemindos/risk": HiveActionRisk;
    "hivemindos/sideEffects": HiveActionSideEffect[];
    "hivemindos/confirmation"?: HiveActionConfirmation;
    "hivemindos/authorization"?: AuthorizationMetadata;
  };
};
