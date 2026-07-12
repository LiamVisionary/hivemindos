import { NextRequest } from "next/server";
import { POST as runAgentRuntime } from "@/app/api/chat/agent-runtime/route";
import {
  browserExtensionCorsHeaders,
  browserExtensionRuntimeMessages,
  normalizeBrowserExtensionChatInput,
  publicBrowserExtensionAgents,
  withBrowserExtensionCors,
} from "@/lib/services/browser-extension";
import { readStoredAgentProfiles } from "@/lib/services/agent-profile-store";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { verifyAuth } from "@/lib/utils/server-auth";

// guard:allow-hive-action-route - extension-origin chat transport; runtime tool actions retain their own approval policies.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

function cors(request: NextRequest, response: Response) {
  return withBrowserExtensionCors(response, request.headers.get("origin"));
}

async function authorized(request: NextRequest) {
  const auth = await verifyAuth(request);
  return auth.userId ? null : cors(request, errorJson(auth.reason ?? "Dashboard authentication is required.", 401));
}

export async function OPTIONS(request: NextRequest) {
  return new Response(null, { status: 204, headers: browserExtensionCorsHeaders(request.headers.get("origin")) });
}

export async function GET(request: NextRequest) {
  const denied = await authorized(request);
  if (denied) return denied;
  try {
    const profiles = await readStoredAgentProfiles();
    return cors(request, okJson({
      agents: publicBrowserExtensionAgents(profiles),
      capabilities: {
        streaming: true,
        browserContext: true,
        agentModes: ["ask", "act"],
      },
    }));
  } catch (error) {
    return cors(request, errorJson(error instanceof Error ? error.message : "Could not load HivemindOS agents.", 500));
  }
}

export async function POST(request: NextRequest) {
  const denied = await authorized(request);
  if (denied) return denied;

  try {
    const input = normalizeBrowserExtensionChatInput(await request.json().catch(() => null));
    const profiles = await readStoredAgentProfiles();
    const agent = profiles.find((profile) => profile.id === input.agentId);
    if (!agent) return cors(request, errorJson("That agent is no longer available. Refresh the agent list.", 404));

    const headers = new Headers(request.headers);
    headers.set("Content-Type", "application/json");
    headers.delete("content-length");
    const runtimeRequest = new NextRequest(new URL("/api/chat/agent-runtime", request.url), {
      method: "POST",
      headers,
      signal: request.signal,
      body: JSON.stringify({
        agent,
        messages: browserExtensionRuntimeMessages(input),
        runtimeSessionId: input.sessionId || undefined,
        chatStorageKey: `browser-extension:${agent.id}:${input.sessionId || "current"}`,
        clientRunId: input.clientRunId,
        agentMode: input.agentMode,
        permissionMode: "manual",
        reasoningEffort: "medium",
      }),
    });
    return cors(request, await runAgentRuntime(runtimeRequest));
  } catch (error) {
    return cors(request, errorJson(error instanceof Error ? error.message : "Browser chat could not start.", 400));
  }
}
