"use client";

/* eslint-disable react-hooks/immutability, react-hooks/purity */

import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect } from "react";
import type { SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentWorkerClassView } from "@/features/dashboard/agent-settings-types";
import type {
  BrainSkillInventory,
  DashboardView,
  HiveEnvPayload,
  KanbanBoardSummary,
  KanbanResponse,
  MiroSharkArchivedRun,
  MiroSharkRunResult,
} from "@/features/dashboard/dashboard-types";
import type { KanbanBoard } from "@/lib/types/kanban";
import { useVisibilityAwarePolling } from "@/features/dashboard/hooks/use-visibility-aware-polling";
import { readNativeKanban } from "@/lib/native/kanban";

type KanbanStorageInfo = NonNullable<KanbanResponse["storage"]>;

type UseDashboardPollingEffectsProps = {
  activeView: DashboardView;
  hydrated: boolean;
  chatRequestActive?: boolean;
  refreshMirosharkArchive: () => void | Promise<void>;
  refreshBrainGraph: (force?: boolean) => void | Promise<void>;
  refreshBrainSkills: () => void | Promise<void>;
  refreshRecentDirectories: () => void | Promise<void>;
  refreshMirosharkRun: () => void | Promise<void>;
  sharedVault: SharedVaultConfig;
  brainSkills: BrainSkillInventory | null | undefined;
  brainSkillsLoading: boolean;
  walletPanelMode: "wallets" | "usage";
  refreshRuntimeUsage: () => void | Promise<void>;
  refreshWalletVaultBackupStatus: () => void | Promise<void>;
  refreshMaintenanceReport: () => void | Promise<void>;
  refreshRuntimeFileRoots: () => void | Promise<void>;
  hiveEnv: HiveEnvPayload | null | undefined;
  hiveEnvLoading: boolean;
  refreshHiveEnv: () => void | Promise<void>;
  agentWorkerClassView: AgentWorkerClassView;
  vaultPanelMode: "hive-vault" | "shared-skills" | "brain-services" | "env" | "config";
  refreshNotifications: (options?: { append?: boolean }) => void | Promise<void>;
  mirosharkRun: MiroSharkRunResult | null;
  mirosharkPosts: { count: number };
  mirosharkRunnerStatus: string | null | undefined;
  mirosharkArchiveSaveKeyRef: MutableRefObject<string>;
  mirosharkScenario: string;
  setMirosharkArchiveStatus: Dispatch<SetStateAction<string>>;
  isMiroSharkRunTerminal: (status?: string | null) => boolean;
  mirosharkPlatform: string;
  setMirosharkRun: Dispatch<SetStateAction<MiroSharkRunResult | null>>;
  kanbanBoardSlug: string;
  kanbanIncludeArchived: boolean;
  kanbanTenantFilter: string;
  kanbanAssigneeFilter: string;
  kanbanSearch: string;
  setKanbanLoading: Dispatch<SetStateAction<boolean>>;
  setKanbanError: Dispatch<SetStateAction<string>>;
  setKanbanBoard: Dispatch<SetStateAction<KanbanBoard | null>>;
  setKanbanBoards: Dispatch<SetStateAction<KanbanBoardSummary[]>>;
  setKanbanTenants: Dispatch<SetStateAction<string[]>>;
  setKanbanAssignees: Dispatch<SetStateAction<string[]>>;
  setKanbanStorage: Dispatch<SetStateAction<KanbanStorageInfo | null>>;
  setSelectedKanbanTaskId: Dispatch<SetStateAction<string>>;
};

