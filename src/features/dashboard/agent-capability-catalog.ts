export type BuiltInAgentTool = {
  id: string;
  name: string;
  handle: string;
  description: string;
  scope: "Native" | "Runtime" | "Workspace";
  badges: string[];
};

export type AgentAppCatalogItem = {
  id: string;
  name: string;
  category: "AI-native" | "Anti-detection" | "Production scale" | "Specialist";
  description: string;
  sourceUrl: string;
  badges: string[];
  handles: string[];
  installableServiceId?: "n8n" | "browser-use" | "agentic-inbox" | "mcp-email-server" | "openhands" | "aider" | "agent-reach" | "palmier-pro";
};

export const BUILT_IN_AGENT_TOOLS: BuiltInAgentTool[] = [
  {
    id: "web-search",
    name: "Web search",
    handle: "web.search",
    description: "Search live web context before answering or acting.",
    scope: "Native",
    badges: ["Built-in", "Research"],
  },
  {
    id: "vision",
    name: "Vision",
    handle: "vision.inspect",
    description: "Read screenshots, images, and visual artifacts.",
    scope: "Native",
    badges: ["Built-in", "Multimodal"],
  },
  {
    id: "image-gen",
    name: "Image generation",
    handle: "image.generate",
    description: "Create or edit bitmap assets when a task needs visuals.",
    scope: "Native",
    badges: ["Built-in", "Creative"],
  },
  {
    id: "browser-control",
    name: "Browser control",
    handle: "browser.control",
    description: "Navigate, click, inspect, and verify local web targets.",
    scope: "Runtime",
    badges: ["Plugin", "Browser"],
  },
  {
    id: "filesystem",
    name: "Filesystem",
    handle: "workspace.files",
    description: "Read and edit scoped project files inside the workspace.",
    scope: "Workspace",
    badges: ["Built-in", "Code"],
  },
  {
    id: "runtime-sessions",
    name: "Runtime sessions",
    handle: "runtime.sessions",
    description: "Search readable agent session history across runtimes.",
    scope: "Runtime",
    badges: ["Utility", "Memory"],
  },
];

