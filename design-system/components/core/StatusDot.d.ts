import * as React from "react";

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Status tone → dot color. live/working pulse by default. */
  tone?: "live" | "working" | "ready" | "healthy" | "scheduled" | "warning" | "danger" | "offline";
  /** Force the ambient pulse on/off. */
  pulse?: boolean;
  /** Optional text label beside the dot. */
  label?: string;
}

/** A small status signal dot that pulses for live activity. */
export function StatusDot(props: StatusDotProps): JSX.Element;
