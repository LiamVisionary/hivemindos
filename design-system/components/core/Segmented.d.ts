import * as React from "react";

export interface SegmentedOption {
  value: string;
  label?: React.ReactNode;
  /** Per-option active tone; "sell" uses the danger fill (solid variant). */
  tone?: "default" | "sell";
}

export interface SegmentedProps {
  /** Options as strings or {value,label,tone} objects. */
  options: Array<string | SegmentedOption>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** subtle = honey-soft active tint (view switches); solid = honey fill + dark text (binary toggles). */
  variant?: "subtle" | "solid";
  size?: "sm" | "default";
  style?: React.CSSProperties;
}

/**
 * A pill segmented control for view/mode switching (hive / graph / map, buy / sell).
 * @startingPoint section="Core" subtitle="Pill segmented view/mode switcher" viewport="700x110"
 */
export function Segmented(props: SegmentedProps): JSX.Element;
