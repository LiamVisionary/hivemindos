"use client";

import { HONEY_BEE_LOTTIE_SRC } from "@/components/ui/lottie-asset-cache";
import { LottiePlayer } from "@/components/ui/lottie-player";

const APP_LOADING_BEE_SIZE = 84;

export function AppLoadingBee() {
  return (
    <LottiePlayer src={HONEY_BEE_LOTTIE_SRC} size={APP_LOADING_BEE_SIZE} />
  );
}
