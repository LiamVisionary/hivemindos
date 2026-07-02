import "server-only";

import type { Company } from "@/lib/types/company";
import type { QueenBeePrdTaskDraft } from "@/lib/services/queen-bee/prd-decomposition";
import { pickConversationAgent } from "@/lib/services/queen-bee/voice-turn";
import { readRuntimeResponseText, voiceOptimizedAgent } from "@/lib/services/phone/runtime-voice-turn";
import { transcriptionApiKey } from "@/lib/services/phone/transcription";

/**
 * LLM-authored decomposition of a company's apex goal into concrete, goal-specific
 * tasks — using queen-bee's existing "brain order": the company's own chat-capable
 * fleet agent first (agent-scoped model, via /api/chat/agent-runtime, exactly like
 * runQueenBeePilotTurn), then an OpenAI structured-output fallback. Returns null
 * when no brain is reachable, so the caller falls back to the heuristic plan.
 */

const AGENT_TURN_TIMEOUT_MS = 30_000;
const OPENAI_TURN_TIMEOUT_MS = 30_000;
const OPENAI_FALLBACK_MODEL = "gpt-4o-mini";

type PlannedTask = { title: string; detail: string; role: string };

const ROLE_SKILL: Record<string, string> = {
  Engineer: "code", Product: "planner", Designer: "writer", QA: "qa",
  DevOps: "ops", Auditor: "security", Growth: "writer", Research: "research", Treasury: "ops", Queen: "planner",
};

function crewRoster(company: Company): string {
  const members = company.members ?? [];
  if (members.length === 0) return "Engineer, Research, QA";
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const m of members) {
    const role = (m.roleInCompany || "").trim();
    if (!role || seen.has(role)) continue;
    seen.add(role);
    parts.push(role);
  }
  return parts.join(", ") || "Engineer, Research, QA";
}

function systemPrompt(maxTasks: number): string {
  return [
    "You are the Queen Bee planning the next batch of work for an autonomous, zero-human company.",
    "Turn the company's apex goal into concrete, independently-actionable tasks for its crew.",
    'Reply with STRICT JSON ONLY (no prose, no markdown fences), matching: {"tasks": [{"title": string, "detail": string, "role": string}]}.',
    `Rules: return ${Math.min(3, maxTasks)}-${maxTasks} tasks; each title is a short verb-first action phrase of 4-9 words naming its concrete object (e.g. "Audit reply rates for the first outreach batch"), never a single word;`,
    "detail is 1-3 sentences of concrete scope tied directly to THIS goal and its metric (no generic filler);",
    "role is one of the crew roles provided; prefer tasks that can run in parallel; make tasks specific to this goal, not boilerplate.",
    "When company activity history is provided: plan the NEXT increment — build on completed work, do NOT repeat it, unblock or route around blocked items, and follow up on open threads, leads, or customers mentioned there.",
  ].join("\n");
}

export function userPrompt(company: Company, history?: string): string {
  const apex = company.apexGoal;
  const goal = apex?.title?.trim() || company.name;
  const lines = [
    `Company: ${company.name}${company.sector ? ` (${company.sector})` : ""}`,
    `Apex goal: ${goal}`,
  ];
  if (apex?.metric || apex?.target) lines.push(`Metric: ${apex?.metric || "—"}${apex?.target ? ` → target ${apex.target}` : ""}${apex?.current ? ` (current ${apex.current})` : ""}`);
  const mission = (company.blurb || company.charter || "").trim();
  if (mission) lines.push(`Mission: ${mission}`);
  lines.push(`Crew roles available: ${crewRoster(company)}`);
  const trimmedHistory = history?.trim();
  if (trimmedHistory) {
    lines.push("", "Recent company activity (newest first):", trimmedHistory, "");
  }
  lines.push("Produce the next batch of tasks that moves this goal toward its target.");
  return lines.join("\n");
}

