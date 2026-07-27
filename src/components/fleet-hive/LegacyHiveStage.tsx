"use client";

/* Optional pre-redesign Fleet Hive presentation. This stage intentionally keeps
   every cluster visible, restores portrait cells and spatial add affordances,
   and remains isolated from the calmer focused stage. */

import { Fragment, forwardRef, useMemo, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQueenVoicePulse } from "@/lib/audio/queen-voice-amplitude";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import type { AgentState, HiveMachine, HiveSelection } from "./fleet-hive-types";
import { frMachineState, hivePhoneStatus } from "./fleet-hive-types";
import { FR_HEX_CLIP, HIVE_H, HIVE_W, QX, QY, type Pt } from "./hive-geometry";
import {
  LEGACY_CELL_SIZE,
  frBuildLegacyLayout,
  frLegacyAddMachinePos,
  frLegacyNameSegments,
  frLegacyPhonePlaceholderPos,
} from "./hive-legacy-geometry";
import { MachineKindGlyph } from "./hive-node-glyphs";

interface LegacyTone {
  fill: string;
  border: string;
  glow?: string;
}

interface LegacyHiveCellProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick" | "title"> {
  x: number;
  y: number;
  size: number;
  tone: LegacyTone;
  selected?: boolean;
  dim?: boolean;
  pulse?: boolean;
  bounce?: boolean;
  spotlight?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  title?: string;
  children?: React.ReactNode;
  z?: number;
}

const LegacyHiveCell = forwardRef<HTMLButtonElement, LegacyHiveCellProps>(function LegacyHiveCell({
  x,
  y,
  size,
  tone,
  selected,
  dim,
  pulse,
  bounce,
  spotlight,
  onClick,
  title,
  children,
  z,
  className,
  style,
  ...buttonProps
}, ref) {
  return (
    <button
      {...buttonProps}
      type="button"
      ref={ref}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      className={className ? `fr-cell fr-legacy-cell ${className}` : "fr-cell fr-legacy-cell"}
      data-selected={selected ? "true" : undefined}
      data-locate-spotlight={spotlight ? "true" : undefined}
      style={{
        ...style,
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        transform: "translate(-50%, -50%)",
        ["--fr-z" as string]: z ?? (selected ? 6 : 4),
        cursor: onClick ? "pointer" : "default",
        opacity: dim ? 0.4 : 1,
        transition: "opacity .4s",
        padding: 0,
        border: 0,
        background: "transparent",
      } as React.CSSProperties}
    >
      <span
        className="fr-cell-lift"
        style={{ animation: bounce ? "fr-breathe 0.88s ease" : undefined }}
      >
        {tone.glow ? (
          <span
            className="fr-legacy-cell-glow"
            data-pulse={pulse ? "true" : undefined}
            style={{ background: `radial-gradient(circle, ${tone.glow}, transparent 68%)` }}
          />
        ) : null}
        <span
          style={{
            position: "absolute",
            inset: 0,
            clipPath: FR_HEX_CLIP,
            background: tone.fill,
            boxShadow: `inset 0 0 0 1.4px ${tone.border}, inset 0 ${size * 0.5}px ${size * 0.6}px -${size * 0.4}px var(--fr-cell-sheen)`,
          }}
        />
        <svg viewBox="0 0 100 100" className="fr-legacy-hex-outline" aria-hidden>
          <polygon
            points="50,2 92,25 92,75 50,98 8,75 8,25"
            fill="none"
            stroke={tone.border}
            strokeWidth={selected ? 2 : 1.3}
            strokeLinejoin="round"
          />
        </svg>
        {spotlight ? (
          <svg className="fr-locate-ring" viewBox="0 0 100 100" aria-hidden>
            <polygon points="50,2 92,25 92,75 50,98 8,75 8,25" fill="none" stroke="var(--honey)" strokeWidth="2.4" strokeLinejoin="round" />
          </svg>
        ) : null}
        <span className="fr-legacy-cell-content">{children}</span>
      </span>
    </button>
  );
});

