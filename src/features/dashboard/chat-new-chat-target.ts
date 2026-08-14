type ChatTargetAgent = { id: string };

type ChatTargetMachine = {
  key: string;
  agents: ChatTargetAgent[];
};

export function selectedAgentFreshChatTarget(input: {
  selectedAgentId?: string;
  selectedAgentCanChat: boolean;
  machineGroups: ChatTargetMachine[];
  workingDirectoryPath?: string;
  workingDirectoryKey?: string;
}) {
  const agentId = input.selectedAgentId?.trim() ?? "";
  if (!agentId || !input.selectedAgentCanChat) return null;
  const machine = input.machineGroups.find((group) => group.agents.some((agent) => agent.id === agentId));
  if (!machine) return null;
  const workingDirectoryPath = input.workingDirectoryPath?.trim() ?? "";
  const workingDirectoryKey = input.workingDirectoryKey?.trim() ?? "";
  return {
    agentId,
    workingDirectoryPath,
    chatLeafKey: workingDirectoryPath && workingDirectoryKey
      ? `folder-${machine.key}-${workingDirectoryKey}-${agentId}`
      : `machine-${machine.key}-${agentId}`,
  };
}
