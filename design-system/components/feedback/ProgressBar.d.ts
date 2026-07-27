import * as React from "react";

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Fill percentage 0–100 (ignored when indeterminate). */
  value?: number;
  /** Unknown-duration loading — sweeps instead of filling. */
  indeterminate?: boolean;
  /** Fill color. */
  tone?: "honey" | "live" | "danger" | "neutral";
  /** Track height in px. <=4 renders as a thin metric "meter". */
  thickness?: number;
  /** Optional label above the bar (shows % when determinate). */
  label?: string;
}

/**
 * A loading bar / metric meter — determinate, indeterminate, or thin meter.
 * @startingPoint section="Feedback" subtitle="Loading bar & metric meter" viewport="700x120"
 */
export function ProgressBar(props: ProgressBarProps): JSX.Element;
