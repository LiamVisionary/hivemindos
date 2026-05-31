"use client";

import { useCallback, useState } from "react";
import type { ComponentType, Dispatch, ElementType, MutableRefObject, SetStateAction } from "react";
import { AgentCallModal, type AgentCallLiveKit, type AgentCallPhase } from "@/components/fleet/agent-call-modal";
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
  fleetCheckedAt: number | null;
  fleetClass: ClassNameBuilder;
  fleetUpdateDetailByMachine: NonNullable<FleetViewProps["updateDetailByMachine"]>;
  fleetUpdateStatusByMachine: NonNullable<FleetViewProps["updateStatusByMachine"]>;
  fleetDiscoveryLoading: boolean;
  fleetViewData: FleetViewData;
  formatRelativeTime: (timestamp: number) => string;
  hivemindLinkSignInPolling: boolean;
  hivemindLinkSignInPollingRef: MutableRefObject<boolean>;
  hivemindLinkStatus: HivemindLinkClientStatus | null;
  machineGroups: MachineGroup[];
  markNotificationRead: (id: string) => void;
  openMachineInitModal: () => void;
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
  tailscaleStatus: string;
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
      room?: string;
      voiceReady?: boolean;
    };
  };
};

function resultHasDashboardVoice(data: AgentPhoneCallResult | null) {
  const call = data?.result?.call;
  return Boolean(call?.livekitUrl && call.dashboardToken);
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
    fleetCheckedAt,
    fleetClass,
    fleetDiscoveryLoading,
    fleetUpdateDetailByMachine,
    fleetUpdateStatusByMachine,
    fleetViewData,
    formatRelativeTime,
    hivemindLinkSignInPolling,
    hivemindLinkSignInPollingRef,
    hivemindLinkStatus,
    machineGroups,
    markNotificationRead,
    openMachineInitModal,
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
    tailscaleStatus,
  } = props;
  const [agentCallSession, setAgentCallSession] = useState<{
    machine: FleetPanelMachine;
    agent: FleetPanelAgent;
    phase: AgentCallPhase;
    error?: string;
    notice?: string;
    livekit?: AgentCallLiveKit;
  } | null>(null);

  const callAgentOnPhone = useCallback(async (machine: FleetPanelMachine, fleetAgent: FleetPanelAgent): Promise<AgentPhoneCallResult> => {
    const profile = displayAgents.find((item) => item.id === fleetAgent.id)
      ?? agents.find((item) => item.id === fleetAgent.id)
      ?? machineGroups.flatMap((group) => group.agents).find((item) => item.id === fleetAgent.id);
    const response = await fetch("/api/phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "ring-agent",
        agent: {
          id: profile?.id ?? fleetAgent.id,
          name: profile?.name ?? fleetAgent.name,
          runtime: profile?.runtime ?? fleetAgent.runtime,
          role: fleetAgent.role,
          task: fleetAgent.task,
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
        return { ...data, error: data?.error ?? `Phone gateway returned HTTP ${response.status}.` };
      }
      throw new Error(data?.error ?? `Phone gateway returned HTTP ${response.status}.`);
    }
    return data ?? { ok: true };
  }, [agents, displayAgents, machineGroups]);

  const openAgentPhoneCall = useCallback(async (machine: FleetPanelMachine, fleetAgent: FleetPanelAgent) => {
    setAgentCallSession({ machine, agent: fleetAgent, phase: "ringing" });
    try {
      const result = await callAgentOnPhone(machine, fleetAgent);
      const call = result.result?.call;
      const livekit: AgentCallLiveKit | undefined = call?.livekitUrl && call.dashboardToken
        ? { serverUrl: call.livekitUrl, token: call.dashboardToken, ...(call.room ? { room: call.room } : {}) }
        : undefined;
      if (livekit) {
        const notice = result.error ? "Phone push did not complete, but dashboard audio joined the agent room." : undefined;
        setAgentCallSession((current) => current?.agent.id === fleetAgent.id ? { ...current, livekit, notice, phase: "answered" } : current);
      } else {
        window.setTimeout(() => {
          setAgentCallSession((current) => current?.agent.id === fleetAgent.id ? { ...current, phase: "answered" } : current);
        }, 620);
      }
      if (call?.voiceReady === true && !livekit) {
        window.setTimeout(() => {
          setAgentCallSession((current) => current?.agent.id === fleetAgent.id ? { ...current, phase: "talking" } : current);
        }, 3200);
      }
    } catch (error) {
      setAgentCallSession({
        machine,
        agent: fleetAgent,
        phase: "failed",
        error: error instanceof Error ? error.message : "Could not start the call.",
      });
    }
  }, [callAgentOnPhone]);

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
          <FleetView
            machines={fleetViewData.machines}
            tasks={fleetViewData.tasks}
            alerts={fleetViewData.alerts}
            ticker={fleetViewData.ticker}
            edges={fleetViewData.edges}
            loading={fleetDiscoveryLoading}
            checkedLabel={fleetCheckedAt ? `Scanned ${formatRelativeTime(fleetCheckedAt)}` : "Fleet scan pending"}
            tailnetLabel={tailscaleStatus}
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
          {agentCallSession ? (
            <AgentCallModal
              machine={agentCallSession.machine}
              agent={agentCallSession.agent}
              phase={agentCallSession.phase}
              error={agentCallSession.error}
              notice={agentCallSession.notice}
              livekit={agentCallSession.livekit}
              onVoiceConnected={() => {
                window.setTimeout(() => {
                  setAgentCallSession((current) => (
                    current?.agent.id === agentCallSession.agent.id && current.phase === "answered"
                      ? { ...current, phase: "talking" }
                      : current
                  ));
                }, 900);
              }}
              onClose={() => setAgentCallSession(null)}
            />
          ) : null}
        </section>
      ) : null}
    </>
  );
}
