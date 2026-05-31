"use client";

import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, HTMLAttributes, KeyboardEvent, ReactNode, SetStateAction } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  Activity,
  BarChart3,
  Bot,
  Check,
  ChevronLeft,
  Clock3,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  FolderOpen,
  GitBranch,
  KeyRound,
  ListChecks,
  LoaderCircle,
  MemoryStick,
  Network,
  Play,
  Plus,
  Power,
  RefreshCcw,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import fleetStyles from "@/components/fleet/fleet-tokens.module.css";
import { SchedulerView, type SchedulerJob, type SchedulerRunState } from "@/components/scheduler";
import { Button } from "@/components/ui/button";
import { CreateFolderRepoModal, type CreateFolderRepoValue } from "@/features/dashboard/views/shared/CreateFolderRepoModal";
import { AeonDeliverablesPanel } from "@/features/dashboard/views/AeonDeliverablesPanel";
import { InlineRenameControl } from "@/features/dashboard/views/shared/InlineRenameControl";
import { SectionModeHeader } from "@/features/dashboard/views/WorkSectionHeader";
import { getNativeBrainSkillInventory } from "@/lib/native/brain-skills";
import { downloadNativeAeonDeliverable, listNativeAeonDeliverables, sendNativeAeonDeliverable } from "@/lib/native/aeon-deliverables";
import { getNativeAeonRunLog, listNativeAeonRuns, nativeAeonRepoSync } from "@/lib/native/aeon-git";
import { getNativeAeonMemory } from "@/lib/native/aeon-memory";
import { listNativeAeonOutputs } from "@/lib/native/aeon-outputs";
import { listNativeAeonSchedules } from "@/lib/native/aeon-schedules";
import { prepareNativeAeonWorkspace } from "@/lib/native/aeon-workspaces";
import { openNativeDeliverable, openNativeDirectory } from "@/lib/native/filesystem";
import type { AgentSettingsPanel } from "@/features/dashboard/agent-settings-types";
import type { BrainSkillInventory, BrainSkillSummary, DashboardView, LinkedDirectory, MachineGroup } from "@/features/dashboard/dashboard-types";
import { groupSkills, runtimeSkillToGroupable, type GroupableSkill } from "@/features/dashboard/skill-grouping";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { KanbanMachineTarget } from "@/lib/types/kanban";
import type { AeonDeliverable } from "@/app/api/runtimes/aeon/deliverables/route";
import type { RuntimeAnalytics, RuntimeMemorySnapshot, RuntimeRepoSyncStatus, RuntimeRun, RuntimeRunLog, RuntimeSchedule, RuntimeSecretStatus, RuntimeSkill } from "@/lib/services/runtime-adapters/types";

type AeonStatus = {
  ok?: boolean;
  runtime?: string;
  status?: {
    ok?: boolean;
    root?: string;
    repo?: string;
    hasConfig?: boolean;
    a2aReachable?: boolean;
    localSkillCount?: number;
  };
  error?: string;
};

type AeonOutput = {
  filename?: string;
  skill?: string;
  source?: string;
  updatedAt?: string;
  excerpt?: string;
};

type AeonObsidianSyncStatus = {
  ok?: boolean;
  installed?: boolean;
  running?: boolean;
  repoRoot?: string;
  vaultRepoRoot?: string;
  pid?: number;
  logPath?: string;
  command?: string;
  message?: string;
  error?: string;
};

type UploadedSkillFile = { path: string; content: string };
type ConvertScheduleMode = "manual" | "hourly" | "daily" | "weekdays" | "weekly";
type ConvertBriefMode = "description" | "checklist" | "changes" | "summary";
type ConvertAeonDraft = {
  scheduleMode: ConvertScheduleMode;
  hour: string;
  minute: string;
  weekday: string;
  onDuty: boolean;
  briefMode: ConvertBriefMode;
  model: string;
};
type AeonGithubRepoOption = {
  fullName: string;
  name: string;
  owner: string;
  private?: boolean;
  url?: string;
  defaultBranch?: string;
  description?: string;
};
type SkillSourceView = "aeon" | "shared";
type SkillAutomationState = "available" | "ready" | "manual" | "on-duty" | "paused";
type UnifiedSkillRow = GroupableSkill & {
  automationState: SkillAutomationState;
  statusLabel: string;
  actionLabel: string;
  sharedSkill?: BrainSkillSummary;
  runtimeSkill?: RuntimeSkill & { runtimeSchedule?: RuntimeSchedule };
};

type AeonAutopilotPanelProps = {
  activeView: DashboardView;
  displayAgents: AgentProfile[];
  selectedAgentId: string;
  setAgents: Dispatch<SetStateAction<AgentProfile[]>>;
  sharedVault: SharedVaultConfig;
  machineGroups?: MachineGroup[];
  chooseDirectoryForMachine?: (machine: KanbanMachineTarget | null, onChoose: (directory: LinkedDirectory) => void) => void | Promise<void>;
  setActiveView: (view: DashboardView) => void;
  setVaultPanelMode: (mode: "hive-vault" | "shared-skills" | "brain-services" | "env" | "config") => void;
  setSelectedAgentId: (agentId: string) => void;
  setAgentRoleModalId: (agentId: string) => void;
  setAgentSettingsPanel: Dispatch<SetStateAction<AgentSettingsPanel>>;
  updateAgentProfile: (agentId: string, patch: Partial<AgentProfile>) => void;
  // Scheduler reuse — the panel renders the shared SchedulerView in place, locked to AEON schedules.
  schedulerJobs?: SchedulerJob[];
  schedulerRunStates?: Record<string, SchedulerRunState>;
  onSchedulerOpen?: () => void;
  onSchedulerToggleJob?: (job: SchedulerJob) => void;
  onSchedulerRunJob?: (job: SchedulerJob) => void;
  onSchedulerEditJob?: (job: SchedulerJob) => void;
  onSchedulerNewJob?: (agentId?: string) => void;
};

const DEFAULT_AEON_AGENT: AgentProfile = {
  id: "aeon-local",
  name: "Aeon",
  runtime: "aeon",
  runtimeKind: "background",
  runtimeCapabilities: {
    status: true,
    skills: true,
    schedules: true,
    runs: true,
    outputs: true,
    memory: true,
    backgroundTasks: true,
    notifications: true,
    setup: true,
  },
  gatewayUrl: "http://127.0.0.1:41241",
  a2aUrl: "http://127.0.0.1:41241",
  chatPath: "",
  statusPath: "/health",
  agentId: "local-aeon",
  provider: "",
  model: "",
  localDataDir: "~/.aeon",
  aeonLocalPath: "~/.aeon",
  aeonBranch: "main",
  aeonMode: "github",
  machineName: "local",
  telemetryUrl: "",
  useSharedVault: true,
  beeRole: "worker",
  workerClass: "ops",
};

const DEFAULT_SECRET_KEYS = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "BANKR_LLM_KEY", "GH_GLOBAL"];
// Dwell per clone-animation step. Real work runs concurrently (and the heavy network tail
// is backgrounded), so each step shows for this long and the final step doesn't stall.
const CLONE_STEP_MS = 1300;
const OFFICIAL_AEON_REPO_URL = "https://github.com/aaronjmars/aeon.git";
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const OBSIDIAN_SYNC_CACHE_PREFIX = "hivemindos.aeon.obsidianSync.";

function readCachedObsidianSyncStatuses() {
  if (typeof window === "undefined") return {};
  const statuses: Record<string, AeonObsidianSyncStatus> = {};
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(OBSIDIAN_SYNC_CACHE_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      statuses[key] = JSON.parse(raw) as AeonObsidianSyncStatus;
    }
  } catch {
    return {};
  }
  return statuses;
}

// Remember the last-known "GitHub OAuth + repo are wired up" verdict per AEON
// workspace so a return visit paints the automation hero (or the setup cards)
// immediately, instead of flashing the not-connected cards while the async
// status/secret checks are still in flight.
const AEON_GITHUB_READY_CACHE_PREFIX = "hivemindos.aeon.githubReady.";

function readCachedGithubReady() {
  if (typeof window === "undefined") return {};
  const ready: Record<string, boolean> = {};
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(AEON_GITHUB_READY_CACHE_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      ready[key.slice(AEON_GITHUB_READY_CACHE_PREFIX.length)] = raw === "1";
    }
  } catch {
    return {};
  }
  return ready;
}

type AeonFleetHexTone = "default" | "active" | "honey";
type AeonDetailView = "overview" | "work" | "activity" | "deliverables" | "settings";

const AEON_FLEET_HEX_W = 292;
const AEON_FLEET_HEX_H = 252;
const AEON_FLEET_HEX_X_STEP = AEON_FLEET_HEX_W * 0.75;
const AEON_FLEET_HEX_Y_STEP = AEON_FLEET_HEX_H / 2;

const AEON_FLEET_HEX_TONES: Record<AeonFleetHexTone, { bg: string; border: string; glow: string }> = {
  default: { bg: "linear-gradient(180deg, rgba(13,18,28,0.88), rgba(8,12,20,0.78))", border: "rgba(148,163,184,0.44)", glow: "transparent" },
  active: { bg: "linear-gradient(180deg, rgba(20,184,166,0.34), rgba(8,47,73,0.32))", border: "var(--hex-active-border)", glow: "var(--hex-active-glow)" },
  honey: { bg: "linear-gradient(180deg, rgba(13,18,28,0.88), rgba(8,12,20,0.78))", border: "var(--hex-honey-border)", glow: "rgba(255,212,90,0.18)" },
};

const AEON_FLEET_HEX_CLIP = "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";

const AeonFleetHex = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  tone?: AeonFleetHexTone;
  width?: number;
  height?: number;
}>(function AeonFleetHex({
  tone = "default",
  width = AEON_FLEET_HEX_W,
  height = AEON_FLEET_HEX_H,
  children,
  className = "",
  style,
  ...props
}, ref) {
  const t = AEON_FLEET_HEX_TONES[tone];
  const points = `${width * 0.25},0 ${width * 0.75},0 ${width},${height / 2} ${width * 0.75},${height} ${width * 0.25},${height} 0,${height / 2}`;

  return (
    <div
      ref={ref}
      className={`relative ${className}`}
      style={{
        width,
        height,
        transition: "transform 180ms ease, filter 180ms ease",
        filter: t.glow !== "transparent" ? `drop-shadow(0 0 14px ${t.glow})` : undefined,
        ...style,
      }}
      {...props}
    >
      <div
        className="absolute inset-0"
        style={{
          clipPath: AEON_FLEET_HEX_CLIP,
          background: t.bg,
          backdropFilter: "blur(10px) saturate(140%)",
          WebkitBackdropFilter: "blur(10px) saturate(140%)",
        }}
      />
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ overflow: "visible" }}
      >
        <polygon
          points={points}
          fill="none"
          stroke={t.border}
          strokeWidth={1}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ transition: "stroke 160ms ease, stroke-width 160ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
});

const AEON_LANES = [
  {
    title: "Choose the work",
    label: "Skills",
    body: "Pick a skill from AEON or the Shared Brain library, then decide whether it should run by hand or on a schedule.",
  },
  {
    title: "Let it run",
    label: "Autopilot",
    body: "AEON can start work now, pause it, or keep it on duty without asking you to manage the underlying files.",
  },
  {
    title: "Review the result",
    label: "Outputs",
    body: "Recent runs and artifacts stay visible here so you can see what happened and open the evidence when needed.",
  },
  {
    title: "Keep it connected",
    label: "Setup",
    body: "Keys, repository sync, and memory are still available, but they live below the main workflow.",
  },
];

const SECRET_MANIFEST = [
  { key: "ANTHROPIC_API_KEY", label: "Claude API" },
  { key: "CLAUDE_CODE_OAUTH_TOKEN", label: "Claude Code OAuth" },
  { key: "BANKR_LLM_KEY", label: "Bankr LLM gateway" },
  { key: "GH_GLOBAL", label: "GitHub automation" },
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram notify" },
  { key: "DISCORD_WEBHOOK_URL", label: "Discord notify" },
  { key: "SLACK_WEBHOOK_URL", label: "Slack notify" },
  { key: "RESEND_API_KEY", label: "Email notify" },
];

const AEON_PATHS = [
  { label: "Config", value: "aeon.yml" },
  { label: "Skill manifest", value: "skills.json" },
  { label: "Skills", value: "skills/<slug>/SKILL.md" },
  { label: "Memory", value: "memory/MEMORY.md" },
  { label: "Outputs", value: ".outputs/*.md" },
  { label: "Rendered outputs", value: "dashboard/outputs/*.json" },
];

const CONVERT_SCHEDULE_OPTIONS: Array<{ value: ConvertScheduleMode; label: string; detail: string }> = [
  { value: "manual", label: "Manual", detail: "Configured in AEON, off duty until you run or enable it." },
  { value: "hourly", label: "Hourly", detail: "Runs at the top of every hour." },
  { value: "daily", label: "Daily", detail: "Runs once per day at the selected time." },
  { value: "weekdays", label: "Weekdays", detail: "Runs Monday through Friday at the selected time." },
  { value: "weekly", label: "Weekly", detail: "Runs weekly on the selected day and time." },
];

const CONVERT_BRIEF_OPTIONS: Array<{ value: ConvertBriefMode; label: string; detail: string }> = [
  { value: "description", label: "Use description", detail: "Best default. AEON receives the skill's own purpose as the run brief." },
  { value: "checklist", label: "Run checklist", detail: "Ask AEON to follow the skill exactly and report completion." },
  { value: "changes", label: "Watch changes", detail: "Use for monitoring, inbox, feed, repo, or status-check skills." },
  { value: "summary", label: "Summarize output", detail: "Use when the result should be a concise reusable artifact." },
];

const CONVERT_MODEL_OPTIONS = [
  { value: "", label: "AEON default" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4-1", label: "Claude Opus 4.1" },
  { value: "bankr", label: "Bankr gateway" },
];

const CONVERT_WEEKDAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
];

const CONVERT_HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const CONVERT_MINUTES = ["00", "15", "30", "45"];

function defaultConvertDraft(): ConvertAeonDraft {
  return {
    scheduleMode: "manual",
    hour: "09",
    minute: "00",
    weekday: "1",
    onDuty: false,
    briefMode: "description",
    model: "",
  };
}

function scheduleFromConvertDraft(draft: ConvertAeonDraft) {
  if (draft.scheduleMode === "manual") return "manual";
  if (draft.scheduleMode === "hourly") return "0 * * * *";
  if (draft.scheduleMode === "daily") return `${Number(draft.minute)} ${Number(draft.hour)} * * *`;
  if (draft.scheduleMode === "weekdays") return `${Number(draft.minute)} ${Number(draft.hour)} * * 1-5`;
  return `${Number(draft.minute)} ${Number(draft.hour)} * * ${draft.weekday}`;
}

function scheduleSummaryFromConvertDraft(draft: ConvertAeonDraft) {
  const time = `${draft.hour}:${draft.minute}`;
  if (draft.scheduleMode === "manual") return "Manual dispatch";
  if (draft.scheduleMode === "hourly") return "Every hour";
  if (draft.scheduleMode === "daily") return `Daily at ${time}`;
  if (draft.scheduleMode === "weekdays") return `Weekdays at ${time}`;
  return `${CONVERT_WEEKDAYS.find((day) => day.value === draft.weekday)?.label ?? "Weekly"} at ${time}`;
}

function convertBrief(skill: BrainSkillSummary, mode: ConvertBriefMode) {
  const base = skill.description || `Run ${skill.name}.`;
  if (mode === "description") return base;
  if (mode === "checklist") return `Use the ${skill.name} skill as written. Complete the checklist, record what changed, and surface any blocker.`;
  if (mode === "changes") return `Use the ${skill.name} skill to watch for meaningful changes. Report only items that require attention.`;
  return `Use the ${skill.name} skill and produce a concise summary with outputs, decisions, and follow-up actions.`;
}

function automationStateForSkill(runtimeSkill?: RuntimeSkill & { runtimeSchedule?: RuntimeSchedule }): SkillAutomationState {
  const schedule = runtimeSkill?.runtimeSchedule;
  if (schedule) {
    if (schedule.every === "manual" || schedule.schedule === "workflow_dispatch") return "manual";
    return schedule.enabled === false ? "paused" : "on-duty";
  }
  if (runtimeSkill) return "ready";
  return "available";
}

function automationLabels(state: SkillAutomationState) {
  if (state === "available") return { statusLabel: "Shared Brain", actionLabel: "Automate with AEON" };
  if (state === "ready") return { statusLabel: "AEON skill", actionLabel: "Automate" };
  if (state === "manual") return { statusLabel: "Automated", actionLabel: "Run" };
  if (state === "on-duty") return { statusLabel: "On duty", actionLabel: "Pause" };
  return { statusLabel: "Paused", actionLabel: "Resume" };
}

async function postJson<T>(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as T & { ok?: boolean; error?: string } | null;
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `Request failed with HTTP ${response.status}.`);
  return data as T;
}

function mergeSecretStatus(current: RuntimeSecretStatus | null, next: RuntimeSecretStatus): RuntimeSecretStatus {
  if (!current) return next;
  const nextKeys = new Map(next.keys.map((secret) => [secret.key, secret]));
  const mergedKeys = current.keys.map((secret) => {
    const update = nextKeys.get(secret.key);
    if (!update) return secret;
    nextKeys.delete(secret.key);
    return {
      ...secret,
      ...update,
      isSet: secret.isSet || update.isSet,
      usedIn: update.usedIn.length ? update.usedIn : secret.usedIn,
    };
  });
  return {
    repo: next.repo || current.repo,
    githubSecretCount: next.githubSecretCount ?? current.githubSecretCount,
    keys: [...mergedKeys, ...nextKeys.values()],
  };
}

function timeLabel(value?: string) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusTone(value?: string) {
  if (value === "completed" || value === "success") return "border-emerald-300/25 bg-emerald-400/10 text-emerald-100";
  if (value === "failed" || value === "failure") return "border-rose-300/25 bg-rose-400/10 text-rose-100";
  if (value === "active" || value === "queued") return "border-amber-300/25 bg-amber-400/10 text-amber-100";
  return "border-slate-300/20 bg-slate-400/10 text-slate-100";
}

function skillSourceLabel(source?: string) {
  if (source === "shared-brain") return "Shared Brain";
  if (source === "aeon-a2a") return "Live AEON";
  if (source === "aeon.yml") return "Automation";
  if (source === "aeon-skill-folder") return "AEON";
  return source || "AEON";
}

