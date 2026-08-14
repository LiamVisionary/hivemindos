"use client";

/* HivePanel.tsx — the contextual detail panel on the right. Three modes:
   queen overview, machine detail, agent detail. Every action control is wired to
   a real handler so the Hive view reaches parity with the legacy FleetView. */

import * as React from "react";
import { DeepProbesToggle } from "@/components/fleet/deep-probes-toggle";
import { fleetAgentCanChat, type FleetAgentChat } from "@/components/fleet/fleet-data";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Download,
  ExternalLink,
  Network,
  Pencil,
  Plus,
  RefreshCcw,
  Settings,
  Smartphone,
  X,
  type LucideIcon,
} from "lucide-react";
import { AgentHoldings, HiveFleetEconomyPanel, HiveMachineEconomyPanel } from "./AgentHoldings";
import { HiveAgentActions, HiveChatCallSplitButton, HiveMachineActions } from "./HivePanelActions";
import { buildHiveFleetEconomy } from "./hive-economy";
import { MachineSettingsPanel } from "./MachineSettingsPanel";
import type { HiveAgent, HiveMachine, HiveSelection } from "./fleet-hive-types";
import { frFleetSummary, frMachineState, frStateMeta, hivePhoneStatus, isHiveMobileMachine } from "./fleet-hive-types";
import { Dot, HiveMark, Meter, Summary } from "./primitives";

function ActionIcon({ icon: Icon, size = 13 }: { icon: LucideIcon; size?: number }) {
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />;
}

// Identify the actual Queen Bee agent, mirroring how AgentsPanel resolves it
// (beeRole first, then id/name), so the Queen's "Chat" button targets the Queen
// rather than an arbitrary worker.
function isQueenAgent(a: HiveAgent) {
  return a.source.beeRole === "queen" || /^queen-bee-/i.test(a.source.id) || /queen/i.test(a.name);
}

function firstQueenChatTarget(machines: HiveMachine[]) {
  let workingFallback: { m: HiveMachine; a: HiveAgent } | null = null;
  let anyFallback: { m: HiveMachine; a: HiveAgent } | null = null;
  for (const m of machines) {
    for (const a of m.agents) {
      // The Queen's Chat button must open a chat with the Queen Bee, not the
      // first working worker. Prefer the Queen agent whenever it's present.
      if (isQueenAgent(a)) return { m, a };
      if (!fleetAgentCanChat(a.source)) continue;
      if (a.state === "working") workingFallback ??= { m, a };
      anyFallback ??= { m, a };
    }
  }
  // No Queen agent in the fleet: fall back to a working chat-capable worker, else
  // the first chat-capable one (the pre-existing behaviour).
  return workingFallback ?? anyFallback;
}

