// src/components/fleet/roster.tsx
// Compact machine cards for the fleet side rail. Per-agent rows and actions
// live on the graph cells' selection tooltips; the roster focuses on the
// machine itself: health bars, specs, agent counts, and hosted apps.
"use client";

import Image from "next/image";
import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, GitBranch, LoaderCircle, Monitor, Pencil, Plus, PlugZap, Smartphone } from "lucide-react";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HexTile } from "./hex-tile";
import { isFleetMachineMobile, type FleetActiveApp, type FleetMachine } from "./fleet-data";
import { machineConnectedApps, type FleetHostedApp } from "./active-apps";
import styles from "./fleet-tokens.module.css";

export type { AeonDeleteDepth, AeonDeleteProgress, AeonDeleteResult, AeonDeleteStep, AeonDeleteStepStatus } from "./aeon-delete-modal";

const USEPOD_RUNTIME_ICON_PATH = "/icons/runtimes/usepod.webp";
const MAX_APP_BADGES = 8;

export type MachineUpdateButtonStatus = "idle" | "updating" | "updated" | "failed";
export type MachineUpdateButtonDetail = {
  label?: string;
  detail?: string;
};

function perfTone(pct: number) {
  if (pct >= 85) return "var(--danger)";
  if (pct >= 65) return "#fde68a";
  return "var(--accent-strong)";
}

