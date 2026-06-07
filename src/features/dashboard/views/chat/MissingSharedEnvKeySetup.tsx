"use client";

import { useState } from "react";
import { LoaderCircle, Plus, ShieldCheck } from "lucide-react";
import { maskedSecretValueClass, secretInputProps } from "@/components/ui/secret-input-props";

type MissingSharedEnvKeySetupProps = {
  apiKeyName: string;
  providerLabel?: string;
  envPath?: string;
  detail?: string;
  onSaved?: () => void | Promise<void>;
};

export function MissingSharedEnvKeySetup({
  apiKeyName,
  providerLabel = "This provider",
  envPath = "~/.hivemindos/.env",
  detail,
  onSaved,
}: MissingSharedEnvKeySetupProps) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [explaining, setExplaining] = useState(false);

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: "shared", key: apiKeyName, value: trimmed }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response?.ok || !data?.ok) {
        setStatus(data?.error ?? `Could not save ${apiKeyName}.`);
        return;
      }
      setValue("");
      setStatus(`Saved ${apiKeyName} with hive-env-add.`);
      await onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  if (explaining) {
    return (
      <section className="grid gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 text-[var(--accent-strong)]" />
          <div>
            <p className="eyebrow">hive-env-add</p>
            <h3 className="m-0 text-base font-bold text-[var(--foreground)]">Shared env for all agents</h3>
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">
              `hive-env-add` writes secrets to the HivemindOS shared env store at `{envPath}` without printing secret values. The dashboard, local agent bridge, and supported runtimes load that store so every user runtime and agent can reuse the same configured key instead of copying credentials into each profile.
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

  return (
    <section className="grid gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Missing API key</p>
          <h3 className="m-0 text-base font-bold text-[var(--foreground)]">{apiKeyName} is missing</h3>
          <p className="m-0 mt-1 text-xs text-[var(--muted)]">
            {apiKeyName} is missing from the shared hive brain. Enter it here for {providerLabel}.
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

      <p className="m-0 text-xs leading-5 text-[var(--muted)]">
        Or run <code className="font-mono text-[var(--foreground)]">hive-env-add {apiKeyName}</code>, or add it to <code className="font-mono text-[var(--foreground)]">{envPath}</code>.
      </p>
      {detail ? <p className="m-0 text-xs leading-5 text-[var(--muted)]">{detail}</p> : null}
      {status ? <p className="m-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] px-3 py-2 text-xs text-[var(--foreground)]">{status}</p> : null}
      <button type="button" className="justify-self-start text-xs font-semibold text-[var(--muted)] hover:text-[var(--accent-strong)] hover:underline" onClick={() => setExplaining(true)}>
        How does hive-env-add work?
      </button>
    </section>
  );
}
