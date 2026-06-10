// src/components/fleet/machine-cluster.tsx
"use client";

import * as React from "react";
import {
  BarChart3,
  Bot,
  CalendarClock,
  FolderOpen,
  Globe2,
  MessageCircle,
  Network,
  PlugZap,
  Rocket,
  Send,
  Terminal,
  WalletCards,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AddHexCell } from "./add-hex-cell";
import { BeeIcon } from "./bee-icon";
import { HexTile, type HexTone } from "./hex-tile";
import {
  axialToPixel,
  FLEET_GRAPH_CELL_SCALE,
  HEX_H,
  HEX_W,
  hexSpiral,
} from "./hex-math";
import { FleetSelectionTooltipContent } from "./selection-tooltip";
import {
  isFleetMachineMobile,
  type AgentState,
  type FleetActiveApp,
  type FleetAgent,
  type FleetAgentChat,
  type FleetAgentCapabilityBadge,
  type FleetAgentCapabilityIcon,
  type FleetMachine,
} from "./fleet-data";
import type {
  AeonDeleteDepth,
  AeonDeleteProgress,
  AeonDeleteResult,
  MachineUpdateButtonDetail,
  MachineUpdateButtonStatus,
} from "./roster";
import styles from "./fleet-tokens.module.css";

const STATE_TONE: Record<AgentState, HexTone> = {
  working: "active",
  ready: "default",
  scheduled: "honey",
  setup: "honey",
  failed: "danger",
};

function compactMachineLabel(name: string) {
  const normalized = name
    .replace(/^hivemindos[-_]?/i, "")
    .replace(/['’]/g, "")
    .trim();
  const lower = normalized.toLowerCase();
  const suffix = normalized.match(/(?:^|[-_\s])(\d{1,3})$/)?.[1] ?? "";

  if (/^this\s+mac$/i.test(normalized)) return ["THIS", "MAC"];
  if (/iphone|android|pixel|galaxy/i.test(normalized)) {
    const digits = normalized.match(/\d{1,4}/)?.[0] ?? "";
    return [lower.includes("iphone") ? "iP" : "PH", digits || "MOB"];
  }
  if (/macbook|mbp|mac/i.test(normalized)) return ["MBP", suffix || "MAC"];
  if (/ubuntu|linux|vps|server/i.test(normalized))
    return ["VPS", suffix || "LIN"];

  const words = normalized.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const letters = words
    .filter((word) => !/^\d+$/.test(word))
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return [
    letters || "NODE",
    suffix || words.find((word) => /^\d+$/.test(word)) || "",
  ]
    .filter(Boolean)
    .slice(0, 2);
}

const GRAPH_AGENT_COMPACT_WORDS: Record<string, string> = {
  capability: "Cap",
  probe: "Pro",
};

const graphScale = (value: number) => value * FLEET_GRAPH_CELL_SCALE;

function mergeGraphAgentNameWords(words: string[]) {
  const merged: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? "";
    const nextWord = words[index + 1] ?? "";
    if (word.toLowerCase() === "use" && nextWord.toLowerCase() === "pod") {
      merged.push("UsePod");
      index++;
      continue;
    }
    merged.push(word);
  }
  return merged;
}

function graphAgentNameSegments(name: string) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => GRAPH_AGENT_COMPACT_WORDS[word.toLowerCase()] ?? word);
  const mergedWords = mergeGraphAgentNameWords(words);

  if (mergedWords.length <= 2) return mergedWords;

  const candidates = [
    [mergedWords.slice(0, 1), mergedWords.slice(1, 3)],
    [mergedWords.slice(0, 2), mergedWords.slice(2, 4)],
  ];
  const [leftWords, rightWords] = candidates.reduce((best, candidate) => {
    const bestScore = Math.abs(
      best[0].join(" ").length - best[1].join(" ").length,
    );
    const candidateScore = Math.abs(
      candidate[0].join(" ").length - candidate[1].join(" ").length,
    );
    return candidateScore < bestScore ? candidate : best;
  });

  return [leftWords.join(" "), rightWords.join(" ")].filter(Boolean);
}

