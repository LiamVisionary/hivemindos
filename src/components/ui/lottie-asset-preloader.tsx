"use client";

import { useEffect } from "react";

import { warmLottieAsset } from "@/components/ui/lottie-asset-cache";

type LottieAssetPreloaderProps = {
  src: string;
};

export function LottieAssetPreloader({ src }: LottieAssetPreloaderProps) {
  useEffect(() => {
    void warmLottieAsset(src).catch(() => undefined);
  }, [src]);

  return null;
}
