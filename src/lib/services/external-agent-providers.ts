import type { ContextIndexItem } from "@/lib/services/context-index";

export type ExternalAgentProviderId =
  | "browser-use"
  | "awesome-mcp-servers"
  | "agentmail"
  | "cloudflare-agentic-inbox"
  | "mcp-email-server"
  | "openhands"
  | "aider"
  | "hivemind-office"
  | "palmier-pro"
  | "rentahuman"
  | "n8n"
  | "listmonk"
  | "queen-bee-prd-decomposition";

export type ExternalAgentProvider = {
  id: ExternalAgentProviderId;
  name: string;
  sourceUrl: string;
  licenseNote: string;
  summary: string;
  capabilities: string[];
  installSurface: "runtime-adapter" | "mcp-catalog" | "installable-service" | "queen-bee";
  credentialKeys: string[];
  sideEffectGate: string;
  fallback: string;
};

export const EXTERNAL_AGENT_PROVIDERS: ExternalAgentProvider[] = [
  {
    id: "browser-use",
    name: "Browser Use",
    sourceUrl: "https://github.com/browser-use/browser-use",
    licenseNote: "MIT; use as an optional browser automation capability.",
    summary: "Web automation provider for navigation, form filling, extraction, screenshots, persistent browser sessions, and browser-agent recovery loops.",
    capabilities: ["browser", "forms", "scraping", "authenticated-web", "screenshots"],
    installSurface: "installable-service",
    credentialKeys: ["BROWSER_USE_API_KEY"],
    sideEffectGate: "Use /api/browser-use or the Browser Use installable service; browser tasks should declare allowed domains and whether authenticated profile reuse is expected.",
    fallback: "Use built-in Browser/Chrome control or Playwright when Browser Use is unavailable.",
  },
  {
    id: "awesome-mcp-servers",
    name: "Awesome MCP Servers",
    sourceUrl: "https://github.com/punkpeye/awesome-mcp-servers",
    licenseNote: "MIT catalog; individual MCP servers keep their own licenses.",
    summary: "Curated MCP server directory for GitHub, Slack, Linear, Stripe, Postgres, Notion, browser tools, and other agent integrations.",
    capabilities: ["mcp", "tool-discovery", "integrations", "catalog"],
    installSurface: "mcp-catalog",
    credentialKeys: [],
    sideEffectGate: "Install only MCP servers whose requested credential keys and side effects match the task.",
    fallback: "Use built-in HivemindOS APIs, connected apps, or runtime-native tools.",
  },
  {
    id: "cloudflare-agentic-inbox",
    name: "Cloudflare Agentic Inbox",
    sourceUrl: "https://github.com/cloudflare/agentic-inbox",
    licenseNote: "Apache-2.0; blueprint should be deployed into the user's own Cloudflare account.",
    summary: "Email agent architecture using Cloudflare Email Routing, Durable Objects with SQLite, R2 attachments, Workers AI, and the Agents SDK.",
    capabilities: ["email", "cloudflare-workers", "durable-objects", "r2", "agent-inbox"],
    installSurface: "installable-service",
    credentialKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    sideEffectGate: "Use /api/cloudflare/agentic-inbox to scaffold/deploy; requires an onboarded domain and explicit deployment because email routing can receive real personal mail.",
    fallback: "Use local messaging channels or a webhook inbox until a Cloudflare email domain is ready.",
  },
  {
    id: "agentmail",
    name: "AgentMail",
    sourceUrl: "https://www.agentmail.to/",
    licenseNote: "Hosted provider API with official docs, SDKs, CLI, and MCP; use through the user's AgentMail account and API key.",
    summary: "API-first email inboxes for AI agents, with inbox creation, send/receive, threads, attachments, webhooks, WebSockets, custom domains, hosted MCP, and CLI support.",
    capabilities: ["email", "agent-inbox", "mcp", "webhooks", "custom-domains", "hosted-mail"],
    installSurface: "mcp-catalog",
    credentialKeys: ["AGENTMAIL_API_KEY", "AGENTMAIL_DOMAIN", "AGENTMAIL_API_BASE_URL"],
    sideEffectGate: "Use Agent Settings Create mailbox or the /api/agents/mailbox route for one-click inbox provisioning. Direct send/reply actions should confirm recipient, subject, and body before sending live email.",
    fallback: "Use Cloudflare Agentic Inbox for a self-hosted Cloudflare path, or MCP Email Server for BYO IMAP/SMTP mailboxes.",
  },
  {
    id: "mcp-email-server",
    name: "MCP Email Server",
    sourceUrl: "https://github.com/ai-zerolab/mcp-email-server",
    licenseNote: "MIT; deploy as a local MCP stdio bridge against a mailbox the user controls.",
    summary: "Local MCP server that exposes IMAP inbox reading/searching and optional SMTP sending to agents through standard mailbox protocols.",
    capabilities: ["email", "mcp", "imap", "smtp", "agent-inbox", "self-hosted-mail"],
    installSurface: "installable-service",
    credentialKeys: ["MCP_EMAIL_SERVER_EMAIL_ADDRESS", "MCP_EMAIL_SERVER_PASSWORD", "MCP_EMAIL_SERVER_IMAP_HOST", "MCP_EMAIL_SERVER_SMTP_HOST"],
    sideEffectGate: "Use the MCP Email Server installable service to install the bridge, then configure MCP clients with explicit mailbox env keys. Omit SMTP host for read-only IMAP mode.",
    fallback: "Use Cloudflare Agentic Inbox for a Cloudflare-hosted mailbox path, or local messaging channels when no IMAP mailbox is available.",
  },
  {
    id: "openhands",
    name: "OpenHands",
    sourceUrl: "https://github.com/OpenHands/OpenHands",
    licenseNote: "Core is MIT; enterprise directory is source-available.",
    summary: "Optional autonomous coding runtime for issue-to-change work, CLI/SDK/local GUI flows, and browser-capable software engineering tasks.",
    capabilities: ["coding-agent", "filesystem", "shell", "browser", "github-issues"],
    installSurface: "runtime-adapter",
    credentialKeys: ["OPENHANDS_BIN"],
    sideEffectGate: "Use the OpenHands runtime action run-task; run in a disposable worktree for autonomous code changes unless the user explicitly targets the current checkout.",
    fallback: "Use Codex, Claude Code, OpenCode, Hermes Codex runtime, or Aider.",
  },
  {
    id: "aider",
    name: "Aider",
    sourceUrl: "https://github.com/Aider-AI/aider",
    licenseNote: "Apache-2.0; auto-commit behavior must respect project changelog rules.",
    summary: "Optional terminal pair-programming runtime with repo maps and git-aware code editing.",
    capabilities: ["coding-agent", "repo-map", "git", "filesystem", "terminal"],
    installSurface: "runtime-adapter",
    credentialKeys: ["AIDER_BIN"],
    sideEffectGate: "Use the Aider runtime action run-task; HivemindOS passes no-auto-commits/no-dirty-commits for repo safety.",
    fallback: "Use Codex, Claude Code, OpenCode, or Hermes.",
  },
  {
    id: "hivemind-office",
    name: "Hivemind Office",
    sourceUrl: "https://github.com/criptogus/HermesOffice",
    licenseNote: "Apache-2.0 fork of GenOffice outside the separately licensed ee directory; HivemindOS consumes no ee source.",
    summary: "Optional local office companion for visual document review, paired with HivemindOS-owned MCP tools for bounded extraction, hash-bound candidate review, copy-first saves, and explicit backup-before-replace writes.",
    capabilities: ["documents", "docx", "spreadsheets", "slides", "pdf", "mcp", "desktop-preview", "conflict-safe-writes"],
    installSurface: "installable-service",
    credentialKeys: [],
    sideEffectGate: "Use the bundled hivemind_office_* tools. Inspect and open a separate candidate before applying it; default to save-copy. Replacement requires unchanged hashes, a prepare fingerprint, explicit confirmation, and creates a backup.",
    fallback: "Use HivemindOS bundled document ingestion for reading and the system's existing office application for manual editing when no compatible companion is installed.",
  },
  {
    id: "palmier-pro",
    name: "Palmier Pro",
    sourceUrl: "https://github.com/palmier-io/palmier-pro",
    licenseNote: "GPL-3.0 editor and MCP server; upstream generative AI processing is closed/subscription-backed.",
    summary: "Installable macOS AI video editor that exposes a local MCP server for timeline editing, project-aware media operations, and generative video workflows while the app is open.",
    capabilities: ["video-editing", "timeline", "mcp", "generative-media", "macos-app"],
    installSurface: "installable-service",
    credentialKeys: [],
    sideEffectGate: "Install/open through Apps & Services, then connect MCP clients to the loopback endpoint only after confirming which Palmier project and media should be edited.",
    fallback: "Use HivemindOS video assembly scripts, local media tools, or manual editor workflows when Palmier Pro is unavailable.",
  },
  {
    id: "rentahuman",
    name: "RentAHuman",
    sourceUrl: "https://rentahuman.ai/docs",
    licenseNote: "Hosted provider API; use only through the user's RentAHuman account and API key.",
    summary: "Human-in-the-loop marketplace for hiring people to complete real-world tasks through REST or MCP: profile search, conversations, bounties, service bookings, escrow, wallet, and transfer flows.",
    capabilities: ["human-work", "bounties", "real-world-tasks", "escrow", "services", "mcp", "rest-api"],
    installSurface: "mcp-catalog",
    credentialKeys: ["RENTAHUMAN_API_KEY", "RENTAHUMAN_API_URL"],
    sideEffectGate: "Use /api/rentahuman for REST calls or the curated MCP entry. Search and browse are read-only; conversations, bounties, bookings, escrow, and transfers require an API key plus explicit confirmation before execution.",
    fallback: "Create a Work Board task for manual human follow-up or use existing messaging/payment rails when RentAHuman is unavailable.",
  },
  {
    id: "n8n",
    name: "n8n",
    sourceUrl: "https://github.com/n8n-io/n8n",
    licenseNote: "Sustainable Use / source-available; integrate as an external user-run service, not embedded product code.",
    summary: "Installable workflow automation service with webhooks, 400+ integrations, AI workflow nodes, and long-running automations.",
    capabilities: ["workflow-automation", "webhooks", "integrations", "scheduler", "connected-app"],
    installSurface: "installable-service",
    credentialKeys: [],
    sideEffectGate: "Run only on localhost/Tailnet by default and restrict workflow editing to trusted users.",
    fallback: "Use HivemindOS scheduler, Queen Bee tasks, or connected app APIs.",
  },
  {
    id: "listmonk",
    name: "Listmonk",
    sourceUrl: "https://github.com/knadh/listmonk",
    licenseNote: "AGPL-3.0; run as a separate self-hosted service and preserve upstream license obligations.",
    summary: "Self-hosted subscriber, newsletter, campaign, and transactional-email manager backed by PostgreSQL and a separately configured SMTP delivery provider.",
    capabilities: ["email-campaigns", "newsletter", "subscriber-lists", "transactional-email", "self-hosted-email"],
    installSurface: "installable-service",
    credentialKeys: [],
    sideEffectGate: "Install on localhost through Apps & Services. Listmonk does not provide a mailbox or SMTP delivery; configure and verify a separate SMTP provider, sending domain, recipients, and campaign content before any live send.",
    fallback: "Use AgentMail for provisioned agent inboxes, Cloudflare Agentic Inbox for self-hosted inbound workflows, or an email provider's campaign product when local Listmonk operations are not desired.",
  },
  {
    id: "queen-bee-prd-decomposition",
    name: "Queen Bee PRD Decomposition",
    sourceUrl: "https://github.com/eyaltoledano/claude-task-master",
    licenseNote: "Task Master is MIT with Commons Clause; copy no code, use only compatible task-management concepts.",
    summary: "PRD-to-Work-Board decomposition that creates a parent epic, linked implementation tasks, dependencies, acceptance criteria, and agent routing hints.",
    capabilities: ["prd", "task-decomposition", "dependencies", "work-board", "queen-bee"],
    installSurface: "queen-bee",
    credentialKeys: [],
    sideEffectGate: "Creates durable Work Board tasks; use preview/plan mode when the user is not ready to enqueue work.",
    fallback: "Use a single Queen Bee routed task.",
  },
];

export function externalAgentProviderItems(): ContextIndexItem[] {
  return EXTERNAL_AGENT_PROVIDERS.map((provider) => ({
    id: `external-agent-provider:${provider.id}`,
    kind: "tool-schema",
    title: provider.name,
    summary: provider.summary,
    tags: [
      "external-agent-provider",
      provider.installSurface,
      ...provider.capabilities,
    ],
    aliases: [
      provider.id,
      provider.name.toLowerCase(),
      ...provider.capabilities,
    ],
    retrievalText: [
      provider.summary,
      `Source: ${provider.sourceUrl}`,
      `Install surface: ${provider.installSurface}`,
      `Credentials by key name only: ${provider.credentialKeys.join(", ") || "none"}`,
      `Side-effect gate: ${provider.sideEffectGate}`,
      `Fallback: ${provider.fallback}`,
      provider.licenseNote,
    ].join(" "),
    load: {
      type: "none",
      note: "Provider matrix entry. Use the matching HivemindOS API/runtime/service surface before installing or running external code.",
    },
  }));
}
