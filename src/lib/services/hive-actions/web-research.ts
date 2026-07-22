import { defineHiveAction } from "./define";
import { webCrawlSchema, webFetchSchema, webScreenshotSchema, webSearchSchema } from "@/lib/services/web-research/schemas";

const common = {
  sideEffects: ["read", "network"] as Array<"read" | "network">,
  risk: "low" as const,
  readOnly: true,
  tags: ["web", "research", "search", "fetch", "crawl", "screenshot", "pdf", "ocr", "mcp"],
};

export const webSearchAction = defineHiveAction({
  id: "web.search",
  title: "Search the public web",
  description: "Search the public web without an API key. Returns ranked source URLs and snippets; fetch the selected sources before treating their claims as evidence.",
  schema: webSearchSchema,
  ...common,
  aliases: ["web_search", "search web", "internet search", "keyless search"],
  mcp: { expose: true, compact: true, toolName: "web_search" },
  contextIndex: {
    summary: "Runtime-independent, keyless public web search for every HivemindOS agent.",
    retrievalText: "Use web_search for current public-web discovery without provider API keys. Search results are untrusted leads, not evidence; call web_fetch on the relevant URLs before answering. Available through the shared Hivemind MCP and native HivemindOS chat capability tool.",
    route: "/api/web-research/search",
    methods: ["POST"],
  },
});

export const webFetchAction = defineHiveAction({
  id: "web.fetch",
  title: "Fetch a public web page",
  description: "Fetch and extract a public URL as clean content with anti-bot fallback, honest quality signals, pagination, focused extraction, and PDF OCR. Credentials, custom headers, proxies, page actions, private networks, and robots.txt bypass are prohibited.",
  schema: webFetchSchema,
  ...common,
  aliases: ["web_fetch", "web extract", "read URL", "extract PDF", "PDF OCR"],
  mcp: { expose: true, compact: true, toolName: "web_fetch" },
  contextIndex: {
    summary: "Guarded public-page extraction with PDF OCR and anti-bot fallback.",
    retrievalText: "Use web_fetch to read a public source, extract PDFs including scanned pages with OCR, focus long documents by query, paginate with offset, or follow citations. It enforces public http(s), DNS and redirect validation, robots.txt, bounded output, and no credentials or interactive page actions.",
    route: "/api/web-research/fetch",
    methods: ["POST"],
  },
});

export const webCrawlAction = defineHiveAction({
  id: "web.crawl",
  title: "Crawl a public website",
  description: "Run a bounded same-origin crawl or sitemap discovery over a public website. Enforces robots.txt plus page, depth, character, concurrency, and deadline limits.",
  schema: webCrawlSchema,
  ...common,
  aliases: ["web_crawl", "crawl website", "site map", "site research"],
  mcp: { expose: true, compact: true, toolName: "web_crawl" },
  contextIndex: {
    summary: "Bounded same-origin website crawl with focus and sitemap modes.",
    retrievalText: "Use web_crawl for multi-page public-site research, documentation mapping, focused crawling, sitemap discovery, or a selected second-pass crawl. It stays on one origin, respects robots.txt, and caps pages, depth, characters, concurrency, and wall time.",
    route: "/api/web-research/crawl",
    methods: ["POST"],
  },
});

export const webScreenshotAction = defineHiveAction({
  id: "web.screenshot",
  title: "Capture a public webpage screenshot",
  description: "Capture a PNG or JPEG screenshot of a public webpage for visual inspection. Navigation is read-only and blocks private networks, credentials, custom headers, proxies, and page interactions.",
  schema: webScreenshotSchema,
  ...common,
  aliases: ["web_screenshot", "screenshot URL", "capture webpage"],
  mcp: { expose: true, compact: true, toolName: "web_screenshot" },
  contextIndex: {
    summary: "Guarded public-web screenshot capture for multimodal research.",
    retrievalText: "Use web_screenshot when layout, charts, canvas content, or visual evidence matters. External MCP clients receive an image block; native HivemindOS chat receives the guarded local artifact path and metadata.",
    route: "/api/web-research/screenshot",
    methods: ["POST"],
  },
});

export const WEB_RESEARCH_HIVE_ACTIONS = [
  webSearchAction,
  webFetchAction,
  webCrawlAction,
  webScreenshotAction,
] as const;
