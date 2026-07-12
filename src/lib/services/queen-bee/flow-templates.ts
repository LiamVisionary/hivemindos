import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { FlowNode, FlowSpec } from "@/lib/types/agent-flow";

// Named, reusable flow templates. Built-ins ship with HivemindOS; user templates persist to the
// vault under Operations/Flows so a graph/crew can be saved once and instantiated per run.

const FLOWS_FOLDER = ["Operations", "Flows"];

// The canonical LangGraph example: research → draft → review → (quality < bar ? back to research :
// publish) → human approval → done. Demonstrates branching, a bounded loop, and a HITL checkpoint.
export const RESEARCH_DRAFT_PUBLISH: FlowSpec = {
  id: "research-draft-publish",
  name: "Research → Draft → Publish",
  description: "Research a topic, draft it, review for quality, loop until it clears the bar, then publish behind a human approval.",
  start: "research",
  maxSteps: 24,
  nodes: [
    { id: "research", kind: "task", title: "Research", workerClass: "research", prompt: "Research {{state.topic}}. Gather sourced evidence and return concise findings." },
    { id: "draft", kind: "task", title: "Draft", workerClass: "writer", prompt: "Write a draft on {{state.topic}} using these findings:\n{{output.research}}" },
    { id: "review", kind: "task", title: "Quality review", workerClass: "qa", prompt: "Review this draft for quality and return a score 0-1 (>=0.7 = publishable):\n{{output.draft}}" },
    { id: "publish", kind: "task", title: "Publish", workerClass: "ops", prompt: "Prepare the approved draft for publishing:\n{{output.draft}}" },
    { id: "approve", kind: "approval", title: "Approve publish", approvalPrompt: "Approve publishing this piece?" },
  ],
  edges: [
    { from: "research", to: "draft", when: { on: "success" } },
    { from: "draft", to: "review", when: { on: "success" } },
    { from: "review", to: "research", when: { on: "score", lt: 0.7 }, label: "quality < bar" },
    { from: "review", to: "publish", when: { on: "score", gte: 0.7 }, label: "quality >= bar" },
    { from: "review", to: "research", when: { on: "failure" } },
    { from: "publish", to: "approve", when: { on: "success" } },
    { from: "approve", to: "DONE", when: { on: "success" } },
    { from: "approve", to: "FAIL", when: { on: "failure" } },
  ],
};

// A CrewAI-style sequential crew: each role consumes the prior role's output.
export const RESEARCH_WRITE_CRITIQUE: FlowSpec = {
  id: "research-write-critique",
  name: "Research → Write → Critique (crew)",
  description: "A sequential crew: a researcher, a writer, and a critic each hand off to the next.",
  start: "research",
  nodes: [
    { id: "research", kind: "task", title: "Researcher", workerClass: "research", prompt: "Research {{state.topic}} and return key findings." },
    { id: "write", kind: "task", title: "Writer", workerClass: "writer", prompt: "Write the piece on {{state.topic}} from:\n{{output.research}}" },
    { id: "critique", kind: "task", title: "Critic", workerClass: "qa", prompt: "Critique and finalize:\n{{output.write}}" },
  ],
  edges: [
    { from: "research", to: "write", when: { on: "success" } },
    { from: "research", to: "FAIL", when: { on: "failure" } },
    { from: "write", to: "critique", when: { on: "success" } },
    { from: "write", to: "FAIL", when: { on: "failure" } },
    { from: "critique", to: "DONE", when: { on: "success" } },
    { from: "critique", to: "FAIL", when: { on: "failure" } },
  ],
};

