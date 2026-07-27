import * as React from "react";

import { cn } from "@/lib/utils";

/* Card — the honeycomb "cell": a solid warm panel with a thin hairline and a
   soft lifted shadow, corners rounded 14px (the refined hive language). */

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-[14px] border border-[var(--line-2)] bg-[var(--surface)] text-[var(--foreground)] shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_18px_50px_-28px_rgba(0,0,0,0.7)]",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("grid gap-1.5 p-[18px] pb-0", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-title" className={cn("font-[var(--font-display)] text-[15px] font-bold leading-none tracking-[-0.2px]", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-description" className={cn("text-[13px] leading-snug text-[var(--muted)]", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-[18px]", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center gap-2 p-[18px] pt-0", className)} {...props} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
