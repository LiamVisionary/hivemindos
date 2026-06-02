import { NextResponse } from "next/server";
import { setupGitLawbCli } from "@/lib/services/gitlawb/gitlawb-service";

export const runtime = "nodejs";

export async function POST() {
  const result = await setupGitLawbCli();
  return NextResponse.json(result, { status: result.ok ? 200 : 202 });
}
