import { DotLottie } from "/loading/dotlottie.js";

const BEE_LOADER_SIZE = 84;
const DEVICE_PIXEL_RATIO = Math.max(
  1,
  Math.min(window.devicePixelRatio || 1, 2),
);
const LOOP_WATCH_INTERVAL_MS = 150;
const LOOP_RESTART_THROTTLE_MS = 220;

const canvas = document.querySelector("[data-hivemindos-bee-lottie]");
const shell = canvas?.closest("[data-hivemindos-bee-shell]");

if (canvas instanceof HTMLCanvasElement) {
  const backingSize = Math.max(
    1,
    Math.round(BEE_LOADER_SIZE * DEVICE_PIXEL_RATIO),
  );
  let lastRestartAt = Number.NEGATIVE_INFINITY;
  let loopWatchTimer = null;

  canvas.width = backingSize;
  canvas.height = backingSize;
  canvas.style.width = `${BEE_LOADER_SIZE}px`;
  canvas.style.height = `${BEE_LOADER_SIZE}px`;

  DotLottie.setWasmUrl("/loading/dotlottie-player.wasm");

  const player = new DotLottie({
    canvas,
    src: "/loading/Honey%20bee.lottie",
    loop: true,
    loopCount: 0,
    autoplay: true,
    renderConfig: {
      autoResize: false,
      devicePixelRatio: DEVICE_PIXEL_RATIO,
      freezeOnOffscreen: false,
    },
  });

  const markReady = () => {
    shell?.classList.add("beeReady");
  };

  const restartLoop = () => {
    const now = window.performance.now();
    if (now - lastRestartAt < LOOP_RESTART_THROTTLE_MS) return;
    lastRestartAt = now;

    try {
      player.setLoop(true);
      player.setLoopCount(0);
      if (player.totalFrames > 0) player.setFrame(0);
      player.unfreeze();
      player.play();
    } catch {
      shell?.classList.add("beeFailed");
    }
  };

  const ensureLoop = () => {
    markReady();
    try {
      player.setLoop(true);
      player.setLoopCount(0);
      if (!player.isPlaying) restartLoop();
    } catch {
      shell?.classList.add("beeFailed");
    }
  };

  player.addEventListener("ready", ensureLoop);
  player.addEventListener("load", ensureLoop);
  player.addEventListener("complete", restartLoop);

  loopWatchTimer = window.setInterval(() => {
    try {
      if (player.isLoaded && !player.isPlaying) restartLoop();
    } catch {
      shell?.classList.add("beeFailed");
    }
  }, LOOP_WATCH_INTERVAL_MS);

  window.addEventListener(
    "pagehide",
    () => {
      if (loopWatchTimer !== null) window.clearInterval(loopWatchTimer);
      try {
        player.pause();
        player.freeze();
      } catch {
        // The loading shell can be torn down while the WASM player is still settling.
      }
    },
    { once: true },
  );
}
