// src/components/fleet/machine-cluster.tsx
"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AddHexCell } from "./add-hex-cell";
import { BeeIcon } from "./bee-icon";
import { HexTile, type HexTone } from "./hex-tile";
import { axialToPixel, HEX_H, HEX_W, hexSpiral } from "./hex-math";
import { isFleetMachineMobile, type AgentState, type FleetActiveApp, type FleetAgent, type FleetMachine } from "./fleet-data";
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
  if (/ubuntu|linux|vps|server/i.test(normalized)) return ["VPS", suffix || "LIN"];

  const words = normalized.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const letters = words
    .filter((word) => !/^\d+$/.test(word))
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return [letters || "NODE", suffix || words.find((word) => /^\d+$/.test(word)) || ""].filter(Boolean).slice(0, 2);
}

function MachineScreenIcon({ name, selected, muted, mobile }: { name: string; selected: boolean; muted: boolean; mobile?: boolean }) {
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
        width: 54,
        height: 54,
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
          width: mobile ? 31 : 46,
          minHeight: mobile ? 42 : 28,
          padding: mobile ? "4px 3px" : "3px 4px",
          border: `2px solid ${color}`,
          borderRadius: mobile ? 8 : 4,
          boxShadow: muted ? undefined : "0 0 12px rgba(94,234,212,0.16)",
        }}
      >
        <span
          className="font-semibold"
          style={{
            color: selected ? "var(--hex-honey-border)" : "var(--foreground)",
            fontFamily: "var(--f-mono)",
            fontSize: mobile ? 8.6 : 9,
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
              width: 2,
              height: 5,
              background: color,
            }}
          />
          <div
            style={{
              width: 18,
              height: 2,
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
  selected: boolean;
  selectedAgentId: string | null;
  onSelectMachine: () => void;
  onSelectAgent: (machine: FleetMachine, agent: FleetAgent) => void;
  onAddAgent: (machine: FleetMachine) => void;
}

/**
 * Renders one machine and its agents as a perfectly-tessellated honeycomb:
 *   • machine = center hex
 *   • agents  = ring around it (axial spiral, shared edges)
 *   • next free slot = dashed "+" cell to add a new agent
 */
export function MachineCluster({
  machine,
  cx, cy, addCell,
  selected, selectedAgentId,
  onSelectMachine, onSelectAgent, onAddAgent,
}: MachineClusterProps) {
  const agentCount = machine.agents.length;
  const occupiedCells = hexSpiral(agentCount + 1);
  const defaultAddCell = hexSpiral(agentCount + 2)[agentCount + 1] ?? [0, 0];
  const cells = [...occupiedCells, addCell ?? defaultAddCell];

  return (
    <div style={{ position: "absolute", left: cx, top: cy, width: 0, height: 0 }}>
      {cells.map(([q, r], i) => {
        const isMachine = i === 0;
        const isAdd = i === cells.length - 1;
        const { x, y } = axialToPixel(q, r);
        const agent = !isMachine && !isAdd ? machine.agents[i - 1] : null;
        const isAgentSelected = !!(agent && selectedAgentId === agent.id);

        const tone: HexTone | null = isAdd
          ? null
          : isMachine
            ? (machine.versionState === "needs-setup"
                ? "ghost"
                : selected && !selectedAgentId
                  ? "honey"
                  : "default")
            : isAgentSelected
              ? "honey"
              : STATE_TONE[agent!.state] ?? "default";

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

        return (
          <div key={i} style={wrapperStyle} title={isMachine ? machine.name : `${agent!.name}${agent!.activeApp ? ` · ${agent!.activeApp.name} active` : ""}`}>
            <HexTile
              size={HEX_W}
              tone={tone!}
              data-fleet-cell-control
              onClick={(e) => {
                e.stopPropagation();
                if (isMachine) onSelectMachine();
                else if (agent) onSelectAgent(machine, agent);
              }}
            >
              <div
                className={`grid justify-items-center text-center ${!isMachine ? styles.graphAgentCellContent : ""}`}
                style={{
                  width: isMachine ? "100%" : undefined,
                  height: isMachine ? "100%" : undefined,
                  maxWidth: isMachine ? HEX_W : HEX_W - 8,
                  paddingInline: isMachine ? 0 : 4,
                  alignContent: isMachine ? "center" : "center",
                  gap: isMachine ? 0 : 1,
                  transform: isMachine ? undefined : "translateY(-5px)",
                }}
              >
                {isMachine ? (
                  <MachineScreenIcon
                    name={machine.name}
                    selected={selected && !selectedAgentId}
                    muted={machine.versionState === "needs-setup" && !(selected && !selectedAgentId)}
                    mobile={isFleetMachineMobile(machine)}
                  />
                ) : (
                  <>
                    <BeeIcon role={agent!.beeRole === "queen" ? "queen" : "worker"} workerClass={agent!.workerClass} size={34}
                      dim={agent!.state === "ready" && !isAgentSelected} />
                    <span
                      className={`${styles.graphAgentName} font-semibold`}
                      style={{
                        fontFamily: "var(--f-mono)",
                        fontSize: 7.8,
                        letterSpacing: 0.04,
                        lineHeight: 1.05,
                        color: isAgentSelected ? "var(--hex-honey-border)" : "var(--foreground)",
                      }}
                    >
                      {agent!.name}
                    </span>
                  </>
                )}
              </div>
            </HexTile>
            {!isMachine && agent?.activeApp ? <ActiveAppBadge app={agent.activeApp} /> : null}
          </div>
        );
      })}
    </div>
  );
}
