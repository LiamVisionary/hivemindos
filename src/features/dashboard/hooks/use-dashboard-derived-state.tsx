// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

/* eslint-disable react-hooks/immutability, react-hooks/purity */

import { useCallback, useEffect, useMemo } from "react";
import {
  RUNTIME_CAPABILITIES,
  runtimeUsesAgentEnvOverlay,
} from "@/lib/types/agent-runtime";
import {
  getUsePodBalanceUsd,
  resolveAgentWallet,
} from "@/lib/utils/agent-wallet";
import type {
  FleetAgentCapabilityBadge,
  FleetAgentCapabilityIcon,
} from "@/components/fleet/fleet-data";
import { simpleStableHash } from "@/features/dashboard/dashboard-light-helpers";
import {
  filterSuppressedAgents,
  machineExactIdentity,
} from "@/features/fleet/fleet-identity";

// Hoisted so the alternation is compiled once instead of being re-created on
// every .test() call inside the per-agent fleetViewData loop (which runs over
// every agent on every fleet/poll-driven recompute).
const FLEET_ALERT_ERROR_PATTERN =
  /\b(error|failed|failure|blocked|unavailable|unauthorized|forbidden|timeout|missing|not found|needs|invalid|rejected|login|auth)\b/i;

const FLEET_CAPABILITY_META: Record<
  string,
  {
    label: string;
    icon: FleetAgentCapabilityIcon;
    tone: FleetAgentCapabilityBadge["tone"];
  }
> = {
  chat: { label: "Chat", icon: "chat", tone: "aqua" },
  background: { label: "Background tasks", icon: "background", tone: "purple" },
  scheduler: { label: "Scheduler", icon: "scheduler", tone: "gold" },
  shell: { label: "Shell", icon: "shell", tone: "green" },
  browser: { label: "Browser", icon: "browser", tone: "blue" },
  mcp: { label: "MCP tools", icon: "mcp", tone: "pink" },
  http: { label: "HTTP tools", icon: "http", tone: "slate" },
  filesystem: { label: "Filesystem", icon: "filesystem", tone: "purple" },
  wallet: { label: "Wallet tools", icon: "wallet", tone: "gold" },
  publishing: { label: "Publishing", icon: "publishing", tone: "pink" },
  deployment: { label: "Deployment", icon: "deployment", tone: "green" },
  analytics: { label: "Analytics", icon: "analytics", tone: "blue" },
  "aeon-workflow": { label: "AEON workflow", icon: "workflow", tone: "aqua" },
};

