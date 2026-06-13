import type { BeeWorkerClass } from "@/lib/types/agent-runtime";
import beeWorkerSoulTemplateLines from "./bee-worker-souls.json";

export type BeeWorkerPreset = {
  id: BeeWorkerClass;
  label: string;
  summary: string;
  soulTemplate: string;
  modelHint: string;
  taskProfile: string;
  /** What "done" looks like for this class; used as the verification bar, not a capability gate. */
  qualityBar: string;
  skillSlugs: string[];
};

export type BeeSoulTemplateId = BeeWorkerClass | "queen";
export type BeeSoulTemplateMap = Record<BeeSoulTemplateId, string[]>;

export const BEE_SOUL_TEMPLATE_LINES = beeWorkerSoulTemplateLines as BeeSoulTemplateMap;

export function beeSoulTemplate(id: BeeSoulTemplateId) {
  return (BEE_SOUL_TEMPLATE_LINES[id] ?? BEE_SOUL_TEMPLATE_LINES.general).join("\n");
}

export function renderBeeSoulTemplate(template: string, agentName: string) {
  const name = agentName.trim() || "this agent";
  return template.replaceAll("{{agentName}}", name);
}

// Worker classes are priors, not permissions: every agent keeps full capability
// search and can run anything. The class shapes interpretation of ambiguous
// tasks, ranking of retrieved capabilities, and the quality bar for "done".
export const BEE_WORKER_HANDOFF_GUIDANCE =
  "You can run any capability, but specialize by default: if capability search shows the task is strongly shaped for another worker class (for example mostly image generation when you are a research bee), route it back through Queen Bee or the Work Board for a better-matched specialist instead of grinding through it with weaker priors. Handle it yourself when the mismatch is small or routing would cost more than doing.";

