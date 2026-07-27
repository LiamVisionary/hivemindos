import * as React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic tone. default = honey accent. */
  variant?: "default" | "secondary" | "success" | "warning" | "danger" | "honey" | "live" | "outline";
  /** Mono uppercase treatment (JetBrains Mono, wide tracking) for status chips. */
  mono?: boolean;
}

/**
 * Compact status / label pill with human-readable text.
 * @startingPoint section="Core" subtitle="Status pills: running, needs funding, tailnet-only" viewport="700x120"
 */
export function Badge(props: BadgeProps): JSX.Element;
