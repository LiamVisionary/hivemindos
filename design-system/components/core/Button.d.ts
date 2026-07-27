import * as React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. default = teal primary. */
  variant?: "default" | "secondary" | "outline" | "ghost" | "danger" | "link";
  /** Control height/padding. */
  size?: "xs" | "sm" | "default" | "lg" | "icon";
  /** Shows a spinner and disables the button. */
  isLoading?: boolean;
}

/**
 * Primary action control for HivemindOS.
 * @startingPoint section="Core" subtitle="Teal primary, secondary, outline, ghost, danger" viewport="700x150"
 */
export function Button(props: ButtonProps): JSX.Element;
