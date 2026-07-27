import * as React from "react";

export interface CopyableCodeLineProps {
  /** The command / id / endpoint to display and copy. */
  code: string;
  /** Optional mono uppercase label above the line. */
  label?: string;
  style?: React.CSSProperties;
}

/** A mono command line with a copy button, for advanced/setup surfaces. */
export function CopyableCodeLine(props: CopyableCodeLineProps): JSX.Element;
