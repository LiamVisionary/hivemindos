// guard:allow-hive-action-route - Google Slides MCP capability with server-enforced write confirmation.
import { NextRequest } from "next/server";

import {
  GOOGLE_SLIDES_EDIT_CONFIRMATION,
  editGoogleSlides,
  googleSlidesEditSchema,
  googleSlidesReadSchema,
  readGoogleSlides,
} from "@/lib/services/integrations/google-slides";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const mode = typeof body?.mode === "string" ? body.mode : "";

  try {
    if (mode === "read") {
      const parsed = googleSlidesReadSchema.safeParse(body);
      if (!parsed.success) return errorJson(parsed.error.issues[0]?.message || "Invalid Google Slides read request.", 400);
      const data = await readGoogleSlides(parsed.data);
      return okJson({ data, readOnly: true });
    }

    if (mode === "edit") {
      const parsed = googleSlidesEditSchema.safeParse(body);
      if (!parsed.success) return errorJson(parsed.error.issues[0]?.message || "Invalid Google Slides edit request.", 400);
      if (parsed.data.confirmation !== GOOGLE_SLIDES_EDIT_CONFIRMATION) {
        return errorJson(
          `Google Slides edits require confirmation ${GOOGLE_SLIDES_EDIT_CONFIRMATION}.`,
          409,
          { requiresConfirmation: true, confirmation: GOOGLE_SLIDES_EDIT_CONFIRMATION },
        );
      }
      const data = await editGoogleSlides(parsed.data);
      return okJson({ data, readOnly: false });
    }

    return errorJson('Google Slides mode must be "read" or "edit".', 400);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Google Slides request failed.", 502);
  }
}
