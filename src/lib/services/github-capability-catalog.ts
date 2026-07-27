import type { AgentAppCatalogItem } from "@/features/dashboard/agent-capability-catalog";
import type { InstallableServiceId } from "@/lib/services/installable-services";
import { CONNECTOR_MANIFESTS } from "@/lib/services/integrations/connector-manifests";
import { sharedEnvValue } from "@/lib/services/integrations/shared-env-value";
import type { ConnectionProviderKey } from "@/lib/types/integrations";
import type { ContextIndexItem } from "@/lib/services/context-index";

export type GitHubCapabilitySetupOption =
  | {
      kind: "installable-service";
      serviceId: InstallableServiceId;
      label: string;
      description: string;
    }
  | {
      kind: "connection";
      providerKey: ConnectionProviderKey;
      label: string;
      description: string;
    };

export type GitHubCapabilityDefinition = {
  id: string;
  name: string;
  category: AgentAppCatalogItem["category"];
  description: string;
  sourceUrl: string;
  license: string;
  badges: string[];
  handles: string[];
  aliases: string[];
  setupOptions: GitHubCapabilitySetupOption[];
};

const install = (
  serviceId: InstallableServiceId,
  label: string,
  description: string,
): GitHubCapabilitySetupOption => ({ kind: "installable-service", serviceId, label, description });

const connect = (
  providerKey: ConnectionProviderKey,
  label: string,
  description: string,
): GitHubCapabilitySetupOption => ({ kind: "connection", providerKey, label, description });

/**
 * Reviewed GitHub capabilities that HivemindOS can propose from natural-language
 * chat requests. This matrix drives discovery, My Apps cards, and in-chat setup.
 */
export const GITHUB_CAPABILITY_CATALOG: GitHubCapabilityDefinition[] = [
  {
    id: "yt-dlp",
    name: "yt-dlp",
    category: "Specialist",
    description: "Download video, audio, subtitles, and metadata from YouTube and more than a thousand supported sites.",
    sourceUrl: "https://github.com/yt-dlp/yt-dlp",
    license: "Unlicense",
    badges: ["Installable", "Local", "Video", "Audio"],
    handles: ["Download video", "Extract audio", "Fetch subtitles"],
    aliases: ["youtube downloader", "video downloader", "audio downloader", "download media"],
    setupOptions: [install("yt-dlp", "Install yt-dlp", "Install the local yt-dlp CLI with uv; ffmpeg remains an optional format helper.")],
  },
  {
    id: "whisper",
    name: "Whisper",
    category: "AI-native",
    description: "Transcribe and translate speech locally with OpenAI's open-source Whisper model.",
    sourceUrl: "https://github.com/openai/whisper",
    license: "MIT",
    badges: ["Installable", "Local", "Transcription"],
    handles: ["Transcribe audio", "Translate speech", "Create subtitles"],
    aliases: ["openai whisper", "speech to text", "local transcription", "audio transcription"],
    setupOptions: [install("whisper", "Install Whisper", "Install the openai-whisper CLI locally with uv. ffmpeg is required for media decoding.")],
  },
  {
    id: "plausible",
    name: "Plausible Analytics",
    category: "Production scale",
    description: "Privacy-first, cookie-free web analytics through Plausible Cloud or a self-hosted Community Edition instance.",
    sourceUrl: "https://github.com/plausible/community-edition",
    license: "AGPL-3.0",
    badges: ["Connection", "Analytics", "Cookie-free", "Self-hostable"],
    handles: ["Read visitors", "Analyze traffic", "Inspect conversions"],
    aliases: ["plausible", "privacy analytics", "cookie free analytics", "website analytics"],
    setupOptions: [connect("plausible", "Connect Plausible", "Connect Plausible Cloud or a self-hosted base URL with an API key.")],
  },
  {
    id: "appflowy",
    name: "AppFlowy",
    category: "Production scale",
    description: "Open-source workspace for documents, wikis, project boards, and self-hosted collaboration.",
    sourceUrl: "https://github.com/AppFlowy-IO/AppFlowy",
    license: "AGPL-3.0",
    badges: ["Installable", "Docs", "Boards", "Self-hostable"],
    handles: ["Write docs", "Manage wiki", "Plan project"],
    aliases: ["notion alternative", "open source notion", "wiki", "project board"],
    setupOptions: [install("appflowy", "Install AppFlowy", "Install the official desktop app with the platform package manager.")],
  },
  {
    id: "n8n",
    name: "n8n",
    category: "Production scale",
    description: "Source-available workflow automation with hundreds of integrations, schedules, webhooks, and AI nodes; self-hostable under n8n's Sustainable Use License.",
    sourceUrl: "https://github.com/n8n-io/n8n",
    license: "Sustainable Use License",
    badges: ["Installable", "Workflows", "AI nodes", "Self-hostable"],
    handles: ["Build workflow", "Run automation", "Handle webhook"],
    aliases: ["workflow automation", "automation integrations", "ai workflow", "webhook automation"],
    setupOptions: [install("n8n", "Install n8n", "Run a private local n8n Docker service on localhost.")],
  },
  {
    id: "calcom",
    name: "Cal.com",
    category: "Production scale",
    description: "Scheduling and booking through hosted Cal.com or a self-hosted cal.diy instance; cal.diy is intended for personal, non-production use.",
    sourceUrl: "https://github.com/calcom/cal.diy",
    license: "MIT (cal.diy)",
    badges: ["Connection", "Scheduling", "Self-hostable"],
    handles: ["Read bookings", "Check availability", "Create scheduling link"],
    aliases: ["cal com", "calendly alternative", "booking", "scheduling link", "calendar booking"],
    setupOptions: [connect("calcom", "Connect Cal.com", "Connect hosted Cal.com or a self-hosted API base URL with an API key.")],
  },
  {
    id: "graphify",
    name: "Graphify",
    category: "AI-native",
    description: "Map a codebase into an interactive dependency graph and structured report so agents can retrieve targeted context with fewer tokens.",
    sourceUrl: "https://github.com/Graphify-Labs/graphify",
    license: "MIT",
    badges: ["Installable", "Code graph", "Token efficiency"],
    handles: ["Map codebase", "Inspect dependencies", "Generate code report"],
    aliases: ["codebase mapper", "repository map", "code graph", "reduce tokens", "dependency graph"],
    setupOptions: [install("graphify", "Install Graphify", "Install the graphifyy CLI and its reviewed parser dependencies locally with uv.")],
  },
  {
    id: "trading-agents",
    name: "TradingAgents",
    category: "AI-native",
    description: "Research-only multi-agent market analysis where specialist analysts and researchers debate evidence before producing a strategy view.",
    sourceUrl: "https://github.com/TauricResearch/TradingAgents",
    license: "Apache-2.0",
    badges: ["Installable", "Multi-agent", "Research only"],
    handles: ["Debate market thesis", "Research strategy", "Analyze risk"],
    aliases: ["trading agents", "ai trading analysts", "strategy debate", "market analyst team"],
    setupOptions: [install("trading-agents", "Install TradingAgents", "Clone the reviewed upstream source and create an isolated local uv environment.")],
  },
  {
    id: "ghost",
    name: "Ghost",
    category: "Production scale",
    description: "Open-source publishing, newsletters, memberships, and subscriptions for running an independent publication.",
    sourceUrl: "https://github.com/TryGhost/Ghost",
    license: "MIT",
    badges: ["Installable", "Publishing", "Newsletter", "Self-hostable"],
    handles: ["Publish article", "Run newsletter", "Manage members"],
    aliases: ["substack alternative", "newsletter platform", "publishing platform", "membership site"],
    setupOptions: [install("ghost", "Install Ghost", "Run Ghost in a private local Docker service with persistent content storage.")],
  },
  {
    id: "medusa",
    name: "Medusa",
    category: "Production scale",
    description: "Open-source commerce modules and application starters for building a customizable Shopify-style store.",
    sourceUrl: "https://github.com/medusajs/medusa",
    license: "MIT",
    badges: ["Installable", "Commerce", "Self-hostable"],
    handles: ["Build store backend", "Manage products", "Run commerce workflow"],
    aliases: ["open source shopify", "commerce backend", "ecommerce platform", "store backend"],
    setupOptions: [connect("medusa", "Connect Medusa", "Connect a hosted or self-hosted Medusa Store API with its base URL and publishable API key.")],
  },
  {
    id: "shopify",
    name: "Shopify",
    category: "Production scale",
    description: "Connect a Shopify store so agents can read catalog and store context through the Admin GraphQL API.",
    sourceUrl: "https://github.com/Shopify/shopify-api-js",
    license: "MIT",
    badges: ["Connection", "Commerce", "Admin API"],
    handles: ["Read store", "Inspect products", "Analyze catalog"],
    aliases: ["shopify integration", "shopify admin", "shopify store", "commerce connector"],
    setupOptions: [connect("shopify", "Connect Shopify", "Connect a store domain and user-generated Admin API access token. The token remains in the shared hive env.")],
  },
];

