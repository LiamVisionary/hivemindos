import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full border transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-[var(--honey-line)] bg-[var(--honey-soft)] text-[var(--honey)]",
        secondary: "border-[var(--line-2)] bg-transparent text-[var(--fg-3)]",
        success: "border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[var(--success-soft)] text-[var(--success)]",
        warning: "border-[var(--honey-line)] bg-[var(--warning-soft)] text-[var(--warning)]",
        danger: "border-[color-mix(in_srgb,var(--danger)_38%,transparent)] bg-[var(--danger-soft)] text-[var(--danger)]",
        honey: "border-[var(--honey-line)] bg-[var(--honey-soft)] text-[var(--honey)]",
        live: "border-[color-mix(in_srgb,var(--live)_35%,transparent)] bg-[var(--live-soft)] text-[var(--live)]",
        outline: "border-[var(--line-2)] text-[var(--fg-2)]",
      },
      // `mono` = the uppercase JetBrains-Mono status-chip treatment.
      mono: {
        true: "px-[9px] py-[3px] font-mono text-[10px] font-medium uppercase tracking-[0.06em]",
        false: "px-[10px] py-[3px] text-[11px] font-semibold leading-[1.45]",
      },
    },
    defaultVariants: { variant: "default", mono: false },
  },
);

function Badge({
  className,
  variant,
  mono,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant, mono, className }))} {...props} />;
}

export { Badge, badgeVariants };
