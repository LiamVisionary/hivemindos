import { NextRequest } from "next/server";
import { createBrainNoteFromUnresolved } from "@/lib/services/obsidian/brain-graph";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      vaultPath?: string;
      target?: string;
      sourceNotePath?: string;
    };
    if (body.action !== "create-missing") {
      return Response.json({ ok: false, error: "Unsupported note action." }, { status: 400 });
    }
    if (!body.target?.trim()) {
      return Response.json({ ok: false, error: "Missing note target." }, { status: 400 });
    }
    const note = await createBrainNoteFromUnresolved({
      vaultPath: body.vaultPath,
      target: body.target,
      sourceNotePath: body.sourceNotePath,
    });
    return Response.json({ ok: true, note });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not create note.",
    }, { status: 400 });
  }
}
