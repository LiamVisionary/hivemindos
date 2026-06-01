// AEON Autopilot — typed dataset mirroring the real product labels.
// Replace the exported consts with your real fetchers; the shapes are the contract.

export type AeonCategoryId = "knowledge" | "research" | "ops" | "social" | "trading" | "comms";
export interface AeonCategory { id: AeonCategoryId; label: string; color: string; }

export type AeonNowState = "working" | "scheduled" | "paused" | "idle";
export interface AeonNow { state: AeonNowState; skill?: string; progress?: number; since?: string; next?: string; }

export interface AeonAgent {
  id: string; name: string; repo: string | null; mode: "GitHub" | "Local path" | "A2A";
  branch: string; localPath: string; machine: string;
  onDuty: number; skills: number; runs: number; handoffs: number; successRate: number;
  now: AeonNow; tagline: string;
}

export type SkillState = "on-duty" | "paused" | "manual" | "ready" | "available";
export type SkillSource = "aeon.yml" | "aeon-skill-folder" | "shared-brain" | "aeon-a2a";
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

export const AEON_AGENTS: AeonAgent[] = [
  { id: "aeon-ops", name: "aeon-ops", repo: "LiamVisionary/aeon-ops", mode: "GitHub", branch: "main",
    localPath: "~/Documents/aeon-ops", machine: "atlas", onDuty: 3, skills: 12, runs: 48, handoffs: 6, successRate: 92,
    now: { state: "working", skill: "pull-rss-digest", progress: 0.62, since: "4m" }, tagline: "Keeps the brain fed and indexed." },
  { id: "aeon-research", name: "aeon-research", repo: "LiamVisionary/aeon-research", mode: "GitHub", branch: "main",
    localPath: "~/Documents/aeon-research", machine: "nimbus", onDuty: 1, skills: 12, runs: 19, handoffs: 2, successRate: 88,
    now: { state: "scheduled", skill: "research-ingestion", next: "in 41m" }, tagline: "Ranks and ingests the day's reading." },
  { id: "aeon-social", name: "aeon-social", repo: "LiamVisionary/aeon-social", mode: "GitHub", branch: "main",
    localPath: "~/Documents/aeon-social", machine: "nimbus", onDuty: 0, skills: 8, runs: 27, handoffs: 9, successRate: 74,
    now: { state: "paused", skill: "auto-post-x-thread" }, tagline: "Drafts and stages the X channel." },
  { id: "aeon-trade", name: "aeon-trade", repo: null, mode: "Local path", branch: "main",
    localPath: "~/.aeon-repos/aeon-trade", machine: "atlas", onDuty: 1, skills: 6, runs: 84, handoffs: 14, successRate: 97,
    now: { state: "scheduled", skill: "rotate-broker-tokens", next: "in 2h 10m" }, tagline: "Token rotation + market-making sims." },
];

