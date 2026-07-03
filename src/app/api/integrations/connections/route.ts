// guard:allow-hive-action-route - dashboard-only Settings connections management;
// stores/removes user-pasted provider credentials, not an agent-invokable Hive action
import {
  disconnectProvider,
  readConnectionsPayload,
  saveGoogleOAuthClient,
  saveProviderToken,
} from "@/lib/services/integrations/provider-connections";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    return okJson(await readConnectionsPayload());
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not read app connections.", 502);
  }
}

type ConnectionsAction =
  | { action: "save-token"; provider?: string; token?: string }
  | { action: "disconnect"; provider?: string }
  | { action: "save-oauth-client"; provider?: string; clientId?: string; clientSecret?: string };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as ConnectionsAction | null;
  if (!body || typeof body !== "object" || !("action" in body)) return errorJson("Missing action.");
  try {
    if (body.action === "save-token") {
      if (!body.provider || !body.token) return errorJson("Provider and token are required.");
      const saved = await saveProviderToken(body.provider, body.token);
      return okJson({ account: saved.account, ...(await readConnectionsPayload()) });
    }
    if (body.action === "disconnect") {
      if (!body.provider) return errorJson("Provider is required.");
      await disconnectProvider(body.provider);
      return okJson(await readConnectionsPayload());
    }
    if (body.action === "save-oauth-client") {
      if (body.provider !== "google") return errorJson("Only Google uses a pasted OAuth client.");
      await saveGoogleOAuthClient(body.clientId ?? "", body.clientSecret ?? "");
      return okJson(await readConnectionsPayload());
    }
    return errorJson("Unknown action.");
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Connection update failed.", 400);
  }
}
