import { NextRequest } from "next/server";

import { importCompanyFromRepo, previewCompanyImport } from "@/lib/services/company-importer";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportCompanyBody = {
  action?: "preview" | "import";
  repoPath?: string;
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
