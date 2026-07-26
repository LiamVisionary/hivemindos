export const OPENAI_OAUTH_CHAT_CAPABILITIES = {
  defaultModel: "gpt-5.4",
  supportedModelPattern: /^(gpt-5|o\d|codex)/i,
};

const OPENAI_API_PROVIDERS = new Set(["openai", "openai-api"]);
const OPENAI_OAUTH_PROVIDERS = new Set(["openai-codex", "openai-oauth"]);

export function openAiOAuthSupportsChatModel(model) {
  return OPENAI_OAUTH_CHAT_CAPABILITIES.supportedModelPattern.test(
    String(model || "").trim(),
  );
}

export function choosePreferredOpenAiChatRoute(input) {
  const requestedModel = String(input.requestedModel || "").trim();
  if (!input.oauthConfigured || input.preferApiKey) {
    return { auth: "api-key", model: requestedModel };
  }
  const configuredOAuthModel = String(input.oauthModel || "").trim();
  const oauthModel = openAiOAuthSupportsChatModel(configuredOAuthModel)
    ? configuredOAuthModel
    : openAiOAuthSupportsChatModel(requestedModel)
      ? requestedModel
      : OPENAI_OAUTH_CHAT_CAPABILITIES.defaultModel;
  return { auth: "oauth", model: oauthModel };
}

export async function runPreferredOpenAiChatRoute(input, runners) {
  const route = choosePreferredOpenAiChatRoute(input);
  return executeOpenAiChatRoute(route, runners);
}

export async function executeOpenAiChatRoute(route, runners) {
  return route.auth === "oauth"
    ? runners.oauth(route.model)
    : runners.apiKey(route.model);
}

export function openAiOAuthRuntimeProfile(
  agent,
  model,
  hermesGatewayUrl = "http://127.0.0.1:8642",
) {
  return {
    ...agent,
    runtime: "hermes",
    provider: "openai-codex",
    model,
    gatewayUrl: hermesGatewayUrl,
    chatPath: "/chat",
    statusPath: "/health",
    token: undefined,
  };
}

export function openAiOAuthRuntimeGateway(
  agent,
  hermesGatewayUrl = "http://127.0.0.1:8642",
) {
  const existingGateway = String(agent.gatewayUrl || "").trim();
  const existingGatewayIsDirectOpenAi = (() => {
    try {
      return new URL(existingGateway).hostname === "api.openai.com";
    } catch {
      return false;
    }
  })();
  const existingAgentBridge =
    Boolean(String(agent.telemetryUrl || "").trim()) ||
    (agent.runtime !== "hivemind-os" &&
      Boolean(existingGateway) &&
      !existingGatewayIsDirectOpenAi);
  return existingAgentBridge ? existingGateway : hermesGatewayUrl;
}

function envValue(key, processEnv, sharedEnv) {
  return String(processEnv?.[key] || "").trim()
    || String(sharedEnv?.[key] || "").trim();
}

function enabledFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/**
 * Resolve the effective OpenAI selection at the final runtime boundary.
 *
 * The profile is untrusted synchronization state: old tabs, remote clients,
 * and vault mirrors can all replay it. A connected ChatGPT OAuth grant is the
 * canonical chat preference unless OPENAI_PREFER_API_KEY explicitly opts the
 * installation into API-key billing. An explicitly OAuth-selected profile
 * remains OAuth-only even if that global API override is later enabled.
 */
export function resolvePreferredOpenAiAgentSelection({
  agent = {},
  processEnv = {},
  sharedEnv = {},
  fallbackSelection = null,
} = {}) {
  const requestedProvider = String(
    agent.provider || fallbackSelection?.provider || "",
  ).trim().toLowerCase();
  const requestedModel = String(
    agent.model || fallbackSelection?.model || "",
  ).trim();
  const oauthConfigured = Boolean(
    envValue("OPENAI_OAUTH_REFRESH_TOKEN", processEnv, sharedEnv),
  );
  const preferApiKey = enabledFlag(
    envValue("OPENAI_PREFER_API_KEY", processEnv, sharedEnv),
  );
  const oauthModel = envValue(
    "OPENAI_OAUTH_CHAT_MODEL",
    processEnv,
    sharedEnv,
  );

  if (OPENAI_OAUTH_PROVIDERS.has(requestedProvider)) {
    const route = choosePreferredOpenAiChatRoute({
      oauthConfigured: true,
      preferApiKey: false,
      requestedModel,
      oauthModel,
    });
    const profile = {
      ...agent,
      provider: "openai-codex",
      model: route.model,
    };
    return {
      profile,
      auth: "oauth",
      oauthProtected: true,
      redirectedFromApiKey: false,
      requestedProvider,
      requestedModel,
    };
  }

  if (!OPENAI_API_PROVIDERS.has(requestedProvider)) {
    return {
      profile: agent,
      auth: null,
      oauthProtected: false,
      redirectedFromApiKey: false,
      requestedProvider,
      requestedModel,
    };
  }

  const route = choosePreferredOpenAiChatRoute({
    oauthConfigured,
    preferApiKey,
    requestedModel,
    oauthModel,
  });
  if (route.auth === "api-key") {
    return {
      profile: agent,
      auth: "api-key",
      oauthProtected: false,
      redirectedFromApiKey: false,
      requestedProvider,
      requestedModel,
    };
  }

  return {
    profile: {
      ...agent,
      provider: "openai-codex",
      model: route.model,
    },
    auth: "oauth",
    oauthProtected: true,
    redirectedFromApiKey: true,
    requestedProvider,
    requestedModel,
  };
}
