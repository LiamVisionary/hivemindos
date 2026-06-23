"use client";

/* icons.tsx — stroke glyphs (24px viewBox) used across the Simulation view. */

import React from "react";

export type IconName =
  | "trade" | "file" | "doc" | "check" | "plus" | "warn" | "alert"
  | "repeat" | "download" | "eye" | "shield" | "sparkles" | "bot" | "branch" | "activity" | "close";

const PATHS: Record<IconName, React.ReactNode> = {
  trade: <path d="M3 17l5-5 3 3 4-6 3 3 3-3" />,
  file: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /></>,
  doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M9.5 13h5M9.5 16.5h5" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  warn: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>,
  repeat: <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>,
  download: <path d="M12 3v12M8 11l4 4 4-4M5 21h14" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
  shield: <><path d="M12 3l7 4v5c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V7z" /><path d="M9 12l2 2 4-4" /></>,
  sparkles: <><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></>,
  bot: <><rect x="5" y="8" width="14" height="11" rx="2.4" /><path d="M12 8V4M9 13h.01M15 13h.01M9 16h6" /></>,
  branch: <><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="8" r="2.4" /><path d="M6 8.4v7.2M8.2 7.2c6 1 4 6 9.4 1.2" /></>,
  activity: <path d="M3 12h4l2.5 7 5-14L17 12h4" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

export function Icon({ name, size = 16, sw = 1.7, color = "currentColor" }: {
  name: IconName; size?: number; sw?: number; color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block", flex: "0 0 auto" }}>
      {PATHS[name]}
    </svg>
  );
}

export function Chevron({ dir = "left", size = 14 }: { dir?: "left" | "right"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }} aria-hidden>
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}
