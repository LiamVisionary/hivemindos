import * as React from "react";

import { cn } from "@/lib/utils";

/* Skeleton — shimmer placeholder for loading states. */

function Skeleton({ className, style, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-md bg-[var(--panel-2)] after:absolute after:inset-0 after:-translate-x-full after:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--fg)_7%,transparent),transparent)] after:content-[''] after:animate-[hive-shimmer_1.25s_infinite] motion-reduce:after:animate-none",
        className,
      )}
      style={style}
      {...props}
    />
  );
}

export { Skeleton };

/* Add to your global CSS (or Tailwind @theme):
@keyframes hive-shimmer { 100% { transform: translateX(100%); } }
*/