function legacyMachineTone(state: AgentState, selected: boolean): LegacyTone {
  const base = ({
    working: { fill: "var(--fr-machine-working-fill)", border: "var(--fr-machine-working-border)", glow: "var(--fr-legacy-working-glow)" },
    setup: { fill: "var(--fr-machine-setup-fill)", border: "var(--fr-machine-setup-border)", glow: "var(--honey-soft)" },
    failed: { fill: "var(--fr-machine-failed-fill)", border: "var(--fr-machine-failed-border)", glow: "var(--danger-soft)" },
    ready: { fill: "var(--fr-machine-ready-fill)", border: "var(--fr-machine-ready-border)" },
  } as Record<AgentState, LegacyTone>)[state] ?? {
    fill: "var(--fr-machine-ready-fill)",
    border: "var(--fr-machine-ready-border)",
  };
  return selected ? { ...base, border: "var(--honey)", glow: base.glow ?? "var(--honey-soft)" } : base;
}

function legacyAgentTone(state: AgentState, selected: boolean): LegacyTone {
  const base = ({
    working: { fill: "var(--fr-agent-working-fill)", border: "var(--fr-agent-working-border)", glow: "var(--fr-legacy-working-glow)" },
    scheduled: { fill: "var(--fr-agent-scheduled-fill)", border: "var(--fr-agent-scheduled-border)" },
    setup: { fill: "var(--fr-agent-setup-fill)", border: "var(--fr-agent-setup-border)" },
    failed: { fill: "var(--fr-agent-failed-fill)", border: "var(--fr-agent-failed-border)", glow: "var(--danger-soft)" },
    ready: { fill: "var(--fr-agent-ready-fill)", border: "var(--fr-agent-ready-border)" },
  } as Record<AgentState, LegacyTone>)[state] ?? {
    fill: "var(--fr-agent-ready-fill)",
    border: "var(--fr-agent-ready-border)",
  };
  return selected ? { ...base, border: "var(--honey)", glow: base.glow ?? "var(--honey-soft)" } : base;
}

function LegacyEdgeName({ name, selected }: { name: string; selected: boolean }) {
  const segments = frLegacyNameSegments(name);
  if (!segments.length) return null;
  const totalLength = segments.reduce((length, segment) => length + segment.length, 0);
  const fontSize = totalLength > 24 ? 6.8 : totalLength > 18 ? 7.6 : totalLength > 13 ? 8.6 : 9.5;
  const color = selected ? "var(--fr-legacy-label-selected)" : "var(--fr-legacy-label)";
  const textProps = (segment: string) => segment.length > 8
    ? { textLength: 40, lengthAdjust: "spacingAndGlyphs" as const }
    : {};
  return (
    <svg viewBox="0 0 100 100" className="fr-legacy-edge-name" aria-hidden>
      <g
        fill={color}
        stroke="var(--fr-legacy-label-halo)"
        strokeWidth="var(--fr-legacy-label-halo-width)"
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        <text {...textProps(segments[0])} x="47" y="91" fontSize={fontSize} textAnchor="end" dominantBaseline="middle" transform="rotate(30 47 91)">
          {segments[0]}
        </text>
        {segments[1] ? (
          <text {...textProps(segments[1])} x="53" y="91" fontSize={fontSize} textAnchor="start" dominantBaseline="middle" transform="rotate(-30 53 91)">
            {segments[1]}
          </text>
        ) : null}
      </g>
    </svg>
  );
}

interface LegacyAddCellProps {
  x: number;
  y: number;
  size: number;
  dim?: boolean;
  label?: string;
  ariaLabel: string;
  dataBee?: string;
  onClick?: () => void;
}

