import type { ChangeEvent } from "react";
import { createFileReferenceAttachments, hydrateImageReferencePreviews } from "@/features/chat/chat-file-references";
import { readLocalImagePreview } from "@/lib/native/local-image";
import type { ChatAttachment, LinkedDirectory, MachineGroup } from "@/features/dashboard/dashboard-types";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { KanbanMachineTarget, KanbanStatus, KanbanTask } from "@/lib/types/kanban";
import type { RecentDirectory } from "@/lib/types/recent-directories";

type StateUpdater<T> = (updater: (current: T) => T) => void;

type RecentDirectoryContext = {
  machineName?: string;
  machineKey?: string;
  source?: RecentDirectory["source"];
};

export type ComposerAttachmentDeps = {
  readComposerFiles: (files: FileList | File[], kind: "image" | "file") => Promise<ChatAttachment[]>;
  chooseDirectoryForMachine: (machine: KanbanMachineTarget | null, onChoose: (directory: LinkedDirectory) => void) => void | Promise<void>;
  recordRecentDirectory: (directory: LinkedDirectory, context?: RecentDirectoryContext) => unknown;
  collectorKey: (url?: string) => string;
  selectedAgent: AgentProfile | null;
  machineGroups: MachineGroup[];
  localKanbanMachineTarget: KanbanMachineTarget | null;
  quickAddMachineTarget: (status: KanbanStatus) => KanbanMachineTarget | null;
  quickAddMachineTargets: Record<string, KanbanMachineTarget | null>;
  selectedKanbanAgent: AgentProfile | null;
  selectedKanbanTask: KanbanTask | null;
  setChatAttachments: StateUpdater<ChatAttachment[]>;
  setChatDirectories: StateUpdater<LinkedDirectory[]>;
  setAttachmentError: (value: string) => void;
  setAttachmentMenuOpen: (value: boolean) => void;
  setRecentDirectoriesExpanded: (value: boolean) => void;
  setQuickAddAttachments: StateUpdater<Record<string, ChatAttachment[]>>;
  setQuickAddDirectories: StateUpdater<Record<string, LinkedDirectory[]>>;
  setQuickAddAttachmentError: (value: string) => void;
  setQuickAddAttachmentMenuOpen: (value: boolean) => void;
  setKanbanSteerAttachments: StateUpdater<ChatAttachment[]>;
  setKanbanSteerDirectories: StateUpdater<LinkedDirectory[]>;
  setKanbanSteerAttachmentError: (value: string) => void;
  setKanbanSteerAttachmentMenuOpen: (value: boolean) => void;
};

/**
 * Composer attachment + linked-directory handlers for the three chat/kanban
 * composers (chat, kanban quick-add, kanban steer). Pure handlers: no hook-local
 * state and no React hooks, so they live outside the controller hook.
 */
