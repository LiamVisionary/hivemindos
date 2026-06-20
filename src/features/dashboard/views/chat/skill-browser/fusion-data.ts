import type { FusionCapabilityRecord, FusionSkillResult } from "@/lib/services/fusion/fusion-skill";

export type FzTone = "teal" | "gold" | "violet" | "blue" | "black";

export const FZ_TONE_FR: Record<FzTone, string> = {
  teal: "var(--live)",
  gold: "var(--honey)",
  violet: "var(--honey)",
  blue: "var(--live)",
  black: "var(--fg-2)",
};

export interface FzMachine { id: string; name: string; kind: string; icon: string; host?: string }
export interface FzCap { id: string; label: string; machine: string; tone: FzTone; icon: string; used: boolean; meta: string; detail: string }
export interface FzStep { key: string; label: string; detail: string; icon: string }
export interface FzReceipt { label: string; detail: string; icon: string }
export interface FzSkill { name: string; slug: string; signal: string; description: string; path?: string }

export const FZ_MACHINES: FzMachine[] = [
  { id: "studio", name: "studio-mac", kind: "workstation", icon: "cpu", host: "tail-fern.ts.net" },
  { id: "nimbus", name: "nimbus-vps", kind: "cloud node", icon: "cloud", host: "nimbus.ts.net" },
  { id: "gpu", name: "gpu-rig", kind: "gpu host", icon: "server", host: "forge.ts.net" },
];

export const FZ_CAPS: FzCap[] = [
  { id: "x", label: "X research", machine: "nimbus", tone: "black", icon: "search", used: true, meta: "source", detail: "Pull current social signal from the configured X-capable path." },
  { id: "obsidian", label: "Obsidian brain", machine: "studio", tone: "violet", icon: "brain", used: true, meta: "RAG", detail: "Retrieve shared skills, style context, and hive memory." },
  { id: "writer", label: "Writer bee", machine: "studio", tone: "gold", icon: "bot", used: true, meta: "agent", detail: "Draft the post with the app's real writer subclass." },
  { id: "comfy", label: "ComfyUI image", machine: "gpu", tone: "blue", icon: "sparkles", used: true, meta: "image", detail: "Generate a matching visual through the discovered image app." },
  { id: "telegram", label: "Telegram send", machine: "nimbus", tone: "teal", icon: "deliver", used: true, meta: "receipt", detail: "Deliver the final artifact to the user's configured channel." },
  { id: "base", label: "Base feed", machine: "nimbus", tone: "gold", icon: "network", used: false, meta: "source", detail: "On-chain + news signal from the Base ecosystem." },
  { id: "memory", label: "Vault memory", machine: "studio", tone: "teal", icon: "db", used: false, meta: "store", detail: "Shared Obsidian vault state across the hive." },
  { id: "scheduler", label: "Scheduler", machine: "gpu", tone: "gold", icon: "clock", used: false, meta: "cadence", detail: "Background cadence for recurring duties." },
  { id: "shield", label: "Safety proxy", machine: "nimbus", tone: "violet", icon: "shield", used: false, meta: "gate", detail: "Redaction + approval gate before any side effect." },
  { id: "code", label: "Code bee", machine: "gpu", tone: "teal", icon: "wrench", used: false, meta: "agent", detail: "Build + verify steps when a task needs real code." },
];

export const FZ_STEPS: FzStep[] = [
  { key: "prompt", label: "Prompt", detail: "Goal, constraints, side effects", icon: "prompt" },
  { key: "retrieve", label: "Retrieve", detail: "Skills, tools, apps, agents", icon: "search" },
  { key: "rank", label: "Rank", detail: "Best fit, cost, safety, proof", icon: "filter" },
  { key: "fuse", label: "Fuse", detail: "Capability map and graph", icon: "fuse" },
  { key: "verify", label: "Verify", detail: "Artifacts, receipts, dry runs", icon: "verify" },
  { key: "deliver", label: "Deliver", detail: "Skill, workflow, AEON duty", icon: "deliver" },
];

export const FZ_RECEIPTS: FzReceipt[] = [
  { label: "Discovered", detail: "No provider hard-code", icon: "search" },
  { label: "Fused", detail: "Capabilities ranked and combined", icon: "fuse" },
  { label: "Proved", detail: "Skill written with capability evidence", icon: "verify" },
];

export const FZ_SKILL: FzSkill = {
  name: "Hive Skill Fusion",
  slug: "hive-skill-fusion",
  signal: "Reusable skill synthesis",
  description: "Turns a natural-language capability request into a durable shared skill by discovering and combining the best available tools, apps, agents, credentials, and delivery channels.",
};

export const FZ_PROMPT = "Turn the latest Base news into an X post with a matching image, and send it to my Telegram.";
export const FZ_PHASES = ["idle", "discover", "rank", "fuse", "verify", "reveal"] as const;
export type FzPhase = (typeof FZ_PHASES)[number];
export const FZ_DUR = [0, 900, 700, 900, 700, 0];

const ICON_MAP: Record<FusionCapabilityRecord["icon"], string> = {
  bot: "bot",
  brain: "brain",
  code: "wrench",
  database: "db",
  file: "file",
  globe: "cloud",
  image: "sparkles",
  network: "network",
  search: "search",
  send: "deliver",
  shield: "shield",
  sparkles: "sparkles",
  terminal: "wrench",
  wallet: "shield",
};

export type FusionSkillResponse = (FusionSkillResult & { ok: true }) | { ok?: false; error?: string };

export function capsFromFusionResult(result: FusionSkillResult | null): FzCap[] {
  if (!result?.capabilities.length) return FZ_CAPS;
  return result.capabilities.map((record) => ({
    id: record.id,
    label: record.label,
    machine: record.machine,
    tone: record.tone,
    icon: ICON_MAP[record.icon] ?? "network",
    used: record.used,
    meta: record.meta,
    detail: record.detail,
  }));
}

export function machinesFromFusionResult(result: FusionSkillResult | null): FzMachine[] {
  if (!result?.capabilities.length) return FZ_MACHINES;
  const machines = new Map<string, FzMachine>();
  for (const record of result.capabilities) {
    if (machines.has(record.machine)) continue;
    machines.set(record.machine, {
      id: record.machine,
      name: record.machineLabel || record.machine,
      kind: record.kind,
      icon: record.machine === "this-mac" ? "cpu" : record.machine === "runtime" ? "bot" : "server",
    });
  }
  return [...machines.values()];
}

export function skillFromFusionResult(result: FusionSkillResult | null): FzSkill {
  if (!result) return FZ_SKILL;
  return {
    name: result.skill.name,
    slug: result.skill.slug,
    signal: "Reusable skill synthesis",
    description: result.skill.description,
    path: result.skill.path,
  };
}
