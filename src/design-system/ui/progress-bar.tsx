import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* ProgressBar — loading bars & metric meters. Determinate (value 0–100),
   indeterminate (sweeping), or a thin 3px meter (thickness <= 4). */

const fillTone = cva("h-full rounded-full transition-[width] duration-500", {
  variants: {
    tone: {
      honey: "bg-[var(--honey)]",
      live: "bg-[var(--live)]",
      danger: "bg-[var(--danger)]",
      neutral: "bg-[var(--fg-3)]",
    },
  },
  defaultVariants: { tone: "honey" },
});

type ProgressBarProps = React.ComponentProps<"div"> &
  VariantProps<typeof fillTone> & {
    value?: number;
    indeterminate?: boolean;
    thickness?: number;
    label?: React.ReactNode;
  };

function ProgressBar({ className, value = 0, indeterminate = false, tone, thickness = 8, label, ...props }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("grid gap-1.5", className)} {...props}>
      {label ? (
        <div className="flex justify-between font-mono text-[11px] text-[var(--fg-3)]">
          <span>{label}</span>
          {!indeterminate ? <span className="text-[var(--fg-2)]">{pct}%</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="relative overflow-hidden rounded-full bg-[var(--line-2)]"
        style={{ height: thickness }}
      >
        {indeterminate ? (
          <span className={cn(fillTone({ tone }), "absolute inset-y-0 w-[40%] animate-[hive-progress_1.3s_ease-in-out_infinite]")} />
        ) : (
          <span className={cn(fillTone({ tone }), "block")} style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}

export { ProgressBar };

/* Add to your global CSS (or Tailwind @theme):
@keyframes hive-progress { 0% { left: -40%; } 100% { left: 100%; } }
*/