export const AEON_SKILLS: AeonSkill[] = [
  { slug: "index-vault", name: "Index Obsidian vault", cat: "knowledge", source: "aeon.yml", state: "on-duty", schedule: "0 2 * * *", scheduleLabel: "Daily · 02:00 UTC", model: "claude-sonnet-4-6", desc: "Full reindex of the brain — embedding refresh + skill registry sync." },
  { slug: "pull-rss-digest", name: "Pull RSS digest", cat: "research", source: "aeon.yml", state: "on-duty", schedule: "0 * * * *", scheduleLabel: "Hourly · :00", model: "claude-sonnet-4-6", desc: "Hourly news fetch + dedup + injection into the research workspace." },
  { slug: "vault-health-check", name: "Vault health check", cat: "ops", source: "aeon.yml", state: "on-duty", schedule: "0 4 * * *", scheduleLabel: "Daily · 04:00 UTC", model: "claude-sonnet-4-6", desc: "Lint links, find orphans, flag stale notes, and repair the index." },
  { slug: "morning-context", name: "Morning context", cat: "knowledge", source: "aeon-skill-folder", state: "manual", schedule: "30 13 * * 1-5", scheduleLabel: "Weekdays · 13:30 ET", model: "claude-sonnet-4-6", desc: "Assemble calendar, inbox, and overnight changes into a single brief." },
  { slug: "auto-post-x-thread", name: "Auto-post X thread", cat: "social", source: "aeon.yml", state: "paused", schedule: "30 13 * * *", scheduleLabel: "Daily · 13:30 ET", model: "bankr", desc: "Publish whatever the X-thread template currently has staged." },
  { slug: "rotate-broker-tokens", name: "Rotate broker tokens", cat: "ops", source: "aeon-skill-folder", state: "manual", schedule: "0 */6 * * *", scheduleLabel: "Every 6h", model: "claude-sonnet-4-6", desc: "Refresh Coinbase / Kraken / OKX broker JWTs and sync via env-add." },
  { slug: "weekly-review", name: "Weekly review", cat: "knowledge", source: "aeon-skill-folder", state: "ready", schedule: "", scheduleLabel: "", model: "", desc: "Roll up the week's decisions, outputs, and open loops into one note." },
  { slug: "research-ingestion", name: "Research ingestion", cat: "research", source: "aeon-skill-folder", state: "ready", schedule: "", scheduleLabel: "", model: "", desc: "Rank Tavily results against the memory index and file the keepers." },
  { slug: "decision-review", name: "Decision review", cat: "knowledge", source: "shared-brain", state: "available", schedule: "", scheduleLabel: "", model: "", desc: "Revisit recent decisions, check outcomes, and capture the lesson." },
  { slug: "meeting-prep", name: "Meeting prep", cat: "comms", source: "shared-brain", state: "available", schedule: "", scheduleLabel: "", model: "", desc: "Build an agenda and context pack from the relevant vault notes." },
  { slug: "argument-builder", name: "Argument builder", cat: "research", source: "shared-brain", state: "available", schedule: "", scheduleLabel: "", model: "", desc: "Assemble the strongest case for a claim with sourced evidence." },
  { slug: "book-notes", name: "Book notes distiller", cat: "knowledge", source: "shared-brain", state: "available", schedule: "", scheduleLabel: "", model: "", desc: "Turn highlights into durable, linked knowledge in the vault." },
];

export const AEON_RUNS: AeonRun[] = [
  { id: "r1", name: "pull-rss-digest", status: "active", conclusion: "", when: "now", dur: "00:38" },
  { id: "r2", name: "pull-rss-digest", status: "completed", conclusion: "success", when: "23m ago", dur: "01:12" },
  { id: "r3", name: "index-vault", status: "completed", conclusion: "success", when: "2h ago", dur: "04:51" },
  { id: "r4", name: "vault-health-check", status: "completed", conclusion: "success", when: "4h ago", dur: "00:44" },
  { id: "r5", name: "rotate-broker-tokens", status: "completed", conclusion: "success", when: "6h ago", dur: "00:21" },
  { id: "r6", name: "auto-post-x-thread", status: "failed", conclusion: "failure", when: "6h ago", dur: "00:09" },
  { id: "r7", name: "pull-rss-digest", status: "completed", conclusion: "success", when: "7h ago", dur: "01:02" },
  { id: "r8", name: "index-vault", status: "completed", conclusion: "success", when: "1d ago", dur: "05:09" },
];

export const RUN_LOG_SAMPLE =
`▸ aeon run pull-rss-digest (workflow_dispatch)
  resolved 14 feeds · fetched 212 items
  dedup → 38 new · ranked against memory index
  injected 12 keepers into research/inbox
  wrote .outputs/rss-digest-2026-06-02.md
✓ completed in 1m12s · model claude-sonnet-4-6`;

