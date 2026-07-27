"use client";

import * as React from "react";
import { AeonOrb, Btn, Eyebrow, Icon, Pill, Stat, aeonStyles as styles } from "./parts";
import { AeonFleet } from "./fleet";
import { AeonOverview } from "./overview";
import { AeonWork, type SkillActionKind } from "./work";
import { AeonActivity } from "./activity";
import { AeonDeliverables } from "./deliverables";
import { AeonSettings } from "./settings";
import { AeonControlPlane } from "./control-plane";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AEON_AGENTS, AEON_ANALYTICS, AEON_DELIVERABLES, AEON_MACHINES, AEON_MEMORY, AEON_SKILLS,
  CONVERT_BRIEF_OPTIONS, CONVERT_MODEL_OPTIONS, CONVERT_SCHEDULE_OPTIONS,
  type AeonAgent, type AeonAnalytics, type AeonDeliverable, type AeonMachine, type AeonMemory, type AeonOutput,
  type AeonPathEntry, type AeonRun, type AeonSecret, type AeonSkill, type ConvertScheduleMode, type AeonCategoryId,
} from "./aeon-data";
import type { LinkedDirectory, MachineGroup } from "@/features/dashboard/dashboard-types";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";
import type {
  RuntimeAnalytics,
  RuntimeMemorySnapshot,
  RuntimeRepoSyncStatus,
  RuntimeRun,
  RuntimeRunLog,
  RuntimeSecretStatus,
  RuntimeSkill,
} from "@/lib/services/runtime-adapters/types";
import type { KanbanMachineTarget } from "@/lib/types/kanban";
import { Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";

export type AeonDetailView = "overview" | "work" | "activity" | "deliverables" | "control" | "settings";
type IconName = Parameters<typeof Icon>[0]["name"];
const OFFICIAL_AEON_REPO_URL = "https://github.com/aaronjmars/aeon.git";
const CLONE_STEP_MS = 1300;

const DETAIL_TABS: { id: AeonDetailView; label: string; detail: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", detail: "Status & next actions", icon: "bot" },
  { id: "work", label: "Work", detail: "Skills & automation", icon: "sparkles" },
  { id: "activity", label: "Activity", detail: "Runs & outputs", icon: "activity" },
  { id: "deliverables", label: "Deliverables", detail: "Artifacts & handoff", icon: "layers" },
  { id: "control", label: "Control", detail: "Packs, MCP & identity", icon: "shield" },
  { id: "settings", label: "Settings", detail: "Repo, keys, memory", icon: "key" },
];

function accentStyle(hex?: string): React.CSSProperties {
  if (!hex) return {};
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(h)) return {};
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return {
    "--aeon": hex,
    "--aeon-deep": hex,
    "--aeon-soft": `rgba(${r},${g},${b},0.14)`,
    "--aeon-line": `rgba(${r},${g},${b},0.30)`,
    "--aeon-glow": `rgba(${r},${g},${b},0.34)`,
    "--cyan-2": hex,
    "--cyan-3": hex,
  } as React.CSSProperties;
}

function folderSlug(value: string, fallback = "aeon-workspace") {
  return (value || fallback)
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || fallback;
}

function joinDisplayPath(parentPath: string, name: string) {
  const parent = (parentPath.trim() || "~/.aeon-repos").replace(/\/+$/, "");
  return `${parent}/${folderSlug(name)}`;
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
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

function titleFromSlug(slug: string) {
  return slug.split(/[-_]/).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ") || slug;
}

function formatAeonWhen(value?: string) {
  if (!value) return "unknown";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const diff = Date.now() - time;
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))}m ago`;
  if (diff < day) return `${Math.round(diff / hour)}h ago`;
  if (diff < day * 7) return `${Math.round(diff / day)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(time));
}

function formatAeonDuration(start?: string, end?: string) {
  if (!start || !end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

function scheduleLabel(schedule?: string) {
  const value = schedule?.trim();
  if (!value || value === "manual" || value === "workflow_dispatch") return "Manual";
  return value;
}

function aeonCategory(value?: string): AeonCategoryId {
  const lower = value?.toLowerCase() ?? "";
  if (/research|digest|read|rank/.test(lower)) return "research";
  if (/trade|market|wallet|bank|price|token/.test(lower)) return "trading";
  if (/social|post|twitter|farcaster/.test(lower)) return "social";
  if (/mail|slack|discord|telegram|notify|comms/.test(lower)) return "comms";
  if (/ops|sync|repo|index|secret|key|action|github/.test(lower)) return "ops";
  return "knowledge";
}

function aeonSkillSource(source?: string): AeonSkill["source"] {
  if (source === "shared-brain") return "shared-brain";
  if (source === "aeon-cli") return "aeon-cli";
  if (source === "aeon-skill-folder") return "aeon-skill-folder";
  return "aeon.yml";
}

function aeonSkillState(skill: RuntimeSkill): AeonSkill["state"] {
  if (skill.enabled === true) return "on-duty";
  if (skill.enabled === false) return skill.schedule && skill.schedule !== "manual" ? "paused" : "manual";
  return skill.source === "shared-brain" ? "available" : "ready";
}

function runtimeSkillToAeon(skill: RuntimeSkill): AeonSkill {
  return {
    slug: skill.slug,
    name: skill.name || titleFromSlug(skill.slug),
    cat: aeonCategory(skill.category || skill.source || skill.description),
    source: aeonSkillSource(skill.source),
    state: aeonSkillState(skill),
    schedule: skill.schedule || "manual",
    scheduleLabel: scheduleLabel(skill.schedule),
    model: skill.model || "AEON default",
    desc: skill.description || skill.var || `Run ${titleFromSlug(skill.slug)} with AEON.`,
  };
}

function runtimeRunToAeon(run: RuntimeRun): AeonRun {
  return {
    id: run.id,
    name: run.name || "Aeon run",
    status: run.status === "active" || run.status === "queued" ? "active" : run.status === "failed" ? "failed" : "completed",
    conclusion: run.conclusion || run.status,
    when: formatAeonWhen(run.createdAt || run.updatedAt),
    dur: formatAeonDuration(run.createdAt, run.updatedAt) || "runtime",
  };
}

type RuntimeOutput = { filename?: string; skill?: string; source?: string; updatedAt?: string; excerpt?: string };

function runtimeOutputToAeon(output: RuntimeOutput): AeonOutput {
  const filename = output.filename || "output";
  return {
    skill: output.skill || titleFromSlug(filename.replace(/\.[^.]+$/, "")),
    filename,
    source: output.source || "AEON output",
    when: formatAeonWhen(output.updatedAt),
    excerpt: output.excerpt || "",
  };
}

function outputToDeliverable(output: AeonOutput, agent: AeonAgent): AeonDeliverable {
  return {
    id: `${agent.id}:${output.filename}`,
    kind: output.filename.endsWith(".json") ? "json" : "posts",
    title: output.skill || output.filename,
    source: "aeon-output",
    status: "ready",
    when: output.when,
    sim: "",
    size: 0,
    local: true,
    file: output.filename,
    repo: agent.repo || agent.localPath,
    purpose: `Artifact produced by ${output.skill || "AEON"}.`,
    preview: output.excerpt,
  };
}

function runtimeSecretsToAeon(status?: RuntimeSecretStatus): AeonSecret[] {
  return (status?.keys ?? []).map((key) => ({
    key: key.key,
    label: key.label,
    status: key.isSet ? "set" : key.availableInSharedEnv ? "shared" : key.availableLocally ? "local" : "missing",
    usedIn: key.usedIn,
  }));
}

function runtimeMemoryToAeon(memory?: RuntimeMemorySnapshot): AeonMemory {
  const mapItems = (items: RuntimeMemorySnapshot["topics"]) => items.map((item) => ({ title: item.title, excerpt: item.excerpt }));
  return {
    index: memory?.index || "",
    topics: mapItems(memory?.topics ?? []),
    logs: mapItems(memory?.logs ?? []),
    issues: mapItems(memory?.issues ?? []),
  };
}

function runtimeAnalyticsToAeon(analytics?: RuntimeAnalytics): AeonAnalytics {
  return {
    totalRuns: analytics?.summary.totalRuns ?? 0,
    successRate: analytics?.summary.successRate ?? 0,
    failure: analytics?.summary.failure ?? 0,
    uniqueSkills: analytics?.summary.uniqueSkills ?? 0,
    insights: analytics?.insights ?? [],
    topSkills: (analytics?.skills ?? []).map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      successRate: skill.successRate,
      total: skill.total,
    })),
  };
}

