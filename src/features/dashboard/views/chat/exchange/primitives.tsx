import type { CSSProperties } from "react";
import type { ExchangeAgentState } from "./types";

export const FR_CHAT_STATE: Record<string, { dot: string; text: string; label: string }> = {
  working: { dot: "var(--live)", text: "var(--live)", label: "working" },
  online: { dot: "var(--live)", text: "var(--live)", label: "ready" },
  ready: { dot: "var(--fg-3)", text: "var(--fg-3)", label: "ready" },
  scheduled: { dot: "var(--honey)", text: "var(--honey)", label: "scheduled" },
  setup: { dot: "var(--honey)", text: "var(--honey)", label: "setup" },
  failed: { dot: "var(--danger)", text: "var(--danger)", label: "blocked" },
};

export const FR_COL_TONE: Record<string, { c: string; bg: string; br: string }> = {
  working: { c: "var(--live)", bg: "var(--live-soft)", br: "color-mix(in srgb, var(--live) 40%, transparent)" },
  ready: { c: "var(--fg-2)", bg: "var(--panel-2)", br: "var(--line-2)" },
  "needs-human": { c: "var(--danger)", bg: "var(--danger-soft)", br: "color-mix(in srgb, var(--danger) 42%, transparent)" },
  done: { c: "var(--honey)", bg: "var(--honey-soft)", br: "var(--honey-line)" },
};

export const frChatState = (state: string) => FR_CHAT_STATE[state] || FR_CHAT_STATE.ready;
export const frColTone = (column?: string) => FR_COL_TONE[column || ""] || FR_COL_TONE.working;

export function Dot({ state, size = 7 }: { state: ExchangeAgentState | string; size?: number }) {
  const meta = frChatState(state);
  const live = state === "working" || state === "online";
  return <span className={`fr-dot${live ? " live" : ""}`} style={{ color: meta.dot, width: size, height: size }} />;
}

export function HiveMark({ size = 22, stroke = "var(--honey)", fill = "none", dot = true, strokeWidth = 1.4 }: {
  size?: number;
  stroke?: string;
  fill?: string;
  dot?: boolean;
  strokeWidth?: number;
}) {
  const points = "12,1.8 21.2,7 21.2,17 12,22.2 2.8,17 2.8,7";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block" }}>
      <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {dot ? <circle cx="12" cy="12" r="2.1" fill={stroke} /> : null}
    </svg>
  );
}

export function Glyph({ d, s = 16, sw = 1.6, style }: { d: string | readonly string[]; s?: number; sw?: number; style?: CSSProperties }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={style}>
      {Array.isArray(d) ? d.map((path, index) => <path key={index} d={path} />) : <path d={String(d)} />}
    </svg>
  );
}

export const ICON = {
  plus: ["M12 5v14", "M5 12h14"],
  paperclip: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
  image: ["M3 5h18v14H3z", "M3 16l5-5 4 4 3-3 6 6", "M8.5 9.5a1.2 1.2 0 1 0 0-.001"],
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  folderOpen: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2", "M3 9h18l-2 9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"],
  mic: ["M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z", "M5 11a7 7 0 0 0 14 0", "M12 18v3"],
  send: "M12 19V5M5 12l7-7 7 7",
  chevron: "M6 9l6 6 6-6",
  chevronR: "M9 6l6 6-6 6",
  check: "M4 12l5 5L20 6",
  close: "M6 6l12 12M18 6L6 18",
  server: ["M4 5h16v6H4z", "M4 13h16v6H4z", "M8 8h.01", "M8 16h.01"],
  chat: "M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.4A8 8 0 1 1 21 11.5z",
  cpu: ["M9 9h6v6H9z", "M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3", "M5 5h14v14H5z"],
  swarm: ["M12 12h.01", "M5 6.5h.01", "M19 6.5h.01", "M5.5 18h.01", "M18.5 18h.01", "M10.4 10.7 6.3 7.6M13.6 10.7l3.9-3M10.6 13.4l-3.9 3.2M13.4 13.4l3.6 3"],
  sparkles: "M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z",
} as const;