export function useDashboardPollingEffects(props: UseDashboardPollingEffectsProps) {
  const {
    activeView,
    hydrated,
    chatRequestActive = false,
    refreshMirosharkArchive,
    refreshBrainGraph,
    refreshBrainSkills,
    refreshRecentDirectories,
    refreshMirosharkRun,
    sharedVault,
    brainSkills,
    brainSkillsLoading,
    walletPanelMode,
    refreshRuntimeUsage,
    refreshWalletVaultBackupStatus,
    refreshMaintenanceReport,
    refreshRuntimeFileRoots,
    hiveEnv,
    hiveEnvLoading,
    refreshHiveEnv,
    agentWorkerClassView,
    vaultPanelMode,
    refreshNotifications,
    mirosharkRun,
    mirosharkPosts,
    mirosharkRunnerStatus,
    mirosharkArchiveSaveKeyRef,
    mirosharkScenario,
    setMirosharkArchiveStatus,
    isMiroSharkRunTerminal,
    mirosharkPlatform,
    setMirosharkRun,
    kanbanBoardSlug,
    kanbanIncludeArchived,
    kanbanTenantFilter,
    kanbanAssigneeFilter,
    kanbanSearch,
    setKanbanLoading,
    setKanbanError,
    setKanbanBoard,
    setKanbanBoards,
    setKanbanTenants,
    setKanbanAssignees,
    setKanbanStorage,
    setSelectedKanbanTaskId,
  } = props;
  const pauseBackgroundRefresh = Boolean(chatRequestActive);
  const recentDirectoriesVisible = activeView === "chat" || activeView === "kanban" || activeView === "history";
  useEffect(() => {
    if (!hydrated || pauseBackgroundRefresh || activeView !== "swarm") return;
    const timer = window.setTimeout(() => {
      void refreshMirosharkArchive();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeView, hydrated, pauseBackgroundRefresh, refreshMirosharkArchive]);

  useEffect(() => {
    if (!hydrated || pauseBackgroundRefresh || activeView !== "vault") return;
    const timer = window.setTimeout(() => {
      void refreshBrainGraph();
    }, 0);
    const skillsTimer = window.setTimeout(() => {
      void refreshBrainSkills();
    }, 350);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(skillsTimer);
    };
  }, [activeView, hydrated, pauseBackgroundRefresh, refreshBrainGraph, refreshBrainSkills]);

  useEffect(() => {
    if (!hydrated || pauseBackgroundRefresh || !sharedVault.enabled || !recentDirectoriesVisible) return;
    const timer = window.setTimeout(() => {
      void refreshRecentDirectories();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, pauseBackgroundRefresh, recentDirectoriesVisible, refreshRecentDirectories, sharedVault.enabled]);

  useEffect(() => {
    if (!hydrated || pauseBackgroundRefresh || activeView !== "scheduler" || brainSkills || brainSkillsLoading) return;
    const timer = window.setTimeout(() => {
      void refreshBrainSkills();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeView, brainSkills, brainSkillsLoading, hydrated, pauseBackgroundRefresh, refreshBrainSkills]);

  useEffect(() => {
    if (!hydrated || pauseBackgroundRefresh || activeView !== "wallet" || walletPanelMode !== "usage") return;
    const timer = window.setTimeout(() => {
      void refreshRuntimeUsage();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeView, hydrated, pauseBackgroundRefresh, walletPanelMode]);

  useEffect(() => {
    if (!hydrated || pauseBackgroundRefresh || activeView !== "wallet") return;
    const timer = window.setTimeout(() => {
      void refreshWalletVaultBackupStatus();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, hydrated, pauseBackgroundRefresh, sharedVault.enabled, sharedVault.vaultPath]);

  useEffect(() => {
    if (!hydrated || pauseBackgroundRefresh || activeView !== "maintenance") return;
    const timer = window.setTimeout(() => {
      void refreshMaintenanceReport();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, hydrated, pauseBackgroundRefresh]);

  useEffect(() => {
    if (!hydrated || pauseBackgroundRefresh || activeView !== "files") return;
    const timer = window.setTimeout(() => {
      void refreshRuntimeFileRoots();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, hydrated, pauseBackgroundRefresh]);

  useEffect(() => {
    const envVisibleOrNearby = activeView === "env" || activeView === "vault";
    if (!hydrated || pauseBackgroundRefresh || !envVisibleOrNearby || hiveEnv || hiveEnvLoading) return;
    const timer = window.setTimeout(() => {
      void refreshHiveEnv();
    }, vaultPanelMode === "env" ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [activeView, hiveEnv, hiveEnvLoading, hydrated, pauseBackgroundRefresh, refreshHiveEnv, vaultPanelMode]);

  useEffect(() => {
    if (!hydrated || pauseBackgroundRefresh || agentWorkerClassView !== "create" || brainSkills || brainSkillsLoading) return;
    const timer = window.setTimeout(() => {
      void refreshBrainSkills();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [agentWorkerClassView, brainSkills, brainSkillsLoading, hydrated, pauseBackgroundRefresh, refreshBrainSkills]);

  useVisibilityAwarePolling({
    enabled: hydrated && !pauseBackgroundRefresh && sharedVault.enabled,
    intervalMs: activeView === "notifications" ? 30_000 : 120_000,
    hiddenIntervalMs: 5 * 60_000,
    initialDelayMs: activeView === "notifications" ? 0 : 300,
    task: () => refreshNotifications(),
  });

  useEffect(() => {
    if (!hydrated || pauseBackgroundRefresh || !sharedVault.enabled || !mirosharkRun?.simulationId || mirosharkRun.archived) return;
    const saveKey = [
      mirosharkRun.simulationId,
      mirosharkPosts.count,
      mirosharkRunnerStatus ?? mirosharkRun.status ?? "",
      mirosharkRun.step ?? "",
    ].join(":");
    if (mirosharkArchiveSaveKeyRef.current === saveKey) return;

    const timer = window.setTimeout(async () => {
      const response = await fetch("/api/miroshark/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vaultPath: sharedVault.vaultPath.trim() || undefined,
          scenario: mirosharkScenario,
          run: mirosharkRun,
        }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; summary?: MiroSharkArchivedRun; error?: string } | null;
      if (data?.ok) {
        mirosharkArchiveSaveKeyRef.current = saveKey;
        setMirosharkArchiveStatus(`Saved ${data.summary?.postCount ?? mirosharkPosts.count} posts to Obsidian`);
        void refreshMirosharkArchive();
      } else {
        setMirosharkArchiveStatus(data?.error ?? "Could not save MiroShark run to Obsidian");
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [
    hydrated,
    mirosharkPosts.count,
    mirosharkRunnerStatus,
    mirosharkRun,
    mirosharkScenario,
    pauseBackgroundRefresh,
    refreshMirosharkArchive,
    sharedVault.enabled,
    sharedVault.vaultPath,
  ]);

  useEffect(() => {
    if (pauseBackgroundRefresh || mirosharkRun?.archived || !mirosharkRun?.jobId || mirosharkRun.status === "started" || mirosharkRun.status === "failed") return;
    let inFlight = false;
    const refreshOnce = () => {
      if (inFlight) return;
      inFlight = true;
      void Promise.resolve(refreshMirosharkRun()).finally(() => {
        inFlight = false;
      });
    };
    const timer = window.setInterval(refreshOnce, 3_000);
    return () => window.clearInterval(timer);
  }, [mirosharkRun?.archived, mirosharkRun?.jobId, mirosharkRun?.status, pauseBackgroundRefresh, refreshMirosharkRun]);

  useEffect(() => {
    if (pauseBackgroundRefresh || mirosharkRun?.archived || mirosharkRun?.status !== "started" || !mirosharkRun.simulationId || mirosharkRun.posts) return;
    const timer = window.setTimeout(() => {
      void refreshMirosharkRun();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mirosharkRun?.archived, mirosharkRun?.posts, mirosharkRun?.simulationId, mirosharkRun?.status, pauseBackgroundRefresh, refreshMirosharkRun]);

  useEffect(() => {
    if (pauseBackgroundRefresh || mirosharkRun?.archived || mirosharkRun?.status !== "started" || !mirosharkRun.simulationId) return;
    if (isMiroSharkRunTerminal(mirosharkRunnerStatus)) return;

    const simulationId = mirosharkRun.simulationId;
    const platform = mirosharkRun.platform ?? mirosharkPlatform;
    const graphId = mirosharkRun.graphId;
    const projectId = mirosharkRun.projectId;
    let inFlight = false;
    const controllers = new Set<AbortController>();
    const pollRun = async () => {
      if (inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      controllers.add(controller);
      const params = new URLSearchParams({ simulation_id: simulationId, platform });
      if (graphId) params.set("graph_id", graphId);
      if (projectId) params.set("project_id", projectId);
      const response = await fetch(`/api/miroshark/swarm?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      }).catch(() => null);
      try {
        const data = await response?.json().catch(() => null) as MiroSharkRunResult | null;
        if (data) {
          setMirosharkRun((current) => ({ ...(current ?? {}), ...data }));
        }
      } finally {
        controllers.delete(controller);
        inFlight = false;
      }
    };

    const kickoff = window.setTimeout(() => {
      void pollRun();
    }, 250);
    const timer = window.setInterval(() => {
      void pollRun();
    }, 2_000);
    return () => {
      controllers.forEach((controller) => controller.abort());
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [
    mirosharkPlatform,
    mirosharkRun?.archived,
    mirosharkRun?.platform,
    mirosharkRun?.graphId,
    mirosharkRun?.projectId,
    mirosharkRun?.simulationId,
    mirosharkRun?.status,
    mirosharkRunnerStatus,
    pauseBackgroundRefresh,
  ]);

  useEffect(() => {
    if (!hydrated || pauseBackgroundRefresh || activeView !== "kanban") return;
    let cancelled = false;
    let boardRefreshInFlight = false;
    let kanbanRefreshInFlight = false;
    const controllers = new Set<AbortController>();
    async function refreshKanbanBoards() {
      if (boardRefreshInFlight) return;
      boardRefreshInFlight = true;
      const controller = new AbortController();
      controllers.add(controller);
      const params = new URLSearchParams({ board: kanbanBoardSlug, boards_only: "true" });
      if (sharedVault.enabled) {
        if (sharedVault.vaultPath.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
        if (sharedVault.kanbanFolder?.trim()) params.set("kanbanFolder", sharedVault.kanbanFolder.trim());
      }
      const nativeData = await readNativeKanban({
        board: kanbanBoardSlug,
        boardsOnly: true,
        vaultPath: sharedVault.enabled ? sharedVault.vaultPath.trim() : undefined,
        kanbanFolder: sharedVault.enabled ? sharedVault.kanbanFolder?.trim() : undefined,
      });
      if (nativeData?.ok) {
        if (!cancelled) {
          setKanbanBoards(nativeData.boards ?? []);
          setKanbanStorage(nativeData.storage ?? null);
        }
        controllers.delete(controller);
        boardRefreshInFlight = false;
        return;
      }
      const response = await fetch(`/api/kanban?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      }).catch(() => null);
      try {
        const data = await response?.json().catch(() => null) as KanbanResponse | null;
        if (cancelled || !data?.ok) return;
        setKanbanBoards(data.boards ?? []);
        setKanbanStorage(data.storage ?? null);
      } finally {
        controllers.delete(controller);
        boardRefreshInFlight = false;
      }
    }
    async function refreshKanban() {
      if (kanbanRefreshInFlight) return;
      kanbanRefreshInFlight = true;
      const controller = new AbortController();
      controllers.add(controller);
      setKanbanLoading(true);
      const params = new URLSearchParams({
        board: kanbanBoardSlug,
        include_archived: String(kanbanIncludeArchived),
        include_boards: "false",
      });
      if (sharedVault.enabled) {
        if (sharedVault.vaultPath.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
        if (sharedVault.kanbanFolder?.trim()) params.set("kanbanFolder", sharedVault.kanbanFolder.trim());
      }
      if (kanbanTenantFilter) params.set("tenant", kanbanTenantFilter);
      if (kanbanAssigneeFilter) params.set("assignee", kanbanAssigneeFilter);
      if (kanbanSearch) params.set("q", kanbanSearch);
      const nativeData = await readNativeKanban({
        board: kanbanBoardSlug,
        includeArchived: kanbanIncludeArchived,
        includeBoards: false,
        tenant: kanbanTenantFilter || undefined,
        assignee: kanbanAssigneeFilter || undefined,
        query: kanbanSearch || undefined,
        vaultPath: sharedVault.enabled ? sharedVault.vaultPath.trim() : undefined,
        kanbanFolder: sharedVault.enabled ? sharedVault.kanbanFolder?.trim() : undefined,
      });
      if (nativeData?.ok && nativeData.board) {
        if (!cancelled) {
          setKanbanError("");
          setKanbanBoard(nativeData.board);
          if (nativeData.boards) setKanbanBoards(nativeData.boards);
          setKanbanTenants(nativeData.tenants ?? []);
          setKanbanAssignees(nativeData.assignees ?? []);
          setKanbanStorage(nativeData.storage ?? null);
          setSelectedKanbanTaskId((current) => (
            current && nativeData.board?.tasks.some((task) => task.id === current) ? current : nativeData.board?.tasks[0]?.id ?? ""
          ));
          setKanbanLoading(false);
        }
        controllers.delete(controller);
        kanbanRefreshInFlight = false;
        return;
      }
      const response = await fetch(`/api/kanban?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      }).catch(() => null);
      try {
        const data = await response?.json().catch(() => null) as KanbanResponse | null;
        if (cancelled) return;
        if (!data?.ok || !data.board) {
          setKanbanError(data?.error ?? "Kanban board is unavailable.");
          setKanbanLoading(false);
          return;
        }
        setKanbanError("");
        setKanbanBoard(data.board);
        if (data.boards) setKanbanBoards(data.boards);
        setKanbanTenants(data.tenants ?? []);
        setKanbanAssignees(data.assignees ?? []);
        setKanbanStorage(data.storage ?? null);
        setSelectedKanbanTaskId((current) => (
          current && data.board?.tasks.some((task) => task.id === current) ? current : data.board?.tasks[0]?.id ?? ""
        ));
        setKanbanLoading(false);
      } finally {
        controllers.delete(controller);
        kanbanRefreshInFlight = false;
      }
    }
    const refreshVisibleKanban = () => {
      if (document.visibilityState === "visible") void refreshKanban();
    };
    const refreshVisibleKanbanBoards = () => {
      if (document.visibilityState === "visible") void refreshKanbanBoards();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshKanban();
      void refreshKanbanBoards();
    };

    refreshWhenVisible();
    const timer = window.setInterval(refreshVisibleKanban, 30_000);
    const boardsTimer = window.setInterval(refreshVisibleKanbanBoards, 120_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      controllers.forEach((controller) => controller.abort());
      window.clearInterval(timer);
      window.clearInterval(boardsTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [
    kanbanBoardSlug,
    kanbanIncludeArchived,
    kanbanTenantFilter,
    kanbanAssigneeFilter,
    kanbanSearch,
    activeView,
    hydrated,
    pauseBackgroundRefresh,
    sharedVault.enabled,
    sharedVault.kanbanFolder,
    sharedVault.vaultPath,
  ]);

  return undefined;
}
