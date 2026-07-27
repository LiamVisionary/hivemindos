import * as React from "react";

export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Width (number = px, or CSS string like "55%"). */
  w?: number | string;
  /** Height in px. */
  h?: number | string;
  /** Border radius in px (use 99 for pills, 50% via style for circles). */
  r?: number;
}

/** A shimmer placeholder block for loading states. */
export function Skeleton(props: SkeletonProps): JSX.Element;
