// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChatInlineMarkdown } from "@/features/dashboard/ChatMarkdown";
import { createStyleClass } from "@/features/dashboard/style-classes";
import { extractActionNeeded } from "@/features/dashboard/kanban-result-format";
import convoStyles from "@/app/kanban-conversation.module.css";
import type { WorkHistoryPayload } from "@/lib/types/work-history";
import { KanbanTaskModal } from "./KanbanTaskModal";
import { WorkSectionHeader } from "./WorkSectionHeader";

const convoClass = createStyleClass(convoStyles);

const EMPTY_WORK_HISTORY: WorkHistoryPayload = { projects: [], entries: [] };
const WORK_HISTORY_PAGE_SIZE = 10;
const codeProofPillStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 22,
  border: "1px solid rgba(111,205,186,0.34)",
  borderRadius: 999,
  background: "rgba(111,205,186,0.14)",
  color: "#6fcdba",
  padding: "3px 9px",
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase" as const,
};

function compactWorkHistoryTimestamp(timestamp?: string) {
  return (timestamp ?? "")
    .replace(/(\d{2}:\d{2}):\d{2}/, "$1")
    .replace(/\s+[+-]\d{4}$/, "")
    .replace(/\s+[+-]\d{2}(?::?\d{2})?$/, "")
    .trim();
}

