// src/components/fleet/orbital-graph.tsx
"use client";

import * as React from "react";
import type { FleetAlert, FleetMachine, FleetTask } from "./fleet-data";
import styles from "./orbital-graph.module.css";

export interface OrbitalGraphProps {
  machines: FleetMachine[];
  selected: string;
  onSelectMachine: (id: string) => void;
  alerts: FleetAlert[];
  tasks: FleetTask[];
  ticker: string[];
}

const PARTICLE_COUNT = 850;

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

/** HH:MM:SS.cs readout, rendered on a fast tick isolated from the rest of the HUD. */
function HudClock() {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 100);
    return () => window.clearInterval(t);
  }, []);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    <div style={{ fontSize: 19, color: "#dcebff", letterSpacing: "0.08em", textShadow: "0 0 14px rgba(130,190,255,0.6)" }}>
      {now
        ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(Math.floor(now.getMilliseconds() / 10))}`
        : "--:--:--.--"}
    </div>
  );
}

export function OrbitalGraph({ machines, selected, onSelectMachine, alerts, tasks, ticker }: OrbitalGraphProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  // The canvas loop reads fleet data through refs so prop updates never
  // restart the animation (which would visibly reseed the particle cloud).
  const machinesRef = React.useRef(machines);
  const selectedRef = React.useRef(selected);
  React.useEffect(() => {
    machinesRef.current = machines;
    selectedRef.current = selected;
  }, [machines, selected]);

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

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!w || !h) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { cx, cy, R } = orbGeometry(w, h);

      // Faint backdrop grid.
      ctx.strokeStyle = "rgba(90, 140, 220, 0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0.5; gx < w; gx += 48) { ctx.moveTo(gx, 0); ctx.lineTo(gx, h); }
      for (let gy = 0.5; gy < h; gy += 48) { ctx.moveTo(0, gy); ctx.lineTo(w, gy); }
      ctx.stroke();

      // Core glow.
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.1);
      glow.addColorStop(0, "rgba(200, 230, 255, 0.85)");
      glow.addColorStop(0.22, "rgba(110, 170, 255, 0.32)");
      glow.addColorStop(0.6, "rgba(45, 95, 210, 0.10)");
      glow.addColorStop(1, "rgba(45, 95, 210, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.1, 0, Math.PI * 2);
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
        const alpha = (0.10 + 0.45 * depth) * twinkle * (1.25 - p.r * 0.5);
        const px = cx + x1 * R * p.r;
        const py = cy + y2 * R * p.r * 0.96;
        ctx.fillStyle = p.r < 0.22
          ? `rgba(225, 240, 255, ${Math.min(1, alpha + 0.25)})`
          : `rgba(150, 200, 255, ${alpha})`;
        const s = p.size * (0.75 + 0.45 * depth);
        ctx.fillRect(px - s / 2, py - s / 2, s, s);
      }

      // Dashed boundary ring + tick marks.
      ctx.strokeStyle = "rgba(120, 175, 255, 0.28)";
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
        ctx.strokeStyle = `rgba(130, 185, 255, ${major ? 0.5 : 0.2})`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0);
        ctx.lineTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1);
        ctx.stroke();
      }

      // Counter-rotating sweep arcs.
      const arc = (radius: number, start: number, span: number, alpha: number, width: number) => {
        ctx.strokeStyle = `rgba(150, 200, 255, ${alpha})`;
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
        ctx.strokeStyle = `rgba(140, 195, 255, ${isSel ? 0.5 : 0.16})`;
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
  ].slice(0, 9);

  const { cx, cy, R } = orbGeometry(size.w, size.h);
  const sessionId = (selectedMachine?.tailnet?.split(".")[0] || selectedMachine?.id || "fleet")
    .toUpperCase()
    .slice(0, 14);

  return (
    <div ref={rootRef} className={styles.root}>
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
      <div className={styles.panel} style={{ top: 14, left: 16, maxWidth: 360 }}>
        <div className={styles.monoCap} style={{ color: "#a9c9f5", fontSize: 10 }}>
          H.I.V.E. · Hive &amp; machine intelligence system
        </div>
        <div className={styles.monoCap}>
          Sector: fleet ops &nbsp;·&nbsp; {machines.length} nodes &nbsp;·&nbsp; {totalAgents} agents
        </div>
      </div>

      {/* Top-right — clock + session. */}
      <div className={styles.panel} style={{ top: 14, right: 16, alignItems: "flex-end", textAlign: "right" }}>
        <HudClock />
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
                  a.state === "working" ? "rgba(160, 215, 255, 0.95)"
                  : a.state === "failed" ? "rgba(251, 113, 133, 0.85)"
                  : "rgba(90, 130, 200, 0.35)",
              }}
            />
          ))}
        </div>
        <div className={styles.monoCap} style={{ marginTop: 4 }}>{workingAgents} / {totalAgents} engaged</div>
        <div className={styles.monoCap} style={{ marginTop: 10 }}>Diagnostics</div>
        <div style={{ width: "100%", textAlign: "right" }}>
          {diagnostics.length ? diagnostics.map((d) => (
            <div key={d.key} className={styles.logLine}>
              <span style={{ color: "#5d7eb4" }}>[{d.since}]</span> {d.text}
            </div>
          )) : (
            <div className={styles.logLine}>channel quiet · no diagnostics</div>
          )}
        </div>
      </div>

      {/* Left — selected-node telemetry. */}
      {selectedMachine ? (
        <div className={`${styles.panel} ${styles.sideOnly}`} style={{ top: 84, left: 16, width: 196 }}>
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

      {/* Left bottom — task feed. */}
      <div className={`${styles.panel} ${styles.sideOnly}`} style={{ bottom: 64, left: 16, width: 250 }}>
        <div className={styles.monoCap}>Task channel</div>
        {tasks.slice(0, 6).map((t) => (
          <div
            key={t.id}
            className={styles.logLine}
            style={{
              color:
                t.lane === "doing" ? "#8fe6c0"
                : t.lane === "blocked" ? "#ffb38a"
                : t.lane === "done" ? "#5d7eb4"
                : "#8fb7ff",
            }}
          >
            {t.eta.padEnd(6, " ")} {t.title}
          </div>
        ))}
        {!tasks.length && <div className={styles.logLine}>no tasks in flight</div>}
      </div>

      {/* Bottom center — primary readout. */}
      <div className={styles.panel} style={{ bottom: 18, left: "50%", transform: "translateX(-50%)", alignItems: "center" }}>
        <div className={styles.primaryCard}>
          <div className={styles.row} style={{ marginBottom: 6 }}>
            <span className={styles.monoCap}>Primary telemetry</span>
            <span className={styles.monoCap}>Mission · {selectedMachine?.name ?? "fleet"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 22 }}>
            <div>
              <div className={styles.bigStat}>{totalAgents}</div>
              <div className={styles.monoCap}>agents</div>
            </div>
            <div>
              <div className={styles.smallStat}>{workingAgents}</div>
              <div className={styles.monoCap}>working</div>
            </div>
            <div>
              <div className={styles.smallStat}>{machines.length}</div>
              <div className={styles.monoCap}>machines</div>
            </div>
            <div>
              <div className={styles.smallStat}>{doingTasks}</div>
              <div className={styles.monoCap}>tasks live</div>
            </div>
          </div>
          <div className={styles.monoCap} style={{ marginTop: 8 }}>
            swarm load {avgCpu}% · status {workingAgents ? "engaged" : "idle"} · str {avgPing} ms
          </div>
        </div>
      </div>

      {/* Bottom right — link stats. */}
      <div className={`${styles.panel} ${styles.sideOnly}`} style={{ bottom: 18, right: 16, alignItems: "flex-end" }}>
        <div className={styles.monoCap}>uplink: {avgPing ? "stable" : "—"}</div>
        <div className={styles.monoCap}>nodes: {machines.length}</div>
        <div className={styles.monoCap}>agents: {totalAgents}</div>
        <div className={styles.monoCap}>packet loss: 0.00%</div>
      </div>

      {/* Bottom left corner — mesh flavor. */}
      <div className={`${styles.panel} ${styles.sideOnly}`} style={{ bottom: 18, left: 16 }}>
        <div className={styles.monoCap}>mesh link: stable</div>
        <div className={styles.monoCap}>rotation lock: auto</div>
      </div>

      <div className={styles.scanlines} />
    </div>
  );
}
