// src/components/fusion/lottie-bee.tsx
"use client";

import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { BEE_LOTTIE } from "./fusion-data";

export function LottieBee({ size = 42, className }: { size?: number; className?: string }) {
  return (
    <div className={className} style={{ width: size, height: size, pointerEvents: "none" }} aria-hidden>
      <DotLottieReact src={BEE_LOTTIE} loop autoplay style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