const GRAPH_AGENT_EDGE_LABEL_FONT_SIZE = graphScale(7);
const GRAPH_AGENT_EDGE_LABEL_COMPACT_FONT_SIZE = graphScale(6.1);
const GRAPH_AGENT_EDGE_LABEL_DENSE_FONT_SIZE = graphScale(5.3);
const GRAPH_AGENT_EDGE_LABEL_COMPACT_THRESHOLD = 13;
const GRAPH_AGENT_EDGE_LABEL_DENSE_THRESHOLD = 16;
const GRAPH_AGENT_LEFT_EDGE_LABEL_ANCHOR_INSET = graphScale(0.75);
const GRAPH_AGENT_RIGHT_EDGE_LABEL_ANCHOR_INSET = graphScale(0.75);
const GRAPH_AGENT_EDGE_LABEL_INNER_OFFSET = graphScale(3);
const GRAPH_AGENT_SINGLE_EDGE_LABEL_Y_NUDGE = graphScale(1);
const GRAPH_AGENT_EDGE_LABEL_INNER_PADDING = graphScale(2.2);
const GRAPH_AGENT_CENTER_EDGE_WORD_MAX_LENGTH = 5;
const GRAPH_AGENT_PHRASE_PAIR_CENTER_GAP = graphScale(7.2);
const GRAPH_AGENT_CAPABILITY_BADGE_LIMIT = 4;
const SHOW_GRAPH_AGENT_CAPABILITY_BADGES = false;

const CAPABILITY_ICON: Record<FleetAgentCapabilityIcon, LucideIcon> = {
  analytics: BarChart3,
  background: Bot,
  browser: Globe2,
  chat: MessageCircle,
  deployment: Rocket,
  filesystem: FolderOpen,
  http: Network,
  mcp: PlugZap,
  publishing: Send,
  scheduler: CalendarClock,
  shell: Terminal,
  wallet: WalletCards,
  workflow: Workflow,
};

const CAPABILITY_TONE_CLASS: Record<FleetAgentCapabilityBadge["tone"], string> =
  {
    aqua: styles.graphAgentCapabilityBadgeToneAqua,
    blue: styles.graphAgentCapabilityBadgeToneBlue,
    gold: styles.graphAgentCapabilityBadgeToneGold,
    green: styles.graphAgentCapabilityBadgeToneGreen,
    pink: styles.graphAgentCapabilityBadgeTonePink,
    purple: styles.graphAgentCapabilityBadgeTonePurple,
    slate: styles.graphAgentCapabilityBadgeToneSlate,
  };

export type GraphAgentCapabilityBadgeVariant = "side-rails" | "top-inner-edges";

const CAPABILITY_BADGE_SLOTS_BY_VARIANT: Record<
  GraphAgentCapabilityBadgeVariant,
  ReadonlyArray<{ side: string; x: number; y: number; angle: number }>
> = {
  "side-rails": [
    { side: "left", x: graphScale(7.8), y: graphScale(24), angle: 0 },
    { side: "left", x: graphScale(7.8), y: graphScale(38), angle: 0 },
    { side: "right", x: HEX_W - graphScale(7.8), y: graphScale(24), angle: 0 },
    { side: "right", x: HEX_W - graphScale(7.8), y: graphScale(38), angle: 0 },
  ],
  "top-inner-edges": [
    { side: "top-left", x: graphScale(22), y: graphScale(10.4), angle: -30 },
    { side: "top-left", x: graphScale(14.6), y: graphScale(14.7), angle: -30 },
    {
      side: "top-right",
      x: HEX_W - graphScale(22),
      y: graphScale(10.4),
      angle: 30,
    },
    {
      side: "top-right",
      x: HEX_W - graphScale(14.6),
      y: graphScale(14.7),
      angle: 30,
    },
  ],
};