function sourceCounts(skills: RuntimeSkill[]) {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    const label = skillSourceLabel(skill.source);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function modelCounts(skills: RuntimeSkill[], schedules: RuntimeSchedule[]) {
  const scheduleBySkill = new Map(schedules.map((schedule) => [schedule.id, schedule]));
  const counts = new Map<string, number>();
  for (const skill of skills) {
    const schedule = scheduleBySkill.get(skill.slug);
    const model = skill.model || (schedule?.metadata?.model as string | undefined) || "default";
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4);
}

function latestRunLabel(runs: RuntimeRun[]) {
  const latest = runs[0];
  if (!latest) return "No runs yet";
  return `${latest.status} · ${timeLabel(latest.createdAt)}`;
}

function aeonFleetHexPosition(index: number, columns: number) {
  const safeColumns = Math.max(1, columns);
  const row = Math.floor(index / safeColumns);
  const column = index % safeColumns;
  return {
    x: column * AEON_FLEET_HEX_X_STEP,
    y: row * AEON_FLEET_HEX_H + (column % 2) * AEON_FLEET_HEX_Y_STEP,
  };
}

function aeonFleetHoneycombSize(count: number, columns: number) {
  if (count <= 0) return { width: 0, height: 0 };
  const safeColumns = Math.max(1, columns);
  let maxX = 0;
  let maxY = 0;
  for (let index = 0; index < count; index++) {
    const point = aeonFleetHexPosition(index, safeColumns);
    maxX = Math.max(maxX, point.x + AEON_FLEET_HEX_W);
    maxY = Math.max(maxY, point.y + AEON_FLEET_HEX_H);
  }
  return { width: maxX, height: maxY };
}

function aeonWorkspaceKey(agent: AgentProfile) {
  const repo = agent.aeonRepo?.trim().replace(/\.git$/i, "").toLowerCase();
  if (repo) return `repo:${repo}`;
  const path = (agent.aeonLocalPath || agent.localDataDir || "~/.aeon")
    .trim()
    .replace(/^~(?=$|\/)/, "$home")
    .replace(/^\/users\/[^/]+(?=$|\/)/i, "$home")
    .replace(/\/+$/, "")
    .toLowerCase();
  return `path:${path || "$home/.aeon"}`;
}

function aeonModeBadgeLabel(agent: AgentProfile) {
  if (agent.aeonMode === "a2a") return "A2A";
  if (agent.aeonMode === "local") return "Local path";
  return "GitHub";
}

function aeonRepoDisplayName(agent: AgentProfile) {
  const explicit = agent.aeonRepoName?.trim();
  if (explicit) return explicit;
  const repo = agent.aeonRepo?.trim().replace(/\.git$/i, "").replace(/^https?:\/\/github\.com\//i, "");
  if (repo) return repo;
  const path = (agent.aeonLocalPath || agent.localDataDir || "").trim().replace(/\/+$/, "");
  const folder = path.split("/").filter(Boolean).pop();
  return folder || agent.name || "AEON repo";
}

function aeonNameSlug(value: string, fallback = "aeon") {
  return (value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    || fallback;
}

function nextAeonName(existingNames: Iterable<string>, baseName = "aeon") {
  const taken = new Set(Array.from(existingNames, (name) => aeonNameSlug(name)).filter(Boolean));
  const base = aeonNameSlug(baseName);
  if (!taken.has(base)) return base;
  for (let index = 2; index < 1000; index++) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function aeonProfileLabel(agent: AgentProfile, repoName: string) {
  const name = agent.name?.trim();
  return name && name !== repoName ? `Profile: ${name}` : "Repo workspace";
}

function preferAeonAgent(left: AgentProfile, right: AgentProfile) {
  const score = (agent: AgentProfile) => (
    (agent.aeonMode === "local" ? 8 : 0)
    + (agent.aeonRepoName ? 4 : 0)
    + ((agent.aeonLocalPath || agent.localDataDir)?.startsWith("~") ? 2 : 0)
    + (agent.aeonRepo ? 1 : 0)
  );
  const primary = score(right) > score(left) ? right : left;
  const secondary = primary === left ? right : left;
  return {
    ...secondary,
    ...primary,
    id: primary.id || secondary.id,
    aeonLocalPath: primary.aeonLocalPath || secondary.aeonLocalPath,
    localDataDir: primary.localDataDir || secondary.localDataDir,
    aeonRepo: primary.aeonRepo || secondary.aeonRepo,
    aeonMode: primary.aeonMode || secondary.aeonMode,
  };
}

function aeonMachineCollectorUrl(machine: MachineGroup) {
  if (machine.self) return machine.collectorUrl || "http://127.0.0.1:8787";
  if (machine.ip) return `http://${machine.ip}:8787`;
  return machine.collectorUrl;
}

function isNewAeonDeliverable(deliverable: AeonDeliverable) {
  const updatedAt = Date.parse(deliverable.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  return Date.now() - updatedAt < 7 * 24 * 60 * 60 * 1000;
}

export function AeonAutopilotPanel({ activeView, displayAgents, selectedAgentId, setAgents, sharedVault, machineGroups = [], chooseDirectoryForMachine, setActiveView, setVaultPanelMode, setSelectedAgentId, setAgentRoleModalId, setAgentSettingsPanel, updateAgentProfile, schedulerJobs = [], schedulerRunStates = {}, onSchedulerOpen, onSchedulerToggleJob, onSchedulerRunJob, onSchedulerEditJob, onSchedulerNewJob }: AeonAutopilotPanelProps) {
  const aeonAgents = useMemo(() => {
    const byWorkspace = new Map<string, AgentProfile>();
    for (const agent of displayAgents.filter((item) => item.runtime === "aeon")) {
      const key = aeonWorkspaceKey(agent);
      const existing = byWorkspace.get(key);
      byWorkspace.set(key, existing ? preferAeonAgent(existing, agent) : agent);
    }
    return [...byWorkspace.values()];
  }, [displayAgents]);
  const selectedAgent = aeonAgents.find((agent) => agent.id === selectedAgentId) ?? aeonAgents[0] ?? DEFAULT_AEON_AGENT;
  const aeonFleetCardCount = aeonAgents.length + 1;
  const aeonFleetListRef = useRef<HTMLDivElement | null>(null);
  const [aeonFleetColumns, setAeonFleetColumns] = useState(3);
  const [panelMode, setPanelMode] = useState<"fleet" | "detail">("fleet");
  const [aeonSchedulerOpen, setAeonSchedulerOpen] = useState(false);
  const [detailView, setDetailView] = useState<AeonDetailView>("overview");
  const [status, setStatus] = useState<AeonStatus | null>(null);
  const [skills, setSkills] = useState<RuntimeSkill[]>([]);
  const [allSkills, setAllSkills] = useState<BrainSkillInventory | null>(null);
  const [skillSourceView, setSkillSourceView] = useState<SkillSourceView>("aeon");
  const [skillCategoryFilter, setSkillCategoryFilter] = useState("all");
  const [skillSearch, setSkillSearch] = useState("");
  const [selectedSkillSlug, setSelectedSkillSlug] = useState("");
  const [schedules, setSchedules] = useState<RuntimeSchedule[]>([]);
  const [runs, setRuns] = useState<RuntimeRun[]>([]);
  const [outputs, setOutputs] = useState<AeonOutput[]>([]);
  const [deliverablesByAgent, setDeliverablesByAgent] = useState<Record<string, AeonDeliverable[]>>({});
  const [deliverablesLoading, setDeliverablesLoading] = useState(false);
  const [deliverablesStatus, setDeliverablesStatus] = useState("");
  const [selectedTransferDeliverable, setSelectedTransferDeliverable] = useState<AeonDeliverable | null>(null);
  const [analytics, setAnalytics] = useState<RuntimeAnalytics | null>(null);
  const [memory, setMemory] = useState<RuntimeMemorySnapshot | null>(null);
  const [secrets, setSecrets] = useState<RuntimeSecretStatus | null>(null);
  const [repoSync, setRepoSync] = useState<RuntimeRepoSyncStatus | null>(null);
  const [obsidianSyncByKey, setObsidianSyncByKey] = useState<Record<string, AeonObsidianSyncStatus>>(() => readCachedObsidianSyncStatuses());
  const [githubReadyByKey, setGithubReadyByKey] = useState<Record<string, boolean>>(() => readCachedGithubReady());
  // Workspace key whose status/secret refresh has actually finished — until the
  // current workspace matches, the overview falls back to the cached verdict.
  const [connectionLoadedKey, setConnectionLoadedKey] = useState("");
  const [selectedRunLog, setSelectedRunLog] = useState<RuntimeRunLog | null>(null);
  const [runLogLoading, setRunLogLoading] = useState("");
  const [skillDraft, setSkillDraft] = useState({ schedule: "", var: "", model: "" });
  const [convertSkill, setConvertSkill] = useState<BrainSkillSummary | null>(null);
  const [convertDraft, setConvertDraft] = useState<ConvertAeonDraft>(() => defaultConvertDraft());
  const [importOpen, setImportOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<UploadedSkillFile[]>([]);
  const [importName, setImportName] = useState("");
  const [cloneRepoOpen, setCloneRepoOpen] = useState(false);
  const [cloneRepoUrl, setCloneRepoUrl] = useState("");
  const [createRepoChoiceOpen, setCreateRepoChoiceOpen] = useState(false);
  const [createRepoChoiceView, setCreateRepoChoiceView] = useState<"choice" | "official" | "created" | "cloning">("choice");
  const [cloneSteps, setCloneSteps] = useState<{ key: string; label: string; Icon: LucideIcon }[]>([]);
  const [cloneStepIndex, setCloneStepIndex] = useState(0);
  const cloneRunIdRef = useRef(0);
  const [officialCloneName, setOfficialCloneName] = useState("aeon");
  const [officialCloneLocation, setOfficialCloneLocation] = useState("~/Documents");
  const [officialCloneFork, setOfficialCloneFork] = useState(true);
  const [officialClonePrivateRepo, setOfficialClonePrivateRepo] = useState(true);
  const [officialCloneInjectSecrets, setOfficialCloneInjectSecrets] = useState(true);
  const [officialCloneCache, setOfficialCloneCache] = useState(true);
  const [cloneCacheStatus, setCloneCacheStatus] = useState<{ exists: boolean; behind: number; path?: string } | null>(null);
  const [createdAeonAgentId, setCreatedAeonAgentId] = useState("");
  const [createRepoOpen, setCreateRepoOpen] = useState(false);
  const [githubRepoModalOpen, setGithubRepoModalOpen] = useState(false);
  const [githubRepoModalView, setGithubRepoModalView] = useState<"select" | "create">("select");
  const [githubRepoAdvancedOpen, setGithubRepoAdvancedOpen] = useState(false);
  const [githubRepoLoading, setGithubRepoLoading] = useState(false);
  const [githubRepoBusy, setGithubRepoBusy] = useState("");
  const [githubRepoError, setGithubRepoError] = useState("");
  const [githubRepoOptions, setGithubRepoOptions] = useState<AeonGithubRepoOption[]>([]);
  const [githubRepoCreateDraft, setGithubRepoCreateDraft] = useState({
    name: "",
    owner: "",
    description: "",
    visibility: "private",
    autoPush: true,
  });
  const [repoRenameState, setRepoRenameState] = useState({ agentId: "", editing: false, draft: "" });
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [message, setMessage] = useState("");
  const actionSuccessTimerRef = useRef<number | null>(null);
  const obsidianSyncCacheKey = useMemo(() => `${OBSIDIAN_SYNC_CACHE_PREFIX}${aeonWorkspaceKey(selectedAgent)}`, [selectedAgent]);
  const obsidianSync = obsidianSyncByKey[obsidianSyncCacheKey] ?? null;
  const selectedRepoName = aeonRepoDisplayName(selectedAgent);
  const repoRenameEditing = repoRenameState.agentId === selectedAgent.id ? repoRenameState.editing : false;
  const repoRenameDraft = repoRenameState.agentId === selectedAgent.id ? repoRenameState.draft : selectedRepoName;
  const obsidianMirrorStatus = obsidianSync
    ? obsidianSync.running
      ? `Running${obsidianSync.pid ? ` · ${obsidianSync.pid}` : ""}`
      : obsidianSync.installed === false ? "Unison missing" : "Stopped"
    : "Checking";
  const obsidianMirrorRunning = obsidianSync ? Boolean(obsidianSync.running) : null;
  const openAeonScheduler = useCallback(() => {
    setAeonSchedulerOpen(true);
    onSchedulerOpen?.();
  }, [onSchedulerOpen]);
  const createAeonAutomation = useCallback(() => {
    openAeonScheduler();
    onSchedulerNewJob?.(selectedAgent.id);
  }, [onSchedulerNewJob, openAeonScheduler, selectedAgent.id]);
  const updateObsidianSync = useCallback((status: AeonObsidianSyncStatus | null) => {
    setObsidianSyncByKey((current) => {
      if (!status) {
        const next = { ...current };
        delete next[obsidianSyncCacheKey];
        return next;
      }
      return { ...current, [obsidianSyncCacheKey]: status };
    });
    if (typeof window === "undefined") return;
    try {
      if (status) window.localStorage.setItem(obsidianSyncCacheKey, JSON.stringify(status));
      else window.localStorage.removeItem(obsidianSyncCacheKey);
    } catch {
      // localStorage is best-effort UI hydration only.
    }
  }, [obsidianSyncCacheKey]);

  const writeGithubReady = useCallback((workspaceKey: string, ready: boolean) => {
    setGithubReadyByKey((current) => current[workspaceKey] === ready ? current : { ...current, [workspaceKey]: ready });
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(`${AEON_GITHUB_READY_CACHE_PREFIX}${workspaceKey}`, ready ? "1" : "0");
    } catch {
      // localStorage is a best-effort paint hint only.
    }
  }, []);

  const showActionSuccess = useCallback((key: string) => {
    if (actionSuccessTimerRef.current) {
      window.clearTimeout(actionSuccessTimerRef.current);
    }
    setActionSuccess(key);
    actionSuccessTimerRef.current = window.setTimeout(() => {
      setActionSuccess((current) => current === key ? "" : current);
      actionSuccessTimerRef.current = null;
    }, 2200);
  }, []);

  const loadDeliverablesForAgent = useCallback(async (agent: AgentProfile) => {
    const nativeData = await listNativeAeonDeliverables({ agent, vaultPath: sharedVault.vaultPath });
    if (nativeData?.ok) return { deliverables: nativeData.deliverables ?? [] };
    if (nativeData?.error) throw new Error(nativeData.error);
    return postJson<{ deliverables?: AeonDeliverable[] }>("/api/runtimes/aeon/deliverables", {
      action: "list",
      agent,
      vaultPath: sharedVault.vaultPath,
    });
  }, [sharedVault.vaultPath]);

  const loadOutputsForAgent = useCallback(async (agent: AgentProfile) => {
    const nativeData = await listNativeAeonOutputs({ agent });
    if (nativeData?.ok) return { outputs: nativeData.outputs ?? [] };
    if (nativeData?.error) throw new Error(nativeData.error);
    return postJson<{ outputs?: AeonOutput[] }>("/api/runtimes/aeon/outputs", { agent });
  }, []);

  const loadSchedulesForAgent = useCallback(async (agent: AgentProfile) => {
    const nativeData = await listNativeAeonSchedules({ agent });
    if (nativeData?.ok) return { schedules: nativeData.schedules ?? [] };
    if (nativeData?.error) throw new Error(nativeData.error);
    return postJson<{ schedules?: RuntimeSchedule[] }>("/api/runtimes/aeon/schedules", { agent });
  }, []);

  const loadMemoryForAgent = useCallback(async (agent: AgentProfile) => {
    const nativeData = await getNativeAeonMemory({ agent });
    if (nativeData?.ok) return { memory: nativeData.memory ?? null };
    if (nativeData?.error) throw new Error(nativeData.error);
    return postJson<{ memory?: RuntimeMemorySnapshot }>("/api/runtimes/aeon/memory", { agent });
  }, []);

  const loadRunsForAgent = useCallback(async (agent: AgentProfile) => {
    const nativeData = await listNativeAeonRuns({ agent });
    if (nativeData?.ok) return { runs: nativeData.runs ?? [] };
    if (nativeData?.error) throw new Error(nativeData.error);
    return postJson<{ runs?: RuntimeRun[] }>("/api/runtimes/aeon/runs", { agent });
  }, []);

  const loadRepoSyncForAgent = useCallback(async (agent: AgentProfile) => {
    const nativeData = await nativeAeonRepoSync({ agent, action: "status" });
    if (nativeData?.ok) return { status: nativeData.status ?? null };
    if (nativeData?.error) throw new Error(nativeData.error);
    return postJson<{ status?: RuntimeRepoSyncStatus }>("/api/runtimes/aeon/repo/sync", { agent, action: "status" });
  }, []);

  const loadSharedBrainSkills = useCallback(async () => {
    const nativeData = await getNativeBrainSkillInventory({
      vaultPath: sharedVault.vaultPath || undefined,
      sharedOnly: true,
    });
    if (nativeData?.ok) return nativeData;
    return fetch(`/api/obsidian/skills?shared=1&vaultPath=${encodeURIComponent(sharedVault.vaultPath || "")}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .catch(() => null) as Promise<BrainSkillInventory | null>;
  }, [sharedVault.vaultPath]);

  const refreshDeliverablesForAgent = useCallback(async (agent: AgentProfile, options: { quiet?: boolean } = {}) => {
    if (!options.quiet) {
      setDeliverablesLoading(true);
      setDeliverablesStatus("");
    }
    try {
      const data = await loadDeliverablesForAgent(agent);
      setDeliverablesByAgent((current) => ({ ...current, [agent.id]: data.deliverables ?? [] }));
      if (!options.quiet) setDeliverablesStatus("");
    } catch (error) {
      if (!options.quiet) setDeliverablesStatus(error instanceof Error ? error.message : "Could not load AEON deliverables.");
    } finally {
      if (!options.quiet) setDeliverablesLoading(false);
    }
  }, [loadDeliverablesForAgent]);

  useEffect(() => () => {
    if (actionSuccessTimerRef.current) {
      window.clearTimeout(actionSuccessTimerRef.current);
    }
  }, []);
  const aeonRepoMachines = useMemo<KanbanMachineTarget[]>(() => {
    const targets = machineGroups
      .filter((machine) => machine.key !== "unassigned" && machine.collector === "ready")
      .map((machine) => ({
        key: machine.key,
        name: machine.self ? `${machine.name} (This Mac)` : machine.name,
        collectorUrl: aeonMachineCollectorUrl(machine),
      }));
    return targets.length ? targets : [{ key: "local", name: "This Mac", collectorUrl: "http://127.0.0.1" }];
  }, [machineGroups]);

  useLayoutEffect(() => {
    if (activeView !== "aeon" || panelMode !== "fleet") return;
    const container = aeonFleetListRef.current;
    if (!container) return;
    const updateColumns = () => {
      const width = container.clientWidth;
      const nextColumns = Math.max(1, Math.min(
        aeonFleetCardCount,
        Math.floor((width - AEON_FLEET_HEX_W) / AEON_FLEET_HEX_X_STEP) + 1,
      ));
      setAeonFleetColumns(nextColumns);
    };
    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(container);
    window.addEventListener("resize", updateColumns);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateColumns);
    };
  }, [activeView, aeonFleetCardCount, panelMode]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage("");
    const agent = selectedAgent;
    const body = { agent };
    const vaultBody = { ...body, vaultPath: sharedVault.vaultPath };
    // Each request commits its own slice of state the moment it resolves, so the
    // Ready Check and the other cards fill in progressively instead of blocking on
    // the slowest call in the batch (gh run list, gh secret list, the env script).
    // A failure on any one request surfaces a message but never holds back the rest.
    const fail = (error: unknown) => {
      setMessage((current) => current || (error instanceof Error ? error.message : "Aeon refresh failed."));
    };
    const track = <T,>(request: Promise<T>, apply: (value: T) => void) => request.then(apply).catch(fail);
    // Capture the GitHub-relevant slices so we can cache the connected verdict
    // for the next paint once everything settles.
    let resolvedRepo = agent.aeonRepo || "";
    let resolvedSecretReady = false;
    await Promise.allSettled([
      track(postJson<AeonStatus>("/api/runtimes/aeon/status", body), (data) => { resolvedRepo = data?.status?.repo || resolvedRepo; setStatus(data); }),
      track(postJson<{ skills?: RuntimeSkill[] }>("/api/runtimes/aeon/skills", vaultBody), (data) => setSkills(data.skills ?? [])),
      track(loadSchedulesForAgent(agent), (data) => setSchedules(data.schedules ?? [])),
      track(loadRunsForAgent(agent), (data) => setRuns(data.runs ?? [])),
      track(loadOutputsForAgent(agent), (data) => setOutputs(data.outputs ?? [])),
      track(loadDeliverablesForAgent(agent), (data) => {
        setDeliverablesByAgent((current) => ({ ...current, [agent.id]: data.deliverables ?? [] }));
      }),
      track(postJson<{ analytics?: RuntimeAnalytics }>("/api/runtimes/aeon/analytics", vaultBody), (data) => setAnalytics(data.analytics ?? null)),
      track(loadMemoryForAgent(agent), (data) => setMemory(data.memory ?? null)),
      track(postJson<{ secrets?: RuntimeSecretStatus }>("/api/runtimes/aeon/secrets/status", vaultBody), (data) => {
        const secret = data.secrets?.keys?.find((item) => item.key === "GH_GLOBAL");
        resolvedSecretReady = Boolean(secret?.isSet || secret?.availableInSharedEnv || secret?.availableLocally);
        setSecrets(data.secrets ?? null);
      }),
      track(loadRepoSyncForAgent(agent), (data) => setRepoSync(data.status ?? null)),
      track(
        postJson<AeonObsidianSyncStatus>("/api/runtimes/aeon/obsidian-sync", { ...vaultBody, action: "status" }).catch((error) => ({
          ok: false,
          installed: false,
          running: false,
          error: error instanceof Error ? error.message : "AEON Obsidian sync status failed.",
        } as AeonObsidianSyncStatus)),
        (next) => updateObsidianSync(next ?? null),
      ),
      // The Ready Check only reads the shared-brain skill list, so `?shared=1` skips
      // the per-provider directory scan + remote-provider fetch the full inventory runs.
      track(
        loadSharedBrainSkills(),
        (next) => { if (next?.ok) setAllSkills(next as BrainSkillInventory); },
      ),
    ]);
    setLoading(false);
    // Status + secrets have settled for this workspace, so the overview can now
    // trust the live githubPowered verdict instead of the cached hint — and we
    // remember it so the next paint skips the loading placeholder entirely.
    const workspaceKey = aeonWorkspaceKey(agent);
    writeGithubReady(workspaceKey, Boolean(resolvedRepo && resolvedSecretReady));
    setConnectionLoadedKey(workspaceKey);
  }, [loadDeliverablesForAgent, loadMemoryForAgent, loadOutputsForAgent, loadRepoSyncForAgent, loadRunsForAgent, loadSchedulesForAgent, loadSharedBrainSkills, selectedAgent, sharedVault.vaultPath, updateObsidianSync, writeGithubReady]);

  const refreshFastSecrets = useCallback(async () => {
    try {
      const data = await postJson<{ secrets?: RuntimeSecretStatus }>("/api/runtimes/aeon/secrets/status", {
        agent: selectedAgent,
        vaultPath: sharedVault.vaultPath,
        fast: true,
      });
      if (data.secrets) {
        setSecrets((current) => mergeSecretStatus(current, data.secrets as RuntimeSecretStatus));
      }
    } catch {
      // Full refresh still reports secret-status failures.
    }
  }, [selectedAgent, sharedVault.vaultPath]);

  // Latest-value ref so the view-entry effect can call refreshFastSecrets without
  // listing it as a dependency (it changes whenever the selected agent changes,
  // which would otherwise re-run that effect on every cell click).
  const refreshFastSecretsRef = useRef(refreshFastSecrets);
  useEffect(() => {
    refreshFastSecretsRef.current = refreshFastSecrets;
  }, [refreshFastSecrets]);

  useEffect(() => () => {
    cloneRunIdRef.current += 1; // cancel any in-flight clone animation on unmount
  }, []);

  useEffect(() => {
    if (activeView !== "aeon") return;
    const params = new URLSearchParams(window.location.search);
    const fromGithubOAuth = params.get("githubOAuth") === "connected";
    const requestedPanel = params.get("aeonPanel");
    if (fromGithubOAuth || requestedPanel === "detail") {
      const tab = params.get("aeonTab");
      const handle = window.setTimeout(() => {
        setAeonSchedulerOpen(false);
        setPanelMode("detail");
        setDetailView(tab === "work" || tab === "activity" || tab === "deliverables" || tab === "settings" ? tab : "overview");
        if (fromGithubOAuth) {
          setMessage("GitHub connected. GH_GLOBAL is available to AEON from shared env.");
          void refreshFastSecretsRef.current();
        }
      }, 0);
      return () => window.clearTimeout(handle);
    }
    const handle = window.setTimeout(() => { setAeonSchedulerOpen(false); setPanelMode("fleet"); }, 0);
    return () => window.clearTimeout(handle);
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "aeon") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("githubOAuth") === "connected" || params.get("aeonPanel")) return;
    const pendingDetailAgentId = window.sessionStorage.getItem("hivemindos.aeon.openDetailAgentId");
    if (pendingDetailAgentId) {
      window.sessionStorage.removeItem("hivemindos.aeon.openDetailAgentId");
      const handle = window.setTimeout(() => {
        setSelectedAgentId(pendingDetailAgentId);
        setPanelMode("detail");
      }, 0);
      return () => window.clearTimeout(handle);
    }
  }, [activeView, selectedAgentId, setSelectedAgentId]);

  useEffect(() => {
    if (activeView !== "aeon" || panelMode !== "detail") return;
    const handle = window.setTimeout(() => {
      void refreshFastSecrets();
      void refresh();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [activeView, panelMode, refresh, refreshFastSecrets]);

  useEffect(() => {
    if (activeView !== "aeon" || aeonAgents.length === 0) return;
    const handle = window.setTimeout(() => {
      for (const agent of aeonAgents) {
        void refreshDeliverablesForAgent(agent, { quiet: true });
      }
    }, 0);
    return () => window.clearTimeout(handle);
  }, [activeView, aeonAgents, refreshDeliverablesForAgent]);

  function upsertAeonWorkspaceAgent(agent: AgentProfile, options: { openDetail?: boolean } = {}) {
    let selectedId = agent.id;
    setAgents((current) => {
      const existingIndex = current.findIndex((item) => (
        item.id === agent.id
        || (item.runtime === "aeon" && agent.runtime === "aeon" && Boolean(item.aeonLocalPath || item.localDataDir) && (item.aeonLocalPath || item.localDataDir) === (agent.aeonLocalPath || agent.localDataDir))
        || (item.runtime === "aeon" && agent.runtime === "aeon" && Boolean(item.aeonRepo) && item.aeonRepo === agent.aeonRepo)
      ));
      if (existingIndex === -1) return [...current, agent];
      selectedId = current[existingIndex]?.id || agent.id;
      return current.map((item, index) => index === existingIndex ? { ...item, ...agent, id: selectedId } : item);
    });
    setSelectedAgentId(selectedId);
    if (options.openDetail !== false) setPanelMode("detail");
  }

  async function runWorkspaceAction(action: "initialize" | "link" | "clone", input: Record<string, string> = {}, options: { openDetail?: boolean } = {}) {
    setActionBusy(`workspace:${action}`);
    setMessage("");
    try {
      const nativeData = await prepareNativeAeonWorkspace({ action, ...input });
      if (nativeData?.error) throw new Error(nativeData.error);
      const data = nativeData?.ok
        ? nativeData
        : await postJson<{ agent?: AgentProfile; root?: string }>("/api/runtimes/aeon/workspaces", {
          action,
          ...input,
        });
      if (!data.agent) throw new Error("AEON workspace was prepared, but no profile was returned.");
      upsertAeonWorkspaceAgent(data.agent, options);
      const mirror = await postJson<AeonObsidianSyncStatus>("/api/runtimes/aeon/obsidian-sync", {
        agent: data.agent,
        vaultPath: sharedVault.vaultPath,
        action: "start",
      }).catch((error) => ({
        ok: false,
        installed: false,
        running: false,
        error: error instanceof Error ? error.message : "AEON Obsidian mirror did not start.",
      }));
      updateObsidianSync(mirror);
      setCloneRepoOpen(false);
      setCloneRepoUrl("");
      setCreateRepoOpen(false);
      setMessage(mirror.running
        ? `Linked AEON repo workspace at ${data.root || data.agent.aeonLocalPath || data.agent.localDataDir}. Obsidian mirror is running.`
        : `Linked AEON repo workspace at ${data.root || data.agent.aeonLocalPath || data.agent.localDataDir}. ${mirror.error || "Obsidian mirror is not running yet."}`);
      return data.agent;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare AEON workspace.");
      return null;
    } finally {
      setActionBusy("");
    }
  }

  async function deleteAeonWorkspace(action: "delete-git" | "delete-local") {
    const root = status?.status?.root || selectedAgent.aeonLocalPath || selectedAgent.localDataDir || "";
    const label = action === "delete-local" ? "local AEON repo folder" : "local .git metadata";
    if (typeof window !== "undefined" && !window.confirm(`Delete the ${label} at ${root || "this workspace"}? This cannot be undone from HivemindOS.`)) return;
    setActionBusy(`workspace:${action}`);
    setMessage("");
    try {
      const data = await postJson<{ agent?: AgentProfile; root?: string; deleted?: boolean; message?: string }>("/api/runtimes/aeon/workspaces", {
        action,
        agent: selectedAgent,
      });
      updateObsidianSync(null);
      if (action === "delete-local" || data.deleted) {
        const deletedKey = aeonWorkspaceKey(selectedAgent);
        const nextSelectedAgent = displayAgents.find((agent) => agent.runtime === "aeon" && agent.id !== selectedAgent.id && aeonWorkspaceKey(agent) !== deletedKey);
        setAgents((current) => current.filter((agent) => agent.id !== selectedAgent.id && aeonWorkspaceKey(agent) !== deletedKey));
        setSelectedAgentId(nextSelectedAgent?.id || "");
        setPanelMode("fleet");
        setMessage(data.message || "Deleted the local AEON workspace.");
      } else if (data.agent) {
        const nextAgent = { ...selectedAgent, ...data.agent, id: selectedAgent.id, aeonRepo: "", aeonMode: "local" as const };
        setAgents((current) => current.map((agent) => agent.id === selectedAgent.id ? nextAgent : agent));
        updateAgentProfile(selectedAgent.id, { aeonRepo: "", aeonMode: "local" });
        setMessage(data.message || "Removed Git metadata from this AEON workspace.");
        await refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not delete ${label}.`);
    } finally {
      setActionBusy("");
    }
  }

  async function renameSelectedWorkspace(nextName: string) {
    setActionBusy("workspace:rename");
    setMessage("");
    try {
      const data = await postJson<{ agent?: AgentProfile; root?: string }>("/api/runtimes/aeon/workspaces", {
        action: "rename",
        agent: selectedAgent,
        name: nextName,
      });
      if (!data.agent) throw new Error("AEON workspace was renamed, but no profile was returned.");
      const nextAgent = { ...selectedAgent, ...data.agent, id: selectedAgent.id };
      setAgents((current) => {
        const existing = current.some((agent) => agent.id === selectedAgent.id);
        return existing
          ? current.map((agent) => agent.id === selectedAgent.id ? nextAgent : agent)
          : [...current, nextAgent];
      });
      setSelectedAgentId(selectedAgent.id);
      setRepoRenameState({ agentId: selectedAgent.id, editing: false, draft: nextAgent.aeonRepoName || nextAgent.name });
      updateObsidianSync(null);
      setMessage(`Renamed AEON repo folder to ${nextAgent.aeonRepoName || nextAgent.name}${data.root ? ` at ${data.root}` : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not rename AEON repo folder.");
    } finally {
      setActionBusy("");
    }
  }

  async function createAeonWorkspace(value: CreateFolderRepoValue) {
    await runWorkspaceAction("initialize", {
      name: value.name,
      path: value.fullPath,
      machineName: value.machine.name,
      machineKey: value.machine.key,
      collectorUrl: value.machine.collectorUrl || "",
    });
  }

  async function browseCreateRepoLocation(machine: KanbanMachineTarget, onChoose: (directory: LinkedDirectory) => void) {
    if (chooseDirectoryForMachine) {
      await chooseDirectoryForMachine(machine, onChoose);
      return;
    }
    const nativeResult = await openNativeDirectory({
      currentPath: "~/.aeon-repos",
      prompt: "Choose a parent folder for the new AEON repo:",
    });
    const nativePath = nativeResult?.path?.trim();
    if (nativePath) {
      onChoose({
        id: `${nativePath}-${crypto.randomUUID()}`,
        name: nativePath.replace(/\/+$/, "").split("/").filter(Boolean).at(-1) || nativePath,
        path: nativePath,
        machineName: machine.name,
        machineKey: machine.key,
        lastUsedAt: Date.now(),
      });
      return;
    }
    if (nativeResult?.cancelled) return;
    const response = await fetch("/api/agents/browse-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPath: "~/.aeon-repos", prompt: "Choose a parent folder for the new AEON repo:" }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { path?: string } | null;
    const path = data?.path?.trim();
    if (!response?.ok || !path) return;
    onChoose({
      id: `${path}-${crypto.randomUUID()}`,
      name: path.replace(/\/+$/, "").split("/").filter(Boolean).at(-1) || path,
      path,
      machineName: machine.name,
      machineKey: machine.key,
      lastUsedAt: Date.now(),
    });
  }

  async function browseAeonWorkspace() {
    setActionBusy("workspace:browse");
    setMessage("");
    try {
      const nativeResult = await openNativeDirectory({
        currentPath: selectedAgent.aeonLocalPath || selectedAgent.localDataDir || "~",
        prompt: "Choose an existing AEON repo folder:",
      });
      if (nativeResult?.path) {
        await runWorkspaceAction("link", { path: nativeResult.path });
        return;
      }
      if (nativeResult?.cancelled) return;
      const response = await fetch("/api/agents/browse-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPath: selectedAgent.aeonLocalPath || selectedAgent.localDataDir || "~", prompt: "Choose an existing AEON repo folder:" }),
      });
      const data = await response.json().catch(() => null) as { path?: string; cancelled?: boolean; error?: string } | null;
      if (data?.path) {
        await runWorkspaceAction("link", { path: data.path });
      } else if (!data?.cancelled) {
        setMessage(data?.error ?? "Choose an Aeon Agent Repo folder.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not browse for an AEON repo.");
    } finally {
      setActionBusy("");
    }
  }

  async function runScheduleAction(action: "run-now" | "enable" | "disable", jobId: string) {
    setActionBusy(`${action}:${jobId}`);
    setMessage("");
    try {
      const data = await postJson<{ result?: { autoPushed?: boolean } }>("/api/runtimes/aeon/schedules/action", { agent: selectedAgent, action, jobId });
      setMessage(action === "run-now" ? `${data.result?.autoPushed ? "Saved to GitHub, then s" : "S"}tarted ${jobId}.` : `${action === "enable" ? "Enabled" : "Disabled"} ${jobId}.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Aeon action failed.");
    } finally {
      setActionBusy("");
    }
  }

  async function syncSharedSkills() {
    setActionBusy("sync-skills");
    setMessage("");
    try {
      const data = await postJson<{ result?: { synced?: unknown[]; skipped?: unknown[] } }>("/api/runtimes/aeon/skills/sync", {
        agent: selectedAgent,
        vaultPath: sharedVault.vaultPath,
      });
      const synced = data.result?.synced?.length ?? 0;
      const skipped = data.result?.skipped?.length ?? 0;
      setMessage(`Synced ${synced} shared skill${synced === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Aeon skill sync failed.");
    } finally {
      setActionBusy("");
    }
  }

  async function syncSecretsForAgent(agent: AgentProfile, options: { quiet?: boolean; all?: boolean } = {}) {
    const all = options.all === true;
    const busyKey = all ? "sync-all-secrets" : "sync-secrets";
    if (!options.quiet) setActionBusy(busyKey);
    setActionSuccess("");
    if (!options.quiet) setMessage("");
    try {
      const keysToSync = secrets?.keys?.map((secret) => secret.key);
      const data = await postJson<{ result?: { synced?: unknown[]; skipped?: unknown[]; repo?: string; githubSecretCount?: number } }>("/api/runtimes/aeon/env/sync",
        all
          ? { agent, all: true }
          : { agent, keys: keysToSync?.length ? keysToSync : DEFAULT_SECRET_KEYS });
      const synced = data.result?.synced?.length ?? 0;
      const skipped = data.result?.skipped?.length ?? 0;
      const syncedSecretCount = data.result?.githubSecretCount;
      const noun = all ? "shared env key" : "secret";
      const resultMessage = `Synced ${synced} ${noun}${synced === 1 ? "" : "s"} to ${data.result?.repo || agent.aeonRepo || "Aeon"}${skipped ? `, skipped ${skipped} missing value${skipped === 1 ? "" : "s"}` : ""}.`;
      if (!options.quiet) setMessage(resultMessage);
      if (typeof syncedSecretCount === "number") {
        setSecrets((current) => current ? { ...current, githubSecretCount: syncedSecretCount } : current);
      }
      if (synced > 0 && skipped === 0) showActionSuccess(busyKey);
      void refreshFastSecrets();
      return { message: resultMessage, synced, skipped };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Aeon secret sync failed.";
      if (!options.quiet) setMessage(message);
      if (!options.quiet) return null;
      throw error;
    } finally {
      if (!options.quiet) setActionBusy("");
    }
  }

  async function syncSecrets() {
    await syncSecretsForAgent(selectedAgent);
  }

  async function syncAllSecrets() {
    await syncSecretsForAgent(selectedAgent, { all: true });
  }

  async function loadGithubRepos() {
    setGithubRepoLoading(true);
    setGithubRepoError("");
    try {
      const response = await fetch("/api/runtimes/aeon/github-repos", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { ok?: boolean; repos?: AeonGithubRepoOption[]; error?: string } | null;
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Could not load GitHub repos.");
      setGithubRepoOptions(data?.repos ?? []);
    } catch (error) {
      setGithubRepoError(error instanceof Error ? error.message : "Could not load GitHub repos.");
    } finally {
      setGithubRepoLoading(false);
    }
  }

  async function connectGithubRepo(repo: AeonGithubRepoOption | string) {
    const fullName = typeof repo === "string" ? repo : repo.fullName;
    const branch = typeof repo === "string" ? "main" : repo.defaultBranch || "main";
    setGithubRepoBusy(`connect:${fullName}`);
    setGithubRepoError("");
    try {
      const response = await fetch("/api/runtimes/aeon/github-repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link", agent: selectedAgent, repo: fullName }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; repo?: string; branch?: string; error?: string } | null;
      if (!response.ok || data?.ok === false || !data?.repo) throw new Error(data?.error || "Could not connect GitHub repo.");
      const nextRepo = data.repo;
      const nextBranch = data.branch || branch;
      updateAgentProfile(selectedAgent.id, { aeonRepo: nextRepo, aeonBranch: nextBranch, aeonMode: "github" });
      setStatus((current) => current ? { ...current, status: { ...current.status, repo: nextRepo } } : current);
      setRepoSync((current) => current ? { ...current, repo: nextRepo, branch: nextBranch } : current);
      setGithubRepoModalOpen(false);
      setMessage(`Configured GitHub repo ${nextRepo}.`);
      void refreshFastSecrets();
    } catch (error) {
      setGithubRepoError(error instanceof Error ? error.message : "Could not connect GitHub repo.");
    } finally {
      setGithubRepoBusy("");
    }
  }

  async function createGithubRepo() {
    const name = githubRepoCreateDraft.name.trim();
    if (!name) return;
    setGithubRepoBusy("create");
    setGithubRepoError("");
    try {
      const response = await fetch("/api/runtimes/aeon/github-repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          agent: selectedAgent,
          name,
          owner: githubRepoCreateDraft.owner,
          description: githubRepoCreateDraft.description,
          visibility: githubRepoCreateDraft.visibility,
          autoPush: githubRepoCreateDraft.autoPush,
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; repo?: string; branch?: string; pushError?: string; error?: string } | null;
      if (!response.ok || data?.ok === false || !data?.repo) throw new Error(data?.error || "Could not create GitHub repo.");
      const nextRepo = data.repo;
      const nextBranch = data.branch || "main";
      updateAgentProfile(selectedAgent.id, { aeonRepo: nextRepo, aeonBranch: nextBranch, aeonMode: "github" });
      setStatus((current) => current ? { ...current, status: { ...current.status, repo: nextRepo } } : current);
      setRepoSync((current) => current ? { ...current, repo: nextRepo, branch: nextBranch } : current);
      setGithubRepoModalOpen(false);
      setMessage(data.pushError ? `Created and linked ${nextRepo}. Push can run later: ${data.pushError}` : `Created and linked ${nextRepo}.`);
      void refreshFastSecrets();
    } catch (error) {
      setGithubRepoError(error instanceof Error ? error.message : "Could not create GitHub repo.");
    } finally {
      setGithubRepoBusy("");
    }
  }

  async function loadRunLog(run: RuntimeRun) {
    setRunLogLoading(run.id);
    setMessage("");
    try {
      const nativeData = await getNativeAeonRunLog({ agent: selectedAgent, runId: run.id });
      if (nativeData?.error) throw new Error(nativeData.error);
      const data = nativeData?.ok
        ? nativeData
        : await postJson<{ log?: RuntimeRunLog }>("/api/runtimes/aeon/runs/logs", { agent: selectedAgent, runId: run.id });
      setSelectedRunLog(data.log ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Aeon run logs.");
    } finally {
      setRunLogLoading("");
    }
  }

  async function updateSelectedSkill(action: "schedule" | "var" | "model", value: string) {
    const targetSlug = selectedSkill?.slug || selectedSkillSlug;
    if (!targetSlug) return;
    setActionBusy(`${action}:${targetSlug}`);
    setMessage("");
    try {
      await postJson("/api/runtimes/aeon/skills/config", { agent: selectedAgent, skill: targetSlug, action, value });
      setMessage(`Updated ${targetSlug} ${action}.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update Aeon skill.");
    } finally {
      setActionBusy("");
    }
  }

  function openConvertModal(skill: BrainSkillSummary) {
    setConvertSkill(skill);
    setConvertDraft(defaultConvertDraft());
    setMessage("");
  }

  async function convertSharedSkillToAeon() {
    if (!convertSkill) return;
    const target = convertSkill;
    const schedule = scheduleFromConvertDraft(convertDraft);
    const brief = convertBrief(target, convertDraft.briefMode);
    setActionBusy(`convert:${target.slug}`);
    setMessage("");
    try {
      await postJson<{ result?: { synced?: unknown[]; skipped?: unknown[] } }>("/api/runtimes/aeon/skills/sync", {
        agent: selectedAgent,
        vaultPath: sharedVault.vaultPath,
      });
      await postJson("/api/runtimes/aeon/skills/config", { agent: selectedAgent, skill: target.slug, action: "schedule", value: schedule });
      await postJson("/api/runtimes/aeon/skills/config", { agent: selectedAgent, skill: target.slug, action: "var", value: brief });
      await postJson("/api/runtimes/aeon/skills/config", { agent: selectedAgent, skill: target.slug, action: "model", value: convertDraft.model });
      await postJson("/api/runtimes/aeon/skills/config", { agent: selectedAgent, skill: target.slug, action: convertDraft.onDuty ? "enable" : "disable", value: convertDraft.onDuty });
      setConvertSkill(null);
      setSkillSourceView("aeon");
      setSelectedSkillSlug(target.slug);
      setSkillDraft({ schedule, var: brief, model: convertDraft.model });
      setMessage(`Converted ${target.name} to AEON as ${convertDraft.onDuty ? "on duty" : "off duty"} · ${scheduleSummaryFromConvertDraft(convertDraft)}.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not convert shared skill to AEON.");
    } finally {
      setActionBusy("");
    }
  }

  async function automateAeonSkill(skill: RuntimeSkill) {
    setActionBusy(`automate:${skill.slug}`);
    setMessage("");
    try {
      const data = await postJson<{ result?: { automationYaml?: string } }>("/api/runtimes/aeon/skills/config", {
        agent: selectedAgent,
        skill: skill.slug,
        action: "automate",
        value: skill.description || "",
      });
      setSelectedSkillSlug(skill.slug);
      setSkillDraft({ schedule: "manual", var: skill.description || "", model: "" });
      const yaml = data.result?.automationYaml || skill.automationYaml;
      setMessage(yaml ? `Automated ${skill.name} from ${yaml}. It is off duty until you run or enable it.` : `Automated ${skill.name}. It is off duty until you run or enable it.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not automate AEON skill.");
    } finally {
      setActionBusy("");
    }
  }

  async function runRepoAction(action: "pull" | "push") {
    setActionBusy(`repo:${action}`);
    setMessage("");
    try {
      const nativeData = await nativeAeonRepoSync({ agent: selectedAgent, action });
      if (nativeData?.error) throw new Error(nativeData.error);
      const data = nativeData?.ok
        ? nativeData
        : await postJson<{ status?: RuntimeRepoSyncStatus; message?: string }>("/api/runtimes/aeon/repo/sync", { agent: selectedAgent, action });
      setRepoSync(data.status ?? null);
      setMessage(data.message || `Aeon repo ${action} complete.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Aeon repo ${action} failed.`);
    } finally {
      setActionBusy("");
    }
  }

  async function runObsidianSyncAction(action: "start" | "stop" | "once") {
    setActionBusy(`obsidian-sync:${action}`);
    setMessage("");
    try {
      const data = await postJson<AeonObsidianSyncStatus>("/api/runtimes/aeon/obsidian-sync", {
        agent: selectedAgent,
        vaultPath: sharedVault.vaultPath,
        action,
      });
      updateObsidianSync(data);
      setMessage(data.message || data.error || "AEON Obsidian sync updated.");
      if (action === "once") await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AEON Obsidian sync failed.");
    } finally {
      setActionBusy("");
    }
  }

  async function importUploadedSkill() {
    if (!importFiles.length) return;
    setActionBusy("import-skill");
    setMessage("");
    try {
      const response = await fetch("/api/obsidian/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vaultPath: sharedVault.vaultPath, files: importFiles, name: importName.trim() || undefined }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Skill import failed.");
      setImportOpen(false);
      setImportFiles([]);
      setImportName("");
      setMessage("Imported skill folder into Shared Brain. Sync skills to mirror it into AEON.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Skill import failed.");
    } finally {
      setActionBusy("");
    }
  }

  async function readUploadedFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files: UploadedSkillFile[] = [];
    for (const file of Array.from(fileList)) {
      files.push({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, content: await file.text() });
    }
    setImportFiles(files);
    const skillFile = files.find((file) => /(^|\/)SKILL\.md$/i.test(file.path));
    const name = skillFile?.content.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim();
    if (name) setImportName(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  }

  if (activeView !== "aeon") return null;

  const enabledSchedules = schedules.filter((schedule) => schedule.enabled !== false);
  const successfulRuns = runs.filter((run) => run.status === "completed").length;
  const failedRuns = runs.filter((run) => run.status === "failed").length;
  const selectedScheduleIds = new Set(schedules.map((schedule) => schedule.id));
  const visibleSkills = skills.map((skill) => ({
    ...skill,
    runtimeSchedule: schedules.find((schedule) => schedule.id === skill.slug),
  }));
  const runtimeSkillBySlug = new Map(visibleSkills.map((skill) => [skill.slug, skill]));
  const sharedSkillBySlug = new Map((allSkills?.shared ?? []).map((skill) => [skill.slug, skill]));
  const skillSlugsForView = skillSourceView === "aeon" ? runtimeSkillBySlug.keys() : sharedSkillBySlug.keys();
  const unifiedSkillRows: UnifiedSkillRow[] = [...skillSlugsForView].map((slug) => {
    const sharedSkill = sharedSkillBySlug.get(slug);
    const runtimeSkill = runtimeSkillBySlug.get(slug);
    const state = automationStateForSkill(runtimeSkill);
    const labels = automationLabels(state);
    const groupable = runtimeSkill ? runtimeSkillToGroupable(runtimeSkill) : {
      slug,
      name: sharedSkill?.name ?? slug,
      description: sharedSkill?.description ?? "",
      source: "Shared Brain",
      providerLabel: sharedSkill?.providerLabel,
      enabled: true,
      imported: true,
    };
    return {
      ...groupable,
      automationState: state,
      statusLabel: labels.statusLabel,
      actionLabel: labels.actionLabel,
      sharedSkill,
      runtimeSkill,
    };
  });
  const groupedSkills = groupSkills<UnifiedSkillRow>(
    unifiedSkillRows,
    skillSearch,
  );
  const categoryFilterOptions = groupedSkills.map((group) => ({
    id: group.id,
    label: group.label,
    count: group.skills.length,
    color: group.color,
  }));
  const visibleSkillRows = groupedSkills
    .filter((group) => skillCategoryFilter === "all" || group.id === skillCategoryFilter)
    .flatMap((group) => group.skills.map((skill) => ({
      ...skill,
      categoryLabel: group.label,
      categoryColor: group.color,
    })));
  const selectedSkill = visibleSkills.find((skill) => skill.slug === selectedSkillSlug) ?? visibleSkills[0];
  const selectedSkillRuns = selectedSkill ? runs.filter((run) => run.name.toLowerCase().includes(selectedSkill.slug.toLowerCase()) || run.name.toLowerCase().includes(selectedSkill.name.toLowerCase())) : [];
  const selectedSchedule = selectedSkill ? schedules.find((schedule) => schedule.id === selectedSkill.slug) : undefined;
  const selectedDraftActive = selectedSkill ? selectedSkillSlug === selectedSkill.slug || !selectedSkillSlug : false;
  const selectedDraft = {
    schedule: selectedDraftActive ? skillDraft.schedule : selectedSchedule?.every || selectedSkill?.schedule || "",
    var: selectedDraftActive ? skillDraft.var : selectedSkill?.var || selectedSchedule?.message || "",
    model: selectedDraftActive ? skillDraft.model : selectedSkill?.model || String(selectedSchedule?.metadata?.model || ""),
  };
  const sharedBrainCount = allSkills?.shared.length ?? 0;
  const a2aSkillCount = skills.filter((skill) => skill.source === "aeon-a2a").length;
  const scheduledSkillCount = visibleSkills.filter((skill) => Boolean(skill.runtimeSchedule)).length;
  const localAeonSkillCount = status?.status?.localSkillCount ?? 0;
  const selectedDeliverables = deliverablesByAgent[selectedAgent.id] ?? [];
  const selectedNewDeliverables = selectedDeliverables.filter(isNewAeonDeliverable);
  const selectedDeliverableCount = selectedNewDeliverables.length;
  const githubRepo = status?.status?.repo || selectedAgent.aeonRepo || "";
  const githubSecret = secrets?.keys?.find((secret) => secret.key === "GH_GLOBAL");
  const githubSecretReady = Boolean(githubSecret?.isSet || githubSecret?.availableInSharedEnv || githubSecret?.availableLocally);
  const githubPowered = Boolean(githubRepo && githubSecretReady);
  // Don't trust githubPowered until this workspace's refresh has landed — the
  // status/secret calls are async, so on first paint it reads "not connected"
  // and would flash the setup cards before snapping to the hero. Fall back to
  // the cached verdict (instant) and a quiet placeholder while it's unknown.
  const aeonWorkspaceKeyValue = aeonWorkspaceKey(selectedAgent);
  const connectionResolved = connectionLoadedKey === aeonWorkspaceKeyValue;
  const cachedGithubReady = githubReadyByKey[aeonWorkspaceKeyValue];
  const resolvedGithubReady = connectionResolved ? githubPowered : cachedGithubReady;
  const syncSecretsSucceeded = actionSuccess === "sync-secrets";
  const syncAllSecretsSucceeded = actionSuccess === "sync-all-secrets";
  const githubSecretCount = secrets?.githubSecretCount;
  const githubSecretCountLabel = typeof githubSecretCount === "number"
    ? `${githubSecretCount} repo secret${githubSecretCount === 1 ? "" : "s"}`
    : githubRepo ? "Checking" : "Repo not configured";
  const setupItems = [
    { label: "Local AEON folder", ok: Boolean(status?.status?.root || selectedAgent.aeonLocalPath || selectedAgent.localDataDir), detail: status?.status?.root || selectedAgent.aeonLocalPath || selectedAgent.localDataDir || "~/.aeon" },
    { label: "aeon.yml config", ok: Boolean(status?.status?.hasConfig), detail: status?.status?.hasConfig ? "Readable" : "Missing" },
    { label: "GitHub repo", ok: Boolean(githubRepo), detail: githubRepo || "Not configured" },
    { label: "GitHub secrets", ok: typeof githubSecretCount === "number" && githubSecretCount > 0, detail: githubSecretCountLabel },
    { label: "A2A card", ok: Boolean(status?.status?.a2aReachable), detail: status?.status?.a2aReachable ? "Reachable" : selectedAgent.a2aUrl || selectedAgent.gatewayUrl || "Offline" },
    { label: "Shared Brain", ok: sharedBrainCount > 0, detail: `${sharedBrainCount} skills` },
    { label: "Recent workflow", ok: runs.length > 0, detail: latestRunLabel(runs) },
  ];
  const inventoryRows = [
    { label: "AEON", value: localAeonSkillCount || visibleSkills.length },
    { label: "Shared Brain", value: sharedBrainCount },
    { label: "Automated", value: scheduledSkillCount },
    { label: "On duty", value: enabledSchedules.length },
    { label: "A2A", value: a2aSkillCount },
  ];
  const aeonFleetHoneycomb = aeonFleetHoneycombSize(aeonFleetCardCount, aeonFleetColumns);
  const aeonEmptyText = "No AEON skill files are visible for this profile yet. Sync or import skills to AEON, or use Shared Brain to automate one.";
  const detailTabs: Array<{ id: AeonDetailView; label: string; detail: string }> = [
    { id: "overview", label: "Overview", detail: "Status and next actions" },
    { id: "work", label: "Work", detail: "Skills and automation" },
    { id: "activity", label: "Activity", detail: "Runs and outputs" },
    { id: "deliverables", label: "Deliverables", detail: "Artifacts and handoff" },
    { id: "settings", label: "Settings", detail: "Repo, keys, memory" },
  ];
  const openGithubConnectionSettings = () => {
    updateAgentProfile(selectedAgent.id, { aeonMode: "github" });
    setAgentSettingsPanel("connection");
    setAgentRoleModalId(selectedAgent.id);
  };
  const openGithubRepoModal = () => {
    setGithubRepoModalOpen(true);
    setGithubRepoModalView("select");
    setGithubRepoError("");
    setGithubRepoCreateDraft((current) => ({
      ...current,
      name: current.name || selectedRepoName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase(),
    }));
    void loadGithubRepos();
  };
  const deliverableTarget = (deliverable: AeonDeliverable) => deliverable.path || deliverable.url || "";
  const openDeliverable = async (deliverable: AeonDeliverable, action: "open" | "reveal") => {
    setDeliverablesStatus("");
    try {
      const nativeResult = await openNativeDeliverable({ action, path: deliverable.path, url: deliverable.url });
      if (nativeResult?.ok) return;
      if (nativeResult?.error && !deliverable.url?.trim()) throw new Error(nativeResult.error);
      const response = await fetch("/api/kanban/deliverable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, path: deliverable.path, url: deliverable.url }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not open deliverable.");
    } catch (error) {
      setDeliverablesStatus(error instanceof Error ? error.message : "Could not open deliverable.");
    }
  };
  const downloadDeliverable = async (deliverable: AeonDeliverable) => {
    setActionBusy(`download:${deliverable.id}`);
    setDeliverablesStatus("");
    try {
      const target = deliverableTarget(deliverable);
      const nativeData = await downloadNativeAeonDeliverable({ path: target, url: deliverable.url });
      if (nativeData?.ok) {
        setDeliverablesStatus(nativeData.downloaded ? `Downloaded to ${nativeData.path}` : `Already on this machine: ${nativeData.path}`);
        await refreshDeliverablesForAgent(selectedAgent);
        return;
      }
      if (nativeData?.error && !/^https?:\/\//i.test(target)) throw new Error(nativeData.error);
      const data = await postJson<{ path?: string; downloaded?: boolean }>("/api/runtimes/aeon/deliverables", {
        action: "download",
        agent: selectedAgent,
        vaultPath: sharedVault.vaultPath,
        path: target,
      });
      setDeliverablesStatus(data.downloaded ? `Downloaded to ${data.path}` : `Already on this machine: ${data.path}`);
      await refreshDeliverablesForAgent(selectedAgent);
    } catch (error) {
      setDeliverablesStatus(error instanceof Error ? error.message : "Could not download deliverable.");
    } finally {
      setActionBusy("");
    }
  };
  const sendDeliverableToMachine = async (deliverable: AeonDeliverable, machine: KanbanMachineTarget) => {
    setActionBusy(`send:${deliverable.id}:${machine.key}`);
    setDeliverablesStatus("");
    try {
      const target = deliverableTarget(deliverable);
      const nativeData = await sendNativeAeonDeliverable({
        path: target,
        vaultPath: sharedVault.vaultPath,
        targetMachine: machine,
      });
      if (nativeData?.ok) {
        setDeliverablesStatus(`Queued ${deliverable.title} for ${machine.name}.`);
        setSelectedTransferDeliverable(null);
        return;
      }
      if (nativeData?.error && !/^https?:\/\//i.test(target)) throw new Error(nativeData.error);
      await postJson("/api/runtimes/aeon/deliverables", {
        action: "send",
        agent: selectedAgent,
        vaultPath: sharedVault.vaultPath,
        path: target,
        targetMachine: machine,
      });
      setDeliverablesStatus(`Queued ${deliverable.title} for ${machine.name}.`);
      setSelectedTransferDeliverable(null);
    } catch (error) {
      setDeliverablesStatus(error instanceof Error ? error.message : "Could not send deliverable to that machine.");
    } finally {
      setActionBusy("");
    }
  };
  const openAeonRepoCreateChoice = () => {
    setCreateRepoChoiceOpen(true);
    setCreateRepoChoiceView("choice");
    setCloneStepIndex(0);
    setMessage("");
    setCreatedAeonAgentId("");
    setCloneRepoOpen(false);
  };
  const checkCloneCacheStatus = async () => {
    try {
      const data = await postJson<{ exists?: boolean; behind?: number; path?: string }>("/api/runtimes/aeon/workspaces", {
        action: "cache-status",
        repoUrl: OFFICIAL_AEON_REPO_URL,
      });
      setCloneCacheStatus({ exists: Boolean(data.exists), behind: data.behind ?? 0, path: data.path });
    } catch {
      setCloneCacheStatus(null);
    }
  };
  const updateCloneCache = async () => {
    setActionBusy("cache-refresh");
    setMessage("");
    try {
      const data = await postJson<{ exists?: boolean; behind?: number; path?: string }>("/api/runtimes/aeon/workspaces", {
        action: "cache-refresh",
        repoUrl: OFFICIAL_AEON_REPO_URL,
      });
      setCloneCacheStatus({ exists: Boolean(data.exists), behind: data.behind ?? 0, path: data.path });
      setMessage("Updated the local AEON copy to the latest commit.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the local AEON copy.");
    } finally {
      setActionBusy("");
    }
  };
  const openOfficialCloneView = async () => {
    setCreateRepoChoiceView("official");
    setMessage("");
    setCloneCacheStatus(null);
    if (officialCloneCache) void checkCloneCacheStatus();
    const existing = new Set<string>();
    for (const agent of aeonAgents) {
      existing.add(agent.name || "");
      existing.add(agent.aeonRepoName || "");
      existing.add(aeonRepoDisplayName(agent));
      existing.add((agent.aeonLocalPath || agent.localDataDir || "").split("/").filter(Boolean).at(-1) || "");
      const repoName = agent.aeonRepo?.trim().replace(/\.git$/i, "").split("/").filter(Boolean).at(-1);
      if (repoName) existing.add(repoName);
    }
    setOfficialCloneName(nextAeonName(existing, "aeon"));
    try {
      const response = await fetch("/api/runtimes/aeon/github-repos", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { ok?: boolean; repos?: AeonGithubRepoOption[] } | null;
      if (response.ok && data?.ok !== false) {
        for (const repo of data?.repos ?? []) {
          existing.add(repo.name);
          existing.add(repo.fullName.split("/").at(-1) || "");
        }
      }
    } catch {
      // Local AEON agent names still give us a useful collision-free default.
    }
    setOfficialCloneName(nextAeonName(existing, "aeon"));
  };
  const officialClonePath = `${officialCloneLocation.trim().replace(/\/+$/, "") || "~/Documents"}/${officialCloneName.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "aeon"}`;
  const officialCloneBusy = actionBusy === "github:fork" || actionBusy === "github:create" || actionBusy === "workspace:clone" || actionBusy === "sync-secrets" || actionBusy === "cache-refresh";
  const buildCloneSteps = (): { key: string; label: string; Icon: LucideIcon }[] => {
    const fromCache = officialCloneCache && cloneCacheStatus?.exists;
    const steps: { key: string; label: string; Icon: LucideIcon }[] = [
      { key: "init", label: "Initializing AEON workspace", Icon: Sparkles },
      { key: "identity", label: "Provisioning agent identity", Icon: Bot },
    ];
    if (officialCloneFork && !officialClonePrivateRepo) {
      steps.push({ key: "fork", label: "Forking aaronjmars/aeon to your GitHub", Icon: GitBranch });
    }
    steps.push({ key: "clone", label: `${fromCache ? "Duplicating local AEON copy into" : "Cloning AEON into"} ${officialClonePath}`, Icon: Download });
    steps.push({ key: "mirror", label: "Linking Obsidian vault mirror", Icon: RefreshCcw });
    if (officialCloneFork && officialClonePrivateRepo) {
      steps.push({ key: "repo", label: "Creating private GitHub repo", Icon: GitBranch });
      steps.push({ key: "push", label: "Pushing AEON to your repo", Icon: Upload });
    }
    steps.push({ key: "skills", label: "Indexing skills & runtime", Icon: ListChecks });
    if (officialCloneFork && officialCloneInjectSecrets) {
      steps.push({ key: "secrets", label: "Injecting shared brain secrets", Icon: KeyRound });
    }
    steps.push({ key: "mesh", label: "Calibrating neural mesh", Icon: Network });
    steps.push({ key: "warm", label: "Warming up runtime", Icon: Cpu });
    steps.push({ key: "ready", label: "AEON Agent online", Icon: Rocket });
    return steps;
  };
  const browseOfficialCloneLocation = async () => {
    const machine = aeonRepoMachines[0] ?? null;
    if (chooseDirectoryForMachine && machine) {
      await chooseDirectoryForMachine(machine, (directory) => {
        if (directory.path) setOfficialCloneLocation(directory.path);
      });
      return;
    }
    const nativeResult = await openNativeDirectory({
      currentPath: officialCloneLocation || "~/Documents",
      prompt: "Choose where to clone AEON:",
    });
    if (nativeResult?.path) {
      setOfficialCloneLocation(nativeResult.path);
      return;
    }
    if (nativeResult?.cancelled) return;
    const response = await fetch("/api/agents/browse-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPath: officialCloneLocation || "~/Documents", prompt: "Choose where to clone AEON:" }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { path?: string } | null;
    if (response?.ok && data?.path) setOfficialCloneLocation(data.path);
  };
  // The real backend work, run concurrently with the animation. Resolves with the new
  // agent id on success, or a message on failure (never rejects).
  const runOfficialCloneWork = async (): Promise<{ ok: true; agentId: string } | { ok: false; message?: string }> => {
    let repoUrl = OFFICIAL_AEON_REPO_URL;
    if (officialCloneFork && !officialClonePrivateRepo) {
      setActionBusy("github:fork");
      try {
        const response = await fetch("/api/runtimes/aeon/github-repos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "fork-official", name: officialCloneName }),
        });
        const data = await response.json().catch(() => null) as { ok?: boolean; repo?: string; cloneUrl?: string; error?: string } | null;
        if (!response.ok || data?.ok === false || !data?.repo) throw new Error(data?.error || "Could not fork AEON to your GitHub.");
        repoUrl = data.cloneUrl || `https://github.com/${data.repo}.git`;
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Could not fork AEON to your GitHub." };
      }
    }
    const agent = await runWorkspaceAction("clone", {
      repoUrl,
      path: officialClonePath,
      name: officialCloneName,
      unique: "true",
      cache: officialCloneCache ? "true" : "false",
    }, { openDetail: false });
    if (!agent) return { ok: false }; // runWorkspaceAction already surfaced the failure message.
    let createdAgent = agent;
    const createdName = agent.aeonRepoName || agent.name || officialCloneName;
    const createdPath = agent.aeonLocalPath || agent.localDataDir || officialClonePath;
    setOfficialCloneName(createdName);
    if (officialCloneFork && officialClonePrivateRepo) {
      setActionBusy("github:create");
      try {
        // autoPush: false keeps this call fast — the push is backgrounded below so the
        // clone animation doesn't wait on a full-history network push.
        const response = await fetch("/api/runtimes/aeon/github-repos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            agent,
            name: createdName,
            description: "Private AEON Agent workspace cloned from aaronjmars/aeon.",
            visibility: "private",
            autoPush: false,
            autoIncrement: true,
          }),
        });
        const data = await response.json().catch(() => null) as { ok?: boolean; repo?: string; branch?: string; error?: string } | null;
        if (!response.ok || data?.ok === false || !data?.repo) throw new Error(data?.error || "Could not create the private GitHub repo.");
        const patch = { aeonRepo: data.repo, aeonBranch: data.branch || "main", aeonMode: "github" as const };
        createdAgent = { ...agent, ...patch };
        updateAgentProfile(agent.id, patch);
        setAgents((current) => current.map((item) => (
          item.id === agent.id
          || (item.runtime === "aeon" && (item.aeonLocalPath || item.localDataDir) === (agent.aeonLocalPath || agent.localDataDir))
            ? { ...item, ...patch }
            : item
        )));
        setStatus((current) => current ? { ...current, status: { ...current.status, repo: data.repo } } : current);
        setMessage(`Created private GitHub repo ${data.repo}.`);
        setSelectedAgentId(agent.id);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Could not create the private GitHub repo." };
      }
    }
    setActionBusy("");
    setOfficialCloneLocation(createdPath.split("/").slice(0, -1).join("/") || officialCloneLocation);
    // Heavy network tail (push + secret injection) runs in the background so the animation
    // never waits on it — the agent is already linked and usable locally.
    void completeOfficialCloneTail(createdAgent);
    return { ok: true, agentId: createdAgent.id };
  };
  // Backgrounded after the agent is created: push the local repo and inject secrets. These
  // touch only the remote, so the user can open the agent while they finish.
  const completeOfficialCloneTail = async (agent: AgentProfile) => {
    const tasks: Array<Promise<unknown>> = [];
    if (officialCloneFork && officialClonePrivateRepo && agent.aeonRepo) {
      tasks.push(nativeAeonRepoSync({ agent, action: "push" })
        .then((result) => result?.ok ? result : postJson("/api/runtimes/aeon/repo/sync", { agent, action: "push" }))
        .catch(() => undefined));
    }
    if (officialCloneFork && officialCloneInjectSecrets && agent.aeonRepo) {
      tasks.push(syncSecretsForAgent(agent, { quiet: true, all: true }).catch(() => undefined));
    }
    if (tasks.length) await Promise.allSettled(tasks);
  };
  const cloneOfficialAeon = async () => {
    const steps = buildCloneSteps();
    const runId = (cloneRunIdRef.current += 1);
    const isCurrent = () => cloneRunIdRef.current === runId;
    setCloneSteps(steps);
    setCloneStepIndex(0);
    setMessage("");
    setCreateRepoChoiceView("cloning");

    // Real work runs in the background; the animation paces each step at >= CLONE_STEP_MS so
    // nothing flashes by or stalls. The work (local-copy duplicate or network clone, plus the
    // backgrounded push + secrets) finishes inside the animation window for cached clones, so
    // only the final step ever waits on it.
    const settled = runOfficialCloneWork().then(
      (value) => ({ value }),
      (error) => ({ value: { ok: false as const, message: error instanceof Error ? error.message : "Could not clone official AEON." } }),
    );
    const bail = (message?: string) => {
      if (!isCurrent()) return;
      setActionBusy("");
      if (message) setMessage(message);
      setCreateRepoChoiceView("official");
    };

    for (let index = 0; index < steps.length - 1; index += 1) {
      if (!isCurrent()) return;
      setCloneStepIndex(index);
      await delay(CLONE_STEP_MS);
      const peek = await Promise.race([settled, Promise.resolve(null)]);
      if (peek && !peek.value.ok) { bail(peek.value.message); return; }
    }
    if (!isCurrent()) return;
    setCloneStepIndex(steps.length - 1);

    const final = await settled;
    if (!isCurrent()) return;
    if (!final.value.ok) { bail(final.value.message); return; }
    await delay(CLONE_STEP_MS);
    if (!isCurrent()) return;
    setCloneStepIndex(steps.length);
    setCreatedAeonAgentId(final.value.agentId);
    setCreateRepoChoiceView("created");
  };
  const activateFleetCard = (action: () => void) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    action();
  };

  const cloneTotal = cloneSteps.length;
  const cloneComplete = cloneTotal > 0 && cloneStepIndex >= cloneTotal;
  const clonePct = cloneTotal ? Math.round((Math.min(cloneStepIndex, cloneTotal) / cloneTotal) * 100) : 0;
  const cloneActiveStep = cloneComplete ? null : (cloneSteps[Math.min(cloneStepIndex, Math.max(0, cloneTotal - 1))] ?? null);

  if (panelMode === "fleet") {
    return (
      <section className={`${fleetStyles.root} tabPanel grid gap-4`}>
        <div className="relative overflow-hidden rounded-lg border border-[rgba(148,163,184,0.16)] bg-[linear-gradient(135deg,rgba(10,14,21,0.94),rgba(18,28,35,0.88)_45%,rgba(16,20,29,0.92))] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
          <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(94,234,212,0.65),transparent)]" />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid gap-2">
              <p className="eyebrow">AEON Fleet</p>
              <h2 className="m-0 text-xl font-bold text-[var(--foreground)]">Choose an Aeon Agent Repo</h2>
              <p className="m-0 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                One AEON repo is a workspace. Open a repo for its skills, schedules, runs, outputs, keys, memory, and GitHub sync.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
              <span className="rounded-md border border-[rgba(94,234,212,0.20)] bg-[rgba(20,184,166,0.08)] px-2 py-1 text-[var(--accent-strong)]">{aeonAgents.length} AEON repo{aeonAgents.length === 1 ? "" : "s"}</span>
              <span className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(10,14,21,0.52)] px-2 py-1">Obsidian mirror</span>
            </div>
          </div>
          {message ? (
            <p className="mt-4 rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(10,14,21,0.64)] px-3 py-2 text-sm text-[var(--foreground)]">{message}</p>
          ) : null}
        </div>

        {createRepoChoiceOpen && typeof document !== "undefined" ? createPortal((
          <div className="fixed left-0 top-0 z-50 grid h-[100dvh] w-[100vw] place-items-center overflow-y-auto bg-[rgba(2,6,23,0.72)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Create or clone AEON repo">
            <div className="grid w-full max-w-2xl gap-4 rounded-lg border border-[rgba(94,234,212,0.24)] bg-[rgba(10,14,21,0.96)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow">AEON repo</p>
                  <h3 className="m-0 text-lg font-bold text-[var(--foreground)]">{createRepoChoiceView === "official" ? "Clone official AEON" : createRepoChoiceView === "cloning" ? "Cloning official AEON" : createRepoChoiceView === "created" ? "AEON Agent Created" : "Start a workspace"}</h3>
                  <p className="m-0 mt-1 text-sm leading-6 text-[var(--muted)]">
                    {createRepoChoiceView === "official"
                      ? "Name this AEON Agent and choose where the local repo should live."
                      : createRepoChoiceView === "cloning"
                        ? "Spinning up your AEON Agent. Hang tight while the steps complete."
                        : createRepoChoiceView === "created"
                          ? "The local AEON repo is linked and the agent card is ready."
                          : "Clone AEON into a local folder or import an AEON repo already on this machine."}
                  </p>
                </div>
                {createRepoChoiceView === "cloning" ? null : (
                  <Button type="button" size="icon" variant="ghost" aria-label="Close AEON repo choices" onClick={() => setCreateRepoChoiceOpen(false)}>
                    <X aria-hidden="true" />
                  </Button>
                )}
              </div>
              {createRepoChoiceView === "choice" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  className="grid min-h-[190px] content-start gap-3 rounded-lg border border-[rgba(94,234,212,0.26)] bg-[rgba(20,184,166,0.08)] p-4 text-left transition hover:bg-[rgba(20,184,166,0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(94,234,212,0.42)]"
                  onClick={() => {
                    setCreateRepoChoiceOpen(false);
                    setCloneRepoUrl("");
                    setCloneRepoOpen(true);
                  }}
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[rgba(94,234,212,0.30)] bg-[rgba(20,184,166,0.12)] text-[var(--accent-strong)]">
                    <Download aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <span className="text-base font-bold text-[var(--foreground)]">Clone local copy</span>
                  <span className="text-xs leading-5 text-[var(--muted)]">Paste any AEON GitHub repo URL and clone it into <code className="rounded border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.34)] px-1 py-0.5 text-[var(--foreground)]">~/.aeon-repos/</code>.</span>
                </button>
                <button
                  type="button"
                  className="grid min-h-[190px] content-start gap-3 rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(15,23,42,0.48)] p-4 text-left transition hover:border-[rgba(94,234,212,0.30)] hover:bg-[rgba(94,234,212,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(94,234,212,0.42)]"
                  onClick={() => void openOfficialCloneView()}
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.36)] text-[var(--accent-strong)]">
                    {actionBusy === "workspace:clone" ? <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" /> : <GitBranch aria-hidden="true" className="h-5 w-5" />}
                  </span>
                  <span className="text-base font-bold text-[var(--foreground)]">Clone official AEON</span>
                  <span className="text-xs leading-5 text-[var(--muted)]">Fork <code className="rounded border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.34)] px-1 py-0.5 text-[var(--foreground)]">aaronjmars/aeon</code> to your GitHub, clone that copy into <code className="rounded border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.34)] px-1 py-0.5 text-[var(--foreground)]">~/Documents</code>, and link it.</span>
                </button>
                <button
                  type="button"
                  className="grid min-h-[150px] content-start gap-3 rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(15,23,42,0.48)] p-4 text-left transition hover:border-[rgba(94,234,212,0.30)] hover:bg-[rgba(94,234,212,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(94,234,212,0.42)] md:col-span-2"
                  onClick={() => {
                    setCreateRepoChoiceOpen(false);
                    void browseAeonWorkspace();
                  }}
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.36)] text-[var(--accent-strong)]">
                    {actionBusy === "workspace:browse" ? <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" /> : <FolderOpen aria-hidden="true" className="h-5 w-5" />}
                  </span>
                  <span className="text-base font-bold text-[var(--foreground)]">Import existing</span>
                  <span className="text-xs leading-5 text-[var(--muted)]">Choose an AEON repo folder that already exists locally and link it.</span>
                </button>
              </div>
              ) : createRepoChoiceView === "official" ? (
                <div className="grid gap-4">
                  {message ? (
                    <p className="m-0 rounded-md border border-[rgba(251,191,36,0.24)] bg-[rgba(251,191,36,0.08)] px-3 py-2 text-sm leading-6 text-amber-100">{message}</p>
                  ) : null}
                  <label className="grid gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                    AEON Agent name
                    <input
                      value={officialCloneName}
                      onChange={(event) => setOfficialCloneName(event.target.value)}
                      placeholder="aeon"
                      className="min-h-11 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.50)] px-3 text-base font-semibold normal-case tracking-normal text-[var(--foreground)] outline-none transition focus:border-[rgba(94,234,212,0.52)]"
                    />
                  </label>
                  <label className="grid gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Location
                    <span className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <input
                        value={officialCloneLocation}
                        onChange={(event) => setOfficialCloneLocation(event.target.value)}
                        placeholder="~/Documents"
                        className="min-h-11 min-w-0 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.50)] px-3 text-base font-semibold normal-case tracking-normal text-[var(--foreground)] outline-none transition focus:border-[rgba(94,234,212,0.52)]"
                      />
                      <Button type="button" variant="secondary" onClick={() => void browseOfficialCloneLocation()} disabled={officialCloneBusy}>
                        <FolderOpen aria-hidden="true" />
                        Browse
                      </Button>
                    </span>
                  </label>
                  <p className="m-0 text-xs leading-5 text-[var(--muted)]">Will clone to <code className="rounded border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.24)] px-1.5 py-0.5 text-[var(--foreground)]">{officialClonePath}</code>.</p>
                  <label className="flex items-start justify-between gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.07)] p-3 text-sm text-[var(--foreground)]">
                    <span className="grid gap-1">
                      <span className="font-bold">GitHub 1-Step Setup</span>
                      <span className="text-xs leading-5 text-[var(--muted)]">Recommended. Sets up GitHub while cloning so this AEON Agent is immediately connected for origin, Actions, pushes, and secret injection.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={officialCloneFork}
                      onChange={(event) => setOfficialCloneFork(event.target.checked)}
                      disabled={officialCloneBusy}
                      className="mt-1 h-4 w-4"
                    />
                  </label>
                  <div className="grid gap-2 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.22)] p-3">
                    <label className="flex items-start justify-between gap-3 text-sm text-[var(--foreground)]">
                      <span className="grid gap-1">
                        <span className="font-bold">Private GitHub repo</span>
                        <span className="text-xs leading-5 text-[var(--muted)]">Creates a private repo in your GitHub, points the clone at it, and pushes AEON there. Turn off to use a normal GitHub fork.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={officialClonePrivateRepo}
                        onChange={(event) => setOfficialClonePrivateRepo(event.target.checked)}
                        disabled={officialCloneBusy || !officialCloneFork}
                        className="mt-1 h-4 w-4"
                      />
                    </label>
                    <label className="flex items-start justify-between gap-3 text-sm text-[var(--foreground)]">
                      <span className="grid gap-1">
                        <span className="font-bold">Inject shared brain secrets</span>
                        <span className="text-xs leading-5 text-[var(--muted)]">Pushes every key in your shared brain&apos;s shared env to the new repo after GitHub setup, so all shared secrets are available to GitHub Actions right away.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={officialCloneInjectSecrets}
                        onChange={(event) => setOfficialCloneInjectSecrets(event.target.checked)}
                        disabled={officialCloneBusy || !officialCloneFork}
                        className="mt-1 h-4 w-4"
                      />
                    </label>
                  </div>
                  <label className="flex items-start justify-between gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.22)] p-3 text-sm text-[var(--foreground)]">
                    <span className="grid gap-1">
                      <span className="font-bold">Keep a local copy for faster future clones</span>
                      <span className="text-xs leading-5 text-[var(--muted)]">
                        Stores a duplicate of the cloned repo at <code className="rounded border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.3)] px-1 py-0.5 text-[var(--foreground)]">~/.hivemindos/aeon-repo-cache</code> so future agents duplicate it locally instead of cloning over the network.
                        {officialCloneCache && cloneCacheStatus?.exists ? (cloneCacheStatus.behind > 0 ? ` Local copy is ${cloneCacheStatus.behind} commit${cloneCacheStatus.behind === 1 ? "" : "s"} behind upstream.` : " Local copy is up to date.") : ""}
                      </span>
                      {officialCloneCache && cloneCacheStatus?.exists && cloneCacheStatus.behind > 0 ? (
                        <Button type="button" size="sm" variant="secondary" className="mt-1 w-fit" onClick={() => void updateCloneCache()} disabled={officialCloneBusy || actionBusy === "cache-refresh"}>
                          {actionBusy === "cache-refresh" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RefreshCcw aria-hidden="true" />}
                          {actionBusy === "cache-refresh" ? "Updating..." : `Update local copy before cloning`}
                        </Button>
                      ) : null}
                    </span>
                    <input
                      type="checkbox"
                      checked={officialCloneCache}
                      onChange={(event) => {
                        const next = event.target.checked;
                        setOfficialCloneCache(next);
                        if (next) void checkCloneCacheStatus();
                        else setCloneCacheStatus(null);
                      }}
                      disabled={officialCloneBusy}
                      className="mt-1 h-4 w-4"
                    />
                  </label>
                  <div className="flex flex-wrap justify-between gap-2">
                    <Button type="button" variant="ghost" onClick={() => setCreateRepoChoiceView("choice")} disabled={officialCloneBusy}>Back</Button>
                    <Button type="button" onClick={() => void cloneOfficialAeon()} disabled={!officialCloneName.trim() || !officialCloneLocation.trim() || officialCloneBusy}>
                      {officialCloneBusy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
                      {actionBusy === "github:fork" ? "Forking..." : actionBusy === "workspace:clone" ? "Cloning..." : "Clone"}
                    </Button>
                  </div>
                </div>
              ) : createRepoChoiceView === "cloning" ? (
                <div className="grid gap-5">
                  <div className="relative overflow-hidden rounded-lg border border-[rgba(94,234,212,0.24)] bg-[radial-gradient(120%_120%_at_0%_0%,rgba(20,184,166,0.16),rgba(10,14,21,0.20))] p-5">
                    <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 animate-pulse rounded-full bg-[rgba(20,184,166,0.18)] blur-3xl" />
                    <div className="relative flex items-center gap-4">
                      <span className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[rgba(94,234,212,0.34)] bg-[rgba(20,184,166,0.12)] text-[var(--accent-strong)]">
                        {cloneComplete ? (
                          <Check aria-hidden="true" className="h-6 w-6" />
                        ) : (
                          <>
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-xl border border-[rgba(94,234,212,0.40)]" />
                            {cloneActiveStep ? <cloneActiveStep.Icon aria-hidden="true" className="h-6 w-6" /> : <Sparkles aria-hidden="true" className="h-6 w-6" />}
                          </>
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="m-0 text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent-strong)]">{cloneComplete ? "Complete" : `Step ${Math.min(cloneStepIndex + 1, cloneTotal)} of ${cloneTotal}`}</p>
                        <h4 className="m-0 mt-1 truncate text-base font-bold text-[var(--foreground)]">{cloneComplete ? "AEON Agent online" : cloneActiveStep?.label ?? "Working…"}</h4>
                      </div>
                    </div>
                    <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-[rgba(2,6,23,0.55)]">
                      <div className="h-full rounded-full bg-[linear-gradient(90deg,rgba(45,212,191,0.9),rgba(94,234,212,0.9))] shadow-[0_0_12px_rgba(94,234,212,0.6)] transition-[width] duration-700 ease-out" style={{ width: `${Math.max(6, clonePct)}%` }} />
                    </div>
                  </div>
                  <ol className="grid gap-1.5">
                    {cloneSteps.map((step, index) => {
                      const state = cloneComplete || index < cloneStepIndex ? "done" : index === cloneStepIndex ? "active" : "todo";
                      return (
                        <li key={step.key} className={`flex items-center gap-3 rounded-md border px-3 py-2 transition-all duration-500 ${state === "active" ? "border-[rgba(94,234,212,0.34)] bg-[rgba(20,184,166,0.10)]" : state === "done" ? "border-[rgba(94,234,212,0.16)] bg-[rgba(20,184,166,0.04)]" : "border-transparent opacity-45"}`}>
                          <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${state === "todo" ? "border-[rgba(148,163,184,0.22)] text-[var(--muted)]" : "border-[rgba(94,234,212,0.30)] bg-[rgba(20,184,166,0.12)] text-[var(--accent-strong)]"}`}>
                            {state === "done" ? <Check aria-hidden="true" className="h-4 w-4" /> : state === "active" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <step.Icon aria-hidden="true" className="h-4 w-4" />}
                          </span>
                          <span className={`truncate text-sm ${state === "todo" ? "text-[var(--muted)]" : "font-semibold text-[var(--foreground)]"}`}>{step.label}</span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : (
                <div className="grid gap-4 rounded-lg border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.08)] p-4">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[rgba(94,234,212,0.30)] bg-[rgba(20,184,166,0.12)] text-[var(--accent-strong)]">
                      <Check aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h4 className="m-0 text-base font-bold text-[var(--foreground)]">{officialCloneName || "AEON"} is ready</h4>
                      <p className="m-0 mt-1 break-words text-sm leading-6 text-[var(--muted)]">{officialClonePath}</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" onClick={() => {
                      if (createdAeonAgentId) setSelectedAgentId(createdAeonAgentId);
                      setPanelMode("detail");
                      setCreateRepoChoiceOpen(false);
                    }}>
                      <Rocket aria-hidden="true" />
                      Open agent
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ), document.body) : null}

        {createRepoOpen ? (
          <CreateFolderRepoModal
            open={createRepoOpen}
            eyebrow="AEON repo"
            title="Create AEON repo"
            description="Choose a name and parent folder. HivemindOS will initialize the repo and save the profile to Obsidian automatically."
            nameLabel="Repo name"
            pathLabel="Parent folder"
            defaultName="aeon-workspace"
            defaultParentPath="~/.aeon-repos"
            submitLabel="Create repo"
            busy={actionBusy === "workspace:initialize"}
            machines={aeonRepoMachines}
            icon={<Rocket aria-hidden="true" className="h-5 w-5" />}
            onClose={() => setCreateRepoOpen(false)}
            onBrowseDirectory={browseCreateRepoLocation}
            onSubmit={createAeonWorkspace}
          />
        ) : null}

        {aeonAgents.length === 0 ? (
          <section className="grid gap-4 rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(16,20,29,0.78)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="grid gap-2">
                <p className="eyebrow">No AEON repo linked</p>
                <h3 className="m-0 text-lg font-bold text-[var(--foreground)]">Connect a workspace before adding jobs</h3>
                <p className="m-0 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                  HivemindOS will save the repo profile in Obsidian automatically under {`Agents/AEON/<repo>/`}.
                </p>
              </div>
              <span className="relative h-16 w-16 overflow-hidden rounded-2xl border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.08)]">
                <Image src="/icons/runtimes/aeon.png?v=20260526-runtime-icons-2" alt="" aria-hidden="true" fill sizes="64px" className="object-contain" unoptimized />
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <button type="button" className="grid gap-2 rounded-md border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.08)] p-4 text-left hover:bg-[rgba(20,184,166,0.12)]" onClick={openAeonRepoCreateChoice} disabled={actionBusy === "workspace:initialize"}>
                <span className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">{actionBusy === "workspace:initialize" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Plus aria-hidden="true" />} Create local repo</span>
                <span className="text-xs leading-5 text-[var(--muted)]">Name it, choose a machine, and pick where it should live.</span>
              </button>
              <button type="button" className="grid gap-2 rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(10,14,21,0.38)] p-4 text-left hover:bg-[rgba(94,234,212,0.08)]" onClick={() => void browseAeonWorkspace()} disabled={actionBusy === "workspace:browse"}>
                <span className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">{actionBusy === "workspace:browse" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <FolderOpen aria-hidden="true" />} Browse existing</span>
                <span className="text-xs leading-5 text-[var(--muted)]">Choose a local AEON repo folder already on this machine.</span>
              </button>
              <button type="button" className="grid gap-2 rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(10,14,21,0.38)] p-4 text-left hover:bg-[rgba(94,234,212,0.08)]" onClick={() => setCloneRepoOpen((open) => !open)}>
                <span className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]"><GitBranch aria-hidden="true" /> Clone from GitHub</span>
                <span className="text-xs leading-5 text-[var(--muted)]">Clone a GitHub AEON repo into `~/.aeon-repos/` and link it.</span>
              </button>
            </div>
            {cloneRepoOpen ? (
              <div className="grid gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-3">
                <label className="grid gap-1 text-xs text-[var(--muted)]">
                  GitHub repo URL
                  <input value={cloneRepoUrl} onChange={(event) => setCloneRepoUrl(event.target.value)} placeholder="https://github.com/owner/repo.git" className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.50)] px-3 py-2 text-sm text-[var(--foreground)] outline-none" />
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setCloneRepoOpen(false)}>Cancel</Button>
                  <Button type="button" onClick={() => void runWorkspaceAction("clone", { repoUrl: cloneRepoUrl })} disabled={!cloneRepoUrl.trim() || actionBusy === "workspace:clone"}>
                    {actionBusy === "workspace:clone" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
                    Clone and link
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {aeonAgents.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={openAeonRepoCreateChoice} disabled={actionBusy === "workspace:initialize"}>
              {actionBusy === "workspace:initialize" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Plus aria-hidden="true" />}
              New Aeon Agent Repo
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => void browseAeonWorkspace()} disabled={actionBusy === "workspace:browse"}>
              {actionBusy === "workspace:browse" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <FolderOpen aria-hidden="true" />}
              Browse repo
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCloneRepoOpen((open) => !open)}>
              <GitBranch aria-hidden="true" />
              Clone repo
            </Button>
          </div>
        ) : null}

        {aeonAgents.length > 0 && cloneRepoOpen ? (
          <div className="grid gap-3 rounded-lg border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-3">
            <label className="grid gap-1 text-xs text-[var(--muted)]">
              GitHub repo URL
              <input value={cloneRepoUrl} onChange={(event) => setCloneRepoUrl(event.target.value)} placeholder="https://github.com/owner/repo.git" className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.50)] px-3 py-2 text-sm text-[var(--foreground)] outline-none" />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCloneRepoOpen(false)}>Cancel</Button>
              <Button type="button" onClick={() => void runWorkspaceAction("clone", { repoUrl: cloneRepoUrl })} disabled={!cloneRepoUrl.trim() || actionBusy === "workspace:clone"}>
                {actionBusy === "workspace:clone" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
                Clone and link
              </Button>
            </div>
          </div>
        ) : null}

        <div
          ref={aeonFleetListRef}
          className="relative isolate"
          role="list"
          aria-label="AEON repos"
          style={{ minHeight: aeonFleetHoneycomb.height }}
        >
          <AeonFleetHex
            width={AEON_FLEET_HEX_W}
            height={AEON_FLEET_HEX_H}
            tone="active"
            role="listitem"
            tabIndex={0}
            aria-label="Create new Aeon Agent Repo"
            data-aeon-fleet-hex="create"
            className="group absolute z-10 cursor-pointer hover:scale-[1.025] focus:outline-none focus-visible:drop-shadow-[0_0_18px_rgba(94,234,212,0.62)]"
            style={{
              position: "absolute",
              left: aeonFleetHexPosition(0, aeonFleetColumns).x,
              top: aeonFleetHexPosition(0, aeonFleetColumns).y,
            }}
            onClick={openAeonRepoCreateChoice}
            onKeyDown={activateFleetCard(openAeonRepoCreateChoice)}
          >
            <span className="grid w-[62%] justify-items-center gap-2 text-center [line-height:normal]">
              <span className="relative h-16 w-16 transition group-hover:scale-105">
                <span className="absolute inset-0 overflow-hidden rounded-lg border border-[rgba(94,234,212,0.28)] bg-[radial-gradient(circle_at_50%_38%,rgba(94,234,212,0.18),rgba(10,14,21,0.28)_62%)] p-1">
                  <Image src="/icons/runtimes/aeon.png?v=20260526-runtime-icons-2" alt="" aria-hidden="true" fill sizes="64px" className="object-contain drop-shadow-[0_10px_22px_rgba(94,234,212,0.22)]" unoptimized />
                </span>
                <span className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(94,234,212,0.42)] bg-[rgba(10,14,21,0.94)] text-[var(--accent-strong)]">
                  {actionBusy === "workspace:initialize" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Plus aria-hidden="true" className="h-4 w-4" />}
                </span>
              </span>
              <span className="text-sm font-bold leading-5 text-[var(--foreground)]">New Aeon Agent Repo</span>
              <span className="text-xs leading-4 text-[var(--muted)]">
                Name it and choose its location.
              </span>
            </span>
          </AeonFleetHex>
          {aeonAgents.map((agent, agentIndex) => {
            const gitBacked = Boolean(agent.aeonRepo?.trim());
            const repoName = aeonRepoDisplayName(agent);
            const deliverableCount = (deliverablesByAgent[agent.id] ?? []).filter(isNewAeonDeliverable).length;
            const cellPosition = aeonFleetHexPosition(agentIndex + 1, aeonFleetColumns);
            return (
              <div key={agent.id}>
                {deliverableCount > 0 ? (
                  <span
                    className="pointer-events-none absolute -translate-x-1/2 rounded-full border border-[rgba(94,234,212,0.64)] bg-[rgba(5,8,13,0.98)] px-3.5 py-1.5 text-[10px] font-black uppercase leading-none text-[var(--accent-strong)] shadow-[0_0_30px_rgba(45,212,191,0.32),0_12px_28px_rgba(0,0,0,0.34)]"
                    style={{
                      left: cellPosition.x + AEON_FLEET_HEX_W / 2,
                      top: cellPosition.y - 12,
                      zIndex: 9999,
                    }}
                  >
                    {deliverableCount} new deliverable{deliverableCount === 1 ? "" : "s"}
                  </span>
                ) : null}
                <AeonFleetHex
                  width={AEON_FLEET_HEX_W}
                  height={AEON_FLEET_HEX_H}
                  tone="default"
                  role="listitem"
                  tabIndex={0}
                  aria-label={`Open AEON repo ${repoName}`}
                  data-aeon-fleet-hex="repo"
                  className="absolute z-10 cursor-pointer hover:scale-[1.025] focus:outline-none focus-visible:drop-shadow-[0_0_18px_rgba(94,234,212,0.42)]"
                  style={{
                    position: "absolute",
                    left: cellPosition.x,
                    top: cellPosition.y,
                  }}
                  onClick={() => {
                    setSelectedAgentId(agent.id);
                    setPanelMode("detail");
                  }}
                  onKeyDown={activateFleetCard(() => {
                    setSelectedAgentId(agent.id);
                    setPanelMode("detail");
                  })}
                >
                <span data-aeon-fleet-content="repo" className="grid w-[62%] max-w-[176px] justify-items-center gap-1.5 text-center [line-height:normal]">
                  <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded border border-[rgba(94,234,212,0.28)] bg-[rgba(20,184,166,0.08)] p-0.5 shadow-[0_8px_22px_rgba(0,0,0,0.26)]">
                    <Image src={agent.aeonLogoUrl || "/icons/runtimes/aeon.png?v=20260526-runtime-icons-2"} alt="" aria-hidden="true" fill sizes="44px" className="object-cover" unoptimized />
                  </span>
                  <span className="grid min-w-0 justify-items-center gap-0.5">
                    <span className="min-w-0 break-words text-[18px] font-bold leading-[1.05] text-[var(--foreground)]">{repoName}</span>
                    <span className="min-w-0 break-words text-[10px] font-semibold uppercase leading-3 text-[var(--muted)]">{aeonProfileLabel(agent, repoName)}</span>
                  </span>
                  <span className="flex flex-wrap justify-center gap-1">
                    <span
                      className="rounded-full border border-[rgba(94,234,212,0.36)] bg-[rgba(20,184,166,0.14)] px-2 py-0.5 text-[10px] font-bold uppercase leading-3 text-[var(--accent-strong)] shadow-[0_8px_20px_rgba(20,184,166,0.12)]"
                      title="Where this AEON workspace is configured from."
                    >
                      {aeonModeBadgeLabel(agent)}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase leading-3 shadow-[0_8px_20px_rgba(0,0,0,0.16)] ${
                        gitBacked
                          ? "border-[rgba(74,222,128,0.34)] bg-[rgba(34,197,94,0.13)] text-emerald-200"
                          : "border-[rgba(251,191,36,0.32)] bg-[rgba(245,158,11,0.12)] text-amber-200"
                      }`}
                      title={gitBacked ? "Git repo configured." : "No Git repo configured; this AEON workspace is local-only."}
                    >
                      {gitBacked ? "Online" : "Offline"}
                    </span>
                  </span>
                  <span className="grid w-full gap-1 text-[10px] leading-3 text-[var(--muted)]">
                    <AeonFleetMeta label="Folder" value={agent.aeonLocalPath || agent.localDataDir || "~/.aeon"} />
                    <AeonFleetMeta label="Repo" value={agent.aeonRepo || "Not connected"} />
                  </span>
                  <span className="flex flex-wrap justify-center gap-1 text-[9px] font-semibold leading-3 text-[var(--muted)]">
                    <span className="rounded border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.62)] px-1.5 py-0.5">{agent.useSharedVault === false ? "Private" : "Brain"}</span>
                    <span className="rounded border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.62)] px-1.5 py-0.5">{agent.aeonBranch || "main"}</span>
                    </span>
                  </span>
                </AeonFleetHex>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  if (aeonSchedulerOpen) {
    const aeonJobCount = schedulerJobs.filter((job) => job.runtime.trim().toLowerCase() === "aeon").length;
    return (
      <section className={`${fleetStyles.root} tabPanel grid gap-4`}>
        <div className="relative overflow-hidden rounded-lg border border-[rgba(148,163,184,0.16)] bg-[linear-gradient(135deg,rgba(10,14,21,0.94),rgba(18,28,35,0.88)_45%,rgba(16,20,29,0.92))] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
          <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(94,234,212,0.65),transparent)]" />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid min-w-0 gap-2">
              <p className="eyebrow">Aeon Autopilot</p>
              <h2 className="m-0 text-xl font-bold leading-tight text-[var(--foreground)]">Scheduler</h2>
              <p className="m-0 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                AEON automations only. Toggle, run, edit, or create scheduled work for this workspace without leaving the panel.
              </p>
              <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                <span className="rounded-md border border-[rgba(94,234,212,0.20)] bg-[rgba(20,184,166,0.08)] px-2 py-1 text-[var(--accent-strong)]">{aeonJobCount} AEON automation{aeonJobCount === 1 ? "" : "s"}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAeonSchedulerOpen(false)}>
                <ChevronLeft aria-hidden="true" />
                Back to AEON
              </Button>
            </div>
          </div>
        </div>
        <div className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-[18px] border border-[rgba(148,163,184,0.16)] bg-[rgba(5,8,13,0.72)]">
          <SchedulerView
            jobs={schedulerJobs}
            runStates={schedulerRunStates}
            lockedRuntime="aeon"
            onToggleJob={onSchedulerToggleJob}
            onRunNow={onSchedulerRunJob}
            onEditJob={onSchedulerEditJob}
            onNewJob={createAeonAutomation}
          />
        </div>
      </section>
    );
  }

  return (
    <section className={`tabPanel grid gap-4 ${detailView === "settings" ? "xl:grid-cols-2 xl:items-start" : ""}`}>
      <div className={`relative overflow-hidden rounded-[18px] border border-[rgba(148,163,184,0.16)] bg-[linear-gradient(135deg,rgba(10,14,21,0.94),rgba(18,28,35,0.88)_45%,rgba(16,20,29,0.92))] shadow-[0_18px_60px_rgba(0,0,0,0.24)] ${detailView === "settings" ? "xl:col-span-2" : ""}`}>
        <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(94,234,212,0.65),transparent)]" />
        <SectionModeHeader
          activeMode={detailView}
          ariaLabel="AEON detail view"
          modes={detailTabs.map(({ id, label }) => ({ id, label }))}
          onSelect={setDetailView}
          title={
            <InlineRenameControl
              value={selectedRepoName}
              draft={repoRenameDraft}
              editing={repoRenameEditing}
              inputId="aeon-repo-name"
              inputAriaLabel="AEON repo name"
              editAriaLabel="Rename AEON repo"
              saveAriaLabel="Save AEON repo name"
              cancelAriaLabel="Cancel AEON repo rename"
              busy={actionBusy === "workspace:rename"}
              formClassName="flex min-w-0 flex-wrap items-center gap-2"
              inputClassName="min-h-10 w-full min-w-0 max-w-[420px] rounded-md border border-[rgba(94,234,212,0.32)] bg-[rgba(10,14,21,0.72)] px-3 text-xl font-bold text-[var(--foreground)] outline-none transition focus:border-[rgba(94,234,212,0.58)]"
              saveButtonClassName="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[rgba(94,234,212,0.28)] bg-[rgba(20,184,166,0.12)] text-[var(--accent-strong)] transition hover:border-[rgba(94,234,212,0.48)] hover:bg-[rgba(20,184,166,0.18)] disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:h-4 [&_svg]:w-4"
              editButtonClassName="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-transparent bg-transparent text-[var(--accent-strong)] transition hover:bg-[rgba(20,184,166,0.10)] hover:text-[#99f6e4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(45,212,191,0.35)] [&_svg]:h-4 [&_svg]:w-4"
              onDraftChange={(draft) => setRepoRenameState({ agentId: selectedAgent.id, editing: true, draft })}
              onStartEditing={() => {
                setRepoRenameState({ agentId: selectedAgent.id, editing: true, draft: selectedRepoName });
              }}
              onCancel={() => {
                setRepoRenameState({ agentId: selectedAgent.id, editing: false, draft: selectedRepoName });
              }}
              onSubmit={renameSelectedWorkspace}
              renderDisplay={({ value, editButton }) => (
                <div className="flex min-w-0 items-center gap-2">
                  <h2 id="aeon-repo-name">{value}</h2>
                  {editButton}
                </div>
              )}
            />
          }
          subtitle="Aeon Autopilot"
          stats={[
            { value: enabledSchedules.length, label: "on duty", tone: "cyan" },
            { value: skills.length, label: "skills", tone: "honey" },
            { value: runs.length, label: "runs" },
            { value: selectedDeliverableCount, label: "handoffs", tone: "cyan" },
          ]}
          actions={
            <>
            <Button type="button" variant="ghost" onClick={() => setPanelMode("fleet")}>
              <ChevronLeft aria-hidden="true" />
              All AEON Agents
            </Button>
            <Button type="button" variant="secondary" onClick={() => {
              void refreshFastSecrets();
              void refresh();
            }} disabled={loading}>
              {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RefreshCcw aria-hidden="true" />}
              Refresh
            </Button>
            </>
          }
        />
        {message ? (
          <p className="mx-5 mb-4 rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(10,14,21,0.64)] px-3 py-2 text-sm text-[var(--foreground)]">{message}</p>
        ) : null}
      </div>

      {convertSkill ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(2,6,23,0.72)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Automate ${convertSkill.name} with AEON`}>
          <div className="grid max-h-[calc(100vh-2rem)] w-full max-w-3xl gap-4 overflow-auto rounded-lg border border-[rgba(94,234,212,0.24)] bg-[rgba(10,14,21,0.96)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">Automate with AEON</p>
                <h3 id="aeon-convert-title" className="m-0 text-lg font-bold text-[var(--foreground)]">{convertSkill.name}</h3>
                <p className="m-0 mt-1 text-sm leading-6 text-[var(--muted)]">{convertSkill.description || "This shared skill will be mirrored into AEON and attached to runtime config."}</p>
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label="Close convert to AEON" onClick={() => setConvertSkill(null)}>
                <X aria-hidden="true" />
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <ConvertInfo label="From" value="Shared Brain" detail={convertSkill.relativePath || convertSkill.path} />
              <ConvertInfo label="To" value="AEON" detail={`skills/${convertSkill.slug}/SKILL.md`} />
              <ConvertInfo label="Starts as" value={convertDraft.onDuty ? "On duty" : "Off duty"} detail={scheduleSummaryFromConvertDraft(convertDraft)} />
            </div>

            <div className="grid gap-4">
              <section className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm text-[var(--foreground)]">Run cadence</strong>
                  <span className="rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.07)] px-2 py-1 text-xs text-[var(--accent-strong)]">{scheduleSummaryFromConvertDraft(convertDraft)}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-5">
                  {CONVERT_SCHEDULE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`grid gap-1 rounded-md border p-3 text-left ${convertDraft.scheduleMode === option.value ? "border-[rgba(94,234,212,0.42)] bg-[rgba(20,184,166,0.12)]" : "border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.46)]"}`}
                      onClick={() => setConvertDraft((current) => ({ ...current, scheduleMode: option.value, onDuty: option.value === "manual" ? false : current.onDuty }))}
                    >
                      <span className="text-sm font-bold text-[var(--foreground)]">{option.label}</span>
                      <span className="text-[11px] leading-4 text-[var(--muted)]">{option.detail}</span>
                    </button>
                  ))}
                </div>
                {convertDraft.scheduleMode !== "manual" && convertDraft.scheduleMode !== "hourly" ? (
                  <div className="grid gap-2 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.30)] p-3 sm:grid-cols-3">
                    {convertDraft.scheduleMode === "weekly" ? (
                      <label className="grid gap-1 text-xs text-[var(--muted)]">
                        Day
                        <select className="min-h-9 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.72)] px-2 text-[var(--foreground)]" value={convertDraft.weekday} onChange={(event) => setConvertDraft((current) => ({ ...current, weekday: event.target.value }))}>
                          {CONVERT_WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                        </select>
                      </label>
                    ) : null}
                    <label className="grid gap-1 text-xs text-[var(--muted)]">
                      Hour
                      <select className="min-h-9 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.72)] px-2 text-[var(--foreground)]" value={convertDraft.hour} onChange={(event) => setConvertDraft((current) => ({ ...current, hour: event.target.value }))}>
                        {CONVERT_HOURS.map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs text-[var(--muted)]">
                      Minute
                      <select className="min-h-9 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.72)] px-2 text-[var(--foreground)]" value={convertDraft.minute} onChange={(event) => setConvertDraft((current) => ({ ...current, minute: event.target.value }))}>
                        {CONVERT_MINUTES.map((minute) => <option key={minute} value={minute}>{minute}</option>)}
                      </select>
                    </label>
                  </div>
                ) : null}
              </section>

              <section className="grid gap-2">
                <strong className="text-sm text-[var(--foreground)]">Instructions</strong>
                <div className="grid gap-2 md:grid-cols-4">
                  {CONVERT_BRIEF_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`grid gap-1 rounded-md border p-3 text-left ${convertDraft.briefMode === option.value ? "border-[rgba(94,234,212,0.42)] bg-[rgba(20,184,166,0.12)]" : "border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.46)]"}`}
                      onClick={() => setConvertDraft((current) => ({ ...current, briefMode: option.value }))}
                    >
                      <span className="text-sm font-bold text-[var(--foreground)]">{option.label}</span>
                      <span className="text-[11px] leading-4 text-[var(--muted)]">{option.detail}</span>
                    </button>
                  ))}
                </div>
                <p className="m-0 rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(2,6,23,0.30)] p-3 text-xs leading-5 text-[var(--muted)]">{convertBrief(convertSkill, convertDraft.briefMode)}</p>
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-xs text-[var(--muted)]">
                  Model
                  <select className="min-h-9 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.72)] px-2 text-[var(--foreground)]" value={convertDraft.model} onChange={(event) => setConvertDraft((current) => ({ ...current, model: event.target.value }))}>
                    {CONVERT_MODEL_OPTIONS.map((model) => <option key={model.value || "default"} value={model.value}>{model.label}</option>)}
                  </select>
                </label>
                <div className="grid gap-1 text-xs text-[var(--muted)]">
                  Duty state
                  <div className="inline-flex rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.45)] p-1">
                    {[
                      { value: false, label: "Off duty" },
                      { value: true, label: "On duty" },
                    ].map((option) => (
                      <button
                        key={String(option.value)}
                        type="button"
                        className={`flex-1 rounded px-3 py-2 text-xs font-bold ${convertDraft.onDuty === option.value ? "bg-[rgba(94,234,212,0.18)] text-[var(--accent-strong)]" : "text-[var(--muted)]"}`}
                        onClick={() => setConvertDraft((current) => ({ ...current, onDuty: option.value }))}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            <div className="grid gap-2 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.30)] p-3 text-xs leading-5 text-[var(--muted)]">
              <div><strong className="text-[var(--foreground)]">What happens:</strong> this skill becomes available in AEON, with the schedule, instructions, model, and duty state you choose here.</div>
              <div><strong className="text-[var(--foreground)]">Keys:</strong> no secret values are copied by this action. Missing keys stay handled by the keys section below.</div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="rounded border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.36)] px-2 py-1 text-xs text-[var(--foreground)]">{scheduleFromConvertDraft(convertDraft)}</code>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" onClick={() => setConvertSkill(null)}>Cancel</Button>
                <Button type="button" onClick={() => void convertSharedSkillToAeon()} disabled={actionBusy === `convert:${convertSkill.slug}`}>
                  {actionBusy === `convert:${convertSkill.slug}` ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Rocket aria-hidden="true" />}
                  Create automation
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {githubRepoModalOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(2,6,23,0.72)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Configure AEON GitHub repo">
          <div className="grid max-h-[calc(100vh-2rem)] w-full max-w-3xl gap-4 overflow-auto rounded-lg border border-[rgba(94,234,212,0.24)] bg-[rgba(10,14,21,0.96)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">AEON GitHub repo</p>
                <h3 className="m-0 text-lg font-bold text-[var(--foreground)]">{githubRepoModalView === "create" ? "Create and link repo" : "Choose a repo"}</h3>
                <p className="m-0 mt-1 text-sm leading-6 text-[var(--muted)]">{githubRepoModalView === "create" ? "Create a GitHub repo, set it as this local AEON repo's origin, then return to the overview." : "Pick an existing GitHub repo or create a new one for this AEON workspace."}</p>
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label="Close repo selector" onClick={() => setGithubRepoModalOpen(false)}>
                <X aria-hidden="true" />
              </Button>
            </div>

            {githubRepoError ? (
              <p className="m-0 rounded-md border border-rose-300/24 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{githubRepoError}</p>
            ) : null}

            {githubRepoModalView === "select" ? (
              <div className="grid gap-3">
                {githubRepoLoading ? (
                  <div className="grid min-h-[110px] place-items-center rounded-lg border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.46)] text-sm text-[var(--muted)]">
                    <span className="inline-flex items-center gap-2"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> Loading repos...</span>
                  </div>
                ) : githubRepoOptions.length ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <button
                      type="button"
                      className="grid min-h-[220px] content-center justify-items-center gap-3 rounded-lg border border-dashed border-[rgba(94,234,212,0.42)] bg-[rgba(20,184,166,0.06)] p-4 text-center text-[var(--accent-strong)] transition hover:bg-[rgba(20,184,166,0.11)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(94,234,212,0.42)]"
                      onClick={() => setGithubRepoModalView("create")}
                    >
                      <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-[rgba(94,234,212,0.36)] bg-[rgba(20,184,166,0.12)]">
                        <Plus aria-hidden="true" className="h-6 w-6" />
                      </span>
                      <span className="text-sm font-bold">Create new GitHub repo</span>
                    </button>
                    {githubRepoOptions.map((repo) => (
                      <article key={repo.fullName} className="grid min-h-[220px] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 rounded-lg border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.48)] p-4">
                        <div className="min-w-0 space-y-2">
                          <h4 className="m-0 break-words text-sm font-bold text-[var(--foreground)]">{repo.fullName}</h4>
                          <span className="inline-flex w-fit rounded-full border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.36)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{repo.private ? "Private" : "Public"} · {repo.defaultBranch || "main"}</span>
                        </div>
                        <p className="m-0 overflow-hidden text-xs leading-5 text-[var(--muted)] [display:-webkit-box] [-webkit-line-clamp:4] [-webkit-box-orient:vertical]">{repo.description || "No description."}</p>
                        <Button type="button" size="sm" className="w-full" onClick={() => void connectGithubRepo(repo)} disabled={Boolean(githubRepoBusy)}>
                          {githubRepoBusy === `connect:${repo.fullName}` ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <GitBranch aria-hidden="true" />}
                          Connect
                        </Button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <button
                      type="button"
                      className="grid min-h-[220px] content-center justify-items-center gap-3 rounded-lg border border-dashed border-[rgba(94,234,212,0.42)] bg-[rgba(20,184,166,0.06)] p-4 text-center text-[var(--accent-strong)] transition hover:bg-[rgba(20,184,166,0.11)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(94,234,212,0.42)]"
                      onClick={() => setGithubRepoModalView("create")}
                    >
                      <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-[rgba(94,234,212,0.36)] bg-[rgba(20,184,166,0.12)]">
                        <Plus aria-hidden="true" className="h-6 w-6" />
                      </span>
                      <span className="text-sm font-bold">Create new GitHub repo</span>
                    </button>
                    <p className="m-0 rounded-lg border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.46)] p-4 text-sm text-[var(--muted)]">No repos returned for this GitHub account yet.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-4">
                <label className="grid gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                  Repo name
                  <input
                    value={githubRepoCreateDraft.name}
                    onChange={(event) => setGithubRepoCreateDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="aeon-test"
                    className="min-h-11 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.50)] px-3 text-base normal-case tracking-normal text-[var(--foreground)] outline-none transition focus:border-[rgba(94,234,212,0.52)]"
                  />
                </label>

                <button
                  type="button"
                  className="flex items-center justify-between gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.42)] px-3 py-2 text-left text-sm font-bold text-[var(--foreground)]"
                  onClick={() => setGithubRepoAdvancedOpen((open) => !open)}
                >
                  Advanced
                  <ChevronLeft aria-hidden="true" className={`h-4 w-4 transition ${githubRepoAdvancedOpen ? "-rotate-90" : "rotate-180"}`} />
                </button>
                {githubRepoAdvancedOpen ? (
                  <div className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.28)] p-3 md:grid-cols-2">
                    <label className="grid gap-1 text-xs text-[var(--muted)]">
                      Organization
                      <input value={githubRepoCreateDraft.owner} onChange={(event) => setGithubRepoCreateDraft((current) => ({ ...current, owner: event.target.value }))} placeholder="blank for personal account" className="min-h-10 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.50)] px-3 text-sm text-[var(--foreground)] outline-none" />
                    </label>
                    <label className="grid gap-1 text-xs text-[var(--muted)]">
                      Visibility
                      <select value={githubRepoCreateDraft.visibility} onChange={(event) => setGithubRepoCreateDraft((current) => ({ ...current, visibility: event.target.value }))} className="min-h-10 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.50)] px-3 text-sm text-[var(--foreground)] outline-none">
                        <option value="private">Private</option>
                        <option value="public">Public</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs text-[var(--muted)] md:col-span-2">
                      Description
                      <input value={githubRepoCreateDraft.description} onChange={(event) => setGithubRepoCreateDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Optional" className="min-h-10 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.50)] px-3 text-sm text-[var(--foreground)] outline-none" />
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-[var(--foreground)] md:col-span-2">
                      <input type="checkbox" checked={githubRepoCreateDraft.autoPush} onChange={(event) => setGithubRepoCreateDraft((current) => ({ ...current, autoPush: event.target.checked }))} />
                      Push this local AEON repo after linking
                    </label>
                  </div>
                ) : null}
                <div className="flex flex-wrap justify-between gap-2">
                  <Button type="button" variant="ghost" onClick={() => setGithubRepoModalView("select")}>Back</Button>
                  <Button type="button" onClick={() => void createGithubRepo()} disabled={!githubRepoCreateDraft.name.trim() || Boolean(githubRepoBusy)}>
                    {githubRepoBusy === "create" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Plus aria-hidden="true" />}
                    {githubRepoBusy === "create" ? "Creating..." : "Create and link"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className={detailView === "overview" ? "grid gap-3 xl:grid-cols-[1.05fr_0.95fr]" : detailView === "settings" ? "contents" : "hidden"}>
        <section className={`${detailView === "overview" ? "xl:col-span-2" : "hidden"} overflow-hidden rounded-lg border border-[rgba(94,234,212,0.24)] bg-[radial-gradient(circle_at_12%_20%,rgba(94,234,212,0.16),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.92),rgba(8,13,22,0.82))] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.24)]`}>
          {resolvedGithubReady === undefined ? (
            <div className="grid min-h-[220px] place-items-center rounded-xl border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.42)]">
              <span className="inline-flex items-center gap-2 text-sm text-[var(--muted)]">
                <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                Checking AEON connection…
              </span>
            </div>
          ) : resolvedGithubReady ? (
            <div className="relative isolate overflow-hidden rounded-xl border border-[rgba(94,234,212,0.22)] bg-[linear-gradient(135deg,rgba(8,13,22,0.55),rgba(13,20,31,0.5))] p-6 sm:p-7">
              <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.22),transparent_70%)] blur-2xl" />
              <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-12 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(20,184,166,0.14),transparent_70%)] blur-2xl" />

              <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="grid gap-4">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 font-bold text-emerald-100">
                      <Check aria-hidden="true" className="h-3 w-3" /> GitHub connected
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(94,234,212,0.28)] bg-[rgba(20,184,166,0.12)] px-2.5 py-1 font-bold text-[var(--accent-strong)]">
                      <GitBranch aria-hidden="true" className="h-3 w-3" /> {githubRepo}
                    </span>
                  </div>

                  <div className="flex items-start gap-4">
                    <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[rgba(94,234,212,0.34)] bg-[linear-gradient(135deg,rgba(20,184,166,0.3),rgba(8,47,73,0.32))] text-[var(--accent-strong)] shadow-[0_0_34px_rgba(45,212,191,0.28)]">
                      <Rocket aria-hidden="true" className="h-7 w-7" />
                      <Sparkles aria-hidden="true" className="absolute -right-1.5 -top-1.5 h-4 w-4 text-amber-200" />
                    </span>
                    <div className="grid gap-1.5">
                      <p className="eyebrow">Aeon Autopilot · Ready</p>
                      <h3 className="m-0 text-2xl font-bold leading-tight text-[var(--foreground)] sm:text-[28px]">
                        {schedules.length ? "Create a new automation" : "Create your first automation"}
                      </h3>
                      <p className="m-0 max-w-xl text-sm leading-6 text-[var(--muted)]">
                        GitHub and <strong className="font-semibold text-[var(--foreground)]">{githubRepo}</strong> are wired up. Pick a skill, choose a cadence, and AEON arms it as a scheduled workflow — no YAML or Actions setup.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      { Icon: Clock3, title: "Runs on a schedule", body: "Cron, hourly, daily, or manual." },
                      { Icon: Sparkles, title: "Driven by your skills", body: "Attach a shared-brain skill." },
                      { Icon: ListChecks, title: "Outputs tracked", body: "Every run is logged for review." },
                    ].map(({ Icon, title, body }) => (
                      <div key={title} className="grid gap-1 rounded-lg border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.5)] p-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)]">
                          <Icon aria-hidden="true" className="h-3.5 w-3.5 text-[var(--accent-strong)]" /> {title}
                        </span>
                        <span className="text-[11px] leading-4 text-[var(--muted)]">{body}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 lg:w-60">
                  <Button
                    type="button"
                    onClick={createAeonAutomation}
                    className="min-h-12 justify-center bg-[linear-gradient(135deg,rgba(45,212,191,0.26),rgba(20,184,166,0.16))] px-5 text-sm font-bold shadow-[0_0_28px_rgba(45,212,191,0.22)] [&_svg]:size-4"
                  >
                    <Plus aria-hidden="true" />
                    Create automation
                  </Button>
                  {schedules.length ? (
                    <Button type="button" variant="secondary" className="min-h-10 justify-center" onClick={openAeonScheduler}>
                      <Clock3 aria-hidden="true" />
                      View {schedules.length} automation{schedules.length === 1 ? "" : "s"}
                    </Button>
                  ) : (
                    <Button type="button" variant="secondary" className="min-h-10 justify-center" onClick={() => setDetailView("work")}>
                      <Sparkles aria-hidden="true" />
                      Browse skills
                    </Button>
                  )}
                </div>
              </div>

              <div className="relative mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[rgba(148,163,184,0.12)] pt-3 text-[11px] text-[var(--muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-emerald-300/80" />
                  Connection ready
                </span>
                <button type="button" onClick={openGithubRepoModal} className="font-semibold text-[var(--accent-strong)] underline-offset-2 transition hover:underline">Change repo</button>
                <button type="button" onClick={openGithubConnectionSettings} className="font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)]">Reconnect GitHub</button>
                <button
                  type="button"
                  onClick={() => void syncSecrets()}
                  disabled={actionBusy === "sync-secrets" || actionBusy === "sync-all-secrets"}
                  className="font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-45"
                >
                  {actionBusy === "sync-secrets" ? "Syncing keys…" : syncSecretsSucceeded ? "Keys synced" : "Sync keys"}
                </button>
              </div>
            </div>
          ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={`grid min-h-[220px] grid-cols-[72px_minmax(0,1fr)] gap-4 rounded-lg border p-4 ${githubSecretReady ? "border-emerald-300/24 bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(15,23,42,0.42))]" : "border-[rgba(94,234,212,0.22)] bg-[rgba(15,23,42,0.44)]"}`}>
              <span className={`flex h-16 w-16 items-center justify-center rounded-md border text-5xl font-black leading-none ${githubSecretReady ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-[rgba(94,234,212,0.32)] bg-[rgba(20,184,166,0.10)] text-[var(--accent-strong)]"}`}>1</span>
              <div className="grid min-w-0 gap-3">
                <div>
                  <p className="eyebrow">Connect GitHub</p>
                  <h3 className="m-0 text-2xl font-bold leading-tight text-[var(--foreground)]">{githubSecretReady ? "OAuth connected" : "Authorize account access"}</h3>
                </div>
                <p className="m-0 text-sm leading-6 text-[var(--muted)]">
                  {githubSecretReady ? <>AEON can use GitHub OAuth through <code className="rounded border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.38)] px-1.5 py-0.5 text-[var(--foreground)]">GH_GLOBAL</code>.</> : <>Authorize GitHub once so AEON can use Actions, workflow dispatch, issue triggers, and repo sync without pasted tokens.</>}
                </p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className={`rounded-full border px-3 py-1 font-bold ${githubSecretReady ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : "border-amber-300/25 bg-amber-400/10 text-amber-100"}`}>
                    {githubSecret?.isSet ? "GitHub key set" : githubSecretReady ? "GitHub key available" : "GitHub key missing"}
                  </span>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button type="button" onClick={openGithubConnectionSettings}>
                    <GitBranch aria-hidden="true" />
                    {githubSecretReady ? "Reconnect GitHub" : "Connect GitHub"}
                  </Button>
                </div>
              </div>
            </div>
            <div className={`grid min-h-[220px] grid-cols-[72px_minmax(0,1fr)] gap-4 rounded-lg border p-4 ${githubRepo ? "border-emerald-300/24 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(15,23,42,0.42))]" : "border-amber-300/24 bg-[linear-gradient(135deg,rgba(251,191,36,0.10),rgba(15,23,42,0.44))]"}`}>
              <span className={`flex h-16 w-16 items-center justify-center rounded-md border text-5xl font-black leading-none ${githubRepo ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-amber-300/30 bg-amber-400/10 text-amber-100"}`}>2</span>
              <div className="grid min-w-0 gap-3">
                <div>
                  <p className="eyebrow">Configure repo</p>
                  <h3 className="m-0 text-2xl font-bold leading-tight text-[var(--foreground)]">{githubRepo ? "Repo selected" : "Choose the AEON repo"}</h3>
                </div>
                <p className="m-0 text-sm leading-6 text-[var(--muted)]">
                  {githubRepo ? <>AEON is pointed at <strong className="font-bold text-[var(--foreground)]">{githubRepo}</strong>. Sync keys when you want GitHub Actions to receive shared secrets.</> : "OAuth is account access. AEON still needs the owner/repo that should run workflows and receive synced secrets."}
                </p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className={`rounded-full border px-3 py-1 font-bold ${githubRepo ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : "border-amber-300/25 bg-amber-400/10 text-amber-100"}`}>
                    {githubRepo ? `Repo: ${githubRepo}` : "Repo not configured"}
                  </span>
                  <span className={`rounded-full border px-3 py-1 font-bold ${githubPowered ? "border-[rgba(94,234,212,0.32)] bg-[rgba(20,184,166,0.12)] text-[var(--accent-strong)]" : "border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.42)] text-[var(--muted)]"}`}>
                    {githubPowered ? "Ready for Actions" : "Local mode still works"}
                  </span>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button type="button" variant={githubRepo ? "secondary" : "default"} onClick={openGithubRepoModal}>
                    <GitBranch aria-hidden="true" />
                    {githubRepo ? "Change repo" : "Configure repo"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => void syncSecrets()} disabled={actionBusy === "sync-secrets" || actionBusy === "sync-all-secrets" || !githubRepo}>
                    {actionBusy === "sync-secrets" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : syncSecretsSucceeded ? <Check aria-hidden="true" /> : <Upload aria-hidden="true" />}
                    {actionBusy === "sync-secrets" ? "Syncing..." : syncSecretsSucceeded ? "Success!" : "Sync keys"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => void syncAllSecrets()} disabled={actionBusy === "sync-secrets" || actionBusy === "sync-all-secrets" || !githubRepo} title="Push every key in your shared brain's shared env to AEON repo secrets">
                    {actionBusy === "sync-all-secrets" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : syncAllSecretsSucceeded ? <Check aria-hidden="true" /> : <Upload aria-hidden="true" />}
                    {actionBusy === "sync-all-secrets" ? "Syncing all..." : syncAllSecretsSucceeded ? "Success!" : "Sync all shared env"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
          )}
        </section>

        <section className="hidden rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(16,20,29,0.78)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">How it works</p>
              <h3 className="m-0 text-base font-bold">Pick work, let AEON handle the routine</h3>
            </div>
            <a
              className="inline-flex items-center gap-1 rounded-md border border-[rgba(148,163,184,0.18)] px-2 py-1 text-xs text-[var(--accent-strong)]"
              href="https://github.com/aaronjmars/aeon"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink aria-hidden="true" className="h-3 w-3" />
              AEON project
            </a>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {AEON_LANES.map((lane) => (
              <article key={lane.title} className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.46)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="m-0 text-sm font-bold text-[var(--foreground)]">{lane.title}</h4>
                  <span className="rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.07)] px-2 py-1 text-[11px] text-[var(--accent-strong)]">{lane.label}</span>
                </div>
                <p className="m-0 mt-2 text-xs leading-5 text-[var(--muted)]">{lane.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={`${detailView === "overview" ? "" : "hidden"} rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(16,20,29,0.78)] p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">At a glance</p>
              <h3 className="m-0 text-base font-bold">Recent activity</h3>
            </div>
            <BarChart3 aria-hidden="true" className="h-5 w-5 text-[var(--accent-strong)]" />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Metric label="Runs" value={analytics?.summary.totalRuns ?? runs.length} />
            <Metric label="Success" value={`${analytics?.summary.successRate ?? 0}%`} />
            <Metric label="Failures" value={analytics?.summary.failure ?? failedRuns} tone={(analytics?.summary.failure ?? failedRuns) > 0 ? "rose" : undefined} />
            <Metric label="Skills used" value={analytics?.summary.uniqueSkills ?? 0} />
          </div>
          <div className="mt-4 grid gap-2">
            {(analytics?.insights ?? []).slice(0, 4).map((insight, index) => (
              <div key={`${insight.message}:${index}`} className={`rounded-md border px-3 py-2 text-xs ${insight.type === "warning" ? "border-amber-300/20 bg-amber-400/10 text-amber-100" : insight.type === "success" ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-[rgba(148,163,184,0.16)] bg-[rgba(10,14,21,0.42)] text-[var(--muted)]"}`}>
                {insight.message}
              </div>
            ))}
            {(analytics?.skills ?? []).slice(0, 5).map((skill) => (
              <div key={skill.slug} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs">
                <span className="truncate text-[var(--muted)]">{skill.name}</span>
                <span className="font-mono text-[var(--foreground)]">{skill.successRate}% · {skill.total}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={`${detailView === "settings" ? "" : "hidden"} rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(16,20,29,0.78)] p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Save and update</p>
              <h3 className="m-0 text-base font-bold">AEON files</h3>
            </div>
            <GitBranch aria-hidden="true" className="h-5 w-5 text-[var(--accent-strong)]" />
          </div>
          <div className="mt-4 grid gap-2 text-sm">
            <StatusRow label="Repo" value={repoSync?.repo || selectedAgent.aeonRepo || "Not configured"} ok={Boolean(repoSync?.repo || selectedAgent.aeonRepo)} />
            <StatusRow label="Branch" value={repoSync?.branch || selectedAgent.aeonBranch || "main"} ok />
            <StatusRow label="Local changes" value={repoSync?.hasChanges ? `${repoSync.changedFiles.length} changed` : "Clean"} ok={!repoSync?.hasChanges} />
            <StatusRow label="Remote delta" value={`${repoSync?.behind ?? 0} behind · ${repoSync?.ahead ?? 0} ahead`} ok={(repoSync?.behind ?? 0) === 0} />
          </div>
          {repoSync?.changedFiles?.length ? (
            <div className="mt-3 max-h-20 overflow-auto rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.38)] p-2 text-[11px] text-[var(--muted)]">
              {repoSync.changedFiles.slice(0, 12).map((file) => <div key={file}>{file}</div>)}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => void runRepoAction("pull")} disabled={actionBusy === "repo:pull"}>
              {actionBusy === "repo:pull" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
              Update from GitHub
            </Button>
            <Button type="button" size="sm" onClick={() => void runRepoAction("push")} disabled={actionBusy === "repo:push"}>
              {actionBusy === "repo:push" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Upload aria-hidden="true" />}
              Save to GitHub
            </Button>
          </div>
        </section>

        <section className={`${detailView === "settings" ? "" : "hidden"} rounded-lg border border-rose-300/20 bg-[linear-gradient(135deg,rgba(127,29,29,0.18),rgba(16,20,29,0.78))] p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Danger zone</p>
              <h3 className="m-0 text-base font-bold">Local workspace cleanup</h3>
            </div>
            <Trash2 aria-hidden="true" className="h-5 w-5 text-rose-200" />
          </div>
          <p className="m-0 mt-3 text-xs leading-5 text-[var(--muted)]">
            Remove the local Git link when you want to keep files but detach this workspace from GitHub. Delete the local repo when the folder should disappear from this AEON list.
          </p>
          <div className="mt-4 grid gap-2 text-sm">
            <StatusRow label="Local path" value={status?.status?.root || selectedAgent.aeonLocalPath || selectedAgent.localDataDir || "~/.aeon"} ok={Boolean(status?.status?.root || selectedAgent.aeonLocalPath || selectedAgent.localDataDir)} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => void deleteAeonWorkspace("delete-git")} disabled={actionBusy === "workspace:delete-git" || !(status?.status?.root || selectedAgent.aeonLocalPath || selectedAgent.localDataDir)}>
              {actionBusy === "workspace:delete-git" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <GitBranch aria-hidden="true" />}
              Delete Git only
            </Button>
            <Button type="button" size="sm" variant="danger" onClick={() => void deleteAeonWorkspace("delete-local")} disabled={actionBusy === "workspace:delete-local" || !(status?.status?.root || selectedAgent.aeonLocalPath || selectedAgent.localDataDir)}>
              {actionBusy === "workspace:delete-local" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Trash2 aria-hidden="true" />}
              Delete local repo
            </Button>
          </div>
        </section>

        <section className={`${detailView === "overview" ? "" : "hidden"} rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(16,20,29,0.78)] p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Ready check</p>
              <h3 className="m-0 text-base font-bold">What AEON can use</h3>
            </div>
            <ListChecks aria-hidden="true" className="h-5 w-5 text-[var(--accent-strong)]" />
          </div>
          <div className="mt-4 grid gap-2">
            {setupItems.map((item) => (
              <StatusRow key={item.label} label={item.label} value={item.detail} ok={item.ok} />
            ))}
          </div>
        </section>
      </div>

      <div className={detailView === "work" ? "grid gap-3" : detailView === "settings" ? "contents" : "hidden"}>
        <section className={`${detailView === "settings" ? "" : "hidden"} rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(16,20,29,0.78)] p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Setup</p>
              <h3 className="m-0 text-base font-bold">Connection and sync</h3>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-bold ${status?.status?.ok ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : "border-amber-300/25 bg-amber-400/10 text-amber-100"}`}>
              {status?.status?.ok ? "Ready" : loading ? "Checking" : "Needs setup"}
            </span>
          </div>
          <div className="mt-4 grid gap-2 text-sm">
            <StatusRow label="Local config" value={status?.status?.hasConfig ? "aeon.yml found" : "Not found"} ok={status?.status?.hasConfig} />
            <StatusRow label="A2A card" value={status?.status?.a2aReachable ? "Reachable" : "Not reachable"} ok={status?.status?.a2aReachable} />
            <StatusRow label="GitHub repo" value={status?.status?.repo || selectedAgent.aeonRepo || "Not configured"} ok={Boolean(status?.status?.repo || selectedAgent.aeonRepo)} />
            <StatusRow label="Local path" value={status?.status?.root || selectedAgent.aeonLocalPath || selectedAgent.localDataDir || "~/.aeon"} ok={Boolean(status?.status?.root || selectedAgent.aeonLocalPath || selectedAgent.localDataDir)} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => void syncSharedSkills()} disabled={actionBusy === "sync-skills"}>
              {actionBusy === "sync-skills" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Bot aria-hidden="true" />}
              Sync skill library
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => void syncSecrets()} disabled={actionBusy === "sync-secrets" || !(selectedAgent.aeonRepo || status?.status?.repo)}>
              {actionBusy === "sync-secrets" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : syncSecretsSucceeded ? <Check aria-hidden="true" /> : <Upload aria-hidden="true" />}
              {actionBusy === "sync-secrets" ? "Syncing..." : syncSecretsSucceeded ? "Success!" : "Sync keys"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setActiveView("files")}>
              <FileText aria-hidden="true" />
              Files
            </Button>
          </div>
          <details className="mt-4 rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,21,0.34)] p-3">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-bold uppercase text-[var(--muted)]">
              <MemoryStick aria-hidden="true" className="h-3.5 w-3.5 text-[var(--accent-strong)]" />
              Advanced file map
            </summary>
            <div className="grid gap-2">
              {AEON_PATHS.map((path) => (
                <div key={path.label} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-[var(--muted)]">{path.label}</span>
                  <code className="rounded border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.36)] px-2 py-1 text-[var(--foreground)]">{path.value}</code>
                </div>
              ))}
            </div>
          </details>
        </section>

        <section className={`${detailView === "work" ? "" : "hidden"} rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(16,20,29,0.78)] p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Skills</p>
              <h3 className="m-0 text-base font-bold">{(allSkills?.shared.length ?? 0) + visibleSkills.filter((skill) => !sharedSkillBySlug.has(skill.slug)).length} available · {scheduledSkillCount} set up</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setImportOpen((open) => !open)}>
                <FileUp aria-hidden="true" />
                Import skill
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={openAeonScheduler}>
                <Clock3 aria-hidden="true" />
                Scheduler
              </Button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.34)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.45)] p-1">
                {([
                  { value: "aeon" as const, label: "AEON" },
                  { value: "shared" as const, label: "Shared Brain" },
                ]).map((view) => (
                  <button
                    key={view.value}
                    type="button"
                    className={`rounded px-3 py-1.5 text-xs font-bold ${skillSourceView === view.value ? "bg-[rgba(94,234,212,0.18)] text-[var(--accent-strong)]" : "text-[var(--muted)]"}`}
                    onClick={() => {
                      setSkillSourceView(view.value);
                      setSkillCategoryFilter("all");
                    }}
                  >
                    {view.label}
                  </button>
                ))}
              </div>
              <label className="relative min-w-56 flex-1">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  value={skillSearch}
                  onChange={(event) => setSkillSearch(event.target.value)}
                  placeholder="Search skills..."
                  className="w-full rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.50)] py-2 pl-9 pr-3 text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-bold ${skillCategoryFilter === "all" ? "border-[rgba(94,234,212,0.38)] bg-[rgba(94,234,212,0.14)] text-[var(--accent-strong)]" : "border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.35)] text-[var(--muted)]"}`}
                onClick={() => setSkillCategoryFilter("all")}
              >
                All
                <span className="rounded border border-[rgba(148,163,184,0.18)] px-1.5 py-0.5 text-[10px]">{groupedSkills.reduce((total, group) => total + group.skills.length, 0)}</span>
              </button>
              {categoryFilterOptions.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-bold ${skillCategoryFilter === category.id ? "border-[rgba(94,234,212,0.38)] bg-[rgba(94,234,212,0.14)] text-[var(--accent-strong)]" : "border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.35)] text-[var(--muted)]"}`}
                  onClick={() => setSkillCategoryFilter(category.id)}
                >
                  <i className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color }} />
                  {category.label}
                  <span className="rounded border border-[rgba(148,163,184,0.18)] px-1.5 py-0.5 text-[10px]">{category.count}</span>
                </button>
              ))}
            </div>
            {importOpen ? (
              <div className="grid gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <strong className="text-sm text-[var(--foreground)]">Drop-in skill folder</strong>
                    <p className="m-0 mt-1 text-xs text-[var(--muted)]">Imports into Shared Brain first, then AEON sees it through the same sync path.</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[rgba(94,234,212,0.22)] px-3 py-2 text-xs font-bold text-[var(--accent-strong)]">
                    Choose folder
                    <input
                      type="file"
                      className="sr-only"
                      multiple
                      ref={(input) => {
                        if (input) input.setAttribute("webkitdirectory", "");
                      }}
                      onChange={(event) => void readUploadedFiles(event.currentTarget.files)}
                    />
                  </label>
                </div>
                {importFiles.length ? (
                  <div className="grid gap-2">
                    <input
                      value={importName}
                      onChange={(event) => setImportName(event.target.value)}
                      placeholder="optional-skill-name"
                      className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.50)] px-3 py-2 text-sm text-[var(--foreground)] outline-none"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
                      <span>{importFiles.length} file{importFiles.length === 1 ? "" : "s"} ready</span>
                      <Button type="button" size="sm" onClick={() => void importUploadedSkill()} disabled={actionBusy === "import-skill"}>
                        {actionBusy === "import-skill" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
                        Add to Shared Brain
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {visibleSkillRows.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleSkillRows.map((skill) => {
                const canAutomateRuntime = Boolean(skill.runtimeSkill && skill.automationState === "ready");
                const canOpenConvert = Boolean(!canAutomateRuntime && skill.sharedSkill && skill.automationState === "available");
                const canRun = Boolean(skill.runtimeSkill?.runtimeSchedule);
                const actionBusyKey = skill.automationState === "on-duty" ? `disable:${skill.slug}` : skill.automationState === "paused" ? `enable:${skill.slug}` : canAutomateRuntime ? `automate:${skill.slug}` : `convert:${skill.slug}`;
                return (
                  <div
                    key={`${skill.source}:${skill.slug}`}
                    className={`flex h-full flex-col gap-3 rounded-md border px-4 py-3 transition hover:border-[rgba(94,234,212,0.32)] hover:bg-[rgba(94,234,212,0.08)] ${selectedSkillSlug === skill.slug ? "border-[rgba(94,234,212,0.4)] bg-[rgba(94,234,212,0.12)]" : "border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,21,0.38)]"}`}
                  >
                    <button
                      type="button"
                      className="grid min-w-0 flex-1 content-start gap-1.5 text-left"
                      onClick={() => {
                        setSelectedSkillSlug(skill.slug);
                        const runtimeSkill = visibleSkills.find((item) => item.slug === skill.slug);
                        const schedule = schedules.find((item) => item.id === skill.slug);
                        setSkillDraft({
                          schedule: schedule?.every || runtimeSkill?.schedule || "",
                          var: runtimeSkill?.var || schedule?.message || "",
                          model: runtimeSkill?.model || String(schedule?.metadata?.model || ""),
                        });
                      }}
                    >
                      <span className="text-sm font-bold text-[var(--foreground)] [overflow-wrap:anywhere]">{skill.name}</span>
                      <span className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
                        <span>{skill.statusLabel} · {skill.runtimeSkill ? skillSourceLabel(skill.runtimeSkill.source) : "Shared Brain"}</span>
                        {skill.runtimeSkill?.automationYaml ? (
                          <span className="rounded border border-[rgba(94,234,212,0.18)] px-2 py-0.5 text-[var(--accent-strong)]">Agent recipe</span>
                        ) : null}
                        <span className="inline-flex items-center gap-1 rounded border border-[rgba(148,163,184,0.14)] px-2 py-0.5 uppercase">
                          <i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: skill.categoryColor }} />
                          {skill.categoryLabel}
                        </span>
                      </span>
                    </button>
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      {canAutomateRuntime && skill.runtimeSkill ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => void automateAeonSkill(skill.runtimeSkill!)} disabled={actionBusy === actionBusyKey}>
                          {actionBusy === actionBusyKey ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Rocket aria-hidden="true" />}
                          {skill.actionLabel}
                        </Button>
                      ) : canOpenConvert && skill.sharedSkill ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => openConvertModal(skill.sharedSkill!)} disabled={actionBusy === actionBusyKey}>
                          {actionBusy === actionBusyKey ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Rocket aria-hidden="true" />}
                          {skill.actionLabel}
                        </Button>
                      ) : skill.automationState === "manual" ? (
                        <Button type="button" size="sm" onClick={() => void runScheduleAction("run-now", skill.slug)} disabled={!canRun || actionBusy === `run-now:${skill.slug}`}>
                          {actionBusy === `run-now:${skill.slug}` ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Play aria-hidden="true" />}
                          {skill.actionLabel}
                        </Button>
                      ) : skill.automationState === "on-duty" || skill.automationState === "paused" ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => void runScheduleAction(skill.automationState === "on-duty" ? "disable" : "enable", skill.slug)} disabled={!canRun || actionBusy === actionBusyKey}>
                          {actionBusy === actionBusyKey ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Power aria-hidden="true" />}
                          {skill.actionLabel}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
                })}
              </div>
            ) : (
              <EmptyState
                icon={<Bot aria-hidden="true" />}
                text={skillSourceView === "aeon" ? aeonEmptyText : "No Shared Brain skills match this filter yet."}
              />
            )}
          </div>
          {selectedSkill ? (
            <div className="mt-4 grid gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Skill detail</p>
                  <h4 className="m-0 text-base font-bold text-[var(--foreground)]">{selectedSkill.name}</h4>
                  <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">{selectedSkill.description || "No description yet."}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => void runScheduleAction("run-now", selectedSkill.slug)} disabled={!selectedScheduleIds.has(selectedSkill.slug) || actionBusy === `run-now:${selectedSkill.slug}`}>
                    {actionBusy === `run-now:${selectedSkill.slug}` ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Play aria-hidden="true" />}
                    Run now
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void runScheduleAction((selectedSkill.runtimeSchedule?.enabled ?? selectedSkill.enabled) ? "disable" : "enable", selectedSkill.slug)} disabled={!selectedScheduleIds.has(selectedSkill.slug)}>
                    <Power aria-hidden="true" />
                    {(selectedSkill.runtimeSchedule?.enabled ?? selectedSkill.enabled) ? "Off duty" : "On duty"}
                  </Button>
                </div>
              </div>
              <details className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.28)] p-3">
                <summary className="cursor-pointer text-xs font-bold uppercase text-[var(--muted)]">Advanced settings</summary>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <label className="grid gap-1 text-xs text-[var(--muted)]">
                    Schedule
                    <input value={selectedDraft.schedule} onChange={(event) => setSkillDraft((current) => ({ ...current, schedule: event.target.value }))} onBlur={() => void updateSelectedSkill("schedule", selectedDraft.schedule)} className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.5)] px-3 py-2 text-[var(--foreground)] outline-none" />
                  </label>
                  <label className="grid gap-1 text-xs text-[var(--muted)]">
                    Instructions
                    <input value={selectedDraft.var} onChange={(event) => setSkillDraft((current) => ({ ...current, var: event.target.value }))} onBlur={() => void updateSelectedSkill("var", selectedDraft.var)} className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.5)] px-3 py-2 text-[var(--foreground)] outline-none" />
                  </label>
                  <label className="grid gap-1 text-xs text-[var(--muted)]">
                    Skill model override
                    <input value={selectedDraft.model} onChange={(event) => setSkillDraft((current) => ({ ...current, model: event.target.value }))} onBlur={() => void updateSelectedSkill("model", selectedDraft.model)} placeholder="Blank uses repo default" className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.5)] px-3 py-2 text-[var(--foreground)] outline-none" />
                  </label>
                </div>
              </details>
              <div className="grid gap-2">
                <strong className="text-xs uppercase text-[var(--muted)]">Recent runs for this skill</strong>
                {selectedSkillRuns.slice(0, 4).map((run) => (
                  <button key={run.id} type="button" className="flex items-center justify-between gap-2 rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,21,0.42)] px-3 py-2 text-left text-xs" onClick={() => void loadRunLog(run)}>
                    <span className="text-[var(--foreground)]">{run.name}</span>
                    <span className={`rounded-full border px-2 py-1 font-bold ${statusTone(run.status)}`}>{run.conclusion || run.status}</span>
                  </button>
                ))}
                {!selectedSkillRuns.length ? <p className="m-0 text-xs text-[var(--muted)]">No recent runs matched this skill yet.</p> : null}
              </div>
            </div>
          ) : null}
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {inventoryRows.map((row) => (
              <div key={row.label} className="rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,21,0.34)] p-3">
                <div className="text-lg font-bold text-[var(--foreground)]">{row.value}</div>
                <div className="text-[11px] uppercase text-[var(--muted)]">{row.label}</div>
              </div>
            ))}
          </div>
          <details className="mt-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.34)] p-3">
            <summary className="cursor-pointer text-xs font-bold uppercase text-[var(--muted)]">Advanced inventory breakdown</summary>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
              {sourceCounts(skills).map(([source, count]) => (
                <span key={source} className="rounded-md border border-[rgba(148,163,184,0.14)] px-2 py-1">{source}: {count}</span>
              ))}
              {modelCounts(skills, schedules).map(([model, count]) => (
                <span key={model} className="rounded-md border border-[rgba(94,234,212,0.16)] px-2 py-1 text-[var(--accent-strong)]">{model}: {count}</span>
              ))}
            </div>
          </details>
        </section>
      </div>

      <div className={detailView === "activity" || detailView === "deliverables" ? "grid gap-3 xl:grid-cols-2" : detailView === "settings" ? "contents" : "hidden"}>
        <section className={`${detailView === "activity" ? "" : "hidden"} rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(16,20,29,0.78)] p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Runs</p>
              <h3 className="m-0 text-base font-bold">Recent runs</h3>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-md border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-emerald-100">{successfulRuns} ok</span>
              <span className="rounded-md border border-rose-300/20 bg-rose-400/10 px-2 py-1 text-rose-100">{failedRuns} failed</span>
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            {runs.slice(0, 8).map((run) => (
              <article key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.48)] p-3">
                <div className="min-w-0">
                  <h4 className="m-0 text-sm font-bold text-[var(--foreground)]">{run.name}</h4>
                  <p className="m-0 mt-1 text-xs text-[var(--muted)]">{timeLabel(run.createdAt)} · {run.conclusion || run.status}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusTone(run.status)}`}>{run.status}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void loadRunLog(run)} disabled={runLogLoading === run.id}>
                    {runLogLoading === run.id ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <FileText aria-hidden="true" />}
                    Logs
                  </Button>
                  {run.url ? (
                    <a className="inline-flex items-center gap-1 rounded-md border border-[rgba(148,163,184,0.18)] px-2 py-1 text-xs text-[var(--accent-strong)]" href={run.url} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden="true" className="h-3 w-3" />
                      Open
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
            {!runs.length ? <EmptyState icon={<Activity aria-hidden="true" />} text="No recent AEON runs returned yet." /> : null}
            {selectedRunLog ? (
              <article className="grid gap-2 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm text-[var(--foreground)]">Run evidence</strong>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedRunLog(null)}>Close</Button>
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.48)] p-3 text-[11px] leading-5 text-[var(--muted)]">{selectedRunLog.summary || selectedRunLog.logs || "No logs returned."}</pre>
                {selectedRunLog.logs && selectedRunLog.logs !== selectedRunLog.summary ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-[var(--accent-strong)]">Full logs</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.48)] p-3 text-[11px] leading-5 text-[var(--muted)]">{selectedRunLog.logs}</pre>
                  </details>
                ) : null}
              </article>
            ) : null}
          </div>
        </section>

        <section className={`${detailView === "activity" ? "" : "hidden"} rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(16,20,29,0.78)] p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Outputs</p>
              <h3 className="m-0 text-base font-bold">Latest artifacts</h3>
            </div>
            <Rocket aria-hidden="true" className="h-5 w-5 text-[var(--accent-strong)]" />
          </div>
          <div className="mt-4 grid gap-2">
            {outputs.slice(0, 6).map((output) => (
              <article key={`${output.source}:${output.filename}`} className="grid gap-2 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.48)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="m-0 text-sm font-bold text-[var(--foreground)]">{output.skill || output.filename || "Aeon output"}</h4>
                  <span className="rounded-md border border-[rgba(148,163,184,0.14)] px-2 py-1 text-[11px] text-[var(--muted)]">{timeLabel(output.updatedAt)}</span>
                </div>
                <p className="m-0 whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">{output.excerpt || "No preview text."}</p>
                <div className="flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
                  <span className="rounded-md border border-[rgba(148,163,184,0.14)] px-2 py-1">{output.source || "outputs"}</span>
                  <span className="rounded-md border border-[rgba(148,163,184,0.14)] px-2 py-1">{output.filename || "file"}</span>
                </div>
              </article>
            ))}
            {!outputs.length ? <EmptyState icon={<FileText aria-hidden="true" />} text="No Aeon output files returned yet." /> : null}
          </div>
        </section>

        <div className={detailView === "deliverables" ? "xl:col-span-2" : "hidden"}>
          <AeonDeliverablesPanel
            deliverables={selectedNewDeliverables}
            loading={deliverablesLoading}
            actionBusy={actionBusy}
            machines={aeonRepoMachines}
            status={deliverablesStatus}
            selectedTransfer={selectedTransferDeliverable}
            onRefresh={() => void refreshDeliverablesForAgent(selectedAgent)}
            onOpen={(deliverable) => void openDeliverable(deliverable, "open")}
            onReveal={(deliverable) => void openDeliverable(deliverable, "reveal")}
            onDownload={(deliverable) => void downloadDeliverable(deliverable)}
            onOpenTransfer={setSelectedTransferDeliverable}
            onCloseTransfer={() => setSelectedTransferDeliverable(null)}
            onSendToMachine={(deliverable, machine) => void sendDeliverableToMachine(deliverable, machine)}
          />
        </div>

        <section className={`${detailView === "settings" ? "" : "hidden"} rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(16,20,29,0.78)] p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Keys</p>
              <h3 className="m-0 text-base font-bold">What AEON can access</h3>
            </div>
            <KeyRound aria-hidden="true" className="h-5 w-5 text-[var(--accent-strong)]" />
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {(secrets?.keys ?? SECRET_MANIFEST.map((secret) => ({ ...secret, isSet: false, availableInSharedEnv: false, availableLocally: false, usedIn: [] }))).map((secret) => (
              <div key={secret.key} className={`rounded-md border p-3 ${secret.isSet ? "border-emerald-300/20 bg-emerald-400/10" : secret.availableInSharedEnv || secret.availableLocally ? "border-amber-300/20 bg-amber-400/10" : "border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.48)]"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-bold text-[var(--foreground)]">{secret.key}</div>
                  <span className="rounded-full border border-[rgba(148,163,184,0.18)] px-2 py-1 text-[10px] text-[var(--muted)]">
                    {secret.isSet ? "Set in AEON" : secret.availableInSharedEnv ? "In shared env" : secret.availableLocally ? "Local only" : "Missing"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">{secret.label}</div>
                {secret.usedIn?.length ? <div className="mt-2 text-[11px] text-[var(--muted)]">Used in: {secret.usedIn.slice(0, 3).join(", ")}</div> : null}
                {!secret.isSet && (secret.availableInSharedEnv || secret.availableLocally) ? (
                  <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => void syncSecrets()} disabled={actionBusy === "sync-secrets"}>
                    <Upload aria-hidden="true" />
                    Copy to AEON
                  </Button>
                ) : !secret.isSet ? (
                  <Button type="button" size="sm" variant="ghost" className="mt-3" onClick={() => { setVaultPanelMode("env"); setActiveView("vault"); }}>
                    <ShieldCheck aria-hidden="true" />
                    Guided setup
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-md border border-[rgba(94,234,212,0.14)] bg-[rgba(20,184,166,0.06)] p-3 text-xs leading-5 text-[var(--muted)]">
            Default sync pushes the core keys only: {DEFAULT_SECRET_KEYS.join(", ")}. Optional notification and provider keys stay visible here as the expected AEON surface. Use <strong className="font-bold text-[var(--foreground)]">Sync all shared env</strong> to push every key in your shared brain&apos;s shared env section.
          </div>
        </section>

        <section className={`${detailView === "settings" ? "" : "hidden"} rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(16,20,29,0.78)] p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Memory</p>
              <h3 className="m-0 text-base font-bold">What AEON remembers</h3>
            </div>
            <MemoryStick aria-hidden="true" className="h-5 w-5 text-[var(--accent-strong)]" />
          </div>
          {memory?.index ? (
            <p className="mt-4 max-h-28 overflow-auto whitespace-pre-wrap rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.38)] p-3 text-xs leading-5 text-[var(--muted)]">{memory.index.slice(0, 1200)}</p>
          ) : (
            <EmptyState icon={<MemoryStick aria-hidden="true" />} text="No AEON memory index returned yet." />
          )}
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {(["topics", "logs", "issues"] as const).map((kind) => (
              <div key={kind} className="rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,21,0.34)] p-3">
                <div className="mb-2 flex items-center justify-between text-xs uppercase text-[var(--muted)]">
                  <strong>{kind}</strong>
                  <span>{memory?.[kind]?.length ?? 0}</span>
                </div>
                <div className="grid gap-2">
                  {(memory?.[kind] ?? []).slice(0, 3).map((item) => (
                    <article key={item.path} className="grid gap-1 rounded-md bg-[rgba(2,6,23,0.36)] p-2">
                      <strong className="text-xs text-[var(--foreground)]">{item.title}</strong>
                      <span className="text-[11px] leading-4 text-[var(--muted)]">{item.excerpt || item.path}</span>
                    </article>
                  ))}
                  {!(memory?.[kind]?.length) ? <span className="text-xs text-[var(--muted)]">Nothing indexed yet.</span> : null}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-md border border-[rgba(94,234,212,0.14)] bg-[rgba(20,184,166,0.06)] p-3 text-xs leading-5 text-[var(--muted)]">
            Obsidian mirror: keep the AEON repo and {`Agents/AEON/<repo>/`} synced with Unison, then let the shared vault sync carry that repo view across machines.
          </div>
          <div className="mt-3 grid gap-2 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.34)] p-3">
            <StatusRow label="Mirror status" value={obsidianMirrorStatus} ok={obsidianMirrorRunning === true} />
            <StatusRow label="Vault folder" value={obsidianSync?.vaultRepoRoot || "Agents/AEON/<repo>"} ok={Boolean(obsidianSync?.vaultRepoRoot)} />
            <div className="flex flex-wrap gap-2">
              <ObsidianMirrorToggle
                running={obsidianMirrorRunning}
                busy={actionBusy === "obsidian-sync:start" || actionBusy === "obsidian-sync:stop"}
                disabled={actionBusy.startsWith("obsidian-sync:") || obsidianSync?.installed === false || obsidianMirrorRunning === null}
                onToggle={() => void runObsidianSyncAction(obsidianSync?.running ? "stop" : "start")}
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => void runObsidianSyncAction("once")} disabled={actionBusy.startsWith("obsidian-sync:") || obsidianSync?.installed === false}>
                {actionBusy === "obsidian-sync:once" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Upload aria-hidden="true" />}
                Sync once
              </Button>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,21,0.42)] px-3 py-2">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="inline-flex items-center gap-2 text-right text-[var(--foreground)]">
        {ok ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-200" /> : <GitBranch aria-hidden="true" className="h-3.5 w-3.5 text-amber-200" />}
        {value}
      </span>
    </div>
  );
}

function ObsidianMirrorToggle({ running, busy, disabled, onToggle }: { running: boolean | null; busy: boolean; disabled: boolean; onToggle: () => void }) {
  const checked = running === true;
  return (
    <label className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-bold ${disabled ? "cursor-not-allowed border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,21,0.26)] text-[var(--muted)] opacity-70" : "cursor-pointer border-[rgba(94,234,212,0.22)] bg-[rgba(20,184,166,0.08)] text-[var(--foreground)] hover:bg-[rgba(20,184,166,0.12)]"}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${checked ? "border-[rgba(94,234,212,0.72)] bg-[rgba(94,234,212,0.34)]" : running === null ? "border-[rgba(148,163,184,0.22)] bg-[rgba(148,163,184,0.12)]" : "border-[rgba(148,163,184,0.28)] bg-[rgba(2,6,23,0.58)]"}`}
      >
        <span className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-transform ${checked ? "translate-x-[18px] bg-[var(--accent-strong)]" : running === null ? "translate-x-[10px] bg-[var(--muted)]" : "translate-x-0.5 bg-[var(--muted)]"}`} />
      </span>
      <span>{checked ? "Obsidian mirror on" : running === null ? "Checking mirror" : "Obsidian mirror off"}</span>
      {busy ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-[var(--accent-strong)]" /> : null}
    </label>
  );
}

function ConvertInfo({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="grid gap-1 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.30)] p-3">
      <span className="text-[11px] font-bold uppercase text-[var(--muted)]">{label}</span>
      <span className="text-sm font-bold text-[var(--foreground)]">{value}</span>
      <span className="break-words text-[11px] leading-4 text-[var(--muted)]">{detail}</span>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "rose" }) {
  return (
    <div className={`rounded-md border p-3 ${tone === "rose" ? "border-rose-300/20 bg-rose-400/10" : "border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,21,0.34)]"}`}>
      <div className="text-lg font-bold text-[var(--foreground)]">{value}</div>
      <div className="text-[11px] uppercase text-[var(--muted)]">{label}</div>
    </div>
  );
}

function AeonFleetMeta({ label, value }: { label: string; value: string }) {
  return (
    <span className="grid min-w-0 justify-items-center gap-0.5 rounded border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.50)] px-2 py-1">
      <span className="text-[8px] font-bold uppercase leading-3 text-[var(--muted)]">{label}</span>
      <span className="w-full min-w-0 break-all text-center text-[10px] font-bold leading-3 text-[var(--foreground)]">{value}</span>
    </span>
  );
}

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.48)] p-4 text-sm text-[var(--muted)]">
      <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[rgba(148,163,184,0.16)] text-[var(--accent-strong)] [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <span>{text}</span>
    </div>
  );
}