export const AEON_OUTPUTS: AeonOutput[] = [
  { skill: "pull-rss-digest", filename: "rss-digest-2026-06-02.md", source: ".outputs", when: "23m ago", excerpt: "12 keepers today. Lede: Base sequencer upgrade ships Thursday; two Tailscale CVEs patched; new llama.cpp server flags for KV-cache reuse…" },
  { skill: "index-vault", filename: "vault-index-report.md", source: ".outputs", when: "2h ago", excerpt: "Reindexed 4,182 notes · 31 new embeddings · 3 broken links auto-fixed · skill registry in sync." },
  { skill: "vault-health-check", filename: "vault-health.md", source: ".outputs", when: "4h ago", excerpt: "All green. 2 orphan notes flagged for review under Operations/Review. No stale frontmatter." },
  { skill: "weekly-review", filename: "weekly-review-w22.md", source: "dashboard/outputs", when: "2d ago", excerpt: "9 decisions logged, 6 shipped. Open loops: broker token policy, X channel cadence, drone-01 onboarding." },
];

export const AEON_DELIVERABLES: AeonDeliverable[] = [
  { id: "d1", kind: "verdict", title: "AEON verdict", source: "vault", status: "ship", when: "1h ago", sim: "sim_8410", size: 2310, local: true, file: "verdict.md", repo: "LiamVisionary/aeon-ops", purpose: "AEON's decision, outcome, and next action for this MiroShark rehearsal.", preview: "Ship the thread. Engagement model clears threshold on 3 of 4 seeds; hold variant C for the morning slot." },
  { id: "d2", kind: "miroshark-run", title: "MiroShark run summary", source: "aeon-output", status: "", when: "1h ago", sim: "sim_8410", size: 18800, local: true, file: "run-summary.md", repo: "LiamVisionary/aeon-ops", purpose: "A readable recap of the simulation scenario, captured activity, and final state.", preview: "Epoch 8410 · 4 seeds · 38 simulated posts · final sentiment +0.42 · 2 flagged for human review." },
  { id: "d3", kind: "posts", title: "Captured MiroShark posts", source: "vault", status: "", when: "1h ago", sim: "sim_8410", size: 9400, local: true, file: "posts.md", repo: "LiamVisionary/aeon-ops", purpose: "The human-readable post captures from the simulation, ready for review or handoff.", preview: "" },
  { id: "d4", kind: "json", title: "Workflow dispatch data", source: "aeon-output", status: "", when: "1h ago", sim: "sim_8410", size: 4100, local: true, file: "aeon-rehearsal.json", repo: "LiamVisionary/aeon-ops", purpose: "Structured workflow context for audit trails and future agent replay.", preview: "" },
  { id: "d5", kind: "json", title: "Posts data export", source: "remote", status: "", when: "5h ago", sim: "sim_8409", size: 22600, local: false, file: "posts.json", repo: "LiamVisionary/aeon-ops", purpose: "Structured post data for automation, analysis, or attaching to another agent run.", preview: "" },
  { id: "d6", kind: "json", title: "Simulation run data", source: "remote", status: "", when: "5h ago", sim: "sim_8409", size: 61200, local: false, file: "run.json", repo: "LiamVisionary/aeon-ops", purpose: "Structured run metadata and raw simulation state for deeper debugging.", preview: "" },
];

export const AEON_SECRETS: AeonSecret[] = [
  { key: "ANTHROPIC_API_KEY", label: "Claude API", status: "set", usedIn: ["index-vault", "pull-rss-digest", "morning-context"] },
  { key: "CLAUDE_CODE_OAUTH_TOKEN", label: "Claude Code OAuth", status: "set", usedIn: ["weekly-review"] },
  { key: "BANKR_LLM_KEY", label: "Bankr LLM gateway", status: "set", usedIn: ["auto-post-x-thread"] },
  { key: "GH_GLOBAL", label: "GitHub automation", status: "set", usedIn: ["all workflows"] },
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram notify", status: "shared", usedIn: [] },
  { key: "DISCORD_WEBHOOK_URL", label: "Discord notify", status: "shared", usedIn: [] },
  { key: "SLACK_WEBHOOK_URL", label: "Slack notify", status: "local", usedIn: [] },
  { key: "RESEND_API_KEY", label: "Email notify", status: "missing", usedIn: [] },
];
export const DEFAULT_SECRET_KEYS = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "BANKR_LLM_KEY", "GH_GLOBAL"];

