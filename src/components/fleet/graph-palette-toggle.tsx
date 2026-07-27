"use client";

import type { CSSProperties } from "react";
import type { OrbitalGraphPalette } from "./orbital-graph";

const GRAPH_PALETTE_OPTIONS: Array<{ id: OrbitalGraphPalette; label: string; title: string }> = [
  { id: "classic", label: "Classic", title: "Classic blue orbital graph" },
  { id: "hive", label: "Hive", title: "Fleet Hive honey graph" },
];

export function GraphPaletteToggle({
  palette,
  onChoose,
  style,
}: {
  palette: OrbitalGraphPalette;
  onChoose: (palette: OrbitalGraphPalette) => void;
  style?: CSSProperties;
}) {
  return (
    <div
      role="group"
      aria-label="Graph color scheme"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 3,
        borderRadius: 9999,
        border: "1px solid var(--line, rgba(148, 163, 184, 0.22))",
        background: "var(--bg-2, rgba(12, 13, 17, 0.58))",
        boxShadow: "0 6px 20px rgba(0,0,0,.25)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        ...style,
      }}
    >
      {GRAPH_PALETTE_OPTIONS.map((option) => {
        const active = palette === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            title={option.title}
            onClick={() => onChoose(option.id)}
            style={{
              cursor: "pointer",
              border: 0,
              borderRadius: 9999,
              padding: "4px 11px",
              fontFamily: "var(--f-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: 0,
              textTransform: "uppercase",
              background: active
                ? option.id === "hive" ? "var(--honey-soft, rgba(231, 180, 92, 0.14))" : "rgba(120, 180, 255, 0.16)"
                : "transparent",
              color: active
                ? option.id === "hive" ? "var(--honey, #e7b45c)" : "#9fd2ff"
                : "var(--fg-3, rgba(148, 163, 184, 0.9))",
              transition: "background 140ms ease, color 140ms ease",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
