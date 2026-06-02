import { NextResponse } from "next/server";
import { ensureGitLawbIdentity } from "@/lib/services/gitlawb/gitlawb-service";

export const runtime = "nodejs";

export async function POST() {
  const result = await ensureGitLawbIdentity();
  return NextResponse.json(result, { status: result.ok ? 200 : 202 });
}