export function createComposerAttachmentHandlers(deps: ComposerAttachmentDeps) {
  const {
    readComposerFiles,
    chooseDirectoryForMachine,
    recordRecentDirectory,
    collectorKey,
    selectedAgent,
    machineGroups,
    localKanbanMachineTarget,
    quickAddMachineTarget,
    quickAddMachineTargets,
    selectedKanbanAgent,
    selectedKanbanTask,
    setChatAttachments,
    setChatDirectories,
    setAttachmentError,
    setAttachmentMenuOpen,
    setRecentDirectoriesExpanded,
    setQuickAddAttachments,
    setQuickAddDirectories,
    setQuickAddAttachmentError,
    setQuickAddAttachmentMenuOpen,
    setKanbanSteerAttachments,
    setKanbanSteerDirectories,
    setKanbanSteerAttachmentError,
    setKanbanSteerAttachmentMenuOpen,
  } = deps;

  async function addChatFiles(files: FileList | File[], kind: "image" | "file") {
    try {
      const next = await readComposerFiles(files, kind);
      setChatAttachments((current) => [...current, ...next]);
      setAttachmentError("");
      setAttachmentMenuOpen(false);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Could not attach that file.");
    }
  }

  function addChatFileReferences(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (!incoming.length) {
      setAttachmentError("Drop at least one file.");
      return;
    }
    const created = createFileReferenceAttachments(incoming);
    setChatAttachments((current) => [...current, ...created]);
    setAttachmentError("");
    setAttachmentMenuOpen(false);
    // Progressively swap image references to thumbnails once their preview
    // renders — from the dropped bytes (browser) or, on the desktop where a
    // native drop is path-only, by reading the file via the native command.
    void hydrateImageReferencePreviews(incoming, created, (id, previewUrl) => {
      setChatAttachments((current) => current.map((attachment) => (
        attachment.id === id ? { ...attachment, previewUrl } : attachment
      )));
    }, readLocalImagePreview);
  }

  function handleChatFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addChatFiles(event.target.files, "file");
    event.target.value = "";
  }

  function handleChatFileReferenceDrop(files: FileList | File[]) {
    addChatFileReferences(files);
  }

  function handleChatImageChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addChatFiles(event.target.files, "image");
    event.target.value = "";
  }

  function removeChatAttachment(id: string) {
    setChatAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function attachChatDirectory() {
    try {
      const machine = selectedAgent
        ? machineGroups.find((group) => group.agents.some((agent) => agent.id === selectedAgent.id))
        : null;
      const target = machine ? { key: machine.key, name: machine.name, collectorUrl: machine.collectorUrl } : localKanbanMachineTarget;
      await chooseDirectoryForMachine(target, (directory) => {
        setChatDirectories((current) => [...current, directory]);
        setAttachmentError("");
        setAttachmentMenuOpen(false);
        void recordRecentDirectory(directory, {
          machineName: target?.name ?? selectedAgent?.machineName,
          machineKey: target?.key ?? (selectedAgent ? collectorKey(selectedAgent.telemetryUrl) || selectedAgent.id : undefined),
          source: "chat",
        });
      });
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Could not link that directory.");
    }
  }

  function attachChatRecentDirectory(directory: LinkedDirectory) {
    setChatDirectories((current) => [...current, directory]);
    setAttachmentError("");
    setAttachmentMenuOpen(false);
    setRecentDirectoriesExpanded(false);
    void recordRecentDirectory(directory, {
      machineName: selectedAgent?.machineName ?? directory.machineName,
      machineKey: selectedAgent ? collectorKey(selectedAgent.telemetryUrl) || selectedAgent.id : directory.machineKey,
      source: "recent",
    });
  }

  function removeChatDirectory(id: string) {
    setChatDirectories((current) => current.filter((directory) => directory.id !== id));
  }

  async function addQuickAddFiles(status: KanbanStatus, files: FileList | File[], kind: "image" | "file") {
    try {
      const next = await readComposerFiles(files, kind);
      setQuickAddAttachments((current) => ({
        ...current,
        [status]: [...(current[status] ?? []), ...next],
      }));
      setQuickAddAttachmentError("");
      setQuickAddAttachmentMenuOpen(false);
    } catch (error) {
      setQuickAddAttachmentError(error instanceof Error ? error.message : "Could not attach that file.");
    }
  }

  function handleQuickAddFileChange(status: KanbanStatus, event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addQuickAddFiles(status, event.target.files, "file");
    event.target.value = "";
  }

  function handleQuickAddImageChange(status: KanbanStatus, event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addQuickAddFiles(status, event.target.files, "image");
    event.target.value = "";
  }

  function removeQuickAddAttachment(status: KanbanStatus, id: string) {
    setQuickAddAttachments((current) => ({ ...current, [status]: (current[status] ?? []).filter((attachment) => attachment.id !== id) }));
  }

  async function attachQuickAddDirectory(status: KanbanStatus) {
    try {
      const targetMachine = quickAddMachineTarget(status);
      await chooseDirectoryForMachine(targetMachine, (directory) => {
        setQuickAddDirectories((current) => ({
          ...current,
          [status]: [...(current[status] ?? []), directory],
        }));
        setQuickAddAttachmentError("");
        setQuickAddAttachmentMenuOpen(false);
        void recordRecentDirectory(directory, {
          machineName: targetMachine?.name,
          machineKey: targetMachine?.key,
          source: "kanban",
        });
      });
    } catch (error) {
      setQuickAddAttachmentError(error instanceof Error ? error.message : "Could not link that directory.");
    }
  }

  function attachQuickAddRecentDirectory(status: KanbanStatus, directory: LinkedDirectory) {
    setQuickAddDirectories((current) => ({
      ...current,
      [status]: [...(current[status] ?? []), directory],
    }));
    setQuickAddAttachmentError("");
    setQuickAddAttachmentMenuOpen(false);
    setRecentDirectoriesExpanded(false);
    const targetMachine = quickAddMachineTargets[status] ?? null;
    void recordRecentDirectory(directory, {
      machineName: targetMachine?.name ?? directory.machineName,
      machineKey: targetMachine?.key ?? directory.machineKey,
      source: "recent",
    });
  }

  function removeQuickAddDirectory(status: KanbanStatus, id: string) {
    setQuickAddDirectories((current) => ({ ...current, [status]: (current[status] ?? []).filter((directory) => directory.id !== id) }));
  }

  async function addKanbanSteerFiles(files: FileList | File[], kind: "image" | "file") {
    try {
      const next = await readComposerFiles(files, kind);
      setKanbanSteerAttachments((current) => [...current, ...next]);
      setKanbanSteerAttachmentError("");
      setKanbanSteerAttachmentMenuOpen(false);
    } catch (error) {
      setKanbanSteerAttachmentError(error instanceof Error ? error.message : "Could not attach that file.");
    }
  }

  function handleKanbanSteerFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addKanbanSteerFiles(event.target.files, "file");
    event.target.value = "";
  }

  function handleKanbanSteerImageChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addKanbanSteerFiles(event.target.files, "image");
    event.target.value = "";
  }

  function removeKanbanSteerAttachment(id: string) {
    setKanbanSteerAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function attachKanbanSteerDirectory() {
    try {
      const agentMachine = selectedKanbanAgent
        ? machineGroups.find((group) => group.agents.some((agent) => agent.id === selectedKanbanAgent.id))
        : null;
      const target = selectedKanbanTask?.targetMachine
        ?? (agentMachine ? { key: agentMachine.key, name: agentMachine.name, collectorUrl: agentMachine.collectorUrl } : localKanbanMachineTarget);
      await chooseDirectoryForMachine(target, (directory) => {
        setKanbanSteerDirectories((current) => [...current, directory]);
        setKanbanSteerAttachmentError("");
        setKanbanSteerAttachmentMenuOpen(false);
        void recordRecentDirectory(directory, {
          machineName: target?.name ?? selectedKanbanAgent?.machineName,
          machineKey: target?.key ?? (selectedKanbanAgent ? collectorKey(selectedKanbanAgent.telemetryUrl) || selectedKanbanAgent.id : undefined),
          source: "kanban",
        });
      });
    } catch (error) {
      setKanbanSteerAttachmentError(error instanceof Error ? error.message : "Could not link that directory.");
    }
  }

  function attachKanbanSteerRecentDirectory(directory: LinkedDirectory) {
    setKanbanSteerDirectories((current) => [...current, directory]);
    setKanbanSteerAttachmentError("");
    setKanbanSteerAttachmentMenuOpen(false);
    setRecentDirectoriesExpanded(false);
    void recordRecentDirectory(directory, {
      machineName: selectedKanbanTask?.targetMachine?.name ?? selectedKanbanAgent?.machineName ?? directory.machineName,
      machineKey: selectedKanbanTask?.targetMachine?.key ?? (selectedKanbanAgent ? collectorKey(selectedKanbanAgent.telemetryUrl) || selectedKanbanAgent.id : directory.machineKey),
      source: "recent",
    });
  }

  function removeKanbanSteerDirectory(id: string) {
    setKanbanSteerDirectories((current) => current.filter((directory) => directory.id !== id));
  }

  return {
    addChatFiles,
    handleChatFileChange,
    handleChatFileReferenceDrop,
    handleChatImageChange,
    removeChatAttachment,
    attachChatDirectory,
    attachChatRecentDirectory,
    removeChatDirectory,
    addQuickAddFiles,
    handleQuickAddFileChange,
    handleQuickAddImageChange,
    removeQuickAddAttachment,
    attachQuickAddDirectory,
    attachQuickAddRecentDirectory,
    removeQuickAddDirectory,
    addKanbanSteerFiles,
    handleKanbanSteerFileChange,
    handleKanbanSteerImageChange,
    removeKanbanSteerAttachment,
    attachKanbanSteerDirectory,
    attachKanbanSteerRecentDirectory,
    removeKanbanSteerDirectory,
  };
}
