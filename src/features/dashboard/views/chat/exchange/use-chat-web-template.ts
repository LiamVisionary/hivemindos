"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { initializeWebTemplateProject } from "@/lib/services/app-builder/web-template-client";
import type { WebTemplateId } from "@/lib/services/app-builder/web-template-catalog";
import { chatAppArtifactFromProject } from "@/lib/services/chat/chat-app-artifact";

const TEMPLATE_READY_MESSAGE = "your web template is ready! what would you like me to change?";
const PREVIEW_ATTENTION_MS = 10_000;

export function useChatWebTemplate(options: {
  storageKey: string;
  baseDirectory: string;
  machine: {
    key?: string;
    name?: string;
    collectorUrl?: string;
    dnsName?: string;
    ip?: string;
    appDir?: string;
    updateCommand?: string;
  };
  setMessagesByAgent?: (update: (current: Record<string, any[]>) => Record<string, any[]>) => void;
  setThreadAppProject: (project: Record<string, any>) => void;
}) {
  const { storageKey, baseDirectory, machine, setMessagesByAgent, setThreadAppProject } = options;
  const [attentionState, setAttentionState] = useState<{ storageKey: string } | null>(null);
  const attentionTimerRef = useRef<number | null>(null);

  const clearAttentionTimer = useCallback(() => {
    if (attentionTimerRef.current !== null) window.clearTimeout(attentionTimerRef.current);
    attentionTimerRef.current = null;
  }, []);

  useEffect(() => () => clearAttentionTimer(), [clearAttentionTimer]);

  const startPreviewAttention = useCallback((targetStorageKey: string) => {
    clearAttentionTimer();
    setAttentionState({ storageKey: targetStorageKey });
    attentionTimerRef.current = window.setTimeout(() => {
      setAttentionState((current) => current?.storageKey === targetStorageKey ? null : current);
      attentionTimerRef.current = null;
    }, PREVIEW_ATTENTION_MS);
  }, [clearAttentionTimer]);

  const acknowledgePreviewAttention = useCallback(() => {
    clearAttentionTimer();
    setAttentionState(null);
  }, [clearAttentionTimer]);

  const attachWebTemplate = useCallback(async (templateId: WebTemplateId) => {
    if (!setMessagesByAgent) throw new Error("This chat cannot attach a template yet.");
    const targetStorageKey = storageKey;
    const initialized = await initializeWebTemplateProject({
      templateId,
      chatStorageKey: targetStorageKey,
      baseDirectory,
      machine,
    });
    const artifact = chatAppArtifactFromProject(initialized.project, {
      key: machine.key,
      name: machine.name,
    });
    setThreadAppProject(initialized.project);
    setMessagesByAgent((current) => {
      const thread = current[targetStorageKey] ?? [];
      const existingIndex = thread.findIndex((message) => (
        message?.role === "assistant"
        && message?.content === TEMPLATE_READY_MESSAGE
        && message?.appArtifact?.projectId === artifact.projectId
      ));
      if (existingIndex >= 0) {
        const next = [...thread];
        next[existingIndex] = { ...next[existingIndex], appArtifact: artifact };
        return { ...current, [targetStorageKey]: next };
      }
      return {
        ...current,
        [targetStorageKey]: [
          ...thread,
          {
            role: "assistant",
            content: TEMPLATE_READY_MESSAGE,
            surface: "chat",
            createdAt: Date.now(),
            appArtifact: artifact,
          },
        ],
      };
    });
    startPreviewAttention(targetStorageKey);
  }, [baseDirectory, machine, setMessagesByAgent, setThreadAppProject, startPreviewAttention, storageKey]);

  return {
    attachWebTemplate,
    acknowledgePreviewAttention,
    previewAttention: attentionState?.storageKey === storageKey,
  };
}
