import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  CLAWBANK_CONFIRM,
  clawbankCallMcpTool,
  clawbankListMcpTools,
  isReadOnlyClawbankTool,
} from "@/lib/services/clawbank";
import { readJsonBody, requireConfirmation, stringField } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ClawBank runtime discovery + generic tool runner.
 *
 * The ClawBank docs are discovery-first: the authoritative, per-account surface
 * (coms, contracts, records, fight clubs, Wise, off-ramp, trading engines,
 * bridge ops, formation checkout, …) is enumerated via MCP `tools/list`, not a
 * static REST schema. This route exposes that catalog and lets agents invoke
 * any tool by name.
 *
 *   GET                                      -> the live tool catalog
 *   POST { tool, args, mode: "read" }        -> run a read tool (rejects writes)
 *   POST { tool, args, confirmation }        -> run a write tool (gated)
 *
 * Read/write is classified server-side (default: write). Read tools run freely;
 * everything else needs confirmation "CONFIRM_CLAWBANK_CALL".
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const list = await clawbankListMcpTools();
  if (!list.ok) {
    const status = /credential/i.test(list.error) ? 400 : 502;
    return NextResponse.json({ ok: false, error: list.error }, { status });
  }
  return NextResponse.json({
    ok: true,
    count: list.tools.length,
    tools: list.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      readOnly: isReadOnlyClawbankTool(tool.name),
      inputSchema: tool.inputSchema,
    })),
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(request);
  const tool = stringField(body, "tool") || stringField(body, "name");
  if (!tool) return NextResponse.json({ ok: false, error: "A tool name is required (call GET to list the live catalog)." }, { status: 400 });

  const argsValue = body.args ?? body.arguments;
  const args = argsValue && typeof argsValue === "object" && !Array.isArray(argsValue)
    ? (argsValue as Record<string, unknown>)
    : {};

  const readOnly = isReadOnlyClawbankTool(tool);
  const requestedReadMode = stringField(body, "mode") === "read";

  if (requestedReadMode && !readOnly) {
    return NextResponse.json({
      ok: false,
      error: `"${tool}" is not a recognized read-only tool. Run it with confirmation "${CLAWBANK_CONFIRM.CALL}" if you intend a state-changing call.`,
    }, { status: 400 });
  }

  if (!readOnly) {
    const gate = requireConfirmation(
      body.confirmation,
      CLAWBANK_CONFIRM.CALL,
      `"${tool}" may move funds or change state on ClawBank. Preview it first (GET the catalog / inspect the schema).`,
    );
    if (gate) return gate;
  }

  const result = await clawbankCallMcpTool(tool, args);
  if (!result.ok) {
    const status = /credential/i.test(result.error) ? 400 : 502;
    return NextResponse.json({ ok: false, tool, error: result.error, isError: result.isError }, { status });
  }
  return NextResponse.json({ ok: true, tool, readOnly, result: result.structuredContent, content: result.content });
}
