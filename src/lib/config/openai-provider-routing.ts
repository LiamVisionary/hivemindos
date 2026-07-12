export const OPENAI_OAUTH_CHAT_CAPABILITIES = {
  defaultModel: "gpt-5.4",
  supportedModelPattern: /^(gpt-5|o\d|codex)/i,
} as const;

export type PreferredOpenAiChatRoute = {
  auth: "oauth" | "api-key";
  model: string;
};

export function openAiOAuthSupportsChatModel(model: string): boolean {
  return OPENAI_OAUTH_CHAT_CAPABILITIES.supportedModelPattern.test(model.trim());
}

export function choosePreferredOpenAiChatRoute(input: {
  oauthConfigured: boolean;
  preferApiKey: boolean;
  requestedModel: string;
  oauthModel?: string;
}): PreferredOpenAiChatRoute {
  const requestedModel = input.requestedModel.trim();
  if (!input.oauthConfigured || input.preferApiKey) {
    return { auth: "api-key", model: requestedModel };
  }
  const configuredOAuthModel = input.oauthModel?.trim() || "";
  const oauthModel = openAiOAuthSupportsChatModel(configuredOAuthModel)
    ? configuredOAuthModel
    : openAiOAuthSupportsChatModel(requestedModel)
      ? requestedModel
      : OPENAI_OAUTH_CHAT_CAPABILITIES.defaultModel;
  return { auth: "oauth", model: oauthModel };
}

export async function runPreferredOpenAiChatRoute<T>(
  input: Parameters<typeof choosePreferredOpenAiChatRoute>[0],
  runners: {
    oauth: (model: string) => Promise<T>;
    apiKey: (model: string) => Promise<T>;
  },
): Promise<T> {
  const route = choosePreferredOpenAiChatRoute(input);
  return executeOpenAiChatRoute(route, runners);
}

export async function executeOpenAiChatRoute<T>(
  route: PreferredOpenAiChatRoute,
  runners: {
    oauth: (model: string) => Promise<T>;
    apiKey: (model: string) => Promise<T>;
  },
): Promise<T> {
  return route.auth === "oauth"
    ? runners.oauth(route.model)
    : runners.apiKey(route.model);
}
