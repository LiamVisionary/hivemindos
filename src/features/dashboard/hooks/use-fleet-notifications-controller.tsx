// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { useCallback, useEffect, useRef } from "react";
import { getNativeAppVersion } from "@/lib/native/desktop-status";
import { getNativeFleetDiscovery } from "@/lib/native/fleet";
import { readNativeKanban } from "@/lib/native/kanban";

export function useFleetNotificationsController(props: any) {
  const {
    DEFAULT_SHARED_VAULT,
    addKanbanStorageParams,
    appVersion,
    hydrated,
    isCollectorAutoUpdateable,
    kanbanAssigneeFilter,
    kanbanBoardSlug,
    kanbanIncludeArchived,
    kanbanSearch,
    kanbanTenantFilter,
    cleanActivityTitle,
    localDashboardHasUnpublishedChanges,
    machineInitDraft,
    machineInitToken,
    machineNeedsChatBridgeRepair,
    machineNeedsEnvHttpSyncRepair,
    machineNeedsSkillSyncRepair,
    machineVersionCopy,
    mergeDiscoveredMachines,
    mergeSnapshotRecord,
    noteIntakeAutoInFlightRef,
    notifications,
    setAppVersion,
    setCopiedUpdateDetailKey,
    setDiscoveredMachines,
    setFleetSnapshots,
    setKanbanAssignees,
    setKanbanBoard,
    setKanbanBoards,
    setKanbanError,
    setKanbanStorage,
    setKanbanTenants,
    setActiveView,
    setSelectedKanbanTaskId,
    setMachineInitCopiedKey,
    setMachineInitOpen,
    setMachineInitStatus,
    setMachineInitToken,
    setMachineInitTokenStatus,
    setNoteIntakePending,
    setNoteIntakePreview,
    setNoteIntakeStatus,
    setNotificationCursor,
    setNotificationSummary,
    setNotifications,
    setNotificationsStatus,
    setTasks,
    setUpdateStatusByMachine,
    sharedVault,
    summarizeHermesAuthError,
    updateStatusByMachine,
  } = props;
  // Latest snapshot of the props/state and sibling local helpers that the
  // stable useCallback handlers below read at call time (see liveRef.current
  // assignment near the end of this hook). Reading through this ref lets those
  // handlers keep an empty dep array (stable identity, so the memoized panels
  // they are spread into can short-circuit) without ever observing stale props.
  const liveRef = useRef<any>(null);

  const openMachineInitModal = useCallback(() => {
    const live = liveRef.current;
    live.setMachineInitOpen(true);
    live.setMachineInitStatus({});
    live.setMachineInitCopiedKey("");
    live.setMachineInitTokenStatus({});
  }, []);

  async function saveHetznerToken() {
    const token = machineInitToken.trim();
    if (!token) {
      setMachineInitTokenStatus({
        error: "Paste a Hetzner Cloud API token first.",
      });
      return;
    }
    setMachineInitTokenStatus({ busyAction: "save" });
    const response = await fetch("/api/fleet/hetzner/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      message?: string;
    } | null;
    if (!response?.ok || !data?.ok) {
      setMachineInitTokenStatus({
        error: data?.error ?? "Could not validate and save the Hetzner token.",
      });
      return;
    }
    setMachineInitToken("");
    setMachineInitTokenStatus({
      ok: true,
      validated: true,
      message:
        data.message ??
        "Validated with Hetzner Cloud and saved HCLOUD_TOKEN locally.",
    });
  }

  async function openHetznerEnvFile() {
    setMachineInitTokenStatus({ busyAction: "open" });
    const response = await fetch("/api/fleet/hetzner/env/open", {
      method: "POST",
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      message?: string;
    } | null;
    if (!response?.ok || !data?.ok) {
      setMachineInitTokenStatus({
        error: data?.error ?? "Could not open the local env file.",
      });
      return;
    }
    setMachineInitTokenStatus({
      message: data.message ?? "Opened the local HivemindOS env file.",
    });
  }

  async function initializeMachineProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMachineInitStatus({ busy: true });
    const response = await fetch("/api/fleet/machines/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(machineInitDraft),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as {
      ok?: boolean;
      machine?: MachineInitResult;
      error?: string;
    } | null;
    if (!response?.ok || !data?.ok || !data.machine) {
      setMachineInitStatus({
        error: data?.error ?? "Could not initialize the machine project.",
      });
      return;
    }
    setMachineInitStatus({ result: data.machine });
  }

  async function copyMachineInitCommand(key: string, command: string) {
    await navigator.clipboard?.writeText(command).catch(() => undefined);
    setMachineInitCopiedKey(key);
    window.setTimeout(
      () =>
        setMachineInitCopiedKey((current) => (current === key ? "" : current)),
      2500,
    );
  }

  function upsertTask(task: AgentTask) {
    setTasks((current) =>
      [task, ...current.filter((item) => item.id !== task.id)].slice(0, 80),
    );
  }

  function updateTask(taskId: string, patch: Partial<AgentTask>) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? { ...task, ...patch, updatedAt: Date.now() }
          : task,
      ),
    );
  }

  async function refreshAppVersionNow() {
    const nativeVersion = await getNativeAppVersion();
    if (nativeVersion?.commit) {
      setAppVersion(nativeVersion);
      return;
    }
    const response = await fetch("/api/app/version", {
      cache: "no-store",
    }).catch(() => null);
    const data = (await response
      ?.json()
      .catch(() => null)) as AppVersion | null;
    if (data?.commit) setAppVersion(data);
  }

  async function refreshDiscoveryNow() {
    const nativeData = await getNativeFleetDiscovery();
    const response = nativeData?.machines ? null : await fetch(
      "/api/fleet/discover?includeSnapshots=0&fresh=1",
      { cache: "no-store" },
    ).catch(() => null);
    const data = (nativeData?.machines ? nativeData : await response?.json().catch(() => null)) as {
      machines?: DiscoveredMachine[];
    } | null;
    if (!data?.machines) return;
    setDiscoveredMachines(() =>
      mergeDiscoveredMachines([], data.machines ?? []),
    );
    const discoveredSnapshots = data.machines.flatMap(
      (machine) => machine.snapshots ?? [],
    );
    if (discoveredSnapshots.length > 0) {
      setFleetSnapshots((current) =>
        mergeSnapshotRecord(current, discoveredSnapshots),
      );
    }
  }

  const runMachineUpdate = useCallback(async (machine: MachineGroup) => {
    const live = liveRef.current;
    const { appVersion } = live;
    const versionCopy = live.machineVersionCopy(
      machine,
      appVersion?.latestCommit || appVersion?.commit,
    );
    const needsChatBridgeRepair = live.machineNeedsChatBridgeRepair(machine);
    const needsEnvHttpSyncRepair = live.machineNeedsEnvHttpSyncRepair(machine);
    const needsSkillSyncRepair = live.machineNeedsSkillSyncRepair(machine);
    if (
      (needsChatBridgeRepair ||
        needsEnvHttpSyncRepair ||
        needsSkillSyncRepair) &&
      live.localDashboardHasUnpublishedChanges(appVersion)
    ) {
      const missingFeature = needsSkillSyncRepair
        ? "shared skills bridge"
        : needsEnvHttpSyncRepair
          ? "shared-env sync endpoint"
          : "Hermes chat bridge";
      live.setUpdateStatusByMachine((current) => ({
        ...current,
        [machine.key]: {
          label: "Publish update first",
          detail: `This machine is missing the ${missingFeature}, but that code only exists in this local dashboard checkout right now. Commit and push these dashboard changes first, then Update can pull them on that machine.`,
          tone: "error",
        },
      }));
      return;
    }
    if (
      !live.isCollectorAutoUpdateable(versionCopy) &&
      !needsChatBridgeRepair &&
      !needsEnvHttpSyncRepair &&
      !needsSkillSyncRepair
    ) {
      live.setUpdateStatusByMachine((current) => ({
        ...current,
        [machine.key]: {
          label: "Already up to date",
          detail:
            "This local agent bridge is already reporting the latest dashboard tools.",
          tone: "success",
        },
      }));
      return;
    }
    live.setUpdateStatusByMachine((current) => ({
      ...current,
      [machine.key]: { label: "Updating...", tone: "working" },
    }));
    const response = await fetch("/api/fleet/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collectorUrl: machine.collectorUrl,
        dnsName: machine.dnsName,
        name: machine.name,
        ip: machine.ip || machine.address,
        appDir: machine.version?.appDir,
        updateCommand: machine.version?.updateCommand,
        expectedCommit:
          machine.version?.latestCommit || appVersion?.latestCommit,
        requiredCapabilities: {
          chat: needsChatBridgeRepair || undefined,
          envHttpSync: needsEnvHttpSyncRepair || undefined,
          skillInventory: needsSkillSyncRepair || undefined,
          skillAutoSync: needsSkillSyncRepair || undefined,
        },
      }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      method?: string;
      verified?: boolean;
      fallbackCommand?: string;
    } | null;
    const verified = Boolean(data?.ok && data.verified);
    const detail = verified
      ? data?.method === "already-current"
        ? "This machine already reports the latest dashboard tools, so no update run was needed."
        : machine.self
          ? "The local checkout update finished, dependencies were installed, and the local agent bridge was restarted."
          : "The update command finished. The machine pulled the latest changes, installed dependencies, and restarted the agent bridge."
      : [
          data?.error ?? "Update failed",
          data?.fallbackCommand
            ? `Fallback script:\n${data.fallbackCommand}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
    live.setUpdateStatusByMachine((current) => ({
      ...current,
      [machine.key]: {
        label: verified ? "Updated!" : "Update failed",
        detail,
        tone: verified ? "success" : "error",
      },
    }));
    if (verified) {
      void live.refreshAppVersionNow();
      void live.refreshDiscoveryNow();
    }
  }, []);

  const copyUpdateDetail = useCallback(async (machineKey: string) => {
    const live = liveRef.current;
    const detail = live.updateStatusByMachine[machineKey]?.detail;
    if (!detail) return;
    await navigator.clipboard?.writeText(detail).catch(() => undefined);
    live.setCopiedUpdateDetailKey(machineKey);
    window.setTimeout(
      () =>
        live.setCopiedUpdateDetailKey((current) =>
          current === machineKey ? "" : current,
        ),
      2500,
    );
  }, []);

  async function refreshKanbanOnce(overrides: any = {}) {
    const includeArchived =
      typeof overrides.includeArchived === "boolean"
        ? overrides.includeArchived
        : kanbanIncludeArchived;
    const tenantFilter =
      typeof overrides.tenant === "string" ? overrides.tenant : kanbanTenantFilter;
    const assigneeFilter =
      typeof overrides.assignee === "string"
        ? overrides.assignee
        : kanbanAssigneeFilter;
    const queryFilter =
      typeof overrides.query === "string" ? overrides.query : kanbanSearch;
    const params = new URLSearchParams({
      board: kanbanBoardSlug,
      include_archived: String(includeArchived),
      include_boards: "false",
    });
    addKanbanStorageParams(params);
    if (tenantFilter) params.set("tenant", tenantFilter);
    if (assigneeFilter) params.set("assignee", assigneeFilter);
    if (queryFilter) params.set("q", queryFilter);
    const nativeData = await readNativeKanban({
      board: kanbanBoardSlug,
      includeArchived,
      includeBoards: false,
      tenant: tenantFilter || undefined,
      assignee: assigneeFilter || undefined,
      query: queryFilter || undefined,
      vaultPath: sharedVault.enabled
        ? sharedVault.vaultPath?.trim()
        : undefined,
      kanbanFolder: sharedVault.enabled
        ? sharedVault.kanbanFolder?.trim() || DEFAULT_SHARED_VAULT.kanbanFolder
        : undefined,
    });
    const nativeBoardTaskCount = nativeData?.board?.tasks?.length ?? 0;
    const shouldFetchWebBoard = !(nativeData?.ok && nativeData.board && nativeBoardTaskCount > 0);
    const response = shouldFetchWebBoard
      ? await fetch(`/api/kanban?${params.toString()}`, {
          cache: "no-store",
        }).catch(() => null)
      : null;
    const webData = response?.ok
      ? ((await response.json().catch(() => null)) as KanbanResponse | null)
      : null;
    const data =
      webData?.ok && webData.board
        ? webData
        : nativeData?.ok && nativeData.board
          ? nativeData
          : webData;
    if (!data?.ok || !data.board)
      throw new Error(data?.error ?? "Kanban refresh failed.");
    setKanbanError("");
    setKanbanBoard(data.board);
    if (data.boards) setKanbanBoards(data.boards);
    setKanbanTenants(data.tenants ?? []);
    setKanbanAssignees(data.assignees ?? []);
    setKanbanStorage(data.storage ?? null);
    setSelectedKanbanTaskId((current) =>
      current && data.board.tasks.some((task: any) => task.id === current)
        ? current
        : data.board.tasks[0]?.id ?? "",
    );
  }

  function kanbanStorageBody() {
    return sharedVault.enabled
      ? {
          vaultPath: sharedVault.vaultPath.trim(),
          kanbanFolder:
            sharedVault.kanbanFolder?.trim() ||
            DEFAULT_SHARED_VAULT.kanbanFolder,
        }
      : {};
  }

  function notificationStorageBody() {
    return sharedVault.enabled
      ? {
          vaultPath: sharedVault.vaultPath.trim(),
          notificationsFolder:
            sharedVault.notificationsFolder?.trim() ||
            DEFAULT_SHARED_VAULT.notificationsFolder,
        }
      : {};
  }

  async function raiseHermesAuthAlert(
    agent: AgentProfile,
    task: KanbanTask,
    message: string,
  ) {
    const machine = agent.machineName || "Unknown machine";
    const idSource = `${agent.id || agent.agentId || agent.name}-${machine}-hermes-auth`;
    const response = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...notificationStorageBody(),
        notification: {
          id: `hermes-auth-${idSource}`,
          title: `${agent.name} needs sign-in on ${machine}`,
          priority: "high",
          kind: "alert",
          agentName: agent.name,
          agentId: agent.id || agent.agentId,
          source: `kanban:${task.id}`,
          tags: ["kanban", "hermes", "auth", "runtime"],
          body: [
            `${agent.name} couldn’t start "${task.title}" because Codex is signed out on ${machine}.`,
            "",
            `Run this on ${machine}:`,
            "",
            "```bash",
            "codex",
            "hermes auth",
            "```",
            "",
            `Reason: ${summarizeHermesAuthError(message)}`,
            "",
            "If Hermes asks for model access afterward, run `hermes model` too.",
          ].join("\n"),
        },
      }),
    });
    const data = (await response
      .json()
      .catch(() => null)) as NotificationsResponse | null;
    if (response.ok && data?.ok) {
      setNotifications(data.notifications ?? []);
      setNotificationCursor(data.nextCursor ?? null);
      setNotificationSummary({
        total: data.total ?? 0,
        unread: data.unread ?? 0,
        highUnread: data.highUnread ?? 0,
        urgentUnread: data.urgentUnread ?? 0,
        folder:
          data.folder ??
          sharedVault.notificationsFolder ??
          DEFAULT_SHARED_VAULT.notificationsFolder,
        settings: data.settings!,
      });
    }
  }

  function noteIntakeBody() {
    return {
      ...kanbanStorageBody(),
      folders:
        sharedVault.noteTaskImportFolders ||
        DEFAULT_SHARED_VAULT.noteTaskImportFolders,
      board: kanbanBoardSlug,
    };
  }

  async function scanNoteIntake(quiet = false) {
    if (!sharedVault.enabled) {
      setNoteIntakeStatus(
        "Turn on the shared brain before scanning note tasks.",
      );
      return;
    }
    if (!quiet) {
      setNoteIntakePending("scan");
      setNoteIntakeStatus("");
    }
    const params = new URLSearchParams({ board: kanbanBoardSlug });
    if (sharedVault.vaultPath.trim())
      params.set("vaultPath", sharedVault.vaultPath.trim());
    params.set(
      "kanbanFolder",
      sharedVault.kanbanFolder?.trim() || DEFAULT_SHARED_VAULT.kanbanFolder,
    );
    params.set(
      "folders",
      sharedVault.noteTaskImportFolders ||
        DEFAULT_SHARED_VAULT.noteTaskImportFolders,
    );
    const response = await fetch(`/api/note-intake?${params.toString()}`, {
      cache: "no-store",
    }).catch(() => null);
    const data = (await response
      ?.json()
      .catch(() => null)) as NoteIntakeResponse | null;
    setNoteIntakePending("");
    if (!response?.ok || !data?.ok) {
      setNoteIntakeStatus(data?.error ?? "Could not scan note tasks.");
      return;
    }
    setNoteIntakePreview(data.candidates ?? []);
    setNoteIntakeStatus(`${data.candidates?.length ?? 0} note tasks found.`);
  }

  async function importNoteIntake(quiet = false) {
    if (!sharedVault.enabled) {
      setNoteIntakeStatus(
        "Turn on the shared brain before importing note tasks.",
      );
      return;
    }
    if (!quiet) {
      setNoteIntakePending("import");
      setNoteIntakeStatus("");
    }
    const response = await fetch(
      `/api/note-intake?board=${encodeURIComponent(kanbanBoardSlug)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(noteIntakeBody()),
      },
    ).catch(() => null);
    const data = (await response
      ?.json()
      .catch(() => null)) as NoteIntakeResponse | null;
    setNoteIntakePending("");
    if (!response?.ok || !data?.ok) {
      setNoteIntakeStatus(data?.error ?? "Could not import note tasks.");
      return;
    }
    if (data.board) setKanbanBoard(data.board);
    setNoteIntakePreview(data.candidates ?? []);
    setNoteIntakeStatus(
      `Imported ${data.imported?.length ?? 0} note tasks into Ideas. Skipped ${data.skipped ?? 0} already present.`,
    );
    await refreshKanbanOnce().catch((error) =>
      setKanbanError(
        error instanceof Error ? error.message : "Kanban refresh failed.",
      ),
    );
  }

  useEffect(() => {
    if (!hydrated || !sharedVault.enabled || !sharedVault.noteTaskImportEnabled)
      return;
    if (noteIntakeAutoInFlightRef.current) return;
    const runQuietImport = () => {
      if (noteIntakeAutoInFlightRef.current) return;
      noteIntakeAutoInFlightRef.current = true;
      void importNoteIntake(true).finally(() => {
        noteIntakeAutoInFlightRef.current = false;
      });
    };
    runQuietImport();
    const timer = window.setInterval(runQuietImport, 120_000);
    return () => window.clearInterval(timer);
    // `importNoteIntake` is intentionally gated by the persisted config values below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    kanbanBoardSlug,
    sharedVault.enabled,
    sharedVault.kanbanFolder,
    sharedVault.noteTaskImportEnabled,
    sharedVault.noteTaskImportFolders,
    sharedVault.vaultPath,
  ]);

  const markNotificationRead = useCallback(async (id: string) => {
    const live = liveRef.current;
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...live.notificationStorageBody(), id }),
    }).catch(() => null);
    const data = (await response
      ?.json()
      .catch(() => null)) as NotificationsResponse | null;
    if (!response?.ok || !data?.ok) {
      live.setNotificationsStatus(
        data?.error ?? "Could not mark notification read.",
      );
      return;
    }
    live.setNotifications((current) =>
      current.map((notification) =>
        notification.id === id
          ? { ...notification, read: true, readAt: new Date().toISOString() }
          : notification,
      ),
    );
    live.setNotificationSummary((current) =>
      current
        ? {
            ...current,
            unread: Math.max(0, current.unread - 1),
            highUnread: Math.max(
              0,
              current.highUnread -
                (live.notifications.find((item) => item.id === id)?.priority ===
                "high"
                  ? 1
                  : 0),
            ),
            urgentUnread: Math.max(
              0,
              current.urgentUnread -
                (live.notifications.find((item) => item.id === id)?.priority ===
                "urgent"
                  ? 1
                  : 0),
            ),
          }
        : current,
    );
  }, []);

  async function markAllNotificationsRead() {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...notificationStorageBody(),
        action: "mark-all-read",
      }),
    }).catch(() => null);
    const data = (await response
      ?.json()
      .catch(() => null)) as NotificationsResponse | null;
    if (!response?.ok || !data?.ok) {
      setNotificationsStatus(
        data?.error ?? "Could not mark notifications read.",
      );
      return;
    }
    const now = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) => ({
        ...notification,
        read: true,
        readAt: notification.readAt ?? now,
      })),
    );
    setNotificationSummary((current) =>
      current
        ? { ...current, unread: 0, highUnread: 0, urgentUnread: 0 }
        : current,
    );
    setNotificationsStatus(
      "Badge cleared. New agent notifications will light it back up.",
    );
  }

  async function updateNotificationSettings(
    settings: Partial<AgentNotificationSettings>,
  ) {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...notificationStorageBody(),
        action: "settings",
        settings,
      }),
    }).catch(() => null);
    const data = (await response
      ?.json()
      .catch(() => null)) as NotificationsResponse | null;
    if (!response?.ok || !data?.ok) {
      setNotificationsStatus(
        data?.error ?? "Could not update notification settings.",
      );
      return;
    }
    if (data.settings) {
      setNotificationSummary((current) =>
        current
          ? { ...current, settings: data.settings! }
          : {
              total: data.total ?? 0,
              unread: data.unread ?? 0,
              highUnread: data.highUnread ?? 0,
              urgentUnread: data.urgentUnread ?? 0,
              folder:
                data.folder ??
                sharedVault.notificationsFolder ??
                DEFAULT_SHARED_VAULT.notificationsFolder,
              settings: data.settings!,
            },
      );
    }
  }

  const trackAgentTaskOnKanban = useCallback(async (
    agent: AgentProfile,
    taskRow: AgentTaskRow,
    task?: AgentTask,
  ) => {
    const live = liveRef.current;
    const status: KanbanStatus =
      taskRow.status === "active"
        ? "working"
        : taskRow.status === "completed"
          ? "done"
          : taskRow.status === "failed"
            ? "needs-human"
            : "ideas";
    const response = await fetch(
      `/api/kanban?board=${encodeURIComponent(live.kanbanBoardSlug)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...live.kanbanStorageBody(),
          title: live.cleanActivityTitle(task?.title ?? taskRow.title),
          body: [
            task?.lastMessage ? `Latest agent note: ${task.lastMessage}` : "",
            task?.source
              ? `Source: ${task.source}`
              : taskRow.source
                ? `Source: ${taskRow.source}`
                : "",
            agent.machineName ? `Machine: ${agent.machineName}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
          assignee: agent.agentId || agent.id,
          tenant: agent.machineName || agent.runtime,
          priority: taskRow.status === "failed" ? "high" : "normal",
          status,
          idempotencyKey: `agent-task:${agent.id}:${taskRow.id}`,
        }),
      },
    );
    const data = (await response
      .json()
      .catch(() => null)) as KanbanResponse | null;
    if (!response.ok || !data?.ok) {
      live.setKanbanError(
        data?.error ?? "Could not track agent task on the Work board.",
      );
      live.setActiveView("kanban");
      return;
    }
    if (data.board) {
      live.setKanbanBoard(data.board);
      live.setKanbanStorage(data.storage ?? null);
    }
    if (data.task?.id) live.setSelectedKanbanTaskId(data.task.id);
    live.setActiveView("kanban");
    await live.refreshKanbanOnce().catch((error) =>
      live.setKanbanError(
        error instanceof Error ? error.message : "Kanban refresh failed.",
      ),
    );
  }, []);

  // Refresh the live snapshot every render so the stable handlers above always
  // read current props/state and the latest sibling-helper identities. Written
  // in an effect (matching use-fleet-auto-update.tsx) rather than during render,
  // since these handlers are user-triggered and always fire after effects flush.
  useEffect(() => {
    liveRef.current = {
      appVersion,
      cleanActivityTitle,
      isCollectorAutoUpdateable,
      kanbanBoardSlug,
      localDashboardHasUnpublishedChanges,
      machineNeedsChatBridgeRepair,
      machineNeedsEnvHttpSyncRepair,
      machineNeedsSkillSyncRepair,
      machineVersionCopy,
      notifications,
      setActiveView,
      setCopiedUpdateDetailKey,
      setKanbanBoard,
      setKanbanError,
      setKanbanStorage,
      setMachineInitCopiedKey,
      setMachineInitOpen,
      setMachineInitStatus,
      setMachineInitTokenStatus,
      setNotificationSummary,
      setNotifications,
      setNotificationsStatus,
      setSelectedKanbanTaskId,
      setUpdateStatusByMachine,
      updateStatusByMachine,
      kanbanStorageBody,
      notificationStorageBody,
      refreshAppVersionNow,
      refreshDiscoveryNow,
      refreshKanbanOnce,
    };
  });

  return {
    openMachineInitModal,
    saveHetznerToken,
    openHetznerEnvFile,
    initializeMachineProject,
    copyMachineInitCommand,
    upsertTask,
    updateTask,
    refreshAppVersionNow,
    refreshDiscoveryNow,
    runMachineUpdate,
    copyUpdateDetail,
    refreshKanbanOnce,
    kanbanStorageBody,
    notificationStorageBody,
    raiseHermesAuthAlert,
    noteIntakeBody,
    scanNoteIntake,
    importNoteIntake,
    markNotificationRead,
    markAllNotificationsRead,
    updateNotificationSettings,
    trackAgentTaskOnKanban,
  };
}
