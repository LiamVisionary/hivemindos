"use client";

/* HiveStage.tsx — the living hive: Queen at the heart, machines ringed around
   her, agents budded off as tessellating hex petals, pheromone light flowing
   along the threads. Everything is laid out on a fixed 1440×980 canvas that
   FleetHiveView scales to fit. */

import { Fragment, forwardRef, useMemo, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQueenVoicePulse } from "@/lib/audio/queen-voice-amplitude";
import type { AgentState, HiveMachine, HiveMachineKind, HiveSelection } from "./fleet-hive-types";
import { frMachineState, hivePhoneStatus } from "./fleet-hive-types";
import {
  AGENT_SIZE, FR_HEX_CLIP, HIVE_H, HIVE_W, MACHINE_SIZE, QX, QY,
  frAddMachinePos, frAgentNameSegments, frBuildLayout, frPhonePlaceholderPos, type Pt,
} from "./hive-geometry";

interface Tone {
  fill: string;
  border: string;
  glow: string | null;
}

interface HiveCellProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "onClick" | "title"> {
  x: number; y: number; size: number; tone: Tone;
  selected?: boolean; dim?: boolean; pulse?: boolean; bounce?: boolean; spotlight?: boolean;
  onClick?: React.MouseEventHandler<HTMLDivElement>; title?: string; children?: React.ReactNode; z?: number;
}

// ---- the hex cell ---------------------------------------------------------
const HiveCell = forwardRef<HTMLDivElement, HiveCellProps>(function HiveCell({
  x, y, size, tone, selected, dim, pulse, bounce, spotlight, onClick, title, children, z,
  className, style, ...triggerProps
}, ref) {
  return (
    <div
      {...triggerProps}
      ref={ref}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      title={title}
      className={className ? `fr-cell ${className}` : "fr-cell"}
      data-selected={selected ? "true" : undefined}
      data-locate-spotlight={spotlight ? "true" : undefined}
      style={{
        ...style,
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
            boxShadow: `inset 0 0 0 1.4px ${tone.border}, inset 0 ${size * 0.5}px ${size * 0.6}px -${size * 0.4}px var(--fr-cell-sheen)`,
            // NB: no backdrop-filter here. The fill is fully opaque, so a blur shows
            // nothing through it — but Chromium/WebView2 paints backdrop-filter to the
            // element's RECTANGLE, ignoring clip-path, which drew a visible box around
            // each hex on Windows. WebKit clipped it, so Mac never showed the artifact.
          }}
        />
        <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} aria-hidden>
          <polygon points="50,2 92,25 92,75 50,98 8,75 8,25" fill="none" stroke={tone.border} strokeWidth={selected ? 2 : 1.3} strokeLinejoin="round" />
        </svg>
        {spotlight ? (
          <svg className="fr-locate-ring" viewBox="0 0 100 100" aria-hidden>
            <polygon points="50,2 92,25 92,75 50,98 8,75 8,25" fill="none" stroke="var(--honey)" strokeWidth="2.4" strokeLinejoin="round" />
          </svg>
        ) : null}
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>{children}</div>
      </div>
    </div>
  );
});

function frMachineTone(state: AgentState, selected: boolean): Tone {
  const base: Tone =
    ({
      working: { fill: "var(--fr-machine-working-fill)", border: "var(--fr-machine-working-border)", glow: "var(--fr-working-glow)" },
      setup: { fill: "var(--fr-machine-setup-fill)", border: "var(--fr-machine-setup-border)", glow: "var(--honey-soft)" },
      failed: { fill: "var(--fr-machine-failed-fill)", border: "var(--fr-machine-failed-border)", glow: "var(--danger-soft)" },
      ready: { fill: "var(--fr-machine-ready-fill)", border: "var(--fr-machine-ready-border)", glow: null },
    } as Record<string, Tone>)[state] || { fill: "var(--fr-machine-ready-fill)", border: "var(--fr-machine-ready-border)", glow: null };
  if (selected) return { ...base, border: "var(--honey)", glow: base.glow || "var(--honey-soft)" };
  return base;
}

