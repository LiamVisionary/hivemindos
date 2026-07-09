import "server-only";

import { HIVEMIND_OS_RUNTIME, type AgentProfile } from "@/lib/types/agent-runtime";
import { getXaiOAuthAccess } from "@/lib/services/xai-oauth";

export async function resolveXaiOAuthChatEndpoint() {
  const access = await getXaiOAuthAccess();
  return {
    url: `${access.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    key: access.accessToken,
  };
}

export async function resolveXaiOAuthRuntimeProfile(
  profile: AgentProfile,
): Promise<AgentProfile> {
  const access = await getXaiOAuthAccess();
  return {
    ...profile,
    runtime: HIVEMIND_OS_RUNTIME,
    gatewayUrl: access.baseUrl.replace(/\/+$/, ""),
    chatPath: "/chat/completions",
    statusPath: "/models",
    provider: "xai-oauth",
    token: access.accessToken,
    telemetryUrl: "",
  };
}
