// guard:allow-hive-action-route - dashboard-only listing-photo loader. Read-only, and
// resolveMarketplacePhotoAbsolutePath pins every path inside the marketplace photos root
// (traversal-rejecting), so this can never serve arbitrary vault or disk files.
import { promises as fs } from "node:fs";
import { NextRequest } from "next/server";

import { errorJson } from "@/lib/utils/api-response";
import { resolveMarketplacePhotoAbsolutePath } from "@/lib/services/marketplace/marketplace-listings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!path) return errorJson("path is required");
  try {
    const absolute = resolveMarketplacePhotoAbsolutePath(path);
    const bytes = await fs.readFile(absolute);
    const extension = absolute.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return errorJson("Photo not found", 404);
    return errorJson(error instanceof Error ? error.message : String(error), 400);
  }
}
