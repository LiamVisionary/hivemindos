// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

/* eslint-disable react-hooks/immutability, react-hooks/purity */

import { useCallback, useEffect, useMemo } from "react";
import { openNativeDirectory } from "@/lib/native/filesystem";
import { runtimeSchedulerFeature } from "@/lib/types/agent-runtime";
import { parseRuntimeSsePayload, responseErrorMessage, runtimeErrorMessage } from "./runtime-stream-errors";

export function useSchedulerController(props: any) {
  const { RUNTIME_LABELS, SCHEDULER_DYNAMIC_SKILL_ACTIONS_ENABLED, SCHEDULER_HERMES_SKILL_CONTEXT_ENABLED, SCHEDULER_MODEL_OPTIONS, SCHEDULER_RUN_STALE_MS, agents, appVersion, appendMessage, chatSetupIssue, createDefaultAgentWallet, displayAgents, displayMachineName, editingScheduleId, formatRelativeTime, honeyLedgerEnabled, logClientTelemetry, refreshHoneyLedger, scheduleDraft, schedules, selectedAgent, setEditingScheduleId, setMessagesByAgent, setScheduleDraft, setScheduleImportStatus, setScheduleImporting, setSchedulerAttachMenu, setSchedulerDraftOpen, setSchedulerPathDraft, setSchedulerPathKind, setSchedulerRunStates, setSchedulerSelectedStep, setSchedulerSkillSearch, setSchedules, sharedVault, updateTask, upsertTask, walletsByAgent } = props;
  function toggleScheduleSkill(slug: string) {
    setScheduleDraft((current) => ({
      ...current,
      skills: current.skills.includes(slug)
        ? current.skills.filter((item) => item !== slug)
        : [...current.skills, slug],
    }));
  }

  function toggleSchedulerStepMode(mode: "prompt" | "steps") {
    setSchedulerAttachMenu(null);
    setScheduleDraft((current) => {
      if (current.mode === mode) return current;
      if (mode === "steps") {
        const stepLines = current.prompt.split("\n").map((line) => line.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
        return {
          ...current,
          mode,
          steps: stepLines.length
            ? stepLines.map((text, index) => ({
              id: `draft-step-${Date.now()}-${index}`,
              text,
              skills: [],
              paths: [],
              model: "",
            }))
            : current.steps.length ? current.steps : [{ id: `draft-step-${Date.now()}-0`, text: "", skills: [], paths: [], model: "" }],
        };
      }
      const prompt = current.steps
        .filter((step) => step.text.trim())
        .map((step, index) => `${index + 1}. ${step.text.trim()}`)
        .join("\n");
      return { ...current, mode, prompt: prompt || current.prompt };
    });
    setSchedulerSelectedStep(0);
  }

  function updateSchedulerStep(index: number, patch: Partial<SchedulerStep>) {
    setScheduleDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step),
    }));
  }

  function addSchedulerStep() {
    setScheduleDraft((current) => {
      const nextIndex = current.steps.length;
      setSchedulerSelectedStep(nextIndex);
      setSchedulerAttachMenu(null);
      return {
        ...current,
        steps: [...current.steps, { id: `draft-step-${Date.now()}-${nextIndex}`, text: "", skills: [], paths: [], model: "" }],
      };
    });
  }

  function removeSchedulerStep(index: number) {
    setScheduleDraft((current) => {
      const steps = current.steps.length <= 1
        ? [{ id: `draft-step-${Date.now()}-0`, text: "", skills: [], paths: [], model: "" }]
        : current.steps.filter((_, stepIndex) => stepIndex !== index);
      setSchedulerSelectedStep((selected) => Math.max(0, Math.min(steps.length - 1, selected > index ? selected - 1 : selected)));
      setSchedulerAttachMenu(null);
      return { ...current, steps };
    });
  }

  function addSchedulerStepPath(index: number, path: string) {
    const cleaned = path.trim().replace(/\/+$/, "");
    if (!cleaned) return;
    setScheduleDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => (
        stepIndex === index && !step.paths.includes(cleaned)
          ? { ...step, paths: [...step.paths, cleaned] }
          : step
      )),
    }));
  }

  function removeSchedulerStepPath(index: number, path: string) {
    setScheduleDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => (
        stepIndex === index ? { ...step, paths: step.paths.filter((item) => item !== path) } : step
      )),
    }));
  }

  function toggleSchedulerStepSkill(index: number, slug: string) {
    setScheduleDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => (
        stepIndex === index
          ? {
            ...step,
            skills: step.skills.includes(slug)
              ? step.skills.filter((item) => item !== slug)
              : [...step.skills, slug],
          }
          : step
      )),
    }));
  }

  function updateSchedulerStepModel(index: number, model: string) {
    updateSchedulerStep(index, { model });
  }

  function isSchedulerFilePath(path: string) {
    return /\.[a-zA-Z0-9]+$/.test(path.split("/").pop() ?? "");
  }

  async function pickSchedulerFolder(stepIndex?: number) {
    type PickerWindow = Window & typeof globalThis & {
      showDirectoryPicker?: () => Promise<{ name?: string }>;
    };
    const picker = (window as PickerWindow).showDirectoryPicker;
    if (!picker) {
      setSchedulerPathKind("folder");
      setSchedulerPathDraft("");
      setSchedulerAttachMenu("path");
      return;
    }
    try {
      const handle = await picker();
      const name = handle.name?.trim();
      if (!name) return;
      if (typeof stepIndex === "number") addSchedulerStepPath(stepIndex, name);
      else addSchedulePath(name);
      setSchedulerAttachMenu(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSchedulerPathKind("folder");
      setSchedulerPathDraft("");
      setSchedulerAttachMenu("path");
    }
  }

  async function pickSchedulerFiles(stepIndex?: number) {
    type FileHandle = { name?: string; getFile?: () => Promise<File> };
    type PickerWindow = Window & typeof globalThis & {
      showOpenFilePicker?: (options?: { multiple?: boolean }) => Promise<FileHandle[]>;
    };
    const picker = (window as PickerWindow).showOpenFilePicker;
    if (!picker) {
      setSchedulerPathKind("file");
      setSchedulerPathDraft("");
      setSchedulerAttachMenu("path");
      return;
    }
    try {
      const handles = await picker({ multiple: true });
      const names = await Promise.all(handles.map(async (handle) => {
        if (handle.name?.trim()) return handle.name.trim();
        const file = await handle.getFile?.();
        return file?.name?.trim() ?? "";
      }));
      for (const name of names.filter(Boolean)) {
        if (typeof stepIndex === "number") addSchedulerStepPath(stepIndex, name);
        else addSchedulePath(name);
      }
      setSchedulerAttachMenu(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSchedulerPathKind("file");
      setSchedulerPathDraft("");
      setSchedulerAttachMenu("path");
    }
  }

  function addSchedulePath(path: string) {
    const cleaned = path.trim();
    if (!cleaned) return;
    setScheduleDraft((current) => ({
      ...current,
      paths: current.paths.includes(cleaned) ? current.paths : [...current.paths, cleaned],
    }));
  }

  function removeSchedulePath(path: string) {
    setScheduleDraft((current) => ({
      ...current,
      paths: current.paths.filter((item) => item !== path),
    }));
  }

  function removeScheduleSkill(slug: string) {
    setScheduleDraft((current) => ({
      ...current,
      skills: current.skills.filter((item) => item !== slug),
    }));
  }

  function aeonCronFromEvery(every: string) {
    const cleaned = every.trim();
    if (cleaned === "manual") return "manual";
    if (/^[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+$/.test(cleaned)) return cleaned;
    const ms = scheduleIntervalMs(cleaned);
    if (ms === 15 * 60_000) return "*/15 * * * *";
    if (ms === 60 * 60_000) return "0 * * * *";
    if (ms === 24 * 60 * 60_000) return "0 9 * * *";
    if (ms && ms < 60 * 60_000 && ms % 60_000 === 0) return `*/${Math.max(1, Math.round(ms / 60_000))} * * * *`;
    if (ms && ms % (60 * 60_000) === 0 && ms < 24 * 60 * 60_000) return `0 */${Math.max(1, Math.round(ms / (60 * 60_000)))} * * *`;
    return cleaned || "manual";
  }

  async function configureAeonSchedule(agent: AgentProfile, schedule: AgentSchedule) {
    const skill = schedule.skills[0] || schedule.steps.flatMap((step) => step.skills)[0];
    if (!skill) {
      const error = "AEON automations need one attached skill. Add a skill, then save again.";
      setScheduleImportStatus(error);
      return { error };
    }
    const brief = schedulerPlainPrompt(schedule) || `Run ${skill}.`;
    const cron = aeonCronFromEvery(schedule.every);
    const configCalls = [
      { action: "schedule", value: cron },
      { action: "var", value: brief },
      { action: "model", value: schedule.model ?? "" },
      { action: schedule.enabled ? "enable" : "disable", value: schedule.enabled },
    ];
    for (const payload of configCalls) {
      const response = await fetch("/api/runtimes/aeon/skills/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, skill, ...payload }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response?.ok || data?.ok === false) {
        const error = data?.error ?? `Could not configure ${skill} in AEON.`;
        setScheduleImportStatus(error);
        return { error };
      }
    }
    return { skill, cron };
  }

  function resetScheduleDraft(agentId = scheduleDraft.agentId) {
    setScheduleDraft({
      name: "",
      agentId,
      every: "360m",
      mode: "prompt",
      prompt: "",
      model: "",
      skills: [],
      paths: [],
      steps: [{ id: `draft-step-${Date.now()}-0`, text: "", skills: [], paths: [], model: "" }],
      usePastRuns: false,
      pastRunLimit: 3,
    });
    setSchedulerSelectedStep(0);
    setSchedulerAttachMenu(null);
    setSchedulerPathDraft("");
    setSchedulerSkillSearch("");
    setEditingScheduleId("");
  }

  function editSchedule(schedule: AgentSchedule) {
    const steps = schedule.steps.length
      ? schedule.steps.map((step, index) => ({
        ...step,
        id: `draft-${schedule.id}-${index}`,
        skills: Array.isArray(step.skills) ? step.skills : [],
        paths: Array.isArray(step.paths) ? step.paths : [],
        model: step.model ?? "",
      }))
      : [{ id: `draft-${schedule.id}-0`, text: "", skills: [], paths: [], model: "" }];
    setScheduleDraft({
      name: schedule.name,
      agentId: schedule.agentId,
      every: schedule.every,
      mode: schedule.mode,
      prompt: schedule.prompt,
      model: schedule.model ?? "",
      skills: schedule.skills,
      paths: schedule.paths,
      steps,
      usePastRuns: schedule.usePastRuns === true,
      pastRunLimit: Math.max(1, Math.min(12, Number(schedule.pastRunLimit) || 3)),
    });
    setSchedulerSelectedStep(0);
    setSchedulerAttachMenu(null);
    setSchedulerPathDraft("");
    setSchedulerSkillSearch("");
    setEditingScheduleId(schedule.id);
    setSchedulerDraftOpen(true);
  }

  async function createSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const agent = displayAgents.find((item) => item.id === scheduleDraft.agentId) ?? selectedAgent;
    if (!agent) return;
    const now = Date.now();
    const schedulerFeature = runtimeSchedulerFeature(agent.runtime);
    const externalRuntime = schedulerFeature.kind === "external-runtime" ? schedulerFeature.externalSource : undefined;
    const steps = scheduleDraft.mode === "steps"
      ? scheduleDraft.steps.filter((step) => step.text.trim())
      : [];
    const prompt = scheduleDraft.mode === "steps"
      ? steps.map((step, index) => `${index + 1}. ${step.text.trim()}`).join("\n")
      : scheduleDraft.prompt.trim();
    const editedSchedule = editingScheduleId ? schedules.find((schedule) => schedule.id === editingScheduleId) : null;
    const next: AgentSchedule = {
      id: editedSchedule?.id ?? `schedule-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name: scheduleDraft.name.trim() || `Run ${agent.name}`,
      agentId: agent.id,
      enabled: editedSchedule?.enabled ?? true,
      every: scheduleDraft.every.trim() || "360m",
      mode: scheduleDraft.mode,
      prompt,
      model: scheduleDraft.model,
      skills: scheduleDraft.skills,
      paths: scheduleDraft.paths,
      steps: steps.map((step, index) => ({
        ...step,
        id: `step-${now}-${index}`,
        text: step.text.trim(),
      })),
      createdAt: editedSchedule?.createdAt ?? now,
      updatedAt: now,
      lastRunAt: editedSchedule?.lastRunAt,
      nextRunAt: editedSchedule?.nextRunAt,
      externalSource: externalRuntime ?? editedSchedule?.externalSource,
      externalJobId: externalRuntime ? (scheduleDraft.skills[0] || editedSchedule?.externalJobId) : editedSchedule?.externalJobId,
      lastStatus: editedSchedule?.lastStatus,
      lastSummary: editedSchedule?.lastSummary,
      usePastRuns: scheduleDraft.usePastRuns,
      pastRunLimit: Math.max(1, Math.min(12, Number(scheduleDraft.pastRunLimit) || 3)),
      sharedSchedulePath: editedSchedule?.sharedSchedulePath,
      sharedRunFolder: editedSchedule?.sharedRunFolder,
    };
    if (externalRuntime === "aeon") {
      const configured = await configureAeonSchedule(agent, next);
      if (!configured) return;
      next.externalSource = "aeon";
      next.externalJobId = configured.skill;
      next.every = configured.cron;
      next.lastSummary = `Configured AEON automation for ${configured.skill}.`;
    }
    setSchedules((current) => editedSchedule
      ? current.map((schedule) => schedule.id === editedSchedule.id ? next : schedule)
      : [next, ...current]);
    void upsertSharedSchedule(next);
    resetScheduleDraft(agent.id);
    setSchedulerDraftOpen(false);
  }

  function removeSchedule(id: string) {
    setSchedules((current) => current.filter((schedule) => schedule.id !== id));
  }

  async function importExistingSchedules() {
    setScheduleImporting(true);
    setScheduleImportStatus("");
    const response = await fetch("/api/scheduler/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agents: displayAgents }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; schedules?: ImportedRuntimeSchedule[]; errors?: string[] } | null;
    setScheduleImporting(false);
    if (!response?.ok || !data?.ok) {
      setScheduleImportStatus("No runtime schedules could be imported yet.");
      return;
    }
    const jobs = data.schedules ?? [];
    if (!jobs.length) {
      setScheduleImportStatus(data.errors?.[0] ?? "No existing runtime schedules found across connected agents.");
      return;
    }
    const now = Number(new Date());
    setSchedules((current) => {
      const byExternalId = new Map(current.map((schedule) => [schedule.externalJobId ? `${schedule.externalSource}:${schedule.externalJobId}` : schedule.id, schedule]));
      for (const job of jobs) {
        const key = `${job.runtime}:${job.id}`;
        const existing = byExternalId.get(key);
        const runtimeAgent = displayAgents.find((agent) => (
          agent.runtime === job.runtime && (agent.id === job.agentId || agent.agentId === job.agentId)
        )) ?? displayAgents.find((agent) => agent.runtime === job.runtime) ?? agents.find((agent) => agent.runtime === job.runtime);
        const imported: AgentSchedule = {
          id: existing?.id ?? key,
          name: job.name || "Runtime automation",
          agentId: runtimeAgent?.id ?? existing?.agentId ?? "",
          enabled: job.enabled !== false,
          every: normalizeImportedScheduleEvery(job),
          mode: "prompt",
          prompt: job.message || job.lastSummary || "Imported runtime schedule.",
          model: existing?.model ?? "",
          skills: existing?.skills ?? [],
          paths: existing?.paths ?? [],
          steps: existing?.steps ?? [],
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          lastRunAt: job.lastRunMs ?? existing?.lastRunAt,
          nextRunAt: job.nextRunMs ?? existing?.nextRunAt,
          externalSource: job.runtime,
          externalJobId: job.id,
          lastStatus: job.lastStatus,
          lastSummary: job.lastSummary,
          usePastRuns: existing?.usePastRuns ?? false,
          pastRunLimit: existing?.pastRunLimit ?? 3,
          sharedSchedulePath: existing?.sharedSchedulePath,
          sharedRunFolder: existing?.sharedRunFolder,
        };
        byExternalId.set(key, imported);
      }
      const importedSchedules = [...byExternalId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      void upsertSharedSchedules(importedSchedules);
      return importedSchedules;
    });
    setScheduleImportStatus(`Imported ${jobs.length} runtime schedule${jobs.length === 1 ? "" : "s"}.`);
  }

  function normalizeImportedScheduleEvery(job: ImportedRuntimeSchedule) {
    if (job.every) return job.every;
    if (job.everyMs) {
      if (job.everyMs % 3_600_000 === 0) return `${job.everyMs / 3_600_000}h`;
      if (job.everyMs % 60_000 === 0) return `${job.everyMs / 60_000}m`;
      return `${Math.max(1, Math.round(job.everyMs / 1000))}s`;
    }
    return job.schedule?.replace(/^every\s+/i, "") || "custom";
  }

  async function toggleSchedule(id: string) {
    const schedule = schedules.find((item) => item.id === id);
    if (!schedule) return;
    const nextEnabled = !schedule.enabled;
    if (schedule.externalSource && schedule.externalJobId) {
      const response = await fetch("/api/scheduler/runtime-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtime: schedule.externalSource,
          action: nextEnabled ? "enable" : "disable",
          jobId: schedule.externalJobId,
          agent: displayAgents.find((item) => item.id === schedule.agentId),
        }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response?.ok || !data?.ok) {
        setScheduleImportStatus(data?.error ?? "Could not update that runtime schedule.");
        return;
      }
    }
    setSchedules((current) => current.map((item) => (
      item.id === id ? { ...item, enabled: nextEnabled, updatedAt: Number(new Date()) } : item
    )));
    void upsertSharedSchedule({ ...schedule, enabled: nextEnabled, updatedAt: Number(new Date()) });
  }

  function schedulerPlainPrompt(schedule: AgentSchedule) {
    if (schedule.mode !== "steps") return schedule.prompt || schedule.name;
    return [
      schedule.prompt,
      ...schedule.steps.map((step, index) => `${index + 1}. ${step.text}`),
    ].filter(Boolean).join("\n");
  }

  function schedulerSharedSnapshot(schedule: AgentSchedule) {
    const agent = displayAgents.find((item) => item.id === schedule.agentId);
    return {
      id: schedule.id,
      name: schedule.name,
      agentId: schedule.agentId,
      agentName: agent?.name ?? "",
      machineName: agent?.machineName ?? "dashboard",
      runtime: schedule.externalSource ?? agent?.runtime ?? "dashboard",
      enabled: schedule.enabled,
      every: schedule.every,
      mode: schedule.mode,
      prompt: schedulerPlainPrompt(schedule),
      model: schedule.model ?? "",
      skills: schedule.skills,
      paths: schedule.paths,
      steps: schedule.steps,
      externalSource: schedule.externalSource ?? null,
      externalJobId: schedule.externalJobId ?? null,
      updatedAt: schedule.updatedAt,
      nextRunAt: schedule.nextRunAt ?? null,
      usePastRuns: schedule.usePastRuns === true,
      pastRunLimit: Math.max(1, Math.min(12, Number(schedule.pastRunLimit) || 3)),
    };
  }

  async function upsertSharedSchedule(schedule: AgentSchedule) {
    const response = await fetch("/api/scheduler/shared", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert-schedule",
        vaultPath: sharedVault.vaultPath,
        scheduledFolder: sharedVault.scheduledFolder,
        schedule: schedulerSharedSnapshot(schedule),
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; result?: { path?: string; folder?: string }; error?: string } | null;
    if (response?.ok && data?.ok && data.result) {
      setSchedules((current) => current.map((item) => (
        item.id === schedule.id
          ? { ...item, sharedSchedulePath: data.result?.path, sharedRunFolder: data.result?.folder }
          : item
      )));
    } else if (data?.error) {
      setScheduleImportStatus(data.error);
    }
  }

  async function upsertSharedSchedules(nextSchedules: AgentSchedule[]) {
    const response = await fetch("/api/scheduler/shared", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert-schedules",
        vaultPath: sharedVault.vaultPath,
        scheduledFolder: sharedVault.scheduledFolder,
        schedules: nextSchedules.map(schedulerSharedSnapshot),
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; results?: Array<{ path?: string; folder?: string }>; error?: string } | null;
    if (response?.ok && data?.ok && data.results) {
      setSchedules((current) => current.map((item) => {
        const index = nextSchedules.findIndex((schedule) => schedule.id === item.id);
        const result = index >= 0 ? data.results?.[index] : null;
        return result ? { ...item, sharedSchedulePath: result.path, sharedRunFolder: result.folder } : item;
      }));
    } else if (data?.error) {
      setScheduleImportStatus(data.error);
    }
  }

  async function fetchPastRunContext(schedule: AgentSchedule) {
    if (!schedule.usePastRuns) return "";
    const response = await fetch("/api/scheduler/shared", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "past-runs",
        vaultPath: sharedVault.vaultPath,
        scheduledFolder: sharedVault.scheduledFolder,
        schedule: schedulerSharedSnapshot(schedule),
        limit: Math.max(1, Math.min(12, Number(schedule.pastRunLimit) || 3)),
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; runs?: Array<{ path: string; name: string; content: string }> } | null;
    const runs = data?.runs ?? [];
    if (!response?.ok || !data?.ok || !runs.length) return "";
    return [
      "Past scheduled runs context:",
      "Use these previous run notes to preserve continuity, avoid repetition, and make useful comparisons.",
      ...runs.map((run, index) => [
        `Previous run ${index + 1}: ${run.path}`,
        run.content.slice(0, 6000),
      ].join("\n")),
    ].join("\n\n");
  }

  function scheduleFromSharedSnapshot(snapshot: Record<string, unknown>): AgentSchedule | null {
    const id = typeof snapshot.id === "string" ? snapshot.id : "";
    const name = typeof snapshot.name === "string" ? snapshot.name : "";
    if (!id || !name) return null;
    const runtime = typeof snapshot.runtime === "string" && snapshot.runtime in RUNTIME_LABELS
      ? snapshot.runtime as AgentRuntime
      : undefined;
    const agentName = typeof snapshot.agentName === "string" ? snapshot.agentName : "";
    const sourceAgentId = typeof snapshot.agentId === "string" ? snapshot.agentId : "";
    const sourceMachineName = typeof snapshot.machineName === "string" ? snapshot.machineName : "";
    const externalJobId = typeof snapshot.externalJobId === "string" ? snapshot.externalJobId : "";
    const idHints = [id, externalJobId].filter(Boolean).join(" ");
    const sameMachine = (item: AgentProfile) => sourceMachineName && item.machineName === sourceMachineName;
    const agent = displayAgents.find((item) => item.id === sourceAgentId)
      ?? displayAgents.find((item) => idHints.includes(item.id))
      ?? displayAgents.find((item) => agentName && sameMachine(item) && item.name === agentName)
      ?? displayAgents.find((item) => runtime && sameMachine(item) && item.runtime === runtime)
      ?? displayAgents.find((item) => agentName && item.name === agentName)
      ?? displayAgents.find((item) => runtime && item.runtime === runtime);
    const rawSteps = Array.isArray(snapshot.steps) ? snapshot.steps : [];
    const steps = rawSteps.map((step, index) => {
      const value = typeof step === "object" && step ? step as Record<string, unknown> : {};
      return {
        id: typeof value.id === "string" ? value.id : `step-${id}-${index}`,
        text: typeof value.text === "string" ? value.text : "",
        skills: Array.isArray(value.skills) ? value.skills.filter((item): item is string => typeof item === "string") : [],
        paths: Array.isArray(value.paths) ? value.paths.filter((item): item is string => typeof item === "string") : [],
        model: typeof value.model === "string" ? value.model : "",
      };
    }).filter((step) => step.text.trim());
    const externalSource = typeof snapshot.externalSource === "string" && snapshot.externalSource in RUNTIME_LABELS
      ? snapshot.externalSource as AgentRuntime
      : undefined;
    return {
      id,
      name,
      agentId: agent?.id ?? sourceAgentId,
      enabled: snapshot.enabled !== false,
      every: typeof snapshot.every === "string" ? snapshot.every : "custom",
      mode: snapshot.mode === "steps" ? "steps" : "prompt",
      prompt: typeof snapshot.prompt === "string" ? snapshot.prompt : "",
      model: typeof snapshot.model === "string" ? snapshot.model : "",
      skills: Array.isArray(snapshot.skills) ? snapshot.skills.filter((item): item is string => typeof item === "string") : [],
      paths: Array.isArray(snapshot.paths) ? snapshot.paths.filter((item): item is string => typeof item === "string") : [],
      steps,
      createdAt: typeof snapshot.updatedAt === "number" ? snapshot.updatedAt : Date.now(),
      updatedAt: typeof snapshot.updatedAt === "number" ? snapshot.updatedAt : Date.now(),
      nextRunAt: typeof snapshot.nextRunAt === "number" ? snapshot.nextRunAt : undefined,
      externalSource,
      externalJobId: externalJobId || undefined,
      usePastRuns: snapshot.usePastRuns === true,
      pastRunLimit: Math.max(1, Math.min(12, Number(snapshot.pastRunLimit) || 3)),
      sharedSchedulePath: typeof snapshot.sharedSchedulePath === "string" ? snapshot.sharedSchedulePath : undefined,
      sharedRunFolder: typeof snapshot.sharedRunFolder === "string" ? snapshot.sharedRunFolder : undefined,
    };
  }

  function mergeSharedSchedules(current: AgentSchedule[], sharedSchedules: AgentSchedule[]) {
    const byId = new Map(current.map((schedule) => [schedule.id, schedule]));
    for (const sharedSchedule of sharedSchedules) {
      const existing = byId.get(sharedSchedule.id);
      if (!existing || (sharedSchedule.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
        byId.set(sharedSchedule.id, {
          ...existing,
          ...sharedSchedule,
          lastRunAt: existing?.lastRunAt,
          lastStatus: existing?.lastStatus,
          lastSummary: existing?.lastSummary,
        });
      } else if (sharedSchedule.sharedRunFolder || sharedSchedule.sharedSchedulePath) {
        byId.set(existing.id, {
          ...existing,
          sharedRunFolder: existing.sharedRunFolder ?? sharedSchedule.sharedRunFolder,
          sharedSchedulePath: existing.sharedSchedulePath ?? sharedSchedule.sharedSchedulePath,
        });
      }
    }
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function refreshSharedSchedulesFromVault() {
    if (!sharedVault.enabled) return;
    const response = await fetch("/api/scheduler/shared", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "list-schedules",
        vaultPath: sharedVault.vaultPath,
        scheduledFolder: sharedVault.scheduledFolder,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; schedules?: Array<Record<string, unknown>>; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      if (data?.error) setScheduleImportStatus(data.error);
      return;
    }
    const sharedSchedules = (data.schedules ?? [])
      .map((snapshot) => scheduleFromSharedSnapshot(snapshot))
      .filter((schedule): schedule is AgentSchedule => Boolean(schedule));
    if (!sharedSchedules.length) return;
    setSchedules((current) => mergeSharedSchedules(current, sharedSchedules));
  }

  async function recordSharedScheduledRun(schedule: AgentSchedule, record: {
    runId: string;
    status: "running" | "ok" | "failed";
    startedAt: number;
    completedAt?: number;
    prompt?: string;
    output?: string;
    summary?: string;
    telemetry?: Record<string, unknown>;
  }) {
    const agent = displayAgents.find((item) => item.id === schedule.agentId);
    const response = await fetch("/api/scheduler/shared", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-run",
        vaultPath: sharedVault.vaultPath,
        scheduledFolder: sharedVault.scheduledFolder,
        record: {
          schedule: schedulerSharedSnapshot(schedule),
          runId: record.runId,
          agentName: agent?.name ?? "",
          machineName: agent?.machineName ?? "dashboard",
          status: record.status,
          startedAt: record.startedAt,
          completedAt: record.completedAt,
          prompt: record.prompt,
          output: record.output,
          summary: record.summary,
          telemetry: record.telemetry,
        },
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; result?: { path?: string; folder?: string }; error?: string } | null;
    if (response?.ok && data?.ok && data.result) {
      setSchedules((current) => current.map((item) => (
        item.id === schedule.id
          ? {
            ...item,
            sharedRunFolder: data.result?.folder,
            sharedSchedulePath: item.sharedSchedulePath ?? (data.result?.folder ? `${data.result.folder}/schedule.md` : item.sharedSchedulePath),
          }
          : item
      )));
      return data.result;
    }
    return null;
  }

  async function runScheduleNow(schedule: AgentSchedule) {
    const now = Number(new Date());
    const runStartedAt = Date.now();
    const runId = `scheduler:${schedule.id}:${now}`;
    const logSchedulerRun = (type: string, payload: Record<string, unknown> = {}) => {
      logClientTelemetry(type, {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        externalSource: schedule.externalSource ?? null,
        externalJobId: schedule.externalJobId ?? null,
        elapsedMs: Date.now() - runStartedAt,
        ...payload,
      }, { runId });
    };
    logSchedulerRun("scheduler.run.requested", {
      mode: schedule.mode,
      enabled: schedule.enabled,
      every: schedule.every,
      promptLength: schedule.prompt.length,
      stepCount: schedule.steps.length,
      skillCount: schedule.skills.length,
      pathCount: schedule.paths.length,
      assignedAgentId: schedule.agentId,
    });
    const setRunPhase = (phase: SchedulerRunPhase, label?: string) => {
      setSchedulerRunStates((current) => ({ ...current, [schedule.id]: label ? { phase, label } : { phase } }));
      logSchedulerRun("scheduler.run.phase", { phase, label: label ?? null });
    };
    setRunPhase("running", "running");
    const finishRunState = (state: "done" | "idle") => {
      logSchedulerRun("scheduler.run.button_state", { state });
      if (state === "idle") {
        setSchedulerRunStates((current) => {
          const next = { ...current };
          delete next[schedule.id];
          return next;
        });
        return;
      }
      setRunPhase("done", "done");
      window.setTimeout(() => {
        setSchedulerRunStates((current) => {
          const next = { ...current };
          delete next[schedule.id];
          return next;
        });
      }, 3000);
    };
    if (schedule.externalSource && schedule.externalJobId) {
      logSchedulerRun("scheduler.run.external_request.start", { runtime: schedule.externalSource });
      const response = await fetch("/api/scheduler/runtime-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtime: schedule.externalSource,
          action: "run-now",
          jobId: schedule.externalJobId,
          agent: displayAgents.find((item) => item.id === schedule.agentId),
        }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      logSchedulerRun("scheduler.run.external_request.end", {
        ok: Boolean(response?.ok && data?.ok),
        httpStatus: response?.status ?? null,
        error: data?.error ?? null,
      });
      if (!response?.ok || !data?.ok) {
        setScheduleImportStatus(data?.error ?? "Could not run that runtime schedule.");
        finishRunState("idle");
        return;
      }
      setSchedules((current) => current.map((item) => (
        item.id === schedule.id ? { ...item, lastRunAt: now, updatedAt: now, lastStatus: "ok", lastSummary: `Started ${schedule.name}.` } : item
      )));
      setScheduleImportStatus(`Started ${schedule.name}.`);
      void recordSharedScheduledRun(schedule, {
        runId,
        status: "ok",
        startedAt: now,
        completedAt: Date.now(),
        prompt: schedulerPlainPrompt(schedule),
        summary: `Started external runtime schedule ${schedule.name}.`,
        telemetry: { externalSource: schedule.externalSource, externalJobId: schedule.externalJobId },
      });
      finishRunState("done");
      return;
    }

    const attachedSkillSlugs = [...new Set([
      ...schedule.skills,
      ...schedule.steps.flatMap((step) => step.skills),
    ].map((skill) => skill.trim()).filter(Boolean))];
    if (attachedSkillSlugs.length && !SCHEDULER_DYNAMIC_SKILL_ACTIONS_ENABLED) {
      logSchedulerRun("scheduler.run.skill_action.disabled", {
        reason: "hermes-latency-test",
        skillCount: attachedSkillSlugs.length,
        skills: attachedSkillSlugs,
      });
    }
    if (attachedSkillSlugs.length && SCHEDULER_DYNAMIC_SKILL_ACTIONS_ENABLED) {
      setRunPhase("assigned", "checking attached skills");
      logSchedulerRun("scheduler.run.skill_action.start", {
        skillCount: attachedSkillSlugs.length,
        skills: attachedSkillSlugs,
      });
      const response = await fetch("/api/scheduler/skill-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hivemind-Run-Id": runId,
          "X-Hivemind-Run-Type": "scheduler",
        },
        body: JSON.stringify({
          skillSlugs: attachedSkillSlugs,
          scheduleName: schedule.name,
          prompt: schedulerPlainPrompt(schedule),
          vaultPath: sharedVault.enabled ? sharedVault.vaultPath : undefined,
        }),
      }).catch(() => null);
      const data = await response?.json().catch(() => ({})) as {
        ok?: boolean;
        skipped?: boolean;
        skill?: string;
        actionId?: string;
        title?: string;
        output?: string;
        elapsedMs?: number;
        error?: string;
      };
      logSchedulerRun("scheduler.run.skill_action.end", {
        ok: Boolean(response?.ok && data.ok),
        skipped: Boolean(data.skipped),
        httpStatus: response?.status ?? null,
        skill: data.skill ?? null,
        actionId: data.actionId ?? null,
        routeElapsedMs: data.elapsedMs ?? null,
        title: data.title ?? null,
        error: data.error ?? null,
      });
      if (response?.ok && data.ok) {
        const result = data.output?.trim() || `Completed ${data.skill ?? "attached skill"} action.`;
        setRunPhase("wrapping", "wrapping up");
        setSchedules((current) => current.map((item) => (
          item.id === schedule.id
            ? { ...item, lastRunAt: Date.now(), updatedAt: Date.now(), lastStatus: "ok", lastSummary: result.slice(0, 500) }
            : item
        )));
        setScheduleImportStatus(`Completed ${schedule.name}${data.title ? `: ${data.title}` : ""}.`);
        logSchedulerRun("scheduler.run.completed", {
          dynamicSkillAction: true,
          skill: data.skill ?? null,
          actionId: data.actionId ?? null,
          outputLength: result.length,
          routeElapsedMs: data.elapsedMs ?? null,
        });
        void recordSharedScheduledRun(schedule, {
          runId,
          status: "ok",
          startedAt: now,
          completedAt: Date.now(),
          prompt: schedulerPlainPrompt(schedule),
          output: result,
          summary: data.title ? `Completed ${data.skill ?? "skill"}: ${data.title}` : result,
          telemetry: { dynamicSkillAction: true, skill: data.skill ?? null, actionId: data.actionId ?? null, routeElapsedMs: data.elapsedMs ?? null },
        });
        finishRunState("done");
        return;
      }
      if (response && !data.skipped) {
        const message = data.error || `Skill action failed with ${response.status}.`;
        logSchedulerRun("scheduler.run.failed", {
          dynamicSkillAction: true,
          message,
        });
        setSchedules((current) => current.map((item) => (
          item.id === schedule.id ? { ...item, updatedAt: Date.now(), lastStatus: "failed", lastSummary: message } : item
        )));
        setScheduleImportStatus(`Could not run ${schedule.name}: ${message}`);
        void recordSharedScheduledRun(schedule, {
          runId,
          status: "failed",
          startedAt: now,
          completedAt: Date.now(),
          prompt: schedulerPlainPrompt(schedule),
          summary: message,
          telemetry: { dynamicSkillAction: true },
        });
        finishRunState("idle");
        return;
      }
    }

    const agent = displayAgents.find((item) => item.id === schedule.agentId);
    if (!agent) {
      logSchedulerRun("scheduler.run.validation_failed", { reason: "missing-agent" });
      setScheduleImportStatus("Could not run that schedule because its assigned agent is missing.");
      finishRunState("idle");
      return;
    }
    const setupIssue = chatSetupIssue(agent);
    if (setupIssue) {
      logSchedulerRun("scheduler.run.validation_failed", {
        reason: "setup-issue",
        agentId: agent.id,
        agentRuntime: agent.runtime,
        hasGatewayUrl: Boolean(agent.gatewayUrl?.trim()),
        hasTelemetryUrl: Boolean(agent.telemetryUrl?.trim()),
        message: setupIssue,
      });
      setScheduleImportStatus(`Could not run ${schedule.name}: ${setupIssue}`);
      setSchedules((current) => current.map((item) => (
        item.id === schedule.id ? { ...item, updatedAt: Date.now(), lastStatus: "failed", lastSummary: setupIssue } : item
      )));
      finishRunState("idle");
      return;
    }
    const attachments = [
      schedule.model ? `Model: ${SCHEDULER_MODEL_OPTIONS.find((option) => option.value === schedule.model)?.label ?? schedule.model}` : "",
      schedule.skills.length ? `Attached skills: ${schedule.skills.join(", ")}` : "",
      schedule.paths.length ? `Linked paths: ${schedule.paths.join(", ")}` : "",
    ].filter(Boolean).join("\n");
    const prompt = schedule.mode === "steps" && schedule.steps.length
      ? [
        attachments,
        schedule.prompt,
        "",
        "Run this step by step:",
        ...schedule.steps.map((step, index) => {
          const stepContext = [
            step.model ? `model: ${SCHEDULER_MODEL_OPTIONS.find((option) => option.value === step.model)?.label ?? step.model}` : "",
            step.skills.length ? `skills: ${step.skills.join(", ")}` : "",
            step.paths.length ? `paths: ${step.paths.join(", ")}` : "",
          ].filter(Boolean).join("; ");
          return `${index + 1}. ${step.text}${stepContext ? ` [${stepContext}]` : ""}`;
        }),
      ].filter(Boolean).join("\n")
      : [attachments, schedule.prompt].filter(Boolean).join("\n\n");
    const scheduledPrompt = [
      "This is a scheduled dashboard run. Execute the task now; do not only acknowledge it.",
      "If the task asks you to create or update Apple Notes, use the available Apple Notes skill/tool and report the concrete note title when finished.",
      await fetchPastRunContext(schedule),
      prompt || schedule.name,
    ].filter(Boolean).join("\n\n");
    const linkedWorkingDirectory = schedule.paths.find((path) => path.trim());
    const minimizeHermesSkillContext = agent.runtime === "hermes"
      && attachedSkillSlugs.length > 0
      && !SCHEDULER_HERMES_SKILL_CONTEXT_ENABLED;
    const workingDirectory = minimizeHermesSkillContext && !linkedWorkingDirectory
      ? ""
      : linkedWorkingDirectory ?? appVersion?.appDir ?? agent.localDataDir ?? "";
    const runtimeSharedVault = minimizeHermesSkillContext
      ? { ...sharedVault, enabled: false }
      : sharedVault;
    if (minimizeHermesSkillContext) {
      logSchedulerRun("scheduler.run.hermes_skill_context.minimized", {
        skillCount: attachedSkillSlugs.length,
        skills: attachedSkillSlugs,
        preservedLinkedPath: Boolean(linkedWorkingDirectory),
        sharedVaultEnabled: runtimeSharedVault.enabled,
        workingDirectorySet: Boolean(workingDirectory),
      });
    }
    logSchedulerRun("scheduler.run.dispatch_prepared", {
      agentId: agent.id,
      agentName: agent.name,
      agentRuntime: agent.runtime,
      agentRuntimeKind: agent.runtimeKind ?? null,
      hasGatewayUrl: Boolean(agent.gatewayUrl?.trim()),
      hasTelemetryUrl: Boolean(agent.telemetryUrl?.trim()),
      hasToken: Boolean(agent.token?.trim()),
      promptLength: scheduledPrompt.length,
      workingDirectorySet: Boolean(workingDirectory),
      sharedVaultEnabled: runtimeSharedVault.enabled,
      hermesSkillContextMinimized: minimizeHermesSkillContext,
      honeyLedgerEnabled,
      staleMs: SCHEDULER_RUN_STALE_MS,
    });
    const task: AgentTask = {
      id: `schedule-task-${now}`,
      agentId: agent.id,
      title: schedule.name,
      lastMessage: "Starting scheduled run...",
      status: "active",
      startedAt: now,
      updatedAt: now,
      source: "scheduler",
      workingDirectory,
    };
    upsertTask(task);
    appendMessage(agent.id, { role: "user", content: scheduledPrompt, surface: "scheduler" });
    appendMessage(agent.id, { role: "assistant", content: "", surface: "scheduler" });
    setRunPhase("assigned", `assigned to ${agent.name}`);
    setScheduleImportStatus(`Running ${schedule.name} on ${agent.name}...`);

    let waitingTicks = 0;
    let staleLogged = false;
    const waitingInterval = window.setInterval(() => {
      waitingTicks += 1;
      const waitMs = waitingTicks * 10_000;
      logSchedulerRun("scheduler.run.waiting", {
        tick: waitingTicks,
        waitMs,
      });
      if (!staleLogged && waitMs >= SCHEDULER_RUN_STALE_MS) {
        staleLogged = true;
        logSchedulerRun("scheduler.run.slow", { waitMs });
        setRunPhase("executing", "still executing");
      }
    }, 10_000);

    try {
      logSchedulerRun("scheduler.run.runtime_request.start", {
        endpoint: "/api/chat/agent-runtime",
        agentId: agent.id,
        agentRuntime: agent.runtime,
      });
      setRunPhase("thinking", "thinking");
      const response = await fetch("/api/chat/agent-runtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hivemind-Run-Id": runId,
          "X-Hivemind-Run-Type": "scheduler",
        },
        body: JSON.stringify({
          agent,
          sharedVault: runtimeSharedVault,
          workingDirectory,
          wallet: walletsByAgent[agent.id] ?? createDefaultAgentWallet(agent.id),
          honeyLedgerEnabled,
          messages: [{ role: "user", content: scheduledPrompt }],
        }),
      });
      logSchedulerRun("scheduler.run.runtime_request.response", {
        httpStatus: response.status,
        ok: response.ok,
        hasBody: Boolean(response.body),
        contentType: response.headers.get("content-type"),
      });
      if (!response.ok || !response.body) {
        throw new Error(await responseErrorMessage(response, `Request failed with ${response.status}`));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let sawTerminalEvent = false;
      let sawFirstByte = false;
      let contentChunkCount = 0;
      let statusEventCount = 0;
      let toolEventCount = 0;
      let honeyEventCount = 0;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!sawFirstByte) {
          sawFirstByte = true;
          logSchedulerRun("scheduler.run.stream.first_byte", { byteLength: value.byteLength });
          setRunPhase("thinking", "thinking");
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const eventText of events) {
          const line = eventText.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") {
            sawTerminalEvent = true;
            continue;
          }
          const parsed = parseRuntimeSsePayload(payload) as {
            choices?: Array<{ delta?: { content?: string; tool_results?: unknown } }>;
            error?: unknown;
            honey?: unknown;
            status?: { type?: string };
            tool_call?: unknown;
          };
          const runtimeError = runtimeErrorMessage(parsed);
          if (runtimeError) throw new Error(runtimeError);
          if (parsed.honey) {
            honeyEventCount += 1;
            logSchedulerRun("scheduler.run.stream.honey", { honeyEventCount });
            await refreshHoneyLedger();
            continue;
          }
          if (parsed.status) {
            statusEventCount += 1;
            const statusType = parsed.status.type ?? "unknown";
            logSchedulerRun("scheduler.run.stream.status", {
              statusType,
              statusEventCount,
            });
            if (/tool|execut|run|action/i.test(statusType)) {
              setRunPhase("executing", "executing");
            } else if (/wrap|final|summar/i.test(statusType)) {
              setRunPhase("wrapping", "wrapping up");
            } else {
              setRunPhase("thinking", "thinking");
            }
          }
          if (parsed.tool_call) {
            toolEventCount += 1;
            logSchedulerRun("scheduler.run.stream.tool_call", { toolEventCount });
            setRunPhase("executing", "executing");
          }
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (!chunk) continue;
          contentChunkCount += 1;
          fullText += chunk;
          if (contentChunkCount === 1 || contentChunkCount % 5 === 0) {
            logSchedulerRun("scheduler.run.stream.content", {
              contentChunkCount,
              outputLength: fullText.length,
            });
          }
          setRunPhase("wrapping", "wrapping up");
          setMessagesByAgent((current) => {
            const existing = current[agent.id] ?? [];
            const next = [...existing];
            const last = next[next.length - 1] ?? { role: "assistant" as const, content: "" };
            if (next.length === 0) next.push(last);
            next[next.length - 1] = { ...last, content: fullText, createdAt: last.createdAt ?? Date.now() };
            return { ...current, [agent.id]: next };
          });
          updateTask(task.id, { lastMessage: fullText });
        }
      }

      const result = fullText.trim() || `${agent.name} completed the scheduled run.`;
      logSchedulerRun("scheduler.run.completed", {
        sawTerminalEvent,
        sawFirstByte,
        outputLength: fullText.length,
        contentChunkCount,
        statusEventCount,
        toolEventCount,
        honeyEventCount,
      });
      updateTask(task.id, { status: "completed", lastMessage: result, completedAt: Date.now() });
      setSchedules((current) => current.map((item) => (
        item.id === schedule.id
          ? { ...item, lastRunAt: Date.now(), updatedAt: Date.now(), lastStatus: "ok", lastSummary: result.slice(0, 500) }
          : item
      )));
      setScheduleImportStatus(sawTerminalEvent
        ? `Completed ${schedule.name}.`
        : `Completed ${schedule.name}; runtime stream closed without an explicit done event.`);
      void recordSharedScheduledRun(schedule, {
        runId,
        status: "ok",
        startedAt: now,
        completedAt: Date.now(),
        prompt: scheduledPrompt,
        output: result,
        summary: result.slice(0, 500),
        telemetry: {
          sawTerminalEvent,
          sawFirstByte,
          contentChunkCount,
          statusEventCount,
          toolEventCount,
          honeyEventCount,
        },
      });
      finishRunState("done");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown runtime error";
      logSchedulerRun("scheduler.run.failed", {
        errorName: error instanceof Error ? error.name : "unknown",
        message,
      });
      setMessagesByAgent((current) => {
        const existing = current[agent.id] ?? [];
        const next = [...existing];
        const last = next[next.length - 1] ?? { role: "assistant" as const, content: "" };
        if (next.length === 0) next.push(last);
        next[next.length - 1] = { ...last, content: `Error: ${message}`, createdAt: last.createdAt ?? Date.now() };
        return { ...current, [agent.id]: next };
      });
      updateTask(task.id, { status: "failed", lastMessage: message, completedAt: Date.now() });
      setSchedules((current) => current.map((item) => (
        item.id === schedule.id ? { ...item, updatedAt: Date.now(), lastStatus: "failed", lastSummary: message } : item
      )));
      setScheduleImportStatus(`Could not run ${schedule.name}: ${message}`);
      void recordSharedScheduledRun(schedule, {
        runId,
        status: "failed",
        startedAt: now,
        completedAt: Date.now(),
        prompt: scheduledPrompt,
        summary: message,
        telemetry: {
          errorName: error instanceof Error ? error.name : "unknown",
        },
      });
      finishRunState("idle");
    } finally {
      window.clearInterval(waitingInterval);
    }
  }

  const schedulerStatusFromSchedule = useCallback((schedule: AgentSchedule): SchedulerJob["lastRun"]["status"] => {
    const raw = schedule.lastStatus?.toLowerCase() ?? "";
    if (raw.includes("fail") || raw.includes("error")) return "failed";
    if (raw.includes("warn") || raw.includes("stale")) return "warn";
    return schedule.lastRunAt ? "ok" : "idle";
  }, []);

  const scheduleIntervalMs = useCallback((every: string) => {
    const match = every.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
    if (!match) return null;
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(value)) return null;
    if (unit === "ms") return value;
    if (unit === "s") return value * 1000;
    if (unit === "m") return value * 60_000;
    if (unit === "h") return value * 3_600_000;
    return value * 86_400_000;
  }, []);

  function formatSchedulerDuration(ms: number) {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `in ${hours}h ${rest}m` : `in ${hours}h`;
  }

  const schedulerCadenceLabel = useCallback((every: string) => {
    const ms = scheduleIntervalMs(every);
    if (!ms) return every || "custom";
    const minutes = Math.round(ms / 60_000);
    if (minutes < 60) return `Every ${minutes}m`;
    if (minutes % 1440 === 0) return `Every ${minutes / 1440}d`;
    if (minutes % 60 === 0) return `Every ${minutes / 60}h`;
    return `Every ${minutes}m`;
  }, [scheduleIntervalMs]);

  const schedulerJobs = useMemo<SchedulerJob[]>(() => schedules.map((schedule) => {
    const agent = displayAgents.find((item) => item.id === schedule.agentId);
    const runtime = schedule.externalSource ?? agent?.runtime ?? "openclaw";
    const intervalMs = scheduleIntervalMs(schedule.every);
    const anchor = schedule.lastRunAt ?? schedule.updatedAt ?? schedule.createdAt;
    const remaining = schedule.nextRunAt && schedule.nextRunAt > Date.now()
      ? schedule.nextRunAt - Date.now()
      : intervalMs ? intervalMs - ((Date.now() - anchor) % intervalMs) : null;
    const lastStatus = schedulerStatusFromSchedule(schedule);
    const lastRunAt = schedule.lastRunAt ? formatRelativeTime(schedule.lastRunAt) : "not run yet";
    const description = schedule.lastSummary || (schedule.mode === "steps"
      ? `${schedule.steps.length || 1} step runbook`
      : schedule.prompt || "Dashboard-managed schedule.");
    return {
      id: schedule.id,
      name: schedule.name,
      description,
      cron: schedule.every,
      cronLabel: schedulerCadenceLabel(schedule.every),
      runtime: RUNTIME_LABELS[runtime as AgentRuntime] ?? runtime,
      machine: agent?.machineName ? displayMachineName(agent.machineName) : schedule.externalSource ?? "dashboard",
      bee: agent?.name ?? "Unassigned",
      enabled: schedule.enabled,
      nextRun: schedule.enabled && remaining ? formatSchedulerDuration(remaining) : schedule.enabled ? "scheduled" : "paused",
      nextRunISO: remaining ? new Date(Date.now() + remaining).toISOString() : new Date(schedule.updatedAt).toISOString(),
      lastRun: { status: lastStatus, at: lastRunAt, dur: schedule.lastRunAt ? "recorded" : "-" },
      history: [
        { status: lastStatus, at: lastRunAt, dur: schedule.lastRunAt ? "recorded" : "-" },
      ],
      tags: [
        schedule.mode,
        ...(schedule.skills.slice(0, 2)),
        ...(schedule.paths.length ? ["paths"] : []),
      ],
    };
  }), [displayAgents, scheduleIntervalMs, schedules, schedulerCadenceLabel, schedulerStatusFromSchedule]);

  function findScheduleForJob(job: SchedulerJob) {
    return schedules.find((schedule) => schedule.id === job.id);
  }

  function modalCadenceFromEvery(every: string): NewTaskPayload["cadence"] {
    if (every === "15m") return { kind: "every15" };
    if (every === "1h" || every === "60m") return { kind: "hourly" };
    if (every === "24h" || every === "1440m") return { kind: "daily" };
    if (every === "manual") return { kind: "manual" };
    if (/^[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+$/.test(every.trim())) return { kind: "cron", expr: every.trim() };
    return { kind: "cron", expr: every.trim() || "0 2 * * *" };
  }

  function everyFromModalCadence(cadence: NewTaskPayload["cadence"]) {
    if (cadence.kind === "every15") return "15m";
    if (cadence.kind === "hourly") return "1h";
    if (cadence.kind === "daily") return "24h";
    if (cadence.kind === "weekday") return "30 13 * * 1-5";
    if (cadence.kind === "session") return "30 13 * * 1-5";
    if (cadence.kind === "manual") return "manual";
    return cadence.kind === "cron" ? cadence.expr || "0 2 * * *" : "0 2 * * *";
  }

  const schedulerModalInitial = useMemo<Partial<NewTaskPayload>>(() => {
    const selectedAgentForDraft = displayAgents.find((agent) => agent.id === scheduleDraft.agentId) ?? selectedAgent ?? displayAgents[0];
    return {
      title: scheduleDraft.name || (editingScheduleId ? "Edit scheduled task" : "New scheduled task"),
      mode: scheduleDraft.mode,
      steps: scheduleDraft.steps.map((step) => step.text).filter(Boolean),
      prompt: scheduleDraft.prompt,
      attachments: [
        ...scheduleDraft.skills.map((skill) => ({ kind: "skill" as const, label: skill })),
        ...scheduleDraft.paths.map((path) => ({ kind: "path" as const, label: path })),
      ],
      cadence: modalCadenceFromEvery(scheduleDraft.every),
      target: {
        machine: selectedAgentForDraft?.machineName ? displayMachineName(selectedAgentForDraft.machineName) : "dashboard",
        bee: selectedAgentForDraft?.name ?? "",
      },
      templateId: null,
      usePastRuns: scheduleDraft.usePastRuns,
      pastRunLimit: scheduleDraft.pastRunLimit,
    };
  }, [displayAgents, editingScheduleId, scheduleDraft, selectedAgent]);

  async function saveScheduleFromModal(task: NewTaskPayload) {
    // In AEON mode the modal hides the machine/bee picker, so task.target.bee is just the
    // stale default — the intended workspace is the AEON agent seeded into scheduleDraft when
    // the modal opened. Honor that; otherwise resolve from the picker selection as before.
    const draftAgent = displayAgents.find((item) => item.id === scheduleDraft.agentId);
    const agent = (task.aeon && draftAgent)
      ? draftAgent
      : (displayAgents.find((item) => item.name === task.target.bee)
        ?? displayAgents.find((item) => item.machineName === task.target.machine)
        ?? displayAgents.find((item) => item.machineName && displayMachineName(item.machineName) === task.target.machine)
        ?? draftAgent
        ?? selectedAgent
        ?? displayAgents[0]);
    if (!agent) return "No agent is configured to run this automation.";
    const now = Date.now();
    const schedulerFeature = runtimeSchedulerFeature(agent.runtime);
    const externalRuntime = schedulerFeature.kind === "external-runtime" ? schedulerFeature.externalSource : undefined;
    const skills = task.attachments.filter((item) => item.kind === "skill").map((item) => item.label);
    const paths = task.attachments.filter((item) => item.kind === "path").map((item) => item.label);
    const steps = task.mode === "steps"
      ? task.steps.filter((step) => step.trim()).map((step, index) => ({
        id: `step-${now}-${index}`,
        text: step.trim(),
        skills: [],
        paths: [],
        model: "",
      }))
      : [];
    const prompt = task.mode === "steps"
      ? steps.map((step, index) => `${index + 1}. ${step.text}`).join("\n")
      : task.prompt.trim();
    const editedSchedule = editingScheduleId ? schedules.find((schedule) => schedule.id === editingScheduleId) : null;
    const next: AgentSchedule = {
      id: editedSchedule?.id ?? `schedule-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name: task.title.trim() || `Run ${agent.name}`,
      agentId: agent.id,
      enabled: editedSchedule?.enabled ?? true,
      every: everyFromModalCadence(task.cadence),
      mode: task.mode,
      prompt,
      model: editedSchedule?.model ?? "",
      skills,
      paths,
      steps,
      createdAt: editedSchedule?.createdAt ?? now,
      updatedAt: now,
      lastRunAt: editedSchedule?.lastRunAt,
      externalSource: externalRuntime ?? editedSchedule?.externalSource,
      externalJobId: externalRuntime ? (skills[0] || editedSchedule?.externalJobId) : editedSchedule?.externalJobId,
      lastStatus: editedSchedule?.lastStatus,
      lastSummary: editedSchedule?.lastSummary,
      usePastRuns: task.usePastRuns,
      pastRunLimit: Math.max(1, Math.min(12, Number(task.pastRunLimit) || 3)),
      sharedSchedulePath: editedSchedule?.sharedSchedulePath,
      sharedRunFolder: editedSchedule?.sharedRunFolder,
    };
    if (externalRuntime === "aeon") {
      const configured = await configureAeonSchedule(agent, next);
      if (!configured || "error" in configured) {
        return configured?.error || `Could not arm this AEON automation on ${agent.name}.`;
      }
      next.externalSource = "aeon";
      next.externalJobId = configured.skill;
      next.every = configured.cron;
      next.lastSummary = `Configured AEON automation for ${configured.skill}.`;
    }
    setSchedules((current) => editedSchedule
      ? current.map((schedule) => schedule.id === editedSchedule.id ? next : schedule)
      : [next, ...current]);
    void upsertSharedSchedule(next);
    resetScheduleDraft(agent.id);
    setSchedulerDraftOpen(false);
  }

  const browseSchedulerFolder = useCallback(async () => {
    const currentPath = scheduleDraft.paths.find((path) => path.trim()) ?? sharedVault.vaultPath ?? "";
    const nativeResult = await openNativeDirectory({
      currentPath,
      prompt: "Choose a folder to attach to this scheduled task:",
    });
    if (nativeResult?.path) return nativeResult.path;
    if (nativeResult?.cancelled) return null;
    const response = await fetch("/api/scheduler/browse-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPath }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { path?: string; cancelled?: boolean } | null;
    return response?.ok && data?.path ? data.path : null;
  }, [scheduleDraft.paths, sharedVault.vaultPath]);

  return { toggleScheduleSkill, toggleSchedulerStepMode, updateSchedulerStep, addSchedulerStep, removeSchedulerStep, addSchedulerStepPath, removeSchedulerStepPath, toggleSchedulerStepSkill, updateSchedulerStepModel, isSchedulerFilePath, pickSchedulerFolder, pickSchedulerFiles, addSchedulePath, removeSchedulePath, removeScheduleSkill, resetScheduleDraft, editSchedule, createSchedule, removeSchedule, importExistingSchedules, normalizeImportedScheduleEvery, toggleSchedule, schedulerPlainPrompt, schedulerSharedSnapshot, upsertSharedSchedule, upsertSharedSchedules, fetchPastRunContext, scheduleFromSharedSnapshot, mergeSharedSchedules, refreshSharedSchedulesFromVault, recordSharedScheduledRun, runScheduleNow, schedulerStatusFromSchedule, scheduleIntervalMs, formatSchedulerDuration, schedulerCadenceLabel, schedulerJobs, findScheduleForJob, modalCadenceFromEvery, everyFromModalCadence, schedulerModalInitial, saveScheduleFromModal, browseSchedulerFolder };
}