function LegacyAddCell({ x, y, size, dim, label, ariaLabel, dataBee, onClick }: LegacyAddCellProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-bee={dataBee}
      className="fr-legacy-addcell"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        transform: "translate(-50%, -50%)",
        cursor: onClick ? "pointer" : "default",
        opacity: dim ? 0.32 : 0.9,
      }}
    >
      <svg viewBox="0 0 100 100" aria-hidden>
        <polygon points="50,2 92,25 92,75 50,98 8,75 8,25" fill="transparent" stroke="var(--line-3)" strokeWidth="1.4" strokeDasharray="4 5" strokeLinejoin="round" />
        <path d="M50 41 V 59 M41 50 H 59" stroke="var(--fg-4)" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      {label ? <span className="fr-legacy-addcell-label">{label}</span> : null}
    </button>
  );
}

function LegacyThread({ a, b, lit, flow, delay = 0, duration = 2.6 }: { a: Pt; b: Pt; lit?: boolean; flow?: boolean; delay?: number; duration?: number }) {
  const stroke = lit ? "var(--fr-thread-lit)" : "var(--fr-thread-idle)";
  const path = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  return (
    <g>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={lit ? 1.5 : 1} strokeLinecap="round" />
      {flow ? (
        <circle r="2.6" fill="var(--fr-thread-flow)" opacity="0.95">
          <animateMotion path={path} dur={`${duration}s`} begin={`${delay}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;1;1;0" dur={`${duration}s`} begin={`${delay}s`} repeatCount="indefinite" />
        </circle>
      ) : null}
    </g>
  );
}

export interface LegacyHiveStageProps {
  machines: HiveMachine[];
  sel: HiveSelection;
  onSelect: (selection: HiveSelection) => void;
  onOpenAgentSettings?: (machineId: string, agentId: string) => void;
  onAddAgent?: (machine: HiveMachine) => void;
  onAddMachine?: () => void;
  onOpenQueenSettings?: () => void;
  queenName: string;
  newAgentId?: string | null;
  focus?: { active: boolean; machineIds: ReadonlySet<string>; agentIds: ReadonlySet<string> };
  spotlightKey?: string | null;
  tailnetLabel?: string;
  workerBeeSrc?: string;
  queenBeeSrc?: string;
}

export function LegacyHiveStage({
  machines,
  sel,
  onSelect,
  onOpenAgentSettings,
  onAddAgent,
  onAddMachine,
  onOpenQueenSettings,
  queenName,
  newAgentId,
  focus,
  spotlightKey,
  tailnetLabel = "",
  workerBeeSrc = "/icons/worker-bee-general-v5.png",
  queenBeeSrc = beeRoleIconPath("queen"),
}: LegacyHiveStageProps) {
  const layout = useMemo(() => frBuildLegacyLayout(machines), [machines]);
  const phone = useMemo(() => hivePhoneStatus(machines, tailnetLabel), [machines, tailnetLabel]);
  const mobileMachineIds = useMemo(() => new Set(phone.mobileMachines.map((machine) => machine.id)), [phone.mobileMachines]);
  const onlineMobileMachineIds = useMemo(() => new Set(phone.onlineMobileMachines.map((machine) => machine.id)), [phone.onlineMobileMachines]);
  const primaryPhoneMachineId = phone.mobileMachines[0]?.id ?? "";
  const phonePlaceholder = useMemo(
    () => (phone.mobileMachines.length ? null : frLegacyPhonePlaceholderPos(machines, layout)),
    [layout, machines, phone.mobileMachines.length],
  );
  const activeMachineId = sel.type === "machine" ? sel.id : sel.type === "agent" ? sel.machineId : null;
  const phoneToneState: AgentState = phone.state === "connected" ? "working" : phone.state === "tailnet-issue" ? "setup" : "ready";
  const queenCellRef = useRef<HTMLButtonElement | null>(null);
  useQueenVoicePulse(queenCellRef);

  return (
    <div className="fr-legacy-stage" style={{ position: "absolute", inset: 0 }} onClick={() => onSelect({ type: "queen" })}>
      <svg width={HIVE_W} height={HIVE_H} viewBox={`0 0 ${HIVE_W} ${HIVE_H}`} className="fr-legacy-threads" aria-hidden>
        {machines.map((machine, index) => {
          const machineLayout = layout[machine.id];
          const onlineMobile = onlineMobileMachineIds.has(machine.id);
          const working = onlineMobile || machine.agents.some((agent) => agent.state === "working");
          const lit = focus?.active ? focus.machineIds.has(machine.id) : activeMachineId === machine.id || sel.type === "queen";
          return <LegacyThread key={machine.id} a={{ x: QX, y: QY }} b={machineLayout.pos} lit={lit} flow={working} delay={index * 0.5} duration={2.8} />;
        })}
        {phonePlaceholder ? (
          <LegacyThread a={{ x: QX, y: QY }} b={phonePlaceholder} lit={sel.type === "queen" || sel.type === "phone"} />
        ) : null}
      </svg>

      {machines.flatMap((machine) => layout[machine.id].agents.map(({ agent, pos }) => {
        const selected = sel.type === "agent" && sel.id === agent.id;
        const dim = focus?.active ? !focus.agentIds.has(agent.id) : Boolean(activeMachineId && activeMachineId !== machine.id);
        const spotlight = spotlightKey === `agent:${agent.id}`;
        return (
          <Tooltip key={agent.id}>
            <TooltipTrigger asChild>
              <LegacyHiveCell
                x={pos.x}
                y={pos.y}
                size={LEGACY_CELL_SIZE}
                tone={legacyAgentTone(agent.state, selected)}
                selected={selected}
                dim={dim}
                pulse={agent.state === "working"}
                bounce={newAgentId === agent.id || spotlight}
                spotlight={spotlight}
                aria-label={`${agent.name}, ${agent.state}`}
                aria-pressed={selected}
                onClick={() => {
                  if (selected && onOpenAgentSettings) {
                    onOpenAgentSettings(machine.id, agent.id);
                    return;
                  }
                  onSelect({ type: "agent", id: agent.id, machineId: machine.id });
                }}
                z={selected ? 7 : 3}
              >
                <span className="fr-legacy-bee">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={agent.iconSrc || workerBeeSrc} alt="" width={81} height={81} />
                </span>
                <LegacyEdgeName name={agent.name} selected={selected} />
              </LegacyHiveCell>
            </TooltipTrigger>
            <TooltipContent>{agent.name}</TooltipContent>
          </Tooltip>
        );
      }))}

      {machines.map((machine) => {
        const addPosition = layout[machine.id].addPos;
        const dim = focus?.active ? !focus.machineIds.has(machine.id) : Boolean(activeMachineId && activeMachineId !== machine.id);
        return (
          <Tooltip key={`add-${machine.id}`}>
            <TooltipTrigger asChild>
              <LegacyAddCell
                x={addPosition.x}
                y={addPosition.y}
                size={LEGACY_CELL_SIZE}
                dim={dim}
                ariaLabel={`Add agent to ${machine.name}`}
                dataBee={`fleet-hive-add-${machine.name}`}
                onClick={onAddAgent ? () => onAddAgent(machine) : () => onSelect({ type: "machine", id: machine.id })}
              />
            </TooltipTrigger>
            <TooltipContent>Add agent to {machine.name}</TooltipContent>
          </Tooltip>
        );
      })}

      {machines.map((machine) => {
        const machineLayout = layout[machine.id];
        const mobile = mobileMachineIds.has(machine.id);
        const onlineMobile = onlineMobileMachineIds.has(machine.id);
        const state = mobile ? (onlineMobile ? "working" : "setup") : frMachineState(machine);
        const selected = sel.type === "machine" && sel.id === machine.id;
        const dim = focus?.active ? !focus.machineIds.has(machine.id) : Boolean(activeMachineId && activeMachineId !== machine.id && sel.type !== "queen");
        const spotlight = spotlightKey === `machine:${machine.id}`;
        return (
          <Fragment key={machine.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <LegacyHiveCell
                  x={machineLayout.pos.x}
                  y={machineLayout.pos.y}
                  size={LEGACY_CELL_SIZE}
                  tone={legacyMachineTone(state, selected)}
                  selected={selected}
                  dim={dim}
                  pulse={state === "working"}
                  bounce={spotlight}
                  spotlight={spotlight}
                  data-primary={machine.role === "Primary" ? "true" : undefined}
                  data-bee={machine.id === primaryPhoneMachineId ? "fleet-hive-phone" : undefined}
                  aria-label={mobile ? `Open phone connection for ${machine.name}` : machine.name}
                  aria-pressed={selected}
                  onClick={() => onSelect({ type: "machine", id: machine.id })}
                  z={selected ? 8 : 5}
                >
                  <span className="fr-legacy-machine-glyph">
                    <MachineKindGlyph kind={machine.kind} size={39} />
                  </span>
                  <LegacyEdgeName name={machine.name} selected={selected} />
                </LegacyHiveCell>
              </TooltipTrigger>
              <TooltipContent>{machine.name}</TooltipContent>
            </Tooltip>
          </Fragment>
        );
      })}

      {phonePlaceholder ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <LegacyHiveCell
              x={phonePlaceholder.x}
              y={phonePlaceholder.y}
              size={LEGACY_CELL_SIZE}
              tone={legacyMachineTone(phoneToneState, sel.type === "phone")}
              selected={sel.type === "phone"}
              dim={Boolean(focus?.active || (activeMachineId && sel.type !== "phone"))}
              data-bee="fleet-hive-phone"
              aria-label="Open phone connection"
              aria-pressed={sel.type === "phone"}
              onClick={() => onSelect({ type: "phone" })}
              z={sel.type === "phone" ? 8 : 6}
            >
              <span className="fr-legacy-machine-glyph"><MachineKindGlyph kind="Mobile" size={39} /></span>
              <LegacyEdgeName name="Phone" selected={sel.type === "phone"} />
            </LegacyHiveCell>
          </TooltipTrigger>
          <TooltipContent>{phone.phoneStatus}</TooltipContent>
        </Tooltip>
      ) : null}

      {onAddMachine ? (() => {
        const addMachinePosition = frLegacyAddMachinePos(machines, layout);
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <LegacyAddCell
                x={addMachinePosition.x}
                y={addMachinePosition.y}
                size={LEGACY_CELL_SIZE}
                label="New Machine"
                ariaLabel="Initialize new machine"
                onClick={onAddMachine}
              />
            </TooltipTrigger>
            <TooltipContent>Initialize new machine</TooltipContent>
          </Tooltip>
        );
      })() : null}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            ref={queenCellRef}
            onClick={(event) => {
              event.stopPropagation();
              onSelect({ type: "queen" });
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onOpenQueenSettings?.();
            }}
            className="fr-queen-cell"
            data-selected={sel.type === "queen" ? "true" : undefined}
            aria-label={`${queenName}, Queen orchestrator`}
            aria-pressed={sel.type === "queen"}
            style={{
              position: "absolute",
              left: QX,
              top: QY,
              width: 150,
              height: 150,
              transform: "translate(-50%, -50%)",
              cursor: "pointer",
              zIndex: 9,
              border: 0,
              padding: 0,
              background: "transparent",
            }}
          >
            <span className="fr-queen-lift">
              <span className="fr-queen-glow" />
              <span style={{ position: "absolute", inset: 0, clipPath: FR_HEX_CLIP, background: "var(--fr-queen-fill)" }} />
              <svg viewBox="0 0 100 100" className="fr-legacy-hex-outline" aria-hidden>
                <polygon points="50,2 92,25 92,75 50,98 8,75 8,25" fill="none" stroke={sel.type === "queen" ? "var(--honey)" : "var(--honey-line)"} strokeWidth={sel.type === "queen" ? 2.2 : 1.6} strokeLinejoin="round" />
              </svg>
              <span className="fr-queen-core">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={queenBeeSrc} alt="" width={91} height={91} />
              </span>
              <span className="fr-legacy-queen-label">
                <span>{queenName}</span>
                <small>Queen</small>
                <small>orchestrator</small>
              </span>
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{queenName} · Queen</TooltipContent>
      </Tooltip>
    </div>
  );
}