function pulseFromRuns(runs: RuntimeRun[]) {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (6 - index));
    return day;
  });
  return days.map((day) => runs.filter((run) => {
    const time = new Date(run.createdAt || run.updatedAt || "").getTime();
    return Number.isFinite(time) && time >= day.getTime() && time < day.getTime() + 86_400_000;
  }).length);
}

function runtimePaths(agent: AeonAgent, memory?: RuntimeMemorySnapshot) {
  return [
    { label: "Workspace", value: agent.localPath || memory?.root || "" },
    { label: "Config", value: agent.localPath ? `${agent.localPath.replace(/\/+$/, "")}/aeon.yml` : "aeon.yml" },
    { label: "Skills", value: agent.localPath ? `${agent.localPath.replace(/\/+$/, "")}/skills` : "skills" },
    { label: "Memory", value: memory?.root ? `${memory.root.replace(/\/+$/, "")}/memory` : "memory" },
  ].filter((entry) => entry.value);
}

type RuntimeStatusPayload = { root?: string; repo?: string; hasConfig?: boolean; generation?: "v0.1" | "legacy" | "invalid"; cliAvailable?: boolean; catalogAvailable?: boolean; localSkillCount?: number; harness?: string; gateway?: string };
type AeonRuntimeData = {
  loading: boolean;
  error: string;
  status?: RuntimeStatusPayload;
  skills: AeonSkill[];
  runs: AeonRun[];
  runtimeRuns: RuntimeRun[];
  outputs: AeonOutput[];
  deliverables: AeonDeliverable[];
  analytics: AeonAnalytics;
  pulse: number[];
  secrets: AeonSecret[];
  paths: AeonPathEntry[];
  memory: AeonMemory;
  repoSync?: RuntimeRepoSyncStatus;
};

function emptyRuntimeData(): AeonRuntimeData {
  return {
    loading: false,
    error: "",
    skills: [],
    runs: [],
    runtimeRuns: [],
    outputs: [],
    deliverables: [],
    analytics: AEON_ANALYTICS,
    pulse: [],
    secrets: [],
    paths: [],
    memory: AEON_MEMORY,
  };
}

function hydrateAgentWithRuntime(agent: AeonAgent, data?: AeonRuntimeData): AeonAgent {
  if (!data) return agent;
  const active = data.runs.find((run) => run.status === "active");
  const onDuty = data.skills.filter((skill) => skill.state === "on-duty").length;
  return {
    ...agent,
    repo: agent.repo || data.status?.repo || data.repoSync?.repo || null,
    localPath: agent.localPath || data.status?.root || data.repoSync?.root || "",
    onDuty,
    skills: data.skills.length,
    runs: data.analytics.totalRuns || data.runs.length,
    handoffs: data.deliverables.length,
    successRate: data.analytics.successRate,
    now: active ? { state: "working", skill: active.name, since: active.when, progress: 0.5 } : onDuty ? { state: "scheduled" } : agent.now,
  };
}

function aeonMachineCollectorUrl(machine: MachineGroup) {
  return machine.collectorUrl || "";
}

function aeonAgentFromProfile(profile: AgentProfile): AeonAgent {
  const repo = profile.aeonRepo?.trim() || null;
  const localPath = profile.aeonLocalPath || profile.localDataDir || "";
  const mode: AeonAgent["mode"] = profile.aeonMode === "github" || repo ? "GitHub" : "Local path";
  return {
    id: profile.id,
    name: profile.name || profile.aeonRepoName || profile.agentId || "AEON Workspace",
    repo,
    mode,
    branch: profile.aeonBranch || "main",
    localPath,
    machine: profile.machineName || "local",
    onDuty: 0,
    skills: 0,
    runs: 0,
    handoffs: 0,
    successRate: 0,
    now: { state: "idle" },
    tagline: localPath ? `Linked to ${localPath}.` : "AEON workspace is ready for setup.",
  };
}

function dedupeAeonAgents(list: AeonAgent[]) {
  const byId = new Map<string, AeonAgent>();
  list.forEach((agent) => {
    if (!byId.has(agent.id)) byId.set(agent.id, agent);
  });
  return Array.from(byId.values());
}

