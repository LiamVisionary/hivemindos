import { NextRequest } from "next/server";

import { streamHiveComputeArtifact, uploadHiveComputeInputArtifact } from "@/lib/services/hive-compute-marketplace/gateway-client";
import { errorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

type RouteContext = { params: Promise<{ jobId: string; artifactId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const { jobId, artifactId } = await context.params;
    const upstream = await streamHiveComputeArtifact({
      jobId,
      artifactId,
      range: request.headers.get("range"),
      downloadGrant: request.headers.get("x-hivemindos-artifact-grant"),
      signal: request.signal,
    });
    const headers = new Headers();
    for (const name of [
      "accept-ranges", "content-length", "content-range", "etag",
      "x-hive-compute-ciphertext-sha256", "x-hive-compute-encrypted-mime-type",
      "x-hive-compute-encryption-public-key-sha256",
    ]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("cache-control", "private, no-store");
    headers.set("content-type", "application/octet-stream");
    headers.set("content-disposition", "attachment");
    headers.set("x-content-type-options", "nosniff");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Hive Compute artifact request failed.", 400);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const { jobId, artifactId } = await context.params;
    const encodedManifest = request.headers.get("x-hivemindos-artifact-manifest");
    if (!encodedManifest || encodedManifest.length > 32_768) {
      return errorJson("A bounded encrypted artifact manifest header is required.", 400);
    }
    const manifest = encodedManifest ? JSON.parse(Buffer.from(encodedManifest, "base64url").toString("utf8")) : null;
    const upstream = await uploadHiveComputeInputArtifact({
      jobId,
      artifactId,
      body: request.body,
      uploadGrant: request.headers.get("x-hivemindos-artifact-grant"),
      manifest,
      signal: request.signal,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Hive Compute input artifact upload failed.", 400);
  }
}
