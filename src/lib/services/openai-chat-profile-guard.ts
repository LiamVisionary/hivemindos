import { optionalEnv } from "@/lib/config/env";
import {
  choosePreferredOpenAiChatRoute,
  openAiOAuthRuntimeGateway,
  openAiOAuthRuntimeProfile,
} from "@/lib/config/openai-provider-routing";
import { resolvePreferredOpenAiChatRoute } from "@/lib/services/openai-preferred-chat";
import type { AgentProfile } from "@/lib/types/agent-runtime";

const OPENAI_API_PROVIDERS = new Set(["openai", "openai-api"]);
const OPENAI_OAUTH_PROVIDERS = new Set(["openai-codex", "openai-oauth"]);

export type OpenAiChatProfileGuardResult = {
  profile: AgentProfile;
  enforced: boolean;
  requestedProvider: string;
  requestedModel: string;
};

/**
 * Re-check OpenAI authentication at the main chat dispatch boundary. Agent
 * profiles are synchronized user state, not billing authority.
 */
export async function enforceOpenAiChatProfile(
  profile: AgentProfile,
): Promise<OpenAiChatProfileGuardResult> {
  const requestedProvider = String(profile.provider || "").trim().toLowerCase();
  const requestedModel = String(profile.model || "").trim();
  if (
    !OPENAI_API_PROVIDERS.has(requestedProvider) &&
    !OPENAI_OAUTH_PROVIDERS.has(requestedProvider)
  ) {
    return {
      profile,
      enforced: false,
      requestedProvider,
      requestedModel,
    };
  }

  const route = OPENAI_OAUTH_PROVIDERS.has(requestedProvider)
    ? choosePreferredOpenAiChatRoute({
        oauthConfigured: true,
        preferApiKey: false,
        requestedModel,
        oauthModel: optionalEnv("OPENAI_OAUTH_CHAT_MODEL"),
      })
    : await resolvePreferredOpenAiChatRoute(requestedModel);
  if (route.auth === "api-key") {
    return {
      profile,
      enforced: false,
      requestedProvider,
      requestedModel,
    };
  }

  const gatewayUrl = openAiOAuthRuntimeGateway(
    profile,
    process.env.NEXT_PUBLIC_HERMES_BASE_URL ?? "http://127.0.0.1:8642",
  );
  return {
    profile: openAiOAuthRuntimeProfile(profile, route.model, gatewayUrl),
    enforced:
      requestedProvider !== "openai-codex" ||
      profile.runtime !== "hermes" ||
      requestedModel !== route.model,
    requestedProvider,
    requestedModel,
  };
}
