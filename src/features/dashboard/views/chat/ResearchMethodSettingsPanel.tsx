"use client";

import { Check, Search } from "lucide-react";
import { Pill, aeonStyles as styles } from "@/components/aeon/parts";
import { DEFAULT_RESEARCH_METHOD, RESEARCH_METHODS, RESEARCH_OUTPUT_SECTIONS, normalizeResearchMethod } from "@/lib/config/research-methods";
import type { ResearchMethod } from "@/lib/types/agent-runtime";

type ResearchMethodSettingsPanelProps = {
  value?: ResearchMethod;
  onChange: (researchMethod: ResearchMethod) => void;
};

export function ResearchMethodSettingsPanel({ value, onChange }: ResearchMethodSettingsPanelProps) {
  const selectedResearchMethod = normalizeResearchMethod(value);
  const selectedMethod = RESEARCH_METHODS.find((method) => method.id === selectedResearchMethod)
    ?? RESEARCH_METHODS.find((method) => method.id === DEFAULT_RESEARCH_METHOD);
  return (
    <div style={{ display: "grid", gap: 10, padding: 13, borderRadius: 11, border: "1px solid rgba(94,234,212,0.24)", background: "rgba(20,184,166,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <Search size={15} aria-hidden="true" style={{ color: "var(--cyan-3)" }} />
        <strong style={{ color: "var(--fg)", fontSize: 13.5 }}>Research method</strong>
        {selectedMethod ? <Pill tone="cyan">{selectedMethod.label}</Pill> : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        {RESEARCH_METHODS.map((method) => {
          const selected = selectedResearchMethod === method.id;
          return (
            <button
              className={styles.interactive}
              type="button"
              key={method.id}
              aria-pressed={selected}
              onClick={() => onChange(method.id)}
              style={{
                display: "grid",
                alignContent: "start",
                gap: 5,
                minHeight: 86,
                padding: "10px 11px",
                borderRadius: 9,
                border: `1px solid ${selected ? "var(--aeon-line)" : "var(--line)"}`,
                background: selected ? "var(--aeon-soft)" : "var(--panel-bg-soft)",
                color: selected ? "var(--cyan-3)" : "var(--fg-2)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 800, fontSize: 12.5 }}>
                {selected ? <Check size={13} aria-hidden="true" /> : null}
                {method.label}
              </span>
              <span style={{ color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.45 }}>{method.summary}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {RESEARCH_OUTPUT_SECTIONS.map((section) => <Pill key={section} tone="muted">{section}</Pill>)}
      </div>
    </div>
  );
}
