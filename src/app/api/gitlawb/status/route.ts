import { NextResponse } from "next/server";
import { readGitLawbStatus } from "@/lib/services/gitlawb/gitlawb-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nodeUrl = url.searchParams.get("nodeUrl") || undefined;
  const status = await readGitLawbStatus({ nodeUrl, cache: true });
  return NextResponse.json({ ok: true, status });
}