export interface HivePanelHandlers {
  onAddAgent?: (m: HiveMachine) => void;
  onAddMachine?: () => void;
  onOpenQueenSettings?: () => void;
  /** Start a voice call with the Queen (opens the Queen voice overlay). */
  onCallQueen?: () => void;
  onUpdateMachine?: (m: HiveMachine) => void;
  onRenameMachine?: (m: HiveMachine, name: string) => void;
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
  onOpenPhonePairing?: () => void;
  /** Resolves the per-machine update action label/state from the live status maps. */
  getMachineUpdate?: (m: HiveMachine) => {
    label: string;
    busy: boolean;
    canUpdate: boolean;
    detail?: string;
    tone: "idle" | "working" | "failed" | "updated";
  } | null;
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

function MachineNameEditor({
  machine,
  onRenameMachine,
}: {
  machine: HiveMachine;
  onRenameMachine?: HivePanelHandlers["onRenameMachine"];
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(machine.name);
  const [machineNameFontSize, setMachineNameFontSize] = React.useState(28);
  const machineNameRowRef = React.useRef<HTMLDivElement>(null);
  const machineNameHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const renameButtonRef = React.useRef<HTMLButtonElement>(null);
  const normalizedDraft = draft.trim();
  const hasRename = Boolean(onRenameMachine);

  React.useLayoutEffect(() => {
    if (editing) return undefined;
    const row = machineNameRowRef.current;
    const heading = machineNameHeadingRef.current;
    if (!row || !heading) return undefined;

    const fitName = () => {
      const renameButtonWidth = renameButtonRef.current?.offsetWidth ?? 0;
      const availableWidth = row.clientWidth - renameButtonWidth - (renameButtonWidth ? 7 : 0);
      const previousFontSize = heading.style.fontSize;
      heading.style.fontSize = "28px";
      const fullSizeWidth = heading.scrollWidth;
      heading.style.fontSize = previousFontSize;
      const nextFontSize = fullSizeWidth > 0
        ? Math.min(28, Math.max(12, (28 * Math.max(0, availableWidth - 1)) / fullSizeWidth))
        : 28;
      setMachineNameFontSize(Math.floor(nextFontSize * 10) / 10);
    };

    fitName();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(fitName);
    observer.observe(row);
    return () => observer.disconnect();
  }, [editing, hasRename, machine.name]);

  const cancelRename = () => {
    setDraft(machine.name);
    setEditing(false);
  };

  const saveRename = () => {
    if (!normalizedDraft) return;
    setEditing(false);
    setDraft(normalizedDraft);
    if (normalizedDraft !== machine.name) {
      onRenameMachine?.(machine, normalizedDraft);
    }
  };

  if (editing) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          saveRename();
        }}
        style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10 }}
      >
        <input
          value={draft}
          autoFocus
          required
          aria-label={`New name for ${machine.name}`}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelRename();
            }
          }}
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            border: "1px solid var(--honey-line)",
            borderRadius: 9,
            background: "var(--panel-2)",
            color: "var(--fg)",
            fontFamily: "var(--f-display)",
            fontSize: 19,
            fontWeight: 600,
            letterSpacing: "-0.015em",
            padding: "5px 8px",
          }}
        />
        <button
          type="submit"
          aria-label={`Save ${machine.name} rename`}
          title="Save machine name"
          disabled={!normalizedDraft}
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 30,
            height: 30,
            flex: "0 0 auto",
            border: "1px solid var(--honey-line)",
            borderRadius: 8,
            background: "var(--honey-soft)",
            color: "var(--honey)",
            cursor: normalizedDraft ? "pointer" : "default",
            opacity: normalizedDraft ? 1 : 0.55,
          }}
        >
          <Check size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Cancel renaming ${machine.name}`}
          title="Cancel rename"
          onClick={cancelRename}
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 30,
            height: 30,
            flex: "0 0 auto",
            border: "1px solid var(--line-2)",
            borderRadius: 8,
            background: "transparent",
            color: "var(--fg-3)",
            cursor: "pointer",
          }}
        >
          <X size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </form>
    );
  }

  return (
    <div ref={machineNameRowRef} style={{ display: "flex", alignItems: "center", width: "100%", minWidth: 0, gap: 7, marginTop: 10 }}>
      <h2 ref={machineNameHeadingRef} style={{ flex: "0 1 auto", minWidth: 0, fontFamily: "var(--f-display)", fontWeight: 600, fontSize: machineNameFontSize, lineHeight: 1.15, letterSpacing: "-0.02em", whiteSpace: "nowrap", margin: 0 }}>{machine.name}</h2>
      {onRenameMachine ? (
        <button
          ref={renameButtonRef}
          type="button"
          aria-label={`Rename ${machine.name}`}
          title="Rename machine"
          onClick={() => {
            setDraft(machine.name);
            setEditing(true);
          }}
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 28,
            height: 28,
            flex: "0 0 auto",
            border: 0,
            borderRadius: 8,
            background: "transparent",
            color: "var(--fg-3)",
            cursor: "pointer",
          }}
        >
          <Pencil size={15} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function FrPhoneStatusRow({ label, value, tone = "var(--fg-2)" }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "grid", gap: 4, padding: "11px 0", borderTop: "1px solid var(--line)" }}>
      <span className="fr-eyebrow">{label}</span>
      <span style={{ color: tone, fontSize: 12.5, lineHeight: 1.45 }}>{value}</span>
    </div>
  );
}

export function HivePanel({
  machines,
  sel,
  onSelect,
  handlers = {},
  queenName,
  walletsByAgent = {},
  tailnetLabel = "",
}: {
  machines: HiveMachine[];
  sel: HiveSelection;
  onSelect: (s: HiveSelection) => void;
  handlers?: HivePanelHandlers;
  queenName: string;
  walletsByAgent?: Record<string, AgentWalletConfig>;
  tailnetLabel?: string;
}) {
  const s = frFleetSummary(machines);
  const economy = React.useMemo(
    () => buildHiveFleetEconomy(machines, walletsByAgent),
    [machines, walletsByAgent],
  );
  const [settingsMachineId, setSettingsMachineId] = React.useState<string | null>(null);
  let body: React.ReactNode;
  const renderPhoneBody = (selectedMobileMachine?: HiveMachine) => {
    const phone = hivePhoneStatus(machines, tailnetLabel);
    const phoneTone =
      phone.state === "connected" ? "var(--live)" : phone.state === "tailnet-issue" ? "var(--honey)" : "var(--fg-3)";
    const pairingStatus = phone.dashboardTailnetReady
      ? "Ready after your phone joins the same Tailnet."
      : "Waiting for this dashboard to have a reachable Tailscale address.";
    return (
      <div key={selectedMobileMachine ? `phone-${selectedMobileMachine.id}` : "phone"} style={{ animation: "fr-fade-up .3s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ display: "inline-grid", placeItems: "center", width: 24, height: 24, color: phoneTone }}>
            <Smartphone size={19} aria-hidden="true" />
          </span>
          <span className="fr-eyebrow">Phone · HivemindOS Mobile</span>
        </div>
        <h2 style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 28, letterSpacing: "-0.02em", margin: "10px 0 0" }}>
          {selectedMobileMachine?.name ?? "Your phone"}
        </h2>
        <p style={{ fontSize: 13, color: "var(--fg-3)", lineHeight: 1.55, margin: "10px 0 0" }}>
          Pair a phone so mobile agents, approvals, and calls can reach this HivemindOS hub over your private Tailnet.
        </p>

        <div style={{ marginTop: 20 }}>
          <FrPhoneStatusRow label="Phone Tailnet" value={phone.phoneStatus} tone={phoneTone} />
          <FrPhoneStatusRow label="Dashboard Tailnet" value={phone.dashboardStatus} />
          <FrPhoneStatusRow label="Pairing" value={pairingStatus} />
        </div>

        {phone.mobileMachines.length ? (
          <div style={{ marginTop: 18 }}>
            <div className="fr-eyebrow" style={{ marginBottom: 6 }}>Detected mobile peers</div>
            {phone.mobileMachines.map((machine) => (
              <button
                key={machine.id}
                type="button"
                onClick={() => onSelect({ type: "machine", id: machine.id })}
                style={{ display: "grid", gap: 3, width: "100%", textAlign: "left", background: "transparent", border: 0, borderTop: "1px solid var(--line)", padding: "10px 0", cursor: "pointer", color: "inherit" }}
              >
                <span style={{ color: "var(--fg)", fontSize: 13, fontWeight: 500 }}>{machine.name}</span>
                <span style={{ color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 11, lineHeight: 1.35 }}>{[machine.os, machine.uptime, machine.ip].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div style={{ marginTop: 22, padding: "14px 16px", borderRadius: "var(--radius-sm)", background: "var(--panel)", border: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fg)", fontSize: 13, fontWeight: 600 }}>
            <Download size={15} aria-hidden="true" />
            Download and connect
          </div>
          <ol style={{ display: "grid", gap: 10, margin: "12px 0 0", paddingLeft: 18, color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.5 }}>
            <li>
              Install Tailscale on iOS or Android from{" "}
              <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" style={{ color: "var(--honey)", textDecoration: "none" }}>
                tailscale.com/download <ExternalLink size={11} aria-hidden="true" style={{ verticalAlign: "-1px" }} />
              </a>.
            </li>
            <li>Sign in to the same Tailnet this dashboard uses, then leave Tailscale connected.</li>
            <li>Install or open HivemindOS Mobile and go to Settings, then Connection.</li>
          </ol>
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
          <div style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: "var(--radius-sm)", background: "var(--honey-soft)", border: "1px solid var(--honey-line)" }}>
            <Network size={15} aria-hidden="true" style={{ flex: "0 0 auto", marginTop: 2, color: "var(--honey)" }} />
            <span style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.45 }}>
              Once connected to Tailscale, you can pair your phone below.
            </span>
          </div>
          <button type="button" className="fr-act fr-act-primary" onClick={() => handlers.onOpenPhonePairing?.()}>
            <ActionIcon icon={Smartphone} size={14} />
            Open phone pairing
          </button>
        </div>
      </div>
    );
  };

  if (sel.type === "queen") {
    const workingList: { a: HiveAgent; m: HiveMachine }[] = [];
    machines.forEach((m) => m.agents.forEach((a) => { if (a.state === "working") workingList.push({ a, m }); }));
    const queenChatTarget = handlers.onOpenChat ? firstQueenChatTarget(machines) : null;
    const attention = (() => {
      for (const m of machines) {
        const a = m.agents.find((x) => x.state === "failed") ?? m.agents.find((x) => x.state === "setup");
        if (a) return { agent: a.name, machine: m.name, text: a.task, setupMachine: undefined as HiveMachine | undefined };
        if (m.versionState === "needs-setup") return { agent: "", machine: m.name, text: "Machine needs setup before agents can run.", setupMachine: m };
      }
      return null;
    })();
    body = (
      <div key="queen" style={{ animation: "fr-fade-up .3s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="fr-eyebrow" style={{ color: "var(--honey)" }}>{queenName}</span>
          <span className="fr-eyebrow">Queen · orchestrator</span>
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

        {(queenChatTarget || handlers.onCallQueen || handlers.onOpenQueenSettings || handlers.onAddMachine) ? (
          <div className="fr-queen-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
            {queenChatTarget ? (
              <HiveChatCallSplitButton
                name={queenName}
                callLabel="Call"
                onChat={() => handlers.onOpenChat?.(queenChatTarget.m, queenChatTarget.a)}
                onCall={handlers.onCallQueen ? () => handlers.onCallQueen?.() : undefined}
              />
            ) : handlers.onCallQueen ? (
              <HiveChatCallSplitButton
                name={queenName}
                callLabel="Call"
                onCall={() => handlers.onCallQueen?.()}
              />
            ) : null}
            {handlers.onOpenQueenSettings ? (
              <button type="button" className="fr-act" onClick={() => handlers.onOpenQueenSettings?.()}>
                <ActionIcon icon={Settings} size={14} />
                {queenName} settings
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

        <HiveFleetEconomyPanel economy={economy} />

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

        {attention ? (() => {
          const attnStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginTop: 22, padding: "12px 14px", borderRadius: "var(--radius-sm)", background: "var(--honey-soft)", border: "1px solid var(--honey-line)" };
          const inner = (
            <>
              <HiveMark size={16} stroke="var(--honey)" />
              <span style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.45 }}>{attention.agent ? `${attention.agent} on ${attention.machine} — ` : `${attention.machine} — `}{attention.text}</span>
            </>
          );
          // A needs-setup machine: make the banner a real button that opens the
          // setup wizard (onAddAgent -> openAgentCreationModal routes a self
          // desktop machine through the rerun event that clears the stale
          // nativeFirstRun dismiss flag and opens onboarding). Without this the
          // pill is dead text and users have no obvious way to reach setup.
          if (attention.setupMachine && handlers.onAddAgent) {
            const setupMachine = attention.setupMachine;
            return (
              <button type="button" onClick={() => handlers.onAddAgent?.(setupMachine)} style={{ ...attnStyle, width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
                {inner}
              </button>
            );
          }
          return <div style={attnStyle}>{inner}</div>;
        })() : null}

        <div className="fr-eyebrow" style={{ marginTop: 24, marginBottom: 8 }}>Health watchdog</div>
        <DeepProbesToggle variant="hive" />
      </div>
    );
  } else if (sel.type === "phone") {
    body = renderPhoneBody();
  } else if (sel.type === "machine") {
    const m = machines.find((x) => x.id === sel.id);
    if (!m) { body = null; }
    else if (isHiveMobileMachine(m)) { body = renderPhoneBody(m); }
    else if (settingsMachineId === m.id) {
      body = <MachineSettingsPanel key={m.id} machine={m} onClose={() => setSettingsMachineId(null)} />;
    }
    else {
      const working = m.agents.filter((a) => a.state === "working").length;
      const machineEconomy = economy.machines.find((candidate) => candidate.machineId === m.id);
      const update = handlers.getMachineUpdate?.(m) ?? null;
      const network = m.source.networkIssue;
      const networkFixStatus = handlers.getNetworkFixStatus?.(m) ?? null;
      body = (
        <div key={"m" + m.id} style={{ animation: "fr-fade-up .3s ease" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ display: "inline-grid", placeItems: "center", width: 22, height: 22 }}><Dot state={frMachineState(m)} size={9} /></span>
            <span className="fr-eyebrow">{m.kind} · {m.role}</span>
          </div>
          <MachineNameEditor key={m.id} machine={m} onRenameMachine={handlers.onRenameMachine} />
          <div style={{ fontSize: 12, color: "var(--fg-3)", fontFamily: "var(--f-mono)", marginTop: 6 }}>{[m.os, m.chip, m.place].filter(Boolean).join(" · ")}</div>

          <FrMiniMeters m={m} />

          <HiveMachineActions
            machine={m}
            update={update}
            onAddAgent={handlers.onAddAgent}
            onOpenSettings={m.source.collectorUrl ? () => setSettingsMachineId(m.id) : undefined}
            onUpdateMachine={handlers.onUpdateMachine}
            onFixSyncIssue={handlers.onFixSyncIssue}
            onFixNetworkIssue={handlers.onFixNetworkIssue}
            onOpenShell={handlers.onOpenShell}
            onSendFile={handlers.onSendFile}
            onOpenCompute={handlers.onOpenUsePodHost}
            onOpenCodeProof={handlers.onOpenCodeProof}
          />

          {update?.detail ? (
            <div
              role="status"
              aria-live="polite"
              style={{
                display: "flex",
                gap: 10,
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: "var(--radius-sm)",
                background: update.tone === "failed" ? "var(--danger-soft)" : "var(--honey-soft)",
                border: "1px solid var(--line-2)",
              }}
            >
              <ActionIcon icon={update.tone === "failed" ? AlertTriangle : RefreshCcw} size={14} />
              <span style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                {update.detail}
              </span>
            </div>
          ) : null}

          {network || networkFixStatus ? (
            <div style={{ display: "flex", gap: 10, marginTop: 12, padding: "10px 12px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", border: "1px solid var(--line-2)" }}>
              <HiveMark size={14} stroke="var(--danger)" dot={false} />
              <span style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.45 }}>
                {networkFixStatus ?? network?.detail ?? network?.title}
              </span>
            </div>
          ) : null}

          {machineEconomy ? <HiveMachineEconomyPanel economy={machineEconomy} /> : null}

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
      const agentEconomy = economy.machines
        .find((candidate) => candidate.machineId === m.id)
        ?.agents.find((candidate) => candidate.agentId === a.id);
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
          <div className="fr-agent-task" style={{ marginTop: 18, padding: "14px 16px", borderRadius: "var(--radius-sm)", background: "var(--panel)", border: "1px solid var(--line)", fontSize: 13.5, color: "var(--fg-2)", lineHeight: 1.6 }}>{a.task}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            {a.since ? <span style={{ fontSize: 11.5, color: "var(--fg-3)", fontFamily: "var(--f-mono)", border: "1px solid var(--line-2)", borderRadius: 99, padding: "5px 11px" }}>started {a.since} ago</span> : null}
            {a.wallet !== "—" ? <span style={{ fontSize: 11.5, color: "var(--fg-3)", fontFamily: "var(--f-mono)", border: "1px solid var(--line-2)", borderRadius: 99, padding: "5px 11px" }}>{a.wallet}</span> : null}
          </div>

          <HiveAgentActions
            machine={m}
            agent={a}
            canChat={canChat}
            onOpenChat={handlers.onOpenChat}
            onCallAgent={handlers.onCallAgent}
            onOpenTaskChat={handlers.onOpenTaskChat}
            onOpenWallet={handlers.onOpenWallet}
            onEditSettings={handlers.onEditSettings}
            onDuplicate={handlers.onDuplicate}
            onRemove={handlers.onRemove}
          />

          {agentEconomy ? (
            <AgentHoldings
              economy={agentEconomy}
              onViewWallet={handlers.onOpenWallet ? () => handlers.onOpenWallet?.(m, a) : undefined}
            />
          ) : null}

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
