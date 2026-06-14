"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, Plus, ShieldCheck } from "lucide-react";
import { maskedSecretValueClass, secretInputProps } from "@/components/ui/secret-input-props";

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
  onSaved,
}: MissingSharedEnvKeySetupProps) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
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

  if (saved) {
    return (
      <section
        className={`grid gap-3 rounded-md border border-[rgba(94,234,212,0.22)] bg-[rgba(20,184,166,0.08)] p-4 transition duration-500 ${successFading ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"}`}
        style={{ minHeight: SETUP_CARD_MIN_HEIGHT }}
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[rgba(94,234,212,0.38)] bg-[rgba(20,184,166,0.14)]">
            <span className="absolute h-10 w-10 rounded-full border border-[rgba(94,234,212,0.28)] animate-ping" aria-hidden="true" />
            <CheckCircle2 aria-hidden="true" className="relative h-5 w-5 text-[var(--accent-strong)] animate-pulse" />
          </span>
          <div>
            <p className="eyebrow">Saved</p>
            <h3 className="m-0 text-base font-bold text-[var(--foreground)]">{apiKeyName} saved to the shared hive brain</h3>
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">
              Reloading provider models with the updated shared env.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (explaining) {
    return (
      <section className="grid gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-4" style={{ minHeight: SETUP_CARD_MIN_HEIGHT }}>
        <div className="flex items-start gap-3">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 text-[var(--accent-strong)]" />
          <div>
            <p className="eyebrow">hive-env-add</p>
            <h3 className="m-0 text-base font-bold text-[var(--foreground)]">Shared env for all agents</h3>
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">
              <code className="font-mono text-[var(--foreground)]">hive-env-add</code> writes secrets to the HivemindOS shared env store at{" "}
              <code className="font-mono text-[var(--foreground)]">{envPath}</code> without printing secret values. The dashboard, local agent bridge, and supported runtimes load that store so every user runtime and agent can reuse the same configured key instead of copying credentials into each profile.
            </p>
            <p className="m-0 mt-2 text-xs leading-5 text-[var(--muted)]">
              It also mirrors shared keys into runtime-specific compatibility stores where HivemindOS already supports that path, and Hivemind Sync can reconcile the same shared env across trusted machines.
            </p>
          </div>
        </div>
        <button type="button" className="justify-self-start text-xs font-semibold text-[var(--accent-strong)] hover:underline" onClick={() => setExplaining(false)}>
          Back to setup
        </button>
      </section>
    );
  }

  const invalid = issue === "invalid";

  return (
    <section className="grid gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-4" style={{ minHeight: SETUP_CARD_MIN_HEIGHT }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{invalid ? "API key setup" : "Missing API key"}</p>
          <h3 className="m-0 text-base font-bold text-[var(--foreground)]">{invalid ? `${apiKeyName} needs attention` : `${apiKeyName} is missing`}</h3>
          <p className="m-0 mt-1 text-xs text-[var(--muted)]">
            {invalid
              ? `${apiKeyName} in the shared hive brain could not be used. Enter a fresh key here for ${providerLabel}.`
              : `${apiKeyName} is missing from the shared hive brain. Enter it here for ${providerLabel}.`}
          </p>
        </div>
        <span className="rounded-full border border-[rgba(94,234,212,0.22)] bg-[rgba(20,184,166,0.08)] px-3 py-1 text-xs font-bold text-[var(--accent-strong)]">
          {envPath}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          {...secretInputProps}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
          placeholder={`${apiKeyName} value`}
          className={`min-w-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.72)] px-2 py-2 font-mono text-xs text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)] ${maskedSecretValueClass}`}
        />
        <button
          type="button"
          disabled={saving || !value.trim()}
          onClick={() => void save()}
          className="inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(15,23,42,0.72)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          title="Save this key with hive-env-add."
        >
          {saving ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Plus aria-hidden="true" className="h-4 w-4" />}
          Save key
        </button>
      </div>

      {hermesProvider && hermesKeyPresent ? (
        <label className="flex items-start gap-2 text-xs leading-5 text-[var(--muted)]">
          <input
            type="checkbox"
            checked={updateHermes}
            onChange={(event) => setUpdateHermes(event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent-strong)]"
          />
          <span>Hermes already has a {providerLabel} key configured — also update Hermes with this one.</span>
        </label>
      ) : null}
      <p className="m-0 text-xs leading-5 text-[var(--muted)]">
        Or run <code className="font-mono text-[var(--foreground)]">hive-env-add {apiKeyName}</code>, or add it to <code className="font-mono text-[var(--foreground)]">{envPath}</code>.
        {hermesProvider && !hermesKeyPresent ? " Saving also adds it to Hermes." : ""}
      </p>
      {detail ? <p className="m-0 text-xs leading-5 text-[var(--muted)]">{detail}</p> : null}
      {status ? <p className="m-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] px-3 py-2 text-xs text-[var(--foreground)]">{status}</p> : null}
      <button type="button" className="justify-self-start text-xs font-semibold text-[var(--muted)] hover:text-[var(--accent-strong)] hover:underline" onClick={() => setExplaining(true)}>
        How does hive-env-add work?
      </button>
    </section>
  );
}
