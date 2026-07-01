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
const LOOP_PLAYBACK_WATCH_INTERVAL_MS = 500;
const LOOP_PLAYBACK_RESTART_THROTTLE_MS = 180;

// Point DotLottie at the locally served WASM (Next route at
// src/app/loading/dotlottie-player.wasm/route.ts) instead of the default
// public CDN, avoiding a cross-origin round-trip on first paint. Must run
// once, before any player instance is constructed.
const LOCAL_DOT_LOTTIE_WASM_URL = "/loading/dotlottie-player.wasm";
let dotLottieWasmUrlConfigured = false;
function configureLocalDotLottieWasm() {
  if (dotLottieWasmUrlConfigured || typeof window === "undefined") return;
  dotLottieWasmUrlConfigured = true;
  try {
    DotLottie.setWasmUrl(LOCAL_DOT_LOTTIE_WASM_URL);
  } catch {
    // Best effort: fall back to the library default if the setter is unavailable.
  }
}

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
    let lastObservedFrame: number | null = null;
    let player: DotLottiePlayer | null = null;

    // TEMP-BEE-DIAG: beacon the thinking-bee loader's real state from inside the
    // Tauri webview so we can see what actually stalls it. Remove after diagnosis.
    let beeDiagTimer: number | null = null;
    const BEE_DIAG = ariaLabel === "Worker bee thinking";
    const beeBeacon = (tag: string) => {
      if (!BEE_DIAG) return;
      try {
        const p = player as unknown as {
          isLoaded?: boolean; isPlaying?: boolean; isFrozen?: boolean;
          currentFrame?: number; totalFrames?: number; loopCount?: number;
        } | null;
        const msg = JSON.stringify({
          t: Math.round(window.performance.now()),
          tag,
          loaded: p?.isLoaded, playing: p?.isPlaying, frozen: p?.isFrozen,
          frame: p?.currentFrame, total: p?.totalFrames, loops: p?.loopCount,
          hidden: typeof document !== "undefined" ? document.hidden : null,
          vis: typeof document !== "undefined" ? document.visibilityState : null,
          focus: typeof document !== "undefined" ? document.hasFocus() : null,
        });
        const url = "http://localhost:8920/beacon";
        if (navigator.sendBeacon) navigator.sendBeacon(url, msg);
        else void fetch(url, { method: "POST", body: msg, mode: "no-cors", keepalive: true });
      } catch {
        // diagnostics must never break rendering
      }
    };
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
      // Skip the playback check while the tab is hidden; the interval stays
      // alive and resumes watching once the document becomes visible again.
      // Rendering is legitimately paused while hidden, so clear the stall
      // tracker to avoid a false positive on the first visible tick.
      if (typeof document !== "undefined" && document.hidden) {
        lastObservedFrame = null;
        return;
      }

      try {
        if (!player.isLoaded) return;
        // A stopped/paused player never resumes on its own — restart it.
        if (!player.isPlaying) {
          lastObservedFrame = null;
          restartLoopPlayback();
          return;
        }
        // is_playing() can stay true while nothing actually renders: freeze()
        // halts the rAF render loop without clearing the flag, and an occluded
        // or backgrounded webview (common in the packaged desktop app) starves
        // requestAnimationFrame the same way. A plain !isPlaying check never
        // fires for these, so the bee freezes for good. Recover a frozen player
        // and, failing that, detect the stall by watching whether the frame
        // advances on a clip that is supposed to be looping continuously.
        if (player.isFrozen) {
          lastObservedFrame = null;
          restartLoopPlayback();
          return;
        }
        const frame = player.currentFrame;
        const animates = player.totalFrames > 1;
        if (animates && lastObservedFrame !== null && frame === lastObservedFrame) {
          // No advance across a full watch interval on a multi-frame loop means
          // the render loop has stalled even though is_playing() is still true.
          lastObservedFrame = null;
          restartLoopPlayback();
          return;
        }
        lastObservedFrame = frame;
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
      configureLocalDotLottieWasm();
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
      // TEMP-BEE-DIAG: trace lifecycle + every-frame error events for the bee.
      if (BEE_DIAG) {
        beeBeacon("create");
        player.addEventListener("ready", () => beeBeacon("ready"));
        player.addEventListener("load", () => beeBeacon("load"));
        player.addEventListener("complete", () => beeBeacon("complete"));
        player.addEventListener("freeze", () => beeBeacon("freeze"));
        player.addEventListener("pause", () => beeBeacon("pause"));
        player.addEventListener("stop", () => beeBeacon("stop"));
        const re = player as unknown as { addEventListener: (e: string, cb: (ev: unknown) => void) => void };
        re.addEventListener("renderError", (ev: unknown) => beeBeacon("renderError:" + JSON.stringify((ev as { error?: unknown })?.error ?? "")));
        re.addEventListener("loadError", (ev: unknown) => beeBeacon("loadError:" + JSON.stringify((ev as { error?: unknown })?.error ?? "")));
        beeDiagTimer = window.setInterval(() => beeBeacon("tick"), 400);
      }
      scheduleFixedCanvasSync();
      ensurePlaybackConfig();
      startPlaybackWatch();
    } catch {
      playerRef.current = null;
    }

    return () => {
      const current = player;
      // TEMP-BEE-DIAG
      if (BEE_DIAG) beeBeacon("unmount");
      if (beeDiagTimer !== null) {
        window.clearInterval(beeDiagTimer);
        beeDiagTimer = null;
      }
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
