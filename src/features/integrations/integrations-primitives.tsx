"use client";

import * as React from "react";

export function Badge({ tone, children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`fb-badge${tone ? ` ${tone}` : ""}`}>{children}</span>;
}

export function BBtn({
  variant = "ghost",
  sm,
  children,
  ...props
}: React.ComponentProps<"button"> & { variant?: "ghost" | "primary"; sm?: boolean }) {
  return <button type="button" className={`fb-btn ${variant}${sm ? " sm" : ""}`} {...props}>{children}</button>;
}

export function Pill({ active, children, ...props }: React.ComponentProps<"button"> & { active?: boolean }) {
  return <button type="button" data-active={active ? "" : undefined} {...props}>{children}</button>;
}

export function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onChange}
      className="fb-switch"
      style={{ cursor: disabled ? "default" : "pointer", background: on ? "var(--honey)" : "var(--panel-hi)", border: `1px solid ${on ? "var(--honey)" : "var(--line-2)"}`, opacity: disabled ? 0.6 : 1 }}
    >
      <i style={{ left: on ? 17 : 2, background: on ? "#1a1305" : "var(--fg-3)" }} />
    </button>
  );
}

export function NiBadge({ good, warn, label }: { good?: boolean; warn?: boolean; label: string }) {
  return (
    <span className={`ni-badge ${good ? "good" : warn ? "warn" : "bad"}`}>
      <BIcon name={good ? "check" : "alert"} size={13} />
      {label}
    </span>
  );
}

function MonoGlyph({ accent, mono, size = 38, radius = 11 }: { accent?: string; mono: string; size?: number; radius?: number }) {
  const color = accent || "var(--fg-3)";
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
        background: `color-mix(in srgb, ${color} 15%, var(--panel-2))`,
        border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
        color,
        fontFamily: "var(--f-display)",
        fontWeight: 600,
        fontSize: size * 0.4,
        lineHeight: 1,
      }}
    >
      {mono}
    </span>
  );
}

export function ServiceGlyph(props: { accent?: string; mono: string; size?: number; radius?: number }) {
  return <MonoGlyph {...props} />;
}

export function McpGlyph({ item, size, radius }: { item?: { accent: string; mono: string }; size?: number; radius?: number }) {
  return <MonoGlyph accent={item?.accent} mono={item?.mono ?? ".."} size={size} radius={radius} />;
}

export function BIcon({ name, color = "currentColor", size = 16, sw = 1.7 }: { name: string; color?: string; size?: number; sw?: number }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: sw, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "search": return (<svg {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>);
    case "key": return (<svg {...props}><circle cx="8" cy="14" r="4" /><path d="M11 11l8-8M16 4l3 3M14 6l2.5 2.5" /></svg>);
    case "network": return (<svg {...props}><circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="18" r="2.2" /><path d="M10.5 6.6 6.5 16M13.5 6.6 17.5 16M7 18h10" /></svg>);
    case "branch": return (<svg {...props}><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="8" r="2.4" /><path d="M6 8.4v7.2M8.2 7.2c6 1 4 6 9.4 1.2" /></svg>);
    case "sync": return (<svg {...props}><path d="M3.5 12a8.5 8.5 0 0 1 14.5-6M20.5 12a8.5 8.5 0 0 1-14.5 6" /><path d="M18 3v3.5h-3.5M6 21v-3.5h3.5" /></svg>);
    case "refresh": return (<svg {...props}><path d="M3.5 12a8.5 8.5 0 0 1 2.6-6.1" /><path d="M3 4v4h4" /><path d="M20.5 12a8.5 8.5 0 0 1-2.6 6.1" /><path d="M21 20v-4h-4" /></svg>);
    case "plug": return (<svg {...props}><path d="M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-10 0zM12 17v4" /></svg>);
    case "folder": return (<svg {...props}><path d="M3 6.5h7l2 2h9v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>);
    case "browser": return (<svg {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></svg>);
    case "copy": return (<svg {...props}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>);
    case "check": return (<svg {...props}><path d="M20 6 9 17l-5-5" /></svg>);
    case "plus": return (<svg {...props}><path d="M12 5v14M5 12h14" /></svg>);
    case "shield": return (<svg {...props}><path d="M12 3l7 4v5c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V7z" /><path d="M9 12l2 2 4-4" /></svg>);
    case "alert": return (<svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>);
    case "sparkles": return (<svg {...props}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></svg>);
    case "eye": return (<svg {...props}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>);
    case "eye-off": return (<svg {...props}><path d="M3 3l18 18" /><path d="M10.6 10.7a3 3 0 0 0 4.2 4.2" /><path d="M9.9 5.2A9.6 9.6 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.3 3.9M6.2 6.3A17 17 0 0 0 2 12s4 7 10 7a9.4 9.4 0 0 0 3.4-.6" /></svg>);
    case "trash": return (<svg {...props}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>);
    case "hex": return (<svg {...props}><path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z" /></svg>);
    default: return null;
  }
}

export function PlayIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.2v13.6c0 .5.6.8 1 .5l10-6.8c.4-.3.4-.9 0-1.2L9 4.7c-.4-.3-1 0-1 .5z" /></svg>);
}

export function LinkIcon({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>);
}

export function TermIcon({ size = 26 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></svg>);
}

export function MonitorGlyph({ size = 20 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>);
}
