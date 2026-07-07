import * as React from "react";

/* Badge — compact status / label pill.
   Ported from src/components/ui/badge.tsx. Human-readable statuses like
   "Running", "Needs funding", "Tailnet-only". */

const VARIANTS = {
  default: { background: "var(--honey-soft)", color: "var(--honey)", border: "1px solid var(--honey-line)" },
  secondary: { background: "transparent", color: "var(--fg-3)", border: "1px solid var(--line-2)" },
  success: { background: "var(--success-soft)", color: "var(--success)", border: "1px solid color-mix(in srgb, var(--success) 35%, transparent)" },
  warning: { background: "var(--warning-soft)", color: "var(--warning)", border: "1px solid var(--honey-line)" },
  danger: { background: "var(--danger-soft)", color: "var(--danger)", border: "1px solid color-mix(in srgb, var(--danger) 38%, transparent)" },
  honey: { background: "var(--honey-soft)", color: "var(--honey)", border: "1px solid var(--honey-line)" },
  live: { background: "var(--live-soft)", color: "var(--live)", border: "1px solid color-mix(in srgb, var(--live) 35%, transparent)" },
  outline: { background: "transparent", color: "var(--fg-2)", border: "1px solid var(--line-2)" },
};

export function Badge({ variant = "default", mono = false, children, style, ...props }) {
  const v = VARIANTS[variant] || VARIANTS.default;
  return (
    <span
      data-slot="badge"
      style={{
        display: "inline-flex",
        width: "fit-content",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        padding: mono ? "3px 9px" : "3px 10px",
        borderRadius: "var(--radius-pill)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-body)",
        fontSize: mono ? 10 : 11,
        fontWeight: mono ? 500 : 600,
        letterSpacing: mono ? "0.06em" : 0,
        textTransform: mono ? "uppercase" : "none",
        lineHeight: 1.45,
        whiteSpace: "nowrap",
        ...v,
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  );
}
