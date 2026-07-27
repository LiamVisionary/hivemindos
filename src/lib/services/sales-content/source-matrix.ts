import type {
  SalesContentSourceId,
  SalesContentSourceMatrixRow,
  SalesContentSourceRuntimeStatus,
  SalesContentSourceStatus,
} from "@/lib/services/sales-content/types";
import type { Company } from "@/lib/types/company";
import { analyticsAdapter } from "@/lib/services/company-analytics/registry-meta";
import type { AnalyticsProviderKey, AnalyticsSummaryResult } from "@/lib/services/company-analytics/types";
import type { CompanyEmailThreadsResult } from "@/lib/services/agent-mailboxes";
import {
  CONNECTOR_MANIFESTS_BY_KEY,
  type ConnectorManifest,
} from "@/lib/services/integrations/connector-manifests";
import type { ConnectionProviderKey } from "@/lib/types/integrations";
import { HIVE_MCP_SERVER_CATALOG } from "@/lib/services/mcp/catalog";

function connector(key: ConnectionProviderKey): ConnectorManifest {
  return CONNECTOR_MANIFESTS_BY_KEY[key];
}

function connectorCredentialKeys(key: ConnectionProviderKey): string[] {
  const auth = connector(key).auth;
  return [
    auth.tokenEnvKey,
    ...(auth.tokenEnvAliases ?? []),
    ...(auth.oauthClientEnvKeys ?? []),
  ];
}

function analyticsLabel(key: AnalyticsProviderKey): string {
  return analyticsAdapter(key)?.label ?? key;
}

function analyticsCredentialKeys(key: AnalyticsProviderKey): string[] | undefined {
  const envKey = analyticsAdapter(key)?.credentialEnvKey;
  return envKey ? [envKey] : undefined;
}

function mcpLabel(id: string): string {
  return HIVE_MCP_SERVER_CATALOG.find((item) => item.id === id)?.name ?? id;
}

function mcpCredentialKeys(id: string): string[] {
  return HIVE_MCP_SERVER_CATALOG.find((item) => item.id === id)?.credentialKeys ?? [];
}

