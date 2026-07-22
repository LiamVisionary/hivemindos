import "server-only";

import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuthContext } from "@/lib/utils/server-auth";
import { WebResearchPolicyError, webCrawl, webFetch, webScreenshot, webSearch } from "./service";
import { webCrawlSchema, webFetchSchema, webScreenshotSchema, webSearchSchema } from "./schemas";

export type WebResearchAction = "search" | "fetch" | "crawl" | "screenshot";

export async function handleWebResearchPost(request: NextRequest, action: WebResearchAction) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body.", 400);
  }

  try {
    if (action === "search") return okJson({ result: await webSearch(webSearchSchema.parse(body), request.signal) });
    if (action === "fetch") return okJson({ result: await webFetch(webFetchSchema.parse(body), request.signal) });
    if (action === "crawl") return okJson({ result: await webCrawl(webCrawlSchema.parse(body), request.signal) });

    const includeImageData = Boolean(body && typeof body === "object" && (body as { includeImageData?: unknown }).includeImageData === true);
    const screenshot = await webScreenshot(webScreenshotSchema.parse(body), request.signal);
    const { imageData, ...metadata } = screenshot;
    return okJson({ result: includeImageData ? { ...metadata, imageData } : metadata });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorJson(error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "), 400);
    }
    if (error instanceof WebResearchPolicyError) return errorJson(error.message, 400);
    return errorJson(error instanceof Error ? error.message : "Web research failed.", 500);
  }
}
