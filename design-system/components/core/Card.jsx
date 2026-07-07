import * as React from "react";

/* Card — the base honeycomb "cell": a hairline-bordered translucent panel over
   the honeycomb backdrop with a deep soft shadow. Ported from
   src/components/ui/card.tsx. One card = one main job.
   Sub-parts: CardHeader, CardTitle, CardDescription, CardContent, CardFooter. */

export function Card({ children, style, ...props }) {
  return (
    <div
      data-slot="card"
      style={{
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--line-2)",
        background: "var(--surface)",
        color: "var(--foreground)",
        boxShadow: "var(--shadow-card)",
        fontFamily: "var(--font-body)",
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, style, ...props }) {
  return (
    <div data-slot="card-header" style={{ display: "grid", gap: 6, padding: "18px 18px 0", ...style }} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ children, style, ...props }) {
  return (
    <div data-slot="card-title" style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.2px", ...style }} {...props}>
      {children}
    </div>
  );
}

export function CardDescription({ children, style, ...props }) {
  return (
    <div data-slot="card-description" style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.4, ...style }} {...props}>
      {children}
    </div>
  );
}

export function CardContent({ children, style, ...props }) {
  return (
    <div data-slot="card-content" style={{ padding: 18, ...style }} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ children, style, ...props }) {
  return (
    <div data-slot="card-footer" style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 18px 18px", ...style }} {...props}>
      {children}
    </div>
  );
}
