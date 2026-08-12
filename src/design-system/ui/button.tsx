import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-normal outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99] disabled:pointer-events-none disabled:scale-100 disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Hivemind accent primary with dark text (the refined hive language).
        default: "bg-primary text-primary-foreground shadow-xs hover:brightness-[1.06]",
        secondary: "border border-border bg-secondary text-secondary-foreground hover:brightness-[1.06]",
        outline:
          "border border-[var(--line-2)] bg-transparent text-[var(--fg-2)] hover:border-[var(--line-3)] hover:text-[var(--fg)]",
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        danger: "bg-destructive text-[#2a0f0c] shadow-xs hover:brightness-[1.06]",
        link: "text-[var(--honey)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-[15px] text-[12.5px] has-[>svg]:px-3",
        xs: "h-[26px] gap-1 px-3 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[30px] gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-[42px] px-[22px] text-[13.5px] has-[>svg]:px-4",
        icon: "size-[34px] rounded-[11px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    isLoading?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
  className,
  variant,
  size,
  asChild = false,
  isLoading = false,
  disabled,
  children,
  ...props
}, ref) => {
  const Comp = asChild ? Slot.Root : "button";
  const buttonProps = {
    ref,
    "data-slot": "button",
    "data-variant": variant,
    "data-size": size,
    className: cn(buttonVariants({ variant, size, className })),
    disabled: disabled || isLoading,
    "aria-busy": isLoading || undefined,
    ...props,
  };

  if (asChild) {
    return <Comp {...buttonProps}>{children}</Comp>;
  }

  return (
    <Comp {...buttonProps}>
      {isLoading ? <LoaderCircle className="animate-spin" /> : null}
      {children}
    </Comp>
  );
});
Button.displayName = "Button";

export { Button, buttonVariants };
