"use client";

/* CompanionBackdrop.tsx — the graph-view atmosphere behind Sara: the same
 * faint 48px grid and particle field as the fleet graph's classic palette
 * (src/components/fleet/orbital-graph.tsx), except the particles scatter
 * across the WHOLE frame with a slow drift instead of forming the orb.
 * Voice-reactive the same way: the Queen's live output level brightens the
 * field. Decorative motion only — 30fps cap, skips entirely while hidden.
 */

import { useEffect, useRef } from "react";
import { readQueenVoiceAmplitude } from "@/lib/audio/queen-voice-amplitude";

// Classic (blue) palette values lifted verbatim from ORBITAL_GRAPH_PALETTES.
const GRID_STROKE = "rgba(90, 140, 220, 0.05)";
const PARTICLE_CORE: [number, number, number] = [225, 240, 255];
const PARTICLE_SHELL: [number, number, number] = [150, 200, 255];

const PARTICLE_COUNT = 130;
const GRID_STEP = 48;

type DriftParticle = {
  /** Position as a fraction of the frame (wraps at the edges). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  bright: boolean;
  twinkle: number;
};

function rgba([r, g, b]: [number, number, number], alpha: number) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makeDriftParticles(): DriftParticle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random(),
    y: Math.random(),
    // Slow, directionless drift — fractions of the frame per second.
    vx: (Math.random() - 0.5) * 0.008,
    vy: (Math.random() - 0.5) * 0.008,
    size: 0.6 + Math.random() * 1.5,
    bright: Math.random() < 0.22,
    twinkle: Math.random() * Math.PI * 2,
  }));
}

export function CompanionBackdrop() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!root || !canvas || !ctx) return;

    const particles = makeDriftParticles();
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;

    const resize = () => {
      w = root.clientWidth;
      h = root.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(root);

    let lastFrame = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (now - lastFrame < 33) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      if (!w || !h) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Faint backdrop grid (same stroke + 48px pitch as the fleet graph).
      ctx.strokeStyle = GRID_STROKE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0.5; gx < w; gx += GRID_STEP) { ctx.moveTo(gx, 0); ctx.lineTo(gx, h); }
      for (let gy = 0.5; gy < h; gy += GRID_STEP) { ctx.moveTo(0, gy); ctx.lineTo(w, gy); }
      ctx.stroke();

      const { level: voiceAmp } = readQueenVoiceAmplitude();

      for (const p of particles) {
        p.x = (p.x + p.vx * dt + 1) % 1;
        p.y = (p.y + p.vy * dt + 1) % 1;
        const twinkle = 0.65 + 0.35 * Math.sin(now * 0.002 + p.twinkle);
        const alpha = (p.bright ? 0.5 : 0.28) * twinkle * (1 + voiceAmp * 0.85);
        ctx.fillStyle = p.bright
          ? rgba(PARTICLE_CORE, Math.min(1, alpha + 0.15))
          : rgba(PARTICLE_SHELL, alpha);
        const s = p.size;
        ctx.fillRect(p.x * w - s / 2, p.y * h - s / 2, s, s);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={rootRef} aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}

export default CompanionBackdrop;
