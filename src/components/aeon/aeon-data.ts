// AEON Autopilot — typed data contracts.
// Keep defaults empty so the UI never invents repos, runs, outputs, secrets, or machines.

export type AeonCategoryId = "knowledge" | "research" | "ops" | "social" | "trading" | "comms";
export interface AeonCategory { id: AeonCategoryId; label: string; color: string; }

export type AeonNowState = "working" | "scheduled" | "paused" | "idle";
export interface AeonNow { state: AeonNowState; skill?: string; progress?: number; since?: string; next?: string; }

export interface AeonAgent {
  id: string; name: string; repo: string | null; mode: "GitHub" | "Local path";
  branch: string; localPath: string; machine: string;
  onDuty: number; skills: number; runs: number; handoffs: number; successRate: number;
  now: AeonNow; tagline: string;
}

export type SkillState = "on-duty" | "paused" | "manual" | "ready" | "available";
export type SkillSource = "aeon.yml" | "aeon-skill-folder" | "aeon-cli" | "shared-brain";
export interface AeonSkill {
  slug: string; name: string; cat: AeonCategoryId; source: SkillSource;
  state: SkillState; schedule: string; scheduleLabel: string; model: string; desc: string;
}

export type RunStatus = "active" | "completed" | "failed";
export interface AeonRun { id: string; name: string; status: RunStatus; conclusion: string; when: string; dur: string; }

export interface AeonOutput { skill: string; filename: string; source: string; when: string; excerpt: string; }

export type DeliverableKind = "verdict" | "miroshark-run" | "posts" | "json";
export interface AeonDeliverable {
  id: string; kind: DeliverableKind; title: string; source: "vault" | "aeon-output" | "remote";
  status: string; when: string; sim: string; size: number; local: boolean; file: string; repo: string;
  purpose: string; preview: string;
}

export type SecretStatus = "set" | "shared" | "local" | "missing";
export interface AeonSecret { key: string; label: string; status: SecretStatus; usedIn: string[]; }

export interface AeonPathEntry { label: string; value: string; }
export interface MemoryItem { title: string; excerpt: string; }
export interface AeonMemory { index: string; topics: MemoryItem[]; logs: MemoryItem[]; issues: MemoryItem[]; }
export interface AeonInsight { type: "success" | "warning" | "info"; message: string; }
export interface AeonAnalytics {
  totalRuns: number; successRate: number; failure: number; uniqueSkills: number;
  insights: AeonInsight[]; topSkills: { slug: string; name: string; successRate: number; total: number }[];
}
export interface AeonMachine { key: string; name: string; url: string; }

export const AEON_CATEGORIES: AeonCategory[] = [
  { id: "knowledge", label: "Knowledge", color: "#5eead4" },
  { id: "research",  label: "Research",  color: "#7dd3fc" },
  { id: "ops",       label: "Ops",       color: "#ffd45a" },
  { id: "social",    label: "Social",    color: "#c4b5fd" },
  { id: "trading",   label: "Trading",   color: "#6ee7b7" },
  { id: "comms",     label: "Comms",     color: "#fda4af" },
];
export const CAT: Record<AeonCategoryId, AeonCategory> =
  Object.fromEntries(AEON_CATEGORIES.map((c) => [c.id, c])) as Record<AeonCategoryId, AeonCategory>;

export const AEON_AGENTS: AeonAgent[] = [];
export const AEON_SKILLS: AeonSkill[] = [];
export const AEON_RUNS: AeonRun[] = [];
export const AEON_OUTPUTS: AeonOutput[] = [];
export const AEON_DELIVERABLES: AeonDeliverable[] = [];
export const AEON_SECRETS: AeonSecret[] = [];
export const DEFAULT_SECRET_KEYS: string[] = [];
export const AEON_PATHS: AeonPathEntry[] = [];

export const AEON_MEMORY: AeonMemory = {
  index: "",
  topics: [],
  logs: [],
  issues: [],
};

export const AEON_ANALYTICS: AeonAnalytics = {
  totalRuns: 0,
  successRate: 0,
  failure: 0,
  uniqueSkills: 0,
  insights: [],
  topSkills: [],
};

export const AEON_PULSE: number[] = [];
export const AEON_MACHINES: AeonMachine[] = [];

export const CONVERT_SCHEDULE_OPTIONS = [
  { value: "manual", label: "Manual", detail: "Off duty until you run it." },
  { value: "hourly", label: "Hourly", detail: "Top of every hour." },
  { value: "daily", label: "Daily", detail: "Once per day at a set time." },
  { value: "weekdays", label: "Weekdays", detail: "Mon–Fri at a set time." },
  { value: "weekly", label: "Weekly", detail: "Weekly on a chosen day." },
] as const;
export type ConvertScheduleMode = (typeof CONVERT_SCHEDULE_OPTIONS)[number]["value"];

export const CONVERT_BRIEF_OPTIONS = [
  { value: "description", label: "Use description", detail: "AEON receives the skill's own purpose." },
  { value: "checklist", label: "Run checklist", detail: "Follow the skill exactly, report done." },
  { value: "changes", label: "Watch changes", detail: "Monitor, report only what needs attention." },
  { value: "summary", label: "Summarize output", detail: "Produce a concise reusable artifact." },
] as const;
export type ConvertBriefMode = (typeof CONVERT_BRIEF_OPTIONS)[number]["value"];

export const CONVERT_MODEL_OPTIONS = [
  { value: "", label: "AEON default" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { value: "claude-fable-5", label: "Claude Fable 5" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { value: "grok-composer-2.5-fast", label: "Grok Composer 2.5 Fast" },
  { value: "grok-build", label: "Grok Build" },
];

export const AEON_LANES = [
  { title: "Choose the work", label: "Skills", body: "Pick a skill from AEON or the Shared Brain, then run it by hand or on a schedule." },
  { title: "Let it run", label: "Autopilot", body: "AEON starts, pauses, or stays on duty — no YAML or Actions to manage." },
  { title: "Review the result", label: "Outputs", body: "Runs and artifacts stay visible so you can open the evidence anytime." },
  { title: "Keep it connected", label: "Setup", body: "Keys, repo sync, and memory live below the work, not in front of it." },
];
