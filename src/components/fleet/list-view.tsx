// src/components/fleet/list-view.tsx
"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import * as React from "react";
import { Copy, MessageSquare, Monitor, PhoneCall, Settings2, Smartphone, Trash2, Wallet } from "lucide-react";
import { BeeIcon } from "./bee-icon";
import { HexTile } from "./hex-tile";
import { fleetAgentCanChat, isFleetMachineMobile, type AgentState, type FleetAgent, type FleetAgentChat, type FleetMachine } from "./fleet-data";
import { FleetTaskPreviewRow } from "./task-preview-row";
import styles from "./fleet-tokens.module.css";

interface ListViewProps {
  machines: FleetMachine[];
  selected: string;
  selectedAgentId: string | null;
  onSelectMachine: (id: string) => void;
  onSelectAgent: (m: FleetMachine, a: FleetAgent) => void;
  onAddAgent: (m: FleetMachine) => void;
  onOpenChat?: (m: FleetMachine, a: FleetAgent) => void;
  onOpenTaskChat?: (m: FleetMachine, a: FleetAgent, chat?: FleetAgentChat) => void;
  onCallAgent?: (m: FleetMachine, a: FleetAgent) => void;
  onOpenWallet?: (m: FleetMachine, a: FleetAgent) => void;
  onEditSettings?: (m: FleetMachine, a: FleetAgent) => void;
  onDuplicate?: (m: FleetMachine, a: FleetAgent) => void;
  onRemove?: (m: FleetMachine, a: FleetAgent) => void;
}

const STATE_COLOR: Record<AgentState, string> = {
  working:   "var(--accent-strong)",
  ready:     "var(--muted)",
  scheduled: "#fde68a",
  setup:     "#fde68a",
  failed:    "var(--danger)",
};

const STATE_TONE = (s: AgentState) =>
  s === "working" ? "active" :
  s === "failed" ? "danger" :
  s === "scheduled" || s === "setup" ? "honey" : "default";

const versionPill = (v: FleetMachine["versionState"]) => {
  if (v === "stale")        return { label: "stale",  color: "#fde68a", bg: "rgba(255,212,90,0.14)", border: "rgba(255,212,90,0.42)" };
  if (v === "needs-setup")  return { label: "setup",  color: "#fde68a", bg: "rgba(255,212,90,0.14)", border: "rgba(255,212,90,0.42)" };
  return                          { label: "current", color: "var(--accent-strong)", bg: "rgba(45,212,191,0.10)", border: "rgba(94,234,212,0.32)" };
};

const tailnetPill = (machine: FleetMachine) => {
  const connected = machine.uptime.toLowerCase() === "online" && machine.tailnet.toLowerCase() !== "not connected";
  return connected
    ? { label: "Connected", color: "var(--accent-strong)", bg: "rgba(45,212,191,0.10)", border: "rgba(94,234,212,0.32)" }
    : { label: "Off", color: "var(--muted)", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.22)" };
};

