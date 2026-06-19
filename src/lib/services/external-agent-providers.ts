import type { ContextIndexItem } from "@/lib/services/context-index";

export type ExternalAgentProviderId =
  | "browser-use"
  | "awesome-mcp-servers"
  | "cloudflare-agentic-inbox"
  | "mcp-email-server"
  | "openhands"
  | "aider"
  | "n8n"
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
