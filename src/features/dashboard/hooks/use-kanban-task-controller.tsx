// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

/* eslint-disable react-hooks/immutability, react-hooks/purity */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseRuntimeSsePayload, responseErrorMessage, runtimeErrorMessage } from "./runtime-stream-errors";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";

export function useKanbanTaskController(props: any) {
  const { AbortController, Archive, Eye, GitBranch, KANBAN_COLUMNS, KANBAN_PICKUP_PREVIEW_MS, MessageSquare, Pencil, RotateCcw, Trash2, Users, agentsForKanbanTask, appVersion, appendMessage, attachmentSizeLabel, beeRoleIconPath, beeWorkerClassLabel, chatSetupIssue, chooseBeeAssignment, chooseDirectoryForMachine, createDefaultAgentWallet, dispatchKanbanTaskToAgentRef, displayAgents, honeyLedgerEnabled, kanbanBoard, kanbanBoardSlug, kanbanCardAttachmentTargetId, kanbanCardFileInputRef, kanbanCardImageInputRef, kanbanDispatchCooldownRef, kanbanEditDraft, kanbanEditPendingTaskId, kanbanReadyPickupAttemptRef, kanbanReadyPickupInFlightRef, kanbanReadyPickupSignature, kanbanRuntimeAbortRef, kanbanStorageBody, kanbanTaskAssigneeAgent, kanbanTaskInterruptPrompt, linkedDirectoryLabel, logClientTelemetry, newBoardDraft, quickAddAttachments, quickAddDirectories, quickAddDrafts, quickAddMachineTarget, readComposerFiles, recordRecentDirectory, refreshHoneyLedger, refreshKanbanOnce, selectedKanbanAgent, selectedKanbanBulkIds, selectedKanbanTask, selectedKanbanTaskId, setKanbanBoard, setKanbanBoardSlug, setKanbanBulkPending, setKanbanCardAttachmentMenuOpen, setKanbanCardAttachmentTargetId, setKanbanCardRecentsExpanded, setKanbanEditDraft, setKanbanEditPendingTaskId, setKanbanError, setKanbanPickupPreviewByTask, setKanbanStorage, setKanbanTaskModal, setMessagesByAgent, setNewBoardDraft, setQuickAddAttachmentError, setQuickAddAttachments, setQuickAddDirectories, setQuickAddDrafts, setQuickAddMachineMenuOpen, setQuickAddMachineTargets, setQuickAddStatus, setSelectedKanbanTaskId, setSelectedKanbanTaskIds, sharedVault, updateTask, upsertTask, wait, walletsByAgent } = props;
  // Records the user's latest manual move per task so in-flight Queen pickup
  // (which waits through a preview delay before claiming) can tell the user
  // moved the card away and must not overwrite that move.
  const kanbanManualMoveRef = useRef(new Map<string, { status: KanbanStatus; at: number }>());
  // Transient non-error board notices (e.g. "move adjusted", "run stopped");
  // the panel auto-dismisses them.
  const [kanbanNotice, setKanbanNotice] = useState("");
  const [kanbanClearingColumnId, setKanbanClearingColumnId] = useState("");

  function stopLocalKanbanTaskActivity(taskId: string, status: KanbanStatus, task?: KanbanTask | null, options: { at?: number; notify?: boolean } = {}) {
    kanbanManualMoveRef.current.set(taskId, { status, at: options.at ?? Date.now() });
    const activeStream = kanbanRuntimeAbortRef.current.get(taskId);
    activeStream?.abort();
    kanbanRuntimeAbortRef.current.delete(taskId);
    kanbanReadyPickupInFlightRef.current.delete(taskId);
    kanbanReadyPickupAttemptRef.current.delete(taskId);
    if (task) {
      kanbanReadyPickupAttemptRef.current.delete(`working:${kanbanReadyPickupSignature(task, displayAgents)}`);
    }
    setKanbanPickupPreviewByTask((current) => {
      if (!current[taskId]) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    if (options.notify && task?.status === "working") {
      setKanbanNotice(`Stopped the active agent run on "${task.title}".`);
    }
  }

  async function createKanbanTask(event: FormEvent, status: KanbanStatus, projectId?: string) {
    event.preventDefault();
    const title = quickAddDrafts[status]?.trim();
    const attachments = quickAddAttachments[status] ?? [];
    const directories = quickAddDirectories[status] ?? [];
    const targetMachine = quickAddMachineTarget(status);
    if (!title && attachments.length === 0 && directories.length === 0) return;
    const body = [
      directories.length ? ["Linked directories:", ...directories.map((directory) => `- ${linkedDirectoryLabel(directory)}`)].join("\n") : "",
      attachments.length ? [
        "Attached context:",
        ...attachments.map((attachment) => `- ${attachment.kind}: ${attachment.name} (${attachment.mimeType || "unknown"}, ${attachmentSizeLabel(attachment.size)})`),
      ].join("\n") : "",
    ].filter(Boolean).join("\n\n");
    const response = await fetch(`/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...kanbanStorageBody(),
        title: title || "Untitled task",
        body,
        assignee: "",
        tenant: "",
        priority: "normal",
        status,
        attachments,
        linkedDirectories: directories,
        targetMachine,
        projectId,
      }),
    });
    const data = await response.json().catch(() => null) as KanbanResponse | null;
    if (!response.ok || !data?.ok) {
      setKanbanError(data?.error ?? "Could not create task.");
      return;
    }
    directories.forEach((directory) => {
      void recordRecentDirectory(directory, {
        machineName: targetMachine?.name,
        machineKey: targetMachine?.key,
        source: "kanban",
      });
    });
    setQuickAddDrafts((current) => ({ ...current, [status]: "" }));
    setQuickAddAttachments((current) => ({ ...current, [status]: [] }));
    setQuickAddDirectories((current) => ({ ...current, [status]: [] }));
    setQuickAddMachineTargets((current) => ({ ...current, [status]: null }));
    setQuickAddMachineMenuOpen((current) => ({ ...current, [status]: false }));
    setQuickAddAttachmentError("");
    setQuickAddStatus("");
    if (data.board) {
      setKanbanBoard(data.board);
      setKanbanStorage(data.storage ?? null);
    }
    if (status === "ready" && data.task) {
      const readyTask = data.task;
      kanbanReadyPickupInFlightRef.current.add(readyTask.id);
      await orchestrateReadyKanbanTask(readyTask).finally(() => {
        kanbanReadyPickupInFlightRef.current.delete(readyTask.id);
      });
      return;
    }
    await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
  }

  async function createKanbanBoard(event: FormEvent) {
    event.preventDefault();
    if (!newBoardDraft.slug.trim()) return;
    const response = await fetch("/api/kanban", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...kanbanStorageBody(), action: "create-board", slug: newBoardDraft.slug, name: newBoardDraft.name }),
    });
    const data = await response.json().catch(() => null) as KanbanResponse | null;
    if (!response.ok || !data?.ok || !data.board) {
      setKanbanError(data?.error ?? "Could not create board.");
      return;
    }
    setNewBoardDraft({ slug: "", name: "" });
    setKanbanBoardSlug(data.board.meta.slug);
  }

  async function patchKanbanTask(taskId: string, patch: KanbanTaskPatch) {
    const response = await fetch(`/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...kanbanStorageBody(), taskId, patch }),
    });
    const data = await response.json().catch(() => null) as KanbanResponse | null;
    if (!response.ok || !data?.ok) {
      setKanbanError(data?.error ?? "Could not update task.");
      return;
    }
    await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
  }

  async function bulkPatchKanbanTasks(patch: KanbanTaskPatch) {
    if (!selectedKanbanBulkIds.length) return;
    setKanbanBulkPending(true);
    const response = await fetch(`/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...kanbanStorageBody(),
        action: "bulk",
        ids: selectedKanbanBulkIds,
        patch,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as KanbanResponse & { results?: Array<{ ok: boolean; error?: string }> } | null;
    setKanbanBulkPending(false);
    if (!response?.ok || !data?.ok) {
      setKanbanError(data?.error ?? "Could not update selected tasks.");
      return;
    }
    const failures = data.results?.filter((result) => !result.ok) ?? [];
    if (data.board) {
      setKanbanBoard(data.board);
      setKanbanStorage(data.storage ?? null);
    }
    setSelectedKanbanTaskIds({});
    if (failures.length) setKanbanError(`${failures.length} selected task${failures.length === 1 ? "" : "s"} could not be updated.`);
    else setKanbanError("");
    await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
  }

  async function clearKanbanColumnTasks(column: KanbanColumn, columnTasks: KanbanTask[]) {
    const tasks = columnTasks.filter((task) => task.status !== "archived");
    if (!tasks.length || kanbanClearingColumnId) return;
    const activeTasks = tasks.filter((task) => task.status === "working");
    const confirmed = await confirmUserAction([
      `Clear all ${tasks.length} task${tasks.length === 1 ? "" : "s"} from ${column.title}?`,
      "They will move to Archive and leave the active board.",
      activeTasks.length
        ? `This will stop ${activeTasks.length} active agent run${activeTasks.length === 1 ? "" : "s"}.`
        : "",
    ].filter(Boolean).join("\n\n"));
    if (!confirmed) return;

    const ids = tasks.map((task) => task.id);
    const idSet = new Set(ids);
    const now = Date.now();
    setKanbanClearingColumnId(column.id);
    setKanbanBulkPending(true);
    setKanbanError("");
    for (const task of tasks) {
      stopLocalKanbanTaskActivity(task.id, "archived", task, { at: now });
    }

    try {
      const response = await fetch(`/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...kanbanStorageBody(),
          action: "bulk",
          ids,
          patch: { status: "archived" },
        }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as KanbanResponse & { results?: Array<{ ok: boolean; error?: string }> } | null;
      if (!response?.ok || !data?.ok) {
        setKanbanError(data?.error ?? "Could not clear that row.");
        return;
      }
      const failures = data.results?.filter((result) => !result.ok) ?? [];
      if (data.board) {
        setKanbanBoard(data.board);
        setKanbanStorage(data.storage ?? null);
      }
      setSelectedKanbanTaskIds((current: Record<string, boolean>) => {
        const next = { ...current };
        for (const taskId of ids) delete next[taskId];
        return next;
      });
      if (selectedKanbanTaskId && idSet.has(selectedKanbanTaskId)) {
        setSelectedKanbanTaskId("");
        setKanbanTaskModal("");
      }
      if (failures.length) {
        setKanbanError(`${failures.length} task${failures.length === 1 ? "" : "s"} could not be cleared.`);
      } else {
        setKanbanNotice(
          activeTasks.length
            ? `Archived ${tasks.length} ${column.title} task${tasks.length === 1 ? "" : "s"} and stopped ${activeTasks.length} active run${activeTasks.length === 1 ? "" : "s"}.`
            : `Archived ${tasks.length} ${column.title} task${tasks.length === 1 ? "" : "s"}.`,
        );
      }
      await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
    } finally {
      setKanbanBulkPending(false);
      setKanbanClearingColumnId("");
    }
  }

  async function promoteKanbanIdea(task: KanbanTask, mode: "specify" | "decompose") {
    const response = await fetch(`/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...kanbanStorageBody(),
        action: "promote",
        taskId: task.id,
        reason: mode === "decompose" ? "Ready for planner decomposition." : "Ready for specification pass.",
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as KanbanResponse | null;
    if (!response?.ok || !data?.ok) {
      setKanbanError(data?.error ?? "Could not promote task.");
      return;
    }
    if (data.board) {
      setKanbanBoard(data.board);
      setKanbanStorage(data.storage ?? null);
    }
    await addKanbanSystemComment(
      task.id,
      mode === "decompose"
        ? "Marked for decomposition; the Queen Bee or planner can fan this into child tasks."
        : "Marked for specification; the next worker should sharpen scope, acceptance criteria, and handoff evidence.",
    );
    await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
  }

  async function updateKanbanTaskMachine(task: KanbanTask, targetMachine: KanbanMachineTarget | null) {
    await patchKanbanTask(task.id, {
      targetMachine,
      ...(task.status === "ready" ? { assignee: "", tenant: "", agentSession: null } : {}),
    });
  }

  async function markKanbanTaskReviewed(task: KanbanTask) {
    await patchKanbanTask(task.id, {
      reviewedAt: Date.now(),
      reviewedBy: "dashboard",
    });
  }

  async function requestKanbanTaskUndo(task: KanbanTask) {
    const now = Date.now();
    const priorResult = task.result?.trim();
    await patchKanbanTask(task.id, {
      status: "ready",
      assignee: "",
      tenant: "",
      agentSession: null,
      reviewedAt: null,
      reviewedBy: "",
      undoRequestedAt: now,
      undoRequestedBy: "dashboard",
      result: [
        `Undo requested ${new Date(now).toLocaleString()}.`,
        "Only reverse work performed for this task; preserve unrelated changes.",
        priorResult ? `Previous task result:\n${priorResult}` : "",
      ].filter(Boolean).join("\n\n"),
    });
    await addKanbanSystemComment(task.id, "Undo requested from the task menu; Queen Bee will assign a targeted reversal.");
  }

  async function readWorkspaceGitSnapshot(): Promise<WorkspaceGitSnapshot | null> {
    if (!appVersion?.appDir) return null;
    const response = await fetch("/api/workspace/git-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: appVersion.appDir }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; snapshot?: WorkspaceGitSnapshot } | null;
    return response?.ok && data?.ok && data.snapshot ? data.snapshot : null;
  }

  function kanbanWorkspaceChangeSummary(before: WorkspaceGitSnapshot | null, after: WorkspaceGitSnapshot | null) {
    if (!after || before?.signature === after.signature) return "";
    const changedFiles = after.statusLines.map((line) => line.slice(3).trim()).filter(Boolean);
    const headChanged = before?.head && before.head !== after.head;
    return [
      "Runtime completed with observable workspace changes.",
      headChanged ? `HEAD changed from ${before.head.slice(0, 7)} to ${after.head.slice(0, 7)}.` : "",
      changedFiles.length ? `Changed files: ${changedFiles.slice(0, 8).join(", ")}${changedFiles.length > 8 ? ", ..." : ""}.` : "",
    ].filter(Boolean).join(" ");
  }

  async function addKanbanCardFiles(taskId: string, files: FileList | File[], kind: "image" | "file") {
    const task = kanbanBoard?.tasks.find((item) => item.id === taskId);
    if (!task) return;
    try {
      const next = await readComposerFiles(files, kind);
      setKanbanCardAttachmentMenuOpen((current) => ({ ...current, [taskId]: false }));
      await patchKanbanTask(taskId, {
        attachments: [...(task.attachments ?? []), ...next],
      });
    } catch (error) {
      setKanbanError(error instanceof Error ? error.message : "Could not attach that file.");
    }
  }

  function openKanbanCardFilePicker(taskId: string, kind: "image" | "file") {
    setKanbanCardAttachmentTargetId(taskId);
    if (kind === "image") kanbanCardImageInputRef.current?.click();
    else kanbanCardFileInputRef.current?.click();
  }

  function handleKanbanCardFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (kanbanCardAttachmentTargetId && event.target.files?.length) {
      void addKanbanCardFiles(kanbanCardAttachmentTargetId, event.target.files, "file");
    }
    event.target.value = "";
  }

  function handleKanbanCardImageChange(event: ChangeEvent<HTMLInputElement>) {
    if (kanbanCardAttachmentTargetId && event.target.files?.length) {
      void addKanbanCardFiles(kanbanCardAttachmentTargetId, event.target.files, "image");
    }
    event.target.value = "";
  }

  async function attachKanbanCardDirectory(task: KanbanTask) {
    try {
      if (!task.targetMachine) return;
      await chooseDirectoryForMachine(task.targetMachine, (directory) => {
        setKanbanCardAttachmentMenuOpen((current) => ({ ...current, [task.id]: false }));
        void patchKanbanTask(task.id, {
          linkedDirectories: [...(task.linkedDirectories ?? []), directory],
        });
        void recordRecentDirectory(directory, {
          machineName: task.targetMachine?.name,
          machineKey: task.targetMachine?.key,
          source: "kanban",
        });
      });
    } catch (error) {
      setKanbanError(error instanceof Error ? error.message : "Could not link that directory.");
    }
  }

  async function attachKanbanCardRecentDirectory(task: KanbanTask, directory: LinkedDirectory) {
    setKanbanCardAttachmentMenuOpen((current) => ({ ...current, [task.id]: false }));
    setKanbanCardRecentsExpanded((current) => ({ ...current, [task.id]: false }));
    await patchKanbanTask(task.id, {
      linkedDirectories: [...(task.linkedDirectories ?? []), directory],
    });
    void recordRecentDirectory(directory, {
      machineName: task.targetMachine?.name ?? directory.machineName,
      machineKey: task.targetMachine?.key ?? directory.machineKey,
      source: "recent",
    });
  }

  async function removeKanbanCardAttachment(task: KanbanTask, attachmentId: string) {
    await patchKanbanTask(task.id, {
      attachments: (task.attachments ?? []).filter((attachment) => attachment.id !== attachmentId),
    });
  }

  async function removeKanbanCardDirectory(task: KanbanTask, directoryId: string) {
    await patchKanbanTask(task.id, {
      linkedDirectories: (task.linkedDirectories ?? []).filter((directory) => directory.id !== directoryId),
    });
  }

  async function moveKanbanTask(taskId: string, status: KanbanStatus) {
    const currentTask = kanbanBoard?.tasks.find((task) => task.id === taskId);
    // The user's move wins over any automation in flight for this card.
    if (status !== "working") {
      stopLocalKanbanTaskActivity(taskId, status, currentTask, { notify: true });
    } else {
      kanbanManualMoveRef.current.set(taskId, { status, at: Date.now() });
    }
    const targetStatus = status === "working" && !currentTask?.assignee?.trim()
      ? "ready"
      : status;
    if (targetStatus !== status) {
      setKanbanNotice("No agent is assigned yet, so the task went to Waiting for Queen instead — the Queen Bee picks up work from there.");
    }
    logClientTelemetry("kanban.task.move.requested", {
      taskId,
      fromStatus: currentTask?.status ?? null,
      requestedStatus: status,
      targetStatus,
      assignee: currentTask?.assignee ?? null,
    });
    const response = await fetch(`/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...kanbanStorageBody(), taskId, status: targetStatus }),
    });
    const data = await response.json().catch(() => null) as KanbanResponse | null;
    if (!response.ok || !data?.ok) {
      logClientTelemetry("kanban.task.move.failed", {
        taskId,
        targetStatus,
        error: data?.error ?? `HTTP ${response.status}`,
      });
      setKanbanError(data?.error ?? "Could not move task.");
      return;
    }
    logClientTelemetry("kanban.task.move.saved", {
      taskId,
      targetStatus,
      returnedStatus: data.task?.status ?? null,
      assignee: data.task?.assignee ?? null,
    });
    if (data.board) {
      setKanbanBoard(data.board);
      setKanbanStorage(data.storage ?? null);
    }
    if (targetStatus === "ready" && data.task) {
      const readyTask = data.task;
      kanbanReadyPickupInFlightRef.current.add(readyTask.id);
      await orchestrateReadyKanbanTask(readyTask).finally(() => {
        kanbanReadyPickupInFlightRef.current.delete(readyTask.id);
      });
      return;
    }
    await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
  }

  async function deleteKanbanTask(task: KanbanTask) {
    const confirmed = await confirmUserAction(`Delete "${task.title}" from the Work board? This also removes its notes and task links.`);
    if (!confirmed) return;
    stopLocalKanbanTaskActivity(task.id, "archived", task);
    const response = await fetch(`/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...kanbanStorageBody(), taskId: task.id }),
    });
    const data = await response.json().catch(() => null) as KanbanResponse | null;
    if (!response.ok || !data?.ok) {
      setKanbanError(data?.error ?? "Could not delete task.");
      return;
    }
    if (selectedKanbanTaskId === task.id) {
      setSelectedKanbanTaskId("");
      setKanbanTaskModal("");
    }
    if (data.board) {
      setKanbanBoard(data.board);
      setKanbanStorage(data.storage ?? null);
    }
    await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
  }

  /* eslint-disable react-hooks/immutability, react-hooks/purity */
  async function editAndInterruptKanbanTask(event: FormEvent) {
    event.preventDefault();
    if (!selectedKanbanTask || kanbanEditPendingTaskId) return;
    const title = kanbanEditDraft.title.trim();
    if (!title) {
      setKanbanError("Task title is required.");
      return;
    }
    const agent = selectedKanbanTask.status === "working" ? selectedKanbanAgent : null;
    if (!agent) {
      // Plain edit: no agent is actively working this card, so just save the
      // revised title/body without dispatching or interrupting anything.
      setKanbanEditPendingTaskId(selectedKanbanTask.id);
      try {
        await patchKanbanTask(selectedKanbanTask.id, { title, body: kanbanEditDraft.body.trim() });
        setKanbanTaskModal("");
      } finally {
        setKanbanEditPendingTaskId("");
      }
      return;
    }
    const setupIssue = chatSetupIssue(agent);
    if (setupIssue) {
      setKanbanError(`Could not resend to ${agent.name}: ${setupIssue}`);
      return;
    }

    const previousTitle = selectedKanbanTask.title;
    const previousBody = selectedKanbanTask.body;
    const revisedTask: KanbanTask = {
      ...selectedKanbanTask,
      title,
      body: kanbanEditDraft.body.trim(),
      status: "working",
      assignee: selectedKanbanTask.assignee || agent.name,
    };
    const prompt = kanbanTaskInterruptPrompt(revisedTask, previousTitle, previousBody);
    const localTaskId = `kanban-edit-${selectedKanbanTask.id}-${Date.now()}`;
    let fullText = "";
    let sawAgentSession = false;

    kanbanRuntimeAbortRef.current.get(selectedKanbanTask.id)?.abort();
    const controller = new AbortController();
    kanbanRuntimeAbortRef.current.set(selectedKanbanTask.id, controller);
    kanbanReadyPickupInFlightRef.current.add(selectedKanbanTask.id);
    kanbanReadyPickupAttemptRef.current.delete(selectedKanbanTask.id);
    kanbanReadyPickupAttemptRef.current.delete(`working:${kanbanReadyPickupSignature(selectedKanbanTask, displayAgents)}`);
    setKanbanEditPendingTaskId(selectedKanbanTask.id);
    setKanbanError("");
    upsertTask({
      id: localTaskId,
      agentId: agent.id,
      title: revisedTask.title,
      lastMessage: "Interrupting with edited task...",
      status: "active",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      source: "kanban",
    });
    appendMessage(agent.id, { role: "user", content: prompt, kanbanTaskId: selectedKanbanTask.id, surface: "kanban" });
    appendMessage(agent.id, { role: "assistant", content: "", kanbanTaskId: selectedKanbanTask.id, surface: "kanban" });

    try {
      const patchResponse = await fetch(`/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...kanbanStorageBody(),
          taskId: selectedKanbanTask.id,
          patch: {
            title: revisedTask.title,
            body: revisedTask.body,
            status: "working",
            assignee: selectedKanbanTask.assignee || agent.name,
            agentSession: null,
            result: `Edited and resent to ${agent.name}; previous work was interrupted from the dashboard.`,
          },
        }),
      });
      const patchData = await patchResponse.json().catch(() => null) as KanbanResponse | null;
      if (!patchResponse.ok || !patchData?.ok) {
        throw new Error(patchData?.error ?? "Could not update task before resending.");
      }
      if (patchData.board) {
        setKanbanBoard(patchData.board);
        setKanbanStorage(patchData.storage ?? null);
      }

      const response = await fetch("/api/chat/agent-runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent,
          sharedVault,
          workingDirectory: appVersion?.appDir,
          wallet: walletsByAgent[agent.id] ?? createDefaultAgentWallet(agent.id),
          honeyLedgerEnabled,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(await responseErrorMessage(response, `Request failed with ${response.status}`));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const eventText of events) {
          const line = eventText.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          const parsed = parseRuntimeSsePayload(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            error?: unknown;
            honey?: unknown;
            session?: { id?: string; runtime?: string; source?: string; startedAt?: number; updatedAt?: number; messageCount?: number };
          };
          const runtimeError = runtimeErrorMessage(parsed);
          if (runtimeError) throw new Error(runtimeError);
          if (parsed.honey) {
            await refreshHoneyLedger();
            continue;
          }
          if (parsed.session?.id) {
            sawAgentSession = true;
            await patchKanbanTask(selectedKanbanTask.id, {
              agentSession: {
                agentId: agent.id,
                agentName: agent.name,
                runtime: parsed.session.runtime ?? agent.runtime,
                telemetryUrl: agent.telemetryUrl,
                sessionId: parsed.session.id,
                source: parsed.session.source,
                startedAt: parsed.session.startedAt ?? Date.now(),
                updatedAt: parsed.session.updatedAt ?? Date.now(),
                lastMessageCount: parsed.session.messageCount ?? 0,
              },
              result: `${agent.name} accepted the edited task. Waiting for agent update.`,
            });
            continue;
          }
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (!chunk) continue;
          fullText += chunk;
          setMessagesByAgent((current) => {
            const existing = current[agent.id] ?? [];
            const next = [...existing];
            const last = next[next.length - 1] ?? { role: "assistant" as const, content: "", kanbanTaskId: selectedKanbanTask.id };
            if (next.length === 0) next.push(last);
            next[next.length - 1] = { ...last, content: fullText, kanbanTaskId: selectedKanbanTask.id };
            return { ...current, [agent.id]: next };
          });
          updateTask(localTaskId, { lastMessage: fullText });
        }
      }

      if (fullText.trim()) {
        updateTask(localTaskId, { status: "completed", lastMessage: fullText.trim(), completedAt: Date.now() });
        await patchKanbanTask(selectedKanbanTask.id, { status: "done", result: fullText.trim() });
        await addKanbanSystemComment(selectedKanbanTask.id, `Edited task and interrupted ${agent.name}; the agent completed the revised work.`);
      } else if (sawAgentSession) {
        updateTask(localTaskId, { status: "active", lastMessage: `${agent.name} accepted the edited task. Waiting for agent update.` });
        await patchKanbanTask(selectedKanbanTask.id, {
          status: "working",
          result: `${agent.name} accepted the edited task. Waiting for agent update.`,
        });
        await addKanbanSystemComment(selectedKanbanTask.id, `Edited task and interrupted ${agent.name}; waiting for the revised run to report back.`);
      } else {
        throw new Error(`${agent.name} returned no task output and no pollable session after the edit.`);
      }
      setKanbanTaskModal("");
    } catch (error) {
      if (controller.signal.aborted) {
        updateTask(localTaskId, { status: "completed", lastMessage: "Interrupted by a newer task instruction.", completedAt: Date.now() });
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown runtime error";
      setKanbanError(message);
      updateTask(localTaskId, { status: "failed", lastMessage: message, completedAt: Date.now() });
      await addKanbanSystemComment(selectedKanbanTask.id, `Edit resend failed for ${agent.name}: ${message}`);
    } finally {
      setKanbanEditPendingTaskId("");
      kanbanReadyPickupInFlightRef.current.delete(selectedKanbanTask.id);
      if (kanbanRuntimeAbortRef.current.get(selectedKanbanTask.id) === controller) {
        kanbanRuntimeAbortRef.current.delete(selectedKanbanTask.id);
      }
      await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
    }
  }
  /* eslint-enable react-hooks/immutability, react-hooks/purity */

  function openKanbanTaskModal(task: KanbanTask, modal: "assign" | "chat" | "edit" | "events" | "notes") {
    setSelectedKanbanTaskId(task.id);
    if (modal === "edit") {
      setKanbanEditDraft({ title: task.title, body: task.body });
    }
    setKanbanTaskModal(modal);
  }

  /* eslint-disable react-hooks/refs */
  function kanbanTaskMenuItems(task: KanbanTask): CellMenuItem[] {
    const taskEvents = kanbanBoard?.events.filter((event) => !event.taskId || event.taskId === task.id).length ?? 0;
    const taskComments = kanbanBoard?.comments.filter((comment) => comment.taskId === task.id).length ?? 0;
    const moveTargets = KANBAN_COLUMNS
      .filter((column) => column.id !== "archived" || task.status === "archived")
      .map((column): CellMenuItem => ({
        key: `move-${column.id}`,
        label: column.title,
        onClick: () => void moveKanbanTask(task.id, column.id),
        disabled: task.status === column.id,
      }));
    const interruptibleAgent = task.status === "working" ? kanbanTaskAssigneeAgent(task, displayAgents) : null;
    return [
      {
        key: "chat",
        label: taskComments ? `Conversation (${taskComments})` : "Conversation",
        icon: <MessageSquare aria-hidden="true" />,
        onClick: () => openKanbanTaskModal(task, "chat"),
      },
      {
        key: "edit",
        label: interruptibleAgent ? "Edit & interrupt" : "Edit task",
        icon: <Pencil aria-hidden="true" />,
        onClick: () => openKanbanTaskModal(task, "edit"),
      },
      {
        key: "move",
        label: "Move to",
        icon: <GitBranch aria-hidden="true" />,
        onClick: () => undefined,
        children: moveTargets,
      },
      ...(task.status === "done" || task.status === "needs-human" ? [{
        key: "undo",
        label: "Undo work",
        icon: <RotateCcw aria-hidden="true" />,
        onClick: () => void requestKanbanTaskUndo(task),
      } satisfies CellMenuItem] : []),
      ...(task.status === "ideas" ? [
        {
          key: "specify",
          label: "Specify",
          icon: <Pencil aria-hidden="true" />,
          onClick: () => void promoteKanbanIdea(task, "specify"),
        } satisfies CellMenuItem,
        {
          key: "decompose",
          label: "Decompose",
          icon: <GitBranch aria-hidden="true" />,
          onClick: () => void promoteKanbanIdea(task, "decompose"),
        } satisfies CellMenuItem,
      ] : []),
      {
        key: "assign",
        label: "Assign",
        icon: <Users aria-hidden="true" />,
        onClick: () => openKanbanTaskModal(task, "assign"),
      },
      {
        key: "events",
        label: taskEvents ? `Events (${taskEvents})` : "Events",
        icon: <Eye aria-hidden="true" />,
        onClick: () => openKanbanTaskModal(task, "events"),
      },
      ...(task.status === "archived" ? [{
        key: "restore",
        label: "Restore to Ideas",
        icon: <RotateCcw aria-hidden="true" />,
        onClick: () => void moveKanbanTask(task.id, "ideas"),
      } satisfies CellMenuItem] : [{
        key: "archive",
        label: "Archive",
        icon: <Archive aria-hidden="true" />,
        onClick: () => void moveKanbanTask(task.id, "archived"),
      } satisfies CellMenuItem]),
      {
        key: "delete",
        label: "Delete task",
        icon: <Trash2 aria-hidden="true" />,
        onClick: () => void deleteKanbanTask(task),
        destructive: true,
      },
    ];
  }
  /* eslint-enable react-hooks/refs */

  async function orchestrateReadyKanbanTask(task: KanbanTask) {
    const orchestrationStartedAt = Date.now();
    // True once the user manually moves this card somewhere other than Ready
    // after pickup began; claiming would overwrite (snap back) their move.
    const movedAwayManually = () => {
      const manualMove = kanbanManualMoveRef.current.get(task.id);
      return Boolean(manualMove && manualMove.at >= orchestrationStartedAt && manualMove.status !== "ready");
    };
    const cancelPickupForManualMove = () => {
      logClientTelemetry("kanban.ready.orchestrate.cancelled_manual_move", {
        taskId: task.id,
        manualStatus: kanbanManualMoveRef.current.get(task.id)?.status ?? null,
      });
      setKanbanPickupPreviewByTask((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
    };
    const undoRequested = Boolean(task.undoRequestedAt);
    const targetAgents = agentsForKanbanTask(task);
    const dispatchAgents = undoRequested
      ? [
        ...targetAgents.filter((agent) => agent.beeRole !== "queen"),
        ...targetAgents.filter((agent) => agent.beeRole === "queen"),
      ]
      : targetAgents;
    logClientTelemetry("kanban.ready.orchestrate.start", {
      taskId: task.id,
      status: task.status,
      displayAgentCount: displayAgents.length,
      eligibleAgentCount: dispatchAgents.length,
      targetMachine: task.targetMachine?.name ?? "Any machine",
      undoRequested,
    });
    if (dispatchAgents.length === 0) {
      logClientTelemetry("kanban.ready.orchestrate.no_agents", { taskId: task.id });
      if (task.targetMachine?.name) {
        await patchKanbanTask(task.id, {
          status: "needs-human",
          agentSession: null,
          result: `No reachable agent is available on ${task.targetMachine.name}. Choose another machine or set the task back to Any machine, then retry.`,
        });
      }
      await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
      return;
    }

    const excludedAgentIds = new Set<string>();

    while (excludedAgentIds.size < dispatchAgents.length) {
      if (movedAwayManually()) {
        cancelPickupForManualMove();
        return;
      }
      // eslint-disable-next-line react-hooks/purity
      const now = Date.now();
      const eligibleAgents = dispatchAgents.filter((agent) => {
        const cooldownUntil = kanbanDispatchCooldownRef.current.get(agent.id) ?? 0;
        return !excludedAgentIds.has(agent.id)
          && cooldownUntil <= now;
      });
      const assignment = chooseBeeAssignment(task, eligibleAgents, { preferQueen: !undoRequested });
      if (assignment.mode === "pending") {
        logClientTelemetry("kanban.ready.orchestrate.pending", {
          taskId: task.id,
          excludedAgentCount: excludedAgentIds.size,
          eligibleAgentCount: eligibleAgents.length,
          undoRequested,
        });
        await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
        return;
      }

      const owner = assignment.worker ?? assignment.queen;
      if (!owner) return;
      const setupIssue = chatSetupIssue(owner);
      if (setupIssue) {
        logClientTelemetry("kanban.ready.owner.setup_blocked", {
          taskId: task.id,
          agentId: owner.id,
          agentName: owner.name,
          setupIssue,
        });
        excludedAgentIds.add(owner.id);
        await addKanbanSystemComment(task.id, `Ready for Queen, but ${owner.name} cannot receive delegated work yet: ${setupIssue}`);
        continue;
      }
      logClientTelemetry("kanban.ready.pickup_preview", {
        taskId: task.id,
        agentId: owner.id,
        agentName: owner.name,
        assignmentMode: assignment.mode,
        workerClass: assignment.workerClass,
      });
      setKanbanPickupPreviewByTask((current) => ({
        ...current,
        [task.id]: {
          icon: beeRoleIconPath(
            owner.beeRole === "queen" ? "queen" : "worker",
            owner.workerClass ?? assignment.workerClass ?? "general",
          ),
          label: assignment.mode === "queen" ? "Queen Bee picked up" : `${beeWorkerClassLabel(assignment.workerClass)} bee picked up`,
          assignee: owner.name,
        },
      }));
      await wait(KANBAN_PICKUP_PREVIEW_MS);
      if (movedAwayManually()) {
        // The user moved the card during the pickup preview; claiming now
        // would flip it back to Working against their intent.
        cancelPickupForManualMove();
        return;
      }
      const response = await fetch(`/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...kanbanStorageBody(),
          taskId: task.id,
          patch: {
            assignee: owner.name,
            tenant: assignment.mode === "queen" ? "queen-bee" : `${assignment.workerClass}-worker`,
            status: "working",
            agentSession: null,
            result: "",
          },
        }),
      });
      const data = await response.json().catch(() => null) as KanbanResponse | null;
      if (!response.ok || !data?.ok) {
        logClientTelemetry("kanban.ready.claim.failed", {
          taskId: task.id,
          agentId: owner.id,
          error: data?.error ?? `HTTP ${response.status}`,
        });
        setKanbanPickupPreviewByTask((current) => {
          const next = { ...current };
          delete next[task.id];
          return next;
        });
        setKanbanError(data?.error ?? "Queen Bee could not claim the task.");
        return;
      }
      logClientTelemetry("kanban.ready.claim.saved", {
        taskId: task.id,
        agentId: owner.id,
        returnedStatus: data.task?.status ?? null,
      });
      if (data.task?.status !== "working") {
        const returnedStatus = data.task?.status ?? "unknown";
        logClientTelemetry("kanban.ready.claim.rejected_status", {
          taskId: task.id,
          agentId: owner.id,
          returnedStatus,
          result: data.task?.result ?? null,
        });
        setKanbanPickupPreviewByTask((current) => {
          const next = { ...current };
          delete next[task.id];
          return next;
        });
        await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
        return;
      }
      setKanbanPickupPreviewByTask((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
      await addKanbanSystemComment(
        task.id,
        [
          assignment.mode === "queen" && assignment.queen
            ? `Assigned to Queen Bee ${assignment.queen.name} for review and delegation.`
            : `Assigned to ${owner.name}.`,
          `Suggested work class: ${beeWorkerClassLabel(assignment.workerClass)}.`,
          assignment.reason,
        ].join(" "),
      );
      await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
      const dispatchResult = await dispatchKanbanTaskToAgentRef.current?.(task, owner, assignment, { leaveKanbanOpen: true }) ?? {
        ok: false,
        message: "Kanban dispatcher is not ready yet.",
      };
      logClientTelemetry("kanban.ready.dispatch.result", {
        taskId: task.id,
        agentId: owner.id,
        ok: dispatchResult.ok,
        messageLength: dispatchResult.message?.length ?? 0,
      });
      if (dispatchResult.ok) return;
      excludedAgentIds.add(owner.id);
      await addKanbanSystemComment(task.id, `Queen Bee is retrying with another eligible agent because ${owner.name} failed: ${dispatchResult.message}`);
    }

    await patchKanbanTask(task.id, {
      status: "needs-human",
      agentSession: null,
      result: task.targetMachine?.name
        ? `Queen Bee could not find a reachable eligible agent on ${task.targetMachine.name} for this task.`
        : "Queen Bee could not find a reachable eligible agent for this task.",
    });
    logClientTelemetry("kanban.ready.orchestrate.exhausted", {
      taskId: task.id,
      excludedAgentCount: excludedAgentIds.size,
    });
    setKanbanPickupPreviewByTask((current) => {
      const next = { ...current };
      delete next[task.id];
      return next;
    });
    await addKanbanSystemComment(
      task.id,
      task.targetMachine?.name
        ? `Queen Bee could not find a reachable eligible agent on ${task.targetMachine.name} for this task.`
        : "Queen Bee could not find a reachable eligible agent for this task.",
    );
    await refreshKanbanOnce().catch((error) => setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed."));
  }

  async function addKanbanSystemComment(taskId: string, body: string) {
    const response = await fetch(`/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...kanbanStorageBody(), action: "comment", taskId, body, author: "queen-bee" }),
    });
    const data = await response.json().catch(() => null) as KanbanResponse | null;
    if (!response.ok || !data?.ok) {
      setKanbanError(data?.error ?? "Could not record Queen Bee note.");
    }
  }


  return { kanbanNotice, setKanbanNotice, kanbanClearingColumnId, createKanbanTask, createKanbanBoard, patchKanbanTask, bulkPatchKanbanTasks, clearKanbanColumnTasks, promoteKanbanIdea, updateKanbanTaskMachine, markKanbanTaskReviewed, requestKanbanTaskUndo, readWorkspaceGitSnapshot, kanbanWorkspaceChangeSummary, addKanbanCardFiles, openKanbanCardFilePicker, handleKanbanCardFileChange, handleKanbanCardImageChange, attachKanbanCardDirectory, attachKanbanCardRecentDirectory, removeKanbanCardAttachment, removeKanbanCardDirectory, moveKanbanTask, deleteKanbanTask, editAndInterruptKanbanTask, openKanbanTaskModal, kanbanTaskMenuItems, orchestrateReadyKanbanTask, addKanbanSystemComment };
}