function PerfBar({ label, pct, detail }: { label: string; pct?: number | null; detail?: string }) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className={styles.rosterPerfRow} role="meter" aria-label={`${label} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped}>
      <span className={styles.rosterPerfLabel}>{label}</span>
      <span className={styles.rosterPerfTrack}>
        <span
          className={styles.rosterPerfFill}
          style={{ width: `${clamped}%`, background: perfTone(clamped) }}
        />
      </span>
      <span className={styles.rosterPerfValue} style={{ color: perfTone(clamped) }}>
        {detail ?? `${clamped}%`}
      </span>
    </div>
  );
}

function ConnectedAppBadge({ app }: { app: FleetActiveApp }) {
  const [broken, setBroken] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={styles.rosterAppBadge}>
          {/* Initials sit underneath so a slow or unreachable icon URL never leaves a blank badge. */}
          <span>{app.initials || app.name.slice(0, 2).toUpperCase()}</span>
          {app.iconUrl && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element -- collector-served icon URLs are not statically optimizable
            <img
              src={app.iconUrl}
              alt=""
              style={{ opacity: loaded ? 1 : 0 }}
              onError={() => setBroken(true)}
              onLoad={(event) => {
                if (event.currentTarget.naturalWidth) setLoaded(true);
                else setBroken(true);
              }}
            />
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent>{app.name}</TooltipContent>
    </Tooltip>
  );
}

interface RosterRowProps {
  machine: FleetMachine;
  selected: boolean;
  connectedApps: FleetActiveApp[];
  updateStatus?: MachineUpdateButtonStatus;
  updateDetail?: MachineUpdateButtonDetail;
  onSelectMachine: () => void;
  onAddAgent: () => void;
  onOpenUsePodHost?: () => void;
  onOpenCodeProof?: () => void;
  onUpdateMachine?: () => void;
  onRenameMachine?: (name: string) => void;
  onOpenNetworkIssue?: () => void;
  onFixSyncIssue?: () => void | Promise<void>;
}

function RosterRow({
  machine, selected, connectedApps,
  updateStatus,
  updateDetail,
  onSelectMachine, onAddAgent,
  onOpenUsePodHost,
  onOpenCodeProof,
  onUpdateMachine,
  onRenameMachine,
  onOpenNetworkIssue,
  onFixSyncIssue,
}: RosterRowProps) {
  const [successDismissed, setSuccessDismissed] = React.useState(false);
  const [syncFixState, setSyncFixState] = React.useState<{
    status: "idle" | "running" | "done" | "failed";
    message: string;
  }>({ status: "idle", message: "" });
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(machine.name);

  React.useEffect(() => {
    if (updateStatus !== "updated") return;
    const timeout = window.setTimeout(() => setSuccessDismissed(true), 3000);
    return () => window.clearTimeout(timeout);
  }, [updateStatus]);

  React.useEffect(() => {
    if (syncFixState.status !== "done") return;
    const timeout = window.setTimeout(() => setSyncFixState({ status: "idle", message: "" }), 12000);
    return () => window.clearTimeout(timeout);
  }, [syncFixState.status]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setSyncFixState({ status: "idle", message: "" }), 0);
    return () => window.clearTimeout(timeout);
  }, [machine.syncIssue?.deviceID]);

  React.useEffect(() => {
    if (editingName) return;
    const timeout = window.setTimeout(() => setNameDraft(machine.name), 0);
    return () => window.clearTimeout(timeout);
  }, [editingName, machine.name]);

  const commitName = () => {
    setEditingName(false);
    onRenameMachine?.(nameDraft);
  };

  const showUpdateButton = Boolean(
    onUpdateMachine
      && (
	        updateStatus === "updating"
	        || (updateStatus === "updated" && !successDismissed)
	        || updateStatus === "failed"
	        || (machine.versionState === "stale" && updateStatus !== "updated")
	        || machine.canUpdate === true
	      ),
	  );
  const updateDisabled = updateStatus === "updating" || updateStatus === "updated";
  const syncFixRunning = syncFixState.status === "running";
  const syncFixButtonLabel = syncFixRunning
    ? "Fixing sync..."
    : syncFixState.status === "done"
      ? "Sync repair sent"
      : syncFixState.status === "failed"
        ? "Sync fix failed"
        : machine.syncIssue?.label ?? "Sync error. Fix?";
  const syncFixTooltip = [syncFixState.message, machine.syncIssue?.detail].filter(Boolean).join("\n\n");
  const runSyncFix = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!onFixSyncIssue || syncFixRunning) return;
    setSyncFixState({ status: "running", message: "" });
    try {
      await onFixSyncIssue();
      setSyncFixState({ status: "done", message: "Repair request sent. Fleet will refresh the sync state shortly." });
    } catch (error) {
      setSyncFixState({
        status: "failed",
        message: error instanceof Error ? error.message : "Syncthing repair failed.",
      });
    }
  };
  const MachineIcon = isFleetMachineMobile(machine) ? Smartphone : Monitor;
  const codeNode = machine.gitlawb;
  const codeNodeLabel = codeNode?.healthy
    ? "Code node"
    : codeNode?.enabled
      ? "Code node offline"
      : codeNode
        ? "Code proof"
        : "";
  const codeNodeTitle = [
    onOpenCodeProof ? "Open Code Proof setup" : "",
    codeNode?.nodeUrl,
    codeNode?.repoCount !== undefined ? `${codeNode.repoCount} repo${codeNode.repoCount === 1 ? "" : "s"}` : "",
    codeNode?.peerCount !== undefined ? `${codeNode.peerCount} peer${codeNode.peerCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
  const codeNodeStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    width: "fit-content",
    maxWidth: "100%",
    border: `1px solid ${codeNode?.healthy ? "rgba(94,234,212,0.38)" : "rgba(148,163,184,0.22)"}`,
    borderRadius: 7,
    background: codeNode?.healthy ? "rgba(45,212,191,0.12)" : "rgba(148,163,184,0.10)",
    color: codeNode?.healthy ? "var(--accent-strong)" : "var(--muted)",
    padding: "4px 7px",
    fontFamily: "var(--f-mono)",
    fontSize: 9.5,
    fontWeight: 800,
  };

  const system = machine.system;
  const workingAgents = machine.agents.filter((agent) => agent.state === "working").length;
  const specsLine = system
    ? [
        system.cpuModel,
        system.cpuCores ? `${system.cpuCores} cores` : "",
        system.ramTotalGb ? `${Math.round(system.ramTotalGb)} GB RAM` : "",
        typeof system.diskPct === "number" ? `disk ${Math.round(system.diskPct)}%` : "",
      ].filter(Boolean).join(" · ")
    : "";
  const ramDetail = system && typeof system.ramPct === "number" && system.ramUsedGb && system.ramTotalGb
    ? `${Math.round(system.ramPct)}% · ${system.ramUsedGb.toFixed(0)}/${Math.round(system.ramTotalGb)} GB`
    : undefined;
  const visibleApps = connectedApps.slice(0, MAX_APP_BADGES);
  const overflowApps = connectedApps.length - visibleApps.length;

  return (
    <div
      className="rounded-lg overflow-hidden relative"
      style={{
        border: `1px solid ${selected ? "rgba(255,212,90,0.42)" : "rgba(148,163,184,0.16)"}`,
        background: selected ? "rgba(255,212,90,0.10)" : "transparent",
      }}
    >
      <div
        onClick={onSelectMachine}
        className={`${styles.rosterMachineRow} cursor-pointer`}
        style={{
          color: selected ? "var(--hex-honey-border)" : "var(--foreground)",
        }}
      >
        <HexTile className={styles.rosterHexTile} size={22} tone={selected ? "honey" : "default"} surface="flat">
          <MachineIcon
            aria-hidden="true"
            size={13}
            style={{
              color: selected ? "var(--hex-honey-border)" : "var(--muted)",
            }}
          />
        </HexTile>
        <div className={styles.rosterMachineBody}>
          <div className={styles.rosterMachineSummary}>
            <div className={styles.rosterMachineIdentity}>
              <div className={`${styles.rosterMachineName} flex items-center gap-1.5`}>
                {editingName ? (
                  <input
                    value={nameDraft}
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onBlur={commitName}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitName();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setNameDraft(machine.name);
                        setEditingName(false);
                      }
                    }}
                    aria-label={`Rename ${machine.name}`}
                    style={{
                      width: "100%",
                      minWidth: 0,
                      border: "1px solid rgba(94,234,212,0.46)",
                      borderRadius: 6,
                      background: "rgba(2,6,23,0.72)",
                      color: "var(--foreground)",
                      font: "inherit",
                      letterSpacing: 0,
                      padding: "2px 5px",
                      outline: "none",
                    }}
                  />
                ) : (
                  <>
                    <span>{machine.name}</span>
                    {onRenameMachine ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Rename ${machine.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setNameDraft(machine.name);
                              setEditingName(true);
                            }}
                            style={{
                              width: 20,
                              height: 20,
                              display: "inline-grid",
                              placeItems: "center",
                              border: 0,
                              borderRadius: 6,
                              background: "transparent",
                              color: "var(--muted)",
                              cursor: "pointer",
                              flex: "0 0 auto",
                            }}
                          >
                            <Pencil size={11} aria-hidden="true" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Rename machine</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </>
                )}
              </div>
              <div className={styles.rosterMachineMeta}>
                {machine.kind} · {machine.city}
              </div>
            </div>
            {showUpdateButton ? (
            <div className={styles.rosterMachineStatus}>
                <Tooltip>
                  <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!updateDisabled) {
                      setSuccessDismissed(false);
                      onUpdateMachine?.();
                    }
                  }}
                  disabled={updateDisabled}
                  aria-label={
                    updateStatus === "updating"
                      ? `Updating ${machine.name}`
                      : updateStatus === "updated"
                        ? `${machine.name} updated`
                        : updateStatus === "failed"
                          ? `${updateDetail?.label ?? `Update failed for ${machine.name}`}. Retry update`
                          : `Update ${machine.name}`
                  }
                  title={updateDetail?.detail}
                  aria-live="polite"
                  className={`${styles.rosterUpdateButton} inline-flex items-center justify-center`}
                  style={{
                    minWidth: updateStatus === "updated" ? 70 : 62,
                    minHeight: 24,
                    padding: "4px 8px",
                    borderRadius: 7,
                    border: updateStatus === "failed"
                      ? "1px solid rgba(251,113,133,0.46)"
                      : updateStatus === "updated"
                        ? "1px solid rgba(94,234,212,0.54)"
                        : "1px solid rgba(255,212,90,0.46)",
                    background: updateStatus === "failed"
                      ? "rgba(251,113,133,0.14)"
                      : updateStatus === "updated"
                        ? "rgba(45,212,191,0.16)"
                        : "rgba(255,212,90,0.14)",
                    color: updateStatus === "failed"
                      ? "#fecdd3"
                      : updateStatus === "updated"
                        ? "var(--accent-strong)"
                        : "var(--hex-honey-border)",
                    fontFamily: "var(--f-mono)",
                    fontSize: 9.5,
                    fontWeight: 800,
                    letterSpacing: 0,
                    cursor: updateDisabled ? "default" : "pointer",
                  }}
                >
                  {updateStatus === "updating" ? (
                    <span className="inline-flex items-center" style={{ gap: 5 }}>
                      <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
                      Updating...
                    </span>
                  ) : updateStatus === "updated" ? (
                    "Updated!"
                  ) : updateStatus === "failed" ? (
                    "Failed"
                  ) : (
                    "Update"
                  )}
                </button>
                  </TooltipTrigger>
                  {updateDetail?.detail ? (
                    <TooltipContent side="top" style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>
                      {updateDetail.detail}
                    </TooltipContent>
                  ) : null}
                </Tooltip>
            </div>
            ) : null}
          </div>
          {updateStatus === "updating" ? (
            <div
              role="status"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 9.5,
                color: "var(--muted)",
              }}
            >
              Fleet graph will refresh after update.
            </div>
          ) : null}
          {machine.networkIssue ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenNetworkIssue?.();
              }}
              className={styles.rosterNetworkIssue}
              style={{
                border: "1px solid rgba(251,191,36,0.42)",
                background: "rgba(251,191,36,0.12)",
                color: "#fde68a",
                cursor: "pointer",
              }}
            >
              <AlertTriangle size={10} aria-hidden="true" />
              <span>{machine.networkIssue.label}</span>
            </button>
          ) : null}
          {machine.syncIssue ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => void runSyncFix(event)}
                  disabled={syncFixRunning}
                  className={styles.rosterNetworkIssue}
                  style={{
                    border: syncFixState.status === "done"
                      ? "1px solid rgba(94,234,212,0.46)"
                      : "1px solid rgba(251,113,133,0.46)",
                    background: syncFixState.status === "done"
                      ? "rgba(45,212,191,0.13)"
                      : "rgba(251,113,133,0.13)",
                    color: syncFixState.status === "done" ? "var(--accent-strong)" : "#fecdd3",
                    cursor: syncFixRunning ? "wait" : onFixSyncIssue ? "pointer" : "default",
                    opacity: syncFixRunning ? 0.72 : 1,
                  }}
                >
                  {syncFixRunning ? <LoaderCircle size={10} className="animate-spin" aria-hidden="true" /> : <AlertTriangle size={10} aria-hidden="true" />}
                  <span>{syncFixButtonLabel}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>
                {syncFixTooltip}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {codeNodeLabel ? (
            onOpenCodeProof ? (
              <button
                type="button"
                title={codeNodeTitle}
                aria-label={`Open Code Proof setup for ${machine.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenCodeProof();
                }}
                style={{ ...codeNodeStyle, cursor: "pointer" }}
              >
                <GitBranch size={10} aria-hidden="true" />
                <span>{codeNodeLabel}</span>
              </button>
            ) : (
              <span title={codeNodeTitle} style={codeNodeStyle}>
                <GitBranch size={10} aria-hidden="true" />
                <span>{codeNodeLabel}</span>
              </span>
            )
          ) : null}
          {selected && onOpenUsePodHost ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenUsePodHost();
                  }}
                  className={styles.rosterUsePodHostButton}
                  aria-label={`Rent ${machine.name} compute through UsePod`}
                >
                  <Image src={USEPOD_RUNTIME_ICON_PATH} alt="" aria-hidden="true" width={15} height={15} unoptimized />
                  <span>Rent compute</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Run usepod-agent on this machine</TooltipContent>
            </Tooltip>
          ) : null}

          {system ? (
            <div className={styles.rosterPerfSection}>
              <PerfBar label="CPU" pct={system.cpuPct} />
              <PerfBar label="RAM" pct={system.ramPct} detail={ramDetail} />
              {specsLine ? <div className={styles.rosterSpecsLine}>{specsLine}</div> : null}
            </div>
          ) : null}

          <div className={styles.rosterAgentsLine}>
            <span className={styles.rosterSpecsLine} style={{ color: selected ? "var(--hex-honey-border)" : "var(--muted)" }}>
              {machine.agents.length === 0
                ? "no agents yet"
                : `${machine.agents.length} agent${machine.agents.length === 1 ? "" : "s"}${workingAgents > 0 ? ` · ${workingAgents} working` : ""}`}
            </span>
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onAddAgent(); }}
              className={`${styles.rosterAddAgentRow} ${styles.rosterAddAgentPill}`}
              aria-label={`Add agent to ${machine.name}`}
            >
              <Plus size={11} aria-hidden="true" />
              <span>{machine.agents.length === 0 ? "Add first agent" : "Add agent"}</span>
            </button>
          </div>

          {visibleApps.length > 0 ? (
            <div className={styles.rosterAppsRow} aria-label={`Connected apps on ${machine.name}`}>
              {visibleApps.map((app) => (
                <ConnectedAppBadge key={app.id} app={app} />
              ))}
              {overflowApps > 0 ? (
                <span className={styles.rosterAppBadge} title={`${overflowApps} more app${overflowApps === 1 ? "" : "s"}`}>
                  <span>+{overflowApps}</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface RosterProps {
  machines: FleetMachine[];
  selected: string;
  hostedApps?: FleetHostedApp[];
  updateStatusByMachine?: Record<string, MachineUpdateButtonStatus>;
  updateDetailByMachine?: Record<string, MachineUpdateButtonDetail>;
  onSelectMachine: (id: string) => void;
  onAddAgent: (m: FleetMachine) => void;
  onUpdateMachine?: (m: FleetMachine) => void;
  onRenameMachine?: (machineId: string, name: string) => void;
  onOpenCodeProof?: (m: FleetMachine) => void;
  onFixSyncIssue?: (m: FleetMachine) => void | Promise<void>;
  onOpenUsePodHost?: (m: FleetMachine) => void;
}

export function Roster({
  machines, selected,
  hostedApps,
  updateStatusByMachine,
  updateDetailByMachine,
  onSelectMachine, onAddAgent,
  onUpdateMachine,
  onRenameMachine,
  onOpenCodeProof,
  onFixSyncIssue,
  onOpenUsePodHost,
}: RosterProps) {
  const [activeIssueMachine, setActiveIssueMachine] = React.useState<FleetMachine | null>(null);
  const [issueFixState, setIssueFixState] = React.useState<{
    key: string;
    status: "idle" | "running" | "done" | "failed";
    message: string;
  }>({ key: "", status: "idle", message: "" });
  const activeIssue = activeIssueMachine?.networkIssue;
  const activeIssueKey = activeIssueMachine && activeIssue?.fixAction ? `${activeIssueMachine.id}:${activeIssue.fixAction}` : "";
  const issueFixStatus = issueFixState.key === activeIssueKey ? issueFixState.status : "idle";
  const issueFixMessage = issueFixState.key === activeIssueKey ? issueFixState.message : "";
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const connectedAppsByMachine = React.useMemo(() => {
    const apps = hostedApps ?? [];
    return new Map(machines.map((machine) => [machine.id, apps.length ? machineConnectedApps(machine, apps) : []]));
  }, [hostedApps, machines]);
  const runIssueFix = React.useCallback(async () => {
    const fixAction = activeIssue?.fixAction;
    const fixKey = activeIssueKey;
    if (!fixAction || !fixKey) return;
    setIssueFixState({ key: fixKey, status: "running", message: "" });
    const response = await fetch("/api/tailscale/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: fixAction }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string; message?: string } | null;
    if (!response?.ok || data?.ok === false) {
      setIssueFixState({
        key: fixKey,
        status: "failed",
        message: data?.error || "The automatic repair did not finish.",
      });
      return;
    }
    setIssueFixState({
      key: fixKey,
      status: "done",
      message: data?.message || "Repair started. Give Tailscale a few seconds, then refresh Fleet.",
    });
  }, [activeIssue, activeIssueKey]);
  return (
    <div className="grid gap-1.5">
      {machines.map((m) => (
        <RosterRow
          key={m.id}
          machine={m}
          selected={m.id === selected}
          connectedApps={connectedAppsByMachine.get(m.id) ?? []}
          updateStatus={updateStatusByMachine?.[m.id]}
          updateDetail={updateDetailByMachine?.[m.id]}
          onSelectMachine={() => onSelectMachine(m.id)}
          onAddAgent={() => onAddAgent(m)}
          onOpenUsePodHost={onOpenUsePodHost ? () => onOpenUsePodHost(m) : undefined}
          onOpenCodeProof={onOpenCodeProof ? () => onOpenCodeProof(m) : undefined}
          onUpdateMachine={onUpdateMachine ? () => onUpdateMachine(m) : undefined}
          onRenameMachine={onRenameMachine ? (name) => onRenameMachine(m.id, name) : undefined}
          onOpenNetworkIssue={m.networkIssue ? () => setActiveIssueMachine(m) : undefined}
          onFixSyncIssue={m.syncIssue && onFixSyncIssue ? () => onFixSyncIssue(m) : undefined}
        />
      ))}
      {activeIssue && portalTarget ? createPortal((
        <div
          role="presentation"
          onClick={() => setActiveIssueMachine(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(2,6,23,0.72)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={activeIssue.title}
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(560px, 100%)",
              borderRadius: 8,
              border: "1px solid rgba(148,163,184,0.22)",
              background: "rgba(15,23,42,0.98)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.44)",
              color: "var(--foreground)",
              padding: 18,
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className={styles.monoCap} style={{ color: "#fde68a", marginBottom: 8 }}>
                  {activeIssueMachine?.name}
                </div>
                <h3 style={{ fontFamily: "var(--f-display)", fontSize: 20, margin: 0 }}>
                  {activeIssue.title}
                </h3>
              </div>
              <CloseIconButton
                type="button"
                aria-label="Close"
                onClick={() => setActiveIssueMachine(null)}
                className="grid place-items-center"
                style={{
                  border: "1px solid rgba(148,163,184,0.22)",
                  background: "rgba(15,23,42,0.78)",
                  color: "var(--muted)",
                  cursor: "pointer",
                }}
              />
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.55, margin: "12px 0 14px" }}>
              {activeIssue.detail}
            </p>
            {activeIssue.fixAction ? (
              <>
                <button
                  type="button"
                  onClick={() => void runIssueFix()}
                  disabled={issueFixStatus === "running"}
                  className="inline-flex items-center justify-center gap-2"
                  style={{
                    width: "100%",
                    minHeight: 44,
                    borderRadius: 7,
                    border: "1px solid rgba(250,204,21,0.44)",
                    background: issueFixStatus === "done" ? "rgba(34,197,94,0.16)" : "rgba(250,204,21,0.16)",
                    color: issueFixStatus === "done" ? "#bbf7d0" : "#fde68a",
                    fontFamily: "var(--f-mono)",
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    cursor: issueFixStatus === "running" ? "wait" : "pointer",
                    opacity: issueFixStatus === "running" ? 0.72 : 1,
                  }}
                >
                  {issueFixStatus === "running" ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <PlugZap size={15} aria-hidden="true" />}
                  {issueFixStatus === "running" ? "Fixing..." : issueFixStatus === "done" ? "Repair started" : activeIssue.fixLabel || "Fix automatically"}
                </button>
                {issueFixMessage ? (
                  <p
                    role={issueFixStatus === "failed" ? "alert" : "status"}
                    style={{
                      margin: "10px 0 0",
                      color: issueFixStatus === "failed" ? "#fecdd3" : "#bbf7d0",
                      fontSize: 12,
                      lineHeight: 1.45,
                    }}
                  >
                    {issueFixMessage}
                  </p>
                ) : null}
                <div
                  aria-hidden="true"
                  className="flex items-center gap-3"
                  style={{ margin: "16px 0 14px", color: "var(--muted)", fontFamily: "var(--f-mono)", fontSize: 11 }}
                >
                  <span style={{ height: 1, flex: 1, background: "rgba(148,163,184,0.2)" }} />
                  <span>OR</span>
                  <span style={{ height: 1, flex: 1, background: "rgba(148,163,184,0.2)" }} />
                </div>
              </>
            ) : null}
            <pre
              style={{
                whiteSpace: "pre-wrap",
                overflowX: "auto",
                borderRadius: 7,
                border: "1px solid rgba(148,163,184,0.18)",
                background: "rgba(2,6,23,0.72)",
                color: "#dbeafe",
                padding: 12,
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >{activeIssue.commands.join("\n")}</pre>
          </div>
        </div>
      ), portalTarget) : null}
    </div>
  );
}
