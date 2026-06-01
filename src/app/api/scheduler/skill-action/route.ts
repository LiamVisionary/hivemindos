import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import { getSharedBrainSkills } from "@/lib/services/obsidian/brain-skills";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";
import {
  appendSkillAnalyticsEvent,
  auditSkillInput,
  hasWorkflowActionApproval,
  parseWorkflowActions,
} from "@/lib/services/skills/skill-os";
import type { WorkflowAction } from "@/lib/types/skill-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SkillActionResult = {
  ok: boolean;
  skipped?: boolean;
  skill?: string;
  actionId?: string;
  title?: string;
  output?: string;
  error?: string;
  elapsedMs: number;
};

function safeTimeout(timeoutMs?: number) {
  if (!Number.isFinite(timeoutMs)) return 8_000;
  return Math.max(500, Math.min(30_000, Math.round(timeoutMs ?? 8_000)));
}

const SAFE_COMMANDS = new Set(["git", "gh", "pnpm", "npm", "node", "python3", "python", "osascript", "open"]);

function isSafeCommand(command?: string) {
  return Boolean(command && /^[a-zA-Z0-9._-]+$/.test(command) && SAFE_COMMANDS.has(command));
}

async function logRouteTelemetry(request: Request, type: string, payload: Record<string, unknown>) {
  await recordTelemetryBatch([{
    source: "route",
    type,
    runId: request.headers.get("x-hivemind-run-id"),
    payload,
  }]).catch(() => undefined);
}

function isSafeSkillSlug(slug: string) {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(slug);
}

async function readSharedSkillMarkdown(slug: string, vaultPath?: string) {
  if (isSafeSkillSlug(slug)) {
    const directPath = join(resolveObsidianVaultPath(vaultPath), "Skills", slug, "SKILL.md");
    const directMarkdown = await readFile(directPath, "utf8").catch(() => "");
    if (directMarkdown) return { path: directPath, markdown: directMarkdown };
  }
  const inventory = await getSharedBrainSkills(vaultPath);
  const skill = inventory.shared.find((item) => item.slug === slug);
  if (!skill) return null;
  const markdown = await readFile(skill.path, "utf8").catch(() => "");
  return markdown ? { path: skill.path, markdown } : null;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let body: { skillSlugs?: string[]; prompt?: string; scheduleName?: string; vaultPath?: string; approved?: boolean; approvedActionIds?: string[] };
  try {
    body = await request.json() as { skillSlugs?: string[]; prompt?: string; scheduleName?: string; vaultPath?: string };
  } catch {
    return Response.json({ ok: false, error: "Expected a JSON body.", elapsedMs: Date.now() - startedAt }, { status: 400 });
  }

  const skillSlugs = [...new Set((body.skillSlugs ?? []).map((slug) => slug.trim()).filter(Boolean))];
  if (!skillSlugs.length) {
    return Response.json({ ok: false, skipped: true, error: "No attached skills.", elapsedMs: Date.now() - startedAt });
  }

  for (const slug of skillSlugs) {
    const skill = await readSharedSkillMarkdown(slug, body.vaultPath);
    if (!skill) continue;
    const audit = await auditSkillInput({ slug, markdown: skill.markdown, sourceRef: skill.path });
    if (audit.status === "blocked") {
      const result: SkillActionResult = {
        ok: false,
        skill: slug,
        error: `Skill audit blocked action execution: ${audit.findings.map((finding) => finding.title).join(", ")}`,
        elapsedMs: Date.now() - startedAt,
      };
      await logRouteTelemetry(request, "scheduler.skill_action.audit_blocked", result);
      return Response.json(result, { status: 403 });
    }
    const action = parseWorkflowActions(skill.markdown)[0];
    if (!action) continue;
    const approved = body.approved
      || body.approvedActionIds?.includes(action.id)
      || await hasWorkflowActionApproval(slug, action.id);
    if (action.requiresApproval && !approved) {
      const result: SkillActionResult = {
        ok: false,
        skill: slug,
        actionId: action.id,
        error: `Workflow action ${action.id} needs approval before ${action.runtime} can run.`,
        elapsedMs: Date.now() - startedAt,
      };
      await logRouteTelemetry(request, "scheduler.skill_action.needs_approval", result);
      return Response.json({ ...result, audit, requiredApprovals: action.permissions }, { status: 403 });
    }

    await logRouteTelemetry(request, "scheduler.skill_action.start", {
      skill: slug,
      actionId: action.id ?? null,
      runtime: action.runtime,
      elapsedMs: Date.now() - startedAt,
    });

    return executeWorkflowAction({
      action,
      slug,
      scheduleName: body.scheduleName,
      prompt: body.prompt,
      startedAt,
      request,
    });
  }

  const result: SkillActionResult = {
    ok: false,
    skipped: true,
    error: "No attached skill declares a scheduler action.",
    elapsedMs: Date.now() - startedAt,
  };
  await logRouteTelemetry(request, "scheduler.skill_action.skipped", {
    skillCount: skillSlugs.length,
    elapsedMs: result.elapsedMs,
  });
  return Response.json(result);
}