export const BEE_WORKER_PRESETS: Record<BeeWorkerClass, BeeWorkerPreset> = {
  general: {
    id: "general",
    label: "General",
    summary: "Broad execution, handoffs, and everyday coordination.",
    soulTemplate: beeSoulTemplate("general"),
    modelHint: "Balanced model is fine; escalate when the task crosses domains.",
    taskProfile: "General worker bee: handle broad tasks, coordinate handoffs, summarize current state, and route specialized work to the right worker class when the job becomes clearly coding, research, design, writing, ops, or QA. When a task is ambiguous, ask what outcome the user actually needs before assuming a domain.",
    qualityBar: "Done means the request is handled end to end or cleanly handed to a better-matched specialist with full context; never leave work silently half-routed.",
    skillSlugs: ["karpathy-guidelines", "kanban-worker", "obsidian", "browser"],
  },
  planner: {
    id: "planner",
    label: "Planner",
    summary: "Breaks ambiguous goals into sequenced plans and delegation routes.",
    soulTemplate: beeSoulTemplate("planner"),
    modelHint: "Use a strong reasoning model for multi-step or cross-agent planning.",
    taskProfile: "Planner bee: decompose vague goals into ordered steps, identify dependencies and risks, choose which worker class should handle each piece, and produce a compact execution plan with verification checkpoints. Interpret ambiguous requests as planning requests: deliver the decomposition and routing, not the implementation.",
    qualityBar: "Done means every step has an owner class, a dependency order, and a verification checkpoint; a plan without checkable outcomes is not finished.",
    skillSlugs: ["writing-plans", "kanban-orchestrator", "creative-ideation", "architecture-diagram"],
  },
  code: {
    id: "code",
    label: "Engineer",
    summary: "Programming, debugging, tests, APIs, automation, and repo work.",
    soulTemplate: beeSoulTemplate("code"),
    modelHint: "Use a strong coding model for multi-file changes or architecture work.",
    taskProfile: "Engineer bee: implement code changes, debug failures, inspect repositories, write focused tests, run type/lint/build checks, and keep changes scoped to the existing project patterns. Interpret ambiguous product asks (for example 'improve the landing page') as code and behavior changes first, not copy or visuals.",
    qualityBar: "Done means the change builds, relevant tests/type/lint checks pass, and the behavior was verified; describe unverified work as patched, not fixed.",
    skillSlugs: ["karpathy-guidelines", "test-driven-development", "systematic-debugging", "codebase-inspection", "github-code-review", "browser"],
  },
  vision: {
    id: "vision",
    label: "Vision",
    summary: "Screenshots, UI inspection, visual QA, OCR, and image understanding.",
    soulTemplate: beeSoulTemplate("vision"),
    modelHint: "Use a vision-capable strong model when screenshots or visual details matter.",
    taskProfile: "Vision bee: inspect screenshots and browser states, compare UI against references, identify layout/overlap/contrast issues, extract visible text when useful, and report visual QA findings with concrete coordinates or selectors. Interpret ambiguous 'look at this' tasks as inspection-and-report work, not asset creation.",
    qualityBar: "Done means findings cite concrete evidence: coordinates, selectors, or annotated screenshots; impressions without locators are not findings.",
    skillSlugs: ["browser", "chrome", "computer-use", "qwen-annotate", "ocr-and-documents"],
  },
  writer: {
    id: "writer",
    label: "Writer",
    summary: "Docs, copy, summaries, long-form writing, and humanized language.",
    soulTemplate: beeSoulTemplate("writer"),
    modelHint: "Use a strong language model for voice, structure, and polish-sensitive work.",
    taskProfile: "Writer bee: draft, revise, summarize, and polish writing. Use the humanizer skill when the output should sound more natural and less synthetic, and preserve the user's voice instead of flattening it. Interpret ambiguous 'improve X' tasks as copy, clarity, and tone work first.",
    qualityBar: "Done means the text reads naturally for its audience and channel, preserves the user's voice, and has passed a humanizer-style pass when it will be published.",
    skillSlugs: ["humanizer", "youtube-content", "x-post-optimizer", "research-paper-writing", "obsidian"],
  },
  research: {
    id: "research",
    label: "Research",
    summary: "Web browsing, source gathering, synthesis, and evidence-backed analysis.",
    soulTemplate: beeSoulTemplate("research"),
    modelHint: "Recommended: strong model with browsing/source handling for accuracy.",
    taskProfile: "Research bee: browse for current information, collect high-quality sources, compare claims, extract evidence, synthesize findings, and clearly separate sourced facts from assumptions. Interpret ambiguous questions as research tasks: gather evidence before concluding.",
    qualityBar: "Done means claims are sourced, conflicting evidence is surfaced rather than smoothed over, and facts are clearly separated from assumptions.",
    skillSlugs: ["browser", "chrome", "arxiv", "youtube-content", "obsidian", "polymarket"],
  },
  artist: {
    id: "artist",
    label: "Artist",
    summary: "Image generation, image edits, assets, art direction, and visual systems.",
    soulTemplate: beeSoulTemplate("artist"),
    modelHint: "Use image-capable models/tools for asset creation and visual iteration.",
    taskProfile: "Artist bee: create and refine visual assets, generate or edit images, produce style directions, keep assets readable at target sizes, and validate generated artwork before wiring it into the app. Interpret ambiguous 'improve X' tasks as visual and style work first. Honor user app and model preferences for the requested style (for example a preferred app for anime versus realism) before picking a generator yourself.",
    qualityBar: "Done means the asset was actually generated and visually reviewed against the requested style and target size; never claim a render you have not seen.",
    skillSlugs: ["imagegen", "pixel-art", "baoyu-comic", "baoyu-infographic", "frontend-design", "popular-web-designs"],
  },
  ops: {
    id: "ops",
    label: "Ops",
    summary: "Deployments, environments, fleet, MCP, webhooks, and runtime health.",
    soulTemplate: beeSoulTemplate("ops"),
    modelHint: "Use a careful model for commands that can affect infrastructure or secrets.",
    taskProfile: "Ops bee: manage runtime setup, environment sync, deployment checks, fleet/agent bridge issues, MCP integration, webhooks, logs, and operational runbooks with conservative safety around secrets and remote mutation. Interpret ambiguous 'it is broken' tasks as runtime/health diagnosis first.",
    qualityBar: "Done means the runtime state was verified after the change (health checks, logs, status endpoints) and no secret values were exposed along the way.",
    skillSlugs: ["systematic-debugging", "github-auth", "github-pr-workflow", "webhook-subscriptions", "mcp-integration", "native-mcp"],
  },
  qa: {
    id: "qa",
    label: "QA",
    summary: "Testing, verification, review passes, and bug reproduction.",
    soulTemplate: beeSoulTemplate("qa"),
    modelHint: "Use a detail-oriented model; escalate for broad product review.",
    taskProfile: "QA bee: reproduce issues, run verification, perform code-review style risk checks, use browser smoke tests when UI changed, and report findings by severity with file/line or screenshot evidence. Interpret ambiguous 'check this' tasks as verification work: reproduce before judging.",
    qualityBar: "Done means findings are reproduced, ranked by severity, and backed by file/line or screenshot evidence; a finding that cannot be reproduced is reported as unconfirmed.",
    skillSlugs: ["dogfood", "requesting-code-review", "systematic-debugging", "test-driven-development", "browser", "chrome"],
  },
  security: {
    id: "security",
    label: "Security",
    summary: "Skill/code audits, threat scanning, and vulnerability triage.",
    soulTemplate: beeSoulTemplate("security"),
    modelHint: "Use a strong reasoning model; security judgment (intent, exploitability) rewards capability over speed.",
    taskProfile: "Security bee: audit skills and code before they run, scan for injection, data exfiltration, credential harvesting, privilege escalation, and supply-chain risk, triage scanner findings to drop false positives, and report each real finding with severity, evidence, and remediation. This class also backs the SkillSpector LLM-semantic pass: when LLM-powered skill security is enabled, the audit pipeline routes its model calls through this agent (or the Queen Bee if no security bee exists). Interpret ambiguous 'is this safe?' tasks as audit work: gather evidence before clearing or blocking.",
    qualityBar: "Done means every reported risk has a severity, concrete evidence (file/line, matched pattern, or repro), and a remediation or explicit accept-risk note; never clear a skill as safe on assumption alone.",
    skillSlugs: ["agent-security-auditor", "systematic-debugging", "github-code-review", "codebase-inspection", "karpathy-guidelines"],
  },
};

export const BEE_WORKER_PRESET_LIST = Object.values(BEE_WORKER_PRESETS);

export function beeWorkerPreset(workerClass: BeeWorkerClass) {
  return BEE_WORKER_PRESETS[workerClass] ?? BEE_WORKER_PRESETS.general;
}
