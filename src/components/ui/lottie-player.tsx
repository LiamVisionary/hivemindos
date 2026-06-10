"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DotLottie } from "@lottiefiles/dotlottie-web";

import { getCachedLottieAssetData, normalizeLottieSource, warmLottieAsset } from "@/components/ui/lottie-asset-cache";
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

type CachedLottieAssetState = {
  src: string;
  data: ArrayBuffer;
};

const FIXED_CANVAS_RENDER_CONFIG = {
  autoResize: false,
  freezeOnOffscreen: false,
} as const;

function fixedCanvasDevicePixelRatio() {
  return Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
}

function createFixedCanvasRect(rect: DOMRect, pixelSize: number): DOMRect {
  if (typeof DOMRect === "function") {
    return new DOMRect(rect.left, rect.top, pixelSize, pixelSize);
  }

  const fixedRect = {
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    width: pixelSize,
    height: pixelSize,
    right: rect.left + pixelSize,
    bottom: rect.top + pixelSize,
    toJSON() {
      return {
        x: this.x,
        y: this.y,
        left: this.left,
        top: this.top,
        width: this.width,
        height: this.height,
        right: this.right,
        bottom: this.bottom,
      };
    },
  };

  return fixedRect as DOMRect;
}

function applyFixedCanvasSize(canvas: HTMLCanvasElement, pixelSize: number, devicePixelRatio: number) {
  const cssSize = `${pixelSize}px`;
  const backingSize = Math.max(1, Math.round(pixelSize * devicePixelRatio));
  if (canvas.width !== backingSize) canvas.width = backingSize;
  if (canvas.height !== backingSize) canvas.height = backingSize;
  if (canvas.style.width !== cssSize) canvas.style.width = cssSize;
  if (canvas.style.height !== cssSize) canvas.style.height = cssSize;
}

function pinCanvasRect(canvas: HTMLCanvasElement, pixelSize: number) {
  const ownDescriptor = Object.getOwnPropertyDescriptor(canvas, "getBoundingClientRect");
  const getBoundingClientRect = canvas.getBoundingClientRect.bind(canvas);

  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => createFixedCanvasRect(getBoundingClientRect(), pixelSize),
  });

  return () => {
    if (ownDescriptor) {
      Object.defineProperty(canvas, "getBoundingClientRect", ownDescriptor);
      return;
    }

    Reflect.deleteProperty(canvas, "getBoundingClientRect");
  };
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
  const [cachedAsset, setCachedAsset] = useState<CachedLottieAssetState | null>(() => {
    const data = getCachedLottieAssetData(normalizedSrc);
    return data ? { src: normalizedSrc, data } : null;
  });
  const cachedData = cachedAsset?.src === normalizedSrc ? cachedAsset.data : null;

  useEffect(() => {
    let mounted = true;
    const publishData = (data: ArrayBuffer) => {
      if (mounted) setCachedAsset({ src: normalizedSrc, data });
    };

    const readyData = getCachedLottieAssetData(normalizedSrc);
    if (readyData) {
      queueMicrotask(() => publishData(readyData));
      return () => {
        mounted = false;
      };
    }

    void warmLottieAsset(normalizedSrc)
      .then((data) => {
        if (data) publishData(data);
      })
      .catch(() => {
        // Non-fatal: the player can still load from the original src below.
      });

    return () => {
      mounted = false;
    };
  }, [normalizedSrc]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let restoreCanvasRect: (() => void) | null = null;
    let syncAnimationFrame: number | null = null;
    let player: DotLottiePlayer | null = null;
    const devicePixelRatio = fixedCanvasDevicePixelRatio();

    if (pixelSize) {
      applyFixedCanvasSize(canvas, pixelSize, devicePixelRatio);
      restoreCanvasRect = pinCanvasRect(canvas, pixelSize);
    }

    const syncFixedCanvasSize = () => {
      syncAnimationFrame = null;
      if (!player || !pixelSize) return;

      applyFixedCanvasSize(canvas, pixelSize, devicePixelRatio);
      try {
        player.resize();
      } catch {
        // DotLottie may still be waiting on WASM or animation data during early frames.
      }
      applyFixedCanvasSize(canvas, pixelSize, devicePixelRatio);
    };

    const scheduleFixedCanvasSync = () => {
      if (!pixelSize) return;
      if (syncAnimationFrame !== null) window.cancelAnimationFrame(syncAnimationFrame);
      syncAnimationFrame = window.requestAnimationFrame(syncFixedCanvasSize);
    };

    try {
      const sourceConfig = cachedData
        ? { data: cachedData.slice(0) }
        : { src: normalizedSrc };

      player = new DotLottie({
        canvas,
        ...sourceConfig,
        loop,
        autoplay,
        renderConfig: {
          ...FIXED_CANVAS_RENDER_CONFIG,
          devicePixelRatio,
        },
      });
      player.addEventListener("ready", scheduleFixedCanvasSync);
      player.addEventListener("load", scheduleFixedCanvasSync);
      playerRef.current = player;
      scheduleFixedCanvasSync();
    } catch {
      playerRef.current = null;
    }

    return () => {
      const current = player;
      player = null;
      if (syncAnimationFrame !== null) {
        window.cancelAnimationFrame(syncAnimationFrame);
        syncAnimationFrame = null;
      }
      restoreCanvasRect?.();
      if (!current) return;
      current.removeEventListener("ready", scheduleFixedCanvasSync);
      current.removeEventListener("load", scheduleFixedCanvasSync);
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
  }, [autoplay, cachedData, loop, normalizedSrc, pixelSize]);

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
        style={{
          display: "block",
          width: pixelSize ?? "100%",
          height: pixelSize ?? "100%",
        }}
      />
    </span>
  );
}
