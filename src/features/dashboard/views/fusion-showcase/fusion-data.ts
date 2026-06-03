// src/components/fusion/fusion-data.ts
// Real Hive Fusion content: capabilities scattered across machines, the tested
// workflow parts, packaged skills, and copy. Brand marks / bee subclass icons
// are referenced by their existing public paths.
import type { LucideIcon } from "lucide-react";
import {
  Bot, CheckCircle2, Clock3, Cloud, Cpu, Database, Filter, GitBranch,
  MessageSquare, Network, Search, Send, Server, ShieldCheck,
  Sparkles, Wrench,
} from "lucide-react";

export type Tone = "teal" | "gold" | "violet" | "blue" | "black";
export const TONE: Record<Tone, string> = {
  teal: "var(--fz-teal)", gold: "var(--fz-gold)", violet: "var(--fz-violet)",
  blue: "var(--fz-blue)", black: "#e8edf6",
};

export interface Machine { id: string; name: string; kind: string; icon: LucideIcon; }
export interface Capability {
  id: string; label: string; machine: string; tone: Tone;
  logo?: string; icon: LucideIcon; used: boolean; meta: string; detail: string;
}
export interface FusionStep { key: string; label: string; detail: string; icon: LucideIcon; tone: Tone; }
export interface Receipt { label: string; detail: string; icon: LucideIcon; }
export interface PackagedSkill { name: string; slug: string; tone: Tone; signal: string; description: string; }

export const CORE_EMBLEM = "/demos/hive-fusion-core.png";
export const BEE_LOTTIE = "/animations/Honey bee.lottie";

export const MACHINES: Machine[] = [
  { id: "studio", name: "studio-mac", kind: "workstation", icon: Cpu },
  { id: "nimbus", name: "nimbus-vps", kind: "cloud node", icon: Cloud },
  { id: "gpu", name: "gpu-rig", kind: "gpu host", icon: Server },
];

// `used` marks the parts that compose the demo's unified skill.
export const CAPS: Capability[] = [
  { id: "x", label: "X research", machine: "nimbus", tone: "black", logo: "/fusion/logos/x.svg", icon: Search, used: true, meta: "source", detail: "Pull current social signal from the configured X-capable path." },
  { id: "obsidian", label: "Obsidian brain", machine: "studio", tone: "violet", logo: "/fusion/logos/obsidian.svg", icon: Network, used: true, meta: "RAG", detail: "Retrieve shared skills, style context, and hive memory." },
  { id: "writer", label: "Writer bee", machine: "studio", tone: "gold", logo: "/icons/worker-bee-writer-v2.png", icon: Bot, used: true, meta: "agent", detail: "Draft the post with the app's real writer subclass." },
  { id: "comfy", label: "ComfyUI image", machine: "gpu", tone: "blue", logo: "/fusion/logos/comfyui.svg", icon: Sparkles, used: true, meta: "image", detail: "Generate a matching visual through the discovered image app." },
  { id: "telegram", label: "Telegram send", machine: "nimbus", tone: "teal", logo: "/fusion/logos/telegram.svg", icon: Send, used: true, meta: "receipt", detail: "Deliver the final artifact to the user's configured channel." },
  { id: "base", label: "Base feed", machine: "nimbus", tone: "gold", logo: "/fusion/logos/base-mark.svg", icon: Network, used: false, meta: "source", detail: "On-chain + news signal from the Base ecosystem." },
  { id: "memory", label: "Vault memory", machine: "studio", tone: "teal", icon: Database, used: false, meta: "store", detail: "Shared Obsidian vault state across the hive." },
  { id: "scheduler", label: "Scheduler", machine: "gpu", tone: "gold", icon: Clock3, used: false, meta: "cadence", detail: "Background cadence for recurring duties." },
  { id: "shield", label: "Safety proxy", machine: "nimbus", tone: "violet", icon: ShieldCheck, used: false, meta: "gate", detail: "Redaction + approval gate before any side effect." },
  { id: "code", label: "Code bee", machine: "gpu", tone: "teal", logo: "/icons/worker-bee-code-v2.png", icon: Wrench, used: false, meta: "agent", detail: "Build + verify steps when a task needs real code." },
];

export const STEPS: FusionStep[] = [
  { key: "prompt", label: "Prompt", detail: "Goal, constraints, side effects", icon: MessageSquare, tone: "teal" },
  { key: "retrieve", label: "Retrieve", detail: "Skills, tools, apps, agents", icon: Search, tone: "teal" },
  { key: "rank", label: "Rank", detail: "Best fit, cost, safety, proof", icon: Filter, tone: "gold" },
  { key: "fuse", label: "Fuse", detail: "Capability map and graph", icon: GitBranch, tone: "gold" },
  { key: "verify", label: "Verify", detail: "Artifacts, receipts, dry runs", icon: CheckCircle2, tone: "violet" },
  { key: "deliver", label: "Deliver", detail: "Skill, workflow, AEON duty", icon: Send, tone: "violet" },
];

export const RECEIPTS: Receipt[] = [
  { label: "Discovered", detail: "No provider hard-code", icon: Search },
  { label: "Fused", detail: "Research + brain + writer + image + delivery", icon: GitBranch },
  { label: "Proved", detail: "Artifacts and message receipt required", icon: CheckCircle2 },
];

export const SKILLS: PackagedSkill[] = [
  { name: "Hive Skill Fusion", slug: "hive-skill-fusion", tone: "teal", signal: "Reusable skill synthesis",
    description: "Turns a natural-language capability request into a durable shared skill by discovering and combining the best available tools, apps, agents, credentials, and delivery channels." },
  { name: "Hive Workflow Fusion", slug: "hive-workflow-fusion", tone: "gold", signal: "End-to-end orchestration",
    description: "Builds and runs an adaptive execution graph for a multi-step task, choosing operators, sequencing handoffs, verifying artifacts, and requiring real delivery receipts." },
  { name: "Hive AEON Fusion", slug: "hive-aeon-fusion", tone: "violet", signal: "Autonomous duty conversion",
    description: "Converts fused skills and workflows into AEON-ready background duties with cadence, readiness checks, retry policy, artifact paths, and approval gates." },
];

export const COPY = {
  heroEyebrow: "Hive fusion engine",
  heroLede: "You just chat. Fusion discovers every tool, app, agent, and channel scattered across all your machines, ranks the best parts, and combines them into one durable skill that completes the task — no provider hard-coded, every result proved.",
  prompt: "Turn the latest Base news into an X post with a matching image, and send it to my Telegram.",
  workflowTitle: "Base news → X post → generated image → Telegram delivery.",
  workflowLede: "Fusion looks up the available runtime parts, chooses the best configured path for each job, and produces a real delivery receipt instead of stopping at a plan.",
};
