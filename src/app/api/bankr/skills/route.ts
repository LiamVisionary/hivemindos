import type { NextRequest } from "next/server";
import { getBankrSkillsSnapshot, installBankrCatalogSkill } from "@/lib/services/bankr-skills";
import { bankrApiKey } from "@/lib/services/bankr-llm";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const snapshot = await getBankrSkillsSnapshot();
    return okJson(snapshot);
  } catch (error) {
    return upstreamErrorJson("Could not load the Bankr skills catalogue", error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as { catalogSlug?: unknown; confirm?: unknown };
  const catalogSlug = typeof body.catalogSlug === "string" ? body.catalogSlug.trim() : "";
  if (!catalogSlug) return errorJson("Choose a Bankr skill to install.");
  if (body.confirm !== true) return errorJson("Confirm the Bankr skill installation before continuing.");
  if (!await bankrApiKey()) {
    return errorJson("Set BANKR_API_KEY, BANKR_LLM_KEY, or BANKR_MANAGEMENT_KEY before installing Bankr skills.");
  }
  try {
    const skill = await installBankrCatalogSkill(catalogSlug);
    return okJson({ skill });
  } catch (error) {
    return upstreamErrorJson("Could not install the Bankr skill", error);
  }
}

