"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export const FR_SHELF_W = 72;

export function BIcon({
  name,
  color = "currentColor",
  size = 16,
  sw = 1.7,
}: {
  name: "search" | "doc" | "refresh" | "download" | "plug" | "check" | "copy" | "plus" | "alert" | "external";
  color?: string;
  size?: number;
  sw?: number;
}) {
  const c = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: sw,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "search":
      return (<svg {...c}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>);
    case "doc":
      return (<svg {...c}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M9.5 13h5M9.5 16.5h5" /></svg>);
    case "refresh":
      return (<svg {...c}><path d="M3.5 12a8.5 8.5 0 0 1 2.6-6.1" /><path d="M3 4v4h4" /><path d="M20.5 12a8.5 8.5 0 0 1-2.6 6.1" /><path d="M21 20v-4h-4" /></svg>);
    case "download":
      return (<svg {...c}><path d="M12 3v12M8 11l4 4 4-4M5 21h14" /></svg>);
    case "plug":
      return (<svg {...c}><path d="M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-10 0zM12 17v4" /></svg>);
    case "check":
      return (<svg {...c}><path d="M20 6 9 17l-5-5" /></svg>);
    case "copy":
      return (<svg {...c}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>);
    case "plus":
      return (<svg {...c}><path d="M12 5v14M5 12h14" /></svg>);
    case "alert":
      return (<svg {...c}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>);
    case "external":
      return (<svg {...c}><path d="M7 17 17 7M9 7h8v8" /></svg>);
    default:
      return null;
  }
}

export function AppGlyph({
  app,
  size = 38,
  radius = 11,
}: {
  app: { mono: string; accent?: string; iconUrl?: string };
  size?: number;
  radius?: number;
}) {
  const accent = app.accent || "var(--fg-3)";
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flex: "0 0 auto",
        display: "grid",
        placeItems: "center",
        position: "relative",
        overflow: "hidden",
        background: `color-mix(in srgb, ${accent} 15%, var(--panel-2))`,
        border: `1px solid color-mix(in srgb, ${accent} 34%, transparent)`,
        color: accent,
        fontFamily: "var(--f-display)",
        fontWeight: 600,
        fontSize: size * 0.4,
        letterSpacing: "0",
        lineHeight: 1,
      }}
    >
      {app.mono}
      {app.iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={app.iconUrl}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            padding: Math.max(3, size * 0.12),
            background: "var(--panel-2)",
          }}
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      ) : null}
    </span>
  );
}

export function Summary({
  n,
  label,
  live,
  tone,
}: {
  n: number;
  label: string;
  live?: boolean;
  tone?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {live ? <span className="fr-dot live" style={{ color: "var(--live)", width: 6, height: 6 }} /> : null}
        <span style={{ fontFamily: "var(--f-display)", fontWeight: 500, fontSize: 19, color: tone || "var(--fg)", letterSpacing: "0" }}>{n}</span>
      </div>
      <span style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 5, letterSpacing: "0" }}>{label}</span>
    </div>
  );
}

export function Badge({ tone, children }: { tone?: "live" | "honey" | "danger" | "plain"; children: ReactNode }) {
  return <span className={`fb-badge${tone ? ` ${tone}` : ""}`}>{children}</span>;
}

type BBtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
  sm?: boolean;
};

export function BBtn({ variant = "ghost", sm, children, className = "", ...rest }: BBtnProps) {
  return (
    <button type="button" className={`fb-btn ${variant}${sm ? " sm" : ""}${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </button>
  );
}

export function Pill({ active, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button type="button" data-active={active ? "" : undefined} {...rest}>
      {children}
    </button>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange?: () => void }) {
  return (
    <span
      onClick={onChange}
      className="fb-switch"
      style={{
        cursor: onChange ? "pointer" : "default",
        background: on ? "var(--honey)" : "var(--panel-hi)",
        border: `1px solid ${on ? "var(--honey)" : "var(--line-2)"}`,
      }}
    >
      <i style={{ left: on ? 17 : 2, background: on ? "#1a1305" : "var(--fg-3)" }} />
    </span>
  );
}

export function openIcon(size = 12) {
  return <BIcon name="external" size={size} />;
}