// A crypto research crew: collect → on-chain → sentiment → chart → thesis → adversarial review
// (score-gated: a thesis that does not survive loops back to the analyst) → queen synthesis.
// Seed inputs via start state: state.token, state.chain, state.framework (the research lens).
export const CRYPTO_RESEARCH_CREW: FlowSpec = {
  id: "crypto-research-crew",
  name: "Crypto Research Crew",
  description: "A crypto research crew: collector, on-chain analyst, sentiment tracker, chart analyst, thesis analyst, devil's advocate (score-gated), and a queen synthesis. Inputs: state.token, state.chain, state.framework.",
  start: "collector",
  maxSteps: 18,
  priority: "high",
  nodes: [
    {
      id: "collector",
      kind: "task",
      title: "Collector",
      workerClass: "research",
      maxAttempts: 2,
      prompt: "Collect everything on token {{state.token}} on {{state.chain}}: market data via the trading.market-data capability (invoke_hive_capability) and/or a nansen_intelligence token-brief; the project's website and socials; liquidity, volume, FDV, and token age. Return structured findings.",
    },
    {
      id: "onchain",
      kind: "task",
      title: "On-chain analyst",
      workerClass: "research",
      prompt: "Analyze on-chain health for {{state.token}} on {{state.chain}}: holders and concentration, LP status, and security flags. Use nansen_intelligence (holders, flow-intelligence, related-wallets) when available; if a rail is unavailable, degrade gracefully and still return findings from what you can reach. Collector findings:\n{{output.collector}}",
    },
    {
      id: "sentiment",
      kind: "task",
      title: "Sentiment tracker",
      workerClass: "research",
      prompt: "Assess X/social sentiment for {{state.token}}: tone, shill density, organic vs paid signals. If no X rail is available, say so explicitly and pass with what public web research finds. Collector findings:\n{{output.collector}}",
    },
    {
      id: "chart",
      kind: "task",
      title: "Chart analyst",
      workerClass: "research",
      prompt: "Read price structure for {{state.token}} from OHLCV via market data tools: trend, drawdown from ATH, volume trend, and key levels. Collector findings:\n{{output.collector}}",
    },
    {
      id: "analyst",
      kind: "task",
      title: "Analyst",
      workerClass: "writer",
      maxAttempts: 2,
      prompt: "Build the investment thesis for {{state.token}} strictly through this lens:\n{{state.framework}}\n\nUse all prior findings.\nCollector:\n{{output.collector}}\nOn-chain:\n{{output.onchain}}\nSentiment:\n{{output.sentiment}}\nChart:\n{{output.chart}}",
    },
    {
      id: "devils-advocate",
      kind: "task",
      title: "Devil's advocate",
      workerClass: "qa",
      prompt: "Adversarially attack this thesis:\n{{output.analyst}}\n\nCross-check each stage's claims against the others (collector vs on-chain vs sentiment vs chart) and call out contradictions or fabricated numbers. Apply the framework red flags:\n{{state.framework}}\n\nYou MUST end your output with a final line of exactly \"score: 0.NN\" — your 0-1 confidence that the thesis survives the attack.",
    },
    {
      id: "queen",
      kind: "task",
      title: "Queen synthesis",
      workerClass: "writer",
      prompt: "Final call on {{state.token}}. Synthesize the thesis and the adversarial review into one clean markdown report with: a verdict (one of strong_avoid|avoid|neutral|speculative_watch|conviction), a 0-100 score, and a \"what would change my mind\" section listing concrete re-rating triggers.\nThesis:\n{{output.analyst}}\nDevil's advocate:\n{{output.devils-advocate}}",
    },
  ],
  edges: [
    { from: "collector", to: "onchain", when: { on: "success" } },
    { from: "collector", to: "FAIL", when: { on: "failure" } },
    { from: "onchain", to: "sentiment", when: { on: "success" } },
    { from: "onchain", to: "FAIL", when: { on: "failure" } },
    { from: "sentiment", to: "chart", when: { on: "success" } },
    { from: "sentiment", to: "FAIL", when: { on: "failure" } },
    { from: "chart", to: "analyst", when: { on: "success" } },
    { from: "chart", to: "FAIL", when: { on: "failure" } },
    { from: "analyst", to: "devils-advocate", when: { on: "success" } },
    { from: "analyst", to: "FAIL", when: { on: "failure" } },
    { from: "devils-advocate", to: "analyst", when: { on: "score", lt: 0.6 }, label: "thesis does not survive" },
    { from: "devils-advocate", to: "queen", when: { on: "score", gte: 0.6 }, label: "thesis survives" },
    { from: "devils-advocate", to: "FAIL", when: { on: "failure" } },
    { from: "queen", to: "DONE", when: { on: "success" } },
    { from: "queen", to: "FAIL", when: { on: "failure" } },
  ],
};

export const BUILT_IN_FLOWS: FlowSpec[] = [RESEARCH_DRAFT_PUBLISH, RESEARCH_WRITE_CRITIQUE, CRYPTO_RESEARCH_CREW];

// Build a linear (sequential) flow from an ordered list of steps. Each step's success advances to
// the next; the last advances to DONE; any failure routes to FAIL. This is CrewAI's sequential
// process and the backbone for company process: "sequential".
export function flowFromSequence(
  steps: Array<Pick<FlowNode, "id" | "title" | "workerClass" | "prompt" | "skills"> & { id?: string }>,
  meta: { id: string; name: string; description?: string },
): FlowSpec {
  const nodes: FlowNode[] = steps.map((s, i) => ({
    id: s.id || `step-${i + 1}`,
    kind: "task",
    title: s.title,
    workerClass: s.workerClass,
    prompt: s.prompt,
    skills: s.skills,
  }));
  const edges = nodes.flatMap((node, i) => {
    const next = i + 1 < nodes.length ? nodes[i + 1].id : "DONE";
    return [
      { from: node.id, to: next, when: { on: "success" as const } },
      { from: node.id, to: "FAIL", when: { on: "failure" as const } },
    ];
  });
  return { id: meta.id, name: meta.name, description: meta.description, start: nodes[0]?.id ?? "step-1", nodes, edges };
}

function flowsDir(vaultPath?: string | null): string {
  const root = resolveObsidianVaultPath(vaultPath || DEFAULT_SHARED_VAULT.vaultPath);
  return join(root, ...FLOWS_FOLDER);
}

export async function saveFlowTemplate(spec: FlowSpec, opts: { vaultPath?: string | null } = {}): Promise<void> {
  const dir = flowsDir(opts.vaultPath);
  await mkdir(dir, { recursive: true });
  const safeId = spec.id.replace(/[^a-z0-9-]/gi, "-");
  await writeFile(join(dir, `${safeId}.json`), `${JSON.stringify(spec, null, 2)}\n`);
}

export async function listFlowTemplates(opts: { vaultPath?: string | null } = {}): Promise<FlowSpec[]> {
  const dir = flowsDir(opts.vaultPath);
  const saved: FlowSpec[] = [];
  if (existsSync(dir)) {
    for (const entry of await readdir(dir).catch(() => [])) {
      if (!entry.endsWith(".json")) continue;
      try {
        saved.push(JSON.parse(await readFile(join(dir, entry), "utf8")) as FlowSpec);
      } catch {
        // skip malformed template
      }
    }
  }
  const savedIds = new Set(saved.map((s) => s.id));
  return [...BUILT_IN_FLOWS.filter((b) => !savedIds.has(b.id)), ...saved].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getFlowTemplate(id: string, opts: { vaultPath?: string | null } = {}): Promise<FlowSpec | null> {
  const all = await listFlowTemplates(opts);
  return all.find((s) => s.id === id) ?? null;
}
