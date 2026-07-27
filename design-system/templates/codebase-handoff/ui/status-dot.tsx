import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* StatusDot — a small status signal dot; live/working pulse. */

const dotVariants = cva("inline-block size-2 shrink-0 rounded-full", {
  variants: {
    tone: {
      live: "bg-[var(--live)] text-[var(--live)]",
      working: "bg-[var(--live)] text-[var(--live)]",
      ready: "bg-[var(--muted)] text-[var(--muted)]",
      healthy: "bg-[var(--success)] text-[var(--success)]",
      scheduled: "bg-[var(--honey)] text-[var(--honey)]",
      warning: "bg-[var(--warning)] text-[var(--warning)]",
      danger: "bg-[var(--danger)] text-[var(--danger)]",
      offline: "bg-[var(--fg-4)] text-[var(--fg-4)]",
    },
    pulse: { true: "animate-[hive-pulse_2.4s_ease-in-out_infinite]", false: "" },
  },
  defaultVariants: { tone: "live", pulse: false },
});

type StatusDotProps = React.ComponentProps<"span"> &
  VariantProps<typeof dotVariants> & { label?: React.ReactNode };

function StatusDot({ className, tone, pulse, label, ...props }: StatusDotProps) {
  const autoPulse = pulse ?? (tone === "live" || tone === "working");
  const dot = <span data-slot="status-dot" className={cn(dotVariants({ tone, pulse: autoPulse }))} />;
  if (!label) return dot;
  return (
    <span className={cn("inline-flex items-center gap-[7px] text-[13px] text-[var(--fg-2)]", className)} {...props}>
      {dot}
      <span>{label}</span>
    </span>
  );
}

export { StatusDot };

/* Add to your global CSS (or Tailwind @theme):
@keyframes hive-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 50%, transparent); }
  50%      { box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 0%, transparent); }
}
*/
