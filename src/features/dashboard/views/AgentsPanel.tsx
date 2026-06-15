"use client";

import { useCallback, useEffect, useState } from "react";
import type { ComponentType, Dispatch, ElementType, MutableRefObject, SetStateAction } from "react";
import { AgentCallModal, type AgentCallLiveKit, type AgentCallLocalTts, type AgentCallPhase, type AgentCallRealtime, type AgentCallRuntimeAgent } from "@/components/fleet/agent-call-modal";
import type { FleetViewProps } from "@/components/fleet/FleetView";
import { FleetHiveView } from "@/components/fleet-hive";
import { dashboardStateValue, loadDashboardStateSnapshot, saveDashboardStateValue } from "@/lib/services/dashboard-state-client";
import type { AeonDeleteDepth, AeonDeleteProgress, AeonDeleteResult } from "@/components/fleet/roster";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import type { DashboardView, HivemindLinkClientStatus, MachineGroup } from "@/features/dashboard/dashboard-types";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;
type IconComponent = ElementType<{
  "aria-hidden"?: boolean | "true" | "false";
  className?: string;
}>;
type AgentSettingsPanel = "role" | "memory" | "tools" | "security";
type FleetViewData = {
  machines: NonNullable<FleetViewProps["machines"]>;
  tasks: NonNullable<FleetViewProps["tasks"]>;
  alerts: NonNullable<FleetViewProps["alerts"]>;
  ticker: NonNullable<FleetViewProps["ticker"]>;
  edges: NonNullable<FleetViewProps["edges"]>;
};

type TailnetCleanupBanner = {
  visible: boolean;
  candidates: Array<{ id: string; hostname: string; offlineForDays: number }>;
  staleAgeDays: number;
  busy: boolean;
  notice: string;
  onCleanupNow: () => void;
  onAlwaysCleanup: () => void;
  onDismiss: () => void;
};

type AgentsPanelProps = {
  Button: ElementType;
  Check: IconComponent;
  ExternalLink: IconComponent;
  FleetView: ComponentType<FleetViewProps>;
  activeView: DashboardView;
  tailnetCleanup?: TailnetCleanupBanner;
  addAgentToMachine: (machine: MachineGroup) => void;
  agents: AgentProfile[];
  deleteAgent: (
    agentId: string,
    options?: {
      aeonDeleteDepth?: AeonDeleteDepth;
      onProgress?: (progress: AeonDeleteProgress) => void;
      machine?: Pick<NonNullable<FleetViewProps["machines"]>[number], "collectorUrl">;
      fleetAgent?: Pick<NonNullable<FleetViewProps["machines"]>[number]["agents"][number], "id" | "name">;
    },
  ) => void | Promise<AeonDeleteResult | void>;
  displayAgents: AgentProfile[];
  fleetAutoUpdatePaused?: boolean;
  fleetClass: ClassNameBuilder;
  fleetUpdateDetailByMachine: NonNullable<FleetViewProps["updateDetailByMachine"]>;
  fleetUpdateStatusByMachine: NonNullable<FleetViewProps["updateStatusByMachine"]>;
  fleetDiscoveryLoading: boolean;
  fleetHostedApps?: FleetViewProps["hostedApps"];
  fleetViewData: FleetViewData;
  hivemindLinkSignInPolling: boolean;
  hivemindLinkSignInPollingRef: MutableRefObject<boolean>;
  hivemindLinkStatus: HivemindLinkClientStatus | null;
  machineGroups: MachineGroup[];
  markNotificationRead: (id: string) => void;
  openMachineInitModal: () => void;
  onFixSyncIssue: NonNullable<FleetViewProps["onFixSyncIssue"]>;
  onRecentAgentArrivalSeen?: FleetViewProps["onRecentAgentArrivalSeen"];
  onToggleFleetAutoUpdatePaused?: () => void;
  recentAgentArrival?: FleetViewProps["recentAgentArrival"];
  renameMachine: NonNullable<FleetViewProps["onRenameMachine"]>;
  requestDuplicateAgent: (agentId: string) => void;
  runMachineUpdate: (machine: MachineGroup) => void | Promise<void>;
  setActiveView: Dispatch<SetStateAction<DashboardView>>;
  setAgentRenameDraft: Dispatch<SetStateAction<string>>;
  setAgentRenameEditing: Dispatch<SetStateAction<boolean>>;
  setAgentRoleModalId: Dispatch<SetStateAction<string>>;
  setAgentRuntimeAdvancedOpen: Dispatch<SetStateAction<boolean>>;
  setAgentRuntimeFolderEditing: Dispatch<SetStateAction<boolean>>;
  setAgentRuntimeFolderStatus: Dispatch<SetStateAction<string>>;
  setAgentSettingsPanel: Dispatch<SetStateAction<AgentSettingsPanel>>;
  setHivemindLinkBannerDismissed: Dispatch<SetStateAction<boolean>>;
  setHivemindLinkConnectedUntil: Dispatch<SetStateAction<number>>;
  setHivemindLinkSignInPolling: Dispatch<SetStateAction<boolean>>;
  setSelectedAgentId: Dispatch<SetStateAction<string>>;
  showHivemindLinkConnectedBanner: boolean;
  showHivemindLinkSignInBanner: boolean;
  startAgentChat: (agentId: string, options?: { fresh?: boolean }) => void;
  startAgentWorkChat: (agentId: string, task?: string) => void;
  walletsByAgent: Record<string, AgentWalletConfig>;
};