export function ListView({
  machines,
  selected, selectedAgentId,
  onSelectMachine, onSelectAgent, onAddAgent,
  onOpenChat, onOpenTaskChat, onCallAgent, onOpenWallet, onEditSettings, onDuplicate, onRemove,
}: ListViewProps) {
  const [expandedTaskIds, setExpandedTaskIds] = React.useState<Set<string>>(() => new Set());
  const toggleTaskPreview = (previewId: string) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(previewId)) {
        next.delete(previewId);
      } else {
        next.add(previewId);
      }
      return next;
    });
  };
  const fire = (
    machine: FleetMachine,
    agent: FleetAgent,
    fn?: (m: FleetMachine, a: FleetAgent) => void,
  ) => (event: React.MouseEvent) => {
    event.stopPropagation();
    fn?.(machine, agent);
  };

  return (
    <div className="w-full h-full overflow-auto px-5 py-3">
      <div className="rounded-xl overflow-hidden bg-[rgba(16,20,29,0.78)]"
        style={{ border: "1px solid rgba(148,163,184,0.16)" }}>
        <table className="w-full border-collapse text-xs table-fixed">
          <colgroup>
            <col style={{ width: "24%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "18%" }} />
          </colgroup>
          <thead>
            <tr style={{ background: "rgba(15,23,42,0.6)", borderBottom: "1px solid rgba(148,163,184,0.16)" }}>
              {["Machine", "Kind · Location", "Agents", "Tailnet", "Uptime", "Build"].map((h) => (
                <th key={h}
                  className="px-4 py-2.5 text-left uppercase"
                  style={{ fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 700,
                           letterSpacing: 0.08, color: "var(--muted)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {machines.map((m) => {
              const isMSel = selected === m.id && !selectedAgentId;
              const v = versionPill(m.versionState);
              const tailnet = tailnetPill(m);
              return (
                <React.Fragment key={m.id}>
                  <tr
                    onClick={() => onSelectMachine(m.id)}
                    className="cursor-pointer"
                    style={{
                      background: isMSel ? "rgba(255,212,90,0.08)" : "transparent",
                      borderTop: "1px solid rgba(148,163,184,0.16)",
                    }}
                  >
                    <td className="px-4 py-2.5">
                      <div className={styles.listEntity}>
                        <HexTile className={styles.listAvatarHex} size={26} tone={isMSel ? "honey" : "default"}>
                          {(() => {
                            const MachineIcon = isFleetMachineMobile(m) ? Smartphone : Monitor;
                            return <MachineIcon
                            aria-hidden="true"
                            size={14}
                            style={{
                              color: m.versionState === "needs-setup" && !isMSel
                                ? "var(--muted)"
                                : "var(--accent-strong)",
                            }}
                            />;
                          })()}
                        </HexTile>
                        <div className={styles.listEntityText}>
                          <div className="font-semibold"
                            style={{ fontFamily: "var(--f-display)", fontSize: 13,
                                     color: isMSel ? "var(--hex-honey-border)" : "var(--foreground)" }}>
                            {m.name}
                          </div>
                          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)" }}>
                            {m.os}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5" style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>
                      <div style={{ color: "var(--foreground)" }}>{m.kind} · {m.role}</div>
                      <div style={{ color: "var(--muted)" }}>{m.city}</div>
                    </td>
                    <td className="px-4 py-2.5" style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>
                      <span style={{ color: "var(--accent-strong)" }}>{m.agents.length}</span>
                      <span className="ml-1.5" style={{ color: "var(--muted)", fontSize: 10 }}>
                        {m.agents.filter((a) => a.state === "working").length} active
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="inline-flex items-center gap-1.5 uppercase"
                        title={`${tailnet.label}: ${m.tailnet}${m.ip !== "—" ? ` · ${m.ip}` : ""}${m.ping ? ` · ${m.ping}ms` : ""}`}
                        style={{
                          padding: "3px 8px", borderRadius: 4,
                          background: tailnet.bg, border: `1px solid ${tailnet.border}`, color: tailnet.color,
                          fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 700, letterSpacing: 0.08,
                        }}
                      >
                        <span className={styles.dot} style={{ color: tailnet.color, width: 5, height: 5 }} />
                        {tailnet.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5" style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--foreground)" }}>
                      {m.uptime}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="inline-flex items-center gap-1.5 uppercase"
                        style={{
                          padding: "3px 8px", borderRadius: 4,
                          background: v.bg, border: `1px solid ${v.border}`, color: v.color,
                          fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 700, letterSpacing: 0.08,
                        }}
                      >
                        <span className={styles.dot} style={{ color: v.color, width: 5, height: 5 }} />
                        {m.version === "—" ? "needs setup" : `${m.version} · ${v.label}`}
                      </span>
                    </td>
                  </tr>

                  {m.agents.map((a) => {
                    const isASel = selected === m.id && selectedAgentId === a.id;
                    const canChat = fleetAgentCanChat(a);
                    const recentChats = (a.recentChats?.length
                      ? a.recentChats
                      : [{ id: a.currentTaskId ?? "current", title: a.task, task: a.task, since: a.since }]
                    ).slice(0, 3);
                    return (
                      <tr
                        key={a.id}
                        onClick={(e) => { e.stopPropagation(); onSelectAgent(m, a); }}
                        className="cursor-pointer"
                        style={{ background: isASel ? "rgba(255,212,90,0.10)" : "transparent" }}
                      >
                        <td className="py-1.5" style={{ paddingLeft: 50, paddingRight: 16 }}>
                          <div className={`${styles.listEntity} ${styles.listAgentEntity}`}>
                            <HexTile className={styles.listAvatarHex} size={28} tone={STATE_TONE(a.state)}>
                              <BeeIcon
                                role={a.beeRole === "queen" ? "queen" : "worker"}
                                workerClass={a.workerClass}
                                size={21}
                                dim={a.state === "ready" && !isASel}
                                className={styles.listBeeIcon}
                              />
                            </HexTile>
                            <div className={styles.listEntityText}>
                              <div className="font-semibold"
                                style={{ fontFamily: "var(--f-display)", fontSize: 12,
                                         color: isASel ? "var(--hex-honey-border)" : "var(--foreground)" }}>
                                {a.name}
                              </div>
                              <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)" }}>
                                {a.runtime} · {a.role}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td colSpan={2} className="px-4 py-1.5">
                          <div className="grid" style={{ gap: 7 }}>
                            {recentChats.map((chat) => {
                              const previewId = `${a.id}:${chat.id}`;
                              const isTaskExpanded = expandedTaskIds.has(previewId);
                              return (
                                <FleetTaskPreviewRow
                                  key={previewId}
                                  id={previewId}
                                  title={chat.title}
                                  since={chat.since}
                                  expanded={isTaskExpanded}
                                  subjectName={a.name}
                                  className={styles.listTaskPreview}
                                  textClassName={styles.listTaskPreviewText}
                                  onToggle={toggleTaskPreview}
                                >
                                  {canChat && onOpenTaskChat && chat.id !== "current" ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          aria-label={`Resume chat with ${a.name}`}
                                          className="inline-grid place-items-center"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            onOpenTaskChat(m, a, chat);
                                          }}
                                          style={{
                                            color: "var(--accent-strong)",
                                            border: 0,
                                            background: "transparent",
                                            cursor: "pointer",
                                            padding: 0,
                                          }}
                                        >
                                          <MessageSquare size={13} aria-hidden="true" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent>Resume chat</TooltipContent>
                                    </Tooltip>
                                  ) : null}
                                </FleetTaskPreviewRow>
                              );
                            })}
                            {isASel && (
                              <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
                                {canChat && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={fire(m, a, onOpenChat)}
                                        className="inline-flex items-center uppercase font-bold"
                                        style={{
                                          gap: 6,
                                          padding: "7px 9px",
                                          borderRadius: 7,
                                          cursor: "pointer",
                                          fontFamily: "var(--f-mono)",
                                          fontSize: 9.5,
                                          letterSpacing: 0.04,
                                          border: "1px solid rgba(94,234,212,0.48)",
                                          background: "rgba(45,212,191,0.16)",
                                          color: "var(--accent-strong)",
                                        }}
                                      >
                                        <MessageSquare size={12} /> New Chat
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>Start a fresh chat with {a.name}</TooltipContent>
                                  </Tooltip>
                                )}

                                {[
                                  { id: "call", label: "Call", Icon: PhoneCall, onClick: fire(m, a, onCallAgent) },
                                  { id: "wallet", label: "Wallet & limits", Icon: Wallet, onClick: fire(m, a, onOpenWallet) },
                                  { id: "edit", label: "Edit settings", Icon: Settings2, onClick: fire(m, a, onEditSettings) },
                                  { id: "dup", label: "Duplicate", Icon: Copy, onClick: fire(m, a, onDuplicate) },
                                  { id: "remove", label: "Remove agent", Icon: Trash2, onClick: fire(m, a, onRemove), danger: true },
                                ].map(({ id, label, Icon, onClick, danger }) => (
                                  <Tooltip key={id}>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={onClick}
                                        aria-label={label}
                                        className="inline-grid place-items-center cursor-pointer"
                                        style={{
                                          width: 28,
                                          height: 28,
                                          borderRadius: 7,
                                          border: danger
                                            ? "1px solid rgba(251,113,133,0.30)"
                                            : "1px solid rgba(148,163,184,0.22)",
                                          background: "rgba(15,23,42,0.62)",
                                          color: danger ? "#fecdd3" : "var(--foreground)",
                                        }}
                                      >
                                        <Icon size={12} />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>{label}</TooltipContent>
                                  </Tooltip>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-1.5" aria-hidden="true" />
                        <td className="px-4 py-1.5" style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)" }}>{a.since}</td>
                        <td className="px-4 py-1.5">
                          <span
                            className="inline-flex items-center gap-1.5 uppercase"
                            style={{
                              padding: "3px 8px", borderRadius: 4,
                              background: `color-mix(in srgb, ${STATE_COLOR[a.state]} 14%, transparent)`,
                              color: STATE_COLOR[a.state],
                              border: `1px solid color-mix(in srgb, ${STATE_COLOR[a.state]} 38%, transparent)`,
                              fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 700, letterSpacing: 0.08,
                            }}
                          >
                            <span
                              className={a.state === "working" ? `${styles.dot} ${styles.dotLive}` : styles.dot}
                              style={{ color: STATE_COLOR[a.state], width: 5, height: 5 }}
                            />
                            {a.state}
                          </span>
                        </td>
                      </tr>
                    );
                  })}

                  <tr>
                    <td colSpan={6} className="py-1.5" style={{ paddingLeft: 50, paddingRight: 16, paddingBottom: 10 }}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => { e.stopPropagation(); onAddAgent(m); }}
                            className="inline-flex items-center gap-2 uppercase"
                            style={{
                              padding: "5px 11px", borderRadius: 6,
                              background: "transparent",
                              border: "1px dashed var(--hex-add-stroke)",
                              color: "var(--accent-strong)",
                              fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 700, letterSpacing: 0.08,
                            }}
                          >
                            ＋ add agent
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Add agent to {m.name}</TooltipContent>
                      </Tooltip>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
