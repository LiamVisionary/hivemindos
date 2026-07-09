"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, PlugZap, RefreshCcw, ShieldCheck } from "lucide-react";
import type { ProviderCredentialMode } from "@/features/dashboard/model-provider-view";
import { HiveEnvKeyInput } from "@/features/env/HiveEnvKeyInput";
import styles from "@/features/env/hive-env-honey.module.css";

type AuthMode = ProviderCredentialMode;

type SetupActionResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  authorizeUrl?: string;
  authorizationUrl?: string;
  statusEndpoint?: string;
  warnings?: string[];
} | void;

type MissingSharedEnvKeySetupProps = {
  apiKeyName: string;
  providerLabel?: string;
  envPath?: string;
  detail?: string;
  issue?: "missing" | "invalid";
  /** When set, also propagate the saved key into Hermes' env store. */
  hermesProvider?: string;
  /** Whether Hermes already holds this key (gates the overwrite toggle). */
  hermesKeyPresent?: boolean;
  oauthLabel?: string;
  oauthDetail?: string;
  oauthStatusEndpoint?: string;
  initialAuthMode?: AuthMode;
  onAuthModeChange?: (mode: AuthMode) => void;
  onOAuthConnect?: () => Promise<SetupActionResult> | SetupActionResult;
  onOAuthCodeSubmit?: (code: string) => Promise<SetupActionResult> | SetupActionResult;
  onOAuthConnected?: () => void | Promise<void>;
  onSaved?: () => void | Promise<void>;
};

const SETUP_CARD_MIN_HEIGHT = 240;
const SUCCESS_HOLD_MS = 3000;
const SUCCESS_FADE_MS = 450;

async function readEnvSaveResponse(response: Response | null, apiKeyName: string) {
  if (!response) {
    return { ok: false, error: `Could not reach the dashboard env API while saving ${apiKeyName}.` };
  }
  const text = await response.text().catch(() => "");
  let data: { ok?: boolean; error?: string } | null = null;
  try {
    data = text ? JSON.parse(text) as { ok?: boolean; error?: string } : null;
  } catch {
    data = null;
  }
  if (response.ok && data?.ok) return { ok: true, error: "" };
  if (typeof data?.error === "string" && data.error.trim()) {
    return { ok: false, error: data.error.trim() };
  }
  const status = `${response.status} ${response.statusText || "HTTP error"}`.trim();
  const safeText = text && !/<html|<!doctype/i.test(text) ? text.trim().slice(0, 280) : "";
  return { ok: false, error: safeText || `${status} while saving ${apiKeyName}.` };
}

