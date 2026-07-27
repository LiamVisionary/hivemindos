"use client";

import { useMemo } from "react";
import { FileUp, LoaderCircle, Repeat2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SchedulerView, AutomationComposerModal } from "@/components/scheduler";
import type { SchedulerJob, SchedulerRunHistoryEntry, SchedulerRunState, AutomationAgentOption } from "@/components/scheduler";
import type { NewTaskPayload } from "@/components/task-modal";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { runtimeDisplayLabel } from "@/lib/types/agent-runtime";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";
import type { AgentSchedule, MachineGroup, WorkView } from "@/features/dashboard/dashboard-types";
import styles from "@/components/scheduler/scheduler-tokens.module.css";

// Automation-health warnings (duplicate/dead loops) now surface in the Alerts
// route (NotificationsPanel) instead of a banner here, so the scheduler view
// stays a clean flight plan. The durable dismiss state moved there too.

type SkillOption = { slug: string; name: string; description?: string };

const WORK_TABS: Array<{ id: WorkView; label: string }> = [
  { id: "kanban", label: "Workboard" },
  { id: "scheduler", label: "Automations" },
  { id: "swarm", label: "Simulation" },
  { id: "history", label: "History" },
];

function titleCase(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

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
    activeView, setActiveView, schedulerJobs, schedulerRunStates,
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

  // Real agent roster for the create wizard: name + bee identity (for the icon)
  // + resolved machine/runtime labels + a class label. Machine is resolved from
  // the machine groups the agent actually belongs to (rename-proof), falling back
  // to the agent's own machineName / "dashboard".
  const automationAgents = useMemo<AutomationAgentOption[]>(() => displayAgents.map((agent) => {
    const group = machineGroups.find((machine) => machine.agents?.some((member) => member.id === agent.id));
    const machineLabel = group?.name ?? agent.machineName ?? "dashboard";
    const cls = agent.beeRole === "queen" ? "Queen" : titleCase(agent.workerClass ?? "general");
    return {
      id: agent.id,
      name: agent.name,
      beeRole: agent.beeRole,
      workerClass: agent.workerClass,
      cls,
      machineLabel,
      runtimeLabel: agent.runtime ? runtimeDisplayLabel(agent.runtime) : "dashboard",
    };
  }), [displayAgents, machineGroups]);

  const machineOptions = useMemo<string[]>(() => Array.from(new Set([
    ...machineGroups.map((machine) => machine.name),
    "dashboard",
  ])), [machineGroups]);

  const activeCount = schedulerJobs.filter((job) => job.enabled).length;
  const pausedCount = schedulerJobs.filter((job) => !job.enabled).length;
  const attentionCount = schedulerJobs.filter((job) => job.enabled && (job.lastRun.status === "failed" || job.lastRun.status === "warn")).length;

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
    void confirmUserAction(`Delete “${job.name}”? This removes the automation and its run history from the shared vault.`).then((confirmed) => {
      if (confirmed) removeSchedule(job.id);
    });
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

  const headerActions = (
    <TooltipProvider delayDuration={120}>
    <div className={styles.autoTopActions}>
      {scheduleImportStatus ? (
        <span className="max-w-[200px] truncate text-[11px] text-[var(--muted)]" title={scheduleImportStatus}>{scheduleImportStatus}</span>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Sync vault schedules"
            className={styles.toolBtn}
            onClick={() => void refreshSharedSchedulesFromVault()}
          >
            <Repeat2 aria-hidden size={15} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Sync vault schedules</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={scheduleImporting ? "Importing existing runtime schedules" : "Import existing runtime schedules"}
            className={styles.toolBtn}
            onClick={() => void importExistingSchedules()}
            disabled={scheduleImporting}
          >
            {scheduleImporting ? <LoaderCircle aria-hidden size={15} className="animate-spin" /> : <FileUp aria-hidden size={15} />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{scheduleImporting ? "Importing existing schedules" : "Import existing schedules"}</TooltipContent>
      </Tooltip>
    </div>
    </TooltipProvider>
  );

  return (
    <>
      {activeView === "scheduler" ? (
        <section
          className={`${styles.root} ${styles.autoTheme} grid min-h-0 overflow-hidden`}
          style={{ height: "100%", background: "var(--background)", gridTemplateRows: "auto minmax(0, 1fr)" }}
        >
          {/* Sub-tab + stats bar */}
          <div className={styles.autoTopBar}>
            <div className={styles.autoTabGroup} role="tablist" aria-label="Work view">
              {WORK_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={tab.id === "scheduler"}
                  className={`${styles.autoTab} ${tab.id === "scheduler" ? styles.autoTabActive : ""}`}
                  onClick={() => setActiveView(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className={styles.autoStats} aria-label="Automations summary">
              <span><strong className={styles.autoStat} style={{ color: "var(--status-ok)" }}>{activeCount}</strong>active</span>
              <span><strong className={styles.autoStat} style={{ color: "var(--hex-honey-border)" }}>{pausedCount}</strong>paused</span>
              <span><strong className={styles.autoStat} style={{ color: "var(--status-failed)" }}>{attentionCount}</strong>attention</span>
              <span><strong className={styles.autoStat}>{schedulerJobs.length}</strong>total</span>
            </div>
            {headerActions}
          </div>

          <div className="min-h-0 overflow-hidden">
            <SchedulerView
              jobs={schedulerJobs}
              runStates={schedulerRunStates}
              fetchHistory={historyForJob}
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
        <AutomationComposerModal
          key={editingScheduleId || "new-scheduler-task"}
          open
          editing={Boolean(editingScheduleId)}
          aeon={activeView === "aeon"}
          initial={schedulerModalInitial}
          agents={automationAgents}
          machines={machineOptions}
          skillOptions={modalSkillOptions.map((skill) => ({ slug: skill.slug, name: skill.name, description: skill.description }))}
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
