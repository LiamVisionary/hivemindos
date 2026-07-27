// src/components/fleet/orbital-graph.tsx
"use client";

import * as React from "react";
import type { FleetAlert, FleetMachine, FleetTask } from "./fleet-data";
import { readQueenVoiceAmplitude } from "@/lib/audio/queen-voice-amplitude";
import styles from "./orbital-graph.module.css";

export type OrbitalGraphPalette = "classic" | "hive";

export interface OrbitalGraphProps {
  machines: FleetMachine[];
  selected: string;
  onSelectMachine: (id: string) => void;
  alerts: FleetAlert[];
  tasks: FleetTask[];
  ticker: string[];
  showClock?: boolean;
  leftHudInset?: number;
  topLeftHudTop?: number;
  selectedHudTop?: number;
  topRightHudTop?: number;
  palette?: OrbitalGraphPalette;
}

const PARTICLE_COUNT = 850;

type Rgb = readonly [number, number, number];
type OrbitalGraphPaint = {
  clockText: string;
  clockShadow: string;
  grid: string;
  glowCore: Rgb;
  glowMid: Rgb;
  glowOuter: Rgb;
  particleCore: Rgb;
  particleShell: Rgb;
  ring: Rgb;
  tick: Rgb;
  arc: Rgb;
  spoke: Rgb;
};

const ORBITAL_GRAPH_PALETTES: Record<OrbitalGraphPalette, OrbitalGraphPaint> = {
  classic: {
    clockText: "#dcebff",
    clockShadow: "rgba(130,190,255,0.6)",
    grid: "rgba(90, 140, 220, 0.05)",
    glowCore: [200, 230, 255],
    glowMid: [110, 170, 255],
    glowOuter: [45, 95, 210],
    particleCore: [225, 240, 255],
    particleShell: [150, 200, 255],
    ring: [120, 175, 255],
    tick: [130, 185, 255],
    arc: [150, 200, 255],
    spoke: [140, 195, 255],
  },
  hive: {
    clockText: "#f0c879",
    clockShadow: "rgba(231,180,92,0.58)",
    grid: "rgba(231, 180, 92, 0.045)",
    glowCore: [255, 250, 229],
    glowMid: [231, 180, 92],
    glowOuter: [121, 75, 10],
    particleCore: [255, 246, 219],
    particleShell: [240, 200, 121],
    ring: [231, 180, 92],
    tick: [240, 200, 121],
    arc: [240, 200, 121],
    spoke: [231, 180, 92],
  },
};

function rgba([r, g, b]: Rgb, alpha: number) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type Particle = {
  x: number; y: number; z: number;
  r: number;       // 0..1 distance from core (center-dense)
  size: number;
  twinkle: number; // phase offset
};

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => {
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return {
      x: s * Math.cos(phi),
      y: s * Math.sin(phi),
      z: u,
      r: Math.pow(Math.random(), 1.35),
      size: 0.6 + Math.random() * 1.5,
      twinkle: Math.random() * Math.PI * 2,
    };
  });
}

function orbGeometry(w: number, h: number) {
  const R = Math.min(240, Math.min(w, h) * 0.27);
  return { cx: w / 2, cy: h * 0.47, R };
}

function markerAngle(index: number, total: number) {
  return -Math.PI / 2 + (index / Math.max(1, total)) * Math.PI * 2;
}