function GraphAgentEdgeLabel({
  segments,
  selected,
}: {
  segments: string[];
  selected: boolean;
}) {
  const color = selected ? "var(--hex-honey-border)" : "var(--foreground)";
  const labelLength = segments.reduce(
    (total, segment) => total + segment.length,
    0,
  );
  const fontSize =
    labelLength > GRAPH_AGENT_EDGE_LABEL_DENSE_THRESHOLD
      ? GRAPH_AGENT_EDGE_LABEL_DENSE_FONT_SIZE
      : labelLength >= GRAPH_AGENT_EDGE_LABEL_COMPACT_THRESHOLD
        ? GRAPH_AGENT_EDGE_LABEL_COMPACT_FONT_SIZE
        : GRAPH_AGENT_EDGE_LABEL_FONT_SIZE;
  const lowerLeftX =
    GRAPH_AGENT_LEFT_EDGE_LABEL_ANCHOR_INSET * (Math.sqrt(3) / 2) +
    GRAPH_AGENT_EDGE_LABEL_INNER_OFFSET / 2;
  const lowerLeftY =
    (HEX_H * 3) / 4 +
    GRAPH_AGENT_LEFT_EDGE_LABEL_ANCHOR_INSET / 2 -
    GRAPH_AGENT_EDGE_LABEL_INNER_OFFSET * (Math.sqrt(3) / 2) -
    GRAPH_AGENT_EDGE_LABEL_INNER_PADDING;
  const lowerRightX =
    HEX_W -
    GRAPH_AGENT_RIGHT_EDGE_LABEL_ANCHOR_INSET * (Math.sqrt(3) / 2) -
    GRAPH_AGENT_EDGE_LABEL_INNER_OFFSET / 2;
  const lowerRightY =
    (HEX_H * 3) / 4 +
    GRAPH_AGENT_RIGHT_EDGE_LABEL_ANCHOR_INSET / 2 -
    GRAPH_AGENT_EDGE_LABEL_INNER_OFFSET * (Math.sqrt(3) / 2) -
    GRAPH_AGENT_EDGE_LABEL_INNER_PADDING;
  const lowerLeftCenterX = HEX_W / 4 + GRAPH_AGENT_EDGE_LABEL_INNER_OFFSET / 2;
  const lowerLeftCenterY =
    (HEX_H * 7) / 8 -
    GRAPH_AGENT_EDGE_LABEL_INNER_OFFSET * (Math.sqrt(3) / 2) -
    GRAPH_AGENT_EDGE_LABEL_INNER_PADDING;
  const lowerRightCenterX =
    (HEX_W * 3) / 4 - GRAPH_AGENT_EDGE_LABEL_INNER_OFFSET / 2;
  const lowerRightCenterY = lowerLeftCenterY;
  const lowerSingleX = HEX_W / 2 + GRAPH_AGENT_EDGE_LABEL_INNER_OFFSET / 2;
  const lowerSingleY =
    HEX_H -
    GRAPH_AGENT_EDGE_LABEL_INNER_OFFSET * (Math.sqrt(3) / 2) -
    GRAPH_AGENT_SINGLE_EDGE_LABEL_Y_NUDGE;
  const singleWord = segments.length === 1;
  const phrasePair = segments.some((segment) => segment.includes(" "));
  const centerFirstWord =
    !singleWord &&
    !phrasePair &&
    (segments[0]?.length ?? 0) <= GRAPH_AGENT_CENTER_EDGE_WORD_MAX_LENGTH;
  const centerSecondWord =
    !singleWord &&
    !phrasePair &&
    (segments[1]?.length ?? 0) <= GRAPH_AGENT_CENTER_EDGE_WORD_MAX_LENGTH;
  const lowerLeftPairX = HEX_W / 2 - GRAPH_AGENT_PHRASE_PAIR_CENTER_GAP / 2;
  const lowerLeftPairY =
    HEX_H -
    GRAPH_AGENT_EDGE_LABEL_INNER_OFFSET * (Math.sqrt(3) / 2) -
    GRAPH_AGENT_PHRASE_PAIR_CENTER_GAP / (2 * Math.sqrt(3)) -
    GRAPH_AGENT_EDGE_LABEL_INNER_PADDING;
  const lowerRightPairX = HEX_W / 2 + GRAPH_AGENT_PHRASE_PAIR_CENTER_GAP / 2;
  const lowerRightPairY = lowerLeftPairY;
  const firstWordX = singleWord
    ? lowerSingleX
    : phrasePair
      ? lowerLeftPairX
      : centerFirstWord
        ? lowerLeftCenterX
        : lowerLeftX;
  const firstWordY = singleWord
    ? lowerSingleY
    : phrasePair
      ? lowerLeftPairY
      : centerFirstWord
        ? lowerLeftCenterY
        : lowerLeftY;
  const firstWordAnchor = singleWord
    ? "end"
    : phrasePair
      ? "end"
      : centerFirstWord
        ? "middle"
        : "start";
  const secondWordX = phrasePair
    ? lowerRightPairX
    : centerSecondWord
      ? lowerRightCenterX
      : lowerRightX;
  const secondWordY = phrasePair
    ? lowerRightPairY
    : centerSecondWord
      ? lowerRightCenterY
      : lowerRightY;
  const secondWordAnchor = phrasePair
    ? "start"
    : centerSecondWord
      ? "middle"
      : "end";

  return (
    <svg
      aria-hidden="true"
      className={`${styles.graphAgentName} font-semibold`}
      viewBox={`0 0 ${HEX_W} ${HEX_H}`}
      style={{ color }}
    >
      {segments[0] ? (
        <text
          className={styles.graphAgentNameText}
          dominantBaseline="middle"
          fontSize={fontSize}
          textAnchor={firstWordAnchor}
          x={firstWordX}
          y={firstWordY}
          transform={`rotate(30 ${firstWordX} ${firstWordY})`}
        >
          {segments[0]}
        </text>
      ) : null}
      {segments[1] ? (
        <text
          className={styles.graphAgentNameText}
          dominantBaseline="middle"
          fontSize={fontSize}
          textAnchor={secondWordAnchor}
          x={secondWordX}
          y={secondWordY}
          transform={`rotate(-30 ${secondWordX} ${secondWordY})`}
        >
          {segments[1]}
        </text>
      ) : null}
    </svg>
  );
}

