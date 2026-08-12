import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold leading-5 transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--button-accent)] text-[var(--accent-strong)]",
        secondary: "border-[var(--line)] bg-[var(--surface-soft)] text-[var(--muted)]",
        success: "border-[rgba(95,143,90,0.28)] bg-[rgba(95,143,90,0.14)] text-[#56794b]",
        warning: "border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[var(--warning-soft)] text-[var(--warning)]",
        danger: "border-[rgba(192,82,77,0.34)] bg-[rgba(192,82,77,0.12)] text-[#8e3328]",
        outline: "border-[var(--line)] text-[var(--foreground)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return <Comp data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
