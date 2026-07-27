// guard:allow-hive-action-route - dashboard-only voice-provider credential
// surface: reports which voice-provider API keys / OpenAI voice OAuth are present in the
// shared hive env and saves a user-entered key. Never an agent-invokable Hive
// action (agents must not enumerate or write credential material).
import { NextRequest } from "next/server";

import { okJson, errorJson } from "@/lib/utils/api-response";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { writeSharedHiveEnvValues } from "@/lib/services/hive-env-write";
import { openAiOAuthStatus } from "@/lib/services/openai-oauth";
import { CALL_VOICE_PROVIDER_MATRIX, voiceProviderById } from "@/lib/config/voice-call-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Voice-provider credential status + save, for the Calls settings panel.
 *
 * The panel auto-selects the auth mode per provider (OAuth when connected, else
 * API key when a key is present), so it needs a presence check that never
 * returns the secret value — only booleans. Saving routes through the sanctioned
 * shared-env writer (hive-env-write), which replicates the key to every fleet
 * machine over Tailnet. Voice OAuth sign-in itself stays on /api/openai-oauth;
 * Grok model/runtime OAuth is handled separately by /api/xai-oauth.
 */

type ProviderCredentialStatus = {
  id: string;
  /** The provider's primary API-key env var name (for display only). */
  keyEnv: string;
  keyPresent: boolean;
  /** Which of the provider's accepted env vars actually hold a value — the
   *  panel offers a chooser when more than one is present. */
  presentKeys: string[];
  /** True only for providers with a real OAuth sign-in flow (OpenAI). */
  oauthCapable: boolean;
  oauthConnected: boolean;
  /** OPENAI_PREFER_API_KEY override (OpenAI only). */
  preferApiKey: boolean;
};

async function providerCredentialStatus(): Promise<ProviderCredentialStatus[]> {
  const oauth = await openAiOAuthStatus().catch(() => null);
  return Promise.all(
    CALL_VOICE_PROVIDER_MATRIX.map(async (provider) => {
      // A key counts as present if ANY of the provider's accepted env vars is set.
      const values = await Promise.all(
        provider.apiKeyEnvVars.map((key) => hiveEnvValue(key).catch(() => "")),
      );
      const presentKeys = provider.apiKeyEnvVars.filter((_, index) => Boolean(values[index]?.trim()));
      const oauthCapable = Boolean(provider.oauth);
      return {
        id: provider.id,
        keyEnv: provider.apiKeyEnvVars[0] ?? "",
        keyPresent: presentKeys.length > 0,
        presentKeys,
        oauthCapable,
        // Only OpenAI has a real OAuth flow; its status is the shared one.
        oauthConnected: oauthCapable ? Boolean(oauth?.connected) : false,
        preferApiKey: oauthCapable ? Boolean(oauth?.preferApiKey) : false,
      };
    }),
  );
}

export async function GET() {
  try {
    return okJson({ providers: await providerCredentialStatus() });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Voice credential status failed.", 500);
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    provider?: string;
    value?: string;
  };
  try {
    if (body.action === "save-key") {
      const provider = voiceProviderById(body.provider);
      if (!provider) return errorJson(`Unknown voice provider: ${body.provider ?? ""}`);
      const envVar = provider.apiKeyEnvVars[0];
      if (!envVar) return errorJson(`${provider.name} has no API-key slot.`);
      const value = String(body.value ?? "").trim();
      if (!value) return errorJson(`Enter a ${provider.name} API key.`);
      // writeSharedHiveEnvValues throws on empty (it would delete the key) and
      // fans out to every fleet machine. Rollback = re-save the prior value.
      await writeSharedHiveEnvValues({ [envVar]: value });
      return okJson({ providers: await providerCredentialStatus() });
    }
    return errorJson(`Unknown action: ${body.action ?? ""}`);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Voice credential save failed.", 500);
  }
}
