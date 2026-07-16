"use client";

/* HiveStage.tsx — the living hive: Queen at the heart, machine summaries ringed
   around her, and the selected machine's agents revealed as compact hex nodes.
   Everything is laid out on a fixed 1012×980 canvas that FleetHiveView scales
   to fit. */

import { ChevronDown, ChevronUp, LoaderCircle } from "lucide-react";
import { Fragment, forwardRef, useMemo, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQueenVoicePulse } from "@/lib/audio/queen-voice-amplitude";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import type { AgentState, HiveMachine, HiveSelection } from "./fleet-hive-types";
import { frMachineState, hivePhoneStatus } from "./fleet-hive-types";
import {
  AGENT_SIZE, FR_HEX_CLIP, HIVE_H, HIVE_W, MACHINE_SIZE, QX, QY,
  frBuildLayout, frPhonePlaceholderPos, type Pt,
} from "./hive-geometry";
import { AgentNodeGlyph, MachineKindGlyph } from "./hive-node-glyphs";

interface Tone {
  fill: string;
  border: string;
}

interface HiveCellProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick" | "title"> {
  x: number; y: number; size: number; tone: Tone;
  selected?: boolean; dim?: boolean; bounce?: boolean; spotlight?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>; title?: string; children?: React.ReactNode; z?: number;
}

// ---- the hex cell ---------------------------------------------------------
const HiveCell = forwardRef<HTMLButtonElement, HiveCellProps>(function HiveCell({
  x, y, size, tone, selected, dim, bounce, spotlight, onClick, title, children, z,
  className, style, ...triggerProps
}, ref) {
  return (
    <button
      {...triggerProps}
      type="button"
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
        opacity: dim ? 0.52 : 1,
        padding: 0,
        border: 0,
        background: "transparent",
      } as React.CSSProperties}
    >
      <div
        className="fr-cell-lift"
        style={{ animation: bounce ? "fr-breathe 0.88s ease" : undefined }}
      >
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
    </button>
  );
});

function frMachineTone(state: AgentState, selected: boolean): Tone {
  const base: Tone =
    ({
      working: { fill: "var(--fr-machine-working-fill)", border: "var(--fr-machine-working-border)" },
      setup: { fill: "var(--fr-machine-setup-fill)", border: "var(--fr-machine-setup-border)" },
      failed: { fill: "var(--fr-machine-failed-fill)", border: "var(--fr-machine-failed-border)" },
      ready: { fill: "var(--fr-machine-ready-fill)", border: "var(--fr-machine-ready-border)" },
    } as Record<string, Tone>)[state] || { fill: "var(--fr-machine-ready-fill)", border: "var(--fr-machine-ready-border)" };
  if (selected) return { ...base, border: "var(--honey)" };
  return base;
}

function frAgentTone(state: AgentState, selected: boolean): Tone {
  const tints: Record<string, Tone> = {
    working: { fill: "var(--fr-agent-working-fill)", border: "var(--fr-agent-working-border)" },
    scheduled: { fill: "var(--fr-agent-scheduled-fill)", border: "var(--fr-agent-scheduled-border)" },
    setup: { fill: "var(--fr-agent-setup-fill)", border: "var(--fr-agent-setup-border)" },
    failed: { fill: "var(--fr-agent-failed-fill)", border: "var(--fr-agent-failed-border)" },
    ready: { fill: "var(--fr-agent-ready-fill)", border: "var(--fr-agent-ready-border)" },
  };
  const t = tints[state] || tints.ready;
  return selected ? { ...t, border: "var(--honey)" } : t;
}

function NodeStatus({ state }: { state: AgentState }) {
  return <span className="fr-node-status" data-state={state} aria-hidden />;
}

function AgentNodeContent({ agent }: { agent: HiveMachine["agents"][number] }) {
  return (
    <span className="fr-agent-node-content">
      <span className="fr-node-glyph"><AgentNodeGlyph agent={agent} /></span>
      <span className="fr-node-name">{agent.name}</span>
      <NodeStatus state={agent.state} />
    </span>
  );
}

