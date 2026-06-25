export type HiveMcpServerCatalogItem = {
  id: string;
  name: string;
  source: "awesome-mcp-servers" | "official" | "hivemindos";
  repoUrl: string;
  summary: string;
  categories: string[];
  capabilities: string[];
  credentialKeys: string[];
  sideEffects: Array<"read" | "write" | "network" | "payments" | "browser" | "filesystem">;
  installHint: string;
  safetyNote: string;
};

export const HIVE_MCP_SERVER_CATALOG: HiveMcpServerCatalogItem[] = [
  {
    id: "github",
    name: "GitHub MCP Server",
    source: "official",
    repoUrl: "https://github.com/github/github-mcp-server",
    summary: "Repository search, issues, pull requests, code context, and GitHub workflow actions.",
    categories: ["development", "source-control"],
    capabilities: ["repo-search", "issues", "pull-requests", "code-review"],
    credentialKeys: ["GITHUB_TOKEN"],
    sideEffects: ["read", "write", "network"],
    installHint: "Install through the runtime MCP manager when the task needs GitHub repository operations.",
    safetyNote: "Use read-only scopes unless the task explicitly needs issue, branch, or pull request mutation.",
  },
  {
    id: "browser-use",
    name: "Browser Use",
    source: "awesome-mcp-servers",
    repoUrl: "https://github.com/browser-use/browser-use",
    summary: "Browser automation for navigation, form filling, scraping, screenshots, and web-task execution.",
    categories: ["browser", "automation"],
    capabilities: ["navigate", "click", "type", "extract", "screenshot"],
    credentialKeys: ["BROWSER_USE_API_KEY"],
    sideEffects: ["read", "write", "network", "browser"],
    installHint: "Use Browser Use for web tasks that need a browser-agent loop; constrain allowed domains before running.",
    safetyNote: "Do not use authenticated browser profiles without a user-visible task and allowed-domain boundary.",
  },
  {
    id: "agentmail",
    name: "AgentMail MCP",
    source: "official",
    repoUrl: "https://docs.agentmail.to/integrations/mcp",
    summary: "Hosted MCP server for AgentMail inboxes, messages, threads, drafts, and attachments.",
    categories: ["email", "communication", "agent-inbox"],
    capabilities: ["list-inboxes", "create-inbox", "send-message", "reply-to-message", "threads", "drafts", "attachments"],
    credentialKeys: ["AGENTMAIL_API_KEY"],
    sideEffects: ["read", "write", "network"],
    installHint: "Connect MCP clients to https://mcp.agentmail.to/mcp with OAuth where supported, or pass AGENTMAIL_API_KEY through the client when OAuth is unavailable.",
    safetyNote: "Sending and replying are live email side effects; confirm recipients, subject, body, and attachment intent before using write-capable tools.",
  },
  {
    id: "palmier-pro",
    name: "Palmier Pro MCP",
    source: "hivemindos",
    repoUrl: "https://github.com/palmier-io/palmier-pro",
    summary: "Local MCP server bundled with the Palmier Pro macOS video editor for agent-assisted timeline editing, media generation, and project operations.",
    categories: ["video", "creative", "mcp"],
    capabilities: ["timeline-editing", "video-generation", "media-import", "project-editing"],
    credentialKeys: [],
    sideEffects: ["read", "write", "network", "filesystem"],
    installHint: "Install Palmier Pro from Apps & Services, open the app, then connect MCP clients to http://127.0.0.1:19789/mcp.",
    safetyNote: "Confirm the target project and media before running write-capable timeline tools; the MCP endpoint is local-only and exists only while Palmier Pro is open.",
  },
  {
    id: "rentahuman",
    name: "RentAHuman MCP Server",
    source: "official",
    repoUrl: "https://rentahuman.ai/docs",
    summary: "Official MCP server and HTTP compatibility endpoint for hiring humans: marketplace search, conversations, bounties, service bookings, escrow, wallets, direct transfers, API keys, and webhooks.",
    categories: ["human-work", "marketplace", "payments"],
    capabilities: ["search-humans", "start-conversation", "create-bounty", "browse-services", "book-service", "rent-human", "escrow", "wallet"],
    credentialKeys: ["RENTAHUMAN_API_KEY", "RENTAHUMAN_API_URL"],
    sideEffects: ["read", "write", "network", "payments"],
    installHint: "Use `npx -y rentahuman-mcp` for stdio MCP, or call HivemindOS `/api/rentahuman` for REST actions backed by shared env credentials.",
    safetyNote: "Search and browse can run read-only; messaging, bounties, bookings, escrow, transfers, and payment release require an explicit user-reviewed confirmation.",
  },
  {
    id: "postgres",
    name: "Postgres MCP Server",
    source: "awesome-mcp-servers",
    repoUrl: "https://github.com/modelcontextprotocol/servers",
    summary: "Query and inspect PostgreSQL databases through MCP-compatible clients.",
    categories: ["database"],
    capabilities: ["sql", "schema-inspection", "data-query"],
    credentialKeys: ["DATABASE_URL", "POSTGRES_URL"],
    sideEffects: ["read", "write", "network"],
    installHint: "Install only with a least-privilege database URL; prefer read-only users for analysis.",
    safetyNote: "Treat SQL as destructive-capable unless the connection is explicitly read-only.",
  },
  {
    id: "slack",
    name: "Slack MCP Server",
    source: "awesome-mcp-servers",
    repoUrl: "https://github.com/modelcontextprotocol/servers",
    summary: "Read channels and send messages through Slack workspace APIs.",
    categories: ["communication"],
    capabilities: ["channel-search", "message-read", "message-send"],
    credentialKeys: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
    sideEffects: ["read", "write", "network"],
    installHint: "Use for team messaging only after confirming the destination channel or user.",
    safetyNote: "List destinations first; never expose channel IDs or tokens in responses.",
  },
  {
    id: "linear",
    name: "Linear MCP Server",
    source: "awesome-mcp-servers",
    repoUrl: "https://github.com/modelcontextprotocol/servers",
    summary: "Read and update Linear teams, issues, projects, and workflow state.",
    categories: ["project-management"],
    capabilities: ["issues", "projects", "workflow"],
    credentialKeys: ["LINEAR_API_KEY"],
    sideEffects: ["read", "write", "network"],
    installHint: "Use when a Work Board task needs to sync with Linear planning records.",
    safetyNote: "Confirm project/team targets before creating or moving issues.",
  },
  {
    id: "stripe",
    name: "Stripe MCP Server",
    source: "awesome-mcp-servers",
    repoUrl: "https://github.com/stripe/agent-toolkit",
    summary: "Inspect and operate Stripe resources through agent-safe tools.",
    categories: ["payments"],
    capabilities: ["customers", "payments", "subscriptions", "invoices"],
    credentialKeys: ["STRIPE_SECRET_KEY"],
    sideEffects: ["read", "write", "network", "payments"],
    installHint: "Use test-mode credentials first; production payments require explicit user confirmation.",
    safetyNote: "Never run payment mutations from an inferred request.",
  },
  {
    id: "notion",
    name: "Notion MCP Server",
    source: "awesome-mcp-servers",
    repoUrl: "https://github.com/modelcontextprotocol/servers",
    summary: "Search, read, and update Notion workspace pages and databases.",
    categories: ["knowledge", "documents"],
    capabilities: ["search", "pages", "databases"],
    credentialKeys: ["NOTION_API_KEY"],
    sideEffects: ["read", "write", "network"],
    installHint: "Use when the user chooses Notion as the operational knowledge source.",
    safetyNote: "Prefer importing summaries into Shared Brain Memory for durable HivemindOS reasoning.",
  },
];

export function searchHiveMcpCatalog(query = "", limit = 40) {
  const clean = query.trim().toLowerCase();
  const scored = HIVE_MCP_SERVER_CATALOG.map((item) => {
    const haystack = [
      item.id,
      item.name,
      item.summary,
      ...item.categories,
      ...item.capabilities,
      ...item.credentialKeys,
    ].join(" ").toLowerCase();
    const score = clean
      ? clean.split(/\s+/).filter((term) => haystack.includes(term)).length
      : 1;
    return { item, score };
  })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name));
  return scored.slice(0, Math.max(1, Math.min(limit, 100))).map(({ item }) => item);
}
