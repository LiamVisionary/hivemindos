export const OPENAI_OAUTH_CHAT_CAPABILITIES: {
  readonly defaultModel: "gpt-5.4";
  readonly supportedModelPattern: RegExp;
};

export type PreferredOpenAiChatRoute = {
  auth: "oauth" | "api-key";
  model: string;
};

export function openAiOAuthSupportsChatModel(model: string): boolean;

export function choosePreferredOpenAiChatRoute(input: {
  oauthConfigured: boolean;
  preferApiKey: boolean;
  requestedModel: string;
  oauthModel?: string;
}): PreferredOpenAiChatRoute;

export function runPreferredOpenAiChatRoute<T>(
  input: Parameters<typeof choosePreferredOpenAiChatRoute>[0],
  runners: {
    oauth: (model: string) => Promise<T>;
    apiKey: (model: string) => Promise<T>;
  },
): Promise<T>;

export function executeOpenAiChatRoute<T>(
  route: PreferredOpenAiChatRoute,
  runners: {
    oauth: (model: string) => Promise<T>;
    apiKey: (model: string) => Promise<T>;
  },
): Promise<T>;

export function openAiOAuthRuntimeProfile<
  T extends object,
>(
  agent: T,
  model: string,
  hermesGatewayUrl?: string,
): T & {
  runtime: "hermes";
  provider: "openai-codex";
  model: string;
  gatewayUrl: string;
  chatPath: "/chat";
  statusPath: "/health";
  token: undefined;
};

export function openAiOAuthRuntimeGateway(
  agent: {
    runtime?: string;
    gatewayUrl?: string;
    telemetryUrl?: string;
  },
  hermesGatewayUrl?: string,
): string;

export type OpenAiAgentSelection<T extends object> = {
  profile: T;
  auth: "oauth" | "api-key" | null;
  oauthProtected: boolean;
  redirectedFromApiKey: boolean;
  requestedProvider: string;
  requestedModel: string;
};

export function resolvePreferredOpenAiAgentSelection<
  T extends object,
>(input?: {
  agent?: T;
  processEnv?: Record<string, string | undefined>;
  sharedEnv?: Record<string, string | undefined>;
  fallbackSelection?: { provider?: string; model?: string } | null;
}): OpenAiAgentSelection<T>;
