"use client";

import React from "react";
import { ShieldCheck } from "lucide-react";
import {
  COMPANY_APPROVAL_POLICY_MODES,
  resolveCompanyApprovalPolicies,
} from "@/lib/services/company-approval-policies";
import type { CompanyApprovalPolicy, CompanyApprovalPolicyMode } from "@/lib/types/company";
import { SectionLabel, Spinner } from "./primitives";
import type { Colony } from "./types";

const MODE_LABEL: Record<CompanyApprovalPolicyMode, string> = {
  off: "Off",
  ask: "Ask first",
  never: "Never",
};

const SOURCE_LABEL: Record<NonNullable<CompanyApprovalPolicy["source"]>, string> = {
  default: "Built-in",
  learning: "Learning",
  manual: "Custom",
};

function rowTone(mode: CompanyApprovalPolicyMode) {
  if (mode === "never") return { color: "var(--danger)", bg: "var(--row-blocked-bg)", border: "var(--row-blocked-bd)" };
  if (mode === "ask") return { color: "var(--honey)", bg: "var(--row-access-bg)", border: "var(--row-access-bd)" };
  return { color: "var(--fg-4)", bg: "var(--panel-2)", border: "var(--line)" };
}

function sourceLabel(policy: CompanyApprovalPolicy) {
  return SOURCE_LABEL[policy.source ?? "manual"] ?? "Custom";
}

export function ApprovalPoliciesPanel({
  colony,
  busyId,
  onSetPolicy,
}: {
  colony: Colony;
  busyId: string | null;
  onSetPolicy: (policy: CompanyApprovalPolicy) => void;
}) {
  const [pendingModes, setPendingModes] = React.useState<Record<string, CompanyApprovalPolicyMode>>({});
  const policies = React.useMemo(() => resolveCompanyApprovalPolicies(colony), [colony]);
  const activeCount = policies.filter((policy) => policy.mode !== "off").length;

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
      <SectionLabel
        right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: activeCount ? "var(--honey)" : "var(--fg-4)" }}>{activeCount} active</span>}
      >
        approval policies
      </SectionLabel>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))" }}>
        {policies.map((policy) => {
          const busy = busyId === `approval-policy:${policy.id}`;
          const visibleMode = busy ? pendingModes[policy.id] ?? policy.mode : policy.mode;
          const tone = rowTone(visibleMode);
          return (
            <div
              key={policy.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                border: `1px solid ${tone.border}`,
                borderRadius: 8,
                background: tone.bg,
                padding: "12px 13px",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span
                  aria-hidden
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    border: `1px solid ${tone.border}`,
                    color: tone.color,
                    flexShrink: 0,
                  }}
                >
                  <ShieldCheck size={14} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--f-display)", fontSize: 13.5, fontWeight: 650, color: "var(--fg)", lineHeight: 1.35 }}>
                    {policy.subject}
                  </div>
                  <div style={{ marginTop: 4, display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.06, color: tone.color, border: `1px solid ${tone.border}`, borderRadius: 5, padding: "2px 6px" }}>
                      {policy.id === "capability-setup" && visibleMode === "off" ? "Automatic" : MODE_LABEL[visibleMode]}
                    </span>
                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{sourceLabel(policy)}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(policy.id === "capability-setup" ? (["off", "ask"] as CompanyApprovalPolicyMode[]) : COMPANY_APPROVAL_POLICY_MODES).map((mode) => {
                  const selected = visibleMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      disabled={busy || selected}
                      onClick={() => {
                        setPendingModes((current) => ({ ...current, [policy.id]: mode }));
                        onSetPolicy({ ...policy, mode, updatedAt: new Date().toISOString() });
                      }}
                      style={{
                        minHeight: 30,
                        cursor: busy || selected ? "default" : "pointer",
                        border: selected ? "1px solid var(--honey-2)" : "1px solid var(--line-2)",
                        background: selected ? "var(--honey-soft)" : "transparent",
                        color: selected ? "var(--honey)" : "var(--fg-3)",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontFamily: "var(--f-mono)",
                        fontSize: 10.5,
                        fontWeight: 500,
                        opacity: busy && !selected ? 0.55 : 1,
                      }}
                    >
                      {busy && selected ? <Spinner size={11} /> : policy.id === "capability-setup" && mode === "off" ? "Automatic" : MODE_LABEL[mode]}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
