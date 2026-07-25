"use client";

/* Thread-app preview lifecycle for the chat route: adopt/status → install →
 * start against /api/app-builder (with collector self-recovery), plus stop and
 * per-step phase reporting for the App workspace pane. Extracted from
 * ChatExchangePanel so the panel stays under the size ratchet.
 *
 * Honesty rules: every step talks to the real App Builder — no fabricated
 * project state, and a failed step surfaces its real error instead of a
 * generic message.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { APP_BUILDER_CONFIRMATIONS } from "@/lib/services/app-builder/contract";
import { requestAppBuilderWithCollectorRecovery } from "@/lib/services/app-builder/collector-recovery";
import { chatAppArtifactFromProject, type ChatAppArtifact } from "@/lib/services/chat/chat-app-artifact";

export type ThreadAppPreviewPhase = "" | "checking" | "installing" | "starting" | "stopping";

export type ThreadAppMachineGroup = {
  dnsName?: string;
  name?: string;
  ip?: string;
  address?: string;
  version?: { appDir?: string; updateCommand?: string };
} | null;

function appBuilderProject(payload: unknown): Record<string, any> | null {
  const data = payload as Record<string, any> | null;
  return data?.project ?? data?.data?.project ?? null;
}

export function useThreadAppPreview(options: {
  storageKey: string;
  busy: boolean;
  threadAppArtifact?: ChatAppArtifact;
  legacyAppDirectory: string;
  chatWorkingDirectory: string;
  machineLabel: string;
  selectedMachineKey?: string;
  collectorUrl: string;
  machineGroup?: ThreadAppMachineGroup;
  refreshFleetHostedApps?: (signal: AbortSignal) => unknown;
  onToast: (message: string) => void;
  updateThreadAppArtifact: (artifact: ChatAppArtifact) => void;
}) {
  const {
    storageKey, busy, threadAppArtifact, legacyAppDirectory, chatWorkingDirectory,
    machineLabel, selectedMachineKey, collectorUrl, machineGroup,
    refreshFleetHostedApps, onToast, updateThreadAppArtifact,
  } = options;

  const [projectState, setProjectState] = useState<{ storageKey: string; project: Record<string, any> } | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [phaseState, setPhaseState] = useState<{ storageKey: string; phase: ThreadAppPreviewPhase }>({ storageKey: "", phase: "" });
  const [errorState, setErrorState] = useState<{ storageKey: string; message: string } | null>(null);
  const [waitingKey, setWaitingKey] = useState("");
  const pendingRequestRef = useRef("");

  const threadAppProject = projectState?.storageKey === storageKey ? projectState?.project ?? null : null;
  const previewBusy = busyKey === storageKey;
  const previewPhase = phaseState.storageKey === storageKey ? phaseState.phase : "";
  const previewError = errorState?.storageKey === storageKey ? errorState?.message ?? "" : "";
  const previewWaiting = waitingKey === storageKey;

  const setThreadAppProject = useCallback((project: Record<string, any>) => {
    setProjectState({ storageKey, project });
  }, [storageKey]);

  const requestAppBuilder = useCallback((body: Record<string, unknown>) => requestAppBuilderWithCollectorRecovery({
    appBuilderBody: body,
    machine: {
      collectorUrl: collectorUrl || undefined,
      dnsName: machineGroup?.dnsName,
      name: machineGroup?.name || machineLabel,
      ip: machineGroup?.ip || machineGroup?.address,
      appDir: machineGroup?.version?.appDir,
      updateCommand: machineGroup?.version?.updateCommand,
    },
    onRecoveryStatus: (status) => {
      if (status === "updating") onToast("Updating Preview on the linked machine…");
      if (status === "retrying") onToast("Preview updated — starting the app…");
    },
  }), [collectorUrl, machineGroup, machineLabel, onToast]);

  const ensureThreadAppPreview = useCallback(async () => {
    const previewStorageKey = storageKey;
    let artifact = threadAppArtifact;
    if (!artifact && !legacyAppDirectory) {
      if (refreshFleetHostedApps) {
        const controller = new AbortController();
        await Promise.resolve(refreshFleetHostedApps(controller.signal)).catch(() => undefined);
      }
      return;
    }
    setBusyKey(previewStorageKey);
    setPhaseState({ storageKey: previewStorageKey, phase: "checking" });
    setErrorState({ storageKey: previewStorageKey, message: "" });
    try {
      let project: Record<string, any> | null;
      if (!artifact) {
        const data = await requestAppBuilder({
          action: "adopt",
          backend: "local",
          directory: legacyAppDirectory,
          workspaceDirectory: chatWorkingDirectory,
          name: legacyAppDirectory.split(/[\\/]/).filter(Boolean).at(-1) || "Chat app",
          machineKey: selectedMachineKey,
          collectorUrl: collectorUrl || undefined,
          confirmation: APP_BUILDER_CONFIRMATIONS.createProject,
        });
        project = appBuilderProject(data);
        if (!project) throw new Error("App Builder did not return the adopted project.");
        artifact = chatAppArtifactFromProject(project, { key: selectedMachineKey, name: machineLabel });
        updateThreadAppArtifact(artifact);
      } else {
        const status = await requestAppBuilder({
          action: "status",
          backend: "local",
          directory: artifact.directory,
          projectId: artifact.projectId,
          machineKey: artifact.machineKey || selectedMachineKey,
          collectorUrl: collectorUrl || undefined,
        });
        project = appBuilderProject(status);
      }
      if (!project) throw new Error("App Builder could not resolve this conversation's project.");
      if (!project.dependenciesReady) {
        setPhaseState({ storageKey: previewStorageKey, phase: "installing" });
        const installed = await requestAppBuilder({
          action: "install",
          backend: "local",
          directory: project.directory,
          projectId: project.id,
          machineKey: artifact.machineKey || selectedMachineKey,
          collectorUrl: collectorUrl || undefined,
          confirmation: APP_BUILDER_CONFIRMATIONS.installDependencies,
        });
        project = appBuilderProject(installed) || project;
      }
      if (project.status !== "running" || !project.previewUrl) {
        setPhaseState({ storageKey: previewStorageKey, phase: "starting" });
        const started = await requestAppBuilder({
          action: "start",
          backend: "local",
          directory: project.directory,
          projectId: project.id,
          machineKey: artifact.machineKey || selectedMachineKey,
          collectorUrl: collectorUrl || undefined,
          confirmation: APP_BUILDER_CONFIRMATIONS.startRuntime,
        });
        project = appBuilderProject(started) || project;
      }
      setProjectState({ storageKey: previewStorageKey, project });
      updateThreadAppArtifact(chatAppArtifactFromProject(project, {
        key: artifact.machineKey || selectedMachineKey,
        name: artifact.machineName || machineLabel,
      }, artifact));
      if (refreshFleetHostedApps) {
        const controller = new AbortController();
        await Promise.resolve(refreshFleetHostedApps(controller.signal)).catch(() => undefined);
      }
    } catch (error) {
      setErrorState({
        storageKey: previewStorageKey,
        message: error instanceof Error ? error.message : "Could not start the app preview.",
      });
    } finally {
      setBusyKey((current) => current === previewStorageKey ? "" : current);
      setPhaseState((current) => current.storageKey === previewStorageKey ? { storageKey: "", phase: "" } : current);
      setWaitingKey((current) => current === previewStorageKey ? "" : current);
    }
  }, [chatWorkingDirectory, collectorUrl, legacyAppDirectory, machineLabel, refreshFleetHostedApps, requestAppBuilder, selectedMachineKey, storageKey, threadAppArtifact, updateThreadAppArtifact]);

  const stopThreadApp = useCallback(async () => {
    const artifact = threadAppArtifact;
    if (!artifact) return;
    const previewStorageKey = storageKey;
    setBusyKey(previewStorageKey);
    setPhaseState({ storageKey: previewStorageKey, phase: "stopping" });
    setErrorState({ storageKey: previewStorageKey, message: "" });
    try {
      const stopped = await requestAppBuilder({
        action: "stop",
        backend: "local",
        directory: artifact.directory,
        projectId: artifact.projectId,
        machineKey: artifact.machineKey || selectedMachineKey,
        collectorUrl: collectorUrl || undefined,
        confirmation: APP_BUILDER_CONFIRMATIONS.stopRuntime,
      });
      const project = appBuilderProject(stopped);
      if (project) {
        setProjectState({ storageKey: previewStorageKey, project });
        updateThreadAppArtifact(chatAppArtifactFromProject(project, {
          key: artifact.machineKey || selectedMachineKey,
          name: artifact.machineName || machineLabel,
        }, artifact));
      }
      onToast(`${artifact.name} stopped`);
    } catch (error) {
      setErrorState({
        storageKey: previewStorageKey,
        message: error instanceof Error ? error.message : "Could not stop the app.",
      });
    } finally {
      setBusyKey((current) => current === previewStorageKey ? "" : current);
      setPhaseState((current) => current.storageKey === previewStorageKey ? { storageKey: "", phase: "" } : current);
    }
  }, [collectorUrl, machineLabel, onToast, requestAppBuilder, selectedMachineKey, storageKey, threadAppArtifact, updateThreadAppArtifact]);

  // Preview requests made while the agent is mid-turn wait for the turn to end
  // (the runtime owns the project directory during a turn), then fire once.
  const requestThreadAppPreview = useCallback(() => {
    if (busy) {
      pendingRequestRef.current = storageKey;
      setWaitingKey(storageKey);
      return;
    }
    pendingRequestRef.current = "";
    setWaitingKey("");
    void ensureThreadAppPreview();
  }, [busy, ensureThreadAppPreview, storageKey]);

  useEffect(() => {
    if (busy || pendingRequestRef.current !== storageKey) return;
    pendingRequestRef.current = "";
    void ensureThreadAppPreview();
  }, [busy, ensureThreadAppPreview, storageKey]);

  return {
    threadAppProject,
    previewBusy,
    previewPhase,
    previewError,
    previewWaiting,
    setThreadAppProject,
    ensureThreadAppPreview,
    requestThreadAppPreview,
    stopThreadApp,
  };
}
