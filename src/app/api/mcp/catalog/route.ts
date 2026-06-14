import { NextRequest, NextResponse } from "next/server";
import { searchHiveMcpCatalog } from "@/lib/services/mcp/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 40;
  return Math.max(1, Math.min(Math.trunc(parsed), 100));
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  return NextResponse.json({
    ok: true,
    source: "hivemindos-curated-awesome-mcp-servers",
    servers: searchHiveMcpCatalog(query, limit),
  });
}
