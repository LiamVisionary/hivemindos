"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createStyleClass } from "@/features/dashboard/style-classes";
import brainServiceStyles from "./brain-services.module.css";

const brainClass = createStyleClass(brainServiceStyles);

type SecuritySettings = { engine: "auto" | "regex" | "skillspector"; llm: boolean };

type SecurityLlmRoutingInfo =
  | {
      source: "security-subclass" | "queen-bee";
      agentId: string;
      agentName: string;
      provider: string;
      model?: string;
      credentialReady: boolean;
    }
  | { unavailable: string };

const ENGINES: { id: SecuritySettings["engine"]; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "regex", label: "Regex only" },
  { id: "skillspector", label: "SkillSpector" },
];

/**
 * Self-contained brain-service card for skill import security: which scanner
 * runs before a skill is imported, plus the optional LLM-judged pass. Fetches
 * and persists its own state via /api/skills/security.
 */
export function SkillSecurityCard() {
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [scannerAvailable, setScannerAvailable] = useState(false);
  const [llmRouting, setLlmRouting] = useState<SecurityLlmRoutingInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyResult = useCallback((json: { settings?: SecuritySettings; scannerAvailable?: boolean; llmRouting?: SecurityLlmRoutingInfo }) => {
    setSettings(json.settings ?? null);
    setScannerAvailable(Boolean(json.scannerAvailable));
    setLlmRouting(json.llmRouting ?? null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/skills/security", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (json.ok) { applyResult(json); setError(null); }
      else if (res.status === 401) setError("Dashboard authentication required.");
    } catch {
      setError("Could not reach the skill-security API.");
    }
  }, [applyResult]);

  const update = useCallback(async (patch: { engine?: string; llm?: boolean }) => {
    setBusy(true);
    try {
      const res = await fetch("/api/skills/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (json.ok) applyResult(json);
      else if (json.error) setError(json.error);
    } finally {
      setBusy(false);
    }
  }, [applyResult]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initial);
  }, [refresh]);

  const live = scannerAvailable || settings?.llm;
  const engineLabel = ENGINES.find((opt) => opt.id === settings?.engine)?.label ?? "Regex";

  return (
    <article className={brainClass("brainServiceOverviewCard", live ? "live" : "idle")}>
      <div className={brainClass("brainServiceOverviewTopline")}>
        <span className={brainClass("brainServiceOverviewIcon")}><ShieldCheck aria-hidden="true" /></span>
        <small className={brainClass(live ? "serviceBadgeLive" : "serviceBadgeIdle")}>{engineLabel}</small>
      </div>
      <div>
        <small>Import safety</small>
        <h4>Skill security</h4>
        <p>How skills are scanned for malicious or risky code before import. SkillSpector adds AST, YARA, and CVE detection on top of the built-in regex rules.</p>
      </div>

      {error ? <p style={{ fontSize: 12, color: "var(--rose-2,#fb7185)" }}>{error}</p> : null}

      <div style={{ display: "grid", gap: 6 }}>
        <small style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>Detection engine</small>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ENGINES.map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={settings?.engine === opt.id ? "default" : "outline"}
              disabled={busy}
              onClick={() => void update({ engine: opt.id })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <small style={{ fontSize: 12, color: "var(--muted)" }}>
          {scannerAvailable
            ? "SkillSpector CLI detected on this machine."
            : "SkillSpector CLI not found — Auto falls back to regex. Install: github.com/NVIDIA/SkillSpector (Python 3.12+)."}
        </small>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, borderTop: "1px solid rgba(148,163,184,0.14)", paddingTop: 10 }}>
        <div>
          <strong style={{ fontSize: 13 }}>LLM-powered security pass</strong>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Adds a model-judged pass to cut false positives and flag malicious intent. Slower and billed.</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={settings?.llm ? "default" : "outline"}
          disabled={busy || !settings}
          onClick={() => void update({ llm: !settings?.llm })}
        >
          {settings?.llm ? "On" : "Off"}
        </Button>
      </div>

      {settings?.llm ? (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
          {llmRouting && "unavailable" in llmRouting ? (
            <span style={{ color: "var(--rose-2,#fb7185)" }}>LLM pass cannot route yet: {llmRouting.unavailable}</span>
          ) : llmRouting ? (
            <span style={llmRouting.credentialReady ? undefined : { color: "var(--rose-2,#fb7185)" }}>
              Routes through <strong>{llmRouting.agentName}</strong>{" "}
              ({llmRouting.source === "security-subclass" ? "security bee" : "Queen Bee"}) · {llmRouting.provider}
              {llmRouting.model ? ` · ${llmRouting.model}` : ""}
              {llmRouting.credentialReady ? "" : " — credential not set"}
            </span>
          ) : (
            <span>Resolving routing…</span>
          )}
        </p>
      ) : null}
    </article>
  );
}