// ---------- modal shell ----------
function Modal({ title, eyebrow, subtitle, onClose, children, wide }: { title: string; eyebrow?: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: 18, background: "rgba(2,6,12,0.7)", backdropFilter: "blur(4px)" }}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className={`${styles.scroll} ${styles.rise}`} style={{ width: "100%", maxWidth: wide ? 720 : 560, maxHeight: "calc(100vh - 36px)", overflow: "auto",
        background: "var(--bg-1)", border: "1px solid var(--aeon-line)", borderRadius: "var(--r-lg)", padding: 22, boxShadow: "0 30px 90px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            {eyebrow && <Eyebrow color="var(--cyan-2)">{eyebrow}</Eyebrow>}
            <h3 style={{ margin: "4px 0 4px", fontFamily: "var(--f-display)", fontSize: 19, fontWeight: 700, color: "var(--fg)" }}>{title}</h3>
            {subtitle && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--fg-3)", maxWidth: 460 }}>{subtitle}</p>}
          </div>
          <Btn size="icon" variant="ghost" onClick={onClose}><Icon name="x" size={18} /></Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

type AutomationConfig = { summary: string; duty: boolean; schedule: string; brief: string; model: string };

function ComposeModal({ skill, onClose, onCreate }: { skill: AeonSkill | null; onClose: () => void; onCreate: (skill: AeonSkill | null, cfg: AutomationConfig) => void | Promise<void> }) {
  const [sched, setSched] = React.useState<ConvertScheduleMode>("daily");
  const [brief, setBrief] = React.useState("description");
  const [model, setModel] = React.useState("");
  const [duty, setDuty] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const summary = sched === "manual" ? "Manual dispatch" : sched === "hourly" ? "Every hour" : sched === "daily" ? "Daily at 09:00" : sched === "weekdays" ? "Weekdays at 09:00" : "Weekly · Mon 09:00";
  const cron = sched === "manual" ? "manual" : sched === "hourly" ? "0 * * * *" : sched === "weekdays" ? "0 9 * * 1-5" : sched === "weekly" ? "0 9 * * 1" : "0 9 * * *";
  const opt = (active: boolean): React.CSSProperties => ({ padding: 11, borderRadius: 9, textAlign: "left", cursor: "pointer", border: `1px solid ${active ? "var(--aeon-line)" : "var(--line)"}`, background: active ? "var(--aeon-soft)" : "rgba(2,6,23,0.3)" });
  return (
    <Modal wide eyebrow="Automate with AEON" title={skill ? skill.name : "Create automation"}
      subtitle={skill ? (skill.desc || "Mirror this skill into AEON and arm it as a scheduled workflow.") : "Pick a skill, choose a cadence, and AEON arms it as a scheduled workflow — no YAML or Actions."} onClose={onClose}>
      <div style={{ display: "grid", gap: 18 }}>
        <section style={{ display: "grid", gap: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 13, color: "var(--fg)" }}>Run cadence</strong>
            <Pill tone="cyan">{summary}</Pill>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 7 }}>
            {CONVERT_SCHEDULE_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => setSched(o.value)} style={opt(sched === o.value)}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg)" }}>{o.label}</div>
                <div style={{ fontSize: 10.5, lineHeight: 1.35, color: "var(--fg-4)", marginTop: 3 }}>{o.detail}</div>
              </button>
            ))}
          </div>
        </section>
        <section style={{ display: "grid", gap: 9 }}>
          <strong style={{ fontSize: 13, color: "var(--fg)" }}>Instructions</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 7 }}>
            {CONVERT_BRIEF_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => setBrief(o.value)} style={opt(brief === o.value)}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg)" }}>{o.label}</div>
                <div style={{ fontSize: 10.5, lineHeight: 1.35, color: "var(--fg-4)", marginTop: 3 }}>{o.detail}</div>
              </button>
            ))}
          </div>
        </section>
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span className={styles.monoCap} style={{ color: "var(--fg-4)" }}>Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)} style={{ padding: "9px 11px", borderRadius: 9, fontSize: 13, background: "rgba(2,6,23,0.5)", border: "1px solid var(--line-2)", color: "var(--fg)", fontFamily: "var(--f-body)" }}>
              {CONVERT_MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <div style={{ display: "grid", gap: 6 }}>
            <span className={styles.monoCap} style={{ color: "var(--fg-4)" }}>Duty state</span>
            <div style={{ display: "inline-flex", padding: 3, borderRadius: 9, background: "rgba(2,6,23,0.5)", border: "1px solid var(--line-2)" }}>
              {[{ v: false, l: "Off duty" }, { v: true, l: "On duty" }].map((o) => (
                <button key={o.l} onClick={() => setDuty(o.v)} style={{ flex: 1, padding: "7px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", border: 0, color: duty === o.v ? "var(--cyan-3)" : "var(--fg-4)", background: duty === o.v ? "var(--aeon-soft)" : "transparent" }}>{o.l}</button>
              ))}
            </div>
          </div>
        </section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <code style={{ fontSize: 11.5, fontFamily: "var(--f-mono)", padding: "5px 9px", borderRadius: 7, background: "rgba(2,6,23,0.5)", border: "1px solid var(--line)", color: "var(--fg-2)" }}>{cron}</code>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" icon={saving ? undefined : "rocket"} disabled={saving} onClick={() => { setSaving(true); void Promise.resolve(onCreate(skill, { summary, duty, schedule: cron, brief, model })).finally(() => setSaving(false)); }}>{saving ? <><Spinner />Creating</> : "Create automation"}</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SendModal({ deliverable, machines, onClose, onSend }: { deliverable: AeonDeliverable; machines: AeonMachine[]; onClose: () => void; onSend: (m: AeonMachine) => void }) {
  return (
    <Modal wide eyebrow="Target machine" title={deliverable.title} subtitle="Send this artifact to another machine over the tailnet." onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {machines.map((m) => (
          <button key={m.key} onClick={() => onSend(m)} style={{ display: "grid", gap: 9, padding: 14, borderRadius: 11, textAlign: "left", cursor: "pointer", border: "1px solid var(--line)", background: "var(--panel-bg-soft)", transition: "all 140ms" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aeon-line)"; e.currentTarget.style.background = "var(--aeon-soft)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.background = "var(--panel-bg-soft)"; }}>
            <span style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 9, color: "var(--cyan-2)", background: "var(--aeon-soft)", border: "1px solid var(--aeon-line)" }}><Icon name="drive" size={18} /></span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--fg)" }}>{m.name}</div>
              <div style={{ fontSize: 11, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 2 }}>{m.url}</div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

type WorkspaceView = "choice" | "clone" | "official" | "cloning" | "created";
type WorkspaceCreatedOptions = { close?: boolean; openDetail?: boolean; toast?: boolean };
type OfficialCloneToggle = {
  label: string;
  detail: string;
  checked: boolean;
  setChecked: React.Dispatch<React.SetStateAction<boolean>>;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
};

export function WorkspaceModal({
  existingAgents,
  machineGroups = [],
  sharedVault,
  chooseDirectoryForMachine,
  onClose,
  onCreated,
  onToast,
}: {
  existingAgents: AgentProfile[];
  machineGroups?: MachineGroup[];
  sharedVault?: SharedVaultConfig;
  chooseDirectoryForMachine?: (machine: KanbanMachineTarget | null, onChoose: (directory: LinkedDirectory) => void) => void | Promise<void>;
  onClose: () => void;
  onCreated: (agent: AgentProfile, options?: WorkspaceCreatedOptions) => void;
  onToast?: (message: string) => void;
}) {
  const [view, setView] = React.useState<WorkspaceView>("choice");
  const [actionBusy, setActionBusy] = React.useState("");
  const [repoUrl, setRepoUrl] = React.useState("");
  const [officialCloneName, setOfficialCloneName] = React.useState("aeon");
  const [officialCloneLocation, setOfficialCloneLocation] = React.useState("~/Documents");
  const [officialCloneFork, setOfficialCloneFork] = React.useState(true);
  const [officialClonePrivateRepo, setOfficialClonePrivateRepo] = React.useState(true);
  const [officialCloneInjectSecrets, setOfficialCloneInjectSecrets] = React.useState(true);
  const [officialCloneCache, setOfficialCloneCache] = React.useState(true);
  const [cloneCacheStatus, setCloneCacheStatus] = React.useState<{ exists: boolean; behind: number; path?: string } | null>(null);
  const [cloneSteps, setCloneSteps] = React.useState<Array<{ key: string; label: string; icon: IconName }>>([]);
  const [cloneStepIndex, setCloneStepIndex] = React.useState(0);
  const [createdAgent, setCreatedAgent] = React.useState<AgentProfile | null>(null);
  const [error, setError] = React.useState("");
  const cloneRunIdRef = React.useRef(0);
  const aeonRepoMachines = React.useMemo<KanbanMachineTarget[]>(() => {
    const targets = machineGroups
      .filter((machine) => machine.key !== "unassigned" && machine.collector === "ready")
      .map((machine) => ({
        key: machine.key,
        name: machine.self ? `${machine.name} (This Mac)` : machine.name,
        collectorUrl: aeonMachineCollectorUrl(machine),
      }))
      .filter((machine) => Boolean(machine.collectorUrl));
    return targets.length ? targets : [{ key: "local", name: "This Mac", collectorUrl: "" }];
  }, [machineGroups]);
  const officialClonePath = joinDisplayPath(officialCloneLocation || "~/Documents", officialCloneName || "aeon");
  const officialCloneBusy = actionBusy === "github:fork" || actionBusy === "github:create" || actionBusy === "workspace:clone" || actionBusy === "sync-all-secrets" || actionBusy === "cache-refresh";
  const cloneTotal = cloneSteps.length;
  const cloneComplete = cloneTotal > 0 && cloneStepIndex >= cloneTotal;
  const clonePct = cloneTotal ? Math.round((Math.min(cloneStepIndex, cloneTotal) / cloneTotal) * 100) : 0;
  const cloneActiveStep = cloneComplete ? null : cloneSteps[Math.min(cloneStepIndex, Math.max(0, cloneTotal - 1))] ?? null;
  const officialCloneToggles: OfficialCloneToggle[] = [
    {
      label: "GitHub 1-Step Setup",
      detail: "Sets up GitHub while cloning so this AEON Agent is connected for origin, Actions, pushes, and secret injection.",
      checked: officialCloneFork,
      setChecked: setOfficialCloneFork,
    },
    {
      label: "Private GitHub repo",
      detail: "Creates a private repo in your GitHub, points the clone at it, and pushes AEON there. Turn off to use a normal GitHub fork.",
      checked: officialClonePrivateRepo,
      setChecked: setOfficialClonePrivateRepo,
      disabled: !officialCloneFork,
    },
    {
      label: "Inject required AEON secrets",
      detail: "Pushes core credentials for the selected harness/gateway plus required enabled-skill keys from v0.1 frontmatter.",
      checked: officialCloneInjectSecrets,
      setChecked: setOfficialCloneInjectSecrets,
      disabled: !officialCloneFork,
    },
    {
      label: "Keep a local copy for faster future clones",
      detail: `Stores a reusable copy at ~/.hivemindos/aeon-repo-cache.${officialCloneCache && cloneCacheStatus?.exists ? (cloneCacheStatus.behind > 0 ? ` Local copy is ${cloneCacheStatus.behind} commit${cloneCacheStatus.behind === 1 ? "" : "s"} behind upstream.` : " Local copy is up to date.") : ""}`,
      checked: officialCloneCache,
      setChecked: setOfficialCloneCache,
      onChange: (checked) => {
        if (checked) void checkCloneCacheStatus();
        else setCloneCacheStatus(null);
      },
    },
  ];

  React.useEffect(() => () => {
    cloneRunIdRef.current += 1;
  }, []);

  const syncObsidianMirror = async (agent: AgentProfile) => postJson<{ running?: boolean; error?: string; message?: string }>("/api/runtimes/aeon/obsidian-sync", {
    agent,
    vaultPath: sharedVault?.vaultPath || "",
    action: "start",
  }).catch((err) => ({
    running: false,
    error: err instanceof Error ? err.message : "AEON Obsidian mirror did not start.",
  }));

  const runWorkspaceAction = async (
    action: "clone" | "link",
    input: Record<string, string>,
    options: WorkspaceCreatedOptions = {},
  ) => {
    setActionBusy(`workspace:${action}`);
    setError("");
    try {
      const data = await postJson<{ agent?: AgentProfile; root?: string }>("/api/runtimes/aeon/workspaces", { action, ...input });
      if (!data.agent) throw new Error("AEON workspace was prepared, but no profile was returned.");
      onCreated(data.agent, options);
      const mirror = await syncObsidianMirror(data.agent);
      const root = data.root || data.agent.aeonLocalPath || data.agent.localDataDir || "the AEON workspace";
      onToast?.(mirror.running
        ? `Linked AEON repo workspace at ${root}. Obsidian mirror is running.`
        : `Linked AEON repo workspace at ${root}. ${mirror.error || "Obsidian mirror is not running yet."}`);
      return data.agent;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare AEON workspace.");
      return null;
    } finally {
      setActionBusy("");
    }
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
    setError("");
    try {
      const data = await postJson<{ exists?: boolean; behind?: number; path?: string }>("/api/runtimes/aeon/workspaces", {
        action: "cache-refresh",
        repoUrl: OFFICIAL_AEON_REPO_URL,
      });
      setCloneCacheStatus({ exists: Boolean(data.exists), behind: data.behind ?? 0, path: data.path });
      onToast?.("Updated the local AEON copy to the latest commit.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the local AEON copy.");
    } finally {
      setActionBusy("");
    }
  };

  const openOfficialCloneView = async () => {
    setView("official");
    setError("");
    setCloneCacheStatus(null);
    if (officialCloneCache) void checkCloneCacheStatus();
    const existing = new Set<string>();
    existingAgents.forEach((agent) => {
      existing.add(agent.name || "");
      existing.add(agent.aeonRepoName || "");
      existing.add((agent.aeonLocalPath || agent.localDataDir || "").split("/").filter(Boolean).at(-1) || "");
      const repoName = agent.aeonRepo?.trim().replace(/\.git$/i, "").split("/").filter(Boolean).at(-1);
      if (repoName) existing.add(repoName);
    });
    try {
      const response = await fetch("/api/runtimes/aeon/github-repos", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { ok?: boolean; repos?: Array<{ name?: string; fullName?: string }> } | null;
      if (response.ok && data?.ok !== false) {
        for (const repo of data?.repos ?? []) {
          existing.add(repo.name || "");
          existing.add(repo.fullName?.split("/").at(-1) || "");
        }
      }
    } catch {
      // Existing local AEON names are enough for a collision-free default.
    }
    setOfficialCloneName(nextAeonName(existing, "aeon"));
  };

  const browseOfficialCloneLocation = async () => {
    const machine = aeonRepoMachines[0] ?? null;
    if (chooseDirectoryForMachine && machine) {
      await chooseDirectoryForMachine(machine, (directory) => {
        if (directory.path) setOfficialCloneLocation(directory.path);
      });
      return;
    }
    const response = await fetch("/api/agents/browse-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPath: officialCloneLocation || "~/Documents", prompt: "Choose where to clone AEON:" }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { path?: string } | null;
    if (response?.ok && data?.path) setOfficialCloneLocation(data.path);
  };

  const browseExistingWorkspace = async () => {
    setActionBusy("workspace:browse");
    setError("");
    try {
      const machine = aeonRepoMachines[0] ?? null;
      if (chooseDirectoryForMachine && machine) {
        await chooseDirectoryForMachine(machine, (directory) => {
          if (directory.path) {
            void runWorkspaceAction("link", {
              path: directory.path,
              machineName: machine.name,
              machineKey: machine.key,
              collectorUrl: machine.collectorUrl || "",
            }, { close: true, openDetail: true });
          }
        });
      } else {
        const response = await fetch("/api/agents/browse-folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPath: "~", prompt: "Choose an existing AEON repo folder:" }),
        });
        const data = await response.json().catch(() => null) as { path?: string; cancelled?: boolean; error?: string } | null;
        if (data?.path) await runWorkspaceAction("link", { path: data.path }, { close: true, openDetail: true });
        else if (!data?.cancelled) throw new Error(data?.error || "Choose an AEON repo folder.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not browse for an AEON repo.");
    } finally {
      setActionBusy((current) => current === "workspace:browse" ? "" : current);
    }
  };

  const buildCloneSteps = () => {
    const fromCache = officialCloneCache && cloneCacheStatus?.exists;
    const steps: Array<{ key: string; label: string; icon: IconName }> = [
      { key: "init", label: "Initializing AEON workspace", icon: "sparkles" },
      { key: "identity", label: "Provisioning agent identity", icon: "bot" },
    ];
    if (officialCloneFork && !officialClonePrivateRepo) steps.push({ key: "fork", label: "Forking aaronjmars/aeon to your GitHub", icon: "git" });
    steps.push({ key: "clone", label: `${fromCache ? "Duplicating local AEON copy into" : "Cloning AEON into"} ${officialClonePath}`, icon: "download" });
    steps.push({ key: "mirror", label: "Linking Obsidian vault mirror", icon: "refresh" });
    if (officialCloneFork && officialClonePrivateRepo) {
      steps.push({ key: "repo", label: "Creating private GitHub repo", icon: "git" });
      steps.push({ key: "push", label: "Pushing AEON to your repo", icon: "upload" });
    }
    steps.push({ key: "skills", label: "Indexing skills & runtime", icon: "list" });
    if (officialCloneFork && officialCloneInjectSecrets) steps.push({ key: "secrets", label: "Injecting required AEON secrets", icon: "key" });
    steps.push({ key: "mesh", label: "Calibrating neural mesh", icon: "drive" });
    steps.push({ key: "warm", label: "Warming up runtime", icon: "refresh" });
    steps.push({ key: "ready", label: "AEON Agent online", icon: "rocket" });
    return steps;
  };

  const syncSecretsForAgent = async (agent: AgentProfile) => postJson("/api/runtimes/aeon/env/sync", { agent });

  const completeOfficialCloneTail = async (agent: AgentProfile) => {
    const tasks: Array<Promise<unknown>> = [];
    if (officialCloneFork && officialClonePrivateRepo && agent.aeonRepo) {
      tasks.push(postJson("/api/runtimes/aeon/repo/sync", { agent, action: "push" }).catch(() => undefined));
    }
    if (officialCloneFork && officialCloneInjectSecrets && agent.aeonRepo) {
      tasks.push(syncSecretsForAgent(agent).catch(() => undefined));
    }
    if (tasks.length) await Promise.allSettled(tasks);
  };

  const runOfficialCloneWork = async (): Promise<{ ok: true; agent: AgentProfile } | { ok: false; message?: string }> => {
    let nextRepoUrl = OFFICIAL_AEON_REPO_URL;
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
        nextRepoUrl = data.cloneUrl || `https://github.com/${data.repo}.git`;
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Could not fork AEON to your GitHub." };
      }
    }
    const agent = await runWorkspaceAction("clone", {
      repoUrl: nextRepoUrl,
      path: officialClonePath,
      name: officialCloneName,
      unique: "true",
      cache: officialCloneCache ? "true" : "false",
    }, { close: false, openDetail: false, toast: false });
    if (!agent) return { ok: false };
    let created = agent;
    const createdName = agent.aeonRepoName || agent.name || officialCloneName;
    const createdPath = agent.aeonLocalPath || agent.localDataDir || officialClonePath;
    setOfficialCloneName(createdName);
    if (officialCloneFork && officialClonePrivateRepo) {
      setActionBusy("github:create");
      try {
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
        created = { ...agent, aeonRepo: data.repo, aeonBranch: data.branch || "main", aeonMode: "github" };
        onCreated(created, { close: false, openDetail: false, toast: false });
        onToast?.(`Created private GitHub repo ${data.repo}.`);
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Could not create the private GitHub repo." };
      }
    }
    setActionBusy("");
    setOfficialCloneLocation(createdPath.split("/").slice(0, -1).join("/") || officialCloneLocation);
    void completeOfficialCloneTail(created);
    return { ok: true, agent: created };
  };

  const cloneOfficialAeon = async () => {
    const steps = buildCloneSteps();
    const runId = (cloneRunIdRef.current += 1);
    const isCurrent = () => cloneRunIdRef.current === runId;
    setCloneSteps(steps);
    setCloneStepIndex(0);
    setError("");
    setView("cloning");

    const settled = runOfficialCloneWork().then(
      (value) => ({ value }),
      (err) => ({ value: { ok: false as const, message: err instanceof Error ? err.message : "Could not clone official AEON." } }),
    );
    const bail = (message?: string) => {
      if (!isCurrent()) return;
      setActionBusy("");
      if (message) setError(message);
      setView("official");
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
    setCreatedAgent(final.value.agent);
    setView("created");
  };

  const choiceCard = (icon: IconName, title: string, body: React.ReactNode, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={styles.workspaceChoiceCard}
    >
      <span className={styles.workspaceChoiceIcon}>
        <Icon name={icon} size={20} />
      </span>
      <strong className={styles.workspaceChoiceTitle}>{title}</strong>
      <span className={styles.workspaceChoiceBody}>{body}</span>
    </button>
  );

  return (
    <Modal wide eyebrow="AEON repo" title={view === "official" ? "Clone official AEON" : view === "cloning" ? "Cloning official AEON" : view === "created" ? "AEON Agent created" : "Clone or import an AEON repo"}
      subtitle={view === "choice" ? "Use the previous AEON repo setup flow: clone any repo, clone official AEON with GitHub setup, or import an existing folder." : undefined}
      onClose={view === "cloning" ? () => undefined : onClose}>
      <div style={{ display: "grid", gap: 16 }}>
        {error ? <div style={{ borderRadius: 10, border: "1px solid rgba(251,113,133,0.35)", background: "rgba(251,113,133,0.10)", color: "var(--danger-2)", padding: "10px 12px", fontSize: 12.5 }}>{error}</div> : null}

        {view === "choice" ? (
          <div className={styles.workspaceChoiceGrid}>
            {choiceCard("download", "Clone local copy", <>Paste any AEON GitHub repo URL and clone it into <code>~/.aeon-repos/</code>.</>, () => { setRepoUrl(""); setError(""); setView("clone"); })}
            {choiceCard("git", "Clone official AEON", <>Fork or copy <code>aaronjmars/aeon</code>, clone it into <code>~/Documents</code>, and link it.</>, () => void openOfficialCloneView())}
            {choiceCard("folder", "Import existing", "Choose an AEON repo folder that already exists locally and link it.", () => void browseExistingWorkspace())}
          </div>
        ) : null}

        {view === "clone" ? (
          <>
            <label style={{ display: "grid", gap: 6 }}>
              <span className={styles.monoCap} style={{ color: "var(--fg-4)" }}>GitHub repository URL</span>
              <input value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repo.git"
                style={{ padding: "10px 12px", borderRadius: 9, border: "1px solid var(--line-2)", background: "rgba(2,6,23,0.52)", color: "var(--fg)", fontFamily: "var(--f-body)" }} />
            </label>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Btn variant="ghost" onClick={() => setView("choice")} disabled={actionBusy === "workspace:clone"}>Back</Btn>
              <Btn variant="primary" icon={actionBusy === "workspace:clone" ? "refresh" : "download"}
                onClick={() => void runWorkspaceAction("clone", { repoUrl }, { close: true, openDetail: true })}
                disabled={!repoUrl.trim() || actionBusy === "workspace:clone"}>{actionBusy === "workspace:clone" ? "Cloning..." : "Clone and link"}</Btn>
            </div>
          </>
        ) : null}

        {view === "official" ? (
          <div style={{ display: "grid", gap: 13 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className={styles.monoCap} style={{ color: "var(--fg-4)" }}>AEON Agent name</span>
              <input value={officialCloneName} onChange={(event) => setOfficialCloneName(event.target.value)} placeholder="aeon"
                style={{ padding: "10px 12px", borderRadius: 9, border: "1px solid var(--line-2)", background: "rgba(2,6,23,0.52)", color: "var(--fg)", fontFamily: "var(--f-body)" }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className={styles.monoCap} style={{ color: "var(--fg-4)" }}>Location</span>
              <span style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                <input value={officialCloneLocation} onChange={(event) => setOfficialCloneLocation(event.target.value)} placeholder="~/Documents"
                  style={{ minWidth: 0, padding: "10px 12px", borderRadius: 9, border: "1px solid var(--line-2)", background: "rgba(2,6,23,0.52)", color: "var(--fg)", fontFamily: "var(--f-body)" }} />
                <Btn variant="secondary" icon="folder" onClick={() => void browseOfficialCloneLocation()} disabled={officialCloneBusy}>Browse</Btn>
              </span>
            </label>
            <div style={{ borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel-bg-soft)", padding: "10px 12px" }}>
              <div className={styles.monoCap} style={{ color: "var(--fg-4)" }}>Will clone to</div>
              <div style={{ marginTop: 4, fontFamily: "var(--f-mono)", fontSize: 12.5, color: "var(--fg)", overflowWrap: "anywhere" }}>{officialClonePath}</div>
            </div>
            {officialCloneToggles.map((toggle) => (
              <label key={toggle.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "14px 16px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel-bg-soft)", color: "var(--fg)", cursor: officialCloneBusy || toggle.disabled ? "not-allowed" : "pointer" }}>
                <span style={{ display: "grid", gap: 4 }}>
                  <strong style={{ fontSize: 13 }}>{toggle.label}</strong>
                  <span style={{ fontSize: 11.5, lineHeight: 1.45, color: "var(--fg-4)" }}>{toggle.detail}</span>
                </span>
                <Checkbox
                  checked={toggle.checked}
                  disabled={officialCloneBusy || Boolean(toggle.disabled)}
                  onCheckedChange={(value) => {
                    const checked = value === true;
                    toggle.setChecked(checked);
                    toggle.onChange?.(checked);
                  }}
                  className="mt-0.5 size-6 rounded-[6px] border-[rgba(148,163,184,0.38)] bg-[rgba(2,6,23,0.58)] text-white data-[state=checked]:border-[#2dd4bf] data-[state=checked]:bg-[#0284c7] [&_svg]:size-[18px]"
                />
              </label>
            ))}
            {officialCloneCache && cloneCacheStatus?.exists && cloneCacheStatus.behind > 0 ? (
              <Btn variant="secondary" icon="refresh" onClick={() => void updateCloneCache()} disabled={officialCloneBusy || actionBusy === "cache-refresh"} style={{ justifySelf: "start" }}>
                {actionBusy === "cache-refresh" ? "Updating..." : "Update local copy before cloning"}
              </Btn>
            ) : null}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Btn variant="ghost" onClick={() => setView("choice")} disabled={officialCloneBusy}>Back</Btn>
              <Btn variant="primary" icon={officialCloneBusy ? "refresh" : "download"} onClick={() => void cloneOfficialAeon()} disabled={!officialCloneName.trim() || !officialCloneLocation.trim() || officialCloneBusy}>
                {actionBusy === "github:fork" ? "Forking..." : actionBusy === "workspace:clone" ? "Cloning..." : "Clone"}
              </Btn>
            </div>
          </div>
        ) : null}

        {view === "cloning" ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ position: "relative", overflow: "hidden", borderRadius: 12, border: "1px solid var(--aeon-line)", background: "var(--aeon-soft)", padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ display: "grid", placeItems: "center", width: 54, height: 54, borderRadius: 14, border: "1px solid var(--aeon-line)", color: "var(--cyan-2)", background: "rgba(2,6,23,0.34)" }}>
                  <Icon name={cloneComplete ? "check" : cloneActiveStep?.icon ?? "sparkles"} size={24} />
                </span>
                <div>
                  <div className={styles.monoCap} style={{ color: "var(--cyan-2)" }}>{cloneComplete ? "Complete" : `Step ${Math.min(cloneStepIndex + 1, cloneTotal)} of ${cloneTotal}`}</div>
                  <h4 style={{ margin: "3px 0 0", fontSize: 16, color: "var(--fg)" }}>{cloneComplete ? "AEON Agent online" : cloneActiveStep?.label ?? "Working..."}</h4>
                </div>
              </div>
              <div style={{ marginTop: 14, height: 8, overflow: "hidden", borderRadius: 999, background: "rgba(2,6,23,0.55)" }}>
                <div style={{ height: "100%", width: `${Math.max(6, clonePct)}%`, borderRadius: 999, background: "linear-gradient(90deg, rgba(45,212,191,0.95), rgba(94,234,212,0.95))", boxShadow: "0 0 12px rgba(94,234,212,0.6)", transition: "width 700ms ease" }} />
              </div>
            </div>
            <ol style={{ display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
              {cloneSteps.map((step, index) => {
                const state = cloneComplete || index < cloneStepIndex ? "done" : index === cloneStepIndex ? "active" : "todo";
                return (
                  <li key={step.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9, border: `1px solid ${state === "active" ? "var(--aeon-line)" : "transparent"}`, background: state === "active" ? "var(--aeon-soft)" : "transparent", opacity: state === "todo" ? 0.48 : 1 }}>
                    <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 7, border: "1px solid var(--aeon-line)", color: "var(--cyan-2)", background: "rgba(2,6,23,0.32)" }}>
                      <Icon name={state === "done" ? "check" : step.icon} size={14} />
                    </span>
                    <span style={{ color: state === "todo" ? "var(--fg-4)" : "var(--fg)", fontSize: 12.5, fontWeight: state === "todo" ? 500 : 700 }}>{step.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        {view === "created" ? (
          <div style={{ display: "grid", gap: 14, padding: 14, borderRadius: 12, border: "1px solid var(--aeon-line)", background: "var(--aeon-soft)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 10, border: "1px solid var(--aeon-line)", color: "var(--cyan-2)", background: "rgba(2,6,23,0.34)" }}><Icon name="check" size={20} /></span>
              <div>
                <h4 style={{ margin: 0, color: "var(--fg)", fontSize: 16 }}>{officialCloneName || "AEON"} is ready</h4>
                <p style={{ margin: "4px 0 0", color: "var(--fg-3)", fontSize: 12.5, overflowWrap: "anywhere" }}>{createdAgent?.aeonLocalPath || createdAgent?.localDataDir || officialClonePath}</p>
              </div>
            </div>
            <Btn variant="primary" icon="rocket" onClick={() => { if (createdAgent) onCreated(createdAgent, { close: true, openDetail: true }); }} style={{ justifySelf: "end" }}>Open agent</Btn>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function Toast({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div className={styles.rise} style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 80, display: "inline-flex", alignItems: "center", gap: 9,
      padding: "11px 17px", borderRadius: 999, background: "var(--bg-2)", border: "1px solid var(--aeon-line)", boxShadow: "0 18px 50px rgba(0,0,0,0.4)", color: "var(--fg)", fontSize: 13 }}>
      <span style={{ color: "var(--cyan-2)" }}><Icon name="check" size={15} /></span>{msg}
    </div>
  );
}

// ---------- detail shell ----------
interface DetailProps {
  agent: AeonAgent; profile?: AgentProfile; allSkills: AeonSkill[]; deliverables: AeonDeliverable[]; machines: AeonMachine[];
  analytics: AeonAnalytics; pulse: number[]; runs: AeonRun[]; outputs: AeonOutput[];
  secrets: AeonSecret[]; paths: AeonPathEntry[]; memory: AeonMemory; status?: RuntimeStatusPayload; repoSync?: RuntimeRepoSyncStatus;
  loading?: boolean; error?: string; onBack: () => void; toast: (m: string) => void; onRefresh?: () => void; onRepoAction?: (action: "pull" | "push") => void;
  onToggleSkill?: (slug: string, nextState: "on-duty" | "paused") => void | Promise<void>;
  onRunSkill?: (slug: string) => void | Promise<void>;
  onConfigureAutomation?: (skill: AeonSkill, config: AutomationConfig) => void | Promise<void>;
  onLoadRunLog?: (runId: string) => Promise<string>;
  onSyncSkills?: () => void | Promise<void>;
  onSyncKeys?: (keys?: string[]) => void | Promise<void>;
  onMirrorAction?: (action: "start" | "stop" | "once") => void | Promise<void>;
  onSendDeliverable?: (id: string, machineKey: string) => void;
}

function AeonDetail({
  agent, profile, allSkills, deliverables, machines, analytics, pulse, runs, outputs, secrets, paths, memory, status, repoSync, loading, error,
  onBack, toast, onRefresh, onRepoAction, onToggleSkill, onRunSkill, onConfigureAutomation, onLoadRunLog, onSyncSkills, onSyncKeys, onMirrorAction, onSendDeliverable,
}: DetailProps) {
  const [tab, setTab] = React.useState<AeonDetailView>("overview");
  const [skills, setSkills] = React.useState(allSkills);
  const [selSkill, setSelSkill] = React.useState<string | null>(null);
  const [compose, setCompose] = React.useState<AeonSkill | null | undefined>(undefined);
  const [sendD, setSendD] = React.useState<AeonDeliverable | null>(null);

  const onDuty = skills.filter((s) => s.state === "on-duty").length;

  const toggleDuty = async (slug: string) => {
    const current = skills.find((skill) => skill.slug === slug);
    const next = current?.state === "on-duty" ? "paused" : "on-duty";
    setSkills((arr) => arr.map((s) => s.slug === slug ? { ...s, state: next } : s));
    try {
      await onToggleSkill?.(slug, next);
      onRefresh?.();
    } catch (err) {
      setSkills(allSkills);
      toast(err instanceof Error ? err.message : "Could not update AEON skill.");
    }
  };

  const skillAction = async (skill: AeonSkill, kind?: SkillActionKind) => {
    if (kind === "run") { await onRunSkill?.(skill.slug); toast(`Running ${skill.name}…`); onRefresh?.(); return; }
    if (kind === "toggle") { void toggleDuty(skill.slug); toast(skill.state === "on-duty" ? `${skill.name} off duty` : `${skill.name} on duty`); return; }
    if (skill.state === "on-duty") { void toggleDuty(skill.slug); toast(`${skill.name} paused`); }
    else if (skill.state === "paused") { void toggleDuty(skill.slug); toast(`${skill.name} resumed`); }
    else if (skill.state === "manual") { await onRunSkill?.(skill.slug); toast(`Running ${skill.name}…`); onRefresh?.(); }
    else setCompose(skill);
  };

  const createAutomation = async (skill: AeonSkill | null, cfg: AutomationConfig) => {
    if (skill) {
      try {
        await onConfigureAutomation?.(skill, cfg);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not create AEON automation.");
        return;
      }
      setCompose(undefined);
      setSkills((arr) => arr.map((s) => s.slug === skill.slug ? { ...s, state: cfg.duty ? "on-duty" : "manual", scheduleLabel: cfg.summary } : s));
      toast(`${skill.name} armed — ${cfg.summary}`);
      onRefresh?.();
    } else toast("Choose an AEON skill before creating an automation.");
  };

  const stats: { value: React.ReactNode; label: string; tone?: "honey" | "cyan" }[] = [
    { value: onDuty, label: "on duty", tone: onDuty ? "honey" : "cyan" },
    { value: skills.length, label: "skills", tone: "cyan" },
    { value: agent.runs, label: "runs" },
    { value: deliverables.length, label: "handoffs", tone: "cyan" },
  ];

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto auto 1fr", minHeight: 0 }}>
      <header style={{ position: "relative", padding: "20px clamp(18px,3vw,40px) 16px", borderBottom: "1px solid var(--line)", overflow: "hidden" }}>
        <div aria-hidden style={{ position: "absolute", insetInline: 0, top: 0, height: 1, background: "linear-gradient(90deg, transparent, rgba(94,234,212,0.55), transparent)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", minWidth: 0 }}>
            <AeonOrb size={64} state={agent.now.state === "working" ? "working" : onDuty ? "duty" : "idle"} />
            <div style={{ minWidth: 0 }}>
              <Eyebrow color="var(--cyan-2)">Aeon Autopilot</Eyebrow>
              <h1 style={{ margin: "3px 0 6px", fontFamily: "var(--f-display)", fontSize: "clamp(22px,2.6vw,30px)", fontWeight: 700, letterSpacing: 0, color: "var(--fg)", lineHeight: 1 }}>{agent.name}</h1>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Pill tone="muted" icon="git">{agent.mode}</Pill>
                <span style={{ fontSize: 11.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)" }}>{agent.repo ?? agent.localPath}</span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Btn variant="ghost" icon="chevronL" onClick={onBack}>All AEON Agents</Btn>
            <Btn variant="danger" icon="power" onClick={() => { skills.filter((s) => s.state === "on-duty").forEach((s) => void toggleDuty(s.slug)); toast("All AEON automations stopped"); }}>Stop AEON</Btn>
            <Btn variant="secondary" icon={loading ? undefined : "refresh"} onClick={onRefresh}>{loading ? <><Spinner />Refreshing</> : "Refresh"}</Btn>
          </div>
        </div>
        {error ? <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 9, border: "1px solid rgba(251,113,133,0.35)", background: "rgba(251,113,133,0.10)", color: "var(--danger-2)", fontSize: 12 }}>{error}</div> : null}
        <div style={{ display: "flex", gap: "clamp(20px,4vw,48px)", marginTop: 16, paddingLeft: 80, flexWrap: "wrap" }}>
          {stats.map((s) => <Stat key={s.label} value={s.value} label={s.label} tone={s.tone} />)}
        </div>
      </header>

      <nav className={styles.scroll} style={{ display: "flex", gap: 4, padding: "10px clamp(18px,3vw,40px) 0", borderBottom: "1px solid var(--line)", overflowX: "auto" }}>
        {DETAIL_TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 2, padding: "8px 14px 13px", cursor: "pointer", border: 0, background: "transparent" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 600, color: active ? "var(--fg)" : "var(--fg-3)" }}>
                <span style={{ color: active ? "var(--cyan-2)" : "var(--fg-4)" }}><Icon name={t.icon} size={15} /></span>{t.label}
                {t.id === "deliverables" && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "var(--aeon-soft)", border: "1px solid var(--aeon-line)", color: "var(--cyan-3)" }}>{deliverables.length}</span>}
              </span>
              <span style={{ fontSize: 11, color: "var(--fg-4)", opacity: active ? 1 : 0.6 }}>{t.detail}</span>
              {active && <span style={{ position: "absolute", left: 12, right: 12, bottom: -1, height: 2, borderRadius: 2, background: "var(--aeon)", boxShadow: "0 0 10px var(--aeon-glow)" }} />}
            </button>
          );
        })}
      </nav>

      <div key={tab} className={styles.scroll} style={{ overflow: "auto", padding: "18px clamp(18px,3vw,40px) 40px", minHeight: 0 }}>
        {tab === "overview" && <AeonOverview agent={{ ...agent, onDuty }} skills={skills} analytics={analytics} pulse={pulse} onView={setTab} onToggle={(slug) => void toggleDuty(slug)} />}
        {tab === "work" && <AeonWork skills={skills} runs={runs} selectedSlug={selSkill} onSelect={(s) => setSelSkill(s === selSkill ? null : s)} onAction={(skill, kind) => void skillAction(skill, kind)} onImport={() => setCompose(null)} />}
        {tab === "activity" && <AeonActivity runs={runs} outputs={outputs} onLoadRunLog={onLoadRunLog} />}
        {tab === "deliverables" && <AeonDeliverables deliverables={deliverables} onSend={setSendD} />}
        {tab === "control" && <AeonControlPlane agent={profile} onToast={toast} onChanged={onRefresh} />}
        {tab === "settings" && <AeonSettings agent={agent} secrets={secrets} paths={paths} memory={memory} status={status} repoSync={repoSync} onRepoAction={onRepoAction} onSyncSkills={onSyncSkills} onSyncKeys={onSyncKeys} onMirrorAction={onMirrorAction} onError={toast} />}
      </div>

      {compose !== undefined && <ComposeModal skill={compose} onClose={() => setCompose(undefined)} onCreate={createAutomation} />}
      {sendD && <SendModal deliverable={sendD} machines={machines} onClose={() => setSendD(null)} onSend={(m) => { onSendDeliverable?.(sendD.id, m.key); setSendD(null); toast(`Sent ${sendD.title} → ${m.name}`); }} />}
    </div>
  );
}

// ---------- top-level panel ----------
export interface AeonAutopilotPanelProps {
  agents?: AeonAgent[];
  agentProfiles?: AgentProfile[];
  sharedVault?: SharedVaultConfig;
  machineGroups?: MachineGroup[];
  skills?: AeonSkill[];
  deliverables?: AeonDeliverable[];
  machines?: AeonMachine[];
  initialMode?: "fleet" | "detail";
  accent?: string;
  motion?: boolean;
  onToggleSkill?: (slug: string, nextState: "on-duty" | "paused") => void;
  onRunSkill?: (slug: string) => void;
  onSendDeliverable?: (id: string, machineKey: string) => void;
  onCreateWorkspace?: () => void;
  onWorkspaceCreated?: (agent: AgentProfile) => void;
  chooseDirectoryForMachine?: (machine: KanbanMachineTarget | null, onChoose: (directory: LinkedDirectory) => void) => void | Promise<void>;
}

export function AeonAutopilotPanel({
  agents, agentProfiles, sharedVault, machineGroups, skills = AEON_SKILLS, deliverables = AEON_DELIVERABLES, machines = AEON_MACHINES,
  initialMode = "fleet", accent, motion = true,
  onToggleSkill, onRunSkill, onSendDeliverable, onCreateWorkspace, onWorkspaceCreated, chooseDirectoryForMachine,
}: AeonAutopilotPanelProps = {}) {
  const [mode, setMode] = React.useState<"fleet" | "detail">(initialMode);
  const [createdProfiles, setCreatedProfiles] = React.useState<AgentProfile[]>([]);
  const initialAgents = agents ?? AEON_AGENTS;
  const profileAgents = React.useMemo(() => dedupeAeonAgents([...(agentProfiles ?? []), ...createdProfiles].map(aeonAgentFromProfile)), [agentProfiles, createdProfiles]);
  const baseDisplayAgents = React.useMemo(() => agents ? dedupeAeonAgents(initialAgents) : profileAgents, [agents, initialAgents, profileAgents]);
  const [agentId, setAgentId] = React.useState(baseDisplayAgents[0]?.id);
  const [runtimeDataByAgent, setRuntimeDataByAgent] = React.useState<Record<string, AeonRuntimeData>>({});
  const [msg, setMsg] = React.useState("");
  const [workspaceModalOpen, setWorkspaceModalOpen] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  const runtimeRequestKeys = React.useRef(new Set<string>());
  const allProfiles = React.useMemo(() => [...(agentProfiles ?? []), ...createdProfiles], [agentProfiles, createdProfiles]);
  const displayAgents = React.useMemo(
    () => baseDisplayAgents.map((item) => hydrateAgentWithRuntime(item, runtimeDataByAgent[item.id])),
    [baseDisplayAgents, runtimeDataByAgent],
  );
  const baseAgent = baseDisplayAgents.find((a) => a.id === agentId) ?? baseDisplayAgents[0];
  const agent = displayAgents.find((a) => a.id === agentId) ?? displayAgents[0];
  const activeProfile = allProfiles.find((profile) => profile.id === agent?.id);
  const runtimeData = agent ? runtimeDataByAgent[agent.id] ?? emptyRuntimeData() : emptyRuntimeData();
  const accentVars = React.useMemo(() => accentStyle(accent), [accent]);

  React.useEffect(() => { document.documentElement.setAttribute("data-aeon-motion", motion ? "on" : "off"); }, [motion]);
  React.useEffect(() => {
    if (!agentId && displayAgents[0]?.id) setAgentId(displayAgents[0].id);
  }, [agentId, displayAgents]);

  const toast = (m: string) => {
    setMsg(m);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(""), 2600);
  };

  const loadRuntimeData = React.useCallback(async (profile: AgentProfile, baseAgent: AeonAgent) => {
    setRuntimeDataByAgent((current) => ({
      ...current,
      [profile.id]: { ...(current[profile.id] ?? emptyRuntimeData()), loading: true, error: "" },
    }));
    const body = { agent: profile, vaultPath: sharedVault?.vaultPath };
    try {
      const [statusRes, skillsRes, runsRes, outputsRes, analyticsRes, memoryRes] = await Promise.all([
        postJson<{ status?: RuntimeStatusPayload }>("/api/runtimes/aeon/status", body),
        postJson<{ skills?: RuntimeSkill[] }>("/api/runtimes/aeon/skills", body),
        postJson<{ runs?: RuntimeRun[] }>("/api/runtimes/aeon/runs", body),
        postJson<{ outputs?: RuntimeOutput[] }>("/api/runtimes/aeon/outputs", body),
        postJson<{ analytics?: RuntimeAnalytics }>("/api/runtimes/aeon/analytics", body),
        postJson<{ memory?: RuntimeMemorySnapshot }>("/api/runtimes/aeon/memory", body),
      ]);
      const runtimeRuns = runsRes?.runs ?? [];
      const mappedOutputs = (outputsRes?.outputs ?? []).map(runtimeOutputToAeon);
      const mappedAgent = hydrateAgentWithRuntime(baseAgent, {
        ...emptyRuntimeData(),
        status: statusRes?.status,
      });
      setRuntimeDataByAgent((current) => ({
        ...current,
        [profile.id]: {
          loading: false,
          error: "",
          status: statusRes?.status,
          skills: (skillsRes?.skills ?? []).map(runtimeSkillToAeon),
          runs: runtimeRuns.map(runtimeRunToAeon),
          runtimeRuns,
          outputs: mappedOutputs,
          deliverables: [...deliverables, ...mappedOutputs.map((output) => outputToDeliverable(output, mappedAgent))],
          analytics: runtimeAnalyticsToAeon(analyticsRes?.analytics),
          pulse: pulseFromRuns(runtimeRuns),
          secrets: current[profile.id]?.secrets ?? [],
          paths: runtimePaths(mappedAgent, memoryRes?.memory),
          memory: runtimeMemoryToAeon(memoryRes?.memory),
          repoSync: current[profile.id]?.repoSync,
        },
      }));
      void Promise.allSettled([
        postJson<{ secrets?: RuntimeSecretStatus }>("/api/runtimes/aeon/secrets/status", body),
        postJson<{ status?: RuntimeRepoSyncStatus }>("/api/runtimes/aeon/repo/sync", { agent: profile, action: "status" }),
      ]).then(([secretsResult, repoResult]) => {
        setRuntimeDataByAgent((current) => {
          const existing = current[profile.id] ?? emptyRuntimeData();
          return {
            ...current,
            [profile.id]: {
              ...existing,
              secrets: secretsResult.status === "fulfilled" ? runtimeSecretsToAeon(secretsResult.value.secrets) : existing.secrets,
              repoSync: repoResult.status === "fulfilled" ? repoResult.value.status : existing.repoSync,
            },
          };
        });
      });
    } catch (err) {
      setRuntimeDataByAgent((current) => ({
        ...current,
        [profile.id]: { ...(current[profile.id] ?? emptyRuntimeData()), loading: false, error: err instanceof Error ? err.message : "Could not load AEON runtime data." },
      }));
    }
  }, [deliverables, sharedVault?.vaultPath]);

  const requestRuntimeData = React.useCallback((profile: AgentProfile, baseAgent: AeonAgent) => {
    const key = [profile.id, profile.aeonRepo ?? "", profile.aeonLocalPath ?? "", profile.localDataDir ?? ""].join("|");
    if (runtimeRequestKeys.current.has(key)) return;
    runtimeRequestKeys.current.add(key);
    void loadRuntimeData(profile, baseAgent);
  }, [loadRuntimeData]);

  React.useEffect(() => {
    baseDisplayAgents.forEach((displayAgent) => {
      const profile = allProfiles.find((item) => item.id === displayAgent.id);
      if (profile) requestRuntimeData(profile, displayAgent);
    });
  }, [allProfiles, baseDisplayAgents, requestRuntimeData]);

  React.useEffect(() => {
    if (!activeProfile || !baseAgent) return;
    requestRuntimeData(activeProfile, baseAgent);
  }, [activeProfile, baseAgent, requestRuntimeData]);

  const refreshActiveRuntime = React.useCallback(() => {
    if (!activeProfile || !agent) return;
    void loadRuntimeData(activeProfile, agent);
  }, [activeProfile, agent, loadRuntimeData]);

  const runActiveSkill = React.useCallback(async (slug: string) => {
    if (!activeProfile) {
      onRunSkill?.(slug);
      return;
    }
    const result = await postJson<{ ok?: boolean; error?: string }>("/api/runtimes/aeon/schedules/action", { agent: activeProfile, action: "run-now", jobId: slug });
    if (result.ok === false) throw new Error(result.error || "Could not run AEON skill.");
    onRunSkill?.(slug);
  }, [activeProfile, onRunSkill]);

  const toggleActiveSkill = React.useCallback(async (slug: string, nextState: "on-duty" | "paused") => {
    if (!activeProfile) {
      onToggleSkill?.(slug, nextState);
      return;
    }
    const action = nextState === "on-duty" ? "enable" : "disable";
    const result = await postJson<{ ok?: boolean; error?: string }>("/api/runtimes/aeon/skills/config", { agent: activeProfile, skill: slug, action, value: nextState === "on-duty" });
    if (result.ok === false) throw new Error(result.error || "Could not update AEON skill.");
    onToggleSkill?.(slug, nextState);
  }, [activeProfile, onToggleSkill]);

  const configureActiveAutomation = React.useCallback(async (skill: AeonSkill, config: AutomationConfig) => {
    if (!activeProfile) throw new Error("Link an AEON workspace before creating an automation.");
    const instructions = config.brief === "checklist"
      ? `Run ${skill.name} exactly as documented, then report what completed and what remains.`
      : config.brief === "changes"
        ? `Monitor ${skill.name} for meaningful changes and report only items that need attention.`
        : config.brief === "summary"
          ? `Run ${skill.name} and produce a concise reusable artifact from the result.`
          : skill.desc;
    await postJson("/api/runtimes/aeon/control-plane", {
      agent: activeProfile,
      action: "skill-configure",
      skill: skill.slug,
      schedule: config.schedule,
      var: instructions,
      model: config.model,
      enabled: config.duty,
    });
  }, [activeProfile]);

  const loadActiveRunLog = React.useCallback(async (runId: string) => {
    if (!activeProfile) throw new Error("Link an AEON workspace before loading run logs.");
    const response = await postJson<{ log?: RuntimeRunLog }>("/api/runtimes/aeon/runs/logs", { agent: activeProfile, runId });
    if (!response.log) throw new Error("AEON did not return a run log.");
    return [response.log.summary, response.log.logs].filter(Boolean).join("\n\n");
  }, [activeProfile]);

  const syncActiveSkills = React.useCallback(async () => {
    if (!activeProfile) throw new Error("Link an AEON workspace before syncing skills.");
    await postJson("/api/runtimes/aeon/skills/sync", { agent: activeProfile, vaultPath: sharedVault?.vaultPath });
    toast("Synced the Shared Brain skill library into AEON v0.1.");
    refreshActiveRuntime();
  }, [activeProfile, refreshActiveRuntime, sharedVault?.vaultPath]);

  const syncActiveKeys = React.useCallback(async (keys?: string[]) => {
    if (!activeProfile) throw new Error("Link an AEON workspace before syncing keys.");
    await postJson("/api/runtimes/aeon/env/sync", { agent: activeProfile, ...(keys?.length ? { keys } : {}) });
    toast(keys?.length ? `Synced ${keys.join(", ")}.` : "Synced required AEON keys.");
    refreshActiveRuntime();
  }, [activeProfile, refreshActiveRuntime]);

  const runMirrorAction = React.useCallback(async (action: "start" | "stop" | "once") => {
    if (!activeProfile) throw new Error("Link an AEON workspace before syncing with Obsidian.");
    await postJson("/api/runtimes/aeon/obsidian-sync", { agent: activeProfile, action, vaultPath: sharedVault?.vaultPath });
    toast(action === "start" ? "Started the AEON Obsidian mirror." : action === "stop" ? "Stopped the AEON Obsidian mirror." : "Synced AEON with Obsidian.");
  }, [activeProfile, sharedVault?.vaultPath]);

  const runRepoAction = React.useCallback(async (action: "pull" | "push") => {
    if (!activeProfile) return;
    try {
      const result = await postJson<{ ok?: boolean; error?: string; message?: string }>("/api/runtimes/aeon/repo/sync", { agent: activeProfile, action });
      if (result.ok === false) throw new Error(result.error || "AEON repo sync failed.");
      toast(result.message || (action === "pull" ? "Pulled AEON repo." : "Pushed AEON repo."));
      refreshActiveRuntime();
    } catch (err) {
      toast(err instanceof Error ? err.message : "AEON repo sync failed.");
    }
  }, [activeProfile, refreshActiveRuntime]);

  return (
    <div className={styles.root} style={{ ...accentVars, height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-0)", color: "var(--fg)", fontFamily: "var(--f-body)", position: "relative", overflow: "hidden" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(circle at 16% 4%, rgba(45,212,191,0.08), transparent 38%), radial-gradient(circle at 92% 96%, rgba(255,212,90,0.05), transparent 42%)" }} />
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {mode !== "detail" || !agent
          ? <AeonFleet agents={displayAgents} onOpen={(a) => { setAgentId(a.id); setMode("detail"); }} onCreate={() => { onCreateWorkspace?.(); setWorkspaceModalOpen(true); }} />
          : <AeonDetail key={`${agent.id}:${runtimeData.skills.map((skill) => `${skill.slug}:${skill.state}`).join("|")}`} agent={agent} profile={activeProfile} allSkills={runtimeData.skills.length ? runtimeData.skills : skills}
              deliverables={runtimeData.deliverables.length ? runtimeData.deliverables : deliverables} machines={machines} analytics={runtimeData.analytics} pulse={runtimeData.pulse}
              runs={runtimeData.runs} outputs={runtimeData.outputs} secrets={runtimeData.secrets} paths={runtimeData.paths} memory={runtimeData.memory}
              status={runtimeData.status} repoSync={runtimeData.repoSync} loading={runtimeData.loading} error={runtimeData.error} onRefresh={refreshActiveRuntime} onRepoAction={runRepoAction}
              onBack={() => setMode("fleet")} toast={toast} onToggleSkill={toggleActiveSkill} onRunSkill={runActiveSkill} onConfigureAutomation={configureActiveAutomation} onLoadRunLog={loadActiveRunLog} onSyncSkills={syncActiveSkills} onSyncKeys={syncActiveKeys} onMirrorAction={runMirrorAction} onSendDeliverable={onSendDeliverable} />}
      </div>
      {workspaceModalOpen ? (
        <WorkspaceModal
          existingAgents={agentProfiles ?? []}
          sharedVault={sharedVault}
          machineGroups={machineGroups}
          chooseDirectoryForMachine={chooseDirectoryForMachine}
          onClose={() => setWorkspaceModalOpen(false)}
          onCreated={(newAgent, options = {}) => {
            setCreatedProfiles((current) => {
              const existing = current.some((item) => item.id === newAgent.id);
              return existing ? current.map((item) => item.id === newAgent.id ? { ...item, ...newAgent } : item) : [...current, newAgent];
            });
            onWorkspaceCreated?.(newAgent);
            if (options.close !== false) setWorkspaceModalOpen(false);
            setAgentId(newAgent.id);
            if (options.openDetail !== false) setMode("detail");
            if (options.toast !== false) toast(`Added ${newAgent.name || "AEON workspace"}`);
          }}
          onToast={toast}
        />
      ) : null}
      <Toast msg={msg} />
    </div>
  );
}