export const SALES_CONTENT_SOURCE_MATRIX: readonly SalesContentSourceMatrixRow[] = [
  {
    id: "company-profile",
    label: "Company profile",
    kind: "company",
    status: "ready",
    capabilities: ["read-products"],
    sideEffects: ["none"],
    evidence: "Company identity, apex goal, official products, pricing, directives, and approval policy already live on the Company record.",
  },
  {
    id: "work-board",
    label: "Work Board",
    kind: "work",
    status: "ready",
    capabilities: ["read-work"],
    sideEffects: ["none"],
    evidence: "Company dispatch already creates Work Board tasks through the Queen Bee control plane.",
  },
  {
    id: "agentmail",
    label: "AgentMail",
    kind: "mail",
    status: "optional",
    capabilities: ["read-threads", "send-mail"],
    sideEffects: ["send-email"],
    credentialEnvKeys: ["AGENTMAIL_API_KEY"],
    mailProviderId: "agentmail",
    evidence: "Agent mailboxes register AgentMail as a generic mail provider.",
    gate: "Live sends require the company approval policy and provider receipt.",
  },
  {
    id: "cloudflare-agentic-inbox",
    label: "Cloudflare Inbox",
    kind: "mail",
    status: "optional",
    capabilities: ["read-threads", "send-mail"],
    sideEffects: ["send-email"],
    mailProviderId: "cloudflare-agentic-inbox",
    evidence: "Agent mailboxes register Cloudflare Agentic Inbox as a generic mail provider.",
    gate: "Live sends require the company approval policy and provider receipt.",
  },
  {
    id: "maps-agency-outbox",
    label: "Outreach Engine",
    kind: "mail",
    status: "optional",
    capabilities: ["read-threads", "send-mail"],
    sideEffects: ["send-email"],
    mailProviderId: "maps-agency-outbox",
    evidence: "Company outreach outbox reads the engine JSONL outbox as the source of truth for real sent and queued outreach.",
    gate: "Outreach completion must include sent or blocked status plus receipt evidence.",
  },
  {
    id: "hivemind-funnel",
    label: "HivemindOS funnel",
    kind: "analytics",
    status: "ready",
    capabilities: ["read-analytics"],
    sideEffects: ["none"],
    analyticsProviderKey: "hivemind-funnel",
    evidence: "The built-in funnel adapter reads the company's own metric fields without external credentials.",
  },
  {
    id: "posthog",
    label: analyticsLabel("posthog"),
    kind: "analytics",
    status: "optional",
    capabilities: ["read-analytics"],
    sideEffects: ["none"],
    credentialEnvKeys: connectorCredentialKeys("posthog"),
    connectionProviderKey: "posthog",
    analyticsProviderKey: "posthog",
    evidence: `${connector("posthog").label} connection metadata comes from the shared connector manifest; analytics reads through the company analytics adapter.`,
  },
  {
    id: "plausible",
    label: analyticsLabel("plausible"),
    kind: "analytics",
    status: "optional",
    capabilities: ["read-analytics"],
    sideEffects: ["none"],
    credentialEnvKeys: connectorCredentialKeys("plausible"),
    connectionProviderKey: "plausible",
    analyticsProviderKey: "plausible",
    evidence: `${connector("plausible").label} connection metadata comes from the shared connector manifest; analytics reads through the company analytics adapter.`,
  },
  {
    id: "ga4",
    label: analyticsLabel("ga4"),
    kind: "analytics",
    status: "optional",
    capabilities: ["read-analytics"],
    sideEffects: ["none"],
    credentialEnvKeys: analyticsCredentialKeys("ga4"),
    connectionProviderKey: "google",
    analyticsProviderKey: "ga4",
    evidence: `${connector("google").label} OAuth comes from the shared connector manifest; GA4 reads through the company analytics adapter.`,
  },
  {
    id: "x-api",
    label: mcpLabel("xapi"),
    kind: "social",
    status: "optional",
    capabilities: ["read-social", "post-social"],
    sideEffects: ["post-social"],
    credentialEnvKeys: mcpCredentialKeys("xapi"),
    mcpServerId: "xapi",
    evidence: "The MCP catalog owns X API MCP metadata, credentials, capabilities, and side-effect notes.",
    gate: "Non-read X actions require explicit confirmation and managed gateway/write gates.",
  },
  {
    id: "hive-pulse",
    label: "Hive Pulse",
    kind: "social",
    status: "optional",
    capabilities: ["read-social"],
    sideEffects: ["none"],
    skillSlug: "hive-pulse",
    evidence: "The hive-pulse CLI can monitor Reddit, Hacker News, Polymarket, GitHub, X, YouTube, and TikTok sources.",
  },
  {
    id: "youtube",
    label: "YouTube signals",
    kind: "social",
    status: "planned",
    capabilities: ["read-social"],
    sideEffects: ["none"],
    evidence: "No first-class company YouTube source is wired yet; Hive Pulse can be the interim reader.",
  },
  {
    id: "tiktok",
    label: "TikTok signals",
    kind: "social",
    status: "planned",
    capabilities: ["read-social"],
    sideEffects: ["none"],
    evidence: "No first-class company TikTok source is wired yet; Hive Pulse can be the interim reader.",
  },
  {
    id: "slack",
    label: connector("slack").label,
    kind: "automation",
    status: "optional",
    capabilities: ["schedule-workflows"],
    sideEffects: ["none"],
    credentialEnvKeys: connectorCredentialKeys("slack"),
    connectionProviderKey: "slack",
    mcpServerId: "slack",
    evidence: "Slack connection metadata comes from the shared connector manifest; MCP tool metadata comes from the MCP catalog.",
  },
  {
    id: "linear",
    label: connector("linear").label,
    kind: "automation",
    status: "optional",
    capabilities: ["schedule-workflows"],
    sideEffects: ["none"],
    credentialEnvKeys: connectorCredentialKeys("linear"),
    connectionProviderKey: "linear",
    mcpServerId: "linear",
    evidence: "Linear connection metadata comes from the shared connector manifest; MCP tool metadata comes from the MCP catalog.",
  },
  {
    id: "n8n-crm-conversation-sync",
    label: "n8n CRM conversation sync",
    kind: "automation",
    status: "optional",
    capabilities: ["read-deals", "write-deals", "read-transcripts", "schedule-workflows"],
    sideEffects: ["write-crm"],
    skillSlug: "n8n-crm-conversation-sync",
    evidence: "The optional n8n GTM pack includes CRM conversation sync for HubSpot and Salesforce.",
    gate: "CRM writes require entity-match confidence and write approval.",
  },
  {
    id: "hubspot",
    label: "HubSpot",
    kind: "crm",
    status: "planned",
    capabilities: ["read-deals", "write-deals"],
    sideEffects: ["write-crm"],
    evidence: "No first-class HubSpot adapter exists in core yet; use the n8n CRM sync pack until promoted.",
    gate: "CRM writes require entity-match confidence and write approval.",
  },
  {
    id: "salesforce",
    label: "Salesforce",
    kind: "crm",
    status: "planned",
    capabilities: ["read-deals", "write-deals"],
    sideEffects: ["write-crm"],
    evidence: "No first-class Salesforce adapter exists in core yet; use the n8n CRM sync pack until promoted.",
    gate: "CRM writes require entity-match confidence and write approval.",
  },
  {
    id: "pipedrive",
    label: "Pipedrive",
    kind: "crm",
    status: "planned",
    capabilities: ["read-deals", "write-deals"],
    sideEffects: ["write-crm"],
    evidence: "No first-class Pipedrive adapter exists in core yet.",
    gate: "CRM writes require entity-match confidence and write approval.",
  },
  {
    id: "granola",
    label: "Granola",
    kind: "conversation",
    status: "planned",
    capabilities: ["read-transcripts"],
    sideEffects: ["none"],
    evidence: "No first-class Granola adapter exists in core yet.",
  },
  {
    id: "gong",
    label: "Gong",
    kind: "conversation",
    status: "planned",
    capabilities: ["read-transcripts"],
    sideEffects: ["none"],
    evidence: "No first-class Gong adapter exists in core yet.",
  },
  {
    id: "fireflies",
    label: "Fireflies",
    kind: "conversation",
    status: "planned",
    capabilities: ["read-transcripts"],
    sideEffects: ["none"],
    evidence: "No first-class Fireflies adapter exists in core yet.",
  },
  {
    id: "runtime-image-generation",
    label: "Runtime image generation",
    kind: "creative",
    status: "optional",
    capabilities: ["generate-image"],
    sideEffects: ["none"],
    runtimeIntegrationKey: "imageGeneration",
    evidence: "Runtime integrations already expose image-generation capability status per agent runtime.",
  },
  {
    id: "runtime-video-generation",
    label: "Runtime video generation",
    kind: "creative",
    status: "optional",
    capabilities: ["generate-video"],
    sideEffects: ["none"],
    runtimeIntegrationKey: "videoGeneration",
    evidence: "Runtime integrations already expose video-generation capability status per agent runtime.",
  },
] as const;

