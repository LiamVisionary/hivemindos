"use client";

/* Small presentational atoms shared by the redesigned chat composer, sidebar,
 * and shelf. Kept separate so each surface stays under the 1500-line ratchet. */

import type { CSSProperties, ReactNode } from "react";

/** Shared popover chrome. `.cx-pop` supplies the blur, animation, and the
 *  opaque @supports fallback. */
export const POP_STYLE: CSSProperties = {
  border: "1px solid var(--line-2)",
  borderRadius: 12,
  boxShadow: "0 24px 60px -18px rgba(0,0,0,0.6)",
  padding: 6,
};

export const PILL_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 30,
  border: "1px solid transparent",
  borderRadius: 8,
  cursor: "pointer",
  fontFamily: "var(--f-body)",
  fontSize: 11,
  fontWeight: 600,
  padding: "0 7px",
};

export function iconBtnStyle(active: boolean): CSSProperties {
  return {
    display: "grid",
    placeItems: "center",
    width: 32,
    height: 32,
    border: 0,
    borderRadius: 999,
    background: active ? "var(--panel-hi)" : "transparent",
    color: active ? "var(--fg)" : "var(--fg-3)",
    cursor: "pointer",
  };
}

export function headerIconBtnStyle(active: boolean): CSSProperties {
  return {
    display: "grid",
    placeItems: "center",
    width: 34,
    height: 34,
    border: 0,
    borderRadius: 9,
    background: active ? "var(--honey-soft)" : "transparent",
    color: active ? "var(--honey)" : "var(--fg-3)",
    cursor: "pointer",
  };
}

type IcoProps = {
  /** One `d` attribute, or several rendered as sibling <path>s. */
  d: string | string[];
  size?: number;
  sw?: number;
  stroke?: string;
  fill?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

/** A stroked 24x24 line icon. `children` lets a caller add <circle>/<rect>
 *  primitives that a `d` path cannot express. */
export function Ico({ d, size = 16, sw = 1.8, stroke = "currentColor", fill = "none", style, children }: IcoProps) {
  const paths = Array.isArray(d) ? d : [d];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {paths.map((path) => <path key={path} d={path} />)}
      {children}
    </svg>
  );
}

export function SearchIco({ size = 14, stroke = "var(--fg-4)" }: { size?: number; stroke?: string }) {
  return (
    <Ico d="m20 20-3.2-3.2" size={size} sw={1.9} stroke={stroke}>
      <circle cx="11" cy="11" r="7" />
    </Ico>
  );
}

export function ClockIco({ size = 17 }: { size?: number }) {
  return (
    <Ico d="M12 7v5l3 2" size={size} sw={1.7}>
      <circle cx="12" cy="12" r="9" />
    </Ico>
  );
}

/** The "chip" glyph used by the model pill and its menu rows. */
export function ModelIco({ size = 14, stroke = "currentColor" }: { size?: number; stroke?: string }) {
  return (
    <Ico d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" size={size} sw={1.8} stroke={stroke}>
      <rect x="9" y="9" width="6" height="6" />
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </Ico>
  );
}

export function SwarmIco({ size = 17 }: { size?: number }) {
  return (
    <Ico d="m10.4 10.7-4.1-3.1M13.6 10.7l3.9-3M10.6 13.4l-3.9 3.2M13.4 13.4l3.6 3" size={size} sw={1.8}>
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="5" cy="6.5" r="1.3" />
      <circle cx="19" cy="6.5" r="1.3" />
      <circle cx="5.5" cy="18" r="1.3" />
      <circle cx="18.5" cy="18" r="1.3" />
    </Ico>
  );
}

export function MicIco({ size = 17 }: { size?: number }) {
  return (
    <Ico d="M5 11a7 7 0 0 0 14 0M12 18v3" size={size} sw={1.8}>
      <rect x="9" y="3" width="6" height="12" rx="3" />
    </Ico>
  );
}

/** An animated send-button spinner. Never a static glyph (AGENTS.md: loading
 *  states must move); `.cx-spin` is disabled under prefers-reduced-motion. */
export function SpinnerIco({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="cx-spin" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2.4" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function HexIco({ size = 22, stroke = "var(--honey)" }: { size?: number; stroke?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <polygon points="12,1.8 21.2,7 21.2,17 12,22.2 2.8,17 2.8,7" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.1" fill={stroke} />
    </svg>
  );
}

export const ICON_PATHS = {
  plus: "M12 5v14M5 12h14",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  chevronLeft: "m15 6-6 6 6 6",
  check: "M4 12l5 5L20 6",
  close: "M18 6 6 18M6 6l12 12",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  folderPlus: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM11 13h4M13 11v4",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  fileUp: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15l3-3 3 3",
  paperclip: "M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.49-8.49",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  shield: "M12 3 4 6v5c0 4.5 3.2 7.7 8 9 4.8-1.3 8-4.5 8-9V6z",
  sendUp: "M12 19V5M5 12l7-7 7 7",
  terminal: "m7 9 3 3-3 3M13 15h4",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z",
  externalLink: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  openIn: "M21 3h-6M21 3l-9 9M21 3v6M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6",
  pencil: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  copy: "M5 15V5a2 2 0 0 1 2-2h10",
  trash: "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13",
  pin: "M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v5",
  sun: "M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  sliders: "M4 6h11M4 12h7M4 18h9",
  panel: "M15 4v16",
  bolt: "M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z",
} as const;
