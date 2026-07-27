import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* HexCell — the signature honeycomb hexagon tile for agents, machines, and the
   Queen. Holds an icon / bee portrait / glyph. Lifts on hover. */

const HEX_CLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

const cellTone = cva("", {
  variants: {
    tone: {
      honey: "[--hex-border:var(--honey)] [--hex-glow:var(--honey-soft)]",
      live: "[--hex-border:var(--live)] [--hex-glow:var(--live-soft)]",
      neutral: "[--hex-border:var(--line-3)] [--hex-glow:transparent]",
      danger: "[--hex-border:var(--danger)] [--hex-glow:var(--danger-soft)]",
    },
  },
  defaultVariants: { tone: "neutral" },
});

type HexCellProps = React.ComponentProps<"div"> &
  VariantProps<typeof cellTone> & {
    size?: number;
    selected?: boolean;
    pulse?: boolean;
  };

function HexCell({ className, tone, size = 96, selected = false, pulse = false, children, ...props }: HexCellProps) {
  return (
    <div
      data-slot="hex-cell"
      className={cn(
        "group relative grid origin-center place-items-center transition-[transform,filter] duration-500 ease-[cubic-bezier(0.22,0.61,0.18,1)] hover:-translate-y-1.5 hover:scale-105 hover:[filter:drop-shadow(0_12px_18px_rgba(0,0,0,0.42))]",
        selected && "scale-[1.06]",
        cellTone({ tone }),
        className,
      )}
      style={{ width: size, height: size * 1.1547 }}
      {...props}
    >
      <span className="absolute inset-0 opacity-60 group-hover:opacity-90" style={{ clipPath: HEX_CLIP, background: "var(--hex-border)" }} />
      <span className="absolute inset-[2px] grid place-items-center bg-[var(--panel)]" style={{ clipPath: HEX_CLIP }}>
        <span
          className={cn("absolute inset-0", pulse && "animate-[hive-breathe_4s_ease-in-out_infinite]")}
          style={{ background: "radial-gradient(circle, var(--hex-glow), transparent 70%)" }}
        />
      </span>
      <span className="relative grid size-[62%] place-items-center">{children}</span>
    </div>
  );
}

export { HexCell };

/* Add to your global CSS (or Tailwind @theme):
@keyframes hive-breathe { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
*/
