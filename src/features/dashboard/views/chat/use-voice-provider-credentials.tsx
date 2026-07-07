"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CALL_VOICE_PROVIDER_MATRIX,
  voiceProviderById,
  type VoiceProviderAuthMode,
} from "@/lib/config/voice-call-providers";

/**
 * Credential state for the Calls voice panel: which provider API keys live in
 * the shared hive env, and whether OpenAI's ChatGPT OAuth is connected. Drives
 * the OAuth-vs-API-key auto-select and the inline hive-env key input.
 *
 * Presence booleans come from /api/phone/voice-credentials (never the secret
 * value); OAuth sign-in reuses /api/openai-oauth (the only real OAuth flow).
 */

export type ProviderCredentialStatus = {
  id: string;
  keyEnv: string;
  keyPresent: boolean;
  /** Which of the provider's accepted env vars actually hold a value. */
  presentKeys: string[];
  oauthCapable: boolean;
  oauthConnected: boolean;
  preferApiKey: boolean;
};

type CredentialMap = Record<string, ProviderCredentialStatus>;

function emptyStatus(id: string): ProviderCredentialStatus {
  const provider = voiceProviderById(id);
  return {
    id,
    keyEnv: provider?.apiKeyEnvVars[0] ?? "",
    keyPresent: false,
    presentKeys: [],
    oauthCapable: Boolean(provider?.oauth),
    oauthConnected: false,
    preferApiKey: false,
  };
}

/** The auth mode the panel defaults to before the user overrides it:
 *  OAuth when connected, else the API key when present, else OAuth when the
 *  provider supports it (so the sign-in shows), else the key input. */
export function autoAuthMode(status: ProviderCredentialStatus | undefined): VoiceProviderAuthMode {
  if (!status) return "apikey";
  if (status.oauthCapable && status.oauthConnected) return "oauth";
  if (status.keyPresent) return "apikey";
  return status.oauthCapable ? "oauth" : "apikey";
}

export function useVoiceProviderCredentials(active: boolean) {
  const [credentials, setCredentials] = useState<CredentialMap>(() =>
    Object.fromEntries(CALL_VOICE_PROVIDER_MATRIX.map((provider) => [provider.id, emptyStatus(provider.id)])),
  );
  const [ready, setReady] = useState(false);
  const [oauthBusyProvider, setOauthBusyProvider] = useState("");
  const [oauthAuthorizeUrl, setOauthAuthorizeUrl] = useState("");
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/phone/voice-credentials", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; providers?: ProviderCredentialStatus[] }
        | null;
      if (!mountedRef.current || !data?.ok || !Array.isArray(data.providers)) return;
      setCredentials((current) => {
        const next = { ...current };
        for (const status of data.providers ?? []) {
          if (status?.id) next[status.id] = { ...emptyStatus(status.id), ...status };
        }
        return next;
      });
      setReady(true);
    } catch {
      // Presence polling is best-effort; the panel still renders with defaults.
    }
  }, []);

  // Poll while the voice panel is open so an OAuth connect or a key save in
  // another tab/window reflects here without a manual refresh.
  useEffect(() => {
    if (!active) return undefined;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  const saveKey = useCallback(
    async (providerId: string, value: string) => {
      setError("");
      try {
        const response = await fetch("/api/phone/voice-credentials", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "save-key", provider: providerId, value }),
        });
        const data = (await response.json().catch(() => null)) as
          | { ok?: boolean; providers?: ProviderCredentialStatus[]; error?: string }
          | null;
        if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not save the key.");
        if (mountedRef.current && Array.isArray(data.providers)) {
          setCredentials((current) => {
            const next = { ...current };
            for (const status of data.providers ?? []) {
              if (status?.id) next[status.id] = { ...emptyStatus(status.id), ...status };
            }
            return next;
          });
        }
        return { ok: true as const };
      } catch (saveError) {
        const message = saveError instanceof Error ? saveError.message : "Could not save the key.";
        if (mountedRef.current) setError(message);
        return { ok: false as const, error: message };
      }
    },
    [],
  );

  const connectOauth = useCallback(async (providerId: string) => {
    const provider = voiceProviderById(providerId);
    if (!provider?.oauth) return;
    setOauthBusyProvider(providerId);
    setError("");
    try {
      const response = await fetch(provider.oauth.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; authorizeUrl?: string; error?: string }
        | null;
      if (!data?.ok || !data.authorizeUrl) throw new Error(data?.error || "Could not start the sign-in.");
      setOauthAuthorizeUrl(data.authorizeUrl);
      // Tauri's webview swallows window.open, so fall back to the system browser
      // opener; the rendered link is the final manual fallback.
      const popup = window.open(data.authorizeUrl, "_blank", "noopener");
      if (!popup) {
        const opened = await fetch("/api/system/browsers/open", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: data.authorizeUrl }),
        })
          .then((openResponse) => openResponse.ok)
          .catch(() => false);
        if (!opened) setError("Could not open a browser automatically — use the sign-in link below.");
      }
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : String(connectError));
    } finally {
      if (mountedRef.current) setOauthBusyProvider("");
    }
  }, []);

  return {
    credentials,
    ready,
    error,
    oauthBusyProvider,
    oauthAuthorizeUrl,
    refresh,
    saveKey,
    connectOauth,
  };
}
