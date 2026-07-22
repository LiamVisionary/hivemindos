import { NextRequest } from "next/server";
import { handleWebResearchPost } from "@/lib/services/web-research/api-handler";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleWebResearchPost(request, "screenshot");
}
