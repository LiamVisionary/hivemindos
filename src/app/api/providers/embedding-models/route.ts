import { NextRequest } from "next/server";
import { errorJson, okJson } from "@/lib/utils/api-response";
import {
  applyEmbeddingsProviderSelection,
  disableEmbeddingsProvider,
  discoverEmbeddingsProviders,
} from "@/lib/services/embeddings-provider-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shared-brain semantic recall: list embedding-capable providers (hosted
// catalog entries + live local OpenAI-compatible servers) and apply/disable
// the fleet-wide selection stored in the shared hive env.

export async function GET() {
  try {
    const discovery = await discoverEmbeddingsProviders();
    return okJson({ ...discovery });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Embeddings provider discovery failed", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: { action?: string; optionId?: string; model?: string; dimensions?: number };
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body");
  }
  try {
    if (body.action === "disable") {
      const discovery = await disableEmbeddingsProvider();
      return okJson({ ...discovery });
    }
    if (body.action === "apply") {
      if (!body.optionId?.trim() || !body.model?.trim()) return errorJson("optionId and model are required");
      const discovery = await applyEmbeddingsProviderSelection({
        optionId: body.optionId.trim(),
        model: body.model.trim(),
        dimensions: typeof body.dimensions === "number" ? body.dimensions : undefined,
      });
      // Start filling vectors for existing memories right away; recall picks
      // them up as they land. Fire-and-forget by design.
      import("@/lib/services/obsidian/agent-memory/core")
        .then(({ rebuildAgentMemoryIndex }) => rebuildAgentMemoryIndex({}))
        .catch(() => undefined);
      return okJson({ ...discovery, backfillStarted: true });
    }
    return errorJson(`Unknown action: ${body.action ?? "(missing)"}`);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Embeddings provider update failed", 500);
  }
}
