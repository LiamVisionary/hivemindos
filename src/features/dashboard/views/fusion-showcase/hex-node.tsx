// src/components/fusion/hex-node.tsx
// Neon-HUD primitives: HexNode (hex capability node), Asset (brand-logo / icon
// tile), Chip, Eyebrow, Corners, MachineTag.
"use client";

import * as React from "react";
import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import { TONE, type Tone, type Machine } from "./fusion-data";
import styles from "./fusion.module.css";

function toneVar(tone: Tone | string) {
  return (TONE as Record<string, string>)[tone] ?? tone;
}

export function HexNode({
  tone = "teal", size = 64, live, icon: Icon, image, imageScale = 0.48, className, style, children,
}: {
  tone?: Tone; size?: number; live?: boolean; icon?: LucideIcon; image?: string;
  imageScale?: number; className?: string; style?: React.CSSProperties; children?: React.ReactNode;
}) {
  return (
    <div
      className={[styles.node, styles.hex, live ? styles.nodeLive : "", className || ""].join(" ")}
      style={{ width: size, height: size, "--tone": toneVar(tone), ...style } as React.CSSProperties}
    >
      {children
        ? children
        : image
          ? <Image src={image} alt="" width={Math.round(size * imageScale)} height={Math.round(size * imageScale)} unoptimized style={{ width: `${imageScale * 100}%`, height: `${imageScale * 100}%`, objectFit: "contain" }} />
          : Icon ? <Icon style={{ color: toneVar(tone) }} /> : null}
    </div>
  );
}

export function Asset({
  logo, icon: Icon, tone = "teal", size = 52, live,
}: { logo?: string; icon?: LucideIcon; tone?: Tone; size?: number; live?: boolean }) {
  return (
    <span
      className={[styles.logoTile, live ? styles.nodeLive : ""].join(" ")}
      style={{ width: size, height: size, "--tone": toneVar(tone) } as React.CSSProperties}
    >
      {logo
        ? <Image src={logo} alt="" width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} unoptimized style={{ width: "58%", height: "58%", objectFit: "contain" }} />
        : Icon ? <span style={{ color: toneVar(tone), display: "grid", placeItems: "center", width: "54%", height: "54%" }}><Icon style={{ width: "100%", height: "100%" }} /></span> : null}
    </span>
  );
}

export function Chip({ tone = "teal", icon: Icon, children, style }: {
  tone?: Tone; icon?: LucideIcon; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <span className={styles.chip} style={{ "--tone": toneVar(tone), ...style } as React.CSSProperties}>
      {Icon ? <Icon width={12} height={12} /> : null}{children}
    </span>
  );
}

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <span className={styles.eyebrow} style={style}>{children}</span>;
}

export function Corners() {
  return (
    <>
      <span className={`${styles.corner} ${styles.cornerTL}`} />
      <span className={`${styles.corner} ${styles.cornerTR}`} />
      <span className={`${styles.corner} ${styles.cornerBL}`} />
      <span className={`${styles.corner} ${styles.cornerBR}`} />
    </>
  );
}

export function MachineTag({ m, active }: { m: Machine; active?: boolean }) {
  const Icon = m.icon;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 11px",
      borderRadius: 999, fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: "0.08em",
      textTransform: "uppercase", whiteSpace: "nowrap",
      border: "1px solid " + (active ? "var(--fz-teal)" : "var(--fz-panel-line)"),
      color: active ? "var(--fz-teal-2)" : "var(--fz-fg-3)",
      background: active ? "var(--fz-teal-soft)" : "rgba(8,12,19,0.5)",
      transition: "all .3s ease",
    }}>
      <span style={{ width: 14, height: 14, color: active ? "var(--fz-teal)" : "var(--fz-fg-4)" }}>
        <Icon style={{ width: "100%", height: "100%" }} />
      </span>
      {m.name}
    </div>
  );
}
