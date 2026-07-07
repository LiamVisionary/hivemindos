import * as React from "react";

export interface TooltipProps {
  /** Tooltip body (keep it short; pair technical terms with plain meaning). */
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** Hover/focus delay in ms (default 120). */
  delay?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

/** A hover/focus tooltip on a popover surface with an arrow. */
export function Tooltip(props: TooltipProps): JSX.Element;
