import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { listenForQueenSettingsOpen } from "@/lib/native/queen-voice-events";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentCreateDraft } from "@/features/dashboard/agent-settings-types";
import type { AgentSchedule, DashboardView, MachineGroup } from "@/features/dashboard/dashboard-types";
import { useBrainReadiness, type BrainReadiness } from "@/features/dashboard/hooks/use-brain-readiness";
import { useQueenCrown } from "@/features/dashboard/hooks/use-queen-crown";

type AgentSettingsPanel = "role" | "memory" | "tools" | "security";

/**
 * Queen Bee UX in one place: keeps the hive crowned (strongest-model
 * auto-crown), drives the fleet brain-readiness banner, opens the queen's
 * settings modal (shared by the banner and the desktop tray entry), and
 * offers the guided create-a-queen flow when no queen exists.
 */
export function useQueenUx(input: {
  hydrated: boolean;
  agents: AgentProfile[];
  displayAgents: AgentProfile[];
  machineGroups: MachineGroup[];
  schedules: AgentSchedule[];
  setAgents: Dispatch<SetStateAction<AgentProfile[]>>;
  setSchedules: Dispatch<SetStateAction<AgentSchedule[]>>;
  refreshSharedSchedulesFromVault: () => Promise<unknown>;
  upsertSharedSchedule: (schedule: AgentSchedule) => Promise<unknown> | void;
  openAgentCreationModal: (machine: MachineGroup) => Promise<void>;
  setAgentCreateDraft: Dispatch<SetStateAction<AgentCreateDraft>>;
  setActiveView: Dispatch<SetStateAction<DashboardView>>;
  setSelectedAgentId: Dispatch<SetStateAction<string>>;
  setAgentRenameDraft: Dispatch<SetStateAction<string>>;
  setAgentRenameEditing: Dispatch<SetStateAction<boolean>>;
  setAgentRuntimeFolderEditing: Dispatch<SetStateAction<boolean>>;
  setAgentRuntimeFolderStatus: Dispatch<SetStateAction<string>>;
  setAgentRuntimeAdvancedOpen: Dispatch<SetStateAction<boolean>>;
  setAgentSettingsPanel: Dispatch<SetStateAction<AgentSettingsPanel>>;
  setAgentRoleModalId: Dispatch<SetStateAction<string>>;
}): { openQueenSettingsModal: (queen: AgentProfile) => void; brainReadiness: BrainReadiness } {
  const { hydrated, agents, displayAgents, machineGroups, schedules, setAgents, setSchedules, refreshSharedSchedulesFromVault, upsertSharedSchedule, openAgentCreationModal, setAgentCreateDraft, setActiveView, setSelectedAgentId, setAgentRenameDraft, setAgentRenameEditing, setAgentRuntimeFolderEditing, setAgentRuntimeFolderStatus, setAgentRuntimeAdvancedOpen, setAgentSettingsPanel, setAgentRoleModalId } = input;

  useQueenCrown({ hydrated, agents, setAgents });

  const openQueenSettingsModal = useCallback((queen: AgentProfile) => {
    setSelectedAgentId(queen.id);
    setAgentRenameDraft(queen.name);
    setAgentRenameEditing(false);
    setAgentRuntimeFolderEditing(false);
    setAgentRuntimeFolderStatus("");
    setAgentRuntimeAdvancedOpen(false);
    setAgentSettingsPanel("role");
    setAgentRoleModalId(queen.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- useState setters are stable
  }, []);

  const openQueenCreateModal = useCallback(() => {
    const machine = machineGroups.find((item) => item.self) ?? machineGroups[0];
    if (!machine) return;
    void openAgentCreationModal(machine).then(() => {
      setAgentCreateDraft((current) => ({ ...current, beeRole: "queen", name: current.name || "Queen Bee" }));
    });
  }, [machineGroups, openAgentCreationModal, setAgentCreateDraft]);

  const brainReadiness = useBrainReadiness({
    hydrated,
    agents,
    setAgents,
    schedules,
    setSchedules,
    refreshSharedSchedulesFromVault,
    upsertSharedSchedule,
    openQueenSettings: openQueenSettingsModal,
    openQueenCreate: openQueenCreateModal,
  });

  // "Queen Bee Settings" from the desktop menu/tray opens the agent settings
  // modal for the queen. The ref keeps the subscription stable across renders.
  const queenSettingsAgentsRef = useRef<AgentProfile[]>(displayAgents);
  useEffect(() => {
    queenSettingsAgentsRef.current = displayAgents;
  }, [displayAgents]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listenForQueenSettingsOpen(() => {
      const known = queenSettingsAgentsRef.current ?? [];
      const queen = known.find((agent) => agent.beeRole === "queen")
        ?? known.find((agent) => /queen/i.test(agent.name));
      if (!queen) {
        // No queen yet: land on the fleet view, where the brain-readiness
        // banner offers the guided create-a-queen flow.
        setActiveView("agents");
        return;
      }
      openQueenSettingsModal(queen);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribe once; handler reads live state via refs/stable callbacks
  }, []);

  return { openQueenSettingsModal, brainReadiness };
}
