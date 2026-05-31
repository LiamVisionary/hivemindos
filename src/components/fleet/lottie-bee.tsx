// src/components/fleet/lottie-bee.tsx
"use client";

import { LottiePlayer } from "@/components/ui/lottie-player";

interface LottieBeeProps {
  size?: number;
  className?: string;
}

/**
 * The Honey-bee Lottie that travels along Tailscale edges in the graph & map
 * views. Wraps the repo's existing LottiePlayer so it inherits the dynamic-
 * import / no-SSR behavior automatically.
 */
export function LottieBee({ size = 44, className }: LottieBeeProps) {
  return (
    <LottiePlayer
      src="/animations/Honey%20bee.lottie"
      size={size}
      loop
      autoplay
      className={className}
      ariaLabel="Honey bee"
    />
  );
}
