"use client";

import * as React from "react";
import {
  Activity, BarChart3, Bot, Check, ChevronLeft, ChevronRight, Clock3, Download, ExternalLink,
  FileJson, FileText, FileUp, FolderOpen, GitBranch, HardDriveDownload, KeyRound, Layers,
  ListChecks, MemoryStick, MessageSquare, Pause, Play, Plus, Power, RefreshCcw,
  Rocket, Search, Send, ShieldCheck, Sparkles, Trash2, Upload, X, type LucideIcon,
} from "lucide-react";
import styles from "./aeon-tokens.module.css";

// ---- icon registry (maps short names used across the panel → lucide) ----
const ICONS = {
  rocket: Rocket, sparkles: Sparkles, clock: Clock3, power: Power, refresh: RefreshCcw,
  git: GitBranch, plus: Plus, play: Play, pause: Pause, download: Download, upload: Upload,
  check: Check, x: X, search: Search, file: FileText, folder: FolderOpen, key: KeyRound,
  memory: MemoryStick, activity: Activity, chevronL: ChevronLeft, chevronR: ChevronRight,
  external: ExternalLink, bot: Bot, shield: ShieldCheck, list: ListChecks, send: Send,
  msg: MessageSquare, fileUp: FileUp, json: FileJson, drive: HardDriveDownload, bars: BarChart3,
  layers: Layers, trash: Trash2,
} satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, style }: { name: IconName; size?: number; style?: React.CSSProperties }) {
  const C = ICONS[name];
  return <C size={size} strokeWidth={1.6} aria-hidden style={{ flexShrink: 0, display: "block", ...style }} />;
}

// ---- breathing AEON orb ----
export type OrbState = "idle" | "working" | "duty" | "paused";
const ORB: Record<OrbState, { core: string; glow: string; ring: string }> = {
  idle: { core: "var(--aeon)", glow: "rgba(45,212,191,0.42)", ring: "rgba(94,234,212,0.5)" },
  working: { core: "var(--aeon)", glow: "rgba(45,212,191,0.55)", ring: "rgba(94,234,212,0.7)" },
  duty: { core: "var(--honey-2)", glow: "rgba(255,212,90,0.5)", ring: "rgba(255,212,90,0.7)" },
  paused: { core: "var(--fg-3)", glow: "rgba(148,163,184,0.28)", ring: "rgba(148,163,184,0.4)" },
};
const HEX_CLIP = "polygon(25% 6.7%, 75% 6.7%, 100% 50%, 75% 93.3%, 25% 93.3%, 0% 50%)";

export function AeonOrb({ size = 132, state = "idle", iconSrc }: { size?: number; state?: OrbState; iconSrc?: string }) {
  const t = ORB[state];
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div aria-hidden className={styles.pulse} style={{ position: "absolute", inset: -size * 0.35, borderRadius: "50%",
        background: `radial-gradient(circle, ${t.glow}, transparent 62%)`, filter: "blur(2px)" }} />
      <div aria-hidden className={styles.orbit} style={{ position: "absolute", inset: size * 0.04, borderRadius: "50%",
        border: `1px dashed ${t.ring}`, opacity: 0.55 }} />
      {(state === "working" || state === "duty") && (
        <div aria-hidden className={styles.ring} style={{ position: "absolute", inset: size * 0.1, borderRadius: "50%", border: `1.5px solid ${t.ring}` }} />
      )}
      <div style={{
        position: "absolute",
        inset: size * 0.18,
        clipPath: HEX_CLIP,
        background: `linear-gradient(145deg, rgba(255,255,255,0.16), ${t.ring} 42%, rgba(2,6,23,0.32))`,
        filter: `drop-shadow(0 0 ${size * 0.16}px ${t.glow})`,
      }}>
        <div style={{
          position: "absolute",
          inset: 1,
          clipPath: HEX_CLIP,
          background: `radial-gradient(circle at 50% 18%, rgba(255,255,255,0.16), transparent 24%), linear-gradient(160deg, ${t.glow}, rgba(8,12,20,0.72) 72%)`,
          display: "grid",
          placeItems: "center",
          boxShadow: `inset 0 ${size * 0.12}px ${size * 0.22}px rgba(255,255,255,0.07), inset 0 -${size * 0.18}px ${size * 0.28}px rgba(0,0,0,0.38)`,
        }}>
        <div style={{ color: t.core, display: "grid", placeItems: "center", gap: 5, position: "relative", zIndex: 1 }}>
          {iconSrc ? (
            <span
              aria-hidden="true"
              style={{
                width: size * 0.4,
                height: size * 0.4,
                backgroundImage: `url(${iconSrc})`,
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "contain",
                filter: `drop-shadow(0 0 ${size * 0.05}px rgba(94,234,212,0.36))`,
              }}
            />
          ) : (
            <Bot size={size * 0.26} strokeWidth={1.4} aria-hidden />
          )}
          {state === "working" && <span className={styles.eq} style={{ color: t.core, height: size * 0.1 }}><i /><i /><i /><i /></span>}
        </div>
        </div>
      </div>
    </div>
  );
}

export function Eyebrow({ children, color, style }: { children: React.ReactNode; color?: string; style?: React.CSSProperties }) {
  return <p className={styles.monoCap} style={{ margin: 0, color: color ?? "var(--fg-4)", ...style }}>{children}</p>;
}

