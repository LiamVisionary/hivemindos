"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils/cn";

function TooltipProvider({
  delayDuration = 120,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />;
}

function Tooltip(rawProps: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const { open, ...props } = rawProps;
  const hasControlledOpen = Object.prototype.hasOwnProperty.call(rawProps, "open");
  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      {...props}
      {...(hasControlledOpen ? { open: Boolean(open) } : {})}
    />
  );
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  arrowClassName,
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  arrowClassName?: string;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-[260px] rounded-md border border-[var(--line)] bg-[var(--button-popover)] px-3 py-1.5 text-xs text-[var(--button-popover-foreground)] shadow-xl animate-in fade-in-0 zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className={cn("fill-[var(--button-popover)]", arrowClassName)} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