function GraphAgentCapabilityBadges({
  capabilities,
  variant,
}: {
  capabilities?: FleetAgentCapabilityBadge[];
  variant: GraphAgentCapabilityBadgeVariant;
}) {
  const visibleCapabilities =
    capabilities?.slice(0, GRAPH_AGENT_CAPABILITY_BADGE_LIMIT) ?? [];
  const slots =
    CAPABILITY_BADGE_SLOTS_BY_VARIANT[variant] ??
    CAPABILITY_BADGE_SLOTS_BY_VARIANT["side-rails"];
  if (visibleCapabilities.length === 0) return null;

  return (
    <div className={styles.graphAgentCapabilityLayer} aria-hidden="true">
      {visibleCapabilities.map((capability, index) => {
        const slot = slots[index];
        if (!slot) return null;
        const Icon = CAPABILITY_ICON[capability.icon] ?? Bot;
        return (
          <span
            key={capability.id}
            className={`${styles.graphAgentCapabilityBadge} ${CAPABILITY_TONE_CLASS[capability.tone]}`}
            data-capability-id={capability.id}
            data-capability-side={slot.side}
            title={capability.label}
            style={
              {
                "--capability-badge-x": `${slot.x}px`,
                "--capability-badge-y": `${slot.y}px`,
                "--capability-badge-angle": `${slot.angle}deg`,
              } as React.CSSProperties
            }
          >
            <Icon aria-hidden="true" />
          </span>
        );
      })}
    </div>
  );
}

function MachineScreenIcon({
  name,
  selected,
  muted,
  mobile,
}: {
  name: string;
  selected: boolean;
  muted: boolean;
  mobile?: boolean;
}) {
  const color = selected
    ? "var(--hex-honey-border)"
    : muted
      ? "var(--muted)"
      : "var(--accent-strong)";
  const label = compactMachineLabel(name);

  return (
    <div
      aria-hidden="true"
      style={{
        width: graphScale(54),
        height: graphScale(54),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color,
      }}
    >
      <div
        className="grid place-items-center text-center"
        style={{
          width: mobile ? graphScale(31) : graphScale(46),
          minHeight: mobile ? graphScale(42) : graphScale(28),
          padding: mobile
            ? `${graphScale(4)}px ${graphScale(3)}px`
            : `${graphScale(3)}px ${graphScale(4)}px`,
          border: `2px solid ${color}`,
          borderRadius: mobile ? graphScale(8) : graphScale(4),
          boxShadow: muted ? undefined : "0 0 12px rgba(94,234,212,0.16)",
        }}
      >
        <span
          className="font-semibold"
          style={{
            color: selected ? "var(--hex-honey-border)" : "var(--foreground)",
            fontFamily: "var(--f-mono)",
            fontSize: mobile ? graphScale(8.6) : graphScale(9),
            lineHeight: 0.95,
            letterSpacing: 0,
            whiteSpace: "normal",
          }}
        >
          {label.map((line) => (
            <React.Fragment key={line}>
              {line}
              <br />
            </React.Fragment>
          ))}
        </span>
      </div>
      {mobile ? null : (
        <>
          <div
            style={{
              width: graphScale(2),
              height: graphScale(5),
              background: color,
            }}
          />
          <div
            style={{
              width: graphScale(18),
              height: graphScale(2),
              borderRadius: 999,
              background: color,
            }}
          />
        </>
      )}
    </div>
  );
}

function ActiveAppBadge({ app }: { app: FleetActiveApp }) {
  const [broken, setBroken] = React.useState(false);
  return (
    <span
      className={styles.graphActiveAppBadge}
      aria-label={`${app.name} is active`}
      title={`${app.name} is active`}
    >
      {app.iconUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={app.iconUrl} alt="" onError={() => setBroken(true)} />
      ) : (
        <span>{app.initials}</span>
      )}
    </span>
  );
}

