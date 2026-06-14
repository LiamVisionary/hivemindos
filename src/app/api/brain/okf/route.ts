import { NextRequest, NextResponse } from "next/server";
import {
  exportOkfBundle,
  validateOkfBundle,
  type OkfExportInclude,
} from "@/lib/services/obsidian/okf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function includeFromValue(value: unknown): OkfExportInclude | undefined {
  return value === "agent-memory" || value === "conversations" || value === "all" ? value : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const result = await validateOkfBundle({
      bundlePath: request.nextUrl.searchParams.get("bundlePath") ?? undefined,
      vaultPath: request.nextUrl.searchParams.get("vaultPath") ?? undefined,
    });
    return NextResponse.json({ action: "validate", ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not validate OKF bundle.",
    }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      action?: "export" | "validate";
      vaultPath?: string;
      outputPath?: string;
      bundlePath?: string;
      include?: string;
      clean?: boolean;
    };
    if ((body.action ?? "export") === "validate") {
      const result = await validateOkfBundle({ bundlePath: body.bundlePath, vaultPath: body.vaultPath });
      return NextResponse.json({ action: "validate", ...result });
    }
    const result = await exportOkfBundle({
      vaultPath: body.vaultPath,
      outputPath: body.outputPath,
      include: includeFromValue(body.include) ?? "all",
      clean: body.clean,
    });
    return NextResponse.json({ ok: result.validation.ok, action: "export", ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not export OKF bundle.",
    }, { status: 400 });
  }
}
