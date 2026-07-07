import * as React from "react";

export interface CheckboxProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Optional inline label rendered to the right. */
  label?: React.ReactNode;
  style?: React.CSSProperties;
}

/** A square checkbox with a teal fill when checked. */
export function Checkbox(props: CheckboxProps): JSX.Element;
