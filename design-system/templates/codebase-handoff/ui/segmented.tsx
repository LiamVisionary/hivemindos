"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/* Segmented — a pill segmented control for view/mode switching.
   `subtle` (honey-soft active tint) or `solid` (honey fill + dark text). */

type SegmentedOption = { value: string; label?: React.ReactNode; tone?: "default" | "sell" };

type SegmentedProps = {
  options: Array<string | SegmentedOption>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  variant?: "subtle" | "solid";
  size?: "sm" | "default";
  className?: string;
};

function Segmented({ options, value, defaultValue, onChange, variant = "subtle", size = "default", className }: SegmentedProps) {
  const norm = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const controlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue ?? norm[0]?.value);
  const current = controlled ? value : internal;

  const pick = (v: string) => {
    if (!controlled) setInternal(v);
    onChange?.(v);
  };

  return (
    <div
      role="group"
      className={cn(
        "inline-flex gap-[3px] rounded-full border border-[var(--line-2)] bg-[color-mix(in_srgb,var(--panel)_70%,transparent)] p-1",
        className,
      )}
    >
      {norm.map((o) => {
        const active = current === o.value;
        const activeCls =
          variant === "solid"
            ? o.tone === "sell"
              ? "bg-[var(--danger)] text-[#2a0f0c]"
              : "bg-primary text-primary-foreground"
            : "bg-[var(--honey-soft)] text-[var(--honey)]";
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            data-active={active ? "" : undefined}
            onClick={() => pick(o.value)}
            className={cn(
              "cursor-pointer whitespace-nowrap rounded-full font-medium transition-colors",
              size === "sm" ? "px-3 py-[5px] text-xs" : "px-4 py-[7px] text-[12.5px]",
              active ? activeCls : "text-[var(--fg-3)] hover:text-[var(--fg)]",
            )}
          >
            {o.label ?? o.value}
          </button>
        );
      })}
    </div>
  );
}

export { Segmented };
