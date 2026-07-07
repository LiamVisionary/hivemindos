export type TaskTemplateCadenceKind =
  | "manual"
  | "every15"
  | "hourly"
  | "daily"
  | "weekday"
  | "session"
  | "cron";

export type TaskTemplateAttachment = {
  kind: "skill" | "path";
  label: string;
};

export type TaskTemplateDefinition = {
  id: string;
  label: string;
  desc: string;
  section: "Core" | "Brain" | "Ops" | "Channels" | "Simulation" | "Security" | "AEON";
  badges: string[];
  credit?: string;
  defaultTitle: string;
  defaultMode: "steps" | "prompt";
  defaultSteps: string[];
  defaultPrompt: string;
  defaultAttachments?: TaskTemplateAttachment[];
  defaultCadenceKind?: TaskTemplateCadenceKind;
};

export const TASK_TEMPLATE_PAGE_SIZE = 6;

const INDEX_VAULT_STEPS = [
  "Read the Obsidian vault index manifest",
  "Refresh embeddings for any notes modified since last run",
  "Push the updated index to peer machines over Tailscale",
];

export const TASK_TEMPLATES: TaskTemplateDefinition[] = [
  {
    id: "brain/index-vault",
    label: "Index Obsidian vault",
    desc: "Refresh embeddings and sync the shared brain to peer machines.",
    section: "Brain",
    badges: ["Brain", "Maintenance"],
    defaultTitle: "Index Obsidian vault",
    defaultMode: "steps",
    defaultSteps: INDEX_VAULT_STEPS,
    defaultPrompt: "Read the Obsidian vault index manifest, refresh embeddings for any notes modified since the last run, then push the updated index to peer machines over Tailscale.",
    defaultAttachments: [{ kind: "skill", label: "index-vault" }, { kind: "path", label: "~/Obsidian/hive" }],
    defaultCadenceKind: "daily",
  },
  {
    id: "brain/pull-rss",
    label: "Pull RSS digest",
    desc: "Fetch, dedupe, and summarize hourly news into the shared brain.",
    section: "Brain",
    badges: ["Brain", "Digest"],
    defaultTitle: "Pull RSS digest",
    defaultMode: "steps",
    defaultSteps: ["Fetch configured RSS feeds", "Dedupe already-seen URLs", "Write a concise digest with source links"],
    defaultPrompt: "Fetch the configured RSS feeds, dedupe already-seen URLs, and write a concise digest with source links.",
    defaultAttachments: [{ kind: "skill", label: "pull-rss" }],
    defaultCadenceKind: "hourly",
  },
  {
    id: "secops/rotate-tokens",
    label: "Rotate broker tokens",
    desc: "Refresh broker credentials through the approved secret-handling flow.",
    section: "Security",
    badges: ["Security", "Ops"],
    defaultTitle: "Rotate broker tokens",
    defaultMode: "steps",
    defaultSteps: ["Check which broker tokens are due for rotation", "Run the approved refresh flow", "Record status without exposing secret values"],
    defaultPrompt: "Check which broker tokens are due for rotation, run the approved refresh flow, and record status without exposing secret values.",
    defaultAttachments: [{ kind: "skill", label: "rotate-tokens" }],
    defaultCadenceKind: "weekday",
  },
  {
    id: "channels/x-publish",
    label: "Publish staged X thread",
    desc: "Review and publish the staged thread draft through the configured channel.",
    section: "Channels",
    badges: ["Publishing", "Social"],
    defaultTitle: "Publish staged X thread",
    defaultMode: "steps",
    defaultSteps: ["Load the staged thread draft", "Check links, mentions, and timing", "Publish through the configured X workflow"],
    defaultPrompt: "Review the staged X thread draft, check links and mentions, then publish through the configured workflow.",
    defaultAttachments: [{ kind: "skill", label: "x-publish" }],
    defaultCadenceKind: "manual",
  },
  {
    id: "sim/run-mm",
    label: "Run MM simulation",
    desc: "Start a market-making simulation and summarize the run.",
    section: "Simulation",
    badges: ["Simulation", "Markets"],
    defaultTitle: "Run market-making simulation",
    defaultMode: "steps",
    defaultSteps: ["Load the current market scenario", "Start the market-making simulation", "Summarize positions, risk, and next actions"],
    defaultPrompt: "Start a market-making simulation from the current market scenario and summarize positions, risk, and next actions.",
    defaultAttachments: [{ kind: "skill", label: "market-making-simulation" }],
    defaultCadenceKind: "session",
  },
  {
    id: "ops/backup-env",
    label: "Backup hive.env.gpg",
    desc: "Encrypt and back up shared environment metadata safely.",
    section: "Ops",
    badges: ["Ops", "Backup"],
    defaultTitle: "Backup hive.env.gpg",
    defaultMode: "steps",
    defaultSteps: ["Verify shared env backup prerequisites", "GPG-encrypt the env backup artifact", "Push the encrypted backup receipt to the shared vault"],
    defaultPrompt: "Verify shared env backup prerequisites, GPG-encrypt the backup artifact, and push the encrypted receipt to the shared vault.",
    defaultAttachments: [{ kind: "skill", label: "shared-hive-env" }],
    defaultCadenceKind: "daily",
  },
  {
    id: "aeon/code-fix",
    label: "Code fix loop",
    desc: "Run a tight fix, verify, and retry loop for a focused code failure.",
    section: "AEON",
    badges: ["AEON", "Loop", "Code"],
    credit: "Loops, designed by AEON",
    defaultTitle: "Code fix loop",
    defaultMode: "steps",
    defaultSteps: ["Reproduce the focused failure", "Patch the smallest relevant code path", "Run the targeted verification and record the result"],
    defaultPrompt: "Run a focused code-fix loop: reproduce the failure, patch the smallest relevant code path, verify, and record the evidence.",
    defaultAttachments: [{ kind: "skill", label: "code-fix" }],
    defaultCadenceKind: "manual",
  },
  {
    id: "aeon/app-build-harness",
    label: "App build harness",
    desc: "Separate planner, builder, and judge roles around an app build.",
    section: "AEON",
    badges: ["AEON", "Loop", "Build"],
    credit: "Loops, designed by AEON",
    defaultTitle: "App build harness",
    defaultMode: "steps",
    defaultSteps: ["Write the planner scope", "Build the requested user workflow", "Run an independent judge pass with screenshots or artifacts"],
    defaultPrompt: "Use the app-build harness: keep planner, builder, and judge work separate, then verify the rendered workflow with evidence.",
    defaultAttachments: [{ kind: "skill", label: "app-build-harness" }],
    defaultCadenceKind: "manual",
  },
  {
    id: "aeon/research",
    label: "Research loop",
    desc: "Search, compare sources, and retry weak evidence before writing the brief.",
    section: "AEON",
    badges: ["AEON", "Loop", "Research"],
    credit: "Loops, designed by AEON",
    defaultTitle: "Research loop",
    defaultMode: "steps",
    defaultSteps: ["Map the research question", "Gather and compare sources", "Write findings with confidence and known gaps"],
    defaultPrompt: "Run a research loop: map the question, gather and compare sources, retry weak evidence, then write findings with confidence and gaps.",
    defaultAttachments: [{ kind: "skill", label: "research" }],
    defaultCadenceKind: "manual",
  },
  {
    id: "aeon/content",
    label: "Content loop",
    desc: "Draft, critique, improve, and record reusable content lessons.",
    section: "AEON",
    badges: ["AEON", "Loop", "Content"],
    credit: "Loops, designed by AEON",
    defaultTitle: "Content loop",
    defaultMode: "steps",
    defaultSteps: ["Draft the content asset", "Run a critique pass against the brief", "Revise and record reusable lessons"],
    defaultPrompt: "Run a content loop: draft, critique against the brief, revise, and record reusable lessons.",
    defaultAttachments: [{ kind: "skill", label: "content-loop" }],
    defaultCadenceKind: "manual",
  },
  {
    id: "aeon/daily-brief",
    label: "Daily brief loop",
    desc: "Collect sources, produce the brief, and capture delivery evidence.",
    section: "AEON",
    badges: ["AEON", "Loop", "Brief"],
    credit: "Loops, designed by AEON",
    defaultTitle: "Daily brief loop",
    defaultMode: "steps",
    defaultSteps: ["Collect the day's configured sources", "Write the brief with links and deltas", "Record delivery evidence"],
    defaultPrompt: "Run a daily brief loop: collect sources, write the brief with links and deltas, and record delivery evidence.",
    defaultAttachments: [{ kind: "skill", label: "daily-brief" }],
    defaultCadenceKind: "daily",
  },
  {
    id: "aeon/evo-benchmark",
    label: "Evo benchmark loop",
    desc: "Try benchmark branches and keep the strongest measured variant.",
    section: "AEON",
    badges: ["AEON", "Loop", "Benchmark"],
    credit: "Loops, designed by AEON",
    defaultTitle: "Evo benchmark loop",
    defaultMode: "steps",
    defaultSteps: ["Define the benchmark and target metric", "Run branch attempts in isolation", "Keep the strongest measured variant and record losing branches"],
    defaultPrompt: "Run an Evo benchmark loop: define the metric, try isolated branches, keep the strongest measured variant, and record losing branches.",
    defaultAttachments: [{ kind: "skill", label: "evo-benchmark" }],
    defaultCadenceKind: "manual",
  },
];

export function findTaskTemplate(id?: string | null) {
  if (!id) return null;
  return TASK_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function taskTemplateSearchText(template: TaskTemplateDefinition) {
  return [
    template.id,
    template.label,
    template.desc,
    template.section,
    template.credit,
    ...template.badges,
    ...template.defaultSteps,
    template.defaultPrompt,
    ...(template.defaultAttachments ?? []).map((attachment) => attachment.label),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function taskTemplateSkillSlugs(template: TaskTemplateDefinition | null | undefined) {
  return [...new Set((template?.defaultAttachments ?? [])
    .filter((attachment) => attachment.kind === "skill")
    .map((attachment) => attachment.label))];
}

export function taskTemplateBody(template: TaskTemplateDefinition | null | undefined) {
  if (!template) return "";
  const parts = [
    `Template: ${template.label}`,
    template.credit ? `Credit: ${template.credit}` : "",
    template.defaultMode === "steps"
      ? ["Steps:", ...template.defaultSteps.map((step, index) => `${index + 1}. ${step}`)].join("\n")
      : template.defaultPrompt,
  ].filter(Boolean);
  return parts.join("\n\n");
}
