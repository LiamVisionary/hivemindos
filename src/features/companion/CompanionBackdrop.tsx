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

// Classic (blue) palette colours lifted from ORBITAL_GRAPH_PALETTES. The
// graph packs 850 particles into the orb; scattered across the whole frame
// the field needs fewer but BRIGHTER points (and a slightly stronger grid)
// to read at all — the graph's 0.05 grid alpha vanished behind the hologram.
const GRID_STROKE = "rgba(90, 140, 220, 0.09)";
const PARTICLE_CORE: [number, number, number] = [225, 240, 255];
const PARTICLE_SHELL: [number, number, number] = [150, 200, 255];
// The graph's ambient: a navy base with its glow colours washed wide across
// the frame (the graph concentrates these into the orb; here they halo Sara
// and tint the whole view so it reads blue, not black).
const BASE_NAVY = "#0a1122";
const GLOW_CORE: [number, number, number] = [200, 230, 255];
const GLOW_MID: [number, number, number] = [110, 170, 255];
const GLOW_OUTER: [number, number, number] = [45, 95, 210];

const PARTICLE_COUNT = 340;
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
    size: 0.9 + Math.random() * 1.9,
    bright: Math.random() < 0.25,
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

      const { level: voiceAmp } = readQueenVoiceAmplitude();

      // Navy base + the graph's blue glow washed across the whole frame,
      // centred behind Sara (breathes gently with her voice).
      ctx.fillStyle = BASE_NAVY;
      ctx.fillRect(0, 0, w, h);
      const gx0 = w / 2;
      const gy0 = h * 0.47;
      const gR = Math.max(w, h) * 0.85;
      const glow = ctx.createRadialGradient(gx0, gy0, 0, gx0, gy0, gR);
      glow.addColorStop(0, rgba(GLOW_CORE, Math.min(1, 0.24 + voiceAmp * 0.12)));
      glow.addColorStop(0.2, rgba(GLOW_MID, Math.min(1, 0.19 + voiceAmp * 0.1)));
      glow.addColorStop(0.55, rgba(GLOW_OUTER, 0.13));
      glow.addColorStop(1, rgba(GLOW_OUTER, 0.03));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // Faint backdrop grid (same stroke + 48px pitch as the fleet graph).
      ctx.strokeStyle = GRID_STROKE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0.5; gx < w; gx += GRID_STEP) { ctx.moveTo(gx, 0); ctx.lineTo(gx, h); }
      for (let gy = 0.5; gy < h; gy += GRID_STEP) { ctx.moveTo(0, gy); ctx.lineTo(w, gy); }
      ctx.stroke();

      for (const p of particles) {
        p.x = (p.x + p.vx * dt + 1) % 1;
        p.y = (p.y + p.vy * dt + 1) % 1;
        const twinkle = 0.65 + 0.35 * Math.sin(now * 0.002 + p.twinkle);
        const alpha = (p.bright ? 0.8 : 0.45) * twinkle * (1 + voiceAmp * 0.85);
        ctx.fillStyle = p.bright
          ? rgba(PARTICLE_CORE, Math.min(1, alpha + 0.2))
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
