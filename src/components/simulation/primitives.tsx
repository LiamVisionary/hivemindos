"use client";

/* primitives.tsx — small shared building blocks: tone helper, Badge, Button,
   Toggle, Dot, Summary. All theme-aware via the .sim-root tokens. */

import React from "react";
import type { Tone } from "./sim-data";

export const frTone = (t?: Tone | string): string =>
  t === "live" ? "var(--live)"
    : t === "honey" ? "var(--honey)"
    : t === "danger" ? "var(--danger)"
    : t === "neutral" ? "var(--fg-2)"
    : "var(--fg)";

export function Badge({ tone, children }: { tone?: Tone; children: React.ReactNode }) {
  const cls = tone === "live" ? " live" : tone === "honey" ? " honey" : tone === "danger" ? " danger" : "";
  return <span className={"fb-badge" + cls}>{children}</span>;
}

export function Button({ variant = "ghost", sm, children, ...rest }: {
  variant?: "ghost" | "primary"; sm?: boolean; children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={"fb-btn " + variant + (sm ? " sm" : "")} {...rest}>{children}</button>;
}

export function Toggle({ on, onChange }: { on: boolean; onChange?: () => void }) {
  return (
    <span onClick={onChange} className="fb-switch" style={{ background: on ? "var(--honey)" : "var(--panel-hi)", border: "1px solid " + (on ? "var(--honey)" : "var(--line-2)") }}>
      <i style={{ left: on ? 17 : 2, background: on ? "#1a1305" : "var(--fg-3)" }} />
    </span>
  );
}

export function Dot({ live, color = "var(--fg-3)", size = 7 }: { live?: boolean; color?: string; size?: number }) {
  return <span className={"fr-dot" + (live ? " live" : "")} style={{ color, width: size, height: size }} />;
}

export function Summary({ n, label, live, tone }: { n: React.ReactNode; label: string; live?: boolean; tone?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {live ? <span className="fr-dot live" style={{ color: "var(--live)", width: 6, height: 6 }} /> : null}
        <span style={{ fontFamily: "var(--f-display)", fontWeight: 500, fontSize: 19, color: tone || "var(--fg)", letterSpacing: "-0.01em" }}>{n}</span>
      </div>
      <span style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 5, letterSpacing: "0.02em" }}>{label}</span>
    </div>
  );
}