interface MachineClusterProps {
  machine: FleetMachine;
  cx: number;
  cy: number;
  addCell?: [number, number];
  capabilityBadgeVariant?: GraphAgentCapabilityBadgeVariant;
  selected: boolean;
  selectedAgentId: string | null;
  onSelectMachine: () => void;
  onSelectAgent: (machine: FleetMachine, agent: FleetAgent) => void;
  onAddAgent: (machine: FleetMachine) => void;
  updateStatus?: MachineUpdateButtonStatus;
  updateDetail?: MachineUpdateButtonDetail;
  onUpdateMachine?: (machine: FleetMachine) => void;
  onOpenCodeProof?: (machine: FleetMachine) => void;
  onFixSyncIssue?: (machine: FleetMachine) => void | Promise<void>;
  onOpenUsePodHost?: (machine: FleetMachine) => void;
  onOpenShell?: (machine: FleetMachine) => void;
  onOpenChat?: (machine: FleetMachine, agent: FleetAgent) => void;
  onOpenTaskChat?: (
    machine: FleetMachine,
    agent: FleetAgent,
    chat?: FleetAgentChat,
  ) => void;
  onCallAgent?: (machine: FleetMachine, agent: FleetAgent) => void;
  onOpenWallet?: (machine: FleetMachine, agent: FleetAgent) => void;
  onEditSettings?: (machine: FleetMachine, agent: FleetAgent) => void;
  onDuplicate?: (machine: FleetMachine, agent: FleetAgent) => void;
  onRemove?: (
    machine: FleetMachine,
    agent: FleetAgent,
    depth?: AeonDeleteDepth,
    onProgress?: (progress: AeonDeleteProgress) => void,
  ) => void | Promise<AeonDeleteResult | void>;
  selectionTooltipKey?: string | null;
  onOpenSelectionTooltip?: (key: string) => void;
  onDismissSelectionTooltip?: () => void;
  /** `machineId:agentId` of a just-added agent — its hex gets the arrival bounce. */
  newAgentKey?: string | null;
}

/**
 * Renders one machine and its agents as a perfectly-tessellated honeycomb:
 *   • machine = center hex
 *   • agents  = ring around it (axial spiral, shared edges)
 *   • next free slot = dashed "+" cell to add a new agent
 */
