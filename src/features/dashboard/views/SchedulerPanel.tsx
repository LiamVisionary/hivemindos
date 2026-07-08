"use client";

import { useMemo, useState } from "react";
import { FileUp, LoaderCircle, Repeat2 } from "lucide-react";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SchedulerView } from "@/components/scheduler";
import type { SchedulerJob, SchedulerRunHistoryEntry, SchedulerRunState } from "@/components/scheduler";
import { TaskModal } from "@/components/task-modal";
import type { NewTaskPayload } from "@/components/task-modal";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentSchedule, MachineGroup, WorkView } from "@/features/dashboard/dashboard-types";
import { computeScheduleHealthWarnings, scheduleHealthWarningKey, visibleScheduleHealthWarnings } from "../schedule-health";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import { WorkSectionHeader } from "./WorkSectionHeader";

// Durable set of loop-health warnings the user has dismissed, keyed by
// kind+scheduleIds so an acknowledged warning stays hidden but a genuinely new
// one still surfaces. Persisted through the dashboard state service (never
// localStorage) so it survives reloads and rides the native bridge.
const SCHEDULE_HEALTH_DISMISSED_KEY = "hivemindos.scheduleHealthDismissed.v1";

type SkillOption = { slug: string; name: string; description?: string };

export interface SchedulerPanelProps {
  activeView: string;
  setActiveView: (view: WorkView) => void;
  schedulerJobs: SchedulerJob[];
  schedulerRunStates: Record<string, SchedulerRunState>;
  schedules: AgentSchedule[];
  scheduleImporting: boolean;
  scheduleImportStatus: string;
  schedulerDraftOpen: boolean;
  editingScheduleId: string | null;
  displayAgents: AgentProfile[];
  selectedAgent: AgentProfile | null;
  machineGroups: MachineGroup[];
  sharedSkillOptions: SkillOption[];
  aeonSkillOptions: SkillOption[];
  schedulerModalInitial: Partial<NewTaskPayload>;
  refreshSharedSchedulesFromVault: () => void | Promise<void>;
  importExistingSchedules: () => void | Promise<void>;
  toggleSchedule: (id: string) => void;
  runScheduleNow: (schedule: AgentSchedule) => void;
  findScheduleForJob: (job: SchedulerJob) => AgentSchedule | undefined;
  editSchedule: (schedule: AgentSchedule) => void;
  duplicateSchedule: (id: string) => void;
  removeSchedule: (id: string) => void;
  fetchScheduleHistory: (schedule: AgentSchedule) => Promise<SchedulerRunHistoryEntry[]>;
  resetScheduleDraft: (agentId?: string) => void;
  setSchedulerDraftOpen: (open: boolean) => void;
  setScheduleImportStatus: (status: string) => void;
  browseSchedulerFolder: () => Promise<string | null>;
  saveScheduleFromModal: (task: NewTaskPayload) => Promise<string | void> | void;
}

