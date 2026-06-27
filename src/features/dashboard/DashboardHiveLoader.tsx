"use client";

import { HONEY_BEE_LOTTIE_SRC } from "@/components/ui/lottie-asset-cache";
import { LottiePlayer } from "@/components/ui/lottie-player";
import { createStyleClass } from "@/features/dashboard/style-classes";
import loaderStyles from "./DashboardHiveLoader.module.css";

const loaderClass = createStyleClass(loaderStyles);
const BEE_LOADER_SIZE = { width: 86, height: 66 } as const;
const COMPACT_BEE_LOADER_SIZE = { width: 58, height: 45 } as const;
const PROMINENT_BEE_LOADER_SIZE = 84;

export function DashboardHiveLoader({
  compact = false,
  detail = "Reading vault notes and link edges",
  inline = false,
  prominent = false,
  title = "Mapping shared brain",
}: {
  compact?: boolean;
  detail?: string;
  inline?: boolean;
  prominent?: boolean;
  title?: string;
}) {
  const beeSize = prominent
    ? PROMINENT_BEE_LOADER_SIZE
    : compact
      ? COMPACT_BEE_LOADER_SIZE
      : BEE_LOADER_SIZE;
  const beeSizing =
    typeof beeSize === "number"
      ? { size: beeSize }
      : { width: beeSize.width, height: beeSize.height };

  return (
    <div
      className={loaderClass(
        "brainLoader",
        compact && "compact",
        inline && "inline",
      )}
      role="status"
      aria-live="polite"
    >
      <LottiePlayer
        src={HONEY_BEE_LOTTIE_SRC}
        className={loaderClass("brainLoaderBee")}
        {...beeSizing}
      />
      <div className={loaderClass("brainLoaderCopy")}>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <div className={loaderClass("brainLoadingRail")} aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