export const AGENT_APP_CATALOG: AgentAppCatalogItem[] = [
  { id: "firecrawl", name: "Firecrawl", category: "AI-native", description: "Turn URLs into clean markdown or structured JSON for agents.", sourceUrl: "https://github.com/mendableai/firecrawl", badges: ["Agent API", "MCP", "Web data"], handles: ["Scrape URL", "Crawl site", "Extract JSON"] },
  { id: "crawl4ai", name: "Crawl4AI", category: "AI-native", description: "Crawl pages into LLM-ready structured data pipelines.", sourceUrl: "https://github.com/unclecode/crawl4ai", badges: ["Python", "LLM pipeline"], handles: ["Crawl site", "Extract schema"] },
  { id: "browser-use", name: "Browser Use", category: "AI-native", description: "Let agents navigate, click, fill forms, and extract web data.", sourceUrl: "https://github.com/browser-use/browser-use", badges: ["Installable", "Browser", "Agent control"], handles: ["Navigate", "Click", "Fill forms"], installableServiceId: "browser-use" },
  { id: "agent-reach", name: "Agent Reach", category: "AI-native", description: "Pinned autonomous research toolkit with guided channel setup, explicit browser-cookie consent, test fetches, reset controls, and auditable install provenance.", sourceUrl: "https://github.com/LiamVisionary/Agent-Reach", badges: ["Installable", "Pinned fork", "Research tools"], handles: ["Search web", "Setup channels", "Read social"], installableServiceId: "agent-reach" },
  { id: "rentahuman", name: "RentAHuman", category: "Specialist", description: "Hire humans for real-world tasks through marketplace search, bounties, service bookings, conversations, escrow, and direct transfers.", sourceUrl: "https://rentahuman.ai/docs", badges: ["REST API", "MCP", "Human work", "Payments"], handles: ["Search humans", "Post bounty", "Book service", "Release escrow"] },
  { id: "openhands", name: "OpenHands", category: "AI-native", description: "Autonomous software agent runtime for issue-to-change coding work.", sourceUrl: "https://github.com/OpenHands/OpenHands", badges: ["Installable", "Coding runtime", "SDK/CLI"], handles: ["Run coding task", "Resolve issue"], installableServiceId: "openhands" },
  { id: "aider", name: "Aider", category: "AI-native", description: "Terminal pair programmer with repo maps and git-aware code edits.", sourceUrl: "https://github.com/Aider-AI/aider", badges: ["Installable", "Repo map", "Terminal"], handles: ["Pair code", "Patch repo"], installableServiceId: "aider" },
  { id: "palmier-pro", name: "Palmier Pro", category: "Specialist", description: "macOS AI video editor with a local MCP server for timeline editing, media generation, and project-aware video workflows.", sourceUrl: "https://github.com/palmier-io/palmier-pro", badges: ["Installable", "MCP", "macOS", "Video"], handles: ["Edit timeline", "Generate media", "Export video"], installableServiceId: "palmier-pro" },
  { id: "n8n", name: "n8n", category: "Production scale", description: "Self-hosted workflow automation service with webhooks, schedules, AI nodes, and hundreds of integrations.", sourceUrl: "https://github.com/n8n-io/n8n", badges: ["Installable", "Workflows"], handles: ["Webhook", "Run workflow", "Schedule"], installableServiceId: "n8n" },
  { id: "agentic-inbox", name: "Agentic Inbox", category: "Specialist", description: "Cloudflare email-agent setup for inbox triage, draft replies, and Work Board task intake.", sourceUrl: "https://github.com/cloudflare/agentic-inbox", badges: ["Installable", "Cloudflare", "Email"], handles: ["Draft reply", "Route email"], installableServiceId: "agentic-inbox" },
  { id: "mcp-email-server", name: "MCP Email Server", category: "Specialist", description: "Local MCP bridge for IMAP/SMTP inbox access from self-hosted or provider mailboxes.", sourceUrl: "https://github.com/ai-zerolab/mcp-email-server", badges: ["Installable", "MCP", "Email"], handles: ["Read inbox", "Search mail", "Send email"], installableServiceId: "mcp-email-server" },
  { id: "stagehand", name: "Stagehand", category: "AI-native", description: "TypeScript browser automation that maps intent to Playwright actions.", sourceUrl: "https://github.com/browserbase/stagehand", badges: ["TypeScript", "Playwright"], handles: ["Act", "Extract", "Observe"] },
  { id: "skyvern", name: "Skyvern", category: "AI-native", description: "Vision-led browser automation for form-heavy workflows.", sourceUrl: "https://github.com/Skyvern-AI/skyvern", badges: ["Vision", "Forms"], handles: ["Run task", "Inspect screen"] },
  { id: "scrapegraph-ai", name: "ScrapeGraph AI", category: "AI-native", description: "Prompt-driven scraping that returns structured results.", sourceUrl: "https://github.com/ScrapeGraphAI/Scrapegraph-ai", badges: ["Prompted", "Structured"], handles: ["Ask page", "Extract graph"] },
  { id: "agentql", name: "AgentQL", category: "AI-native", description: "Semantic page queries for agent-safe web extraction.", sourceUrl: "https://github.com/tinyfish-io/agentql", badges: ["Query language", "Web"], handles: ["Query page", "Find element"] },
  { id: "hyperbrowser", name: "Hyperbrowser", category: "Anti-detection", description: "Hosted stealth browser sessions for protected domains.", sourceUrl: "https://github.com/hyperbrowserai/hyperbrowser", badges: ["Hosted browser", "Stealth"], handles: ["Open session", "Run automation"] },
  { id: "crawlee", name: "Crawlee", category: "Anti-detection", description: "Playwright/Puppeteer crawling framework with queues and rate limits.", sourceUrl: "https://github.com/apify/crawlee", badges: ["Node.js", "Crawler"], handles: ["Run crawler", "Queue URLs"] },
  { id: "scrapling", name: "Scrapling", category: "Anti-detection", description: "Adaptive scraping with proxy rotation and resilient selectors.", sourceUrl: "https://github.com/D4Vinci/Scrapling", badges: ["Python", "Adaptive"], handles: ["Fetch page", "Extract data"] },
  { id: "steel-browser", name: "Steel", category: "Anti-detection", description: "Open-source browser API and sandbox for managed agent sessions.", sourceUrl: "https://github.com/steel-dev/steel-browser", badges: ["Browser API", "Sessions"], handles: ["Create session", "Persist auth"] },
  { id: "playwright", name: "Playwright", category: "Production scale", description: "Reliable cross-browser automation for DOM-driven web tasks.", sourceUrl: "https://github.com/microsoft/playwright", badges: ["Browser", "Testing"], handles: ["Navigate", "Assert", "Extract"] },
  { id: "scrapy", name: "Scrapy", category: "Production scale", description: "Python crawling framework for large data extraction jobs.", sourceUrl: "https://github.com/scrapy/scrapy", badges: ["Python", "Crawler"], handles: ["Spider", "Pipeline"] },
  { id: "puppeteer", name: "Puppeteer", category: "Production scale", description: "Chrome DevTools automation for Node.js browser workflows.", sourceUrl: "https://github.com/puppeteer/puppeteer", badges: ["Node.js", "Chrome"], handles: ["Page action", "Screenshot"] },
  { id: "selenium", name: "Selenium", category: "Production scale", description: "Universal browser automation across languages and browsers.", sourceUrl: "https://github.com/SeleniumHQ/selenium", badges: ["Browser", "Legacy"], handles: ["Drive browser", "Run suite"] },
  { id: "colly", name: "Colly", category: "Production scale", description: "Fast Go crawler for high-throughput collection jobs.", sourceUrl: "https://github.com/gocolly/colly", badges: ["Go", "Crawler"], handles: ["Visit", "Parse"] },
  { id: "katana", name: "Katana", category: "Specialist", description: "Recon crawler for complex site paths and JavaScript endpoints.", sourceUrl: "https://github.com/projectdiscovery/katana", badges: ["Recon", "Security"], handles: ["Map routes", "Discover endpoints"] },
  { id: "browserless", name: "Browserless", category: "Specialist", description: "Managed browser infrastructure for Playwright and Puppeteer.", sourceUrl: "https://github.com/browserless/browserless", badges: ["Managed Chrome", "API"], handles: ["Connect browser", "Record session"] },
  { id: "maxun", name: "Maxun", category: "Specialist", description: "No-code scraping workflows that operators can train visually.", sourceUrl: "https://github.com/getmaxun/maxun", badges: ["No-code", "Workflow"], handles: ["Run robot", "Export data"] },
  { id: "heritrix", name: "Heritrix", category: "Specialist", description: "Institutional crawler for very large archival web crawls.", sourceUrl: "https://github.com/internetarchive/heritrix3", badges: ["Archival", "Crawler"], handles: ["Launch crawl", "Archive pages"] },
];
