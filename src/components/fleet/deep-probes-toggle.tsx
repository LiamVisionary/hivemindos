// src/components/fleet/deep-probes-toggle.tsx
// Fleet-wide switch for the fleet-health-watchdog's deep functional probes
// (real agent /chat dispatch + TTS synth — they cost tokens). The watchdog
// (scripts/fleet-health-watchdog.mjs) re-reads ~/.hivemindos/.env every cycle
// and the shared hive env replicates fleet-wide, so this one toggle controls
// every machine's watchdog. ON writes FLEET_WATCHDOG_DEEP_PROBES=1 through
// /api/env (hive-env-add); OFF writes an empty value, which hive-env-add
// treats as key removal. The shared env is the source of truth — no local
// persistence here. Renders on both fleet surfaces: `classic` (FleetView left
// rail, fleet-tokens palette) and `hive` (HivePanel queen overview, fr-*
// theme variables).
"use client";

import * as React from "react";
import { readNativeHiveEnv } from "@/lib/native/hive-env";

const DEEP_PROBES_ENV_KEY = "FLEET_WATCHDOG_DEEP_PROBES";

const EXPLAINER =
  "Watchdog dispatches a tiny real agent chat + TTS synth every ~15 min per machine to catch alive-but-broken daemons. Uses tokens.";
const PILL_TITLE =
  "One switch for every machine's watchdog — stored as FLEET_WATCHDOG_DEEP_PROBES in the shared hive env, which replicates fleet-wide.";

type EnvPayload = {
  ok?: boolean;
  error?: string;
  sharedSource?: { values?: Record<string, string> };
};

// Mirrors deepProbesEnabled() in scripts/fleet-health-watchdog.mjs.
function parseEnabled(raw: string | undefined) {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "1" || value === "true";
}

type Variant = "classic" | "hive";

const CARD_STYLE: Record<Variant, React.CSSProperties> = {
  classic: {
    border: "1px solid rgba(148,163,184,0.16)",
    borderRadius: 12,
    padding: 14,
    background: "rgba(16,20,29,0.48)",
  },
  hive: {
    border: "1px solid var(--line)",
    borderRadius: "var(--radius-sm)",
    padding: "12px 14px",
    background: "var(--panel)",
  },
};

const LABEL_STYLE: Record<Variant, React.CSSProperties> = {
  classic: { fontFamily: "var(--f-display)", fontSize: 14, fontWeight: 700, lineHeight: 1.2 },
  hive: { fontSize: 13, fontWeight: 500, color: "var(--fg-2)", lineHeight: 1.2 },
};

const SUB_STYLE: Record<Variant, React.CSSProperties> = {
  classic: { fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginTop: 6 },
  hive: { fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.5, marginTop: 6 },
};

const ERROR_STYLE: Record<Variant, React.CSSProperties> = {
  classic: {
    fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--danger)",
    lineHeight: 1.5, marginTop: 6, overflowWrap: "anywhere",
  },
  hive: {
    fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--danger)",
    lineHeight: 1.5, marginTop: 6, overflowWrap: "anywhere",
  },
};

function pillStyle(variant: Variant, on: boolean, busy: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: "var(--f-mono)",
    fontWeight: 800,
    textTransform: "uppercase",
    borderRadius: 9999,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.6 : 1,
    flexShrink: 0,
  };
  if (variant === "classic") {
    // Matches the roster header's "Pause auto-update" pill (FleetView.tsx).
    return {
      ...base,
      fontSize: 9,
      letterSpacing: 0.04,
      padding: "3px 8px",
      border: `1px solid ${on ? "rgba(251,191,36,0.42)" : "rgba(148,163,184,0.22)"}`,
      background: on ? "rgba(251,191,36,0.12)" : "transparent",
      color: on ? "#fde68a" : "var(--muted)",
    };
  }
  return {
    ...base,
    fontSize: 10,
    letterSpacing: "0.08em",
    padding: "4px 10px",
    border: `1px solid ${on ? "var(--honey-line)" : "var(--line-2)"}`,
    background: on ? "var(--honey-soft)" : "transparent",
    color: on ? "var(--honey)" : "var(--fg-3)",
  };
}

export function DeepProbesToggle({ variant = "classic" }: { variant?: Variant }) {
  // null = shared-env state not loaded yet (or the read failed → retry pill).
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const mountedRef = React.useRef(true);
  React.useEffect(() => () => { mountedRef.current = false; }, []);

  const load = React.useCallback(async () => {
    setError("");
    // Same native-first read as DashboardApp's refreshHiveEnv: the packaged
    // desktop build has no /api server, so try the Tauri bridge before HTTP.
    const nativeData = await readNativeHiveEnv().catch(() => null);
    const response = nativeData ? null : await fetch("/api/env", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).catch(() => null);
    const data = nativeData ?? (await response?.json().catch(() => null)) as EnvPayload | null;
    if (!mountedRef.current) return;
    if ((!nativeData && !response?.ok) || !data?.ok) {
      setError(data?.error ?? "Could not read the shared hive env.");
      return;
    }
    setEnabled(parseEnabled(data.sharedSource?.values?.[DEEP_PROBES_ENV_KEY]));
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const toggle = React.useCallback(async () => {
    if (saving) return;
    if (enabled === null) {
      // The initial read failed — the pill doubles as a retry button.
      void load();
      return;
    }
    const next = !enabled;
    setEnabled(next); // optimistic; rolled back below on failure
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/env", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        // Empty value = hive-env-add removes the key (same contract as the
        // env panel's clear in DashboardApp.saveSharedEnvValue).
        body: JSON.stringify({ sourceId: "shared", key: DEEP_PROBES_ENV_KEY, value: next ? "1" : "" }),
      }).catch(() => null);
      const data = (await response?.json().catch(() => null)) as EnvPayload | null;
      if (!mountedRef.current) return;
      if (!response?.ok || !data?.ok) {
        setEnabled(enabled); // rollback to the pre-toggle value
        setError(data?.error ?? "Could not save to the shared hive env.");
        return;
      }
      // Reconcile with what the write actually left in the shared env.
      setEnabled(parseEnabled(data.sharedSource?.values?.[DEEP_PROBES_ENV_KEY]));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [enabled, load, saving]);

  const on = enabled === true;
  const loadFailed = enabled === null && error !== "";
  const busy = saving || (enabled === null && !loadFailed);
  const pillLabel = enabled === null ? (loadFailed ? "Retry" : "···") : on ? "On" : "Off";

  return (
    <div style={CARD_STYLE[variant]}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={LABEL_STYLE[variant]}>Deep health probes</span>
        <button
          type="button"
          data-bee="fleet-deep-probes-toggle"
          onClick={() => void toggle()}
          disabled={busy}
          aria-pressed={on}
          aria-label="Deep health probes"
          title={PILL_TITLE}
          style={pillStyle(variant, on, busy)}
        >
          {pillLabel}
        </button>
      </div>
      <div style={SUB_STYLE[variant]}>{EXPLAINER}</div>
      {error ? <div style={ERROR_STYLE[variant]}>{error}</div> : null}
    </div>
  );
}