const BY_CONTEXT_ID = new Map(GITHUB_CAPABILITY_CATALOG.map((item) => [`github-capability:${item.id}`, item]));

export function githubCapabilityForContextId(id: string) {
  return BY_CONTEXT_ID.get(id);
}

export function githubCapabilityAgentApps(): AgentAppCatalogItem[] {
  return GITHUB_CAPABILITY_CATALOG.map((capability) => ({
    id: capability.id,
    name: capability.name,
    category: capability.category,
    description: capability.description,
    sourceUrl: capability.sourceUrl,
    badges: capability.badges,
    handles: capability.handles,
    installableServiceId: capability.setupOptions.find((option) => option.kind === "installable-service")?.serviceId,
  }));
}

function connectionReady(providerKey: ConnectionProviderKey, sharedEnv: Record<string, string>) {
  const manifest = CONNECTOR_MANIFESTS.find((entry) => entry.key === providerKey);
  if (!manifest) return false;
  return [manifest.auth.tokenEnvKey, ...(manifest.auth.tokenEnvAliases ?? [])]
    .some((key) => Boolean(sharedEnvValue(key, sharedEnv)));
}

export function githubCapabilityContextIndexItems(sharedEnv: Record<string, string>): ContextIndexItem[] {
  return GITHUB_CAPABILITY_CATALOG.map((capability) => {
    const connectionOptions = capability.setupOptions.filter((option) => option.kind === "connection");
    const ready = connectionOptions.length > 0 && connectionOptions.some((option) => connectionReady(option.providerKey, sharedEnv));
    return {
      id: `github-capability:${capability.id}`,
      kind: "tool-schema",
      title: capability.name,
      summary: capability.description,
      tags: [
        "github-capability",
        capability.category,
        capability.license,
        ready ? "availability:ready" : "availability:setup-required",
        ...capability.badges,
        ...capability.handles,
      ],
      aliases: capability.aliases,
      retrievalText: `${capability.description} ${capability.handles.join(". ")} Source: ${capability.sourceUrl}. Setup is available inside HivemindOS chat.`,
      path: capability.sourceUrl,
      load: {
        type: "api",
        target: "/api/fleet/apps/installable-services",
        note: "Use the in-chat setup modal. Installation and credential actions remain user-confirmed.",
      },
    };
  });
}