type FleetPanelMachine = FleetViewData["machines"][number];
type FleetPanelAgent = FleetPanelMachine["agents"][number];
type AgentPhoneCallResult = {
  ok?: boolean;
  error?: string;
  result?: {
    call?: {
      id?: string;
      callerName?: string;
      dashboardToken?: string;
      livekitUrl?: string;
      mode?: "byok" | "cloud" | "local-tts";
      localTts?: AgentCallLocalTts;
      realtime?: AgentCallRealtime;
      runtimeAgent?: AgentCallRuntimeAgent;
      room?: string;
      voiceReady?: boolean;
    };
  };
};

const FLEET_LAYOUT_STORAGE_KEY = "hivemindos.fleet.layout.v1";

function resultHasDashboardVoice(data: AgentPhoneCallResult | null) {
  const call = data?.result?.call;
  return Boolean(call?.livekitUrl && call.dashboardToken);
}

function normalizedAgentName(value?: string) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function hasAeonCallContext(agent: AgentProfile) {
  return Boolean(agent.aeonRepo || agent.aeonRepoName || agent.aeonLocalPath || agent.localDataDir || agent.a2aUrl);
}

function findCallProfile(input: {
  fleetAgent: FleetPanelAgent;
  machine: FleetPanelMachine;
  profiles: AgentProfile[];
}) {
  const { fleetAgent, machine, profiles } = input;
  const byExactId = profiles.find((item) => item.id === fleetAgent.id || item.agentId === fleetAgent.id);
  if (byExactId) return byExactId;

  const fleetName = normalizedAgentName(fleetAgent.name);
  const byName = profiles.find((item) => normalizedAgentName(item.name) === fleetName || normalizedAgentName(item.agentId) === fleetName);
  if (byName) return byName;

  if (fleetAgent.runtime.trim().toLowerCase() !== "aeon") return undefined;
  const contextualAeons = profiles.filter((item) => item.runtime === "aeon" && hasAeonCallContext(item));
  const onSameMachine = contextualAeons.filter((item) => !item.machineName || item.machineName === machine.name);
  if (onSameMachine.length === 1) return onSameMachine[0];
  return contextualAeons.length === 1 ? contextualAeons[0] : undefined;
}

