"use client";

/* HivePanel.tsx — the contextual detail panel on the right. Three modes:
   queen overview, machine detail, agent detail. Every action chip is wired to
   a real handler so the Hive view reaches parity with the legacy FleetView. */

import { fleetAgentCanChat, type FleetAgentChat } from "@/components/fleet/fleet-data";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import Image from "next/image";
import {
  AlertTriangle,
  ChevronLeft,
  Copy,
  FileUp,
  GitBranch,
  MessageSquare,
  Pencil,
  PhoneCall,
  Plus,
  RefreshCcw,
  Settings,
  SquareTerminal,
  Trash2,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { AgentHoldings } from "./AgentHoldings";
import type { HiveAgent, HiveMachine, HiveSelection } from "./fleet-hive-types";
import { frFleetSummary, frMachineState, frStateMeta } from "./fleet-hive-types";
import { Dot, HiveMark, Meter, Summary } from "./primitives";

const USEPOD_RUNTIME_ICON_PATH = "/icons/runtimes/usepod.webp";

function ActionIcon({ icon: Icon, size = 13 }: { icon: LucideIcon; size?: number }) {
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />;
}

function UsePodActionIcon() {
  return (
    <Image
      src={USEPOD_RUNTIME_ICON_PATH}
      alt=""
      aria-hidden="true"
      width={15}
      height={15}
      unoptimized
    />
  );
}

export interface HivePanelHandlers {
  onAddAgent?: (m: HiveMachine) => void;
  onAddMachine?: () => void;
  onOpenQueenSettings?: () => void;
  /** Start a voice call with the Queen (opens the Queen voice overlay). */
  onCallQueen?: () => void;
  onUpdateMachine?: (m: HiveMachine) => void;
  onRenameMachine?: (m: HiveMachine) => void;
  onOpenCodeProof?: (m: HiveMachine) => void;
  onFixSyncIssue?: (m: HiveMachine) => void;
  onFixNetworkIssue?: (m: HiveMachine) => void;
  /** Transient status text for an in-flight/just-finished network repair. */
  getNetworkFixStatus?: (m: HiveMachine) => string | null;
  onOpenShell?: (m: HiveMachine) => void;
  onSendFile?: (m: HiveMachine) => void;
  onOpenUsePodHost?: (m: HiveMachine) => void;
  onCallAgent?: (m: HiveMachine, a: HiveAgent) => void;
  onOpenChat?: (m: HiveMachine, a: HiveAgent) => void;
  onOpenTaskChat?: (m: HiveMachine, a: HiveAgent, chat?: FleetAgentChat) => void;
  onOpenWallet?: (m: HiveMachine, a: HiveAgent) => void;
  onEditSettings?: (m: HiveMachine, a: HiveAgent) => void;
  onDuplicate?: (m: HiveMachine, a: HiveAgent) => void;
  onRemove?: (m: HiveMachine, a: HiveAgent) => void;
  /** Resolves the per-machine update action label/state from the live status maps. */
  getMachineUpdate?: (m: HiveMachine) => { label: string; busy: boolean; canUpdate: boolean } | null;
}

function FrHivePanelAgent({ a }: { a: HiveAgent }) {
  const meta = frStateMeta(a.state);
  return (
    <div style={{ display: "flex", gap: 11, padding: "11px 0", borderTop: "1px solid var(--line)" }}>
      <span style={{ marginTop: 3 }}><Dot state={a.state} size={7} /></span>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 13, whiteSpace: "nowrap" }}>{a.name}</span>
          <span style={{ fontSize: 10.5, color: meta.color }}>{meta.label}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.45, marginTop: 3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{a.task}</div>
      </div>
    </div>
  );
}

