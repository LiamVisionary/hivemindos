"use client";

import { useEffect, useMemo, useRef } from "react";
import { DotLottie } from "@lottiefiles/dotlottie-react";

import { cn } from "@/lib/utils/cn";

type LottiePlayerProps = {
  src: string;
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
  size?: number;
  ariaLabel?: string;
};

type DotLottiePlayer = InstanceType<typeof DotLottie>;

function normalizeLottieSource(src: string) {
  if (/^(?:https?:|data:|blob:)/i.test(src)) {
    return src;
  }

  return src
    .split("/")
    .map((part, index) => {
      if (index === 0 || part.length === 0) {
        return part;
      }

      try {
        return encodeURIComponent(decodeURIComponent(part));
      } catch {
        return encodeURIComponent(part);
      }
    })
    .join("/");
}

export function LottiePlayer({
  src,
  className,
  loop = true,
  autoplay = true,
  size,
  ariaLabel,
}: LottiePlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<DotLottiePlayer | null>(null);
  const pixelSize = size ? Math.max(1, Math.round(size)) : undefined;
  const style = useMemo(() => pixelSize
    ? {
        width: pixelSize,
        height: pixelSize,
        minWidth: pixelSize,
        minHeight: pixelSize,
        aspectRatio: "1 / 1",
        lineHeight: 0,
      }
    : { lineHeight: 0 }, [pixelSize]);
  const normalizedSrc = normalizeLottieSource(src);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let player: DotLottiePlayer | null = null;
    try {
      player = new DotLottie({
        canvas,
        src: normalizedSrc,
        loop,
        autoplay,
        renderConfig: { autoResize: false, devicePixelRatio: 1 },
      });
      playerRef.current = player;
    } catch {
      playerRef.current = null;
    }

    return () => {
      const current = player;
      player = null;
      if (!current) return;
      // DotLottie's destroy path can remove an already-detached canvas during
      // fast route changes. Keep React in charge of DOM removal and only stop
      // playback here so the real .lottie animation stays intact.
      try {
        current.pause();
      } catch (error) {
        console.warn("Failed to pause lottie animation before unmount.", error);
      }
      try {
        current.freeze();
      } catch {
        // Best-effort only: some unmounts happen before the WASM player is ready.
      }
      if (playerRef.current === current) playerRef.current = null;
    };
  }, [autoplay, loop, normalizedSrc]);

  return (
    <span
      className={cn("inline-block", className)}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      style={style}
    >
      <canvas
        ref={canvasRef}
        width={pixelSize}
        height={pixelSize}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </span>
  );
}
