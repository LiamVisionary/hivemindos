"use client";

import * as React from "react";

type Tone = "" | "live" | "honey" | "danger" | undefined;

export function Badge({ tone, children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`fb-badge${tone ? ` ${tone}` : ""}`}>{children}</span>;
}

export function BBtn({
  variant = "ghost",
  sm,
  children,
  ...rest
}: { variant?: "ghost" | "primary"; sm?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`fb-btn ${variant}${sm ? " sm" : ""}`} {...rest}>
      {children}
    </button>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange?: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onChange}
      className="fb-switch"
      style={{
        cursor: onChange ? "pointer" : "default",
        background: on ? "var(--honey)" : "var(--panel-hi)",
        border: `1px solid ${on ? "var(--honey)" : "var(--line-2)"}`,
      }}
    >
      <i style={{ left: on ? 17 : 2, background: on ? "#1a1305" : "var(--fg-3)" }} />
    </button>
  );
}

export type BIconName =
  | "brain" | "search" | "doc" | "trade" | "spark" | "activity" | "key" | "network"
  | "branch" | "file" | "folder" | "sync" | "refresh" | "download" | "plug" | "check"
  | "plus" | "shield" | "warn" | "alert" | "repeat" | "sparkles" | "eye" | "eye-off"
  | "copy" | "trash" | "promote" | "bot" | "hex" | "chevron";