export type Tone = "cyan" | "honey" | "green" | "rose" | "muted" | "sky";
export const TONE: Record<Tone, { bg: string; bd: string; fg: string }> = {
  cyan: { bg: "var(--aeon-soft)", bd: "var(--aeon-line)", fg: "var(--cyan-3)" },
  honey: { bg: "rgba(255,212,90,0.12)", bd: "rgba(255,212,90,0.3)", fg: "var(--honey-2)" },
  green: { bg: "rgba(110,231,183,0.12)", bd: "rgba(110,231,183,0.3)", fg: "#a7f3d0" },
  rose: { bg: "rgba(251,113,133,0.12)", bd: "rgba(251,113,133,0.3)", fg: "var(--danger-2)" },
  muted: { bg: "rgba(148,163,184,0.08)", bd: "var(--line)", fg: "var(--fg-3)" },
  sky: { bg: "rgba(125,211,252,0.12)", bd: "rgba(125,211,252,0.3)", fg: "#bae6fd" },
};

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
const BTN: Record<BtnVariant, { bg: string; bd: string; fg: string; sh: string }> = {
  primary: { bg: "linear-gradient(135deg, rgba(45,212,191,0.30), rgba(20,184,166,0.16))", bd: "rgba(94,234,212,0.5)", fg: "var(--cyan-3)", sh: "0 0 24px rgba(45,212,191,0.22)" },
  secondary: { bg: "rgba(148,163,184,0.07)", bd: "var(--line-2)", fg: "var(--fg-2)", sh: "none" },
  ghost: { bg: "transparent", bd: "transparent", fg: "var(--fg-3)", sh: "none" },
  danger: { bg: "rgba(251,113,133,0.12)", bd: "rgba(251,113,133,0.4)", fg: "var(--danger-2)", sh: "none" },
};

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant; icon?: IconName; size?: "sm" | "md" | "icon"; sheen?: boolean;
}
export function Btn({ variant = "secondary", icon, size = "md", sheen, children, style, ...rest }: BtnProps) {
  const v = BTN[variant];
  const pad = size === "sm" ? "6px 11px" : size === "icon" ? "8px" : "9px 15px";
  const className = [styles.interactiveSubtle, sheen ? styles.sheen : null, rest.className].filter(Boolean).join(" ");
  return (
    <button {...rest} className={className} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: pad,
      fontSize: size === "sm" ? 12 : 13, fontWeight: 600, fontFamily: "var(--f-body)", color: v.fg,
      background: v.bg, border: `1px solid ${v.bd}`, borderRadius: 9, boxShadow: v.sh, lineHeight: 1.1,
      cursor: "pointer", transition: "filter 140ms ease", ...style,
    }}
    onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.12)"; }}
    onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}>
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 15} />}
      {children}
    </button>
  );
}

export function Pill({ tone = "muted", icon, dot, children, style }: { tone?: Tone; icon?: IconName; dot?: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
  const t = TONE[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 9px", borderRadius: 999,
      fontSize: 11, fontWeight: 600, fontFamily: "var(--f-mono)", letterSpacing: 0,
      color: t.fg, background: t.bg, border: `1px solid ${t.bd}`, ...style }}>
      {dot && <span className={styles.dot} style={{ width: 6, height: 6 }} />}
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

export function Stat({ value, label, tone }: { value: React.ReactNode; label: string; tone?: "honey" | "cyan" | "rose" }) {
  const color = tone === "honey" ? "var(--honey-2)" : tone === "cyan" ? "var(--cyan-2)" : tone === "rose" ? "var(--danger-2)" : "var(--fg)";
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 30, fontWeight: 700, lineHeight: 1, color, letterSpacing: 0, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div className={styles.monoCap} style={{ color: "var(--fg-4)" }}>{label}</div>
    </div>
  );
}

export function Sparkline({ data, w = 132, h = 36, color = "var(--aeon)" }: { data: number[]; w?: number; h?: number; color?: string }) {
  const safeData = data.length ? data : [0, 0];
  const max = Math.max(...safeData, 1);
  const step = w / Math.max(safeData.length - 1, 1);
  const pts = safeData.map((d, i) => [i * step, h - (d / max) * (h - 6) - 3] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const id = React.useId();
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(45,212,191,0.28)" />
          <stop offset="100%" stopColor="rgba(45,212,191,0)" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  );
}

export function StatusRow({ label, value, ok, mono }: { label: string; value: string; ok?: boolean; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 13px", borderRadius: 9, background: "var(--panel-bg-soft)", border: "1px solid var(--line)" }}>
      <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{label}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--fg)", fontFamily: mono ? "var(--f-mono)" : "var(--f-body)", textAlign: "right" }}>
        <span style={{ color: ok ? "#a7f3d0" : "var(--honey-2)" }}><Icon name={ok ? "check" : "git"} size={13} /></span>
        {value}
      </span>
    </div>
  );
}

export function Card({ children, glow, pad = 18, style, ...rest }: React.HTMLAttributes<HTMLElement> & { glow?: boolean; pad?: number }) {
  return (
    <section {...rest} style={{ background: "var(--panel-grad)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)",
      padding: pad, position: "relative", overflow: "hidden", boxShadow: glow ? "0 18px 50px rgba(0,0,0,0.22)" : "0 8px 28px rgba(0,0,0,0.14)", ...style }}>
      {children}
    </section>
  );
}

export function SectionHead({ eyebrow, title, icon, action }: { eyebrow?: string; title: string; icon?: IconName; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
        {icon && <span style={{ color: "var(--aeon)", display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 9, background: "var(--aeon-soft)", border: "1px solid var(--aeon-line)" }}><Icon name={icon} size={16} /></span>}
        <div>
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h3 style={{ margin: "2px 0 0", fontFamily: "var(--f-display)", fontSize: 16, fontWeight: 700, color: "var(--fg)" }}>{title}</h3>
        </div>
      </div>
      {action}
    </div>
  );
}

export { styles as aeonStyles };
