"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DotLottie, type Layout } from "@lottiefiles/dotlottie-web";

import {
  getCachedLottieAssetData,
  normalizeLottieSource,
  warmLottieAsset,
} from "@/components/ui/lottie-asset-cache";
import { cn } from "@/lib/utils/cn";

type LottiePlayerProps = {
  src: string;
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
  size?: number;
  width?: number;
  height?: number;
  layout?: Layout;
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
const LOOP_PLAYBACK_WATCH_INTERVAL_MS = 120;
const LOOP_PLAYBACK_RESTART_THROTTLE_MS = 180;

function fixedCanvasDevicePixelRatio() {
  return Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
}

function ignorePlayerCommand(command: () => void | Promise<unknown>) {
  try {
    void Promise.resolve(command()).catch(() => {
      // Best effort: players can be torn down during route swaps.
    });
  } catch {
    // Best effort only; playback guards should never break rendering.
  }
}

function normalizeFixedCanvasDimension(value: number | undefined) {
  return value ? Math.max(1, Math.round(value)) : undefined;
}

function createFixedCanvasRect(
  rect: DOMRect,
  pixelWidth: number,
  pixelHeight: number,
): DOMRect {
  if (typeof DOMRect === "function") {
    return new DOMRect(rect.left, rect.top, pixelWidth, pixelHeight);
  }

  const fixedRect = {
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    width: pixelWidth,
    height: pixelHeight,
    right: rect.left + pixelWidth,
    bottom: rect.top + pixelHeight,
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

function applyFixedCanvasSize(
  canvas: HTMLCanvasElement,
  pixelWidth: number,
  pixelHeight: number,
  devicePixelRatio: number,
) {
  const cssWidth = `${pixelWidth}px`;
  const cssHeight = `${pixelHeight}px`;
  const backingWidth = Math.max(1, Math.round(pixelWidth * devicePixelRatio));
  const backingHeight = Math.max(1, Math.round(pixelHeight * devicePixelRatio));
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;
  if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
  if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
}

function pinCanvasRect(
  canvas: HTMLCanvasElement,
  pixelWidth: number,
  pixelHeight: number,
) {
  const ownDescriptor = Object.getOwnPropertyDescriptor(
    canvas,
    "getBoundingClientRect",
  );
  const getBoundingClientRect = canvas.getBoundingClientRect.bind(canvas);

  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      createFixedCanvasRect(getBoundingClientRect(), pixelWidth, pixelHeight),
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
  width,
  height,
  layout,
  ariaLabel,
}: LottiePlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<DotLottiePlayer | null>(null);
  const pixelWidth = normalizeFixedCanvasDimension(width ?? size ?? height);
  const pixelHeight = normalizeFixedCanvasDimension(height ?? size ?? width);
  const style = useMemo(() => {
    if (pixelWidth === undefined || pixelHeight === undefined)
      return { lineHeight: 0 };

    return {
      width: pixelWidth,
      height: pixelHeight,
      minWidth: pixelWidth,
      minHeight: pixelHeight,
      aspectRatio: `${pixelWidth} / ${pixelHeight}`,
      lineHeight: 0,
    };
  }, [pixelHeight, pixelWidth]);
  const normalizedSrc = normalizeLottieSource(src);
  const [cachedAsset, setCachedAsset] = useState<CachedLottieAssetState | null>(
    () => {
      const data = getCachedLottieAssetData(normalizedSrc);
      return data ? { src: normalizedSrc, data } : null;
    },
  );
  const cachedData =
    cachedAsset?.src === normalizedSrc ? cachedAsset.data : null;

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
    let playbackWatchTimer: number | null = null;
    let lastPlaybackRestartAt = Number.NEGATIVE_INFINITY;
    let player: DotLottiePlayer | null = null;
    const devicePixelRatio = fixedCanvasDevicePixelRatio();
    const fixedWidth = pixelWidth;
    const fixedHeight = pixelHeight;

    if (fixedWidth !== undefined && fixedHeight !== undefined) {
      applyFixedCanvasSize(canvas, fixedWidth, fixedHeight, devicePixelRatio);
      restoreCanvasRect = pinCanvasRect(canvas, fixedWidth, fixedHeight);
    }

    const syncFixedCanvasSize = () => {
      syncAnimationFrame = null;
      if (!player || fixedWidth === undefined || fixedHeight === undefined)
        return;

      applyFixedCanvasSize(canvas, fixedWidth, fixedHeight, devicePixelRatio);
      try {
        player.resize();
      } catch {
        // DotLottie may still be waiting on WASM or animation data during early frames.
      }
      applyFixedCanvasSize(canvas, fixedWidth, fixedHeight, devicePixelRatio);
    };

    const scheduleFixedCanvasSync = () => {
      if (fixedWidth === undefined || fixedHeight === undefined) return;
      if (syncAnimationFrame !== null)
        window.cancelAnimationFrame(syncAnimationFrame);
      syncAnimationFrame = window.requestAnimationFrame(syncFixedCanvasSize);
    };
    const restartLoopPlayback = () => {
      if (!player || !loop || !autoplay) return;

      const now = window.performance.now();
      if (now - lastPlaybackRestartAt < LOOP_PLAYBACK_RESTART_THROTTLE_MS)
        return;
      lastPlaybackRestartAt = now;

      const current = player;
      ignorePlayerCommand(async () => {
        if (!current) return;
        await current.setLoop(true);
        await current.setLoopCount(0);
        if (layout) await current.setLayout(layout);
        await current.stop();
        await current.setFrame(0);
        await current.unfreeze();
        await current.play();
      });
    };
    const watchLoopPlayback = () => {
      if (!player || !loop || !autoplay) return;

      try {
        if (player.isLoaded && !player.isPlaying) restartLoopPlayback();
      } catch {
        // Best effort only while WASM-backed player state settles.
      }
    };
    const startPlaybackWatch = () => {
      if (!loop || !autoplay || playbackWatchTimer !== null) return;
      playbackWatchTimer = window.setInterval(
        watchLoopPlayback,
        LOOP_PLAYBACK_WATCH_INTERVAL_MS,
      );
    };
    const ensurePlaybackConfig = () => {
      if (!player) return;
      ignorePlayerCommand(() => player?.setLoop(loop));
      if (loop) ignorePlayerCommand(() => player?.setLoopCount(0));
      if (layout) ignorePlayerCommand(() => player?.setLayout(layout));
      if (autoplay && !player.isPlaying) restartLoopPlayback();
    };
    const restartLoopOnComplete = () => {
      restartLoopPlayback();
    };

    try {
      const sourceConfig = cachedData
        ? { data: cachedData.slice(0) }
        : { src: normalizedSrc };

      player = new DotLottie({
        canvas,
        ...sourceConfig,
        layout,
        loop,
        loopCount: loop ? 0 : undefined,
        autoplay,
        renderConfig: {
          ...FIXED_CANVAS_RENDER_CONFIG,
          devicePixelRatio,
        },
      });
      player.addEventListener("ready", scheduleFixedCanvasSync);
      player.addEventListener("load", scheduleFixedCanvasSync);
      player.addEventListener("ready", ensurePlaybackConfig);
      player.addEventListener("load", ensurePlaybackConfig);
      player.addEventListener("complete", restartLoopOnComplete);
      playerRef.current = player;
      scheduleFixedCanvasSync();
      ensurePlaybackConfig();
      startPlaybackWatch();
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
      if (playbackWatchTimer !== null) {
        window.clearInterval(playbackWatchTimer);
        playbackWatchTimer = null;
      }
      restoreCanvasRect?.();
      if (!current) return;
      current.removeEventListener("ready", scheduleFixedCanvasSync);
      current.removeEventListener("load", scheduleFixedCanvasSync);
      current.removeEventListener("ready", ensurePlaybackConfig);
      current.removeEventListener("load", ensurePlaybackConfig);
      current.removeEventListener("complete", restartLoopOnComplete);
      // DotLottie's destroy path can remove an already-detached canvas during
      // fast route changes. Keep React in charge of DOM removal and only stop
      // playback here so the real .lottie animation stays intact.
      ignorePlayerCommand(() => current.pause());
      ignorePlayerCommand(() => current.freeze());
      if (playerRef.current === current) playerRef.current = null;
    };
  }, [
    autoplay,
    cachedData,
    layout,
    loop,
    normalizedSrc,
    pixelHeight,
    pixelWidth,
  ]);

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
        width={pixelWidth}
        height={pixelHeight}
        style={{
          display: "block",
          width: pixelWidth ?? "100%",
          height: pixelHeight ?? "100%",
        }}
      />
    </span>
  );
}