export function SchedulerPanel(props: SchedulerPanelProps) {
  const {
    activeView, setActiveView, schedulerJobs, schedulerRunStates, schedules,
    scheduleImporting, scheduleImportStatus, schedulerDraftOpen, editingScheduleId,
    displayAgents, selectedAgent, machineGroups, sharedSkillOptions, aeonSkillOptions,
    schedulerModalInitial, refreshSharedSchedulesFromVault, importExistingSchedules,
    toggleSchedule, runScheduleNow, findScheduleForJob, editSchedule, duplicateSchedule,
    removeSchedule, fetchScheduleHistory, resetScheduleDraft, setSchedulerDraftOpen,
    setScheduleImportStatus, browseSchedulerFolder, saveScheduleFromModal,
  } = props;

  // AEON automations arm a skill from the AEON runtime inventory, so the modal's skill
  // picker is fed from the runtime skill list in aeon mode (the shared-brain list is the
  // wrong source there and is usually empty).
  const modalSkillOptions = activeView === "aeon" ? (aeonSkillOptions ?? []) : sharedSkillOptions;

  // Loop-health guard: duplicate enabled loops and enabled-but-dead loops surface
  // here so silent double-fires/rot get seen. Mount-time clock keeps render pure;
  // staleness thresholds are days-scale, so hours of drift is immaterial.
  const [healthCheckedAt] = useState(() => Date.now());
  const scheduleHealthWarnings = useMemo(
    () => computeScheduleHealthWarnings(schedules ?? [], healthCheckedAt),
    [schedules, healthCheckedAt],
  );
  const [dismissedHealthRaw, rememberDismissedHealth] = useRememberedDashboardValue(SCHEDULE_HEALTH_DISMISSED_KEY);
  const dismissedHealthKeys = useMemo(() => {
    try {
      const parsed = JSON.parse(dismissedHealthRaw || "[]");
      return new Set<string>(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [dismissedHealthRaw]);
  const visibleHealthWarnings = useMemo(
    () => visibleScheduleHealthWarnings(scheduleHealthWarnings, dismissedHealthKeys),
    [scheduleHealthWarnings, dismissedHealthKeys],
  );
  const dismissHealthWarning = (warning: (typeof scheduleHealthWarnings)[number]) => {
    const liveKeys = new Set(scheduleHealthWarnings.map(scheduleHealthWarningKey));
    const next = [...dismissedHealthKeys, scheduleHealthWarningKey(warning)].filter((key) => liveKeys.has(key));
    rememberDismissedHealth(JSON.stringify([...new Set(next)]));
  };
  const restoreDismissedHealthWarnings = () => rememberDismissedHealth("[]");
  const hiddenHealthWarningCount = scheduleHealthWarnings.length - visibleHealthWarnings.length;

  const runJob = (job: SchedulerJob) => {
    const schedule = findScheduleForJob(job);
    if (schedule) runScheduleNow(schedule);
  };
  const editJob = (job: SchedulerJob) => {
    const schedule = findScheduleForJob(job);
    if (!schedule) return;
    editSchedule(schedule);
    setScheduleImportStatus(`Loaded ${schedule.name} into the editor.`);
  };
  const deleteJob = (job: SchedulerJob) => {
    if (typeof window !== "undefined"
      && !window.confirm(`Delete “${job.name}”? This removes the automation and its run history from the shared vault.`)) return;
    removeSchedule(job.id);
  };
  const historyForJob = (job: SchedulerJob) => {
    const schedule = findScheduleForJob(job);
    return schedule ? fetchScheduleHistory(schedule) : Promise.resolve<SchedulerRunHistoryEntry[]>([]);
  };
  const openNewDraft = () => {
    resetScheduleDraft(selectedAgent?.id ?? displayAgents[0]?.id ?? "");
    setSchedulerDraftOpen(true);
    setScheduleImportStatus("");
  };

  return (
    <>
      {activeView === "scheduler" ? (
        <section
          className="grid min-h-0 overflow-hidden rounded-[18px] border border-[rgba(148,163,184,0.16)] bg-[rgba(5,8,13,0.72)]"
          style={{ height: "100%", gridTemplateRows: (visibleHealthWarnings.length || hiddenHealthWarningCount) ? "auto auto minmax(0, 1fr)" : "auto minmax(0, 1fr)" }}
        >
          <WorkSectionHeader
            activeView="scheduler"
            onSelect={setActiveView}
            title="Automations"
            subtitle="Recurring work for your agents"
            stats={[
              { value: schedulerJobs.filter((job) => job.enabled).length, label: "active", tone: "cyan" },
              { value: schedulerJobs.filter((job) => !job.enabled).length, label: "paused", tone: "honey" },
              { value: schedulerJobs.filter((job) => job.lastRun?.status === "failed").length, label: "failed", tone: "danger" },
              { value: schedulerJobs.length, label: "total" },
            ]}
          />
          {visibleHealthWarnings.length ? (
            <div className="flex max-h-36 flex-col gap-1.5 overflow-y-auto border-b border-[rgba(245,158,11,0.28)] bg-[rgba(245,158,11,0.08)] px-4 py-2.5" role="status" aria-live="polite">
              {visibleHealthWarnings.map((warning) => (
                <div key={scheduleHealthWarningKey(warning)} className="flex items-start gap-2 text-xs leading-relaxed">
                  <div className="min-w-0 flex-1">
                    <strong className="text-[rgba(253,230,138,0.95)]">{warning.title}.</strong>{" "}
                    <span className="text-[var(--muted)]">{warning.detail}</span>
                  </div>
                  <CloseIconButton
                    size="sm"
                    aria-label={`Dismiss warning: ${warning.title}`}
                    title="Dismiss this warning"
                    className="-mr-1 shrink-0 text-[rgba(253,230,138,0.85)] hover:text-[rgba(253,230,138,1)]"
                    onClick={() => dismissHealthWarning(warning)}
                  />
                </div>
              ))}
            </div>
          ) : hiddenHealthWarningCount ? (
            <div className="flex items-center justify-end gap-2 border-b border-[rgba(148,163,184,0.14)] bg-[rgba(5,8,13,0.4)] px-4 py-1.5 text-[11px] text-[var(--muted)]" role="status">
              <span>{hiddenHealthWarningCount} automation health {hiddenHealthWarningCount === 1 ? "warning" : "warnings"} dismissed.</span>
              <button type="button" className="font-medium text-[rgba(253,230,138,0.9)] underline-offset-2 hover:underline" onClick={restoreDismissedHealthWarnings}>
                Show
              </button>
            </div>
          ) : null}
          <div className="min-h-0 overflow-hidden">
            <SchedulerView
              jobs={schedulerJobs}
              runStates={schedulerRunStates}
              fetchHistory={historyForJob}
              toolbar={
                <div className="flex w-full flex-wrap items-center justify-center gap-2">
                  {scheduleImportStatus ? (
                    <span className="max-w-[220px] truncate text-[11px] text-[var(--muted)]" title={scheduleImportStatus}>{scheduleImportStatus}</span>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Sync vault schedules"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[rgba(148,163,184,0.20)] bg-[rgba(15,23,42,0.60)] text-[var(--muted)] transition hover:border-[rgba(94,234,212,0.38)] hover:bg-[rgba(20,184,166,0.10)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(94,234,212,0.34)] [&_svg]:h-4 [&_svg]:w-4"
                        onClick={() => void refreshSharedSchedulesFromVault()}
                      >
                        <Repeat2 aria-hidden />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Sync vault schedules</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={scheduleImporting ? "Importing existing runtime schedules" : "Import existing runtime schedules"}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[rgba(148,163,184,0.20)] bg-[rgba(15,23,42,0.60)] text-[var(--muted)] transition hover:border-[rgba(94,234,212,0.38)] hover:bg-[rgba(20,184,166,0.10)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(94,234,212,0.34)] disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:h-4 [&_svg]:w-4"
                        onClick={() => void importExistingSchedules()}
                        disabled={scheduleImporting}
                      >
                        {scheduleImporting ? <LoaderCircle aria-hidden className="animate-spin" /> : <FileUp aria-hidden />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{scheduleImporting ? "Importing existing schedules" : "Import existing schedules"}</TooltipContent>
                  </Tooltip>
                </div>
              }
              onToggleJob={(job) => toggleSchedule(job.id)}
              onRunNow={runJob}
              onEditJob={editJob}
              onDuplicateJob={(job) => duplicateSchedule(job.id)}
              onDeleteJob={deleteJob}
              onNewJob={openNewDraft}
            />
          </div>
        </section>
      ) : null}

      {(activeView === "scheduler" || activeView === "aeon") && schedulerDraftOpen ? (
        <TaskModal
          key={editingScheduleId || "new-scheduler-task"}
          open
          aeon={activeView === "aeon"}
          initial={schedulerModalInitial}
          skillOptions={modalSkillOptions.map((skill) => ({
            slug: skill.slug,
            name: skill.name,
            description: skill.description,
          }))}
          machineOptions={Array.from(new Set([
            ...machineGroups.map((machine) => machine.name),
            "dashboard",
          ]))}
          beeOptions={Array.from(new Set(displayAgents.map((agent) => agent.name)))}
          onBrowseFolder={browseSchedulerFolder}
          onClose={() => {
            setSchedulerDraftOpen(false);
            if (editingScheduleId) resetScheduleDraft(selectedAgent?.id ?? displayAgents[0]?.id ?? "");
          }}
          onSave={saveScheduleFromModal}
        />
      ) : null}
    </>
  );
}