/** HH:MM:SS readout, rendered on a 1s tick isolated from the rest of the HUD. */
export function HudClock({ palette = "classic" }: { palette?: OrbitalGraphPalette } = {}) {
  const [now, setNow] = React.useState<Date | null>(null);
  const paint = ORBITAL_GRAPH_PALETTES[palette];
  React.useEffect(() => {
    const t = window.setInterval(() => {
      // Don't churn state (and re-render) while the tab/window is hidden.
      if (document.hidden) return;
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(t);
  }, []);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    <div style={{ fontSize: 19, color: paint.clockText, letterSpacing: "0.08em", textShadow: `0 0 14px ${paint.clockShadow}` }}>
      {now
        ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
        : "--:--:--"}
    </div>
  );
}

export function OrbitalGraph({
  machines,
  selected,
  onSelectMachine,
  alerts,
  tasks,
  ticker,
  showClock = true,
  leftHudInset = 16,
  topLeftHudTop = 14,
  selectedHudTop = 84,
  topRightHudTop = 14,
  palette = "classic",
}: OrbitalGraphProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  // The canvas loop reads fleet data through refs so prop updates never
  // restart the animation (which would visibly reseed the particle cloud).
  const machinesRef = React.useRef(machines);
  const selectedRef = React.useRef(selected);
  const paletteRef = React.useRef<OrbitalGraphPalette>(palette);
  React.useEffect(() => {
    machinesRef.current = machines;
    selectedRef.current = selected;
  }, [machines, selected]);
  React.useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  React.useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!root || !canvas || !ctx) return;

    const particles = makeParticles();
    let w = 0, h = 0, dpr = 1;
    let raf = 0;

    const resize = () => {
      w = root.clientWidth;
      h = root.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      setSize({ w, h });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(root);

    // Decorative motion only — cap at ~30fps. Every skipped frame skips the
    // whole scene (grid, gradient, particle trig, ticks), which halves the
    // canvas cost at 60Hz and quarters it on 120Hz displays; the rotation is
    // driven by absolute time, so pacing is unchanged.
    let lastFrame = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      // Skip the redraw entirely while the tab/window is hidden — keep the loop
      // alive so it resumes instantly when the page becomes visible again.
      if (document.hidden) return;
      if (now - lastFrame < 33) return;
      lastFrame = now;
      if (!w || !h) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { cx, cy, R } = orbGeometry(w, h);
      const paint = ORBITAL_GRAPH_PALETTES[paletteRef.current];

      // Voice-reactive breathe: while the Queen speaks in voice chat, her live
      // output amplitude (0..1, envelope-followed to hit the beat) swells the
      // core glow and particle cloud. 0 when she's silent, so the sphere rests
      // at its baseline. Only the core breathes — the HUD rings/markers keep a
      // fixed geometry (the DOM markers are positioned off the unpulsed R).
      const { level: voiceAmp } = readQueenVoiceAmplitude();
      const corePulse = 1 + voiceAmp * 0.09;

      // Faint backdrop grid.
      ctx.strokeStyle = paint.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0.5; gx < w; gx += 48) { ctx.moveTo(gx, 0); ctx.lineTo(gx, h); }
      for (let gy = 0.5; gy < h; gy += 48) { ctx.moveTo(0, gy); ctx.lineTo(w, gy); }
      ctx.stroke();

      // Core glow — brightens and swells with her voice.
      const glowR = R * 1.1 * corePulse;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      glow.addColorStop(0, rgba(paint.glowCore, Math.min(1, 0.85 + voiceAmp * 0.15)));
      glow.addColorStop(0.22, rgba(paint.glowMid, Math.min(1, 0.32 + voiceAmp * 0.3)));
      glow.addColorStop(0.6, rgba(paint.glowOuter, Math.min(1, 0.10 + voiceAmp * 0.14)));
      glow.addColorStop(1, rgba(paint.glowOuter, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Particle sphere, rotating about Y with a fixed tilt.
      const a = now * 0.00012;
      const cosA = Math.cos(a), sinA = Math.sin(a);
      const tilt = 0.32;
      const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
      for (const p of particles) {
        const x1 = p.x * cosA - p.z * sinA;
        const z1 = p.x * sinA + p.z * cosA;
        const y2 = p.y * cosT - z1 * sinT;
        const z2 = p.y * sinT + z1 * cosT;
        const depth = (z2 + 1) / 2; // 0 far .. 1 near
        const twinkle = 0.65 + 0.35 * Math.sin(now * 0.002 + p.twinkle);
        const alpha = (0.10 + 0.45 * depth) * twinkle * (1.25 - p.r * 0.5) * (1 + voiceAmp * 0.85);
        const px = cx + x1 * R * p.r * corePulse;
        const py = cy + y2 * R * p.r * 0.96 * corePulse;
        ctx.fillStyle = p.r < 0.22
          ? rgba(paint.particleCore, Math.min(1, alpha + 0.25))
          : rgba(paint.particleShell, alpha);
        const s = p.size * (0.75 + 0.45 * depth);
        ctx.fillRect(px - s / 2, py - s / 2, s, s);
      }

      // Dashed boundary ring + tick marks.
      ctx.strokeStyle = rgba(paint.ring, 0.28);
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 60; i++) {
        const t = (i / 60) * Math.PI * 2;
        const major = i % 5 === 0;
        const r0 = R * (major ? 1.30 : 1.33);
        const r1 = R * 1.36;
        ctx.strokeStyle = rgba(paint.tick, major ? 0.5 : 0.2);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0);
        ctx.lineTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1);
        ctx.stroke();
      }

      // Counter-rotating sweep arcs.
      const arc = (radius: number, start: number, span: number, alpha: number, width: number) => {
        ctx.strokeStyle = rgba(paint.arc, alpha);
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, start, start + span);
        ctx.stroke();
        ctx.lineWidth = 1;
      };
      arc(R * 1.22, now * 0.0004, 1.1, 0.55, 2);
      arc(R * 1.22, now * 0.0004 + Math.PI, 0.5, 0.3, 2);
      arc(R * 1.44, -now * 0.00025, 1.7, 0.25, 1);

      // Spokes out to the machine markers.
      const ms = machinesRef.current;
      for (let i = 0; i < ms.length; i++) {
        const t = markerAngle(i, ms.length);
        const isSel = ms[i].id === selectedRef.current;
        ctx.strokeStyle = rgba(paint.spoke, isSel ? 0.5 : 0.16);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(t) * R * 1.14, cy + Math.sin(t) * R * 1.14);
        ctx.lineTo(cx + Math.cos(t) * R * 1.52, cy + Math.sin(t) * R * 1.52);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const selectedMachine = machines.find((m) => m.id === selected) ?? machines[0];
  const totalAgents = machines.reduce((n, m) => n + m.agents.length, 0);
  const workingAgents = machines.reduce((n, m) => n + m.agents.filter((a) => a.state === "working").length, 0);
  const avgPing = machines.length
    ? Math.round(machines.reduce((n, m) => n + (m.ping || 0), 0) / machines.length)
    : 0;
  const avgCpu = machines.length
    ? Math.round(machines.reduce((n, m) => n + (m.cpu || 0), 0) / machines.length)
    : 0;
  const doingTasks = tasks.filter((t) => t.lane === "doing").length;

  const diagnostics = [
    ...alerts.map((al) => ({ key: `al-${al.id}`, since: al.since, text: `${al.machine} · ${al.text}` })),
    ...ticker.map((line, i) => ({ key: `tk-${i}`, since: "—", text: line })),
  ].slice(0, 6);

  const { cx, cy, R } = orbGeometry(size.w, size.h);
  const sessionId = (selectedMachine?.tailnet?.split(".")[0] || selectedMachine?.id || "fleet")
    .toUpperCase()
    .slice(0, 14);
  const rootClassName = [styles.root, palette === "hive" ? styles.hivePalette : ""].filter(Boolean).join(" ");

  return (
    <div ref={rootRef} className={rootClassName}>
      <canvas ref={canvasRef} className={styles.canvas} />

      {/* Machine markers around the orbit. */}
      {size.w > 0 && machines.map((m, i) => {
        const t = markerAngle(i, machines.length);
        const working = m.agents.some((a) => a.state === "working");
        const cls = [
          styles.marker,
          m.id === selected ? styles.markerSelected : "",
          working ? styles.markerWorking : "",
        ].join(" ");
        return (
          <button
            key={m.id}
            className={cls}
            style={{ left: cx + Math.cos(t) * R * 1.62, top: cy + Math.sin(t) * R * 1.62 }}
            onClick={() => onSelectMachine(m.id)}
            aria-pressed={m.id === selected}
            title={`${m.name} · ${m.kind} · ${m.agents.length} agents`}
          >
            <span className={styles.markerDiamond} />
            <span className={styles.markerLabel}>{m.name}</span>
          </button>
        );
      })}

      {/* Top-left — system title. */}
      <div className={styles.panel} style={{ top: topLeftHudTop, left: leftHudInset, maxWidth: 360 }}>
        <div className={styles.monoCap} style={{ color: "var(--orb-title-accent)", fontSize: 10 }}>
          H.I.V.E. · Hive &amp; machine intelligence system
        </div>
        <div className={styles.monoCap}>
          Sector: fleet ops &nbsp;·&nbsp; {machines.length} nodes &nbsp;·&nbsp; {totalAgents} agents
        </div>
      </div>

      {/* Top-right — clock + session. */}
      <div className={styles.panel} style={{ top: topRightHudTop, right: 16, alignItems: "flex-end", textAlign: "right" }}>
        {showClock ? <HudClock palette={palette} /> : null}
        <div className={styles.monoCap}>
          Session: {sessionId}
          {selectedMachine ? <> &nbsp;·&nbsp; lat {selectedMachine.lat.toFixed(3)} · lon {selectedMachine.lon.toFixed(3)}</> : null}
        </div>
        {selectedMachine ? (
          <div className={styles.monoCap}>{selectedMachine.location || selectedMachine.city || "—"}</div>
        ) : null}
      </div>

      {/* Right — proximity radar. */}
      <div className={`${styles.panel} ${styles.sideOnly}`} style={{ top: 84, right: 16, alignItems: "flex-end" }}>
        <div className={styles.monoCap}>Proximity</div>
        <div className={styles.radar}>
          <div className={styles.radarRing} style={{ inset: 20 }} />
          <div className={styles.radarRing} style={{ inset: 42 }} />
          <div className={styles.radarSweep} />
          {machines.map((m, i) => {
            const t = markerAngle(i, machines.length);
            const r = 12 + Math.min(1, (m.ping || 0) / 160) * 44;
            return (
              <span
                key={m.id}
                className={styles.radarDot}
                style={{
                  left: 62 + Math.cos(t) * r,
                  top: 62 + Math.sin(t) * r,
                  opacity: m.id === selected ? 1 : 0.65,
                }}
              />
            );
          })}
        </div>
        <div className={styles.monoCap}>avg ping {avgPing} ms</div>
      </div>

      {/* Right — agent I/O + diagnostics. */}
      <div className={`${styles.panel} ${styles.sideOnly}`} style={{ top: 268, right: 16, width: 240, alignItems: "flex-end" }}>
        <div className={styles.monoCap}>Agent I/O</div>
        <div style={{ display: "flex", gap: 6 }}>
          {machines.flatMap((m) => m.agents).slice(0, 8).map((a) => (
            <span
              key={a.id}
              className={styles.agentDot}
              title={`${a.name} · ${a.state}`}
              style={{
                background:
                  a.state === "working" ? "var(--orb-agent-dot-working)"
                  : a.state === "failed" ? "var(--orb-agent-dot-failed)"
                  : "var(--orb-agent-dot-idle)",
              }}
            />
          ))}
        </div>
        <div className={styles.monoCap} style={{ marginTop: 4 }}>{workingAgents} / {totalAgents} engaged</div>
        <div className={styles.monoCap} style={{ marginTop: 10 }}>Diagnostics</div>
        <div style={{ width: "100%", textAlign: "right" }}>
          {diagnostics.length ? diagnostics.map((d) => (
            <div key={d.key} className={styles.logLine}>
              <span style={{ color: "var(--orb-diagnostic-time)" }}>[{d.since}]</span> {d.text}
            </div>
          )) : (
            <div className={styles.logLine}>channel quiet · no diagnostics</div>
          )}
        </div>
        <div className={`${styles.primaryCard} ${styles.primaryCardVertical}`}>
          <div>
            <div className={styles.monoCap}>Primary telemetry</div>
            <div className={styles.monoCap}>Mission · {selectedMachine?.name ?? "fleet"}</div>
          </div>
          <div className={styles.primaryMetricList}>
            <div className={styles.primaryMetricRow}>
              <span className={styles.bigStat}>{totalAgents}</span>
              <span className={styles.monoCap}>agents</span>
            </div>
            <div className={styles.primaryMetricRow}>
              <span className={styles.smallStat}>{workingAgents}</span>
              <span className={styles.monoCap}>working</span>
            </div>
            <div className={styles.primaryMetricRow}>
              <span className={styles.smallStat}>{machines.length}</span>
              <span className={styles.monoCap}>machines</span>
            </div>
            <div className={styles.primaryMetricRow}>
              <span className={styles.smallStat}>{doingTasks}</span>
              <span className={styles.monoCap}>tasks live</span>
            </div>
          </div>
          <div className={styles.monoCap}>
            swarm load {avgCpu}% · status {workingAgents ? "engaged" : "idle"} · str {avgPing} ms
          </div>
          <div className={styles.primaryLinkStats}>
            <span>uplink: {avgPing ? "stable" : "—"}</span>
            <span>nodes: {machines.length}</span>
            <span>agents: {totalAgents}</span>
            <span>packet loss: 0.00%</span>
          </div>
        </div>
      </div>

      {/* Left — selected-node telemetry with task feed constrained underneath. */}
      <div
        className={`${styles.panel} ${styles.leftRail} ${styles.sideOnly}`}
        style={{ top: selectedHudTop, bottom: 64, left: leftHudInset }}
      >
        {selectedMachine ? (
          <div className={styles.nodePanel}>
            <div className={styles.monoCap}>Node status</div>
            <div className={styles.row}>
              <span className={styles.monoCap}>node</span>
              <span className={styles.value}>{selectedMachine.name}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.monoCap}>class</span>
              <span className={styles.value}>{selectedMachine.kind}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.monoCap}>ping</span>
              <span className={styles.value}>{selectedMachine.ping} ms</span>
            </div>
            {([
              ["cpu", selectedMachine.cpu],
              ["ram", selectedMachine.ram],
              ["disk", selectedMachine.disk],
            ] as const).map(([label, pct]) => (
              <div key={label}>
                <div className={styles.row}>
                  <span className={styles.monoCap}>{label}</span>
                  <span className={styles.value}>{Math.round(pct)}%</span>
                </div>
                <div className={styles.bar}>
                  <span className={styles.barFill} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                </div>
              </div>
            ))}
            <div className={styles.row}>
              <span className={styles.monoCap}>uptime</span>
              <span className={styles.value}>{selectedMachine.uptime || "—"}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.monoCap}>build</span>
              <span className={styles.value}>{selectedMachine.version}</span>
            </div>
          </div>
        ) : null}

        <div className={styles.taskPanel}>
          <div className={styles.monoCap}>Task channel</div>
          <div className={styles.taskScroll} role="region" tabIndex={0} aria-label="Fleet task channel">
            {tasks.slice(0, 12).map((t) => (
              <div
                key={t.id}
                className={styles.logLine}
                style={{
                  color:
                    t.lane === "doing" ? "var(--orb-task-doing)"
                    : t.lane === "blocked" ? "var(--orb-task-blocked)"
                    : t.lane === "done" ? "var(--orb-task-done)"
                    : "var(--orb-task-queued)",
                }}
              >
                {t.eta.padEnd(6, " ")} {t.title}
              </div>
            ))}
            {!tasks.length && <div className={styles.logLine}>no tasks in flight</div>}
          </div>
        </div>
      </div>

      {/* Bottom left corner — mesh flavor. */}
      <div className={`${styles.panel} ${styles.sideOnly}`} style={{ bottom: 18, left: leftHudInset }}>
        <div className={styles.monoCap}>mesh link: stable</div>
        <div className={styles.monoCap}>rotation lock: auto</div>
      </div>

      <div className={styles.scanlines} />
    </div>
  );
}
