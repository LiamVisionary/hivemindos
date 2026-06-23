import { NextRequest, NextResponse } from "next/server";
import { buildLoopFromTemplate, listLoopTemplates, listLoopVerifiers, type LoopTemplateId, type LoopVerifierId } from "@/lib/services/loops";
import { createTask, resolveKanbanStorage, type KanbanStorageOptions } from "@/lib/services/kanban/local-kanban-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    templates: listLoopTemplates(),
    verifiers: listLoopVerifiers(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const templateId = parseTemplateId(body.templateId);
    const loop = buildLoopFromTemplate({
      templateId,
      goal: requireString(body.goal, "goal"),
      title: optionalString(body.title),
      successCriteria: stringArray(body.successCriteria),
      requiredVerifierIds: verifierIdArray(body.requiredVerifierIds),
      optionalVerifierIds: verifierIdArray(body.optionalVerifierIds),
      maxAttempts: positiveInteger(body.maxAttempts),
      maxRuntimeMs: positiveNumber(body.maxRuntimeMs),
      maxTokens: positiveInteger(body.maxTokens),
      maxCostUsd: positiveNumber(body.maxCostUsd),
      benchmarkCommand: optionalString(body.benchmarkCommand),
      benchmarkMetricName: optionalString(body.benchmarkMetricName),
      benchmarkTarget: optionalString(body.benchmarkTarget),
      evidenceRequired: stringArray(body.evidenceRequired),
      handoffRules: stringArray(body.handoffRules),
    });

    if (body.action === "create-task") {
      const boardSlug = request.nextUrl.searchParams.get("board") || body.board;
      const storageOptions = storageOptionsFromRequest(request, body);
      const result = await createTask(boardSlug, {
        title: optionalString(body.taskTitle) ?? optionalString(body.title) ?? loop.goal,
        body: optionalString(body.body) ?? loop.goal,
        status: body.status === "ideas" ? "ideas" : "ready",
        priority: body.priority ?? "normal",
        skills: stringArray(body.skills),
        loop,
      }, storageOptions);
      return NextResponse.json({ ok: true, loop, ...result, storage: resolveKanbanStorage(result.board.meta.slug, storageOptions) });
    }

    return NextResponse.json({ ok: true, loop });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Loop request failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

function storageOptionsFromRequest(request: NextRequest, body?: { vaultPath?: string; kanbanFolder?: string }): KanbanStorageOptions {
  return {
    vaultPath: request.nextUrl.searchParams.get("vaultPath") ?? body?.vaultPath,
    kanbanFolder: request.nextUrl.searchParams.get("kanbanFolder") ?? body?.kanbanFolder,
  };
}

function requireString(value: unknown, label: string): string {
  const text = optionalString(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map((item) => optionalString(item)).filter(Boolean) as string[];
  return values.length ? values : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function parseTemplateId(value: unknown): LoopTemplateId {
  const id = optionalString(value);
  if (id && listLoopTemplates().some((template) => template.id === id)) return id as LoopTemplateId;
  throw new Error("templateId must match a known loop template.");
}

function verifierIdArray(value: unknown): LoopVerifierId[] | undefined {
  const ids = stringArray(value);
  if (!ids) return undefined;
  const known = new Set(listLoopVerifiers().map((verifier) => verifier.id));
  const unknown = ids.filter((id) => !known.has(id as LoopVerifierId));
  if (unknown.length) throw new Error(`Unknown loop verifier: ${unknown.join(", ")}.`);
  return ids as LoopVerifierId[];
}
