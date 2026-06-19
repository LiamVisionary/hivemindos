import { NextRequest } from "next/server";
import type { FlowSpec } from "@/lib/types/agent-flow";
import { validateFlow } from "@/lib/services/queen-bee/flow-engine";
import { getFlowTemplate, listFlowTemplates, saveFlowTemplate } from "@/lib/services/queen-bee/flow-templates";
import { advanceFlowRun, getFlowRun, listFlowRuns, resolveFlowApproval, startFlowRun } from "@/lib/services/queen-bee/flow-runner";

export const runtime = "nodejs";

// GET /api/queen-bee/flow?action=list-templates | get-template&id= | list-runs | get-run&runId=
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const action = params.get("action") ?? "list-templates";
  const vaultPath = params.get("vaultPath") ?? undefined;
  try {
    switch (action) {
      case "list-templates":
        return Response.json({ ok: true, templates: await listFlowTemplates({ vaultPath }) });
      case "get-template": {
        const tpl = await getFlowTemplate(String(params.get("id")), { vaultPath });
        return tpl ? Response.json({ ok: true, template: tpl }) : Response.json({ ok: false, error: "Template not found" }, { status: 404 });
      }
      case "list-runs":
        return Response.json({ ok: true, runs: await listFlowRuns({ vaultPath }) });
      case "get-run": {
        const rec = await getFlowRun(String(params.get("runId")), { vaultPath });
        return rec ? Response.json({ ok: true, ...rec }) : Response.json({ ok: false, error: "Run not found" }, { status: 404 });
      }
      default:
        return Response.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "flow error" }, { status: 500 });
  }
}

// POST /api/queen-bee/flow { action: save-template | start | advance | resolve-approval, ... }
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const vaultPath = (body.vaultPath as string | undefined) ?? undefined;
  const fleetSnapshot = (body.fleetSnapshot as never[] | undefined) ?? [];
  try {
    switch (action) {
      case "save-template": {
        const spec = body.spec as FlowSpec | undefined;
        if (!spec?.id) return Response.json({ ok: false, error: "Missing spec" }, { status: 400 });
        const errors = validateFlow(spec).filter((e) => !e.includes("no outgoing edge"));
        if (errors.length) return Response.json({ ok: false, error: `Invalid flow: ${errors.join("; ")}` }, { status: 400 });
        await saveFlowTemplate(spec, { vaultPath });
        return Response.json({ ok: true });
      }
      case "start": {
        let spec = body.spec as FlowSpec | undefined;
        if (!spec && body.templateId) spec = (await getFlowTemplate(String(body.templateId), { vaultPath })) ?? undefined;
        if (!spec?.id) return Response.json({ ok: false, error: "Provide spec or a known templateId" }, { status: 400 });
        const errors = validateFlow(spec).filter((e) => !e.includes("no outgoing edge"));
        if (errors.length) return Response.json({ ok: false, error: `Invalid flow: ${errors.join("; ")}` }, { status: 400 });
        const run = await startFlowRun(spec, { vaultPath, fleetSnapshot, state: (body.state as Record<string, unknown>) ?? {} });
        return Response.json({ ok: true, run });
      }
      case "advance": {
        if (!body.runId || !body.result) return Response.json({ ok: false, error: "Missing runId/result" }, { status: 400 });
        const run = await advanceFlowRun(String(body.runId), body.result as never, { vaultPath, fleetSnapshot });
        return Response.json({ ok: true, run });
      }
      case "resolve-approval": {
        if (!body.runId) return Response.json({ ok: false, error: "Missing runId" }, { status: 400 });
        const run = await resolveFlowApproval(String(body.runId), Boolean(body.approved), { vaultPath, fleetSnapshot });
        return Response.json({ ok: true, run });
      }
      default:
        return Response.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "flow error" }, { status: 500 });
  }
}