export function MissingSharedEnvKeySetup({
  apiKeyName,
  providerLabel = "This provider",
  envPath = "~/.hivemindos/.env",
  detail,
  issue = "missing",
  hermesProvider,
  hermesKeyPresent = false,
  oauthLabel,
  oauthDetail,
  oauthStatusEndpoint: configuredOAuthStatusEndpoint,
  initialAuthMode = "api-key",
  onAuthModeChange,
  onOAuthConnect,
  onOAuthCodeSubmit,
  onOAuthConnected,
  onSaved,
}: MissingSharedEnvKeySetupProps) {
  const [authMode, setAuthMode] = useState<AuthMode>(initialAuthMode);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [oauthStarting, setOauthStarting] = useState(false);
  const [oauthStarted, setOauthStarted] = useState(false);
  const [oauthConnected, setOauthConnected] = useState(false);
  const [oauthConnectedFromExisting, setOauthConnectedFromExisting] = useState(false);
  const [oauthAuthorizeUrl, setOauthAuthorizeUrl] = useState("");
  const [oauthStatusEndpoint, setOauthStatusEndpoint] = useState("");
  const [oauthCode, setOauthCode] = useState("");
  const [oauthCodeSubmitting, setOauthCodeSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [explaining, setExplaining] = useState(false);
  const [saved, setSaved] = useState(false);
  const [updateHermes, setUpdateHermes] = useState(false);
  const [successFading, setSuccessFading] = useState(false);
  const fadeTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const clearSuccessTimers = useCallback(() => {
    if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    fadeTimerRef.current = null;
    refreshTimerRef.current = null;
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    clearSuccessTimers();
  }, [clearSuccessTimers]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAuthMode(initialAuthMode), 0);
    return () => window.clearTimeout(timer);
  }, [initialAuthMode]);

  const selectAuthMode = useCallback((mode: AuthMode) => {
    setAuthMode(mode);
    onAuthModeChange?.(mode);
  }, [onAuthModeChange]);

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setStatus(`Enter ${apiKeyName} before saving.`);
      return;
    }
    setSaving(true);
    setStatus(`Saving ${apiKeyName} with hive-env-add...`);
    try {
      const response = await fetch("/api/env", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: "shared", key: apiKeyName, value: trimmed }),
      }).catch(() => null);
      const result = await readEnvSaveResponse(response, apiKeyName).catch((error: unknown) => ({
        ok: false,
        error: error instanceof Error ? error.message : `Could not read the save response for ${apiKeyName}.`,
      }));
      if (!result.ok) {
        setStatus(result.error || `Could not save ${apiKeyName}.`);
        return;
      }
      // Propagate the credential into Hermes' env store so Hermes-runtime agents
      // can use it: auto-write when Hermes doesn't have it; only overwrite an
      // existing Hermes key when the user opted in via the toggle.
      if (hermesProvider && (!hermesKeyPresent || updateHermes)) {
        const hermesResponse = await fetch("/api/env", {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId: "runtime-hermes", key: apiKeyName, value: trimmed }),
        }).catch(() => null);
        const hermesResult = await readEnvSaveResponse(hermesResponse, apiKeyName).catch(() => ({ ok: false, error: "" }));
        if (!hermesResult.ok) {
          // Shared save succeeded; surface the Hermes failure without losing the key.
          setStatus(`Saved ${apiKeyName} to the shared hive env, but could not update Hermes: ${hermesResult.error || "unknown error"}.`);
          return;
        }
      }
      setValue("");
      setStatus("");
      setExplaining(false);
      setSaved(true);
      setSuccessFading(false);
      clearSuccessTimers();
      fadeTimerRef.current = window.setTimeout(() => {
        setSuccessFading(true);
        fadeTimerRef.current = null;
      }, SUCCESS_HOLD_MS);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void Promise.resolve(onSaved?.()).catch((error: unknown) => {
          if (!mountedRef.current) return;
          setStatus(error instanceof Error ? error.message : `Saved ${apiKeyName}, but could not reload providers.`);
        }).finally(() => {
          if (!mountedRef.current) return;
          setSaved(false);
          setSuccessFading(false);
        });
      }, SUCCESS_HOLD_MS + SUCCESS_FADE_MS);
    } finally {
      setSaving(false);
    }
  };

  const openOAuthAuthorizeUrl = async (authorizeUrl: string) => {
    const opened = await fetch("/api/system/browsers/open", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: authorizeUrl }),
    }).then((response) => response.ok).catch(() => false);
    if (opened) return true;
    const popup = window.open(authorizeUrl, "_blank", "noopener");
    return Boolean(popup);
  };

  const completeOAuthConnection = useCallback(async (warnings: string[] = [], options: { switchProvider?: boolean; revealOAuth?: boolean; silent?: boolean } = {}) => {
    if (!mountedRef.current) return;
    if (options.revealOAuth !== false) setAuthMode("oauth");
    setOauthStarted(true);
    setOauthConnected(true);
    const shouldSwitchProvider = Boolean(options.switchProvider);
    setOauthConnectedFromExisting(!shouldSwitchProvider);
    const warningText = warnings.length ? ` ${warnings.join(" ")}` : "";
    if (!options.silent) {
      setStatus(`${oauthLabel || providerLabel} connected.${shouldSwitchProvider ? " Refreshing models." : ""}${warningText}`.trim());
    }
    if (shouldSwitchProvider) {
      await Promise.resolve(onOAuthConnected?.()).catch((error: unknown) => {
        if (mountedRef.current) setStatus(error instanceof Error ? error.message : `${oauthLabel || providerLabel} connected, but the provider selection could not be updated.`);
      });
    }
    await Promise.resolve(onSaved?.()).catch((error: unknown) => {
      if (mountedRef.current) setStatus(error instanceof Error ? error.message : `${oauthLabel || providerLabel} connected, but models could not be refreshed.`);
    });
  }, [oauthLabel, onOAuthConnected, onSaved, providerLabel]);

  const activateOAuthProvider = useCallback(async () => {
    setStatus(`Switching to ${oauthLabel || providerLabel} models...`);
    setOauthConnectedFromExisting(false);
    await Promise.resolve(onOAuthConnected?.()).catch((error: unknown) => {
      if (mountedRef.current) setStatus(error instanceof Error ? error.message : `${oauthLabel || providerLabel} connected, but the provider selection could not be updated.`);
    });
    await Promise.resolve(onSaved?.()).catch((error: unknown) => {
      if (mountedRef.current) setStatus(error instanceof Error ? error.message : `${oauthLabel || providerLabel} connected, but models could not be refreshed.`);
    });
  }, [oauthLabel, onOAuthConnected, onSaved, providerLabel]);

  const startOAuth = async () => {
    if (!onOAuthConnect) return;
    setOauthStarting(true);
    setStatus(`Starting ${oauthLabel || providerLabel} OAuth sign-in...`);
    try {
      const result = await onOAuthConnect();
      if (result && result.ok === false) {
        setStatus(result.error || `${oauthLabel || providerLabel} OAuth sign-in could not start.`);
        return;
      }
      const authorizeUrl = result?.authorizeUrl || result?.authorizationUrl || "";
      if (authorizeUrl) {
        setOauthAuthorizeUrl(authorizeUrl);
        const opened = await openOAuthAuthorizeUrl(authorizeUrl);
        if (!opened) {
          setStatus("Could not open your browser automatically. Use the sign-in link below.");
          return;
        }
      }
      setOauthStatusEndpoint(result?.statusEndpoint || configuredOAuthStatusEndpoint || "");
      setOauthStarted(true);
      setStatus(
        result?.message ||
        `${oauthLabel || providerLabel} OAuth sign-in opened. Finish the browser flow to connect.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${oauthLabel || providerLabel} OAuth sign-in could not start.`);
    } finally {
      setOauthStarting(false);
    }
  };

  const submitOAuthCode = async () => {
    const trimmed = oauthCode.trim();
    if (!trimmed || !onOAuthCodeSubmit) {
      setStatus("Paste the code xAI showed in the browser.");
      return;
    }
    setOauthCodeSubmitting(true);
    setStatus(`Submitting ${oauthLabel || providerLabel} OAuth code...`);
    try {
      const result = await onOAuthCodeSubmit(trimmed);
      if (result && result.ok === false) {
        setStatus(result.error || `${oauthLabel || providerLabel} OAuth code could not be accepted.`);
        return;
      }
      setOauthCode("");
      await completeOAuthConnection(result?.warnings ?? [], { switchProvider: true });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${oauthLabel || providerLabel} OAuth code could not be accepted.`);
    } finally {
      setOauthCodeSubmitting(false);
    }
  };

  useEffect(() => {
    if (!configuredOAuthStatusEndpoint || oauthConnected) return undefined;
    let cancelled = false;
    const checkExistingOAuth = async () => {
      const response = await fetch(configuredOAuthStatusEndpoint, { cache: "no-store" }).catch(() => null);
      const data = await response?.json().catch(() => null) as {
        ok?: boolean;
        connected?: boolean;
        warnings?: string[];
        login?: { phase?: string; error?: string; warnings?: string[] };
      } | null;
      if (cancelled || !data?.ok) return;
      if (data.connected || data.login?.phase === "connected") {
        setOauthStatusEndpoint(configuredOAuthStatusEndpoint);
        const shouldSwitchProvider = authMode === "oauth";
        await completeOAuthConnection([...(data.warnings ?? []), ...(data.login?.warnings ?? [])], {
          switchProvider: shouldSwitchProvider,
          revealOAuth: shouldSwitchProvider,
          silent: !shouldSwitchProvider,
        });
      }
    };
    const timer = window.setTimeout(() => void checkExistingOAuth(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authMode, completeOAuthConnection, configuredOAuthStatusEndpoint, oauthConnected]);

  useEffect(() => {
    if (authMode !== "oauth" || !oauthConnected || !oauthConnectedFromExisting || !onOAuthConnected) return;
    const timer = window.setTimeout(() => void activateOAuthProvider(), 0);
    return () => window.clearTimeout(timer);
  }, [activateOAuthProvider, authMode, oauthConnected, oauthConnectedFromExisting, onOAuthConnected]);

  useEffect(() => {
    if (!oauthStarted || !oauthStatusEndpoint || oauthConnected) return undefined;
    let cancelled = false;
    const poll = async () => {
      const response = await fetch(oauthStatusEndpoint, { cache: "no-store" }).catch(() => null);
      const data = await response?.json().catch(() => null) as {
        ok?: boolean;
        connected?: boolean;
        warnings?: string[];
        login?: { phase?: string; error?: string; warnings?: string[] };
      } | null;
      if (cancelled || !data?.ok) return;
      if (data.connected || data.login?.phase === "connected") {
        await completeOAuthConnection([...(data.warnings ?? []), ...(data.login?.warnings ?? [])], { switchProvider: true });
        return;
      }
      if (data.login?.phase === "error" && data.login.error) {
        setStatus(data.login.error);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [completeOAuthConnection, oauthConnected, oauthStarted, oauthStatusEndpoint]);

  if (saved) {
    return (
      <section
        className={`${styles.scope} ${styles.card} ${styles.successCard} transition duration-500 ${successFading ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"}`}
        style={{ minHeight: SETUP_CARD_MIN_HEIGHT }}
        aria-live="polite"
      >
        <div className={styles.infoRow}>
          <span className={`${styles.badge} ${styles.badgeLive}`}>
            <span className={styles.ping} aria-hidden="true" />
            <CheckCircle2 aria-hidden="true" style={{ position: "relative", width: 20, height: 20 }} />
          </span>
          <div>
            <p className="eyebrow">Saved</p>
            <h3 className={styles.heading}>{apiKeyName} saved to the shared hive brain</h3>
            <p className={styles.subtext}>Reloading provider models with the updated shared env.</p>
          </div>
        </div>
      </section>
    );
  }

  if (explaining) {
    return (
      <section className={`${styles.scope} ${styles.card}`} style={{ minHeight: SETUP_CARD_MIN_HEIGHT }}>
        <div className={styles.infoRow}>
          <span className={styles.badge}>
            <ShieldCheck aria-hidden="true" style={{ width: 20, height: 20 }} />
          </span>
          <div>
            <p className="eyebrow">hive-env-add</p>
            <h3 className={styles.heading}>Shared env for all agents</h3>
            <p className={styles.subtext}>
              <code className={styles.code}>hive-env-add</code> writes secrets to the HivemindOS shared env store at{" "}
              <code className={styles.code}>{envPath}</code> without printing secret values. The dashboard, local agent bridge, and supported runtimes load that store so every user runtime and agent can reuse the same configured key instead of copying credentials into each profile.
            </p>
            <p className={styles.subtext}>
              It also mirrors shared keys into runtime-specific compatibility stores where HivemindOS already supports that path, and Hivemind Sync can reconcile the same shared env across trusted machines.
            </p>
          </div>
        </div>
        <button type="button" className={styles.link} onClick={() => setExplaining(false)}>
          Back to setup
        </button>
      </section>
    );
  }

  const invalid = issue === "invalid";
  const hasOauthAlternative = Boolean(onOAuthConnect);
  const showingOAuth = hasOauthAlternative && authMode === "oauth";

  return (
    <section className={`${styles.scope} ${styles.card}`} style={{ minHeight: SETUP_CARD_MIN_HEIGHT }}>
      <div className={styles.header}>
        <div>
          <p className="eyebrow">
            {showingOAuth ? "OAuth login" : invalid ? "API key setup" : "Missing API key"}
          </p>
          <h3 className={styles.heading}>
            {showingOAuth
              ? `Connect ${providerLabel} with OAuth`
              : invalid ? `${apiKeyName} needs attention` : `${apiKeyName} is missing`}
          </h3>
          <p className={styles.subtext}>
            {showingOAuth
              ? oauthDetail || `Use ${oauthLabel || "OAuth"} for ${providerLabel} instead of storing ${apiKeyName}.`
              : invalid
                ? `${apiKeyName} in the shared hive brain could not be used. Enter a fresh key here for ${providerLabel}.`
                : `${apiKeyName} is missing from the shared hive brain. Enter it here for ${providerLabel}.`}
          </p>
        </div>
        <span className={styles.pill}>{envPath}</span>
      </div>

      {hasOauthAlternative ? (
        <div className={styles.authMode} role="group" aria-label={`${providerLabel} credential method`}>
          <button
            type="button"
            className={styles.authModeButton}
            data-active={!showingOAuth ? "" : undefined}
            aria-pressed={!showingOAuth}
            onClick={() => selectAuthMode("api-key")}
          >
            <KeyRound aria-hidden="true" />
            API key
          </button>
          <button
            type="button"
            className={styles.authModeButton}
            data-active={showingOAuth ? "" : undefined}
            aria-pressed={showingOAuth}
            onClick={() => selectAuthMode("oauth")}
          >
            <PlugZap aria-hidden="true" />
            OAuth
          </button>
        </div>
      ) : null}

      {showingOAuth ? (
        <div className={styles.oauthPanel}>
          <div className={styles.oauthActions}>
            <button type="button" className={styles.saveBtn} disabled={oauthStarting} onClick={() => void startOAuth()}>
              {oauthStarting ? <RefreshCcw className={styles.spin} aria-hidden="true" /> : <PlugZap aria-hidden="true" />}
              {oauthStarting ? "Opening sign-in" : oauthStarted && !oauthConnected ? `Retry ${oauthLabel || "OAuth sign-in"}` : oauthConnected ? `Reconnect ${oauthLabel || "OAuth"}` : `Connect ${oauthLabel || "OAuth"}`}
            </button>
            {oauthStarted || oauthConnected ? (
              <button type="button" className={styles.secondaryBtn} onClick={() => void onSaved?.()}>
                Refresh models
              </button>
            ) : null}
          </div>
          {oauthConnected ? (
            <p className={styles.hint}>
              {oauthLabel || providerLabel} is connected through OAuth.
            </p>
          ) : null}
          {oauthAuthorizeUrl && !oauthConnected ? (
            <p className={styles.hint}>
              Sign-in opened in your browser.{" "}
              <a href={oauthAuthorizeUrl} target="_blank" rel="noopener noreferrer" className={styles.inlineLink}>
                Open the sign-in page
              </a>{" "}
              if nothing appeared.
            </p>
          ) : null}
          {oauthStarted && !oauthConnected && onOAuthCodeSubmit ? (
            <div className={styles.oauthCodePanel}>
              <input
                className={`${styles.field} ${styles.oauthCodeField}`}
                value={oauthCode}
                onChange={(event) => setOauthCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitOAuthCode();
                }}
                placeholder="Code from xAI"
                autoComplete="one-time-code"
                spellCheck={false}
              />
              <button type="button" className={styles.secondaryBtn} disabled={oauthCodeSubmitting} onClick={() => void submitOAuthCode()}>
                {oauthCodeSubmitting ? <RefreshCcw className={styles.spin} aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                Submit code
              </button>
            </div>
          ) : null}
          {!oauthConnected ? (
            <p className={styles.hint}>
              Finish the browser login. If xAI shows a Grok Build code instead of returning here, paste that code above. HivemindOS saves OAuth tokens to the shared hive env and syncs supported runtimes when the flow completes.
            </p>
          ) : null}
        </div>
      ) : (
        <HiveEnvKeyInput
          value={value}
          onValueChange={setValue}
          onSave={() => void save()}
          saving={saving}
          saveLabel="Save key"
          valuePlaceholder={`${apiKeyName} value`}
        />
      )}

      {!showingOAuth && hermesProvider && hermesKeyPresent ? (
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={updateHermes}
            onChange={(event) => setUpdateHermes(event.target.checked)}
          />
          <span>Hermes already has a {providerLabel} key configured — also update Hermes with this one.</span>
        </label>
      ) : null}
      {!showingOAuth ? (
        <p className={styles.hint}>
          Or run <code className={styles.code}>hive-env-add {apiKeyName}</code>, or add it to <code className={styles.code}>{envPath}</code>.
          {hermesProvider && !hermesKeyPresent ? " Saving also adds it to Hermes." : ""}
        </p>
      ) : null}
      {detail ? <p className={styles.hint}>{detail}</p> : null}
      {status ? <p className={styles.status}>{status}</p> : null}
      {!showingOAuth ? (
        <button type="button" className={styles.link} onClick={() => setExplaining(true)}>
          How does hive-env-add work?
        </button>
      ) : null}
    </section>
  );
}
