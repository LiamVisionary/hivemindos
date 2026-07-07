import * as React from "react";

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Diameter in px. */
  size?: number;
  /** Stroke width. */
  thickness?: number;
  /** Arc color. */
  tone?: "honey" | "live" | "current";
  /** Optional label beside the ring. */
  label?: string;
}

/** A spinning ring for in-progress / loading states. */
export function Spinner(props: SpinnerProps): JSX.Element;