export function AgentsPanel(props: AgentsPanelProps) {
  const {
    Button,
    Check,
    ExternalLink,
    FleetView,
    activeView,
    tailnetCleanup,
    addAgentToMachine,
    agents,
    deleteAgent,
    displayAgents,
    fleetAutoUpdatePaused,
    fleetClass,
    fleetDiscoveryLoading,
    fleetHostedApps,
    fleetUpdateDetailByMachine,
    fleetUpdateStatusByMachine,
    fleetViewData,
    hivemindLinkSignInPolling,
    hivemindLinkSignInPollingRef,
    hivemindLinkStatus,
    machineGroups,
    markNotificationRead,
    openMachineInitModal,
    onFixSyncIssue,
    onRecentAgentArrivalSeen,
    onToggleFleetAutoUpdatePaused,
    recentAgentArrival,
    renameMachine,
    requestDuplicateAgent,
    runMachineUpdate,
    setActiveView,
    setAgentRenameDraft,
    setAgentRenameEditing,
    setAgentRoleModalId,
    setAgentRuntimeAdvancedOpen,
    setAgentRuntimeFolderEditing,
    setAgentRuntimeFolderStatus,
    setAgentSettingsPanel,
    setHivemindLinkBannerDismissed,
    setHivemindLinkConnectedUntil,
    setHivemindLinkSignInPolling,
    setSelectedAgentId,
    showHivemindLinkConnectedBanner,
    showHivemindLinkSignInBanner,
    startAgentChat,
    startAgentWorkChat,
    walletsByAgent,
  } = props;
  const [agentCallSession, setAgentCallSession] = useState<{
    machine: FleetPanelMachine;
    agent: FleetPanelAgent;
    phase: AgentCallPhase;
    error?: string;
    notice?: string;
    livekit?: AgentCallLiveKit;
    realtime?: AgentCallRealtime;
    localTts?: AgentCallLocalTts;
    runtimeAgent?: AgentCallRuntimeAgent;
  } | null>(null);

  // The single logical Queen Bee — drives the central hive cell in the graph.
  const queenAgent = displayAgents.find((agent) => agent.beeRole === "queen")
    ?? displayAgents.find((agent) => /queen/i.test(agent.name));

  // Fleet layout: the redesigned "hive" is the default; "classic" falls back to
  // the legacy three-column FleetView. The choice is persisted across sessions.
  const [fleetLayout, setFleetLayout] = useState<"hive" | "classic">("hive");
  useEffect(() => {
    let cancelled = false;
    void loadDashboardStateSnapshot().then((snapshot) => {
      if (cancelled) return;
      const stored = dashboardStateValue(snapshot, FLEET_LAYOUT_STORAGE_KEY);
      if (stored === "classic" || stored === "hive") setFleetLayout(stored);
    });
    return () => { cancelled = true; };
  }, []);
  const chooseFleetLayout = useCallback((layout: "hive" | "classic") => {
    setFleetLayout(layout);
    void saveDashboardStateValue(FLEET_LAYOUT_STORAGE_KEY, layout);
  }, []);

  // "Message the hive": dispatch a task to the Queen orchestrator when present.
  const handleSendHiveMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (queenAgent) startAgentWorkChat(queenAgent.id, trimmed);
    else if (displayAgents[0]) startAgentChat(displayAgents[0].id, { fresh: true });
  }, [displayAgents, queenAgent, startAgentChat, startAgentWorkChat]);

  const callAgentOnDashboard = useCallback(async (machine: FleetPanelMachine, fleetAgent: FleetPanelAgent): Promise<AgentPhoneCallResult> => {
    const profile = findCallProfile({
      fleetAgent,
      machine,
      profiles: [
        ...displayAgents,
        ...agents,
        ...machineGroups.flatMap((group) => group.agents),
      ],
    });
    const response = await fetch("/api/phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "dashboard-agent-call",
        agent: {
          id: profile?.id ?? fleetAgent.id,
          name: profile?.name ?? fleetAgent.name,
          runtime: profile?.runtime ?? fleetAgent.runtime,
          role: fleetAgent.role,
          task: fleetAgent.task,
          voiceRuntime: profile?.calls?.voiceRuntime,
          voiceProviderId: profile?.calls?.voiceProviderId,
          voiceModelId: profile?.calls?.voiceModelId,
          voiceId: profile?.calls?.voiceId,
          skillProfilePrompt: profile?.skillProfilePrompt,
          preferredSkillSlugs: profile?.preferredSkillSlugs,
          aeonRepo: profile?.aeonRepo,
          aeonRepoName: profile?.aeonRepoName,
          aeonBranch: profile?.aeonBranch,
          aeonLocalPath: profile?.aeonLocalPath,
          aeonMode: profile?.aeonMode,
          a2aUrl: profile?.a2aUrl,
          localDataDir: profile?.localDataDir,
        },
        machine: {
          id: machine.id,
          name: machine.name,
        },
      }),
    });
    const data = await response.json().catch(() => null) as AgentPhoneCallResult | null;
    if (!response.ok || data?.ok === false) {
      if (resultHasDashboardVoice(data)) {
        return { ...data, error: data?.error ?? `HivemindOS call service returned HTTP ${response.status}.` };
      }
      throw new Error(data?.error ?? `HivemindOS call service returned HTTP ${response.status}.`);
    }
    return data ?? { ok: true };
  }, [agents, displayAgents, machineGroups]);

  const openAgentPhoneCall = useCallback(async (machine: FleetPanelMachine, fleetAgent: FleetPanelAgent) => {
    setAgentCallSession({ machine, agent: fleetAgent, phase: "ringing" });
    try {
      const result = await callAgentOnDashboard(machine, fleetAgent);
      const call = result.result?.call;
      const livekit: AgentCallLiveKit | undefined = call?.livekitUrl && call.dashboardToken
        ? { serverUrl: call.livekitUrl, token: call.dashboardToken, ...(call.room ? { room: call.room } : {}) }
        : undefined;
      if (call?.mode === "byok" && call.realtime?.clientSecret) {
        setAgentCallSession((current) => current?.agent.id === fleetAgent.id ? {
          ...current,
          phase: "ringing",
          realtime: call.realtime,
          runtimeAgent: call.runtimeAgent,
        } : current);
        return;
      }
      if (call?.mode === "local-tts" && call.localTts) {
        setAgentCallSession((current) => current?.agent.id === fleetAgent.id ? {
          ...current,
          phase: "ringing",
          localTts: call.localTts,
          runtimeAgent: call.runtimeAgent,
        } : current);
        return;
      }
      if (livekit) {
        const notice = result.error ? "Dashboard audio joined the agent room, but setup reported a warning." : undefined;
        setAgentCallSession((current) => current?.agent.id === fleetAgent.id ? { ...current, livekit, notice, phase: "ringing" } : current);
      } else {
        throw new Error("HivemindOS did not return dashboard call credentials.");
      }
    } catch (error) {
      setAgentCallSession({
        machine,
        agent: fleetAgent,
        phase: "failed",
        error: error instanceof Error ? error.message : "Could not start the call.",
      });
    }
  }, [callAgentOnDashboard]);

  // Shared props consumed by both the new Hive layout and the legacy FleetView.
  const fleetProps: FleetViewProps = {
    machines: fleetViewData.machines,
    tasks: fleetViewData.tasks,
    alerts: fleetViewData.alerts,
    ticker: fleetViewData.ticker,
    edges: fleetViewData.edges,
    hostedApps: fleetHostedApps,
    loading: fleetDiscoveryLoading,
    mastheadMode: "mobile",
    recentAgentArrival,
    onRecentAgentArrivalSeen,
    onAddAgent: (machine) => {
      const group = machineGroups.find((item) => item.key === machine.id);
      if (group) addAgentToMachine(group);
    },
    onAddMachine: openMachineInitModal,
    autoUpdatePaused: fleetAutoUpdatePaused,
    onToggleAutoUpdatePaused: onToggleFleetAutoUpdatePaused,
    updateStatusByMachine: fleetUpdateStatusByMachine,
    updateDetailByMachine: fleetUpdateDetailByMachine,
    walletsByAgent,
    onUpdateMachine: (machine) => {
      const group = machineGroups.find((item) => item.key === machine.id);
      if (group) void runMachineUpdate(group);
    },
    onDismissAlert: (alert) => {
      if (alert.id.startsWith("notification-")) {
        markNotificationRead(alert.id.slice("notification-".length));
      }
    },
    onRenameMachine: renameMachine,
    onOpenCodeProof: () => setActiveView("integrations"),
    onFixSyncIssue,
    onOpenChat: (_, agent) => startAgentChat(agent.id, { fresh: true }),
    onOpenTaskChat: (_, agent, chat) => startAgentWorkChat(agent.id, chat?.id ?? chat?.task ?? agent.task),
    onCallAgent: openAgentPhoneCall,
    onOpenWallet: (_, agent) => {
      setSelectedAgentId(agent.id);
      setActiveView("wallet");
    },
    onEditSettings: (_, agent) => {
      setSelectedAgentId(agent.id);
      setAgentRenameDraft(agent.name);
      setAgentRenameEditing(false);
      setAgentRuntimeFolderEditing(false);
      setAgentRuntimeFolderStatus("");
      setAgentRuntimeAdvancedOpen(false);
      setAgentSettingsPanel("role");
      setAgentRoleModalId(agent.id);
    },
    onOpenQueenSettings: queenAgent ? () => {
      setSelectedAgentId(queenAgent.id);
      setAgentRenameDraft(queenAgent.name);
      setAgentRenameEditing(false);
      setAgentRuntimeFolderEditing(false);
      setAgentRuntimeFolderStatus("");
      setAgentRuntimeAdvancedOpen(false);
      setAgentSettingsPanel("role");
      setAgentRoleModalId(queenAgent.id);
    } : undefined,
    onDuplicate: (_, agent) => requestDuplicateAgent(agent.id),
    onRemove: (machine, agent, depth, onProgress) => deleteAgent(agent.id, {
      ...(depth ? { aeonDeleteDepth: depth, onProgress } : {}),
      machine,
      fleetAgent: agent,
    }),
  };
  const layoutToggle = <FleetLayoutToggle layout={fleetLayout} onChoose={chooseFleetLayout} />;

  return (
    <>
      {activeView === "agents" ? (
        <section className={fleetClass("fleetConstellationPanel", "tabPanel")}>
          {showHivemindLinkConnectedBanner ? (
            <div className="relative mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[rgba(20,184,166,0.38)] bg-[rgba(20,184,166,0.12)] px-4 py-3 pr-12 text-sm text-[var(--foreground)]">
              <div>
                <strong>Hivemind Link connected</strong>
                <p className="mt-1 text-[var(--muted)]">This app-managed node is authorized. Fleet will refresh Link peers automatically.</p>
              </div>
              <Check aria-hidden="true" className="h-5 w-5 text-[rgb(45,212,191)]" />
              <CloseIconButton
                className="absolute right-2 top-2"
                aria-label="Dismiss Hivemind Link connection message"
                onClick={() => {
                  setHivemindLinkBannerDismissed(true);
                  setHivemindLinkConnectedUntil(0);
                }}
              />
            </div>
          ) : showHivemindLinkSignInBanner ? (
            <div className="relative mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.10)] px-4 py-3 pr-12 text-sm text-[var(--foreground)]">
              <div>
                <strong>Hivemind Link needs sign-in</strong>
                <p className="mt-1 text-[var(--muted)]">Authorize this app-managed Tailscale node before new Link machines can appear in Fleet.</p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setHivemindLinkBannerDismissed(false);
                  hivemindLinkSignInPollingRef.current = true;
                  setHivemindLinkSignInPolling(true);
                  window.open(hivemindLinkStatus?.authUrl, "_blank", "noopener,noreferrer");
                }}
              >
                <ExternalLink aria-hidden="true" />
                {hivemindLinkSignInPolling ? "Waiting..." : "Sign in"}
              </Button>
              <CloseIconButton
                className="absolute right-2 top-2"
                aria-label="Dismiss Hivemind Link sign-in message"
                onClick={() => {
                  setHivemindLinkBannerDismissed(true);
                  hivemindLinkSignInPollingRef.current = false;
                  setHivemindLinkSignInPolling(false);
                }}
              />
            </div>
          ) : null}
          {tailnetCleanup?.visible ? (
            <div className="relative mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.10)] px-4 py-3 pr-12 text-sm text-[var(--foreground)]">
              <div style={{ minWidth: 0 }}>
                <strong>
                  {tailnetCleanup.candidates.length === 1
                    ? "1 stale tailnet node detected"
                    : `${tailnetCleanup.candidates.length} stale tailnet nodes detected`}
                </strong>
                <p className="mt-1 text-[var(--muted)]" style={{ overflowWrap: "anywhere" }}>
                  {tailnetCleanup.notice
                    || `Old registrations offline for over ${tailnetCleanup.staleAgeDays} days: ${tailnetCleanup.candidates.map((candidate) => candidate.hostname).join(", ")}. Removing them keeps the fleet roster free of ghost machines.`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={tailnetCleanup.busy}
                  onClick={() => tailnetCleanup.onCleanupNow()}
                >
                  {tailnetCleanup.busy ? "Cleaning..." : "Clean up now"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={tailnetCleanup.busy}
                  onClick={() => tailnetCleanup.onAlwaysCleanup()}
                  title="Also removes future stale hivemindos-* nodes automatically once a day"
                >
                  Always clean up automatically
                </Button>
              </div>
              <CloseIconButton
                className="absolute right-2 top-2"
                aria-label="Dismiss stale tailnet node message"
                onClick={() => tailnetCleanup.onDismiss()}
              />
            </div>
          ) : null}
          <div className={`${fleetClass("fleetViewport")} fleetViewportShell`} style={{ position: "relative" }}>
            {fleetLayout === "hive" ? (
              <FleetHiveView {...fleetProps} onSendMessage={handleSendHiveMessage} layoutToggle={layoutToggle} />
            ) : (
              <>
                <FleetView {...fleetProps} />
                <div style={{ position: "absolute", top: 12, right: 18, zIndex: 50 }}>{layoutToggle}</div>
              </>
            )}
          </div>
          {agentCallSession ? (
            <AgentCallModal
              machine={agentCallSession.machine}
              agent={agentCallSession.agent}
              phase={agentCallSession.phase}
              error={agentCallSession.error}
              notice={agentCallSession.notice}
              livekit={agentCallSession.livekit}
              realtime={agentCallSession.realtime}
              localTts={agentCallSession.localTts}
              runtimeAgent={agentCallSession.runtimeAgent}
              onVoiceConnected={() => {
                setAgentCallSession((current) => (
                  current?.agent.id === agentCallSession.agent.id && (current.phase === "ringing" || current.phase === "answered")
                    ? { ...current, phase: "talking" }
                    : current
                ));
              }}
              onTransferToChat={(agent) => {
                setAgentCallSession(null);
                startAgentChat(agent.id, { fresh: true });
              }}
              onAddAgent={(_, machine) => {
                setAgentCallSession(null);
                const group = machineGroups.find((item) => item.key === machine.id);
                if (group) addAgentToMachine(group);
              }}
              onRedial={(agent, machine) => {
                void openAgentPhoneCall(machine, agent);
              }}
              onClose={() => setAgentCallSession(null)}
            />
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function FleetLayoutToggle({ layout, onChoose }: { layout: "hive" | "classic"; onChoose: (layout: "hive" | "classic") => void }) {
  const options: Array<{ id: "hive" | "classic"; label: string; title: string }> = [
    { id: "hive", label: "Hive", title: "Redesigned hive layout" },
    { id: "classic", label: "Classic", title: "Legacy three-column layout" },
  ];
  return (
    <div
      role="group"
      aria-label="Fleet layout"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        borderRadius: 9999,
        border: "1px solid rgba(148,163,184,0.28)",
        background: "rgba(12,13,17,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      {options.map((option) => {
        const active = layout === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            title={option.title}
            onClick={() => onChoose(option.id)}
            style={{
              cursor: "pointer",
              border: 0,
              borderRadius: 9999,
              padding: "4px 12px",
              fontFamily: "var(--f-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              background: active ? "rgba(231,180,92,0.16)" : "transparent",
              color: active ? "#e7b45c" : "rgba(148,163,184,0.9)",
              transition: "background 140ms ease, color 140ms ease",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