function combinedUserAssistantSplitIndex(content: string) {
  const markers = [
    /\*\*(?=(?:Private x402|[^*\n]{0,120}\b(?:ready|complete|unavailable|failed)\b))/i,
    /\n(?=(?:Private x402|Endpoint\s+[`'"]?https?:\/\/|HTTP status|Content received:))/i,
  ];
  return markers.reduce((best, pattern) => {
    const match = pattern.exec(content);
    if (!match || !match.index) return best;
    return best < 0 ? match.index : Math.min(best, match.index);
  }, -1);
}

function assistantTailLooksLikeResponse(content: string) {
  return /Private x402|Reply\s+`?confirm|Endpoint\s+[`'"]?https?:\/\/|HTTP status|Content received:|^\*\*[^*\n]{0,120}\b(?:ready|complete|unavailable|failed)\b/i.test(
    content.trim(),
  );
}

function splitCombinedUserAssistantMessage(
  message: ChatMessage,
): ChatMessage[] {
  if (message.role !== "user") return [message];
  const content = message.content ?? "";
  const splitIndex = combinedUserAssistantSplitIndex(content);
  if (splitIndex <= 0) return [message];
  const userContent = content.slice(0, splitIndex).trimEnd();
  const assistantContent = content.slice(splitIndex).trimStart();
  if (!userContent || !assistantTailLooksLikeResponse(assistantContent))
    return [message];
  return [
    { ...message, content: userContent },
    {
      role: "assistant",
      content: assistantContent,
      createdAt: Number(message.createdAt || 0)
        ? Number(message.createdAt) + 1
        : undefined,
      surface: "chat",
    },
  ];
}

function splitCombinedUserAssistantMessages(messages: ChatMessage[]) {
  return messages.flatMap(splitCombinedUserAssistantMessage);
}

function fleetAlertFingerprint(value: string) {
  return simpleStableHash(value.replace(/\s+/g, " ").trim().toLowerCase());
}

function fleetAgentCapabilityBadges(agent: any): FleetAgentCapabilityBadge[] {
  const runtime = String(agent?.runtime ?? "").toLowerCase();
  const matrixCapabilities =
    RUNTIME_CAPABILITIES[runtime]?.skillCapabilities ?? [];
  const agentCapabilities = agent?.runtimeCapabilities?.skillCapabilities ?? [];
  const capabilityIds = [...matrixCapabilities, ...agentCapabilities];

  return [...new Set(capabilityIds)]
    .map((id) => {
      const meta = FLEET_CAPABILITY_META[id];
      if (!meta) return null;
      return { id, ...meta };
    })
    .filter(Boolean)
    .slice(0, 6);
}

export function useDashboardDerivedState(props: any) {
  const {
    RUNTIME_LABELS,
    activeView,
    agentAliasMap,
    agentCreateDraft,
    agentCreateMachineKey,
    agentRoleModalId,
    agentSettingsPanel,
    agents,
    beeRoleLabel,
    brainGraph,
    brainGraphLayout,
    brainSkills,
    chatAutoScrollRef,
    chatDisplayContent,
    chatMessageStorageKey,
    chatMessageWindow,
    chatProcessByKey,
    chatStreamingByKey,
    cleanActivityTitle,
    collectorKey,
    createAgentProfile,
    dedupeAgents,
    discoveredMachines,
    displayMachineName,
    fleetAgentState,
    fleetMachineLocation,
    fleetMetric,
    fleetSnapshots,
    fleetVersionState,
    formatRelativeTime,
    getHoneyAgentRewards,
    getSurvivalSnapshot,
    groupKanbanTasks,
    groupNotifications,
    hermesUpdateRequiredDetail,
    hiveEnv,
    hiveEnvRuntimeSourceId,
    honeyTreasury,
    hydrated,
    inferCurrentTask,
    inferLatestAgentMessage,
    isChatSidebarTask,
    isLoopbackCollector,
    isManualAgentChatMessage,
    isMeaningfulActive,
    isMobileMachineOs,
    isStarterPlaceholder,
    isVisibleFleetMachine,
    isWorkView,
    kanbanAssignees,
    kanbanBoard,
    kanbanBoardScrollRef,
    kanbanError,
    kanbanIncludeArchived,
    kanbanLoading,
    kanbanTaskAssigneeAgent,
    machineIdentityFromParts,
    machineNameAliases,
    machineNeedsChatBridgeRepair,
    machineNeedsEnvHttpSyncRepair,
    machineNeedsSkillSyncRepair,
    machineNetworkIssue,
    maintenanceReport,
    messagesByAgent,
    messagesScrollRef,
    mirosharkAnalysisAgentId,
    mirosharkStatus,
    moneyClawLoadingEnvName,
    moneyClawStatusByEnvName,
    normalizeAgentProfile,
    notificationActorMeta,
    notificationDisplayBody,
    notificationDisplayTitle,
    notificationSourceLabel,
    notificationSummary,
    notifications,
    parseEnvImportText,
    quickAddMachineTargets,
    refreshMoneyClawStatus,
    refreshRuntimeIntegrations,
    refreshSharedSchedulesFromVault,
    runtimeCan,
    runtimeCount,
    runtimeFileRoots,
    runtimeUsage,
    schedulerSkillSearch,
    schedules,
    selectedAgentId,
    selectedBrainNodeId,
    selectedChatLeafKey,
    selectedChatPreview,
    selectedKanbanTaskId,
    selectedKanbanTaskIds,
    setKanbanBoardScrollState,
    setMachineNameAliases,
    setScheduleDraft,
    setupMachineKey,
    sharedEnvImportText,
    sharedVault,
    skillBrowserSearch,
    skillBrowserSkills,
    tailscaleDevices,
    tailscaleStatus,
    tasks,
    updateStatusByMachine,
    walletExpanded,
    walletsByAgent,
    workPriority,
    suppressedDiscoveredAgentKeys = new Set(),
  } = props;
  const visibleConfiguredAgents = useMemo(
    () => filterSuppressedAgents(agents, suppressedDiscoveredAgentKeys),
    [agents, suppressedDiscoveredAgentKeys],
  );
  const discoveredAgents = useMemo(
    () =>
      filterSuppressedAgents(
        discoveredMachines
          .flatMap((machine) => machine.agents ?? [])
          .map(normalizeAgentProfile),
        suppressedDiscoveredAgentKeys,
      ),
    [discoveredMachines, normalizeAgentProfile, suppressedDiscoveredAgentKeys],
  );

  const agentAliases = useMemo(
    () => agentAliasMap(visibleConfiguredAgents, discoveredAgents),
    [visibleConfiguredAgents, discoveredAgents],
  );

  const candidateAgents = useMemo(
    () => dedupeAgents(visibleConfiguredAgents, discoveredAgents),
    [dedupeAgents, visibleConfiguredAgents, discoveredAgents],
  );

  const candidateWorkById = useMemo(() => {
    const idsForAgent = (agentId: string) => [
      agentId,
      ...[...agentAliases.entries()]
        .filter(([, canonicalId]) => canonicalId === agentId)
        .map(([aliasId]) => aliasId),
    ];
    return Object.fromEntries(
      candidateAgents.map((agent) => {
        const relatedIds = idsForAgent(agent.id);
        const agentTasks = tasks
          .filter((task) => relatedIds.includes(task.agentId))
          .map((task) => ({ ...task, agentId: agent.id }))
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const observedTasks = relatedIds.flatMap(
          (agentId) => fleetSnapshots[agentId]?.tasks ?? [],
        );
        const transcript = relatedIds.flatMap(
          (agentId) => messagesByAgent[agentId] ?? [],
        );
        const transcriptTask: AgentTask | null =
          transcript.length > 0
            ? {
                id: `recent-${agent.id}`,
                agentId: agent.id,
                title: inferCurrentTask(transcript),
                lastMessage: inferLatestAgentMessage(transcript),
                status: "completed",
                startedAt: 0,
                updatedAt: 0,
                source: "dashboard-chat",
              }
            : null;
        const work = [
          ...agentTasks,
          ...observedTasks,
          ...(transcriptTask &&
          agentTasks.length === 0 &&
          observedTasks.length === 0
            ? [transcriptTask]
            : []),
        ]
          .filter(
            (task, index, list) =>
              list.findIndex((item) => item.id === task.id) === index,
          )
          .sort(
            (a, b) =>
              workPriority(b) - workPriority(a) || b.updatedAt - a.updatedAt,
          );
        return [agent.id, work];
      }),
    );
  }, [
    agentAliases,
    candidateAgents,
    discoveredAgents,
    fleetSnapshots,
    messagesByAgent,
    tasks,
  ]);

  const displayAgents = useMemo(
    () =>
      candidateAgents.filter(
        (agent) =>
          !isStarterPlaceholder(agent, candidateWorkById, messagesByAgent),
      ),
    [candidateAgents, candidateWorkById, messagesByAgent],
  );

  useEffect(() => {
    if (!hydrated || !sharedVault.enabled) return;
    void refreshSharedSchedulesFromVault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    sharedVault.enabled,
    sharedVault.vaultPath,
    sharedVault.scheduledFolder,
    displayAgents.length,
  ]);

  const agentWorkById = useMemo(() => {
    return Object.fromEntries(
      displayAgents.map((agent) => [
        agent.id,
        candidateWorkById[agent.id] ?? [],
      ]),
    );
  }, [candidateWorkById, displayAgents]);

  const effectiveSelectedAgentId =
    agentAliases.get(selectedAgentId) ?? selectedAgentId;

  const selectedAgent = useMemo(() => {
    const matchedAgent = displayAgents.find(
      (agent) => agent.id === effectiveSelectedAgentId,
    );
    if (matchedAgent) return matchedAgent;
    if (
      activeView === "chat" &&
      selectedChatLeafKey &&
      effectiveSelectedAgentId
    )
      return null;
    return displayAgents[0];
  }, [
    activeView,
    displayAgents,
    effectiveSelectedAgentId,
    selectedChatLeafKey,
  ]);
  const selectedChatStorageKey = selectedAgent
    ? chatMessageStorageKey(selectedAgent.id, selectedChatLeafKey)
    : "";
  const selectedChatStreamState = selectedChatStorageKey
    ? chatStreamingByKey?.[selectedChatStorageKey]
    : null;
  const selectedChatStreaming = Boolean(selectedChatStreamState);
  const selectedChatHasStreamingChunk = Boolean(
    selectedChatStreamState?.hasChunk,
  );
  const selectedChatProcess = useMemo(() => {
    if (!selectedChatStorageKey || !selectedChatStreamState) return [];
    const processEvents = chatProcessByKey?.[selectedChatStorageKey] ?? [];
    const runId = selectedChatStreamState.runId;
    const startedAt = Number(selectedChatStreamState.startedAt || 0);
    return processEvents.filter(
      (event: any) =>
        (!runId || !event.runId || event.runId === runId) &&
        (!startedAt || !event.at || event.at >= startedAt - 2_000),
    );
  }, [chatProcessByKey, selectedChatStorageKey, selectedChatStreamState]);

  useEffect(() => {
    if (!hydrated || activeView !== "swarm") return;
    const agentId = mirosharkAnalysisAgentId || selectedAgent?.id;
    const agent =
      displayAgents.find((item) => item.id === agentId) ?? selectedAgent;
    if (!agent || !runtimeCan(agent, "modelSelection")) return;
    void refreshRuntimeIntegrations(agent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeView,
    displayAgents,
    hydrated,
    mirosharkAnalysisAgentId,
    selectedAgent?.id,
  ]);

  const sharedSkillOptions = useMemo(() => {
    const deduped = new Map<
      string,
      { slug: string; name: string; description: string }
    >();
    for (const skill of brainSkills?.shared ?? []) {
      deduped.set(skill.slug, {
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
      });
    }
    for (const provider of brainSkills?.providers ?? []) {
      for (const skill of provider.skills) {
        if (!deduped.has(skill.slug))
          deduped.set(skill.slug, {
            slug: skill.slug,
            name: skill.name,
            description: skill.description,
          });
      }
    }
    return [...deduped.values()];
  }, [brainSkills]);

  const filteredSkillBrowserSkills = useMemo(() => {
    const query = skillBrowserSearch.trim().toLowerCase();
    if (!query) return skillBrowserSkills;
    return skillBrowserSkills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.slug.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.source.toLowerCase().includes(query) ||
        skill.category?.toLowerCase().includes(query) ||
        skill.audience?.toLowerCase().includes(query) ||
        skill.safety?.toLowerCase().includes(query) ||
        skill.capabilities?.some((capability) =>
          capability.toLowerCase().includes(query),
        ) ||
        skill.includedSkills?.some(
          (includedSkill) =>
            includedSkill.name.toLowerCase().includes(query) ||
            includedSkill.slug.toLowerCase().includes(query) ||
            includedSkill.description.toLowerCase().includes(query),
        ),
    );
  }, [skillBrowserSearch, skillBrowserSkills]);

  const hermesUpdateRequired = Boolean(hermesUpdateRequiredDetail);

  const filteredSchedulerSkills = useMemo(() => {
    const query = schedulerSkillSearch.trim().toLowerCase();
    if (!query) return sharedSkillOptions;
    return sharedSkillOptions.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.slug.toLowerCase().includes(query),
    );
  }, [schedulerSkillSearch, sharedSkillOptions]);

  useEffect(() => {
    if (!displayAgents.length) return;
    const nextAgentId = selectedAgent?.id ?? displayAgents[0]?.id ?? "";
    const handle = window.setTimeout(() => {
      setScheduleDraft((current) =>
        current.agentId ? current : { ...current, agentId: nextAgentId },
      );
    }, 0);
    return () => window.clearTimeout(handle);
  }, [displayAgents, selectedAgent?.id]);

  const selectedBrainNode = useMemo(
    () =>
      brainGraph?.nodes.find((node) => node.id === selectedBrainNodeId) ??
      brainGraph?.nodes[0] ??
      null,
    [brainGraph, selectedBrainNodeId],
  );

  const visibleBrainNodes = useMemo(
    () => (brainGraph?.nodes ?? []).slice(0, 72),
    [brainGraph],
  );

  const brainLayout = useMemo(
    () => brainGraphLayout(visibleBrainNodes),
    [visibleBrainNodes],
  );

  const brainGraphStats = useMemo(() => {
    const notes =
      brainGraph?.nodes.filter((node) => !node.id.startsWith("unresolved:"))
        .length ?? 0;
    const accessed =
      brainGraph?.nodes.filter((node) => node.accessCount > 0).length ?? 0;
    return {
      notes,
      links: brainGraph?.links.length ?? 0,
      accessed,
      recent: brainGraph?.recentAccesses.length ?? 0,
    };
  }, [brainGraph]);

  const selectedBrainTargetIds = useMemo(() => {
    if (!brainGraph || !selectedBrainNode) return new Set<string>();
    const targetIds = new Set<string>();
    for (const link of brainGraph.links) {
      if (
        link.source === selectedBrainNode.id &&
        brainLayout.positions.has(link.target)
      )
        targetIds.add(link.target);
      if (
        link.target === selectedBrainNode.id &&
        brainLayout.positions.has(link.source)
      )
        targetIds.add(link.source);
    }
    return targetIds;
  }, [brainGraph, brainLayout.positions, selectedBrainNode]);

  const messages = useMemo(() => {
    if (!selectedAgent) return [];
    if (
      selectedChatPreview &&
      selectedChatPreview.agentId === selectedAgent.id &&
      selectedChatPreview.leafKey === selectedChatLeafKey
    ) {
      return splitCombinedUserAssistantMessages(
        chatMessageWindow?.agentId === selectedAgent.id
          ? selectedChatPreview.messages.slice(-chatMessageWindow.limit)
          : selectedChatPreview.messages,
      );
    }
    const selectedStorageKey = chatMessageStorageKey(
      selectedAgent.id,
      selectedChatLeafKey,
    );
    const selectedLeafMessages =
      selectedStorageKey !== selectedAgent.id
        ? (messagesByAgent[selectedStorageKey]?.filter(
            isManualAgentChatMessage,
          ) ?? [])
        : [];
    if (selectedLeafMessages.length) {
      return splitCombinedUserAssistantMessages(
        chatMessageWindow?.agentId === selectedAgent.id
          ? selectedLeafMessages.slice(-chatMessageWindow.limit)
          : selectedLeafMessages,
      );
    }
    if (selectedStorageKey !== selectedAgent.id) return [];
    const relatedIds = [
      selectedAgent.id,
      ...[...agentAliases.entries()]
        .filter(([, canonicalId]) => canonicalId === selectedAgent.id)
        .map(([aliasId]) => aliasId),
    ];
    const mergedMessages = relatedIds
      .flatMap((agentId) => messagesByAgent[agentId] ?? [])
      .filter(isManualAgentChatMessage);
    const selectedMessages = mergedMessages.length
      ? mergedMessages
      : [
          {
            role: "system" as const,
            content: `Chatting with ${selectedAgent.name}. Pick a machine to start fresh, or resume a previous chat when one is listed.`,
          },
        ];
    return splitCombinedUserAssistantMessages(
      chatMessageWindow?.agentId === selectedAgent.id
        ? selectedMessages.slice(-chatMessageWindow.limit)
        : selectedMessages,
    );
  }, [
    agentAliases,
    chatMessageWindow,
    messagesByAgent,
    selectedAgent,
    selectedChatLeafKey,
    selectedChatPreview,
  ]);

  const lastAssistant = useMemo(
    () =>
      [...messages].reverse().find((message) => message.role === "assistant")
        ?.content ?? "",
    [messages],
  );

  function removeActiveTurnDuplicateMessages(items: ChatMessage[]) {
    const output: ChatMessage[] = [];
    const seenSourceKeys = new Set<string>();
    const sourceMessageKey = (message: ChatMessage | undefined) => {
      const sourceSessionId = String(message?.sourceSessionId ?? "").trim();
      const sourceIndex = Number.isFinite(message?.sourceIndex)
        ? String(message?.sourceIndex)
        : "";
      return sourceSessionId && sourceIndex
        ? `${sourceSessionId}:${sourceIndex}:${message?.role ?? "message"}`
        : "";
    };
    const sameMessage = (
      left: ChatMessage | undefined,
      right: ChatMessage | undefined,
    ) =>
      Boolean(left) &&
      Boolean(right) &&
      left?.role === right?.role &&
      (left?.content ?? "").replace(/\s+/g, " ").trim().toLowerCase() ===
        (right?.content ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const chatMessageHasActiveSurface = (message?: ChatMessage) =>
      Boolean(
        message &&
        (chatDisplayContent(message).trim() ||
          message.agentPrompt ||
          (message.processEvents?.length ?? 0) > 0 ||
          message.applicationGeneration ||
          message.imageGeneration),
      );
    const chatMessageHasGenerationSurface = (message?: ChatMessage) =>
      Boolean(message?.applicationGeneration || message?.imageGeneration);
    const mergeChatProcessEvents = (
      first: ChatMessage["processEvents"] = [],
      second: ChatMessage["processEvents"] = [],
    ) => {
      const output: NonNullable<ChatMessage["processEvents"]> = [];
      const indexByKey = new Map<string, number>();
      for (const event of [...(first ?? []), ...(second ?? [])]) {
        if (!event) continue;
        const key = [
          event.runId ?? "",
          event.label ?? "",
          event.detail ?? "",
          event.status ?? "",
        ].join("\u001f");
        const existingIndex = indexByKey.get(key);
        if (existingIndex === undefined) {
          indexByKey.set(key, output.length);
          output.push(event);
        } else if (
          Number(event.at ?? 0) >= Number(output[existingIndex]?.at ?? 0)
        ) {
          output[existingIndex] = event;
        }
      }
      return output
        .sort((left, right) => Number(left.at ?? 0) - Number(right.at ?? 0))
        .slice(-80);
    };
    const withPreservedProcessEvents = (
      nextMessage: ChatMessage,
      previousMessage?: ChatMessage,
    ) => {
      let next = nextMessage;
      const mergedProcessEvents = mergeChatProcessEvents(
        previousMessage?.processEvents,
        next.processEvents,
      );
      if (mergedProcessEvents.length) {
        next = { ...next, processEvents: mergedProcessEvents };
      }
      if (
        previousMessage?.applicationGeneration &&
        !next.applicationGeneration
      ) {
        next = {
          ...next,
          applicationGeneration: previousMessage.applicationGeneration,
        };
      }
      if (previousMessage?.imageGeneration && !next.imageGeneration) {
        next = { ...next, imageGeneration: previousMessage.imageGeneration };
      }
      return next;
    };
    const findLastMessageIndex = (
      messagesToSearch: ChatMessage[],
      predicate: (message: ChatMessage) => boolean,
    ) => {
      for (let index = messagesToSearch.length - 1; index >= 0; index -= 1) {
        if (predicate(messagesToSearch[index])) return index;
      }
      return -1;
    };
    for (let index = 0; index < items.length; index += 1) {
      const message = items[index];
      const sourceKey = sourceMessageKey(message);
      if (sourceKey && seenSourceKeys.has(sourceKey)) {
        const previousIndex = findLastMessageIndex(
          output,
          (item) => sourceMessageKey(item) === sourceKey,
        );
        const previous = output[previousIndex];
        if (
          previousIndex >= 0 &&
          !chatDisplayContent(previous).trim() &&
          chatDisplayContent(message).trim()
        ) {
          output[previousIndex] = withPreservedProcessEvents(message, previous);
        }
        continue;
      }
      if (sameMessage(output.at(-1), message)) {
        const previous = output.at(-1);
        if (
          (message.processEvents?.length ?? 0) > 0 &&
          !(previous?.processEvents?.length ?? 0)
        ) {
          output[output.length - 1] = {
            ...previous,
            processEvents: message.processEvents,
          } as ChatMessage;
        }
        continue;
      }
      if (sourceKey) seenSourceKeys.add(sourceKey);
      if (message.role === "user" && message.content.trim()) {
        const previousUserIndex = findLastMessageIndex(output, (item) =>
          sameMessage(item, message),
        );
        const between =
          previousUserIndex >= 0 ? output.slice(previousUserIndex + 1) : [];
        const onlyPendingAssistantBetween =
          between.length > 0 &&
          between.every(
            (item) =>
              item.role === "assistant" && !chatMessageHasActiveSurface(item),
          );
        if (onlyPendingAssistantBetween) continue;
        const nextAssistant = items[index + 1];
        const previousAssistant = [...between]
          .reverse()
          .find(
            (item) =>
              item.role === "assistant" && chatMessageHasActiveSurface(item),
          );
        if (
          nextAssistant?.role === "assistant" &&
          previousAssistant &&
          sameMessage(previousAssistant, nextAssistant)
        ) {
          const previousAssistantIndex = findLastMessageIndex(output, (item) =>
            sameMessage(item, previousAssistant),
          );
          if (previousAssistantIndex >= 0) {
            output[previousAssistantIndex] = withPreservedProcessEvents(
              output[previousAssistantIndex],
              nextAssistant,
            );
          }
          index += 1;
          continue;
        }
      }
      if (
        message.role === "assistant" &&
        chatMessageHasActiveSurface(message)
      ) {
        const currentUser = [...output]
          .reverse()
          .find((item) => item.role === "user");
        const previousCardAssistantIndex = findLastMessageIndex(
          output,
          (item) =>
            item.role === "assistant" && chatMessageHasGenerationSurface(item),
        );
        const previousCardUser = [
          ...output.slice(0, previousCardAssistantIndex),
        ]
          .reverse()
          .find((item) => item.role === "user");
        if (
          previousCardAssistantIndex >= 0 &&
          sameMessage(previousCardUser, currentUser) &&
          !sameMessage(output[previousCardAssistantIndex], message)
        ) {
          output[previousCardAssistantIndex] = withPreservedProcessEvents(
            message,
            output[previousCardAssistantIndex],
          );
          continue;
        }
        const previousAssistantIndex = findLastMessageIndex(output, (item) =>
          sameMessage(item, message),
        );
        const previousUser = [...output.slice(0, previousAssistantIndex)]
          .reverse()
          .find((item) => item.role === "user");
        if (
          previousAssistantIndex >= 0 &&
          sameMessage(previousUser, currentUser)
        ) {
          output[previousAssistantIndex] = withPreservedProcessEvents(
            message,
            output[previousAssistantIndex],
          );
          continue;
        }
      }
      output.push(message);
    }
    return output;
  }

  const visibleMessages = useMemo(() => {
    const displayMessages = messages.flatMap(splitCombinedUserAssistantMessage);
    const latestUserIndex = (() => {
      for (let index = displayMessages.length - 1; index >= 0; index -= 1) {
        if (displayMessages[index]?.role === "user") return index;
      }
      return -1;
    })();
    const lastAssistantIndex = (() => {
      for (let index = displayMessages.length - 1; index >= 0; index -= 1) {
        if (displayMessages[index]?.role === "assistant") return index;
      }
      return -1;
    })();
    return removeActiveTurnDuplicateMessages(
      displayMessages.filter(
        (message, index) =>
          message.role !== "system" &&
          (message.role !== "assistant" ||
            (selectedChatStreaming && index > latestUserIndex) ||
            chatDisplayContent(message).trim() ||
            message.agentPrompt ||
            (message.processEvents?.length ?? 0) > 0 ||
            message.applicationGeneration ||
            message.imageGeneration ||
            (selectedChatProcess.length > 0 && index === lastAssistantIndex)),
      ),
    );
  }, [messages, selectedChatProcess.length, selectedChatStreaming]);

  const sessionNotice = useMemo(
    () =>
      [...messages].reverse().find((message) => message.role === "system")
        ?.content ?? "",
    [messages],
  );

  useEffect(() => {
    chatAutoScrollRef.current = true;
  }, [chatAutoScrollRef, selectedAgentId, selectedChatLeafKey]);

  const updateChatAutoScroll = useCallback(() => {
    const element = messagesScrollRef.current;
    if (!element) return;
    chatAutoScrollRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 180;
  }, []);

  const mobileDashboardViewer = useMemo(() => {
    if (!hydrated || typeof navigator === "undefined") return false;
    return /Android|iPhone|iPad|iPod|Mobile|CriOS|FxiOS/i.test(
      navigator.userAgent,
    );
  }, [hydrated]);

  const dashboardHostName = useCallback(
    (name: string, self?: boolean, os?: string) =>
      displayMachineName(name, self, {
        os,
        mobileViewer: mobileDashboardViewer,
      }),
    [displayMachineName, mobileDashboardViewer],
  );

  const machineGroups = useMemo<MachineGroup[]>(() => {
    const discoveryByKey = new Map(
      discoveredMachines.map((machine) => [
        collectorKey(machine.device.collectorUrl),
        machine,
      ]),
    );
    const selfDevice = tailscaleDevices.find((device) => device.self);
    const groups = tailscaleDevices.map((device) => {
      const discovered = discoveryByKey.get(collectorKey(device.collectorUrl));
      return {
        key: collectorKey(device.collectorUrl) || device.name,
        name: dashboardHostName(device.name, device.self, device.os),
        address: device.ip || device.dnsName,
        collectorUrl: device.collectorUrl,
        dnsName: device.dnsName,
        ip: device.ip,
        os: device.os,
        relay: device.relay,
        lastHandshake: device.lastHandshake,
        curAddr: device.curAddr,
        rxBytes: device.rxBytes,
        txBytes: device.txBytes,
        active: device.active,
        online: device.online,
        self: device.self,
        collector: (discovered?.collector ??
          "unknown") as MachineGroup["collector"],
        agents: [] as AgentProfile[],
        version: discovered?.version,
        machineId: discovered?.machineId,
        capabilities: discovered?.capabilities,
        envSync: discovered?.envSync,
        system: discovered?.system,
        lastSeenAt: discovered?.lastSeenAt,
      };
    });
    discoveredMachines.forEach((machine) => {
      const key = collectorKey(machine.device.collectorUrl);
      if (!key || groups.some((group) => group.key === key)) return;
      if (
        machine.device.self &&
        isLoopbackCollector(machine.device.collectorUrl) &&
        groups.some(
          (group) => group.self && !isLoopbackCollector(group.collectorUrl),
        )
      ) {
        return;
      }
      groups.push({
        key,
        name: dashboardHostName(
          machine.device.name,
          machine.device.self,
          machine.device.os,
        ),
        address:
          machine.device.ip || machine.device.dnsName || "Local agent bridge",
        collectorUrl: machine.device.collectorUrl,
        dnsName: machine.device.dnsName,
        ip: machine.device.ip,
        os: machine.device.os,
        relay: machine.device.relay,
        lastHandshake: machine.device.lastHandshake,
        curAddr: machine.device.curAddr,
        rxBytes: machine.device.rxBytes,
        txBytes: machine.device.txBytes,
        active: machine.device.active,
        online: machine.device.online,
        self: machine.device.self,
        collector: machine.collector,
        agents: [],
        version: machine.version,
        machineId: machine.machineId,
        capabilities: machine.capabilities,
        envSync: machine.envSync,
        system: machine.system,
        lastSeenAt: machine.lastSeenAt,
      });
    });
    const dedupeMachineGroups = (items: MachineGroup[]) => {
      const byIdentity = new Map<string, MachineGroup>();
      const score = (machine: MachineGroup) =>
        (machine.self ? 10_000 : 0) +
        (machine.collector === "ready" ? 1_000 : 0) +
        machine.agents.length * 10 +
        (machine.online ? 5 : 0);
      const stableMachineId = (item: MachineGroup) => {
        const machineId =
          item.collector === "ready"
            ? (item.machineId?.trim().toLowerCase() ?? "")
            : "";
        return /^hivemind-machine-[a-f0-9]{32}$/.test(machineId)
          ? machineId
          : "";
      };
      // Bridge machineId keys to name-identity keys: a bare tailscale device
      // (no collector probe, so no machineId) must still merge with the
      // discovered copy of the same machine, which is keyed by machineId.
      // Identities claimed by more than one machineId are ambiguous (distinct
      // physical machines whose names collide after -N stripping), so leave
      // those unbridged rather than merging a shadow into the wrong machine.
      const machineIdByNameIdentity = new Map<string, string>();
      for (const item of items) {
        const machineId = stableMachineId(item);
        if (!machineId) continue;
        // Register the exact name identity alongside machineIdentityFromParts:
        // the self machine resolves to "self" there, but its own embedded link
        // node can show up as a separate tailnet device whose only handle is
        // the exact identity ("liamsmacbookpro") — without this entry that
        // shadow never bridges to the real machine.
        const identities = new Set(
          [
            machineIdentityFromParts(item),
            machineExactIdentity(item.name, item.dnsName),
          ].filter(Boolean),
        );
        for (const nameIdentity of identities) {
          const claimed = machineIdByNameIdentity.get(nameIdentity);
          machineIdByNameIdentity.set(
            nameIdentity,
            claimed && claimed !== machineId ? "" : machineId,
          );
        }
      }
      for (const item of items) {
        const nameIdentity = machineIdentityFromParts(item);
        const key =
          stableMachineId(item) ||
          machineIdByNameIdentity.get(nameIdentity) ||
          nameIdentity;
        const previous = byIdentity.get(key);
        if (!previous) {
          byIdentity.set(key, item);
          continue;
        }
        const preferred = score(item) > score(previous) ? item : previous;
        const agents = [...previous.agents, ...item.agents].filter(
          (agent, index, all) =>
            all.findIndex((candidate) => candidate.id === agent.id) === index,
        );
        byIdentity.set(key, { ...preferred, agents });
      }
      return [...byIdentity.values()];
    };
    const unassigned: MachineGroup = {
      key: "unassigned",
      name: "Saved profiles",
      address:
        "These agents are not matched to a discovered machine; they may still chat through their configured runtime URL.",
      collectorUrl: "",
      dnsName: "",
      ip: "",
      os: "",
      relay: "",
      online: false,
      self: false,
      collector: "missing",
      agents: [],
    };

    for (const agent of displayAgents) {
      const explicitKey = collectorKey(agent.telemetryUrl);
      const localDataDir = agent.localDataDir ?? "";
      const looksLikeLocalHomePath =
        localDataDir.startsWith("~") ||
        localDataDir.startsWith("$home") ||
        localDataDir.startsWith("/Users/") ||
        /^[a-zA-Z]:[\\/]/.test(localDataDir) || // Windows drive root (C:\Users\...)
        localDataDir.startsWith("\\\\"); // Windows UNC path
      const localKey =
        selfDevice && looksLikeLocalHomePath
          ? collectorKey(selfDevice.collectorUrl)
          : "";
      const explicitGroup = explicitKey
        ? groups.find((item) => item.key === explicitKey)
        : undefined;
      const localGroup = localKey
        ? groups.find((item) => item.key === localKey)
        : undefined;
      const group = explicitGroup ?? localGroup;
      if (group) {
        group.agents.push(agent);
      } else {
        unassigned.agents.push(agent);
      }
    }

    const visibleGroups = dedupeMachineGroups(groups)
      .filter(isVisibleFleetMachine)
      .map((machine) => ({
        ...machine,
        name: machineNameAliases[machine.key]?.trim() || machine.name,
      }));
    return unassigned.agents.length > 0
      ? [...visibleGroups, unassigned]
      : visibleGroups;
  }, [
    dashboardHostName,
    displayAgents,
    discoveredMachines,
    machineNameAliases,
    tailscaleDevices,
  ]);

  const renameMachine = useCallback(
    (machineId: string, nextName: string) => {
      const normalized = nextName.trim();
      setMachineNameAliases((current) => {
        const next = { ...current };
        if (normalized) {
          next[machineId] = normalized;
        } else {
          delete next[machineId];
        }
        return next;
      });
      if (sharedVault.enabled) {
        void fetch("/api/obsidian/machine-aliases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vaultPath: sharedVault.vaultPath.trim() || undefined,
            machineKey: machineId,
            name: normalized,
          }),
        }).catch(() => {
          /* local alias still persists */
        });
      }
    },
    [sharedVault.enabled, sharedVault.vaultPath],
  );

  const kanbanMachineTargets = useMemo<KanbanMachineTarget[]>(
    () =>
      machineGroups
        .filter(
          (machine) =>
            machine.key !== "unassigned" &&
            machine.collector === "ready" &&
            machine.agents.length > 0,
        )
        .map((machine) => ({
          key: machine.key,
          name: dashboardHostName(machine.name, machine.self, machine.os),
          collectorUrl: machine.collectorUrl,
        })),
    [dashboardHostName, machineGroups],
  );

  const localKanbanMachineTarget = useMemo(
    () =>
      kanbanMachineTargets.find((machine) =>
        isLoopbackCollector(machine.collectorUrl),
      ) ?? null,
    [kanbanMachineTargets],
  );

  const quickAddMachineTarget = useCallback(
    (status: KanbanStatus) =>
      Object.prototype.hasOwnProperty.call(quickAddMachineTargets, status)
        ? (quickAddMachineTargets[status] ?? null)
        : localKanbanMachineTarget,
    [localKanbanMachineTarget, quickAddMachineTargets],
  );

  const agentsForKanbanTask = useCallback(
    (task: KanbanTask) => {
      const target = task.targetMachine;
      if (!target?.key) return displayAgents;
      const targetKey = collectorKey(target.collectorUrl) || target.key;
      return displayAgents.filter((agent) => {
        const agentKey = collectorKey(agent.telemetryUrl);
        if (agentKey && agentKey === targetKey) return true;
        return Boolean(agent.machineName && agent.machineName === target.name);
      });
    },
    [displayAgents],
  );

  const visibleAgentCount = useMemo(
    () =>
      machineGroups.reduce(
        (total, machine) => total + machine.agents.length,
        0,
      ),
    [machineGroups],
  );

  const fleetViewData = useMemo(() => {
    // O(1) lookups for the tasks/alerts loops below. Previously each work item
    // and each agent did a linear displayAgents.find + machineGroups.find (with
    // an inner .some), i.e. O(tasks * agents * machines) on every recompute.
    const agentById = new Map(displayAgents.map((item) => [item.id, item]));
    const machineByAgentId = new Map<string, (typeof machineGroups)[number]>();
    machineGroups.forEach((group) => {
      group.agents.forEach((item) => machineByAgentId.set(item.id, group));
    });
    const rosterMachineGroups = machineGroups.filter(
      (machine) =>
        machine.key !== "unassigned" &&
        (machine.collector === "ready" ||
          machine.self ||
          machine.online ||
          machine.agents.length > 0),
    );
    const machines: FleetMachine[] = rosterMachineGroups.map(
      (machine, index) => {
        const location = fleetMachineLocation(machine, index);
        const mobile = isMobileMachineOs(machine.os);
        const versionState = fleetVersionState(machine);
        const canUpdate =
          !mobile &&
          machine.collector === "ready" &&
          (versionState === "stale" ||
            machineNeedsChatBridgeRepair(machine) ||
            machineNeedsEnvHttpSyncRepair(machine) ||
            machineNeedsSkillSyncRepair(machine));
        return {
          id: machine.key,
          name: dashboardHostName(machine.name, machine.self, machine.os),
          kind: mobile
            ? "Mobile"
            : machine.self
              ? "Desktop"
              : machine.collector === "ready"
                ? machine.capabilities?.collectorOnly
                  ? "Collector Node"
                  : "Tailnet Node"
                : "Setup Target",
          role: mobile
            ? "Roaming"
            : machine.self
              ? "Primary"
              : machine.collector === "ready"
                ? "Workhorse"
                : "Pending",
          os: mobile
            ? (machine.os ?? "Mobile")
            : machine.version?.branch
              ? `${machine.version.branch} · ${machine.version.shortCommit ?? "local"}`
              : machine.collector === "ready"
                ? "Agent bridge online"
                : "Agent bridge pending",
          tailnet:
            machine.dnsName ||
            machine.collectorUrl ||
            machine.address ||
            "not connected",
          ip: machine.ip || machine.address || "—",
          collectorUrl: machine.collectorUrl,
          ping: machine.online ? fleetMetric(machine.key, 4, 68) : 0,
          cpu:
            machine.system?.cpuPct ??
            fleetMetric(
              `${machine.key}:cpu`,
              machine.collector === "ready" ? 12 : 2,
              machine.collector === "ready" ? 82 : 18,
            ),
          ram:
            machine.system?.ramPct ?? fleetMetric(`${machine.key}:ram`, 18, 86),
          disk:
            machine.system?.diskPct ??
            fleetMetric(`${machine.key}:disk`, 12, 88),
          system: machine.system,
          version: machine.version?.shortCommit
            ? `build ${machine.version.shortCommit}`
            : machine.collector === "ready"
              ? "current"
              : "—",
          versionState,
          canUpdate,
          location: location.location,
          city: location.city,
          lat: location.lat,
          lon: location.lon,
          uptime: machine.online ? "online" : "offline",
          networkIssue: machineNetworkIssue(machine, tailscaleStatus),
          agents: machine.agents.map((agent) => {
            const agentWork = agentWorkById[agent.id] ?? [];
            const activeCount = agentWork.filter(isMeaningfulActive).length;
            const snapshot = fleetSnapshots[agent.id];
            const primaryWork = agentWork[0];
            const recentChats: FleetAgentChat[] = agentWork
              .filter(isChatSidebarTask)
              .slice(0, 3)
              .map((work) => ({
                id: work.id,
                title: cleanActivityTitle(
                  work.title || work.lastMessage || "Previous chat",
                ),
                task: cleanActivityTitle(
                  work.title || work.lastMessage || "Previous chat",
                ),
                since:
                  work.updatedAt > 0
                    ? formatRelativeTime(work.updatedAt)
                    : work.startedAt > 0
                      ? formatRelativeTime(work.startedAt)
                      : "—",
              }));
            const hasMachineWiring = Boolean(
              agent.telemetryUrl || machine.self,
            );
            const wallet = resolveAgentWallet(agent, walletsByAgent[agent.id]);
            const survival = getSurvivalSnapshot(wallet);
            const primaryWorkFailed = primaryWork?.status === "failed";
            const primaryWorkFailureText = [
              primaryWork?.title,
              primaryWork?.lastMessage,
              primaryWork?.sourceDetail,
            ].join("\n");
            const snapshotErrorIsFailure = FLEET_ALERT_ERROR_PATTERN.test(
              snapshot?.error ?? "",
            );
            const activityStatus = primaryWork
              ? primaryWork.source === "hermes-state" &&
                primaryWorkFailed &&
                !FLEET_ALERT_ERROR_PATTERN.test(primaryWorkFailureText)
                ? "unknown"
                : primaryWork.status
              : snapshotErrorIsFailure
                ? "failed"
                : undefined;
            return {
              id: agent.id,
              name: agent.name,
              runtime: RUNTIME_LABELS[agent.runtime],
              canChat: runtimeCan(agent, "chat"),
              state: fleetAgentState(
                agent,
                snapshot,
                activeCount,
                hasMachineWiring,
              ),
              role: beeRoleLabel(agent.beeRole),
              beeRole: agent.beeRole,
              workerClass: agent.workerClass ?? "general",
              customWorkerClass: agent.customWorkerClass,
              customWorkerClasses: agent.customWorkerClasses,
              selectedCustomWorkerClassId: agent.selectedCustomWorkerClassId,
              wallet: wallet.enabled
                ? `$${survival.effectiveBalanceUsd.toFixed(2)}`
                : "off",
              balance: wallet.enabled
                ? survival.tier === "dead" || survival.tier === "critical"
                  ? "dead"
                  : survival.tier === "low_compute"
                    ? "low_compute"
                    : "healthy"
                : "off",
              task: primaryWork
                ? cleanActivityTitle(primaryWork.title)
                : snapshot?.summary || "Idle · waiting for the next handoff",
              currentTaskId: primaryWork?.id,
              currentTaskUpdatedAt: primaryWork?.updatedAt,
              activityStatus,
              capabilities: fleetAgentCapabilityBadges(agent),
              since: primaryWork?.updatedAt
                ? formatRelativeTime(primaryWork.updatedAt)
                : snapshot?.checkedAt
                  ? formatRelativeTime(snapshot.checkedAt)
                  : "—",
              recentChats,
            };
          }),
        };
      },
    );

    const edges: Array<[string, string]> = machines
      .slice(1)
      .map((machine) => [machines[0]?.id ?? machine.id, machine.id]);
    const tasks: FleetTask[] = Object.entries(agentWorkById).flatMap(
      ([agentId, work]) => {
        const agent = agentById.get(agentId);
        const machine = machineByAgentId.get(agentId);
        return work.slice(0, 3).map(
          (task): FleetTask => ({
            id: task.id,
            title: cleanActivityTitle(task.title),
            agent: agent?.name ?? agentId,
            machine: machine?.name ?? "unassigned",
            state:
              task.status === "active"
                ? "in_progress"
                : task.status === "failed"
                  ? "blocked"
                  : task.status === "completed"
                    ? "done"
                    : "queue",
            priority: task.status === "failed" ? "high" : "med",
            eta: task.updatedAt ? formatRelativeTime(task.updatedAt) : "—",
            lane:
              task.status === "active"
                ? "doing"
                : task.status === "failed"
                  ? "blocked"
                  : task.status === "completed"
                    ? "done"
                    : "queue",
          }),
        );
      },
    );
    const machineAlertTimestamp = (machine: MachineGroup) => {
      const handshakeAt = machine.lastHandshake
        ? Date.parse(machine.lastHandshake)
        : 0;
      if (Number.isFinite(handshakeAt) && handshakeAt > 0) return handshakeAt;
      if (machine.lastSeenAt) return machine.lastSeenAt;
      return machine.online ? Date.now() : 0;
    };
    const alerts: FleetAlert[] = [
      ...notifications
        .filter(
          (notification) =>
            !notification.read &&
            (notification.priority === "urgent" ||
              notification.priority === "high"),
        )
        .slice(0, 12)
        .map((notification): FleetAlert => {
          const timestamp = new Date(notification.createdAt).getTime();
          return {
            id: `notification-${notification.id}`,
            tone: "danger",
            priority: notification.priority === "urgent" ? "urgent" : "high",
            title: notificationDisplayTitle(notification),
            agent: notificationActorMeta(notification).label,
            machine: notificationSourceLabel(notification) || "Alerts",
            text:
              notificationDisplayBody(notification)
                .split("\n")
                .find((line) => line.trim()) ?? notification.body,
            since: formatRelativeTime(timestamp),
            timestamp,
          };
        }),
      ...machineGroups
        .filter((machine) =>
          rosterMachineGroups.some((item) => item.key === machine.key),
        )
        .filter((machine) => machine.collector !== "ready")
        .map((machine): FleetAlert => {
          const timestamp = machineAlertTimestamp(machine);
          return {
            id: `machine-${machine.key}`,
            tone: machine.online ? "warn" : "danger",
            priority: machine.online ? "normal" : "high",
            title: machine.online
              ? `${machine.name} agent bridge setup pending`
              : `${machine.name} is offline`,
            agent: "agent bridge",
            machine: machine.name,
            text: machine.online
              ? "Agent bridge setup pending"
              : "Machine offline",
            since:
              timestamp > 0 ? formatRelativeTime(timestamp) : "no timestamp",
            timestamp: timestamp || undefined,
          };
        }),
      ...displayAgents.flatMap((agent) => {
        const snapshot = fleetSnapshots[agent.id];
        const machine = machineByAgentId.get(agent.id);
        if (snapshot?.error) {
          return [
            {
              id: `agent-${agent.id}-${fleetAlertFingerprint(snapshot.error)}`,
              tone: "danger" as const,
              priority: "high" as const,
              title: /remote agent bridge unavailable/i.test(snapshot.error)
                ? `${agent.name} bridge unavailable`
                : `${agent.name} reported an error`,
              agent: agent.name,
              machine: machine?.name ?? "unassigned",
              text: snapshot.error,
              since: formatRelativeTime(snapshot.checkedAt),
              timestamp: snapshot.checkedAt,
            },
          ];
        }
        if (snapshot?.warning) {
          const localFilesPrefix =
            "Runtime files are not available on this dashboard: ";
          const missingPath = snapshot.warning.startsWith(localFilesPrefix)
            ? snapshot.warning.slice(localFilesPrefix.length)
            : "";
          return [
            {
              id: `agent-warning-${agent.id}`,
              tone: "warn" as const,
              priority: "normal" as const,
              title:
                machine && !machine.self
                  ? `${agent.name} history not available on this Mac`
                  : `${agent.name} runtime folder not available`,
              agent: agent.name,
              machine: machine?.name ?? "unassigned",
              text:
                missingPath && machine && !machine.self
                  ? `Runtime files live on ${machine.name}; this dashboard cannot read ${missingPath}.`
                  : snapshot.warning,
              since: formatRelativeTime(snapshot.checkedAt),
              timestamp: snapshot.checkedAt,
            },
          ];
        }
        return [];
      }),
    ];
    const ticker = tasks
      .filter((task) => task.lane === "doing")
      .slice(0, 8)
      .map((task) => `${task.agent} :: ${task.title}`);
    return {
      machines,
      tasks,
      alerts,
      edges,
      ticker: ticker.length
        ? ticker
        : ["Fleet telemetry is connected · waiting for agent activity"],
    };
  }, [
    agentWorkById,
    dashboardHostName,
    displayAgents,
    fleetSnapshots,
    machineGroups,
    notifications,
    tailscaleStatus,
    walletsByAgent,
  ]);

  const fleetUpdateStatusByMachine = useMemo<
    Record<string, "updating" | "updated" | "failed">
  >(() => {
    return Object.fromEntries(
      Object.entries(updateStatusByMachine)
        .filter(([key, status]) => {
          if (status.tone === "working") return true;
          const machine = machineGroups.find((item) => item.key === key);
          if (!machine) return true;
          return (
            fleetVersionState(machine) === "stale" ||
            machineNeedsChatBridgeRepair(machine) ||
            machineNeedsEnvHttpSyncRepair(machine) ||
            machineNeedsSkillSyncRepair(machine)
          );
        })
        .map(([key, status]) => [
          key,
          status.tone === "working"
            ? "updating"
            : status.tone === "success"
              ? "updated"
              : "failed",
        ]),
    );
  }, [
    fleetVersionState,
    machineGroups,
    machineNeedsChatBridgeRepair,
    machineNeedsEnvHttpSyncRepair,
    machineNeedsSkillSyncRepair,
    updateStatusByMachine,
  ]);

  const fleetUpdateDetailByMachine = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(updateStatusByMachine)
          .filter(([key, status]) => {
            if (!status.detail) return false;
            if (status.tone === "working") return true;
            const machine = machineGroups.find((item) => item.key === key);
            if (!machine) return true;
            return (
              fleetVersionState(machine) === "stale" ||
              machineNeedsChatBridgeRepair(machine) ||
              machineNeedsEnvHttpSyncRepair(machine) ||
              machineNeedsSkillSyncRepair(machine)
            );
          })
          .map(([key, status]) => [
            key,
            { label: status.label, detail: status.detail },
          ]),
      ),
    [
      fleetVersionState,
      machineGroups,
      machineNeedsChatBridgeRepair,
      machineNeedsEnvHttpSyncRepair,
      machineNeedsSkillSyncRepair,
      updateStatusByMachine,
    ],
  );

  const kanbanColumns = useMemo(
    () => groupKanbanTasks(kanbanBoard?.tasks ?? [], kanbanIncludeArchived),
    [kanbanBoard, kanbanIncludeArchived],
  );
  const visibleKanbanColumns = useMemo(() => {
    const core = new Set<KanbanStatus>([
      "ideas",
      "ready",
      "working",
      "needs-human",
      "done",
    ]);
    return kanbanColumns.filter(
      (column) =>
        core.has(column.id) || column.tasks.length > 0 || kanbanIncludeArchived,
    );
  }, [kanbanColumns, kanbanIncludeArchived]);

  const selectedKanbanTask = useMemo(
    () =>
      kanbanBoard?.tasks.find((task) => task.id === selectedKanbanTaskId) ??
      null,
    [kanbanBoard, selectedKanbanTaskId],
  );

  const selectedKanbanComments = useMemo(
    () =>
      kanbanBoard?.comments
        .filter((comment) => comment.taskId === selectedKanbanTaskId)
        .sort((a, b) => b.createdAt - a.createdAt) ?? [],
    [kanbanBoard, selectedKanbanTaskId],
  );

  const selectedKanbanAgent = useMemo(
    () =>
      selectedKanbanTask
        ? (kanbanTaskAssigneeAgent(selectedKanbanTask, displayAgents) ?? null)
        : null,
    [displayAgents, selectedKanbanTask],
  );

  const selectedKanbanAgentMessages = useMemo(() => {
    if (!selectedKanbanTask || !selectedKanbanAgent) return [];
    const relatedIds = [
      selectedKanbanAgent.id,
      ...[...agentAliases.entries()]
        .filter(([, canonicalId]) => canonicalId === selectedKanbanAgent.id)
        .map(([aliasId]) => aliasId),
    ];
    return relatedIds
      .flatMap((agentId) => messagesByAgent[agentId] ?? [])
      .filter(
        (message) =>
          !message.kanbanTaskId ||
          message.kanbanTaskId === selectedKanbanTask.id,
      )
      .filter((message) => message.role !== "system" && message.content.trim())
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [agentAliases, messagesByAgent, selectedKanbanAgent, selectedKanbanTask]);

  const notificationGroups = useMemo(
    () => groupNotifications(notifications),
    [notifications],
  );

  const selectedKanbanEvents = useMemo(
    () =>
      kanbanBoard?.events
        .filter(
          (event) => !event.taskId || event.taskId === selectedKanbanTaskId,
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20) ?? [],
    [kanbanBoard, selectedKanbanTaskId],
  );

  const selectedKanbanBulkIds = useMemo(
    () =>
      Object.entries(selectedKanbanTaskIds)
        .filter(([, selected]) => selected)
        .map(([taskId]) => taskId),
    [selectedKanbanTaskIds],
  );

  const selectedWallet = useMemo(() => {
    if (!selectedAgent) return null;
    return resolveAgentWallet(selectedAgent, walletsByAgent[selectedAgent.id]);
  }, [selectedAgent, walletsByAgent]);

  const selectedWalletSnapshot = useMemo(
    () => (selectedWallet ? getSurvivalSnapshot(selectedWallet) : null),
    [selectedWallet],
  );

  useEffect(() => {
    if (
      !hydrated ||
      activeView !== "wallet" ||
      !walletExpanded ||
      !selectedAgent ||
      !selectedWallet
    )
      return;
    const envName =
      selectedWallet.moneyClawEnvName?.trim() || "MONEYCLAW_API_KEY";
    if (
      moneyClawStatusByEnvName[envName] ||
      moneyClawLoadingEnvName === envName
    )
      return;
    const timer = window.setTimeout(() => {
      void refreshMoneyClawStatus(selectedAgent.id);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeView,
    hydrated,
    moneyClawLoadingEnvName,
    moneyClawStatusByEnvName,
    selectedAgent,
    selectedWallet,
    walletExpanded,
  ]);

  const walletStats = useMemo(() => {
    const walletRows = displayAgents.map((agent) => ({
      agent,
      wallet: resolveAgentWallet(agent, walletsByAgent[agent.id]),
    }));
    const enabled = walletRows.filter(({ wallet }) => wallet.enabled);
    const survival = enabled.map(({ agent, wallet }) => ({
      agent,
      wallet,
      snapshot: getSurvivalSnapshot(wallet),
    }));
    return {
      enabled: enabled.length,
      critical: survival.filter(({ agent, snapshot }) => {
        const readyUsePodUnknown =
          agent.provider === "usepod" &&
          agent.usePod?.lastTestStatus === "ready" &&
          getUsePodBalanceUsd(agent.usePod) === null;
        return (
          !readyUsePodUnknown &&
          (snapshot.tier === "critical" || snapshot.tier === "dead")
        );
      }).length,
      balance: survival.reduce(
        (total, { snapshot }) =>
          total + Math.max(0, snapshot.effectiveBalanceUsd),
        0,
      ),
    };
  }, [displayAgents, walletsByAgent]);

  const honeyAgentRewards = useMemo(
    () =>
      getHoneyAgentRewards(
        displayAgents.map((agent) => agent.id),
        honeyTreasury,
      ),
    [displayAgents, honeyTreasury],
  );

  const selectedHoneyReward = useMemo(
    () =>
      selectedAgent
        ? (honeyAgentRewards.find(
            (reward) => reward.agentId === selectedAgent.id,
          ) ?? null)
        : null,
    [honeyAgentRewards, selectedAgent],
  );

  const honeyStats = useMemo(() => {
    const totalHoney = honeyAgentRewards.reduce(
      (total, reward) => total + reward.honeyEarned,
      0,
    );
    const availableHoney = honeyAgentRewards.reduce(
      (total, reward) => total + reward.honeyAvailable,
      0,
    );
    const legacyHive = honeyAgentRewards.reduce(
      (total, reward) => total + reward.hiveBalance,
      0,
    );
    const hiveQuote =
      Math.round(availableHoney * honeyTreasury.tokenPerHoney * 1_000_000) /
      1_000_000;
    return {
      totalHoney,
      availableHoney,
      legacyHive,
      hiveQuote,
      rewardPoolHive: honeyTreasury.rewardPoolHive,
      rewardPoolRemainingHive: honeyTreasury.rewardPoolRemainingHive,
      rewardPoolEmittedHive: honeyTreasury.rewardPoolEmittedHive,
      rewardPoolUsd: honeyTreasury.rewardPoolUsd,
      rewardPoolVolumeUsd: honeyTreasury.rewardPoolVolumeUsd,
      hivePerMillionTokens: honeyTreasury.hivePerMillionTokens,
      rewardPoolSharePercent: honeyTreasury.rewardPoolShareOfVolume * 100,
    };
  }, [honeyAgentRewards, honeyTreasury]);

  const kanbanAssigneeOptions = useMemo(() => {
    const local = displayAgents.map((agent) => agent.agentId || agent.id);
    return [...new Set([...local, ...kanbanAssignees].filter(Boolean))].sort();
  }, [displayAgents, kanbanAssignees]);

  const workBoardStats = useMemo(() => {
    const tasks = kanbanBoard?.tasks ?? [];
    const activeTasks = tasks.filter((task) => task.status !== "archived");
    return {
      working: tasks.filter((task) => task.status === "working").length,
      needsHuman: tasks.filter((task) => task.status === "needs-human").length,
      done: tasks.filter((task) => task.status === "done").length,
      total: activeTasks.length,
    };
  }, [kanbanBoard?.tasks]);

  const kanbanViewColumns = useMemo(() => {
    const displayCopy: Record<
      KanbanStatus,
      { title: string; description: string }
    > = {
      ideas: { title: "Ideas", description: "Captured but not picked up yet." },
      ready: {
        title: "Ready",
        description: "Scoped & ready for any free bee.",
      },
      working: { title: "Working", description: "A bee is on it right now." },
      "needs-human": {
        title: "Needs human",
        description: "Blocked — needs your call.",
      },
      done: { title: "Done", description: "Shipped today." },
      archived: { title: "Archived", description: "Out of the active board." },
    };
    return visibleKanbanColumns.map((column) => ({
      ...column,
      ...displayCopy[column.id],
    }));
  }, [visibleKanbanColumns]);
  const kanbanInitialLoading =
    activeView === "kanban" && kanbanLoading && !kanbanBoard && !kanbanError;

  const updateKanbanBoardScrollState = useCallback(() => {
    const element = kanbanBoardScrollRef.current;
    if (!element) {
      setKanbanBoardScrollState({
        canScrollLeft: false,
        canScrollRight: false,
      });
      return;
    }
    const maxScrollLeft = Math.max(
      0,
      element.scrollWidth - element.clientWidth,
    );
    const nextState = {
      canScrollLeft: element.scrollLeft > 4,
      canScrollRight: element.scrollLeft < maxScrollLeft - 4,
    };
    setKanbanBoardScrollState((current) =>
      current.canScrollLeft === nextState.canScrollLeft &&
      current.canScrollRight === nextState.canScrollRight
        ? current
        : nextState,
    );
  }, []);

  useEffect(() => {
    if (activeView !== "kanban") return undefined;
    const element = kanbanBoardScrollRef.current;
    const frame = window.requestAnimationFrame(updateKanbanBoardScrollState);
    element?.addEventListener("scroll", updateKanbanBoardScrollState, {
      passive: true,
    });
    window.addEventListener("resize", updateKanbanBoardScrollState);
    return () => {
      window.cancelAnimationFrame(frame);
      element?.removeEventListener("scroll", updateKanbanBoardScrollState);
      window.removeEventListener("resize", updateKanbanBoardScrollState);
    };
  }, [
    activeView,
    kanbanIncludeArchived,
    kanbanViewColumns.length,
    selectedKanbanTaskId,
    updateKanbanBoardScrollState,
  ]);

  const agentSpecificEnvCount = displayAgents
    .filter((agent) => runtimeUsesAgentEnvOverlay(agent.runtime))
    .reduce((sum, agent) => sum + Object.keys(agent.agentEnv ?? {}).length, 0);
  const sharedEnvSource = hiveEnv?.sharedSource ?? null;
  const runtimeEnvSources = hiveEnv?.runtimeSources ?? [];
  const selectedRuntimeEnvSource =
    runtimeEnvSources.find((source) => source.id === hiveEnvRuntimeSourceId) ??
    runtimeEnvSources[0] ??
    null;
  const sharedEnvCount = Object.keys(sharedEnvSource?.values ?? {}).length;
  const unsharedRuntimeEnvCount = runtimeEnvSources.reduce(
    (sum, source) => sum + Object.keys(source.values ?? {}).length,
    0,
  );
  const sharedBackupStatus = hiveEnv?.backupStatus ?? null;
  const sharedEnvImport = parseEnvImportText(
    sharedEnvImportText,
    sharedEnvSource?.values ?? {},
  );
  const sharedEnvImportDiff = sharedEnvImport.entries.filter(
    (entry) => entry.status !== "same",
  );
  const sharedEnvImportNewCount = sharedEnvImport.entries.filter(
    (entry) => entry.status === "new",
  ).length;
  const sharedEnvImportChangedCount = sharedEnvImport.entries.filter(
    (entry) => entry.status === "changed",
  ).length;
  const sharedEnvImportSameCount = sharedEnvImport.entries.filter(
    (entry) => entry.status === "same",
  ).length;
  const brainSkillImportableCount = brainSkills?.totals.importable ?? 0;
  const brainSkillImportableLabel =
    brainSkillImportableCount === 1 ? "skill" : "skills";
  const brainSkillImportAllLabel =
    brainSkillImportableCount > 0
      ? `Import ${brainSkillImportableCount} ${brainSkillImportableLabel} missing from shared brain`
      : "Shared brain current";
  const brainSkillImportAllDescription =
    brainSkillImportableCount > 0
      ? `Import ${brainSkillImportableCount} ${brainSkillImportableLabel} missing from shared brain`
      : "All discovered provider skills are already in the shared brain";

  const navItems = useMemo(
    () => [
      {
        id: "agents" as const,
        label: "Fleet",
        detail: `${visibleAgentCount} agents`,
      },
      {
        id: "kanban" as const,
        label: "Work",
        detail:
          activeView === "scheduler"
            ? `${schedules.filter((schedule) => schedule.enabled).length} active`
            : activeView === "swarm"
              ? mirosharkStatus?.ok
                ? "rehearsal ready"
                : "companion off"
              : `${kanbanBoard?.tasks.length ?? 0} tasks`,
      },
      {
        id: "wallet" as const,
        label: "Wallets",
        detail: runtimeUsage?.totals
          ? `${runtimeUsage.totals.tokens.toLocaleString()} tokens`
          : walletStats.critical > 0
            ? `${walletStats.critical} need funding`
            : `${walletStats.enabled} ready`,
      },
      {
        id: "vault" as const,
        label: "Brain",
        detail:
          activeView === "vault"
            ? `${sharedEnvCount} env · ${brainSkillImportableCount} ready`
            : sharedVault.enabled
              ? "enabled"
              : "off",
      },
      {
        id: "integrations" as const,
        label: "Integrations",
        detail: "Nango host",
      },
      {
        id: "maintenance" as const,
        label: "Diagnostics",
        detail:
          maintenanceReport?.ok === false ? "repairs available" : "checks",
      },
      {
        id: "sessions" as const,
        label: "Sessions",
        detail: "runtime search",
      },
      {
        id: "files" as const,
        label: "Files",
        detail: runtimeFileRoots.length
          ? `${runtimeFileRoots.length} roots`
          : "runtime roots",
      },
      {
        id: "notifications" as const,
        label: "Alerts",
        detail: notificationSummary?.unread
          ? `${(notificationSummary.highUnread ?? 0) + (notificationSummary.urgentUnread ?? 0)} high priority`
          : `${notificationSummary?.total ?? 0} total`,
      },
      {
        id: "chat" as const,
        label: "Chat",
        detail: selectedAgent?.name ?? "none",
      },
      {
        id: "more" as const,
        label: "More",
        detail:
          activeView === "fusion"
            ? "fusion"
            : activeView === "aeon"
              ? "autopilot"
              : notificationSummary?.unread
                ? `${notificationSummary.unread} alerts`
                : maintenanceReport?.ok === false
                  ? "repairs available"
                  : "utilities",
      },
    ],
    [
      activeView,
      brainSkillImportableCount,
      kanbanBoard?.tasks.length,
      maintenanceReport?.ok,
      mirosharkStatus?.ok,
      notificationSummary,
      runtimeUsage?.totals,
      schedules,
      selectedAgent?.name,
      sharedEnvCount,
      sharedVault.enabled,
      visibleAgentCount,
      walletStats.critical,
      walletStats.enabled,
    ],
  );

  const activeNavItem = navItems.find(
    (item) =>
      item.id === activeView ||
      (item.id === "kanban" && isWorkView(activeView)) ||
      (item.id === "more" &&
        (activeView === "maintenance" ||
          activeView === "sessions" ||
          activeView === "tools" ||
          activeView === "memory" ||
          activeView === "files" ||
          activeView === "notifications" ||
          activeView === "messaging" ||
          activeView === "env" ||
          activeView === "integrations" ||
          activeView === "my-apps" ||
          activeView === "phone" ||
          activeView === "aeon" ||
          activeView === "fusion" ||
          activeView === "governance")),
  );
  const activeHeader = (() => {
    const detail = activeNavItem?.detail ?? "";
    const headers: Record<DashboardView, { label: string; title: string }> = {
      agents: { label: "Fleet", title: "Where the hive is deployed" },
      kanban: { label: "Work", title: "What the hive is doing" },
      scheduler: { label: "Work", title: "What the hive schedules" },
      swarm: { label: "Work", title: "What the hive is simulating" },
      history: { label: "Work", title: "What the hive finished recently" },
      wallet: { label: "Wallets", title: "How the agents spend" },
      vault: { label: "Brain Graph", title: "What the hive remembers" },
      integrations: { label: "Integrations", title: "What APIs connect" },
      maintenance: {
        label: "Fleet Diagnostics",
        title: "What the hive repairs",
      },
      sessions: { label: "Sessions", title: "What agents already said" },
      tools: { label: "Tools", title: "What agents can invoke" },
      memory: { label: "Memory", title: "What memory grows" },
      files: { label: "Brain Files", title: "What agents inspect" },
      notifications: { label: "Alerts", title: "What alerts need" },
      messaging: { label: "Messaging", title: "Where agents can message" },
      chat: {
        label: "Agent Chat",
        title: selectedAgent?.name
          ? `Talking with ${selectedAgent.name}`
          : "Choose an agent to chat with",
      },
      more: { label: "More", title: "Where utilities live" },
      env: { label: "Env", title: "What agents share" },
      "my-apps": {
        label: "Apps & Services",
        title: "What runs and what agents can call",
      },
      phone: { label: "Phone", title: "What your phone calls about" },
      aeon: { label: "Aeon", title: "What runs unattended" },
      fusion: { label: "Hive Fusion", title: "What the hive can create" },
      governance: { label: "Zero Human Company", title: "How the hive is held accountable" },
    };
    const header = headers[activeView] ?? { label: "Zero Human Company", title: "" };
    return {
      eyebrow: detail
        ? `Hivemind Dispatch · ${header.label} · ${detail}`
        : `Hivemind Dispatch · ${header.label}`,
      title: header.title,
    };
  })();

  const setupMachine = useMemo(
    () =>
      machineGroups.find((machine) => machine.key === setupMachineKey) ?? null,
    [machineGroups, setupMachineKey],
  );
  const roleModalAgent = useMemo(
    () => displayAgents.find((agent) => agent.id === agentRoleModalId) ?? null,
    [agentRoleModalId, displayAgents],
  );
  const agentCreateMachine =
    machineGroups.find((machine) => machine.key === agentCreateMachineKey) ??
    null;
  useEffect(() => {
    if (agentSettingsPanel !== "role" && agentSettingsPanel !== "tools") return;
    const draftAgent = agentCreateMachine
      ? createAgentProfile(
          agentCreateDraft.runtime,
          runtimeCount(agents, agentCreateDraft.runtime) + 1,
        )
      : roleModalAgent;
    if (!draftAgent) return;
    if (
      agentSettingsPanel !== "tools" &&
      !runtimeCan(draftAgent, "modelSelection")
    )
      return;
    const refreshTimer = window.setTimeout(
      () =>
        void refreshRuntimeIntegrations({
          ...draftAgent,
          provider: agentCreateMachine
            ? agentCreateDraft.provider
            : draftAgent.provider,
          model: agentCreateMachine ? agentCreateDraft.model : draftAgent.model,
          usePod: agentCreateMachine
            ? agentCreateDraft.usePod
            : draftAgent.usePod,
          venice: agentCreateMachine
            ? agentCreateDraft.venice
            : draftAgent.venice,
          telemetryUrl:
            agentCreateMachine?.collectorUrl ?? draftAgent.telemetryUrl,
        }),
      agentCreateMachine ? 350 : 0,
    );
    return () => window.clearTimeout(refreshTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    agentSettingsPanel,
    roleModalAgent?.id,
    roleModalAgent?.runtime,
    roleModalAgent?.provider,
    roleModalAgent?.model,
    roleModalAgent?.telemetryUrl,
    agentCreateMachineKey,
    agentCreateMachine?.collectorUrl,
    agentCreateDraft.runtime,
    agentCreateDraft.provider,
    agentCreateDraft.model,
  ]);
  return {
    discoveredAgents,
    agentAliases,
    candidateAgents,
    candidateWorkById,
    displayAgents,
    agentWorkById,
    effectiveSelectedAgentId,
    selectedAgent,
    sharedSkillOptions,
    filteredSkillBrowserSkills,
    hermesUpdateRequired,
    filteredSchedulerSkills,
    selectedBrainNode,
    visibleBrainNodes,
    brainLayout,
    brainGraphStats,
    selectedBrainTargetIds,
    messages,
    lastAssistant,
    visibleMessages,
    sessionNotice,
    selectedChatStreaming,
    selectedChatHasStreamingChunk,
    selectedChatProcess,
    updateChatAutoScroll,
    machineGroups,
    renameMachine,
    kanbanMachineTargets,
    localKanbanMachineTarget,
    quickAddMachineTarget,
    agentsForKanbanTask,
    visibleAgentCount,
    fleetViewData,
    fleetUpdateStatusByMachine,
    fleetUpdateDetailByMachine,
    kanbanColumns,
    visibleKanbanColumns,
    selectedKanbanTask,
    selectedKanbanComments,
    selectedKanbanAgent,
    selectedKanbanAgentMessages,
    notificationGroups,
    selectedKanbanEvents,
    selectedKanbanBulkIds,
    selectedWallet,
    selectedWalletSnapshot,
    walletStats,
    honeyAgentRewards,
    selectedHoneyReward,
    honeyStats,
    kanbanAssigneeOptions,
    workBoardStats,
    kanbanViewColumns,
    kanbanInitialLoading,
    updateKanbanBoardScrollState,
    agentSpecificEnvCount,
    sharedEnvSource,
    runtimeEnvSources,
    selectedRuntimeEnvSource,
    sharedEnvCount,
    unsharedRuntimeEnvCount,
    sharedBackupStatus,
    sharedEnvImport,
    sharedEnvImportDiff,
    sharedEnvImportNewCount,
    sharedEnvImportChangedCount,
    sharedEnvImportSameCount,
    brainSkillImportableCount,
    brainSkillImportAllLabel,
    brainSkillImportAllDescription,
    navItems,
    activeNavItem,
    activeHeader,
    setupMachine,
    roleModalAgent,
    agentCreateMachine,
    brainSkillImportableLabel,
  };
}
