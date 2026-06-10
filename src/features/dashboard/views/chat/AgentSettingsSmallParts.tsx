"use client";

import type { ComponentType } from "react";
import { aeonStyles as styles } from "@/components/aeon/parts";

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      className={styles.interactiveSubtle}
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
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: 999,
          background: checked ? "var(--aeon)" : "var(--fg-4)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          transition: "left 160ms ease",
        }}
      />
    </button>
  );
}

export function ToggleRow({ label, sub, checked, onChange, icon: RowIcon }: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: ComponentType<any>;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 11, border: `1px solid ${checked ? "var(--aeon-line)" : "var(--line)"}`, background: checked ? "var(--aeon-soft)" : "var(--panel-bg-soft)" }}>
      {RowIcon ? <RowIcon size={17} style={{ color: checked ? "var(--cyan-2)" : "var(--fg-4)", flex: "0 0 auto" }} aria-hidden="true" /> : null}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: "var(--fg)", fontSize: 13.5, fontWeight: 700 }}>{label}</div>
        {sub ? <div style={{ marginTop: 2, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.45 }}>{sub}</div> : null}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

export function ProviderDiscoverySkeleton({ runtimeLabel }: { runtimeLabel: string }) {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <div key={index} className={styles.sheen} role={index === 0 ? "status" : undefined} aria-live={index === 0 ? "polite" : undefined} aria-label={index === 0 ? `Discovering ${runtimeLabel} providers` : undefined} style={{ display: "grid", gap: 6, minHeight: 62, padding: "9px 10px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel-bg-soft)", overflow: "hidden" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, border: "1px solid var(--aeon-line)", background: "linear-gradient(135deg, rgba(94,234,212,0.18), rgba(2,6,23,0.42))", flex: "0 0 auto" }} />
            <span style={{ display: "grid", gap: 5, minWidth: 0, flex: 1 }}>
              <span style={{ width: `${78 - index * 10}%`, height: 9, borderRadius: 999, background: "rgba(198,209,223,0.18)" }} />
              {index === 0 ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-4)", fontSize: 10.5, lineHeight: 1.2 }}>
                  Discovering
                  <span className={styles.eq} aria-hidden="true" style={{ height: 10 }}><i /><i /><i /><i /></span>
                </span>
              ) : (
                <span style={{ width: `${46 + index * 8}%`, height: 7, borderRadius: 999, background: "rgba(142,155,177,0.14)" }} />
              )}
            </span>
          </span>
          <span style={{ width: `${54 + index * 8}%`, height: 7, borderRadius: 999, background: "rgba(142,155,177,0.12)" }} />
        </div>
      ))}
    </>
  );
}
