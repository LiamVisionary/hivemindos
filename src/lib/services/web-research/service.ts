import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { callHoundTool } from "./hound-client";
import { HOUND_PACKAGE, HOUND_VERSION, webResearchInstallState, webResearchInstalled, webResearchPaths } from "./paths";
import {
  webCrawlSchema,
  webFetchSchema,
  webScreenshotSchema,
  webSearchSchema,
  type WebCrawlInput,
  type WebFetchInput,
  type WebScreenshotInput,
  type WebSearchInput,
} from "./schemas";

type HoundContent = {
  type?: unknown;
  text?: unknown;
  data?: unknown;
  mimeType?: unknown;
};

export class WebResearchPolicyError extends Error {}

function houndError(content: unknown, fallback: string) {
  const raw = textError(content) || fallback;
  let message = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed.error === "string") message = parsed.error;
  } catch {
    // Plain-text upstream errors are already actionable.
  }
  if (/blocked non-public destination|only public http|credentials embedded|hostname is not allowed|unable to resolve host/i.test(message)) {
    return new WebResearchPolicyError(message);
  }
  return new Error(message);
}

function structuredResult(result: Record<string, unknown>) {
  if (result.isError === true) throw houndError(result.content, "The web research engine returned an error.");
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = (Array.isArray(result.content) ? result.content : [])
    .find((item): item is HoundContent => Boolean(item && typeof item === "object" && (item as HoundContent).type === "text"))?.text;
  if (typeof text !== "string") return { content: result.content ?? [] };
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function textError(content: unknown) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is HoundContent => Boolean(item && typeof item === "object"))
    .map((item) => typeof item.text === "string" ? item.text : "")
    .filter(Boolean)
    .join("\n")
    .slice(0, 2_000);
}

export async function webSearch(input: WebSearchInput, signal?: AbortSignal) {
  const value = webSearchSchema.parse(input);
  const result = await callHoundTool("mcp_smart_search", {
    query: value.query,
    options: {
      max_results: value.maxResults ?? 6,
      freshness: value.freshness,
      site: value.site,
      exclude_sites: value.excludeSites,
      page: value.page ?? 0,
    },
  }, { signal, timeoutMs: 45_000 });
  return structuredResult(result);
}

export async function webFetch(input: WebFetchInput, signal?: AbortSignal) {
  const value = webFetchSchema.parse(input);
  const result = await callHoundTool("mcp_smart_fetch", {
    url: value.url,
    extraction_type: value.format ?? "markdown",
    focus: value.focus,
    max_content_chars: value.maxChars ?? 20_000,
    offset: value.offset ?? 0,
    pages: value.pages,
    cache_ttl: value.cacheTtl ?? 3_600,
    options: {
      respect_robots: true,
      include_links: value.includeLinks ?? false,
    },
  }, { signal, timeoutMs: 70_000 });
  return structuredResult(result);
}

export async function webCrawl(input: WebCrawlInput, signal?: AbortSignal) {
  const value = webCrawlSchema.parse(input);
  const start = new URL(value.url);
  for (const candidate of value.crawlUrls ?? []) {
    if (new URL(candidate).origin !== start.origin) {
      throw new Error("crawlUrls must use the same origin as the crawl start URL.");
    }
  }
  const deadlineMs = value.deadlineMs ?? 60_000;
  const result = await callHoundTool("mcp_smart_crawl", {
    url: value.url,
    focus: value.focus,
    discover_only: value.discoverOnly ?? false,
    crawl_urls: value.crawlUrls,
    options: {
      sitemap: value.sitemap === "required" ? true : value.sitemap === "auto" ? "auto" : false,
      max_pages: value.maxPages ?? 10,
      max_depth: value.maxDepth ?? 2,
      path_include: value.pathInclude,
      path_exclude: value.pathExclude,
      max_content_chars_per: value.maxCharsPerPage ?? 8_000,
      max_total_chars: value.maxTotalChars ?? 30_000,
      concurrency: 3,
      respect_robots: true,
      deadline_ms: deadlineMs,
    },
  }, { signal, timeoutMs: Math.min(deadlineMs + 20_000, 140_000) });
  return structuredResult(result);
}

export async function webScreenshot(input: WebScreenshotInput, signal?: AbortSignal) {
  const value = webScreenshotSchema.parse(input);
  const imageType = value.imageType ?? "png";
  const result = await callHoundTool("mcp_screenshot", {
    url: value.url,
    options: {
      full_page: value.fullPage ?? false,
      image_type: imageType,
      quality: value.quality,
      wait: value.waitMs ?? 0,
      wait_selector: value.waitSelector,
      network_idle: value.networkIdle ?? false,
      timeout: value.timeoutMs ?? 30_000,
    },
  }, { signal, timeoutMs: 50_000 });
  if (result.isError === true) throw houndError(result.content, "Screenshot capture failed.");
  const content = Array.isArray(result.content) ? result.content as HoundContent[] : [];
  const image = content.find((item) => item.type === "image" && typeof item.data === "string");
  if (!image || typeof image.data !== "string") throw new Error("The web research engine returned no screenshot image.");
  const mimeType = typeof image.mimeType === "string" ? image.mimeType : `image/${imageType}`;
  const bytes = Uint8Array.from(Buffer.from(image.data, "base64"));
  if (!bytes.length || bytes.length > 25_000_000) throw new Error("Screenshot image size was invalid.");
  const paths = webResearchPaths();
  await mkdir(paths.screenshotDir, { recursive: true });
  const filePath = join(paths.screenshotDir, `${Date.now()}-${randomUUID()}.${imageType === "jpeg" ? "jpg" : "png"}`);
  await writeFile(filePath, bytes, { mode: 0o600 });
  const finalUrl = content.find((item) => item.type === "text" && typeof item.text === "string")?.text || value.url;
  return {
    url: finalUrl,
    path: filePath,
    mimeType,
    sizeBytes: bytes.length,
    imageData: image.data,
  };
}

export function webResearchStatus() {
  const state = webResearchInstallState();
  return {
    installed: webResearchInstalled(),
    package: HOUND_PACKAGE,
    version: HOUND_VERSION,
    installStatus: typeof state.status === "string" ? state.status : "absent",
    phase: typeof state.phase === "string" ? state.phase : undefined,
    error: typeof state.error === "string" ? state.error : undefined,
    capabilities: ["search", "fetch", "crawl", "screenshot", "pdf-ocr"],
    policy: {
      publicHttpOnly: true,
      dnsAndRedirectValidation: true,
      respectRobots: true,
      credentials: false,
      interactivePageActions: false,
      selfUpdate: false,
    },
  };
}
