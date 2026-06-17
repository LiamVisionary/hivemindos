import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils/cn";

type CloseIconButtonProps = Omit<React.ComponentProps<"button">, "children"> & {
  iconClassName?: string;
  size?: "sm" | "md";
};

const sizeClasses = {
  sm: "size-6 [&_svg]:size-3",
  md: "size-8 [&_svg]:size-3.5",
};

const CloseIconButton = React.forwardRef<HTMLButtonElement, CloseIconButtonProps>(({
  className,
  iconClassName,
  size = "md",
  type = "button",
  ...props
}, ref) => (
  <button
    ref={ref}
    type={type}
    data-slot="close-icon-button"
    className={cn(
      "inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-soft)] text-[var(--muted)] transition-all hover:border-[var(--accent-strong)] hover:bg-[var(--button-accent)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--button-ring)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
      sizeClasses[size],
      className,
    )}
    {...props}
  >
    <X aria-hidden="true" className={iconClassName} />
  </button>
));
CloseIconButton.displayName = "CloseIconButton";

export { CloseIconButton };