export function MachineCluster({
  machine,
  cx,
  cy,
  addCell,
  capabilityBadgeVariant = "side-rails",
  selected,
  selectedAgentId,
  onSelectMachine,
  onSelectAgent,
  onAddAgent,
  updateStatus,
  updateDetail,
  onUpdateMachine,
  onOpenCodeProof,
  onFixSyncIssue,
  onOpenUsePodHost,
  onOpenShell,
  onOpenChat,
  onOpenTaskChat,
  onCallAgent,
  onOpenWallet,
  onEditSettings,
  onDuplicate,
  onRemove,
  selectionTooltipKey,
  onOpenSelectionTooltip,
  onDismissSelectionTooltip,
  newAgentKey,
}: MachineClusterProps) {
  const agentCount = machine.agents.length;
  const occupiedCells = hexSpiral(agentCount + 1);
  const defaultAddCell = hexSpiral(agentCount + 2)[agentCount + 1] ?? [0, 0];
  // Phones can't host agents — no "Add agent" hex on mobile clusters.
  const hasAddCell = !isFleetMachineMobile(machine);
  const cells = hasAddCell
    ? [...occupiedCells, addCell ?? defaultAddCell]
    : occupiedCells;

  return (
    <div
      style={{ position: "absolute", left: cx, top: cy, width: 0, height: 0 }}
    >
      {cells.map(([q, r], i) => {
        const isMachine = i === 0;
        const isAdd = hasAddCell && i === cells.length - 1;
        const { x, y } = axialToPixel(q, r);
        const agent = !isMachine && !isAdd ? machine.agents[i - 1] : null;
        const isAgentSelected = !!(agent && selectedAgentId === agent.id);
        const agentNameSegments = agent
          ? graphAgentNameSegments(agent.name)
          : [];

        const tone: HexTone | null = isAdd
          ? null
          : isMachine
            ? machine.versionState === "needs-setup"
              ? "ghost"
              : selected && !selectedAgentId
                ? "honey"
                : "default"
            : isAgentSelected
              ? "honey"
              : (STATE_TONE[agent!.state] ?? "default");

        const wrapperStyle: React.CSSProperties = {
          position: "absolute",
          left: x - HEX_W / 2,
          top: y - HEX_H / 2,
          width: HEX_W,
          height: HEX_H,
        };

        if (isAdd) {
          return (
            <div key={i} style={wrapperStyle}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AddHexCell
                    size={HEX_W}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddAgent(machine);
                    }}
                    label={`Add agent to ${machine.name}`}
                  />
                </TooltipTrigger>
                <TooltipContent>Add agent to {machine.name}</TooltipContent>
              </Tooltip>
            </div>
          );
        }

        const tooltipKey = `${machine.id}:${isMachine ? "machine" : agent!.id}`;
        const tooltipOpen = Boolean(
          selectionTooltipKey === tooltipKey &&
          (isMachine ? selected && !selectedAgentId : isAgentSelected),
        );
        const isNewArrival =
          !isMachine && !!newAgentKey && newAgentKey === tooltipKey;

        return (
          <div
            key={i}
            style={isNewArrival ? { ...wrapperStyle, zIndex: 5 } : wrapperStyle}
          >
            <Tooltip open={tooltipOpen} disableHoverableContent={false}>
              <TooltipTrigger asChild>
                <HexTile
                  size={HEX_W}
                  tone={tone!}
                  className={isNewArrival ? styles.hexNewArrival : undefined}
                  data-fleet-cell-control
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isMachine) onSelectMachine();
                    else if (agent) onSelectAgent(machine, agent);
                    onOpenSelectionTooltip?.(tooltipKey);
                  }}
                >
                  {!isMachine && agent?.activeApp ? (
                    <ActiveAppBadge app={agent.activeApp} />
                  ) : null}
                  <div
                    className={
                      isMachine
                        ? "grid justify-items-center text-center"
                        : `${styles.graphAgentCellContent} text-center`
                    }
                    style={
                      {
                        width: isMachine ? "100%" : undefined,
                        height: isMachine ? "100%" : undefined,
                        maxWidth: isMachine ? HEX_W : undefined,
                        minHeight: isMachine ? undefined : HEX_H,
                        paddingInline: isMachine ? 0 : graphScale(4),
                        alignContent: isMachine ? "center" : "center",
                        gap: isMachine ? 0 : graphScale(1),
                        transform: undefined,
                        "--graph-agent-scale": FLEET_GRAPH_CELL_SCALE,
                      } as React.CSSProperties
                    }
                  >
                    {isMachine ? (
                      <MachineScreenIcon
                        name={machine.name}
                        selected={selected && !selectedAgentId}
                        muted={
                          machine.versionState === "needs-setup" &&
                          !(selected && !selectedAgentId)
                        }
                        mobile={isFleetMachineMobile(machine)}
                      />
                    ) : (
                      <>
                        {SHOW_GRAPH_AGENT_CAPABILITY_BADGES ? (
                          <GraphAgentCapabilityBadges
                            capabilities={agent!.capabilities}
                            variant={capabilityBadgeVariant}
                          />
                        ) : null}
                        <BeeIcon
                          role={agent!.beeRole === "queen" ? "queen" : "worker"}
                          workerClass={agent!.workerClass}
                          size={graphScale(48)}
                          dim={agent!.state === "ready" && !isAgentSelected}
                        />
                        <GraphAgentEdgeLabel
                          segments={agentNameSegments}
                          selected={isAgentSelected}
                        />
                      </>
                    )}
                  </div>
                </HexTile>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={4}
                className="pointer-events-auto max-w-none p-3"
                arrowClassName="h-2.5 w-5"
                onPointerDownOutside={onDismissSelectionTooltip}
              >
                <FleetSelectionTooltipContent
                  machine={machine}
                  agent={agent}
                  updateStatus={updateStatus}
                  updateDetail={updateDetail}
                  onClose={onDismissSelectionTooltip}
                  onAddAgent={onAddAgent}
                  onUpdateMachine={onUpdateMachine}
                  onOpenCodeProof={onOpenCodeProof}
                  onFixSyncIssue={onFixSyncIssue}
                  onOpenUsePodHost={onOpenUsePodHost}
                  onOpenShell={onOpenShell}
                  onOpenChat={onOpenChat}
                  onOpenTaskChat={onOpenTaskChat}
                  onCallAgent={onCallAgent}
                  onOpenWallet={onOpenWallet}
                  onEditSettings={onEditSettings}
                  onDuplicate={onDuplicate}
                  onRemove={onRemove}
                />
              </TooltipContent>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}