function FrMiniMeters({ m }: { m: HiveMachine }) {
  const rows: [string, number][] = [["cpu", m.cpu], ["ram", m.ram], ["disk", m.disk]];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, margin: "20px 0" }}>
      {rows.map(([l, v]) => (
        <div key={l}>
          <div style={{ fontSize: 9.5, color: "var(--fg-3)", fontFamily: "var(--f-mono)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{l}</div>
          <div style={{ fontFamily: "var(--f-display)", fontSize: 16, marginBottom: 6 }}>{v}<span style={{ fontSize: 10, color: "var(--fg-3)" }}>%</span></div>
          <Meter value={v} />
        </div>
      ))}
    </div>
  );
}

export function HivePanel({
  machines,
  sel,
  onSelect,
  handlers = {},
  walletsByAgent = {},
}: {
  machines: HiveMachine[];
  sel: HiveSelection;
  onSelect: (s: HiveSelection) => void;
  handlers?: HivePanelHandlers;
  walletsByAgent?: Record<string, AgentWalletConfig>;
}) {
  const s = frFleetSummary(machines);
  let body: React.ReactNode;

  if (sel.type === "queen") {
    const workingList: { a: HiveAgent; m: HiveMachine }[] = [];
    machines.forEach((m) => m.agents.forEach((a) => { if (a.state === "working") workingList.push({ a, m }); }));
    const attention = (() => {
      for (const m of machines) {
        const a = m.agents.find((x) => x.state === "failed") ?? m.agents.find((x) => x.state === "setup");
        if (a) return { agent: a.name, machine: m.name, text: a.task };
        if (m.versionState === "needs-setup") return { agent: "", machine: m.name, text: "Machine needs setup before agents can run." };
      }
      return null;
    })();
    body = (
      <div key="queen" style={{ animation: "fr-fade-up .3s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="fr-eyebrow" style={{ color: "var(--honey)" }}>The Queen</span>
        </div>
        <h2 style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 27, letterSpacing: "-0.02em", margin: "10px 0 0" }}>The hive is humming.</h2>
        <p style={{ fontSize: 13, color: "var(--fg-3)", lineHeight: 1.55, margin: "10px 0 0" }}>
          {s.working} of {s.agents} agents are working across {s.machines} machines. The orchestrator is routing the swarm.
        </p>

        <div style={{ display: "flex", gap: 22, margin: "22px 0 4px" }}>
          <Summary n={s.agents} label="agents" />
          <Summary n={s.working} label="working" live />
          <Summary n={s.attention} label="to tend" tone={s.attention ? "var(--honey)" : undefined} />
        </div>

        {(handlers.onCallQueen || handlers.onOpenQueenSettings || handlers.onAddMachine) ? (
          <div className="fr-queen-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
            {handlers.onCallQueen ? (
              <button type="button" className="fr-act fr-act-primary" onClick={() => handlers.onCallQueen?.()}>
                <ActionIcon icon={PhoneCall} size={14} />
                Call
              </button>
            ) : null}
            {handlers.onOpenQueenSettings ? (
              <button type="button" className="fr-act" onClick={() => handlers.onOpenQueenSettings?.()}>
                <ActionIcon icon={Settings} size={14} />
                Queen settings
              </button>
            ) : null}
            {handlers.onAddMachine ? (
              <button type="button" className="fr-act" onClick={() => handlers.onAddMachine?.()}>
                <ActionIcon icon={Plus} size={14} />
                Onboard machine
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="fr-eyebrow" style={{ marginTop: 24 }}>Working now</div>
        <div style={{ marginTop: 4 }}>
          {workingList.length ? workingList.map(({ a, m }) => (
            <button
              key={a.id}
              type="button"
              className="fr-working-row"
              aria-label={`${a.name} on ${m.name}: ${a.task}`}
              onClick={() => onSelect({ type: "agent", id: a.id, machineId: m.id })}
            >
              <span className="fr-working-dot"><Dot state="working" size={7} /></span>
              <span className="fr-working-main">
                <span className="fr-working-titleline">
                  <span className="fr-working-agent-name" title={a.name}>{a.name}</span>
                  <span className="fr-working-machine" title={m.name}>on {m.name}</span>
                </span>
                <span className="fr-working-task" title={a.task}>{a.task}</span>
              </span>
            </button>
          )) : (
            <div style={{ padding: "16px 0", borderTop: "1px solid var(--line)", fontSize: 12.5, color: "var(--fg-3)" }}>No agents are working right now.</div>
          )}
        </div>

        {attention ? (
          <div style={{ display: "flex", gap: 10, marginTop: 22, padding: "12px 14px", borderRadius: "var(--radius-sm)", background: "var(--honey-soft)", border: "1px solid var(--honey-line)" }}>
            <HiveMark size={16} stroke="var(--honey)" />
            <span style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.45 }}>{attention.agent ? `${attention.agent} on ${attention.machine} — ` : `${attention.machine} — `}{attention.text}</span>
          </div>
        ) : null}
      </div>
    );
  } else if (sel.type === "machine") {
    const m = machines.find((x) => x.id === sel.id);
    if (!m) { body = null; }
    else {
      const working = m.agents.filter((a) => a.state === "working").length;
      const update = handlers.getMachineUpdate?.(m) ?? null;
      const sync = m.source.syncIssue;
      const network = m.source.networkIssue;
      const networkFixStatus = handlers.getNetworkFixStatus?.(m) ?? null;
      body = (
        <div key={"m" + m.id} style={{ animation: "fr-fade-up .3s ease" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ display: "inline-grid", placeItems: "center", width: 22, height: 22 }}><Dot state={frMachineState(m)} size={9} /></span>
            <span className="fr-eyebrow">{m.kind} · {m.role}</span>
          </div>
          <h2 style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 28, letterSpacing: "-0.02em", margin: "10px 0 0" }}>{m.name}</h2>
          <div style={{ fontSize: 12, color: "var(--fg-3)", fontFamily: "var(--f-mono)", marginTop: 6 }}>{[m.os, m.chip, m.place].filter(Boolean).join(" · ")}</div>

          <FrMiniMeters m={m} />

          {/* machine action chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
            {handlers.onAddAgent ? (
              <button type="button" className="fr-chip fr-chip-honey" data-bee={`fleet-hive-add-${m.name}`} onClick={() => handlers.onAddAgent?.(m)}>
                <ActionIcon icon={Plus} />
                Add agent
              </button>
            ) : null}
            {update?.canUpdate && handlers.onUpdateMachine ? (
              <button type="button" className="fr-chip" disabled={update.busy} onClick={() => handlers.onUpdateMachine?.(m)}>
                <ActionIcon icon={RefreshCcw} />
                {update.label}
              </button>
            ) : null}
            {sync && handlers.onFixSyncIssue ? (
              <button type="button" className="fr-chip" onClick={() => handlers.onFixSyncIssue?.(m)} title={sync.title}>
                <ActionIcon icon={AlertTriangle} />
                Fix sync
              </button>
            ) : null}
            {network?.fixAction && handlers.onFixNetworkIssue ? (
              <button type="button" className="fr-chip" onClick={() => handlers.onFixNetworkIssue?.(m)} title={network.title}>
                <ActionIcon icon={Wrench} />
                {network.fixLabel ?? "Fix network"}
              </button>
            ) : null}
            {handlers.onOpenShell ? (
              <button type="button" className="fr-chip" onClick={() => handlers.onOpenShell?.(m)}>
                <ActionIcon icon={SquareTerminal} />
                Shell
              </button>
            ) : null}
            {handlers.onSendFile ? (
              <button type="button" className="fr-chip" onClick={() => handlers.onSendFile?.(m)}>
                <ActionIcon icon={FileUp} />
                Send file
              </button>
            ) : null}
            {handlers.onOpenUsePodHost ? (
              <button
                type="button"
                className="fr-chip fr-chip-usepod"
                onClick={() => handlers.onOpenUsePodHost?.(m)}
                aria-label={`Rent ${m.name} compute through UsePod`}
              >
                <UsePodActionIcon />
                Rent compute
              </button>
            ) : null}
            {handlers.onRenameMachine ? (
              <button type="button" className="fr-chip" onClick={() => handlers.onRenameMachine?.(m)}>
                <ActionIcon icon={Pencil} />
                Rename
              </button>
            ) : null}
            {handlers.onOpenCodeProof ? (
              <button type="button" className="fr-chip" onClick={() => handlers.onOpenCodeProof?.(m)}>
                <ActionIcon icon={GitBranch} />
                Code proof
              </button>
            ) : null}
          </div>

          {network || networkFixStatus ? (
            <div style={{ display: "flex", gap: 10, marginTop: 12, padding: "10px 12px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", border: "1px solid var(--line-2)" }}>
              <HiveMark size={14} stroke="var(--danger)" dot={false} />
              <span style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.45 }}>
                {networkFixStatus ?? network?.detail ?? network?.title}
              </span>
            </div>
          ) : null}

          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 18 }}>
            <span className="fr-eyebrow">Agents</span>
            <span style={{ fontSize: 11.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>{m.agents.length ? `${m.agents.length} · ${working} working` : "none"}</span>
          </div>
          <div style={{ marginTop: 2 }}>
            {m.agents.length ? (
              m.agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelect({ type: "agent", id: a.id, machineId: m.id })}
                  style={{ width: "100%", textAlign: "left", background: "transparent", border: 0, padding: 0, cursor: "pointer", color: "inherit" }}
                >
                  <FrHivePanelAgent a={a} />
                </button>
              ))
            ) : (
              <div style={{ padding: "20px 0", borderTop: "1px solid var(--line)", fontSize: 12.5, color: "var(--fg-3)" }}>
                Not yet onboarded.
                {handlers.onAddAgent ? (
                  <div style={{ marginTop: 12 }}>
                    <button type="button" className="fr-chip fr-chip-honey" data-bee={`fleet-hive-add-${m.name}`} onClick={() => handlers.onAddAgent?.(m)}>
                      <ActionIcon icon={Plus} />
                      Onboard agent
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <div style={{ marginTop: 22, fontSize: 11, color: "var(--fg-4)", fontFamily: "var(--f-mono)", display: "flex", flexDirection: "column", gap: 5 }}>
            <span>{m.ip}{m.ping ? ` · ${m.ping}ms` : ""}</span>
            <span>{m.uptime ? `up ${m.uptime} · ` : ""}{m.version}</span>
          </div>
        </div>
      );
    }
  } else {
    const m = machines.find((x) => x.id === sel.machineId);
    const a = m?.agents.find((x) => x.id === sel.id);
    if (!m || !a) { body = null; }
    else {
      const meta = frStateMeta(a.state);
      // Gate chat affordances exactly like the legacy surfaces: only chat-capable
      // runtimes (Hermes/OpenClaw, or an explicit canChat) get chat/task-chat.
      const canChat = fleetAgentCanChat(a.source);
      const recentChats = (a.source.recentChats ?? []).filter((chat) => chat.id !== "current");
      body = (
        <div key={"a" + a.id} style={{ animation: "fr-fade-up .3s ease" }}>
          <button
            type="button"
            onClick={() => onSelect({ type: "machine", id: m.id })}
            style={{ display: "flex", alignItems: "center", gap: 7, background: "transparent", border: 0, padding: 0, cursor: "pointer", color: "var(--fg-3)", fontSize: 11.5 }}
          >
            <ActionIcon icon={ChevronLeft} />
            <span className="fr-eyebrow">{m.name}</span>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
            <Dot state={a.state} size={9} />
            <span style={{ fontSize: 12, color: meta.color }}>{meta.label}</span>
          </div>
          <h2 style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 26, letterSpacing: "-0.02em", margin: "10px 0 0", overflowWrap: "anywhere" }}>{a.name}</h2>
          <div style={{ fontSize: 12, color: "var(--fg-3)", fontFamily: "var(--f-mono)", marginTop: 6 }}>{a.runtime} · {a.role}</div>
          {(a.source.provider || a.source.model) ? (
            <div style={{ fontSize: 11.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 4 }}>
              {[a.source.provider, a.source.model].filter(Boolean).join(" · ")}
            </div>
          ) : null}
          <div style={{ marginTop: 18, padding: "14px 16px", borderRadius: "var(--radius-sm)", background: "var(--panel)", border: "1px solid var(--line)", fontSize: 13.5, color: "var(--fg-2)", lineHeight: 1.6 }}>{a.task}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            {a.since ? <span style={{ fontSize: 11.5, color: "var(--fg-3)", fontFamily: "var(--f-mono)", border: "1px solid var(--line-2)", borderRadius: 99, padding: "5px 11px" }}>started {a.since} ago</span> : null}
            {a.wallet !== "—" ? <span style={{ fontSize: 11.5, color: "var(--fg-3)", fontFamily: "var(--f-mono)", border: "1px solid var(--line-2)", borderRadius: 99, padding: "5px 11px" }}>{a.wallet}</span> : null}
          </div>

          {(handlers.onCallAgent || (canChat && handlers.onOpenChat)) ? (
            <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
              {handlers.onCallAgent ? (
                <button type="button" className="fr-act fr-act-primary" onClick={() => handlers.onCallAgent?.(m, a)}>
                  <ActionIcon icon={PhoneCall} />
                  Call agent
                </button>
              ) : null}
              {canChat && handlers.onOpenChat ? (
                <button type="button" className="fr-act" onClick={() => handlers.onOpenChat?.(m, a)}>
                  <ActionIcon icon={MessageSquare} />
                  Open chat
                </button>
              ) : null}
            </div>
          ) : null}

          {/* secondary agent actions */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {canChat && handlers.onOpenTaskChat ? (
              <button type="button" className="fr-chip" onClick={() => handlers.onOpenTaskChat?.(m, a)}>
                <ActionIcon icon={MessageSquare} />
                Task chat
              </button>
            ) : null}
            {handlers.onOpenWallet ? (
              <button type="button" className="fr-chip" onClick={() => handlers.onOpenWallet?.(m, a)}>
                <ActionIcon icon={Wallet} />
                Wallet
              </button>
            ) : null}
            {handlers.onEditSettings ? (
              <button type="button" className="fr-chip" onClick={() => handlers.onEditSettings?.(m, a)}>
                <ActionIcon icon={Settings} />
                Settings
              </button>
            ) : null}
            {handlers.onDuplicate ? (
              <button type="button" className="fr-chip" onClick={() => handlers.onDuplicate?.(m, a)}>
                <ActionIcon icon={Copy} />
                Duplicate
              </button>
            ) : null}
            {handlers.onRemove ? (
              <button type="button" className="fr-chip fr-act-danger" onClick={() => handlers.onRemove?.(m, a)}>
                <ActionIcon icon={Trash2} />
                Remove
              </button>
            ) : null}
          </div>

          <AgentHoldings
            agent={a}
            wallet={walletsByAgent[a.id]}
            onViewWallet={handlers.onOpenWallet ? () => handlers.onOpenWallet?.(m, a) : undefined}
          />

          {canChat && recentChats.length && handlers.onOpenTaskChat ? (
            <div style={{ marginTop: 20 }}>
              <div className="fr-eyebrow" style={{ marginBottom: 6 }}>Resume a chat</div>
              {recentChats.slice(0, 5).map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => handlers.onOpenTaskChat?.(m, a, chat)}
                  style={{ display: "flex", gap: 10, width: "100%", textAlign: "left", background: "transparent", border: 0, borderTop: "1px solid var(--line)", padding: "9px 0", cursor: "pointer", color: "inherit" }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, color: "var(--fg-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{chat.title || chat.task}</span>
                    {chat.since ? <span style={{ display: "block", fontSize: 10.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 2 }}>{chat.since}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      );
    }
  }

  return (
    <aside
      className="fr-scroll"
      style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: 340, zIndex: 8,
        borderLeft: "1px solid var(--line)", background: "color-mix(in srgb, var(--bg-soft) 82%, transparent)",
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        overflowY: "auto", padding: "26px 24px 120px",
      }}
    >
      {body}
    </aside>
  );
}
