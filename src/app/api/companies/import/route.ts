import { NextRequest } from "next/server";

// guard:allow-hive-action-route - dashboard-only, human-reviewed local folder import;
// exposing arbitrary filesystem paths as an agent action would bypass the picker/preview boundary.

import { importCompanyFromRepo, previewCompanyImport } from "@/lib/services/company-importer";
import { importCompanyFromDataRoom, previewCompanyDataRoom } from "@/lib/services/company-data-room-importer";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

type ImportCompanyBody = {
  action?: "preview" | "import";
  source?: "repo" | "data-room";
  repoPath?: string;
  dataRoomPath?: string;
  companyName?: string;
  ticker?: string;
  sector?: string;
  apexGoalTitle?: string;
  companyId?: string;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => ({}))) as ImportCompanyBody;
  const action = body.action ?? "preview";

  try {
    if (body.source === "data-room") {
      const dataRoomInput = {
        dataRoomPath: body.dataRoomPath ?? "",
        companyName: body.companyName,
        ticker: body.ticker,
        sector: body.sector,
        apexGoalTitle: body.apexGoalTitle,
        companyId: body.companyId,
      };
      if (action === "import") return okJson(await importCompanyFromDataRoom(dataRoomInput));
      return okJson({ preview: await previewCompanyDataRoom(dataRoomInput) });
    }
    if (action === "import") {
      return okJson(await importCompanyFromRepo({
        repoPath: body.repoPath ?? "",
        companyName: body.companyName,
        ticker: body.ticker,
        sector: body.sector,
        apexGoalTitle: body.apexGoalTitle,
        companyId: body.companyId,
      }));
    }

    return okJson({
      preview: await previewCompanyImport({
        repoPath: body.repoPath ?? "",
        companyName: body.companyName,
        ticker: body.ticker,
        sector: body.sector,
        apexGoalTitle: body.apexGoalTitle,
      }),
    });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Company import failed.", 400);
  }
}