function MachineNodeContent({
  machine,
  state,
  expanded,
  updating,
}: {
  machine: HiveMachine;
  state: AgentState;
  expanded: boolean;
  updating: boolean;
}) {
  const agentLabel = machine.agents.length === 1 ? "agent" : "agents";
  return (
    <span className="fr-machine-node-content" data-updating={updating ? "true" : undefined}>
      <span className="fr-node-glyph"><MachineKindGlyph kind={machine.kind} size={34} /></span>
      <span className="fr-node-name">{machine.name}</span>
      <span className="fr-machine-agent-count">
        {machine.agents.length} {agentLabel}
        {expanded ? <ChevronUp aria-hidden size={11} /> : <ChevronDown aria-hidden size={11} />}
      </span>
      {updating ? (
        <span className="fr-machine-update-status" role="status" aria-live="polite">
          <LoaderCircle className="fr-machine-update-spinner animate-spin" aria-hidden size={9} />
          Updating…
        </span>
      ) : null}
      <NodeStatus state={state} />
    </span>
  );
}

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
  onOpenQueenSettings,
  queenName,
  updatingMachineIds,
  newAgentId,
  focus,
  spotlightKey,
  tailnetLabel = "",
  queenBeeSrc = beeRoleIconPath("queen"),
}: {
  machines: HiveMachine[];
  sel: HiveSelection;
  onSelect: (s: HiveSelection) => void;
  onOpenAgentSettings?: (machineId: string, agentId: string) => void;
  onOpenQueenSettings?: () => void;
  queenName: string;
  updatingMachineIds?: ReadonlySet<string>;
  newAgentId?: string | null;
  focus?: { active: boolean; machineIds: ReadonlySet<string>; agentIds: ReadonlySet<string> };
  spotlightKey?: string | null;
  tailnetLabel?: string;
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
  const expandedMachineIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeMachineId) ids.add(activeMachineId);
    if (focus?.active) focus.machineIds.forEach((machineId) => ids.add(machineId));
    if (newAgentId) {
      const machine = machines.find((candidate) => candidate.agents.some((agent) => agent.id === newAgentId));
      if (machine) ids.add(machine.id);
    }
    return ids;
  }, [activeMachineId, focus, machines, newAgentId]);
  // The Queen cell responds to her voice while she speaks in voice chat: the
  // pulse hook writes `--queen-amp` (0..1) on this node every frame (imperative,
  // so HiveStage's fleet-poll re-renders never touch the 60fps path).
  const queenCellRef = useRef<HTMLButtonElement | null>(null);
  useQueenVoicePulse(queenCellRef);

  const threads = machines.map((m, i) => {
    const L = layout[m.id];
    const isOnlineMobile = onlineMobileMachineIds.has(m.id);
    const hasWorking = isOnlineMobile || m.agents.some((a) => a.state === "working");
    const lit = focus?.active ? focus.machineIds.has(m.id) : activeMachineId === m.id;
    return <Thread key={"q" + m.id} a={{ x: QX, y: QY }} b={L.pos} lit={lit} flow={lit && hasWorking} delay={i * 0.5} dur={2.8} />;
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
            lit={sel.type === "phone"}
            flow={false}
            delay={0.2}
            dur={2.3}
          />
        ) : null}
      </svg>

      {/* agent cells */}
      {machines.flatMap((m) => {
        if (!expandedMachineIds.has(m.id)) return [];
        return layout[m.id].agents.map(({ agent, pos }) => {
          const selected = sel.type === "agent" && sel.id === agent.id;
          const tone = frAgentTone(agent.state, selected);
          const dim = focus?.active ? !focus.agentIds.has(agent.id) : !!activeMachineId && activeMachineId !== m.id;
          const spotlight = spotlightKey === `agent:${agent.id}`;
          return (
            <Tooltip key={agent.id}>
              <TooltipTrigger asChild>
                <HiveCell
                  x={pos.x} y={pos.y} size={AGENT_SIZE} tone={tone}
                  selected={selected} dim={dim}
                  bounce={newAgentId === agent.id || spotlight}
                  spotlight={spotlight}
                  aria-label={`${agent.name}, ${agent.state}`}
                  aria-pressed={selected}
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
                  <AgentNodeContent agent={agent} />
                </HiveCell>
              </TooltipTrigger>
              <TooltipContent>{agent.name}</TooltipContent>
            </Tooltip>
          );
        });
      })}

      {/* machine cells */}
      {machines.map((m) => {
        const L = layout[m.id];
        const isMobile = mobileMachineIds.has(m.id);
        const isOnlineMobile = onlineMobileMachineIds.has(m.id);
        const st = isMobile ? (isOnlineMobile ? "working" : "setup") : frMachineState(m);
        const selected = sel.type === "machine" && sel.id === m.id;
        const expanded = expandedMachineIds.has(m.id);
        const updating = updatingMachineIds?.has(m.id) ?? false;
        const dim = focus?.active ? !focus.machineIds.has(m.id) : !!activeMachineId && activeMachineId !== m.id && sel.type !== "queen";
        const tone = frMachineTone(st, selected);
        const spotlight = spotlightKey === `machine:${m.id}`;
        return (
          <Fragment key={m.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <HiveCell
                  x={L.pos.x} y={L.pos.y} size={MACHINE_SIZE} tone={tone}
                  selected={selected} dim={dim}
                  bounce={spotlight}
                  spotlight={spotlight}
                  data-primary={m.role === "Primary" ? "true" : undefined}
                  data-bee={m.id === primaryPhoneMachineId ? "fleet-hive-phone" : undefined}
                  aria-label={isMobile
                    ? `Open phone connection for ${m.name}`
                    : `${m.name}, ${m.agents.length} ${m.agents.length === 1 ? "agent" : "agents"}, ${updating ? "updating, " : ""}${expanded ? "collapse agents" : "expand agents"}`}
                  aria-expanded={expanded}
                  aria-pressed={selected}
                  onClick={() => onSelect(expanded ? { type: "queen" } : { type: "machine", id: m.id })}
                  z={selected ? 8 : 5}
                >
                  <MachineNodeContent machine={m} state={st} expanded={expanded} updating={updating} />
                </HiveCell>
              </TooltipTrigger>
              <TooltipContent>{updating ? `${m.name} is updating` : expanded ? `Collapse ${m.name}` : `Show ${m.agents.length} agents on ${m.name}`}</TooltipContent>
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
              data-bee="fleet-hive-phone"
              aria-label="Open phone connection"
              aria-pressed={sel.type === "phone"}
              onClick={() => onSelect({ type: "phone" })}
              z={sel.type === "phone" ? 8 : 6}
            >
              <span className="fr-machine-node-content">
                <span className="fr-node-glyph"><MachineKindGlyph kind="Mobile" size={34} /></span>
                <span className="fr-node-name">Phone</span>
                <span className="fr-machine-agent-count">Connect</span>
                <NodeStatus state={phoneToneState} />
              </span>
            </HiveCell>
          </TooltipTrigger>
          <TooltipContent>{phone.phoneStatus}</TooltipContent>
        </Tooltip>
      ) : null}

      {/* the Queen */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            ref={queenCellRef}
            onClick={(e) => { e.stopPropagation(); onSelect({ type: "queen" }); }}
            onDoubleClick={(e) => { e.stopPropagation(); onOpenQueenSettings?.(); }}
            className="fr-queen-cell"
            data-selected={sel.type === "queen" ? "true" : undefined}
            aria-label={`${queenName}, Queen orchestrator`}
            aria-pressed={sel.type === "queen"}
            style={{
              position: "absolute", left: QX, top: QY, width: 150, height: 150,
              transform: "translate(-50%, -50%)", cursor: "pointer", zIndex: 9,
              border: 0, padding: 0, background: "transparent",
            }}
          >
            {/* inner lift layer — selection scale + hover lift live in CSS, mirroring
                the worker/machine cells. */}
            <div className="fr-queen-lift">
              {/* The honey halo stays quiet at rest. While Queen speaks in voice
                  chat it tracks her voice amplitude via --queen-amp (see
                  fleet-hive.css and src/lib/audio/queen-voice-amplitude.ts). */}
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
              <div style={{ position: "absolute", left: "50%", top: "calc(100% + 6px)", width: "max-content", minWidth: 150, maxWidth: 220, transform: "translateX(-50%)", overflowWrap: "anywhere", textAlign: "center", pointerEvents: "none" }}>
                <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 13, color: "var(--honey)" }}>{queenName}</div>
                <div style={{ fontFamily: "var(--f-display)", fontWeight: 500, fontSize: 10.5, color: "var(--fg-2)", marginTop: 1 }}>Queen</div>
                <div style={{ fontSize: 9.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 1 }}>orchestrator</div>
              </div>
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent>{queenName} · Queen</TooltipContent>
      </Tooltip>
    </div>
  );
}
