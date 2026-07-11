import "server-only";

import type { Company } from "@/lib/types/company";
import { activeCompanyApprovalPolicies } from "@/lib/services/company-approval-policies";
import type { QueenBeePrdTaskDraft } from "@/lib/services/queen-bee/prd-decomposition";
import { pickConversationAgent } from "@/lib/services/queen-bee/voice-turn";
import { readRuntimeResponseText, voiceOptimizedAgent } from "@/lib/services/phone/runtime-voice-turn";
import { openAICompatibleInferenceCacheHints } from "@/lib/services/chat/inference-cache-hints";
import { transcriptionApiKey } from "@/lib/services/phone/transcription";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

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

/** How many lifetime completed-task titles the planner prompt carries. */
const COMPLETED_INVENTORY_LIMIT = 40;

export function userPrompt(company: Company, history?: string, completedTitles?: readonly string[], salesContentContext?: string): string {
  const apex = company.apexGoal;
  const goal = apex?.title?.trim() || company.name;
  const lines = [
    `Company: ${company.name}${company.sector ? ` (${company.sector})` : ""}`,
    `Apex goal: ${goal}`,
  ];
  if (apex?.metric || apex?.target) lines.push(`Metric: ${apex?.metric || "—"}${apex?.target ? ` → target ${apex.target}` : ""}${apex?.current ? ` (current ${apex.current})` : ""}`);
  const mission = (company.blurb || company.charter || "").trim();
  if (mission) lines.push(`Mission: ${mission}`);
  const products = company.products?.items ?? [];
  if (products.length) {
    lines.push(
      `Official products & pricing (plan sales/outreach around exactly these): ${products
        .map((p) => `${p.name} $${p.amountUsd.toLocaleString("en-US")}${p.interval === "month" ? "/mo" : p.interval === "year" ? "/yr" : ""}${p.recommended ? " (recommended)" : ""}`)
        .join("; ")}`,
    );
    lines.push(
      "If recent activity suggests price is blocking conversions, one good task is a pricing-evidence review (objections, quote-vs-close, checkout drop-off) that ends in a PRICING PROPOSAL for human approval — never a task that changes prices directly.",
    );
  }
  const pendingPricing = company.pricingProposals ?? [];
  if (pendingPricing.length) {
    lines.push(
      `Pricing proposals already awaiting human decision (do not plan duplicate proposals): ${pendingPricing
        .map((p) => `${p.productName} → $${p.proposedAmountUsd.toLocaleString("en-US")}`)
        .join("; ")}`,
    );
  }
  // Standing operator directions steer the WORKERS but were invisible to the
  // PLANNER — so a human teaching "stop cold-emailing restaurants, target law
  // firms" never stopped the planner re-proposing restaurant outreach. Feed the
  // durable directions + active approval policies in so the plan respects them.
  const directives = (company.directives ?? []).map((directive) => directive.text?.trim()).filter(Boolean);
  if (directives.length) {
    lines.push(
      "",
      "Standing operator directions (plan consistent with these — they override the goal's default approach):",
      ...directives.slice(0, 12).map((text) => `- ${text}`),
    );
  }
  const activePolicies = activeCompanyApprovalPolicies(company);
  const neverSubjects = activePolicies.filter((policy) => policy.mode === "never").map((policy) => policy.subject);
  const askSubjects = activePolicies.filter((policy) => policy.mode === "ask").map((policy) => policy.subject);
  if (neverSubjects.length) {
    lines.push("", `NEVER plan a task whose purpose is any of these — the company is forbidden from them: ${neverSubjects.join("; ")}.`);
  }
  if (askSubjects.length) {
    lines.push(
      "",
      `These need human approval before the crew acts, so any task involving them must end by parking a draft for approval, never by doing it directly: ${askSubjects.join("; ")}.`,
    );
  }
  lines.push(`Crew roles available: ${crewRoster(company)}`);
  // Lifetime inventory of finished work. The recent-activity digest below only
  // reaches back a few records, so without this the planner re-mints assets the
  // company built days ago (live 2026-07-06: a second "outreach email templates"
  // task 3.5 days after the first — the original had rolled off every window).
  const inventory = (completedTitles ?? []).map((t) => t.trim()).filter(Boolean).slice(0, COMPLETED_INVENTORY_LIMIT);
  if (inventory.length) {
    lines.push(
      "",
      "Work this company has ALREADY completed (these assets exist — never plan a task that recreates one; plan tasks that USE them or advance past them):",
      ...inventory.map((t) => `- ${t}`),
    );
  }
  const trimmedHistory = history?.trim();
  if (trimmedHistory) {
    lines.push("", "Recent company activity (newest first):", trimmedHistory, "");
  }
  const salesContext = salesContentContext?.trim();
  if (salesContext) {
    lines.push("", salesContext, "");
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
    const model = process.env.OPENAI_VOICE_CHAT_MODEL || OPENAI_FALLBACK_MODEL;
    const cacheHints = openAICompatibleInferenceCacheHints({
      provider: "openai",
      model,
      cacheScope: "company-goal-planner",
    });
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...cacheHints.headers },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        ...cacheHints.body,
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
  opts: { origin?: string; vaultPath?: string; maxTasks?: number; history?: string; completedTitles?: readonly string[]; salesContentContext?: string } = {},
): Promise<QueenBeePrdTaskDraft[] | null> {
  if (!company.apexGoal?.title?.trim()) return null;
  const maxTasks = Math.max(1, Math.min(opts.maxTasks ?? 6, 8));
  const system = systemPrompt(maxTasks);
  const user = userPrompt(company, opts.history, opts.completedTitles, opts.salesContentContext);

  // 1. Brain: the company's own chat-capable fleet agent (agent-scoped model),
  //    via the same /api/chat/agent-runtime path queen-bee's pilot/voice turns use.
  if (opts.origin) {
    const agent = await pickConversationAgent(opts.vaultPath).catch(() => null);
    if (agent) {
      try {
        const response = await fetch(new URL("/api/chat/agent-runtime", opts.origin), {
          method: "POST",
          // Self-fetches 401 without the server's own device token since the
          // API auth gate moved to src/proxy.ts.
          headers: { "content-type": "application/json", ...internalApiAuthHeaders() },
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
