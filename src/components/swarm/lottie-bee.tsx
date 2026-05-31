// src/components/swarm/lottie-bee.tsx
"use client";

import { LottiePlayer } from "@/components/ui/lottie-player";

export function LottieBee({ size = 44, className }: { size?: number; className?: string }) {
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