export function salesContentSource(id: SalesContentSourceId): SalesContentSourceMatrixRow | undefined {
  return SALES_CONTENT_SOURCE_MATRIX.find((row) => row.id === id);
}

function statusDetail(row: SalesContentSourceMatrixRow, status: SalesContentSourceStatus): string {
  if (status === "ready") return "Ready";
  if (status === "configured") return "Configured";
  if (status === "missing-credential") return "Credential or provider setup needed";
  if (status === "planned") return "Adapter planned";
  if (status === "unavailable") return "Not available on this company";
  return row.status === "optional" ? "Optional" : row.evidence;
}

export function salesContentSourceRuntimeStatuses(input: {
  company: Company;
  mail?: CompanyEmailThreadsResult | null;
  analytics?: AnalyticsSummaryResult | null;
}): SalesContentSourceRuntimeStatus[] {
  return SALES_CONTENT_SOURCE_MATRIX.map((row) => {
    let status: SalesContentSourceStatus = row.status;

    if (row.id === "company-profile" || row.id === "work-board") status = "ready";

    if (row.mailProviderId && input.mail) {
      const provider = input.mail.providers.find((p) => p.id === row.mailProviderId);
      if (provider?.connected) status = "configured";
      else if (provider) status = "missing-credential";
    }

    if (row.analyticsProviderKey) {
      if (input.company.analyticsProvider === row.analyticsProviderKey) {
        status = input.analytics?.state === "credential-missing" ? "missing-credential" : "configured";
      } else if (row.analyticsProviderKey === "hivemind-funnel") {
        status = "ready";
      }
    }

    if (row.id === "hubspot" || row.id === "salesforce") {
      const n8n = SALES_CONTENT_SOURCE_MATRIX.find((candidate) => candidate.id === "n8n-crm-conversation-sync");
      if (n8n?.status === "optional") status = "planned";
    }

    return {
      row,
      status,
      ready: status === "ready" || status === "configured",
      detail: statusDetail(row, status),
    };
  });
}

export function salesContentMatrixGaps(statuses: SalesContentSourceRuntimeStatus[]): string[] {
  const gaps: string[] = [];
  const crmReady = statuses.some((item) => item.row.kind === "crm" && item.ready);
  const conversationReady = statuses.some((item) => item.row.kind === "conversation" && item.ready);
  const mailReady = statuses.some((item) => item.row.kind === "mail" && item.ready);
  const analyticsReady = statuses.some((item) => item.row.kind === "analytics" && item.ready);
  if (!mailReady) gaps.push("Connect a mail provider to let the machine read replies and sent outreach receipts.");
  if (!analyticsReady) gaps.push("Choose an analytics provider or use the built-in HivemindOS funnel for conversion signals.");
  if (!crmReady) gaps.push("Promote the n8n CRM sync or add a first-class CRM adapter for deal-stage revival.");
  if (!conversationReady) gaps.push("Add a call transcript adapter for objection mining from sales calls.");
  return gaps;
}
