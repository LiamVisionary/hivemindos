"use client";

import * as React from "react";
import styles from "./queen-voice.module.css";

/**
 * Live microphone waveform for the voice control bar: mirrored bars driven by
 * the mic analyser's time-domain signal, so the user can SEE their voice being
 * picked up (and see it flatline when the mic reads nothing, or when muted).
 * Drawing runs on rAF with the same timer backstop the barge-in watcher uses —
 * WKWebView starves rAF on idle pages, and a frozen meter would falsely read
 * as a dead mic. Under prefers-reduced-motion the meter updates on a slow
 * timer instead of turning off: the bars are the signal, not decoration.
 */
const BAR_COUNT = 24;
const BACKSTOP_MS = 33;
const RAF_STALL_MS = 64;
const REDUCED_MOTION_MS = 140;
// Per-bar envelope: fast attack so onsets pop, slower release so syllables
// read as a smooth ripple instead of a strobe.
const ATTACK = 0.6;
const RELEASE = 0.24;
// Speech RMS lands around 0.05-0.25; scale into the 0..1 bar range.
const MIC_GAIN = 4.5;
const CSS_WIDTH = 92;
const CSS_HEIGHT = 26;

export function VoiceWaveform({
  analyserRef,
  muted,
}: {
  analyserRef: React.RefObject<AnalyserNode | null>;
  muted: boolean;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const mutedRef = React.useRef(muted);
  React.useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return undefined;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(CSS_WIDTH * dpr);
    canvas.height = Math.round(CSS_HEIGHT * dpr);
    const levels = new Float32Array(BAR_COUNT);
    let samples: Uint8Array<ArrayBuffer> | null = null;
    let cachedColor = "";
    let colorReadAt = 0;
    let raf = 0;
    let lastTickAt = 0;

    const draw = () => {
      lastTickAt = performance.now();
      const analyser = analyserRef.current;
      const drawMuted = mutedRef.current;
      if (analyser && !drawMuted) {
        if (!samples || samples.length !== analyser.fftSize) {
          samples = new Uint8Array(analyser.fftSize);
        }
        analyser.getByteTimeDomainData(samples);
        const sliceSize = Math.max(1, Math.floor(samples.length / BAR_COUNT));
        for (let bar = 0; bar < BAR_COUNT; bar += 1) {
          let sum = 0;
          const start = bar * sliceSize;
          for (let index = start; index < start + sliceSize; index += 1) {
            const normalized = ((samples[index] ?? 128) - 128) / 128;
            sum += normalized * normalized;
          }
          const target = Math.min(1, Math.sqrt(sum / sliceSize) * MIC_GAIN);
          const level = levels[bar];
          levels[bar] =
            level + (target - level) * (target > level ? ATTACK : RELEASE);
        }
      } else {
        // No analyser yet (session still connecting) or muted: settle flat.
        for (let bar = 0; bar < BAR_COUNT; bar += 1) levels[bar] *= 0.8;
      }
      // The bar color comes from CSS (theme + muted class); re-read it at
      // most every 500ms so theme flips land without a per-frame style recalc.
      if (!cachedColor || lastTickAt - colorReadAt > 500) {
        cachedColor = getComputedStyle(canvas).color;
        colorReadAt = lastTickAt;
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = cachedColor;
      context.globalAlpha = drawMuted ? 0.35 : 0.9;
      const slot = canvas.width / BAR_COUNT;
      const barWidth = Math.max(1, slot * 0.55);
      const centerY = canvas.height / 2;
      const minBar = Math.max(1, 1.5 * dpr);
      const maxBar = canvas.height - 2 * dpr;
      for (let bar = 0; bar < BAR_COUNT; bar += 1) {
        const height = Math.max(minBar, levels[bar] * maxBar);
        const x = bar * slot + (slot - barWidth) / 2;
        const y = centerY - height / 2;
        if (typeof context.roundRect === "function") {
          context.beginPath();
          context.roundRect(x, y, barWidth, height, barWidth / 2);
          context.fill();
        } else {
          context.fillRect(x, y, barWidth, height);
        }
      }
      context.globalAlpha = 1;
    };

    const loop = () => {
      raf = window.requestAnimationFrame(loop);
      if (document.hidden) return;
      draw();
    };
    let backstop = 0;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      backstop = window.setInterval(() => {
        if (!document.hidden) draw();
      }, REDUCED_MOTION_MS);
    } else {
      raf = window.requestAnimationFrame(loop);
      backstop = window.setInterval(() => {
        if (document.hidden) return;
        if (performance.now() - lastTickAt <= RAF_STALL_MS) return;
        draw();
      }, BACKSTOP_MS);
    }
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearInterval(backstop);
    };
  }, [analyserRef]);

  return (
    <canvas
      ref={canvasRef}
      className={`${styles.waveformCanvas} ${muted ? styles.waveformCanvasMuted : ""}`}
      style={{ width: CSS_WIDTH, height: CSS_HEIGHT }}
      aria-hidden="true"
    />
  );
}
