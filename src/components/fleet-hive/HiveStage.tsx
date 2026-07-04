"use client";

/* HiveStage.tsx — the living hive: Queen at the heart, machines ringed around
   her, agents budded off as tessellating hex petals, pheromone light flowing
   along the threads. Everything is laid out on a fixed 1440×980 canvas that
   FleetHiveView scales to fit. */

import { Fragment, useMemo, useRef } from "react";
import { useQueenVoicePulse } from "@/lib/audio/queen-voice-amplitude";
import type { AgentState, HiveMachine, HiveMachineKind, HiveSelection } from "./fleet-hive-types";
import { frMachineState, frStateMeta } from "./fleet-hive-types";
import {
  AGENT_SIZE, FR_HEX_CLIP, HIVE_H, HIVE_W, MACHINE_SIZE, QX, QY,
  frAddMachinePos, frAgentNameSegments, frBuildLayout, type Pt,
} from "./hive-geometry";

interface Tone {
  fill: string;
  border: string;
  glow: string | null;
}

// ---- the hex cell ---------------------------------------------------------
function HiveCell({
  x, y, size, tone, selected, dim, pulse, bounce, onClick, title, children, z,
}: {
  x: number; y: number; size: number; tone: Tone;
  selected?: boolean; dim?: boolean; pulse?: boolean; bounce?: boolean;
  onClick?: () => void; title?: string; children?: React.ReactNode; z?: number;
}) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      title={title}
      className="fr-cell"
      data-selected={selected ? "true" : undefined}
      style={{
        position: "absolute", left: x, top: y, width: size, height: size,
        // the outer node only holds the absolute-centering; the lift layer below
        // owns scale/translate (selection + hover) entirely in CSS, so neither
        // fights this inline transform.
        transform: "translate(-50%, -50%)",
        ["--fr-z" as string]: z ?? (selected ? 6 : 4),
        cursor: onClick ? "pointer" : "default",
        transition: "opacity .4s",
        opacity: dim ? 0.4 : 1,
      } as React.CSSProperties}
    >
      <div
        className="fr-cell-lift"
        style={{ animation: bounce ? "fr-breathe 0.88s ease" : undefined }}
      >
        {tone.glow ? (
          <div
            style={{
              position: "absolute", inset: -size * 0.34, borderRadius: "50%",
              background: `radial-gradient(circle, ${tone.glow}, transparent 68%)`,
              animation: pulse ? "fr-cell-breathe 3.2s ease-in-out infinite" : undefined,
              pointerEvents: "none",
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute", inset: 0, clipPath: FR_HEX_CLIP,
            background: tone.fill, border: "0",
            boxShadow: `inset 0 0 0 1.4px ${tone.border}, inset 0 ${size * 0.5}px ${size * 0.6}px -${size * 0.4}px rgba(255,255,255,0.06)`,
            // NB: no backdrop-filter here. The fill is fully opaque, so a blur shows
            // nothing through it — but Chromium/WebView2 paints backdrop-filter to the
            // element's RECTANGLE, ignoring clip-path, which drew a visible box around
            // each hex on Windows. WebKit clipped it, so Mac never showed the artifact.
          }}
        />
        <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} aria-hidden>
          <polygon points="50,2 92,25 92,75 50,98 8,75 8,25" fill="none" stroke={tone.border} strokeWidth={selected ? 2 : 1.3} strokeLinejoin="round" />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>{children}</div>
      </div>
    </div>
  );
}

function frMachineTone(state: AgentState, selected: boolean): Tone {
  const base: Tone =
    ({
      working: { fill: "color-mix(in srgb, var(--live) 13%, var(--panel))", border: "color-mix(in srgb, var(--live) 60%, var(--line-3))", glow: "var(--live-soft)" },
      setup: { fill: "color-mix(in srgb, var(--honey) 12%, var(--panel))", border: "var(--honey-line)", glow: "var(--honey-soft)" },
      failed: { fill: "color-mix(in srgb, var(--danger) 13%, var(--panel))", border: "color-mix(in srgb, var(--danger) 58%, var(--line-3))", glow: "var(--danger-soft)" },
      ready: { fill: "var(--panel)", border: "var(--line-3)", glow: null },
    } as Record<string, Tone>)[state] || { fill: "var(--panel)", border: "var(--line-3)", glow: null };
  if (selected) return { ...base, border: "var(--honey)", glow: base.glow || "var(--honey-soft)" };
  return base;
}

