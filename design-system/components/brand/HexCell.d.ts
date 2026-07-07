import * as React from "react";

export interface HexCellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Width in px; height is derived (pointy-top hex ratio). */
  size?: number;
  /** Border/glow tone. honey = Queen/orchestrator, live = working, danger = trouble. */
  tone?: "honey" | "live" | "neutral" | "danger";
  /** Rest slightly enlarged. */
  selected?: boolean;
  /** Ambient breathing glow (live activity). */
  pulse?: boolean;
}

/**
 * The signature honeycomb cell — a pointy-top hex tile for machines, agents,
 * and the Queen. Holds an icon, portrait, or glyph.
 * @startingPoint section="Brand" subtitle="Signature honeycomb hex cell tile" viewport="700x220"
 */
export function HexCell(props: HexCellProps): JSX.Element;