function frAgentTone(state: AgentState, selected: boolean): Tone {
  const tints: Record<string, Tone> = {
    working: { fill: "var(--fr-agent-working-fill)", border: "var(--fr-agent-working-border)", glow: "var(--fr-working-glow)" },
    scheduled: { fill: "var(--fr-agent-scheduled-fill)", border: "var(--fr-agent-scheduled-border)", glow: null },
    setup: { fill: "var(--fr-agent-setup-fill)", border: "var(--fr-agent-setup-border)", glow: null },
    failed: { fill: "var(--fr-agent-failed-fill)", border: "var(--fr-agent-failed-border)", glow: "var(--danger-soft)" },
    ready: { fill: "var(--fr-agent-ready-fill)", border: "var(--fr-agent-ready-border)", glow: null },
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
  const color = selected ? "var(--fr-label-fill-selected)" : "var(--fr-label-fill)";
  const len = segs.reduce((n, s) => n + s.length, 0);
  const fs = len > 14 ? 8.4 : len > 10 ? 9.2 : 10;
  // Each lower hex edge is ~42 units long. Rather than squeezing a long segment
  // with lengthAdjust (which smears the glyphs into an illegible blur — very
  // visible on long auto-generated names like the e2e agents), truncate it to
  // what actually fits and add an ellipsis. The small hover tooltip keeps the
  // full name reachable.
  const EDGE_FIT_W = 42;
  const maxChars = Math.max(2, Math.floor(EDGE_FIT_W / (fs * 0.56)));
  const clamp = (s: string) => (s.length > maxChars ? s.slice(0, maxChars - 1).trimEnd() + "…" : s);
  const left = clamp(segs[0]);
  const right = segs.length > 1 ? clamp(segs[1]) : null;
  return (
    <svg viewBox="0 0 100 100" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
      <g fill={color} stroke="var(--fr-label-halo)" strokeWidth="var(--fr-label-halo-width)" strokeLinejoin="round" paintOrder="stroke" style={{ fontFamily: "var(--f-body)", fontWeight: "var(--fr-label-weight)" }}>
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

interface AddAgentCellProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "onClick" | "title"> {
  x: number; y: number; size: number; dim?: boolean; title?: string; label?: string; dataBee?: string; onClick?: React.MouseEventHandler<HTMLDivElement>;
}

// ---- dashed "add" cell (per-machine "add agent", or the global "add machine") -
const AddAgentCell = forwardRef<HTMLDivElement, AddAgentCellProps>(function AddAgentCell({
  x, y, size, dim, title, label, dataBee, onClick, className, style, ...triggerProps
}, ref) {
  return (
    <div
      {...triggerProps}
      ref={ref}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      title={title}
      className={className ? `fr-addcell ${className}` : "fr-addcell"}
      data-bee={dataBee}
      style={{
        ...style,
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
});

// ---- pheromone thread + travelling light ----------------------------------
function Thread({ a, b, lit, flow, delay = 0, dur = 2.6 }: { a: Pt; b: Pt; lit?: boolean; flow?: boolean; delay?: number; dur?: number }) {
  const stroke = lit ? "var(--fr-thread-lit)" : "var(--fr-thread-idle)";
  const path = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  return (
    <g>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={lit ? 1.5 : 1} strokeLinecap="round" />
      {flow ? (
        <circle r="2.6" fill="var(--fr-thread-flow)" opacity="0.95">
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
  focus,
  spotlightKey,
  tailnetLabel = "",
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
  focus?: { active: boolean; machineIds: ReadonlySet<string>; agentIds: ReadonlySet<string> };
  spotlightKey?: string | null;
  tailnetLabel?: string;
  workerBeeSrc?: string;
  queenBeeSrc?: string;
}) {
  const layout = useMemo(() => frBuildLayout(machines), [machines]);
  const phone = useMemo(() => hivePhoneStatus(machines, tailnetLabel), [machines, tailnetLabel]);
  const mobileMachineIds = useMemo(() => new Set(phone.mobileMachines.map((machine) => machine.id)), [phone.mobileMachines]);
  const onlineMobileMachineIds = useMemo(() => new Set(phone.onlineMobileMachines.map((machine) => machine.id)), [phone.onlineMobileMachines]);
  const primaryPhoneMachineId = phone.mobileMachines[0]?.id ?? "";
  const phonePlaceholder = useMemo(
    () => (phone.mobileMachines.length ? null : frPhonePlaceholderPos(machines, layout)),
    [layout, machines, phone.mobileMachines.length],
  );
  const activeMachineId = sel.type === "machine" ? sel.id : sel.type === "agent" ? sel.machineId : null;
  const phoneToneState: AgentState =
    phone.state === "connected" ? "working" : phone.state === "tailnet-issue" ? "setup" : "ready";
  // The Queen cell breathes to her voice while she speaks in voice chat: the
  // pulse hook writes `--queen-amp` (0..1) on this node every frame (imperative,
  // so HiveStage's fleet-poll re-renders never touch the 60fps path).
  const queenCellRef = useRef<HTMLDivElement | null>(null);
  useQueenVoicePulse(queenCellRef);

  const threads = machines.map((m, i) => {
    const L = layout[m.id];
    const isOnlineMobile = onlineMobileMachineIds.has(m.id);
    const hasWorking = isOnlineMobile || m.agents.some((a) => a.state === "working");
    const lit = focus?.active ? focus.machineIds.has(m.id) : activeMachineId === m.id || sel.type === "queen";
    return <Thread key={"q" + m.id} a={{ x: QX, y: QY }} b={L.pos} lit={lit} flow={hasWorking} delay={i * 0.5} dur={2.8} />;
  });

  return (
    <div style={{ position: "absolute", inset: 0 }} onClick={() => onSelect({ type: "queen" })}>
      {/* atmosphere (honey glow + honeycomb texture) is rendered full-bleed in
          the hive area by FleetHiveView, so it fills the canvas at any zoom. */}

      {/* threads */}
      <svg width={HIVE_W} height={HIVE_H} viewBox={`0 0 ${HIVE_W} ${HIVE_H}`} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {threads}
        {phonePlaceholder ? (
          <Thread
            a={{ x: QX, y: QY }}
            b={phonePlaceholder}
            lit={sel.type === "queen" || sel.type === "phone"}
            flow={false}
            delay={0.2}
            dur={2.3}
          />
        ) : null}
      </svg>

      {/* agent cells */}
      {machines.map((m) =>
        layout[m.id].agents.map(({ agent, pos }) => {
          const selected = sel.type === "agent" && sel.id === agent.id;
          const tone = frAgentTone(agent.state, selected);
          const dim = focus?.active ? !focus.agentIds.has(agent.id) : !!activeMachineId && activeMachineId !== m.id;
          const spotlight = spotlightKey === `agent:${agent.id}`;
          return (
            <Tooltip key={agent.id}>
              <TooltipTrigger asChild>
                <HiveCell
                  x={pos.x} y={pos.y} size={AGENT_SIZE} tone={tone}
                  selected={selected} dim={dim} pulse={agent.state === "working"}
                  bounce={newAgentId === agent.id || spotlight}
                  spotlight={spotlight}
                  // First click selects the petal; clicking it again while already
                  // selected opens its settings (so a double-click on an unselected
                  // agent lands straight in its AgentSettingsModal).
                  onClick={() => {
                    if (selected && onOpenAgentSettings) {
                      onOpenAgentSettings(m.id, agent.id);
                      return;
                    }
                    onSelect({ type: "agent", id: agent.id, machineId: m.id });
                  }}
                  z={selected ? 7 : 3}
                >
                  <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={agent.iconSrc || workerBeeSrc} alt="" width={81} height={81}
                      style={{ transform: "translateY(-4%)", opacity: agent.state === "ready" && !selected ? 0.78 : 1, filter: "var(--fr-image-shadow)" }}
                    />
                  </span>
                  <AgentEdgeName name={agent.name} selected={selected} />
                </HiveCell>
              </TooltipTrigger>
              <TooltipContent>{agent.name}</TooltipContent>
            </Tooltip>
          );
        }),
      )}

      {/* dashed "add agent" cell — one per machine */}
      {machines.map((m) => {
        const ap = layout[m.id].addPos;
        if (!ap) return null;
        const dim = focus?.active ? !focus.machineIds.has(m.id) : !!activeMachineId && activeMachineId !== m.id;
        return (
          <Tooltip key={"add-" + m.id}>
            <TooltipTrigger asChild>
              <AddAgentCell
                x={ap.x} y={ap.y} size={AGENT_SIZE} dim={dim}
                dataBee={`fleet-hive-add-${m.name}`}
                onClick={onAddAgent ? () => onAddAgent(m) : () => onSelect({ type: "machine", id: m.id })}
              />
            </TooltipTrigger>
            <TooltipContent>Add agent to {m.name}</TooltipContent>
          </Tooltip>
        );
      })}

      {/* machine cells */}
      {machines.map((m) => {
        const L = layout[m.id];
        const isMobile = mobileMachineIds.has(m.id);
        const isOnlineMobile = onlineMobileMachineIds.has(m.id);
        const st = isMobile ? (isOnlineMobile ? "working" : "setup") : frMachineState(m);
        const selected = sel.type === "machine" && sel.id === m.id;
        const dim = focus?.active ? !focus.machineIds.has(m.id) : !!activeMachineId && activeMachineId !== m.id && sel.type !== "queen";
        const tone = frMachineTone(st, selected);
        const spotlight = spotlightKey === `machine:${m.id}`;
        return (
          <Fragment key={m.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <HiveCell
                  x={L.pos.x} y={L.pos.y} size={MACHINE_SIZE} tone={tone}
                  selected={selected} dim={dim} pulse={st === "working"}
                  bounce={spotlight}
                  spotlight={spotlight}
                  data-bee={m.id === primaryPhoneMachineId ? "fleet-hive-phone" : undefined}
                  aria-label={isMobile ? "Open phone connection" : undefined}
                  onClick={() => onSelect({ type: "machine", id: m.id })}
                  z={selected ? 8 : 5}
                >
                  {/* icon centred in the hex; the name hugs the lower edges using
                      the same edge-label logic as the agent cells. */}
                  <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                    <MachineKindIcon kind={m.kind} size={39} color={selected ? "var(--honey)" : m.role === "Primary" ? "var(--honey)" : "var(--fg-2)"} />
                  </span>
                  <AgentEdgeName name={m.name} selected={selected} />
                </HiveCell>
              </TooltipTrigger>
              <TooltipContent>{m.name}</TooltipContent>
            </Tooltip>
          </Fragment>
        );
      })}

      {phonePlaceholder ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <HiveCell
              x={phonePlaceholder.x}
              y={phonePlaceholder.y}
              size={MACHINE_SIZE}
              tone={frMachineTone(phoneToneState, sel.type === "phone")}
              selected={sel.type === "phone"}
              dim={focus?.active || (!!activeMachineId && sel.type !== "phone")}
              pulse={false}
              data-bee="fleet-hive-phone"
              aria-label="Open phone connection"
              role="button"
              onClick={() => onSelect({ type: "phone" })}
              z={sel.type === "phone" ? 8 : 6}
            >
              <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                <MachineKindIcon kind="Mobile" size={39} color={sel.type === "phone" ? "var(--honey)" : "var(--fg-2)"} />
              </span>
              <AgentEdgeName name="Phone" selected={sel.type === "phone"} />
            </HiveCell>
          </TooltipTrigger>
          <TooltipContent>{phone.phoneStatus}</TooltipContent>
        </Tooltip>
      ) : null}

      {/* dashed "add machine" cell — sits just outside the ring in the widest
          gap between machines (sliding further out when agent petals crowd that
          spot), so it never stacks under existing hive cells */}
      {onAddMachine ? (() => {
        const amp = frAddMachinePos(machines, layout);
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <AddAgentCell
                x={amp.x} y={amp.y} size={MACHINE_SIZE}
                label="New Machine" onClick={() => onAddMachine()}
              />
            </TooltipTrigger>
            <TooltipContent>Initialize new machine</TooltipContent>
          </Tooltip>
        );
      })() : null}

      {/* the Queen */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            ref={queenCellRef}
            onClick={(e) => { e.stopPropagation(); onSelect({ type: "queen" }); }}
            onDoubleClick={(e) => { e.stopPropagation(); onOpenQueenSettings?.(); }}
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
              <div style={{ position: "absolute", inset: 0, clipPath: FR_HEX_CLIP, background: "var(--fr-queen-fill)" }} />
              <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} aria-hidden>
                <polygon points="50,2 92,25 92,75 50,98 8,75 8,25" fill="none" stroke={sel.type === "queen" ? "var(--honey)" : "var(--honey-line)"} strokeWidth={sel.type === "queen" ? 2.2 : 1.6} strokeLinejoin="round" />
              </svg>
              <div className="fr-queen-core" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={queenBeeSrc} alt="" width={91} height={91} style={{ filter: "var(--fr-queen-image-shadow)" }} />
              </div>
              <div style={{ position: "absolute", left: "50%", top: "calc(100% + 6px)", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none" }}>
                <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 13, color: "var(--honey)" }}>Queen</div>
                <div style={{ fontSize: 9.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 1 }}>orchestrator</div>
              </div>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>Queen Bee</TooltipContent>
      </Tooltip>
    </div>
  );
}