function KanbanPanelBase(props: any) {
  const { AttachmentListMenuContent, AttachmentMenuContent, CellMenu, ChatMarkdown, Check, ChevronDown, ChevronRight, ComposerField, DEFAULT_SHARED_VAULT, ExternalLink, Eye, FolderOpen, Image, KANBAN_COLUMNS, KANBAN_STEER_TARGETS, MessageAttachments, MessageSquare, Paperclip, Plus, RotateCcw, Search, Settings2, activeView, attachKanbanCardDirectory, attachKanbanCardRecentDirectory, attachKanbanSteerDirectory, attachKanbanSteerRecentDirectory, attachQuickAddDirectory, attachQuickAddRecentDirectory, bulkPatchKanbanTasks, chatClass, createKanbanBoard, createKanbanTask, displayAgents, editAndInterruptKanbanTask, expandedKanbanCards, formatDurationShort, formatMessageTimestamp, formatRelativeTime, handleKanbanCardFileChange, handleKanbanCardImageChange, handleKanbanSteerFileChange, handleKanbanSteerImageChange, handleQuickAddFileChange, handleQuickAddImageChange, importNoteIntake, initialWorkHistory, isKanbanStaleWorkingTask, isKanbanTerminalMessage, kanbanAssigneeFilter, kanbanAssigneeOptions, kanbanBoard, kanbanBoardScrollRef, kanbanBoardScrollState, kanbanBoardSlug, kanbanBoards, kanbanBulkAssignee, kanbanBulkPending, kanbanCardAttachmentListOpen, kanbanCardAttachmentMenuOpen, kanbanCardDeliverableMenuOpen, kanbanCardFileInputRef, kanbanCardImageInputRef, kanbanCardMachineMenuOpen, kanbanCardMessage, kanbanCardRecentsExpanded, kanbanClass, kanbanEditDraft, kanbanEditPendingTaskId, kanbanError, kanbanEventLabel, kanbanIncludeArchived, kanbanInitialLoading, kanbanLoading, kanbanMachineTargets, kanbanNotice, kanbanPickupPreviewByTask, kanbanSearch, kanbanStaleAge, kanbanSteerAttachmentError, kanbanSteerAttachmentMenuOpen, kanbanSteerAttachmentMenuRef, kanbanSteerAttachments, kanbanSteerDirectories, kanbanSteerDraft, kanbanSteerFileInputRef, kanbanSteerImageInputRef, kanbanSteerTargetMenuOpen, kanbanSteerTargetMenuRef, kanbanSteerTargetStatus, kanbanSteeringTaskId, kanbanStorage, kanbanTaskBee, kanbanTaskMenuItems, kanbanTaskModal, kanbanTenantFilter, kanbanTenants, kanbanViewColumns, markKanbanTaskReviewed, moveKanbanTask, newBoardDraft, noteIntakePending, noteIntakePreview, noteIntakeStatus, openKanbanCardFilePicker, openKanbanTaskModal, patchKanbanTask, quickAddAttachmentError, quickAddAttachmentMenuOpen, quickAddAttachmentMenuRef, quickAddAttachments, quickAddDirectories, quickAddDrafts, quickAddFileInputRef, quickAddImageInputRef, quickAddMachineMenuOpen, quickAddMachineMenuRef, quickAddMachineTarget, quickAddMachineTargets, quickAddStatus, recentDirectories, recentDirectoriesExpanded, recording, refreshKanbanOnce, removeKanbanCardAttachment, removeKanbanCardDirectory, removeKanbanSteerAttachment, removeKanbanSteerDirectory, removeQuickAddAttachment, removeQuickAddDirectory, scanNoteIntake, selectedKanbanAgent, selectedKanbanAgentMessages, selectedKanbanBulkIds, selectedKanbanComments, selectedKanbanEvents, selectedKanbanTask, selectedKanbanTaskId, selectedKanbanTaskIds, setActiveView, setExpandedKanbanCards, setKanbanAssigneeFilter, setKanbanBoardSlug, setKanbanBulkAssignee, setKanbanCardAttachmentListOpen, setKanbanCardAttachmentMenuOpen, setKanbanCardDeliverableMenuOpen, setKanbanCardMachineMenuOpen, setKanbanCardRecentsExpanded, setKanbanEditDraft, setKanbanError, setKanbanIncludeArchived, setKanbanLoading, setKanbanNotice, setKanbanSearch, setKanbanSteerAttachmentMenuOpen, setKanbanSteerDraft, setKanbanSteerTargetMenuOpen, setKanbanSteerTargetStatus, setKanbanTaskModal, setKanbanTenantFilter, setNewBoardDraft, setQuickAddAttachmentError, setQuickAddAttachmentMenuOpen, setQuickAddDrafts, setQuickAddMachineMenuOpen, setQuickAddMachineTargets, setQuickAddStatus, setRecentDirectoriesExpanded, setSelectedKanbanTaskIds, sharedVault, startAudioRecording, steerSelectedKanbanTask, stopAudioRecording, updateKanbanTaskMachine, updateSharedVault, voiceBands, voiceTarget, voiceTranscript, workBoardStats } = props;
  const [workHistory, setWorkHistory] = useState<WorkHistoryPayload>(initialWorkHistory ?? EMPTY_WORK_HISTORY);
  const [workHistoryLoading, setWorkHistoryLoading] = useState(false);
  const [workHistoryLoadingMore, setWorkHistoryLoadingMore] = useState(false);
  const [workHistoryError, setWorkHistoryError] = useState("");
  const [workHistoryProject, setWorkHistoryProject] = useState("");
  const [workHistoryQuery, setWorkHistoryQuery] = useState("");
  const [deliverableMenuPosition, setDeliverableMenuPosition] = useState<Record<string, any>>({});
  const [kanbanDragOverColumn, setKanbanDragOverColumn] = useState("");
  const [codeProjects, setCodeProjects] = useState<any[]>([]);
  const [selectedCodeProjectId, setSelectedCodeProjectId] = useState("");
  const [gitlawbStatus, setGitlawbStatus] = useState<any>(null);
  const workHistorySkipInitialFetchRef = useRef(Boolean(initialWorkHistory?.generatedAt));
  const workHistoryEntryCountRef = useRef(workHistory.entries.length);
  const kanbanFallbackRefreshKeyRef = useRef("");
  const sharedVaultPath = sharedVault?.vaultPath;
  const kanbanShowingInitialLoading = activeView === "kanban" && !kanbanBoard && !kanbanError;
  const workHistoryInitialLoading = activeView === "history" && !workHistory.generatedAt && !workHistory.entries.length && !workHistoryError;
  const workHistoryShowingLoading = workHistoryLoading || workHistoryInitialLoading;
  const workHistoryOpenCount = useMemo(
    () => workHistory.entries.filter((entry) => entry.status === "Uncommitted").length,
    [workHistory.entries],
  );
  const kanbanActiveFilterCount = [
    kanbanTenantFilter,
    kanbanAssigneeFilter,
    kanbanSearch.trim(),
    kanbanIncludeArchived ? "archived" : "",
  ].filter(Boolean).length;
  const selectWorkMode = (mode: any) => {
    if ((mode === "kanban" || mode === "history") && !kanbanBoard) setKanbanLoading(true);
    setActiveView(mode);
  };
  const reloadKanbanBoard = useCallback(async () => {
    kanbanFallbackRefreshKeyRef.current = "";
    setKanbanTenantFilter("");
    setKanbanAssigneeFilter("");
    setKanbanSearch("");
    setKanbanIncludeArchived(false);
    setKanbanError("");
    setKanbanLoading(true);
    try {
      await refreshKanbanOnce({
        assignee: "",
        includeArchived: false,
        query: "",
        tenant: "",
      });
    } catch (error) {
      setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed.");
    } finally {
      setKanbanLoading(false);
    }
  }, [
    refreshKanbanOnce,
    setKanbanAssigneeFilter,
    setKanbanError,
    setKanbanIncludeArchived,
    setKanbanLoading,
    setKanbanSearch,
    setKanbanTenantFilter,
  ]);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const deliverableMenuStyle = (anchor: HTMLElement) => {
    if (typeof window === "undefined") return undefined;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(340, Math.max(260, window.innerWidth - 32));
    const left = Math.min(Math.max(16, rect.right - width), window.innerWidth - width - 16);
    const opensBelow = rect.top < 220;
    return {
      bottom: "auto",
      left,
      position: "fixed",
      right: "auto",
      top: opensBelow ? rect.bottom + 8 : rect.top - 8,
      transform: opensBelow ? "none" : "translateY(-100%)",
      width,
    };
  };
  const deliverableActionLabel = (deliverable: any) => {
    if (deliverable.kind === "website" || deliverable.kind === "url") return "Preview";
    if (deliverable.kind === "video") return "Preview video";
    if (deliverable.kind === "image") return "Preview image";
    if (deliverable.kind === "audio") return "Play audio";
    return "Open";
  };
  const emptyLaneMessage = (column: any) => {
    if (column.id === "ideas") return "Nothing in the backlog";
    if (column.id === "ready") return "Nothing waiting for Queen";
    if (column.id === "working") return "Nothing in progress";
    if (column.id === "needs-human") return "Nothing needs you";
    if (column.id === "done") return "No completed tasks yet";
    return "Nothing archived";
  };
  const fileManagerLabel = () => {
    const platform = typeof navigator === "undefined" ? "" : navigator.platform.toLowerCase();
    if (platform.includes("mac")) return "Show in Finder";
    if (platform.includes("win")) return "Show in Explorer";
    return "Show in folder";
  };
  const openDeliverable = async (deliverable: any, action: "open" | "reveal") => {
    const response = await fetch("/api/kanban/deliverable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, path: deliverable.path, url: deliverable.url }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not open deliverable.");
  };
  const codeProjectById = useMemo(() => new Map(codeProjects.map((project) => [project.id, project])), [codeProjects]);
  const kanbanTaskNoteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const comment of kanbanBoard?.comments ?? []) {
      counts[comment.taskId] = (counts[comment.taskId] ?? 0) + 1;
    }
    return counts;
  }, [kanbanBoard]);
  const proofStatusRank = (status?: string) => {
    if (status === "verified") return 4;
    if (status === "linked") return 3;
    if (status === "ready") return 2;
    if (status === "unavailable") return 1;
    return 0;
  };
  const proofKindRank = (kind?: string) => (kind === "task" ? 0 : 1);
  const activeProofForTask = (task: any) => Array.isArray(task.proofs)
    ? task.proofs.reduce((best: any, proof: any) => {
      if (!proof?.status || proof.status === "unavailable" || proof.status === "failed") return best;
      if (!best) return proof;
      const statusDelta = proofStatusRank(proof.status) - proofStatusRank(best.status);
      if (statusDelta !== 0) return statusDelta > 0 ? proof : best;
      const kindDelta = proofKindRank(proof.kind) - proofKindRank(best.kind);
      if (kindDelta !== 0) return kindDelta > 0 ? proof : best;
      return best;
    }, null)
    : null;
  const projectProofForTask = (task: any) => Array.isArray(task.proofs)
    ? task.proofs.find((item: any) => item?.kind === "task")
    : null;
  const proofSummaryForTask = (task: any) => {
    const proof = activeProofForTask(task);
    const projectProof = projectProofForTask(task);
    const project = task.projectId ? codeProjectById.get(task.projectId) : null;
    const linkedRepo = project?.gitlawbRepo;
    const repo = proof?.repo || projectProof?.repo || linkedRepo?.repoName || "";
    const branch = proof?.branch || projectProof?.branch || linkedRepo?.branch || "";
    const projectLabel = project?.name || projectProof?.metadata?.projectName || proof?.metadata?.projectName || repo || proof?.title || projectProof?.title || "";
    return {
      branch,
      linkedAt: linkedRepo?.linkedAt,
      projectLabel,
      proof,
      repo,
      status: proof?.status || projectProof?.status || (linkedRepo ? "linked" : gitlawbStatus?.cli?.installed && gitlawbStatus?.identity?.source === "local" ? "ready" : "unavailable"),
      title: proof?.title || proof?.metadata?.proofTitle || projectProof?.title || "",
    };
  };
  const proofLabelForTask = (task: any) => {
    const summary = proofSummaryForTask(task);
    if (summary.status === "verified") return "Code proof verified";
    if (summary.status === "linked") return "Code proof linked";
    if (summary.proof) return "Code proof linked";
    if (!task.projectId) return "";
    if (summary.status === "ready") return "Code proof ready";
    return "Code proof unavailable";
  };

  useEffect(() => {
    workHistoryEntryCountRef.current = workHistory.entries.length;
  }, [workHistory.entries.length]);

  useEffect(() => {
    if (activeView !== "kanban" || kanbanBoard || kanbanError) return;
    if (typeof refreshKanbanOnce !== "function") return;
    const refreshKey = [
      kanbanBoardSlug,
      kanbanIncludeArchived ? "archived" : "active",
      kanbanTenantFilter,
      kanbanAssigneeFilter,
      kanbanSearch,
    ].join("|");
    if (kanbanFallbackRefreshKeyRef.current === refreshKey) return;
    kanbanFallbackRefreshKeyRef.current = refreshKey;
    let cancelled = false;
    setKanbanLoading(true);
    Promise.resolve(refreshKanbanOnce())
      .catch((error) => {
        if (cancelled) return;
        kanbanFallbackRefreshKeyRef.current = "";
        setKanbanError(error instanceof Error ? error.message : "Kanban refresh failed.");
      })
      .finally(() => {
        if (!cancelled) setKanbanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeView,
    kanbanAssigneeFilter,
    kanbanBoard,
    kanbanBoardSlug,
    kanbanError,
    kanbanIncludeArchived,
    kanbanSearch,
    kanbanTenantFilter,
    refreshKanbanOnce,
    setKanbanError,
    setKanbanLoading,
  ]);

  useEffect(() => {
    if (activeView !== "kanban") return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (sharedVaultPath) params.set("vaultPath", sharedVaultPath);
    Promise.all([
      fetch(`/api/projects${params.toString() ? `?${params.toString()}` : ""}`, { signal: controller.signal }).then((response) => response.json()).catch(() => null),
      fetch("/api/gitlawb/status", { signal: controller.signal }).then((response) => response.json()).catch(() => null),
    ]).then(([projectsData, statusData]) => {
      if (projectsData?.ok) setCodeProjects(projectsData.projects ?? []);
      if (statusData?.ok) setGitlawbStatus(statusData.status);
    }).catch((error) => {
      if (error?.name !== "AbortError") setCodeProjects([]);
    });
    return () => controller.abort();
  }, [activeView, sharedVaultPath]);

  const loadWorkHistory = useCallback((options: { append?: boolean; signal?: AbortSignal } = {}) => {
    const append = Boolean(options.append);
    const params = new URLSearchParams({ limit: String(WORK_HISTORY_PAGE_SIZE) });
    if (append) params.set("offset", String(workHistoryEntryCountRef.current));
    if (sharedVaultPath) params.set("vaultPath", sharedVaultPath);
    if (workHistoryProject) params.set("project", workHistoryProject);
    if (workHistoryQuery.trim()) params.set("q", workHistoryQuery.trim());
    if (append) setWorkHistoryLoadingMore(true);
    else setWorkHistoryLoading(true);
    setWorkHistoryError("");
    return fetch(`/api/work-history?${params.toString()}`, { signal: options.signal })
      .then((response) => response.json())
      .then((data: WorkHistoryPayload) => {
        if (!data?.ok) throw new Error(data?.error || "Could not load work history.");
        setWorkHistory((current) => append
          ? {
            ...data,
            projects: data.projects?.length ? data.projects : current.projects,
            entries: [...current.entries, ...(data.entries ?? [])],
          }
          : data);
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setWorkHistoryError(error instanceof Error ? error.message : "Could not load work history.");
      })
      .finally(() => {
        if (append) setWorkHistoryLoadingMore(false);
        else setWorkHistoryLoading(false);
      });
  }, [sharedVaultPath, workHistoryProject, workHistoryQuery]);

  useEffect(() => {
    if (!kanbanNotice) return;
    const timeout = window.setTimeout(() => setKanbanNotice(""), 8000);
    return () => window.clearTimeout(timeout);
  }, [kanbanNotice, setKanbanNotice]);

  useEffect(() => {
    if (activeView !== "history") return;
    if (workHistorySkipInitialFetchRef.current && !workHistoryProject && !workHistoryQuery.trim()) {
      workHistorySkipInitialFetchRef.current = false;
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadWorkHistory({ signal: controller.signal });
    }, workHistoryQuery.trim() ? 220 : 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeView, loadWorkHistory, workHistoryProject, workHistoryQuery]);
  return (<>
      {activeView === "kanban" ? (
      <section className={kanbanClass("workBoardPanel", "tabPanel")}>
        <input
          ref={kanbanCardFileInputRef}
          type="file"
          multiple
          className={chatClass("chatFileInput")}
          onChange={handleKanbanCardFileChange}
        />
        <input
          ref={kanbanCardImageInputRef}
          type="file"
          accept="image/*"
          multiple
          className={chatClass("chatFileInput")}
          onChange={handleKanbanCardImageChange}
        />
        <div className={kanbanClass("workBoardShell")}>
          <WorkSectionHeader
            activeView={activeView}
            onSelect={selectWorkMode}
            title="Tasks"
            subtitle="Board"
            stats={[
              { value: workBoardStats.working, label: "working", tone: "honey" },
              { value: workBoardStats.needsHuman, label: "needs you", tone: "danger" },
              { value: workBoardStats.done, label: "done", tone: "cyan" },
              { value: workBoardStats.total, label: "total" },
            ]}
          />

          <section className={kanbanClass("workBoardControls")} aria-label="Work board controls">
            <label className={kanbanClass("workBoardField")}>
              <span>Tenant</span>
              <div className={kanbanClass("workBoardSelectShell")}>
                <select value={kanbanTenantFilter} onChange={(event) => setKanbanTenantFilter(event.target.value)}>
                  <option value="">All</option>
                  {kanbanTenants.map((tenant) => <option value={tenant} key={tenant}>{tenant}</option>)}
                </select>
                <ChevronDown aria-hidden="true" />
              </div>
            </label>
            <label className={kanbanClass("workBoardField")}>
              <span>Assignee</span>
              <div className={kanbanClass("workBoardSelectShell")}>
                <select value={kanbanAssigneeFilter} onChange={(event) => setKanbanAssigneeFilter(event.target.value)}>
                  <option value="">All</option>
                  {kanbanAssigneeOptions.map((assignee) => <option value={assignee} key={assignee}>{assignee}</option>)}
                </select>
                <ChevronDown aria-hidden="true" />
              </div>
            </label>
            <label className={kanbanClass("workBoardField")}>
              <span>Project</span>
              <div className={kanbanClass("workBoardSelectShell")}>
                <select value={selectedCodeProjectId} onChange={(event) => setSelectedCodeProjectId(event.target.value)}>
                  <option value="">No project</option>
                  {codeProjects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
                </select>
                <ChevronDown aria-hidden="true" />
              </div>
            </label>
            <label className={kanbanClass("workBoardField", "workBoardSearch")}>
              <span>Search</span>
              <div>
                <Search aria-hidden="true" />
                <input value={kanbanSearch} onChange={(event) => setKanbanSearch(event.target.value)} placeholder="title, note, result..." />
              </div>
            </label>
            <label className={kanbanClass("workBoardToggle")}>
              <input
                type="checkbox"
                checked={kanbanIncludeArchived}
                onChange={(event) => setKanbanIncludeArchived(event.target.checked)}
              />
              <span>Archived</span>
            </label>
            <button
              type="button"
              className={kanbanClass("workBoardActionButton")}
              disabled={kanbanLoading}
              onClick={() => void reloadKanbanBoard()}
              title={kanbanActiveFilterCount > 0 ? "Reset filters and refresh tasks" : "Refresh tasks"}
            >
              <RotateCcw aria-hidden="true" />
              {kanbanActiveFilterCount > 0 ? "Reset" : "Refresh"}
            </button>
            <details className={kanbanClass("kanbanAdvanced", "workBoardOptions")}>
              <summary><Settings2 aria-hidden="true" /> Board</summary>
              <div className={kanbanClass("kanbanAdvancedPanel")}>
                <label>
                  Board
                  <select value={kanbanBoardSlug} onChange={(event) => setKanbanBoardSlug(event.target.value)}>
                    {kanbanBoards.length > 0 ? kanbanBoards.map((board) => (
                      <option value={board.slug} key={board.slug}>{board.name}</option>
                    )) : <option value="default">Default</option>}
                  </select>
                </label>
                <form className={kanbanClass("kanbanBoardCreate")} onSubmit={createKanbanBoard}>
                  <input
                    value={newBoardDraft.slug}
                    onChange={(event) => setNewBoardDraft((current) => ({ ...current, slug: event.target.value }))}
                    placeholder="new-board"
                  />
                  <input
                    value={newBoardDraft.name}
                    onChange={(event) => setNewBoardDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Display name"
                  />
                  <button type="submit">Create</button>
                </form>
                <div className={kanbanClass("kanbanNoteIntake")}>
                  <label className={kanbanClass("toggleRow")}>
                    <input
                      type="checkbox"
                      checked={sharedVault.noteTaskImportEnabled}
                      onChange={(event) => updateSharedVault({ noteTaskImportEnabled: event.target.checked })}
                    />
                    Auto-import note tasks to Ideas
                  </label>
                  <label>
                    Note task folders
                    <textarea
                      value={sharedVault.noteTaskImportFolders || DEFAULT_SHARED_VAULT.noteTaskImportFolders}
                      onChange={(event) => updateSharedVault({ noteTaskImportFolders: event.target.value })}
                      rows={3}
                      placeholder="Projects&#10;Intake&#10;Memory"
                    />
                  </label>
                  <div className={kanbanClass("kanbanNoteActions")}>
                    <button type="button" disabled={Boolean(noteIntakePending)} onClick={() => scanNoteIntake()}>
                      {noteIntakePending === "scan" ? "Scanning..." : "Scan notes"}
                    </button>
                    <button type="button" disabled={Boolean(noteIntakePending)} onClick={() => importNoteIntake()}>
                      {noteIntakePending === "import" ? "Importing..." : "Import to Ideas"}
                    </button>
                  </div>
                  <small>
                    {noteIntakeStatus || "Reads markdown project notes for unchecked tasks and Next action sections."}
                  </small>
                  {noteIntakePreview.length > 0 ? (
                    <ul>
                      {noteIntakePreview.slice(0, 5).map((candidate) => (
                        <li key={candidate.idempotencyKey}>
                          <span>{candidate.title}</span>
                          <small>{candidate.sourcePath}:{candidate.line}</small>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <small>{kanbanStorage?.file ?? "Storage path loading..."}</small>
              </div>
            </details>
            <span
              className={kanbanClass("kanbanSyncPill", kanbanStorage?.source === "obsidian" ? "synced" : "local")}
              title={kanbanStorage?.file}
            >
              <span className={kanbanClass("liveDot")} aria-hidden="true" />
              {kanbanStorage?.source === "obsidian" ? "Obsidian synced" : "Local fallback"}
            </span>
          </section>

          {kanbanError ? <p className={kanbanClass("kanbanError")}>{kanbanError}</p> : null}
          {kanbanNotice ? <p className={convoClass("kanbanNotice")} role="status">{kanbanNotice}</p> : null}

          {selectedKanbanBulkIds.length > 0 ? (
            <section className={kanbanClass("kanbanBulkBar")} aria-label="Selected task actions">
              <strong>{selectedKanbanBulkIds.length} selected</strong>
              <button type="button" disabled={kanbanBulkPending} onClick={() => void bulkPatchKanbanTasks({ status: "ready" })}>Ready</button>
              <button type="button" disabled={kanbanBulkPending} onClick={() => void bulkPatchKanbanTasks({ status: "needs-human" })}>Needs You</button>
              <button type="button" disabled={kanbanBulkPending} onClick={() => void bulkPatchKanbanTasks({ status: "done" })}>Done</button>
              <button type="button" disabled={kanbanBulkPending} onClick={() => void bulkPatchKanbanTasks({ status: "archived" })}>Archive</button>
              <select value={kanbanBulkAssignee} onChange={(event) => setKanbanBulkAssignee(event.target.value)} aria-label="Bulk assignee">
                <option value="">Reassign...</option>
                <option value="__unassigned__">Unassigned</option>
                {kanbanAssigneeOptions.map((assignee) => <option value={assignee} key={assignee}>{assignee}</option>)}
              </select>
              <button
                type="button"
                disabled={kanbanBulkPending || !kanbanBulkAssignee}
                onClick={() => void bulkPatchKanbanTasks({ assignee: kanbanBulkAssignee === "__unassigned__" ? "" : kanbanBulkAssignee })}
              >
                Apply
              </button>
              <button type="button" disabled={kanbanBulkPending} onClick={() => setSelectedKanbanTaskIds({})}>Clear</button>
            </section>
          ) : null}

            <div className={kanbanClass("kanbanWorkspace", "noDrawer")}>
              <div className={kanbanClass("kanbanBoardStage")}>
              {kanbanBoardScrollState.canScrollLeft ? (
              <button
                type="button"
                className={kanbanClass("kanbanBoardScrollFab", "left")}
                onClick={() => kanbanBoardScrollRef.current?.scrollBy({ left: -360, behavior: "smooth" })}
                aria-label="Scroll left"
                title="Scroll left"
              >
                <ChevronRight aria-hidden="true" />
              </button>
              ) : null}
              <div ref={kanbanBoardScrollRef} className={kanbanClass("kanbanBoard")} aria-label="Multi-agent Kanban board" aria-busy={kanbanLoading || undefined}>
              {kanbanViewColumns.map((column) => (
                <section
                  className={`${kanbanClass("kanbanColumn", column.id)}${kanbanDragOverColumn === column.id ? ` ${convoClass("laneDropTarget")}` : ""}`}
                  key={column.id}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setKanbanDragOverColumn(column.id);
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                    setKanbanDragOverColumn((current) => (current === column.id ? "" : current));
                  }}
                  onDrop={(event) => {
                    setKanbanDragOverColumn("");
                    const taskId = event.dataTransfer.getData("text/plain");
                    if (taskId) moveKanbanTask(taskId, column.id);
                  }}
                >
                  <div className={kanbanClass("kanbanColumnHeader")}>
                    <span className={kanbanClass("kanbanColumnDot", column.id)} aria-hidden="true" />
                    <div>
                      <h3>{column.title}</h3>
                      <p>{column.description}</p>
                    </div>
                    <span className={kanbanClass("kanbanColumnCount")}>{column.tasks.length}</span>
                    <button
                      type="button"
                      className={kanbanClass("kanbanAddColumnTask")}
                      data-bee={`kanban-add-${column.id}`}
                      onClick={() => setQuickAddStatus((current) => current === column.id ? "" : column.id)}
                      aria-label={`Add task to ${column.title}`}
                      title={`Add task to ${column.title}`}
                    >
                      <Plus aria-hidden="true" />
                    </button>
                  </div>
                  <div className={kanbanClass("kanbanCards", "scrollbar-thin")}>
                    {kanbanInitialLoading || kanbanShowingInitialLoading ? (
                      Array.from({ length: column.id === "done" ? 1 : 2 }).map((_, index) => (
                        <article className={kanbanClass("kanbanCardShell", "kanbanSkeletonShell")} key={`${column.id}-skeleton-${index}`} aria-hidden="true">
                          <div className={kanbanClass("kanbanCard", "kanbanSkeletonCard")}>
                            <span className={kanbanClass("kanbanSkeletonPill")} />
                            <strong />
                            <span className={kanbanClass("kanbanSkeletonLine", "wide")} />
                            <span className={kanbanClass("kanbanSkeletonLine")} />
                            <span className={kanbanClass("kanbanSkeletonFooter")} />
                          </div>
                        </article>
                      ))
                    ) : quickAddStatus === column.id ? (
                      <form
                        className={kanbanClass("kanbanInlineAdd")}
                        data-bee={`kanban-quick-add-${column.id}`}
                        onSubmit={(event) => createKanbanTask(event, column.id, selectedCodeProjectId || undefined)}
                      >
                        <div className={kanbanClass("kanbanInlineAddMeta")} ref={quickAddMachineMenuRef}>
                          <div className={kanbanClass("kanbanMachinePicker")}>
                            <button
                              type="button"
                              aria-expanded={Boolean(quickAddMachineMenuOpen[column.id])}
                              onClick={() => setQuickAddMachineMenuOpen((current) => ({ ...current, [column.id]: !current[column.id] }))}
                            >
                              {quickAddMachineTarget(column.id)?.name ?? "Any machine"}
                              <ChevronDown aria-hidden="true" />
                            </button>
                            {quickAddMachineMenuOpen[column.id] ? (
                              <div className={kanbanClass("kanbanMachineMenu")} role="menu">
                                <button
                                  type="button"
                                  role="menuitemradio"
                                  aria-checked={Object.prototype.hasOwnProperty.call(quickAddMachineTargets, column.id) && !quickAddMachineTargets[column.id]}
                                  onClick={() => {
                                    setQuickAddMachineTargets((current) => ({ ...current, [column.id]: null }));
                                    setQuickAddMachineMenuOpen((current) => ({ ...current, [column.id]: false }));
                                  }}
                                >
                                  Any machine
                                </button>
                                {kanbanMachineTargets.map((machine) => (
                                  <button
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={quickAddMachineTarget(column.id)?.key === machine.key}
                                    key={machine.key}
                                    onClick={() => {
                                      setQuickAddMachineTargets((current) => ({ ...current, [column.id]: machine }));
                                      setQuickAddMachineMenuOpen((current) => ({ ...current, [column.id]: false }));
                                    }}
                                  >
                                    {machine.name}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <ComposerField
                          compact
                          value={quickAddDrafts[column.id] ?? ""}
                          onChange={(value) => setQuickAddDrafts((current) => ({ ...current, [column.id]: value }))}
                          placeholder={`Add to ${column.title}`}
                          attachments={quickAddAttachments[column.id] ?? []}
                          directories={quickAddDirectories[column.id] ?? []}
                          attachmentError={quickAddAttachmentError}
                          attachmentMenuOpen={quickAddAttachmentMenuOpen}
                          setAttachmentMenuOpen={setQuickAddAttachmentMenuOpen}
                          attachmentMenuRef={quickAddAttachmentMenuRef}
                          fileInputRef={quickAddFileInputRef}
                          imageInputRef={quickAddImageInputRef}
                          onFileChange={(event) => handleQuickAddFileChange(column.id, event)}
                          onImageChange={(event) => handleQuickAddImageChange(column.id, event)}
                          onRemoveAttachment={(id) => removeQuickAddAttachment(column.id, id)}
                          onAttachDirectory={() => void attachQuickAddDirectory(column.id)}
                          directoryPickerDisabled={!quickAddMachineTarget(column.id)}
                          directoryPickerDisabledReason="Choose a specific machine before selecting a directory."
                          recentDirectories={recentDirectories}
                          recentDirectoriesExpanded={recentDirectoriesExpanded}
                          setRecentDirectoriesExpanded={setRecentDirectoriesExpanded}
                          onAttachRecentDirectory={(directory) => attachQuickAddRecentDirectory(column.id, directory)}
                          onRemoveDirectory={(id) => removeQuickAddDirectory(column.id, id)}
                          recording={recording && voiceTarget === column.id}
                          voiceBands={voiceBands}
                          voiceTranscript={voiceTranscript}
                          onToggleRecording={recording ? stopAudioRecording : () => void startAudioRecording(column.id)}
                          canSend={Boolean((quickAddDrafts[column.id] ?? "").trim() || (quickAddAttachments[column.id] ?? []).length || (quickAddDirectories[column.id] ?? []).length)}
                          onCancel={() => {
                            setQuickAddStatus("");
                            setQuickAddAttachmentError("");
                            setQuickAddAttachmentMenuOpen(false);
                            setQuickAddMachineMenuOpen((current) => ({ ...current, [column.id]: false }));
                          }}
                        />
                      </form>
                    ) : null}
                    {!kanbanShowingInitialLoading && !kanbanInitialLoading && column.tasks.map((task) => {
                      const columnIndex = kanbanViewColumns.findIndex((item) => item.id === task.status);
                      const previousColumn = columnIndex > 0 ? kanbanViewColumns[columnIndex - 1] : null;
                      const nextColumn = columnIndex >= 0 && columnIndex < kanbanViewColumns.length - 1 ? kanbanViewColumns[columnIndex + 1] : null;
                      const bee = kanbanTaskBee(task, displayAgents);
                      const workingWithAgent = task.status === "working" && Boolean(task.assignee?.trim());
                      const staleWorking = isKanbanStaleWorkingTask(task);
                      const message = kanbanCardMessage(task);
                      const canExpandMessage = message.length > 120;
                      const messageExpanded = Boolean(expandedKanbanCards[task.id]);
                      const terminalMessage = isKanbanTerminalMessage(message);
                      const pickupPreview = kanbanPickupPreviewByTask[task.id];
                      const taskAttachmentCount = (task.attachments?.length ?? 0) + (task.linkedDirectories?.length ?? 0);
                      const deliverables = task.status === "done" ? (task.deliverables ?? []) : [];
                      const undoInProgress = Boolean(task.undoRequestedAt && (task.status === "ready" || task.status === "working"));
                      const taskProject = task.projectId ? codeProjectById.get(task.projectId) : null;
                      const proofSummary = proofSummaryForTask(task);
                      const proofLabel = proofLabelForTask(task);
                      const needsYouAsk = task.status === "needs-human" ? extractActionNeeded(task.result) : "";
                      return (
                        <article className={kanbanClass("kanbanCardShell")} key={task.id}>
                          <div
                            draggable
                            role="button"
                            tabIndex={0}
                            className={kanbanClass("kanbanCard", task.id === selectedKanbanTaskId && "active", workingWithAgent && "working", staleWorking && "stale", messageExpanded && "expanded")}
                            onClick={() => openKanbanTaskModal(task, "chat")}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              openKanbanTaskModal(task, "chat");
                            }}
                            onDragStart={(event) => event.dataTransfer.setData("text/plain", task.id)}
                            onDragEnd={() => setKanbanDragOverColumn("")}
                          >
                            <div className={kanbanClass("kanbanCardHeader")}>
                              <input
                                type="checkbox"
                                checked={Boolean(selectedKanbanTaskIds[task.id])}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => {
                                  setSelectedKanbanTaskIds((current) => {
                                    const next = { ...current };
                                    if (event.target.checked) next[task.id] = true;
                                    else delete next[task.id];
                                    return next;
                                  });
                                }}
                                aria-label={`Select ${task.title}`}
                              />
                              {task.priority !== "normal" ? (
                                <span className={kanbanClass("priorityPill", task.priority)}>{task.priority}</span>
                              ) : null}
                              {undoInProgress ? (
                                <span className={kanbanClass("kanbanUndoBadge")} title="Undo is underway">
                                  <RotateCcw aria-hidden="true" />
                                  Undo
                                </span>
                              ) : null}
                              {pickupPreview ? (
                                <span
                                  className={kanbanClass("kanbanPickupPreview")}
                                  title={`${pickupPreview.assignee} is claiming this task`}
                                >
                                  <Image src={pickupPreview.icon || "/icons/worker-bee-general-v2.png"} alt="" width={26} height={26} aria-hidden="true" unoptimized />
                                  <small>{pickupPreview.label}</small>
                                </span>
                              ) : null}
                            </div>
                            <strong className={kanbanClass("kanbanCardTitle")}>{task.title}</strong>
                            {proofLabel ? (
                              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                                {taskProject ? (
                                  <span style={codeProofPillStyle} title={taskProject.gitlawbRepo?.repoName || taskProject.name}>
                                    {taskProject.name}
                                  </span>
                                ) : proofSummary.projectLabel || proofSummary.repo || proofSummary.title ? (
                                  <span style={codeProofPillStyle} title={proofSummary.repo || proofSummary.title || proofSummary.projectLabel}>
                                    {proofSummary.projectLabel || proofSummary.repo || proofSummary.title}
                                  </span>
                                ) : null}
                                <span style={codeProofPillStyle}>{proofLabel}</span>
                              </div>
                            ) : null}
                            <div className={`${kanbanClass("kanbanCardMeta")} ${convoClass("cardQuietMeta")}`}>
                              <div className={kanbanClass("kanbanMachinePicker")} data-kanban-machine-menu="true">
                                <button
                                  type="button"
                                  className={kanbanClass("kanbanMachineLabel")}
                                  aria-expanded={Boolean(kanbanCardMachineMenuOpen[task.id])}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setKanbanCardMachineMenuOpen((current) => ({ ...current, [task.id]: !current[task.id] }));
                                  }}
                                >
                                  {task.targetMachine?.name ?? "Any machine"}
                                  <ChevronDown aria-hidden="true" />
                                </button>
                                {kanbanCardMachineMenuOpen[task.id] ? (
                                <div className={kanbanClass("kanbanMachineMenu")} role="menu">
                                  <button
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={!task.targetMachine?.key}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setKanbanCardMachineMenuOpen((current) => ({ ...current, [task.id]: false }));
                                      void updateKanbanTaskMachine(task, null);
                                    }}
                                  >
                                    Any machine
                                  </button>
                                  {kanbanMachineTargets.map((machine) => (
                                    <button
                                      type="button"
                                      role="menuitemradio"
                                      aria-checked={task.targetMachine?.key === machine.key}
                                      key={machine.key}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setKanbanCardMachineMenuOpen((current) => ({ ...current, [task.id]: false }));
                                        void updateKanbanTaskMachine(task, machine);
                                      }}
                                    >
                                      {machine.name}
                                    </button>
                                  ))}
                                </div>
                                ) : null}
                              </div>
                              <div className={kanbanClass("kanbanCardAttachmentPicker")} data-kanban-card-attachment-menu="true">
                                <div className={kanbanClass("kanbanCardAttachmentButton", taskAttachmentCount > 0 && "hasAttachments")}>
                                  <button
                                    type="button"
                                    className={kanbanClass("kanbanAttachmentListTrigger")}
                                    aria-label={`${taskAttachmentCount} attachment${taskAttachmentCount === 1 ? "" : "s"} on ${task.title}`}
                                    title={taskAttachmentCount > 0 ? `${taskAttachmentCount} attachment${taskAttachmentCount === 1 ? "" : "s"}` : "No attachments"}
                                    aria-expanded={Boolean(kanbanCardAttachmentListOpen[task.id])}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setKanbanCardAttachmentMenuOpen((current) => ({ ...current, [task.id]: false }));
                                      setKanbanCardAttachmentListOpen((current) => ({ ...current, [task.id]: !current[task.id] }));
                                    }}
                                  >
                                    <Paperclip aria-hidden="true" />
                                    {taskAttachmentCount}
                                  </button>
                                  <button
                                    type="button"
                                    className={kanbanClass("kanbanAttachmentAddTrigger")}
                                    aria-label={`Add attachments to ${task.title}`}
                                    aria-expanded={Boolean(kanbanCardAttachmentMenuOpen[task.id])}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setKanbanCardAttachmentListOpen((current) => ({ ...current, [task.id]: false }));
                                      setKanbanCardAttachmentMenuOpen((current) => ({ ...current, [task.id]: !current[task.id] }));
                                    }}
                                  >
                                    <Plus aria-hidden="true" />
                                  </button>
                                </div>
                                {kanbanCardAttachmentListOpen[task.id] ? (
                                  <AttachmentListMenuContent
                                    attachments={task.attachments ?? []}
                                    directories={task.linkedDirectories ?? []}
                                    onRemoveAttachment={(attachmentId) => void removeKanbanCardAttachment(task, attachmentId)}
                                    onRemoveDirectory={(directoryId) => void removeKanbanCardDirectory(task, directoryId)}
                                  />
                                ) : null}
                                {kanbanCardAttachmentMenuOpen[task.id] ? (
                                  <AttachmentMenuContent
                                    placement="below"
                                    stopPropagation
                                    onAttachImages={() => openKanbanCardFilePicker(task.id, "image")}
                                    onAttachFiles={() => openKanbanCardFilePicker(task.id, "file")}
                                    onAttachDirectory={() => void attachKanbanCardDirectory(task)}
                                    directoryPickerDisabled={!task.targetMachine}
                                    directoryPickerDisabledReason="Choose a specific machine before selecting a directory."
                                    recentDirectories={recentDirectories}
                                    recentDirectoriesExpanded={Boolean(kanbanCardRecentsExpanded[task.id])}
                                    setRecentDirectoriesExpanded={(value) => setKanbanCardRecentsExpanded((current) => ({
                                      ...current,
                                      [task.id]: typeof value === "function" ? value(Boolean(current[task.id])) : value,
                                    }))}
                                    onAttachRecentDirectory={(directory) => void attachKanbanCardRecentDirectory(task, directory)}
                                  />
                                ) : null}
                              </div>
                            </div>
                            {needsYouAsk ? (
                              <div className={convoClass("needsYouCallout")}>
                                <strong>Needs you</strong>
                                <span>{needsYouAsk}</span>
                              </div>
                            ) : null}
                            <div className={kanbanClass("kanbanMessageRow")} hidden={Boolean(needsYouAsk)}>
                              {terminalMessage ? (
                                <pre className={kanbanClass("kanbanCardTerminal")}><code>{message}</code></pre>
                              ) : (
                                <ChatMarkdown
                                  text={message}
                                  className={kanbanClass("kanbanCardMarkdown")}
                                  headingClassName={kanbanClass("kanbanCardMarkdownHeading")}
                                />
                              )}
                              {canExpandMessage ? (
                                <button
                                  type="button"
                                  className={kanbanClass("kanbanExpandMessage", messageExpanded && "expanded")}
                                  title={messageExpanded ? "Collapse message" : "Expand message"}
                                  aria-expanded={messageExpanded}
                                  aria-label={messageExpanded ? "Collapse full message" : "Expand full message"}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setExpandedKanbanCards((current) => ({ ...current, [task.id]: !current[task.id] }));
                                  }}
                                >
                                  <ChevronRight aria-hidden="true" />
                                </button>
                              ) : null}
                            </div>
                            <div className={kanbanClass("kanbanCardFooter")}>
                              <span>{task.assignee || "unassigned"}</span>
                              <time dateTime={new Date(task.updatedAt).toISOString()}>{formatRelativeTime(task.updatedAt)}</time>
                              {workingWithAgent ? (
                                <span className={kanbanClass("kanbanWorkingBee", "compact")} title={`${task.assignee} is working`}>
                                  <Image src={bee.icon || "/icons/worker-bee-general-v2.png"} alt="" width={18} height={18} aria-hidden="true" unoptimized />
                                </span>
                              ) : null}
                              {staleWorking ? <span className={kanbanClass("priorityPill", "stale")}>quiet {formatDurationShort(kanbanStaleAge(task))}</span> : null}
                              <span className={kanbanClass("kanbanCardActions")}>
                                {deliverables.length ? (
                                  <span className={kanbanClass("kanbanDeliverablePicker")} data-kanban-deliverable-menu="true">
                                    <button
                                      type="button"
                                      className={kanbanClass("kanbanDeliverableBadge")}
                                      aria-expanded={Boolean(kanbanCardDeliverableMenuOpen[task.id])}
                                      aria-label={`Open deliverables for ${task.title}`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        const nextOpen = !kanbanCardDeliverableMenuOpen[task.id];
                                        const menuStyle = nextOpen ? deliverableMenuStyle(event.currentTarget) : undefined;
                                        if (menuStyle) {
                                          setDeliverableMenuPosition((current) => ({ ...current, [task.id]: menuStyle }));
                                        }
                                        setKanbanCardDeliverableMenuOpen((current) => ({ ...current, [task.id]: !current[task.id] }));
                                      }}
                                    >
                                      <ExternalLink aria-hidden="true" />
                                      {deliverables.length}
                                    </button>
                                    {kanbanCardDeliverableMenuOpen[task.id] && portalTarget ? createPortal((
                                      <div
                                        className={kanbanClass("kanbanDeliverableMenu")}
                                        data-kanban-deliverable-menu="true"
                                        role="menu"
                                        style={deliverableMenuPosition[task.id]}
                                      >
                                        <p>Deliverables</p>
                                        {deliverables.map((deliverable) => (
                                          <div className={kanbanClass("kanbanDeliverableItem")} key={deliverable.id}>
                                            <span>
                                              <strong>{deliverable.label}</strong>
                                              <small>{deliverable.kind}{deliverable.exists === false ? " · missing" : ""}</small>
                                            </span>
                                            <button
                                              type="button"
                                              role="menuitem"
                                              disabled={deliverable.exists === false}
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                void openDeliverable(deliverable, "open").catch((error) => alert(error instanceof Error ? error.message : "Could not open deliverable."));
                                              }}
                                            >
                                              <Eye aria-hidden="true" />
                                              {deliverableActionLabel(deliverable)}
                                            </button>
                                            {deliverable.path ? (
                                              <button
                                                type="button"
                                                role="menuitem"
                                                disabled={deliverable.exists === false}
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  void openDeliverable(deliverable, "reveal").catch((error) => alert(error instanceof Error ? error.message : "Could not reveal deliverable."));
                                                }}
                                              >
                                                <FolderOpen aria-hidden="true" />
                                                {fileManagerLabel()}
                                              </button>
                                            ) : null}
                                          </div>
                                        ))}
                                      </div>
                                    ), portalTarget) : null}
                                  </span>
                                ) : null}
                                {task.status === "done" ? (
                                  task.reviewedAt ? (
                                    <span className={kanbanClass("kanbanReviewBadge", "reviewed")} title={`Reviewed ${formatRelativeTime(task.reviewedAt)}`}>
                                      <Check aria-hidden="true" />
                                      Reviewed
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      className={kanbanClass("kanbanReviewBadge")}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void markKanbanTaskReviewed(task);
                                      }}
                                      aria-label={`Review ${task.title}`}
                                      title="Mark reviewed"
                                    >
                                      Review
                                    </button>
                                  )
                                ) : null}
                                {task.status === "needs-human" ? (
                                  <span className={convoClass("cardQuickActions")}>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void moveKanbanTask(task.id, "ready");
                                      }}
                                      title="Send back to Waiting for Queen so a bee retries it"
                                    >
                                      Retry
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void moveKanbanTask(task.id, "done");
                                      }}
                                      title="Mark this task done"
                                    >
                                      Done
                                    </button>
                                  </span>
                                ) : null}
                                <span className={kanbanClass("kanbanCardMoveFabs")}>
                                  <button
                                    type="button"
                                    disabled={!previousColumn}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (previousColumn) void moveKanbanTask(task.id, previousColumn.id);
                                    }}
                                    aria-label="Move left"
                                    title={previousColumn ? `Move to ${previousColumn.title}` : "Already in first lane"}
                                  >
                                    ‹
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!nextColumn}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (nextColumn) void moveKanbanTask(task.id, nextColumn.id);
                                    }}
                                    aria-label="Move right"
                                    title={nextColumn ? `Move to ${nextColumn.title}` : "Already in last lane"}
                                  >
                                    ›
                                  </button>
                                </span>
                                <button
                                  type="button"
                                  className={kanbanClass("kanbanIconAction")}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openKanbanTaskModal(task, "chat");
                                  }}
                                  aria-label={`Open the conversation for ${task.title}`}
                                  title="Conversation"
                                >
                                  <MessageSquare aria-hidden="true" />
                                  {(kanbanTaskNoteCounts[task.id] ?? 0) + (task.result?.trim() ? 1 : 0) > 0 ? (
                                    <span className={convoClass("convoCountBadge")}>
                                      {(kanbanTaskNoteCounts[task.id] ?? 0) + (task.result?.trim() ? 1 : 0)}
                                    </span>
                                  ) : null}
                                </button>
                                <CellMenu items={kanbanTaskMenuItems(task)} ariaLabel={`Actions for ${task.title}`} />
                              </span>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                    {!kanbanShowingInitialLoading && !kanbanInitialLoading && column.tasks.length === 0 && quickAddStatus !== column.id ? (
                      <div className={kanbanClass("kanbanEmptyLane")}>
                        <p className={kanbanClass("kanbanEmptyLaneMessage")}>
                          {emptyLaneMessage(column)}
                        </p>
                        <button
                          type="button"
                          className={kanbanClass("kanbanEmpty", "kanbanEmptyAction")}
                          data-bee={`kanban-add-${column.id}`}
                          onClick={() => setQuickAddStatus(column.id)}
                        >
                          <Plus aria-hidden="true" />
                          Add a task
                        </button>
                      </div>
                    ) : null}
                  </div>
                </section>
              ))}
              </div>
              {kanbanBoardScrollState.canScrollRight ? (
              <button
                type="button"
                className={kanbanClass("kanbanBoardScrollFab", "right")}
                onClick={() => kanbanBoardScrollRef.current?.scrollBy({ left: 360, behavior: "smooth" })}
                aria-label="Scroll right"
                title="Scroll right"
              >
                <ChevronRight aria-hidden="true" />
              </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      ) : null}

      {activeView === "history" ? (
      <section className={kanbanClass("workBoardPanel", "tabPanel", "workHistoryPanel")}>
        <div className={kanbanClass("workBoardShell", "workHistoryShell")}>
          <WorkSectionHeader
            activeView={activeView}
            onSelect={selectWorkMode}
            title="History"
            subtitle="Dynamic changelog"
            stats={[
              { value: workHistory.entries.length, label: "shown", tone: "cyan" },
              { value: workHistory.projects.length, label: "projects", tone: "honey" },
              { value: workHistoryOpenCount, label: "open", tone: "danger" },
              { value: workHistory.totalEntries ?? workHistory.entries.length, label: "total" },
            ]}
          />

          <section className={kanbanClass("workBoardControls", "workHistoryControls")} aria-label="History filters">
            <label>
              <span>project</span>
              <select value={workHistoryProject} onChange={(event) => setWorkHistoryProject(event.target.value)}>
                <option value="">all projects</option>
                {workHistory.projects.map((project) => (
                  <option value={project.id} key={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
            <label className={kanbanClass("workBoardSearch")}>
              <span>search</span>
              <div>
                <Search aria-hidden="true" />
                <input value={workHistoryQuery} onChange={(event) => setWorkHistoryQuery(event.target.value)} placeholder="title, summary, status..." />
              </div>
            </label>
            <span
              className={kanbanClass("kanbanSyncPill", workHistoryShowingLoading ? "loading" : "synced")}
              title={workHistory.generatedAt ? `Refreshed ${new Date(workHistory.generatedAt).toLocaleString()}` : undefined}
            >
              <span className={kanbanClass("liveDot")} aria-hidden="true" />
              {workHistoryShowingLoading ? "scanning" : "changelog feed"}
            </span>
          </section>

          {workHistoryError ? <p className={kanbanClass("kanbanError")}>{workHistoryError}</p> : null}

          <section className={kanbanClass("workHistoryList")} aria-label="Project changelog history">
            {workHistoryShowingLoading && !workHistory.entries.length ? (
              <>
                <article className={kanbanClass("workHistoryLoadingNotice")} aria-live="polite">
                  <strong>Scanning project changelogs</strong>
                  <p>Looking across local projects and the shared brain vault.</p>
                </article>
                {Array.from({ length: 3 }).map((_, index) => (
                  <article className={kanbanClass("workHistoryItem", "loading")} key={`history-loading-${index}`} aria-hidden="true">
                    <span />
                    <strong />
                    <p />
                  </article>
                ))}
              </>
            ) : workHistory.entries.length ? (
              <>
              {workHistory.entries.map((entry) => (
                <article className={kanbanClass("workHistoryItem")} key={entry.id}>
                  <details className={kanbanClass("workHistoryDetails")}>
                    <summary className={kanbanClass("workHistorySummaryLine")}>
                      <span className={kanbanClass("workHistoryChevron")} aria-hidden="true">
                        <ChevronRight />
                      </span>
                      <span className={kanbanClass("workHistoryRowMain")}>
                        <span className={kanbanClass("workHistoryMeta")}>
                          {entry.timestamp ? <time dateTime={new Date(entry.sortTime).toISOString()}>{compactWorkHistoryTimestamp(entry.timestamp)}</time> : null}
                          <span>{entry.projectName}</span>
                          {entry.status ? <span>{entry.status}</span> : null}
                          <span>{entry.source}</span>
                        </span>
                        <strong>{entry.title}</strong>
                        {entry.areas ? <small className={kanbanClass("workHistoryAreas")}><ChatInlineMarkdown text={entry.areas} /></small> : null}
                      </span>
                      {entry.commitSummary || entry.verification ? (
                        <span className={kanbanClass("workHistoryRowState")}>
                          {entry.commitSummary ? <span data-kind="commit">commit</span> : null}
                          {entry.verification ? <span data-kind="verified">verified</span> : null}
                        </span>
                      ) : null}
                    </summary>
                    <div className={kanbanClass("workHistoryDetailsBody")}>
                      {entry.summary ? (
                        <ChatMarkdown
                          text={entry.summary}
                          className={kanbanClass("workHistoryMarkdown")}
                          headingClassName={kanbanClass("kanbanCardMarkdownHeading")}
                        />
                      ) : null}
                      {entry.commitSummary || entry.verification ? (
                        <div className={kanbanClass("workHistoryDetailFacts")}>
                          {entry.commitSummary ? (
                            <span>
                              <b>Commit</b>
                              <span><ChatInlineMarkdown text={entry.commitSummary} /></span>
                            </span>
                          ) : null}
                          {entry.verification ? (
                            <span>
                              <b>Verification</b>
                              <span><ChatInlineMarkdown text={entry.verification} /></span>
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </details>
                </article>
              ))}
              {workHistory.hasMore ? (
                <button
                  type="button"
                  className={kanbanClass("workHistoryLoadMore")}
                  disabled={workHistoryLoadingMore}
                  onClick={() => void loadWorkHistory({ append: true })}
                >
                  {workHistoryLoadingMore ? "Loading more..." : `Load 10 more (${workHistory.entries.length}/${workHistory.totalEntries ?? workHistory.entries.length})`}
                </button>
              ) : null}
              </>
            ) : (
              <div className={kanbanClass("workHistoryEmpty")}>
                <strong>No changelog entries found</strong>
                <p>No matching project updates are available yet.</p>
              </div>
            )}
          </section>
        </div>
      </section>
      ) : null}

      <KanbanTaskModal
        {...{
          ChatMarkdown,
          Check,
          ChevronDown,
          ComposerField,
          KANBAN_COLUMNS,
          KANBAN_STEER_TARGETS,
          MessageAttachments,
          attachKanbanSteerDirectory,
          attachKanbanSteerRecentDirectory,
          editAndInterruptKanbanTask,
          formatMessageTimestamp,
          formatRelativeTime,
          handleKanbanSteerFileChange,
          handleKanbanSteerImageChange,
          kanbanAssigneeOptions,
          kanbanClass,
          kanbanEditDraft,
          kanbanEditPendingTaskId,
          kanbanEventLabel,
          kanbanSteerAttachmentError,
          kanbanSteerAttachmentMenuOpen,
          kanbanSteerAttachmentMenuRef,
          kanbanSteerAttachments,
          kanbanSteerDirectories,
          kanbanSteerDraft,
          kanbanSteerFileInputRef,
          kanbanSteerImageInputRef,
          kanbanSteerTargetMenuOpen,
          kanbanSteerTargetMenuRef,
          kanbanSteerTargetStatus,
          kanbanSteeringTaskId,
          kanbanTaskModal,
          moveKanbanTask,
          patchKanbanTask,
          recentDirectories,
          recentDirectoriesExpanded,
          recording,
          removeKanbanSteerAttachment,
          removeKanbanSteerDirectory,
          selectedKanbanAgent,
          selectedKanbanAgentMessages,
          selectedKanbanComments,
          selectedKanbanEvents,
          selectedKanbanTask,
          setKanbanEditDraft,
          setKanbanSteerAttachmentMenuOpen,
          setKanbanSteerDraft,
          setKanbanSteerTargetMenuOpen,
          setKanbanSteerTargetStatus,
          setKanbanTaskModal,
          setRecentDirectoriesExpanded,
          startAudioRecording,
          steerSelectedKanbanTask,
          stopAudioRecording,
          voiceBands,
          voiceTarget,
          voiceTranscript,
        }}
      />

  </>);
}

// Memoized to match the other dashboard view panels (e.g. AgentsPanel) so the
// 1366-line board stops re-rendering on unrelated background root churn while open.
export const KanbanPanel = memo(KanbanPanelBase);
