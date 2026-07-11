"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { AgentSettingsPanel } from "@/features/dashboard/agent-settings-types";
import type { DashboardCompletionNotification } from "@/features/dashboard/dashboard-completion-notifications";
import type { AgentProfile } from "@/lib/types/agent-runtime";

type VoiceFailureAgent = Pick<AgentProfile, "id" | "name" | "beeRole">;

export type AgentVoiceFailureDetail = {
  agentId?: string;
  agentName?: string;
  agentRole?: "queen";
  message: string;
};

type UseAgentVoiceFailureNotificationsOptions = {
  agents: VoiceFailureAgent[];
  setAgentRoleModalId: Dispatch<SetStateAction<string>>;
  setAgentSettingsPanel: Dispatch<SetStateAction<AgentSettingsPanel>>;
  setNotifications: Dispatch<SetStateAction<DashboardCompletionNotification[]>>;
  setSelectedAgentId: Dispatch<SetStateAction<string>>;
};

function resolveFailureAgent(agents: VoiceFailureAgent[], detail: AgentVoiceFailureDetail) {
  if (detail.agentId) {
    const exact = agents.find((agent) => agent.id === detail.agentId);
    if (exact) return exact;
  }
  if (detail.agentRole === "queen") return agents.find((agent) => agent.beeRole === "queen");
  return undefined;
}

export function useAgentVoiceFailureNotifications({
  agents,
  setAgentRoleModalId,
  setAgentSettingsPanel,
  setNotifications,
  setSelectedAgentId,
}: UseAgentVoiceFailureNotificationsOptions) {
  const openAgentVoiceSettings = useCallback((agentId: string) => {
    if (!agents.some((agent) => agent.id === agentId)) return;
    setSelectedAgentId(agentId);
    setAgentSettingsPanel("calls");
    setAgentRoleModalId(agentId);
  }, [agents, setAgentRoleModalId, setAgentSettingsPanel, setSelectedAgentId]);

  const notifyAgentVoiceFailure = useCallback((detail: AgentVoiceFailureDetail) => {
    const message = detail.message.trim();
    if (!message) return;
    const agent = resolveFailureAgent(agents, detail);
    if (!agent) return;
    setNotifications((queue) => {
      if (queue.some((notification) => notification.agentVoiceSettingsId === agent.id)) return queue;
      return [
        ...queue,
        {
          id: `voice-failure-${agent.id}-${Date.now()}`,
          initials: "!",
          title: `${detail.agentName || agent.name} voice`,
          message,
          agentVoiceSettingsId: agent.id,
        },
      ];
    });
  }, [agents, setNotifications]);

  return { notifyAgentVoiceFailure, openAgentVoiceSettings };
}
