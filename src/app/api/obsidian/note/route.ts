import { NextRequest } from "next/server";
import { captureObsidianNote } from "@/lib/services/obsidian/note-capture";
import { processBrainDropCapture } from "@/lib/services/brain/brain-drop-intake";
import { createBrainNoteFromUnresolved } from "@/lib/services/obsidian/brain-graph";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      vaultPath?: string;
      inboxFolder?: string;
      content?: string;
      target?: string;
      sourceNotePath?: string;
      source?: string;
      tags?: string[];
      idempotencyKey?: string;
      createdAt?: string;
    };
    if (body.action === "capture") {
      const note = await captureObsidianNote({
        vaultPath: body.vaultPath,
        inboxFolder: body.inboxFolder,
        content: body.content ?? "",
        source: body.source,
        tags: body.tags,
        idempotencyKey: body.idempotencyKey,
        now: body.createdAt ? new Date(body.createdAt) : undefined,
      });
      try {
        const processing = await processBrainDropCapture({
          vaultPath: note.vaultPath,
          capture: note,
          content: body.content ?? "",
          source: body.source,
          inputTags: body.tags,
        });
        return okJson({ note, processing });
      } catch (error) {
        return okJson({
          note,
          processing: {
            status: "pending-retry",
            error: error instanceof Error ? error.message : "Brain Drop processing failed.",
          },
        });
      }
    }
    if (body.action !== "create-missing") {
      return errorJson("Unsupported note action.", 400);
    }
    if (!body.target?.trim()) {
      return errorJson("Missing note target.", 400);
    }
    const note = await createBrainNoteFromUnresolved({
      vaultPath: body.vaultPath,
      target: body.target,
      sourceNotePath: body.sourceNotePath,
    });
    return okJson({ note });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not create note.", 400);
  }
}