function extractTasks(raw: string, maxTasks: number): PlannedTask[] {
  if (!raw) return [];
  // Tolerate code fences / surrounding prose: grab the first {...} block.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const tasks = (parsed as { tasks?: unknown })?.tasks;
  if (!Array.isArray(tasks)) return [];
  const out: PlannedTask[] = [];
  for (const entry of tasks) {
    if (!entry || typeof entry !== "object") continue;
    const raw2 = entry as Record<string, unknown>;
    const title = typeof raw2.title === "string" ? raw2.title.trim() : "";
    if (!title) continue;
    out.push({
      title: title.slice(0, 110),
      detail: typeof raw2.detail === "string" ? raw2.detail.trim() : "",
      role: typeof raw2.role === "string" ? raw2.role.trim() : "",
    });
    if (out.length >= maxTasks) break;
  }
  return out;
}

function toDrafts(tasks: PlannedTask[], company: Company): QueenBeePrdTaskDraft[] {
  const apex = company.apexGoal;
  const goal = apex?.title?.trim() || company.name;
  const metricLine = apex?.metric || apex?.target ? ` (metric: ${apex?.metric || "—"}${apex?.target ? ` → ${apex.target}` : ""})` : "";
  return tasks.map((t) => ({
    title: t.title,
    body: [
      t.detail || t.title,
      "",
      `Company apex goal: ${goal}${metricLine}.`,
      "Complete this scoped task and record the result on the Work Board.",
    ].join("\n"),
    skills: ["company-goal", ROLE_SKILL[t.role] || "code"],
    dependsOnDraftIndexes: [],
  }));
}

async function runOpenAiDecompose(system: string, user: string): Promise<string> {
  const apiKey = await transcriptionApiKey().catch(() => "");
  if (!apiKey) return "";
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_VOICE_CHAT_MODEL || OPENAI_FALLBACK_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: 900,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(OPENAI_TURN_TIMEOUT_MS),
    });
    if (!response.ok) return "";
    const data = (await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
    return data?.choices?.[0]?.message?.content?.trim() || "";
  } catch {
    return "";
  }
}

export async function llmDecomposeApexGoal(
  company: Company,
  opts: { origin?: string; vaultPath?: string; maxTasks?: number; history?: string } = {},
): Promise<QueenBeePrdTaskDraft[] | null> {
  if (!company.apexGoal?.title?.trim()) return null;
  const maxTasks = Math.max(1, Math.min(opts.maxTasks ?? 6, 8));
  const system = systemPrompt(maxTasks);
  const user = userPrompt(company, opts.history);

  // 1. Brain: the company's own chat-capable fleet agent (agent-scoped model),
  //    via the same /api/chat/agent-runtime path queen-bee's pilot/voice turns use.
  if (opts.origin) {
    const agent = await pickConversationAgent(opts.vaultPath).catch(() => null);
    if (agent) {
      try {
        const response = await fetch(new URL("/api/chat/agent-runtime", opts.origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agent: voiceOptimizedAgent(agent),
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
            runtimeSessionId: "company-goal-planner",
            agentMode: "act",
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(AGENT_TURN_TIMEOUT_MS),
        });
        // Only parse a successful response — an error body could itself contain
        // task-shaped JSON and produce junk Work Board cards.
        if (response.ok) {
          const tasks = extractTasks(await readRuntimeResponseText(response), maxTasks);
          if (tasks.length > 0) return toDrafts(tasks, company);
        }
      } catch (error) {
        console.warn("[company-goal-planner] agent decomposition failed; trying OpenAI:", error instanceof Error ? error.message : error);
      }
    }
  }

  // 2. Fallback: OpenAI structured output (same key chain queen-bee uses).
  const tasks = extractTasks(await runOpenAiDecompose(system, user), maxTasks);
  if (tasks.length > 0) return toDrafts(tasks, company);

  // 3. No brain reachable → caller uses the heuristic plan.
  return null;
}