function frAgentTone(state: AgentState, selected: boolean): Tone {
  const tints: Record<string, Tone> = {
    working: { fill: "color-mix(in srgb, var(--live) 18%, var(--panel-2))", border: "color-mix(in srgb, var(--live) 70%, transparent)", glow: "var(--live-soft)" },
    scheduled: { fill: "color-mix(in srgb, var(--honey) 15%, var(--panel-2))", border: "var(--honey-line)", glow: null },
    setup: { fill: "color-mix(in srgb, var(--honey) 10%, var(--panel-2))", border: "var(--honey-line)", glow: null },
    failed: { fill: "color-mix(in srgb, var(--danger) 16%, var(--panel-2))", border: "color-mix(in srgb, var(--danger) 64%, transparent)", glow: "var(--danger-soft)" },
    ready: { fill: "var(--panel-2)", border: "var(--line-2)", glow: null },
  };
  const t = tints[state] || tints.ready;
  return selected ? { ...t, border: "var(--honey)", glow: t.glow || "var(--honey-soft)" } : t;
}

// ---- machine-kind icons ---------------------------------------------------
function MachineKindIcon({ kind, color, size = 22 }: { kind: HiveMachineKind; color: string; size?: number }) {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color,
    strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "Laptop":
      return (<svg {...common}><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 20h20l-1.5-2.5h-17L2 20z" /></svg>);
    case "Cloud Server":
      return (<svg {...common}><path d="M7 18a4 4 0 0 1-.6-7.95A5 5 0 0 1 16 9.5a3.5 3.5 0 0 1 1 6.86" /><path d="M8 18h9" /><circle cx="9.5" cy="14.5" r="0.3" fill={color} /></svg>);
    case "Home Server":
      return (<svg {...common}><rect x="4" y="4" width="16" height="7" rx="1.4" /><rect x="4" y="13" width="16" height="7" rx="1.4" /><circle cx="7.5" cy="7.5" r="0.4" fill={color} /><circle cx="7.5" cy="16.5" r="0.4" fill={color} /></svg>);
    case "Edge":
      return (<svg {...common}><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" /></svg>);
    case "Mobile":
      return (<svg {...common}><rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M11 18.5h2" /></svg>);
    case "Desktop":
    default:
      return (<svg {...common}><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M9 20h6M12 16v4" /></svg>);
  }
}

// ---- agent name along the lower hex edges ---------------------------------
function AgentEdgeName({ name, selected }: { name: string; selected: boolean }) {
  const segs = frAgentNameSegments(name);
  if (!segs.length) return null;
  const color = selected ? "var(--honey-2)" : "var(--fg)";
  const len = segs.reduce((n, s) => n + s.length, 0);
  const fs = len > 14 ? 8.4 : len > 10 ? 9.2 : 10;
  // Each lower hex edge is ~42 units long. Rather than squeezing a long segment
  // with lengthAdjust (which smears the glyphs into an illegible blur — very
  // visible on long auto-generated names like the e2e agents), truncate it to
  // what actually fits and add an ellipsis. The full name stays on hover (the
  // cell's title attribute).
  const EDGE_FIT_W = 42;
  const maxChars = Math.max(2, Math.floor(EDGE_FIT_W / (fs * 0.56)));
  const clamp = (s: string) => (s.length > maxChars ? s.slice(0, maxChars - 1).trimEnd() + "…" : s);
  const left = clamp(segs[0]);
  const right = segs.length > 1 ? clamp(segs[1]) : null;
  return (
    <svg viewBox="0 0 100 100" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
      <g fill={color} stroke="var(--bg)" strokeWidth="2.6" strokeLinejoin="round" paintOrder="stroke" style={{ fontFamily: "var(--f-body)", fontWeight: 700 }}>
        {/* a lone word hugs the bottom-left edge, just like the first segment of
            a two-part name; a second segment hugs the bottom-right edge. */}
        <text x="47" y="91" fontSize={fs} textAnchor="end" dominantBaseline="middle" transform="rotate(30 47 91)">{left}</text>
        {right ? (
          <text x="53" y="91" fontSize={fs} textAnchor="start" dominantBaseline="middle" transform="rotate(-30 53 91)">{right}</text>
        ) : null}
      </g>
    </svg>
  );
}

// ---- dashed "add" cell (per-machine "add agent", or the global "add machine") -
function AddAgentCell({ x, y, size, dim, title, label, dataBee, onClick }: { x: number; y: number; size: number; dim?: boolean; title?: string; label?: string; dataBee?: string; onClick?: () => void }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      title={title}
      className="fr-addcell"
      data-bee={dataBee}
      style={{
        position: "absolute", left: x, top: y, width: size, height: size,
        transform: "translate(-50%, -50%)", cursor: onClick ? "pointer" : "default", zIndex: 2,
        opacity: dim ? 0.32 : 0.9, transition: "opacity .4s",
      }}
    >
      <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
        <polygon className="fr-addcell-hex" points="50,2 92,25 92,75 50,98 8,75 8,25" fill="transparent" stroke="var(--line-3)" strokeWidth="1.4" strokeDasharray="4 5" strokeLinejoin="round" />
        <path className="fr-addcell-plus" d="M50 41 V 59 M41 50 H 59" stroke="var(--fg-4)" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      {label ? (
        <span
          style={{
            position: "absolute", left: "50%", top: "100%", transform: "translate(-50%, 4px)",
            whiteSpace: "nowrap", pointerEvents: "none",
            fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 15,
            letterSpacing: "-0.02em", color: "var(--fg-3)",
          }}
        >{label}</span>
      ) : null}
    </div>
  );
}

// ---- pheromone thread + travelling light ----------------------------------
function Thread({ a, b, lit, flow, delay = 0, dur = 2.6 }: { a: Pt; b: Pt; lit?: boolean; flow?: boolean; delay?: number; dur?: number }) {
  const stroke = lit ? "var(--honey-line)" : "var(--line-2)";
  const path = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  return (
    <g>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={lit ? 1.5 : 1} strokeLinecap="round" />
      {flow ? (
        <circle r="2.6" fill="var(--honey-2)" opacity="0.95">
          <animateMotion path={path} dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;1;1;0" dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" />
        </circle>
      ) : null}
    </g>
  );
}

export function HiveStage({
  machines,
  sel,
  onSelect,
  onOpenAgentSettings,
  onAddAgent,
  onAddMachine,
  onOpenQueenSettings,
  newAgentId,
  workerBeeSrc = "/icons/worker-bee-general-v5.png",
  queenBeeSrc = "/icons/queen-bee-v2.png",
}: {
  machines: HiveMachine[];
  sel: HiveSelection;
  onSelect: (s: HiveSelection) => void;
  onOpenAgentSettings?: (machineId: string, agentId: string) => void;
  onAddAgent?: (m: HiveMachine) => void;
  onAddMachine?: () => void;
  onOpenQueenSettings?: () => void;
  newAgentId?: string | null;
  workerBeeSrc?: string;
  queenBeeSrc?: string;
}) {
  const layout = useMemo(() => frBuildLayout(machines), [machines]);
  const activeMachineId = sel.type === "machine" ? sel.id : sel.type === "agent" ? sel.machineId : null;
  // The Queen cell breathes to her voice while she speaks in voice chat: the
  // pulse hook writes `--queen-amp` (0..1) on this node every frame (imperative,
  // so HiveStage's fleet-poll re-renders never touch the 60fps path).
  const queenCellRef = useRef<HTMLDivElement | null>(null);
  useQueenVoicePulse(queenCellRef);

  const threads = machines.map((m, i) => {
    const L = layout[m.id];
    const hasWorking = m.agents.some((a) => a.state === "working");
    const lit = activeMachineId === m.id || sel.type === "queen";
    return <Thread key={"q" + m.id} a={{ x: QX, y: QY }} b={L.pos} lit={lit} flow={hasWorking} delay={i * 0.5} dur={2.8} />;
  });

  return (
    <div style={{ position: "absolute", inset: 0 }} onClick={() => onSelect({ type: "queen" })}>
      {/* atmosphere (honey glow + honeycomb texture) is rendered full-bleed in
          the hive area by FleetHiveView, so it fills the canvas at any zoom. */}

      {/* threads */}
      <svg width={HIVE_W} height={HIVE_H} viewBox={`0 0 ${HIVE_W} ${HIVE_H}`} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {threads}
      </svg>

      {/* agent cells */}
      {machines.map((m) =>
        layout[m.id].agents.map(({ agent, pos }) => {
          const selected = sel.type === "agent" && sel.id === agent.id;
          const tone = frAgentTone(agent.state, selected);
          const dim = !!activeMachineId && activeMachineId !== m.id;
          return (
            <HiveCell
              key={agent.id}
              x={pos.x} y={pos.y} size={AGENT_SIZE} tone={tone}
              selected={selected} dim={dim} pulse={agent.state === "working"}
              bounce={newAgentId === agent.id}
              // First click selects the petal; clicking it again while already
              // selected opens its settings (so a double-click on an unselected
              // agent lands straight in its AgentSettingsModal).
              onClick={() =>
                selected && onOpenAgentSettings
                  ? onOpenAgentSettings(m.id, agent.id)
                  : onSelect({ type: "agent", id: agent.id, machineId: m.id })
              }
              title={
                onOpenAgentSettings
                  ? `${agent.name} · ${frStateMeta(agent.state).label} (click again to open settings)`
                  : `${agent.name} · ${frStateMeta(agent.state).label}`
              }
              z={selected ? 7 : 3}
            >
              <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={agent.iconSrc || workerBeeSrc} alt="" width={81} height={81}
                  style={{ transform: "translateY(-4%)", opacity: agent.state === "ready" && !selected ? 0.78 : 1, filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.4))" }}
                />
              </span>
              <AgentEdgeName name={agent.name} selected={selected} />
            </HiveCell>
          );
        }),
      )}

      {/* dashed "add agent" cell — one per machine */}
      {machines.map((m) => {
        const ap = layout[m.id].addPos;
        if (!ap) return null;
        const dim = !!activeMachineId && activeMachineId !== m.id;
        return (
          <AddAgentCell
            key={"add-" + m.id} x={ap.x} y={ap.y} size={AGENT_SIZE} dim={dim}
            title={`Add agent to ${m.name}`}
            dataBee={`fleet-hive-add-${m.name}`}
            onClick={onAddAgent ? () => onAddAgent(m) : () => onSelect({ type: "machine", id: m.id })}
          />
        );
      })}

      {/* machine cells */}
      {machines.map((m) => {
        const L = layout[m.id];
        const st = frMachineState(m);
        const selected = sel.type === "machine" && sel.id === m.id;
        const dim = !!activeMachineId && activeMachineId !== m.id && sel.type !== "queen";
        const tone = frMachineTone(st, selected);
        return (
          <Fragment key={m.id}>
            <HiveCell
              x={L.pos.x} y={L.pos.y} size={MACHINE_SIZE} tone={tone}
              selected={selected} dim={dim} pulse={st === "working"}
              onClick={() => onSelect({ type: "machine", id: m.id })}
              title={`${m.name} · ${m.role}`} z={selected ? 8 : 5}
            >
              {/* icon centred in the hex; the name hugs the lower edges using
                  the same edge-label logic as the agent cells. */}
              <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                <MachineKindIcon kind={m.kind} size={39} color={selected ? "var(--honey)" : m.role === "Primary" ? "var(--honey)" : "var(--fg-2)"} />
              </span>
              <AgentEdgeName name={m.name} selected={selected} />
            </HiveCell>
          </Fragment>
        );
      })}

      {/* dashed "add machine" cell — sits just outside the ring in the widest
          gap between machines, so it never stacks under a bottom machine */}
      {onAddMachine ? (() => {
        const amp = frAddMachinePos(machines);
        return (
          <AddAgentCell
            x={amp.x} y={amp.y} size={MACHINE_SIZE} title="Onboard a new machine"
            label="New Machine" onClick={() => onAddMachine()}
          />
        );
      })() : null}

      {/* the Queen */}
      <div
        ref={queenCellRef}
        onClick={(e) => { e.stopPropagation(); onSelect({ type: "queen" }); }}
        onDoubleClick={(e) => { e.stopPropagation(); onOpenQueenSettings?.(); }}
        title={onOpenQueenSettings ? "The Queen · orchestrator (double-click to open settings)" : "The Queen · orchestrator"}
        className="fr-queen-cell"
        data-selected={sel.type === "queen" ? "true" : undefined}
        style={{
          position: "absolute", left: QX, top: QY, width: 150, height: 150,
          transform: "translate(-50%, -50%)", cursor: "pointer", zIndex: 9,
        }}
      >
        {/* inner lift layer — selection scale + hover lift live in CSS, mirroring
            the worker/machine cells. */}
        <div className="fr-queen-lift">
          {/* honey halo: idle breathe by default; while she speaks in voice chat
              it tracks her voice amplitude via --queen-amp (see fleet-hive.css
              and src/lib/audio/queen-voice-amplitude.ts). */}
          <div className="fr-queen-glow" />
          {/* opaque fill — no backdrop-filter (it was clipped to the hex on WebKit
              but drew a rectangular box around it on Chromium/WebView2; see HiveCell). */}
          <div style={{ position: "absolute", inset: 0, clipPath: FR_HEX_CLIP, background: "color-mix(in srgb, var(--honey) 16%, var(--panel))" }} />
          <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} aria-hidden>
            <polygon points="50,2 92,25 92,75 50,98 8,75 8,25" fill="none" stroke={sel.type === "queen" ? "var(--honey)" : "var(--honey-line)"} strokeWidth={sel.type === "queen" ? 2.2 : 1.6} strokeLinejoin="round" />
          </svg>
          <div className="fr-queen-core" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={queenBeeSrc} alt="" width={91} height={91} style={{ filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.45))" }} />
          </div>
          <div style={{ position: "absolute", left: "50%", top: "calc(100% + 6px)", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none" }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 13, color: "var(--honey)" }}>Queen</div>
            <div style={{ fontSize: 9.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 1 }}>orchestrator</div>
          </div>
        </div>
      </div>
    </div>
  );
}
