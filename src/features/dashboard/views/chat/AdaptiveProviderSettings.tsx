"use client";

import { Check, Cpu, PlugZap } from "lucide-react";
import type React from "react";
import { HIVEMIND_OS_RUNTIME, type AdaptiveRoutingConfig, type AgentRuntime } from "@/lib/types/agent-runtime";

const inputStyle = {
  width: "100%",
  minWidth: 0,
  border: "1px solid var(--line-2)",
  borderRadius: 9,
  background: "rgba(2,6,23,0.48)",
  color: "var(--fg)",
  fontFamily: "var(--f-body)",
  fontSize: 13,
  outline: "none",
  padding: "9px 12px",
};

function titleCaseId(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ color: "var(--fg-3)", fontSize: 12, fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({ label, sub, checked, onChange, icon: RowIcon }: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: React.ComponentType<any>;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 14px",
      borderRadius: 11,
      border: `1px solid ${checked ? "var(--aeon-line)" : "var(--line)"}`,
      background: checked ? "var(--aeon-soft)" : "var(--panel-bg-soft)",
    }}>
      {RowIcon ? <RowIcon size={17} style={{ color: checked ? "var(--cyan-2)" : "var(--fg-4)", flex: "0 0 auto" }} aria-hidden="true" /> : null}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: "var(--fg)", fontSize: 13.5, fontWeight: 700 }}>{label}</div>
        {sub ? <div style={{ marginTop: 2, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.45 }}>{sub}</div> : null}
      </div>
      <button
        type="button"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        style={{
          position: "relative",
          width: 38,
          height: 22,
          flex: "0 0 auto",
          border: `1px solid ${checked ? "var(--aeon-line)" : "var(--line-2)"}`,
          borderRadius: 999,
          background: checked ? "rgba(94,234,212,0.34)" : "rgba(2,6,23,0.58)",
          cursor: "pointer",
        }}
      >
        <span aria-hidden="true" style={{ position: "absolute", top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: 999, background: checked ? "var(--aeon)" : "var(--fg-4)", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }} />
      </button>
    </div>
  );
}

export function AdaptiveProviderSettings({
  activeRuntime,
  adaptiveRouting,
  runtimeModelProviders,
  usePodSetupComplete,
  bankrLlmSelected,
  onUpdate,
}: {
  activeRuntime: AgentRuntime;
  adaptiveRouting: AdaptiveRoutingConfig;
  runtimeModelProviders: Array<{ slug: string }>;
  usePodSetupComplete: boolean;
  bankrLlmSelected: boolean;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const configuredProviderSlugs = new Set(runtimeModelProviders.map((provider) => provider.slug));
  const disabledProviders = new Set((adaptiveRouting.disabledProviders ?? []).map((item: string) => item.toLowerCase()));
  const runtimeSet = new Set(adaptiveRouting.enabledRuntimes?.length ? adaptiveRouting.enabledRuntimes : ["hermes", HIVEMIND_OS_RUNTIME]);
  const toggleProvider = (provider: string, enabled: boolean) => {
    const next = new Set(disabledProviders);
    if (enabled) next.delete(provider);
    else next.add(provider);
    onUpdate({ disabledProviders: [...next].sort() });
  };
  const toggleRuntime = (runtime: AgentRuntime, enabled: boolean) => {
    const next = new Set(runtimeSet);
    if (enabled) next.add(runtime);
    else next.delete(runtime);
    onUpdate({ enabledRuntimes: [...next] });
  };
  const providerRows = [
    { slug: "openrouter", name: "OpenRouter", ready: configuredProviderSlugs.has("openrouter"), detail: configuredProviderSlugs.has("openrouter") ? "Runtime provider configured" : "Uses OPENROUTER_API_KEY when present" },
    { slug: "lm-studio", name: "Local OpenAI", ready: configuredProviderSlugs.has("lm-studio"), detail: configuredProviderSlugs.has("lm-studio") ? "Local provider discovered" : "Enable when local models are available" },
    { slug: "ollama", name: "Ollama", ready: configuredProviderSlugs.has("ollama"), detail: configuredProviderSlugs.has("ollama") ? "Local provider discovered" : "Enable when Ollama is configured" },
    { slug: "bankr", name: "Bankr LLM", ready: bankrLlmSelected || configuredProviderSlugs.has("bankr"), detail: bankrLlmSelected || configuredProviderSlugs.has("bankr") ? "Gateway selected or discovered" : "Uses BANKR_LLM_KEY when present" },
    { slug: "usepod", name: "UsePod", ready: usePodSetupComplete || configuredProviderSlugs.has("usepod"), detail: usePodSetupComplete ? "Marketplace balance ready" : "Requires UsePod setup" },
  ];
  return (
    <details open style={{ border: "1px solid var(--line)", borderRadius: 11, background: "var(--panel-bg-soft)", padding: 12 }}>
      <summary style={{ color: "var(--fg)", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Adaptive provider</summary>
      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Routing mode">
            <select value={adaptiveRouting.mode || "best-free"} onChange={(event) => onUpdate({ mode: event.target.value })} style={inputStyle}>
              <option value="best-free">Best free</option>
              <option value="free-then-fallback">Free then fallback</option>
            </select>
          </Field>
          <Field label="Agent type">
            <select value={adaptiveRouting.useCase || "auto"} onChange={(event) => onUpdate({ useCase: event.target.value })} style={inputStyle}>
              {["auto", "coding", "writing", "vision", "image", "research", "tool-use"].map((option) => <option value={option} key={option}>{titleCaseId(option)}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
          <ToggleRow label="Hermes" sub={activeRuntime === "hermes" ? "Current runtime" : "Use when this profile runs through Hermes"} checked={runtimeSet.has("hermes")} onChange={(checked) => toggleRuntime("hermes", checked)} icon={Cpu} />
          <ToggleRow label="Direct provider route" sub="Use OpenAI-compatible provider APIs without changing this agent runtime" checked={runtimeSet.has(HIVEMIND_OS_RUNTIME)} onChange={(checked) => toggleRuntime(HIVEMIND_OS_RUNTIME, checked)} icon={PlugZap} />
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {providerRows.map((provider) => (
            <ToggleRow key={provider.slug} label={provider.name} sub={`${provider.ready ? "Ready or configured" : "Not configured yet"} · ${provider.detail}`} checked={!disabledProviders.has(provider.slug)} onChange={(checked) => toggleProvider(provider.slug, checked)} icon={provider.ready ? Check : PlugZap} />
          ))}
        </div>
      </div>
    </details>
  );
}