async function executeWorkflowAction(input: {
  action: WorkflowAction;
  slug: string;
  scheduleName?: string;
  prompt?: string;
  startedAt: number;
  request: Request;
}) {
  const { action, slug, scheduleName, prompt, request, startedAt } = input;
  if (action.runtime === "http") {
    if (!action.url) {
      return Response.json({ ok: false, skill: slug, actionId: action.id, error: "HTTP workflow actions require a URL.", elapsedMs: Date.now() - startedAt }, { status: 400 });
    }
    const response = await fetch(action.url, {
      method: action.method ?? "POST",
      headers: { "Content-Type": "application/json", ...(action.headers ?? {}) },
      body: action.method === "GET" ? undefined : JSON.stringify(action.body ?? { scheduleName, prompt }),
      signal: AbortSignal.timeout(safeTimeout(action.timeoutMs)),
    }).catch((error) => ({ ok: false, status: 502, text: async () => error instanceof Error ? error.message : "HTTP workflow action failed." }));
    const output = await response.text().catch(() => "");
    const elapsedMs = Date.now() - startedAt;
    const result: SkillActionResult = response.ok
      ? { ok: true, skill: slug, actionId: action.id, title: action.title ?? scheduleName ?? slug, output: output.slice(0, 4000), elapsedMs }
      : { ok: false, skill: slug, actionId: action.id, error: output.slice(0, 1000) || `HTTP ${response.status}`, elapsedMs };
    await logRouteTelemetry(request, response.ok ? "scheduler.skill_action.completed" : "scheduler.skill_action.failed", result);
    await appendSkillAnalyticsEvent({ skillSlug: slug, event: response.ok ? "action-completed" : "action-failed", status: response.ok ? "success" : "failure", durationMs: elapsedMs }).catch(() => undefined);
    return Response.json(result, { status: response.ok ? 200 : 502 });
  }

  if (action.runtime === "mcp" || action.runtime === "tauri-native") {
    return Response.json({
      ok: false,
      skill: slug,
      actionId: action.id,
      error: `${action.runtime} workflow actions are recognized and approval-gated, but this dashboard route does not execute them directly yet.`,
      elapsedMs: Date.now() - startedAt,
    }, { status: 501 });
  }

  const execSpec = executableActionSpec(action, scheduleName, prompt);
  if (!execSpec.ok) {
    return Response.json({ ok: false, skill: slug, actionId: action.id, error: execSpec.error, elapsedMs: Date.now() - startedAt }, { status: 400 });
  }

  return new Promise<Response>((resolve) => {
    execFile(
      execSpec.command,
      execSpec.args,
      { timeout: safeTimeout(action.timeoutMs) },
      async (error, stdout, stderr) => {
        const elapsedMs = Date.now() - startedAt;
        const output = stdout.trim();
        const result: SkillActionResult = error
          ? {
            ok: false,
            skill: slug,
            actionId: action.id,
            error: stderr.trim() || error.message || "Skill action failed.",
            elapsedMs,
          }
          : {
            ok: true,
            skill: slug,
            actionId: action.id,
            title: output.split("\n").find(Boolean) || scheduleName || slug,
            output,
            elapsedMs,
          };
        await logRouteTelemetry(request, error ? "scheduler.skill_action.failed" : "scheduler.skill_action.completed", result);
        await appendSkillAnalyticsEvent({ skillSlug: slug, event: error ? "action-failed" : "action-completed", status: error ? "failure" : "success", durationMs: elapsedMs }).catch(() => undefined);
        resolve(Response.json(result, { status: error ? 500 : 200 }));
      },
    );
  });
}

function executableActionSpec(action: WorkflowAction, scheduleName?: string, prompt?: string): { ok: true; command: string; args: string[] } | { ok: false; error: string } {
  if (action.runtime === "osascript") {
    if (!action.script?.trim()) return { ok: false, error: "osascript workflow actions require a script." };
    return { ok: true, command: "osascript", args: ["-e", action.script, scheduleName ?? "", prompt ?? ""] };
  }
  if (action.runtime === "node") {
    if (!action.script?.trim()) return { ok: false, error: "node workflow actions require a script." };
    return { ok: true, command: "node", args: ["-e", action.script] };
  }
  if (action.runtime === "python") {
    if (!action.script?.trim()) return { ok: false, error: "python workflow actions require a script." };
    return { ok: true, command: "python3", args: ["-c", action.script] };
  }
  if (action.runtime === "shell") {
    if (!isSafeCommand(action.command)) return { ok: false, error: "Shell workflow actions must use an allowlisted executable command." };
    return { ok: true, command: action.command!, args: action.args ?? [] };
  }
  return { ok: false, error: `Unsupported workflow action runtime: ${action.runtime}` };
}
