import * as React from "react";

/* CopyableCodeLine — mono command/endpoint line with a copy button. Ported from
   src/components/ui/copyable-code-line.tsx. Used for setup commands, tailnet
   ids, env keys. Keep these OUT of primary views (advanced surface only). */

export function CopyableCodeLine({ code, label, style, ...props }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    try { navigator.clipboard?.writeText(code); } catch (e) { /* noop */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div style={{ display: "grid", gap: 6, ...style }} {...props}>
      {label ? (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>{label}</span>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "8px 8px 8px 12px",
          borderRadius: "var(--radius-xs)",
          border: "1px solid var(--line)",
          background: "var(--field)",
        }}
      >
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--fg-2)", overflowX: "auto", whiteSpace: "nowrap" }}>{code}</code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            flex: "0 0 auto",
            padding: "5px 9px",
            borderRadius: 6,
            border: "1px solid var(--button-border)",
            background: copied ? "var(--button-accent)" : "transparent",
            color: copied ? "var(--accent-strong)" : "var(--muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all var(--dur) ease",
          }}
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
