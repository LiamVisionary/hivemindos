import { z } from "zod";

const publicHttpUrl = z.string().trim().min(1).max(4_096).url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Only http(s) URLs are allowed.");

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const pathFilters = z.array(boundedText(500)).max(20).optional();

export const webSearchSchema = z.object({
  query: boundedText(500).describe("Search query."),
  maxResults: z.number().int().min(1).max(12).optional().describe("Maximum results; defaults to 6."),
  freshness: z.enum(["day", "week", "month", "year"]).optional(),
  site: boundedText(253).optional().describe("Optional domain restriction, without a URL path."),
  excludeSites: z.array(boundedText(253)).max(10).optional(),
  page: z.number().int().min(0).max(3).optional(),
});

export const webFetchSchema = z.object({
  url: publicHttpUrl,
  format: z.enum(["markdown", "text", "article", "structured"]).optional(),
  focus: boundedText(500).optional().describe("Return only blocks relevant to this query."),
  maxChars: z.number().int().min(500).max(40_000).optional().describe("Maximum returned characters; defaults to 20,000."),
  offset: z.number().int().min(0).max(2_000_000).optional(),
  pages: z.string().trim().max(100).regex(/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/).optional().describe("PDF page ranges, such as 1-5 or 1,3,7-9."),
  cacheTtl: z.number().int().min(0).max(86_400).optional(),
  includeLinks: z.boolean().optional(),
});

export const webCrawlSchema = z.object({
  url: publicHttpUrl,
  focus: boundedText(500).optional(),
  discoverOnly: z.boolean().optional(),
  sitemap: z.enum(["off", "auto", "required"]).optional(),
  maxPages: z.number().int().min(1).max(25).optional(),
  maxDepth: z.number().int().min(0).max(3).optional(),
  maxCharsPerPage: z.number().int().min(500).max(12_000).optional(),
  maxTotalChars: z.number().int().min(1_000).max(60_000).optional(),
  deadlineMs: z.number().int().min(5_000).max(120_000).optional(),
  pathInclude: pathFilters,
  pathExclude: pathFilters,
  crawlUrls: z.array(publicHttpUrl).max(25).optional(),
});

export const webScreenshotSchema = z.object({
  url: publicHttpUrl,
  fullPage: z.boolean().optional(),
  imageType: z.enum(["png", "jpeg"]).optional(),
  quality: z.number().int().min(1).max(100).optional(),
  waitMs: z.number().int().min(0).max(5_000).optional(),
  waitSelector: z.string().trim().min(1).max(500).optional(),
  networkIdle: z.boolean().optional(),
  timeoutMs: z.number().int().min(5_000).max(30_000).optional(),
}).superRefine((value, context) => {
  if (value.quality !== undefined && value.imageType !== "jpeg") {
    context.addIssue({ code: "custom", path: ["quality"], message: "quality is only valid for JPEG screenshots." });
  }
});

export const webResearchRequestSchema = z.discriminatedUnion("action", [
  webSearchSchema.extend({ action: z.literal("search") }),
  webFetchSchema.extend({ action: z.literal("fetch") }),
  webCrawlSchema.extend({ action: z.literal("crawl") }),
  // Keep the API discriminator schema plain; the shared screenshot schema's
  // JPEG cross-field refinement still runs in the service boundary.
  z.object({ action: z.literal("screenshot"), input: z.unknown().optional() }).passthrough(),
  z.object({ action: z.literal("status") }),
]);

export type WebSearchInput = z.infer<typeof webSearchSchema>;
export type WebFetchInput = z.infer<typeof webFetchSchema>;
export type WebCrawlInput = z.infer<typeof webCrawlSchema>;
export type WebScreenshotInput = z.infer<typeof webScreenshotSchema>;