export const AEON_PATHS: AeonPathEntry[] = [
  { label: "Config", value: "aeon.yml" },
  { label: "Skill manifest", value: "skills.json" },
  { label: "Skills", value: "skills/<slug>/SKILL.md" },
  { label: "Memory", value: "memory/MEMORY.md" },
  { label: "Outputs", value: ".outputs/*.md" },
  { label: "Rendered outputs", value: "dashboard/outputs/*.json" },
];

export const AEON_MEMORY: AeonMemory = {
  index:
`# MEMORY.md — aeon-ops
Owner prefers terse, sourced briefs. Ship-by-default on social unless risk flagged.
Active threads: Base sequencer upgrade, Tailscale CVE patch window, drone-01 onboarding.
Conventions: outputs land in .outputs/ then mirror to Agents/AEON/aeon-ops/ in the vault.
Never push secrets to shared notes. Prefer claude-sonnet-4-6 for routine, opus for review.`,
  topics: [
    { title: "Brain conventions", excerpt: "Vault-writing contract under Operations/." },
    { title: "Broker policy", excerpt: "Rotate JWTs every 6h; alert on 401 storms." },
    { title: "Social cadence", excerpt: "1 thread/day, hold variant C for AM slot." },
  ],
  logs: [
    { title: "2026-06-02 · digest", excerpt: "12 keepers injected, 0 conflicts." },
    { title: "2026-06-02 · index", excerpt: "4,182 notes · 3 links auto-fixed." },
    { title: "2026-06-01 · review", excerpt: "9 decisions logged, 6 shipped." },
  ],
  issues: [
    { title: "RESEND_API_KEY missing", excerpt: "Email notify disabled until key is set." },
    { title: "auto-post paused", excerpt: "Awaiting human OK on new cadence." },
  ],
};

export const AEON_ANALYTICS: AeonAnalytics = {
  totalRuns: 48, successRate: 92, failure: 4, uniqueSkills: 9,
  insights: [
    { type: "success", message: "pull-rss-digest is your most reliable skill — 24/24 runs clean this week." },
    { type: "warning", message: "auto-post-x-thread failed last run (Bankr 401). Paused pending a key check." },
    { type: "info", message: "index-vault averages 4m51s; consider an incremental reindex on weekdays." },
  ],
  topSkills: [
    { slug: "pull-rss-digest", name: "Pull RSS digest", successRate: 100, total: 24 },
    { slug: "index-vault", name: "Index Obsidian vault", successRate: 96, total: 14 },
    { slug: "vault-health-check", name: "Vault health check", successRate: 100, total: 7 },
    { slug: "rotate-broker-tokens", name: "Rotate broker tokens", successRate: 100, total: 4 },
  ],
};

export const AEON_PULSE = [3, 6, 4, 8, 5, 9, 7];

export const AEON_MACHINES: AeonMachine[] = [
  { key: "atlas", name: "atlas", url: "http://100.84.12.3:8787" },
  { key: "nimbus", name: "nimbus", url: "http://100.84.12.7:8787" },
  { key: "honeycomb", name: "honeycomb", url: "http://127.0.0.1:8787" },
  { key: "drone-01", name: "drone-01", url: "http://100.84.19.2:8787" },
];

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
  { value: "claude-opus-4-1", label: "Claude Opus 4.1" },
  { value: "bankr", label: "Bankr gateway" },
];

export const AEON_LANES = [
  { title: "Choose the work", label: "Skills", body: "Pick a skill from AEON or the Shared Brain, then run it by hand or on a schedule." },
  { title: "Let it run", label: "Autopilot", body: "AEON starts, pauses, or stays on duty — no YAML or Actions to manage." },
  { title: "Review the result", label: "Outputs", body: "Runs and artifacts stay visible so you can open the evidence anytime." },
  { title: "Keep it connected", label: "Setup", body: "Keys, repo sync, and memory live below the work, not in front of it." },
];
