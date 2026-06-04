"use client";

import { useCallback, useState } from "react";
import type { ComponentType, Dispatch, ElementType, MutableRefObject, SetStateAction } from "react";
import { AgentCallModal, type AgentCallLiveKit, type AgentCallPhase, type AgentCallRealtime, type AgentCallRuntimeAgent } from "@/components/fleet/agent-call-modal";
import type { FleetViewProps } from "@/components/fleet/FleetView";
import type { AeonDeleteDepth, AeonDeleteProgress, AeonDeleteResult } from "@/components/fleet/roster";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import type { DashboardView, HivemindLinkClientStatus, MachineGroup } from "@/features/dashboard/dashboard-types";
import type { AgentProfile } from "@/lib/types/agent-runtime";

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

type AgentsPanelProps = {
  Button: ElementType;
  Check: IconComponent;
  ExternalLink: IconComponent;
  FleetView: ComponentType<FleetViewProps>;
  activeView: DashboardView;
  addAgentToMachine: (machine: MachineGroup) => void;
  agents: AgentProfile[];
  deleteAgent: (
    agentId: string,
    options?: {
      aeonDeleteDepth?: AeonDeleteDepth;
      onProgress?: (progress: AeonDeleteProgress) => void;
    },
  ) => void | Promise<AeonDeleteResult | void>;
  displayAgents: AgentProfile[];
  fleetClass: ClassNameBuilder;
  fleetUpdateDetailByMachine: NonNullable<FleetViewProps["updateDetailByMachine"]>;
  fleetUpdateStatusByMachine: NonNullable<FleetViewProps["updateStatusByMachine"]>;
  fleetDiscoveryLoading: boolean;
  fleetViewData: FleetViewData;
  hivemindLinkSignInPolling: boolean;
  hivemindLinkSignInPollingRef: MutableRefObject<boolean>;
  hivemindLinkStatus: HivemindLinkClientStatus | null;
  machineGroups: MachineGroup[];
  markNotificationRead: (id: string) => void;
  openMachineInitModal: () => void;
  onFixSyncIssue: NonNullable<FleetViewProps["onFixSyncIssue"]>;
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
      mode?: "byok" | "cloud";
      realtime?: AgentCallRealtime;
      runtimeAgent?: AgentCallRuntimeAgent;
      room?: string;
      voiceReady?: boolean;
    };
  };
};

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
    addAgentToMachine,
    agents,
    deleteAgent,
    displayAgents,
    fleetClass,
    fleetDiscoveryLoading,
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
  } = props;
  const [agentCallSession, setAgentCallSession] = useState<{
    machine: FleetPanelMachine;
    agent: FleetPanelAgent;
    phase: AgentCallPhase;
    error?: string;
    notice?: string;
    livekit?: AgentCallLiveKit;
    realtime?: AgentCallRealtime;
    runtimeAgent?: AgentCallRuntimeAgent;
  } | null>(null);

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
          <div className={`${fleetClass("fleetViewport")} fleetViewportShell`}>
            <FleetView
              machines={fleetViewData.machines}
              tasks={fleetViewData.tasks}
              alerts={fleetViewData.alerts}
              ticker={fleetViewData.ticker}
              edges={fleetViewData.edges}
              loading={fleetDiscoveryLoading}
              mastheadMode="mobile"
              onAddAgent={(machine) => {
                const group = machineGroups.find((item) => item.key === machine.id);
                if (group) addAgentToMachine(group);
              }}
              onAddMachine={openMachineInitModal}
              updateStatusByMachine={fleetUpdateStatusByMachine}
              updateDetailByMachine={fleetUpdateDetailByMachine}
              onUpdateMachine={(machine) => {
                const group = machineGroups.find((item) => item.key === machine.id);
                if (group) void runMachineUpdate(group);
              }}
              onDismissAlert={(alert) => {
                if (alert.id.startsWith("notification-")) {
                  markNotificationRead(alert.id.slice("notification-".length));
                }
              }}
              onRenameMachine={renameMachine}
              onOpenCodeProof={() => setActiveView("integrations")}
              onFixSyncIssue={onFixSyncIssue}
              onOpenChat={(_, agent) => startAgentChat(agent.id, { fresh: true })}
              onOpenTaskChat={(_, agent, chat) => startAgentWorkChat(agent.id, chat?.id ?? chat?.task ?? agent.task)}
              onCallAgent={openAgentPhoneCall}
              onOpenWallet={(_, agent) => {
                setSelectedAgentId(agent.id);
                setActiveView("wallet");
              }}
              onEditSettings={(_, agent) => {
                setSelectedAgentId(agent.id);
                setAgentRenameDraft(agent.name);
                setAgentRenameEditing(false);
                setAgentRuntimeFolderEditing(false);
                setAgentRuntimeFolderStatus("");
                setAgentRuntimeAdvancedOpen(false);
                setAgentSettingsPanel("role");
                setAgentRoleModalId(agent.id);
              }}
              onDuplicate={(_, agent) => requestDuplicateAgent(agent.id)}
              onRemove={(_, agent, depth, onProgress) => deleteAgent(agent.id, depth ? { aeonDeleteDepth: depth, onProgress } : undefined)}
            />
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
              runtimeAgent={agentCallSession.runtimeAgent}
              onVoiceConnected={() => {
                setAgentCallSession((current) => (
                  current?.agent.id === agentCallSession.agent.id && (current.phase === "ringing" || current.phase === "answered")
                    ? { ...current, phase: "talking" }
                    : current
                ));
              }}
              onClose={() => setAgentCallSession(null)}
            />
          ) : null}
        </section>
      ) : null}
    </>
  );
}