export function BIcon({ name, color = "currentColor", size = 16, sw = 1.7 }: { name: BIconName; color?: string; size?: number; sw?: number }) {
  const c = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth: sw, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "brain": return (<svg {...c}><path d="M9 4a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 5 11c0 1 .5 1.8 1.2 2.3A2.6 2.6 0 0 0 7 18c.8.6 2 .6 2.5-.2V4z" /><path d="M15 4a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 19 11c0 1-.5 1.8-1.2 2.3A2.6 2.6 0 0 1 17 18c-.8.6-2 .6-2.5-.2V4z" /></svg>);
    case "search": return (<svg {...c}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>);
    case "doc": return (<svg {...c}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M9.5 13h5M9.5 16.5h5" /></svg>);
    case "trade": return (<svg {...c}><path d="M3 17l5-5 3 3 4-6 3 3 3-3" /></svg>);
    case "spark": return (<svg {...c}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>);
    case "activity": return (<svg {...c}><path d="M3 12h4l2.5 7 5-14L17 12h4" /></svg>);
    case "key": return (<svg {...c}><circle cx="8" cy="14" r="4" /><path d="M11 11l8-8M16 4l3 3M14 6l2.5 2.5" /></svg>);
    case "network": return (<svg {...c}><circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="18" r="2.2" /><path d="M10.5 6.6 6.5 16M13.5 6.6 17.5 16M7 18h10" /></svg>);
    case "branch": return (<svg {...c}><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="8" r="2.4" /><path d="M6 8.4v7.2M8.2 7.2c6 1 4 6 9.4 1.2" /></svg>);
    case "file": return (<svg {...c}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /></svg>);
    case "folder": return (<svg {...c}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>);
    case "sync": return (<svg {...c}><path d="M3.5 12a8.5 8.5 0 0 1 14.5-6M20.5 12a8.5 8.5 0 0 1-14.5 6" /><path d="M18 3v3.5h-3.5M6 21v-3.5h3.5" /></svg>);
    case "refresh": return (<svg {...c}><path d="M3.5 12a8.5 8.5 0 0 1 2.6-6.1" /><path d="M3 4v4h4" /><path d="M20.5 12a8.5 8.5 0 0 1-2.6 6.1" /><path d="M21 20v-4h-4" /></svg>);
    case "download": return (<svg {...c}><path d="M12 3v12M8 11l4 4 4-4M5 21h14" /></svg>);
    case "plug": return (<svg {...c}><path d="M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-10 0zM12 17v4" /></svg>);
    case "check": return (<svg {...c}><path d="M20 6 9 17l-5-5" /></svg>);
    case "plus": return (<svg {...c}><path d="M12 5v14M5 12h14" /></svg>);
    case "shield": return (<svg {...c}><path d="M12 3l7 4v5c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V7z" /><path d="M9 12l2 2 4-4" /></svg>);
    case "warn": return (<svg {...c}><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></svg>);
    case "alert": return (<svg {...c}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>);
    case "repeat": return (<svg {...c}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>);
    case "sparkles": return (<svg {...c}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></svg>);
    case "eye": return (<svg {...c}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>);
    case "eye-off": return (<svg {...c}><path d="M3 3l18 18" /><path d="M10.6 10.7a3 3 0 0 0 4.2 4.2" /><path d="M9.9 5.2A9.6 9.6 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.3 3.9M6.2 6.3A17 17 0 0 0 2 12s4 7 10 7a9.4 9.4 0 0 0 3.4-.6" /></svg>);
    case "copy": return (<svg {...c}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>);
    case "trash": return (<svg {...c}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>);
    case "promote": return (<svg {...c}><path d="M12 19V7M7 11l5-4 5 4M5 21h14" /></svg>);
    case "bot": return (<svg {...c}><rect x="5" y="8" width="14" height="11" rx="2.4" /><path d="M12 8V4M9 13h.01M15 13h.01M9 16h6" /></svg>);
    case "hex": return (<svg {...c}><path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z" /></svg>);
    case "chevron": return (<svg {...c}><path d="m6 9 6 6 6-6" /></svg>);
    default: return null;
  }
}

const FZ_PATHS: Record<string, string[]> = {
  prompt: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.3-4.3"],
  filter: ["M22 3H2l8 9.5V19l4 2v-8.5z"],
  fuse: ["M6 3v12", "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M15 6a9 9 0 0 0-9 9"],
  verify: ["M22 11.08V12a10 10 0 1 1-5.93-9.14", "M22 4 12 14.01l-3-3"],
  deliver: ["M22 2 11 13", "M22 2 15 22l-4-9-9-4z"],
  bot: ["M12 8V4H8", "M4 8h16v12H4z", "M2 14h2", "M20 14h2", "M9 13v2", "M15 13v2"],
  wrench: ["M14.7 6.3a4 4 0 0 0-5.6 5l-6.4 6.4a2 2 0 0 0 2.8 2.8l6.4-6.4a4 4 0 0 0 5-5.6l-2.8 2.8-2.2-2.2z"],
  db: ["M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z", "M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5", "M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "M9 12l2 2 4-4"],
  refresh: ["M3 2v6h6", "M21 12A9 9 0 0 0 6 5.3L3 8", "M21 22v-6h-6", "M3 12a9 9 0 0 0 15 6.7l3-2.7"],
  sparkles: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"],
  network: ["M9 5a3 3 0 1 0 6 0 3 3 0 0 0-6 0z", "M4 19a3 3 0 1 0 6 0 3 3 0 0 0-6 0z", "M14 19a3 3 0 1 0 6 0 3 3 0 0 0-6 0z", "M12 8v3", "M7 17l3-3", "M17 17l-3-3"],
  brain: ["M12 5a3 3 0 1 0-5.1 2.1A3 3 0 0 0 5 13a3 3 0 0 0 4 2.8V18a2 2 0 0 0 4 0V5z", "M12 5a3 3 0 1 1 5.1 2.1A3 3 0 0 1 19 13a3 3 0 0 1-4 2.8"],
  server: ["M4 4h16v6H4z", "M4 14h16v6H4z", "M8 7h.01", "M8 17h.01"],
  cloud: ["M17.5 19a4.5 4.5 0 1 0-1-8.9A6 6 0 1 0 6 16", "M6 16h11.5"],
  cpu: ["M6 6h12v12H6z", "M9 9h6v6H9z", "M9 2v2", "M15 2v2", "M9 20v2", "M15 20v2", "M2 9h2", "M2 15h2", "M20 9h2", "M20 15h2"],
};

export function FzIcon({ name, size = 15 }: { name: string; size?: number }) {
  const paths = FZ_PATHS[name];
  if (!paths) return <BIcon name="hex" size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
