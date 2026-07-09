import type { AnalyticsProviderKey, AnalyticsSummaryResult } from "@/lib/services/company-analytics/types";
import type { MailProviderId, CompanyEmailThread, CompanyEmailThreadsResult } from "@/lib/services/agent-mailboxes";

export type SalesContentSourceKind =
  | "company"
  | "work"
  | "crm"
  | "conversation"
  | "mail"
  | "calendar"
  | "social"
  | "analytics"
  | "creative"
  | "automation";

export type SalesContentSourceStatus = "ready" | "configured" | "missing-credential" | "planned" | "optional" | "unavailable";

export type SalesContentSideEffect = "none" | "send-email" | "post-social" | "write-crm" | "schedule-meeting" | "spend-money";

export type SalesContentSourceCapability =
  | "read-products"
  | "read-work"
  | "read-threads"
  | "send-mail"
  | "read-deals"
  | "write-deals"
  | "read-transcripts"
  | "read-social"
  | "post-social"
  | "read-analytics"
  | "generate-image"
  | "generate-video"
  | "schedule-workflows";

export type SalesContentSourceId =
  | "company-profile"
  | "work-board"
  | "agentmail"
  | "cloudflare-agentic-inbox"
  | "maps-agency-outbox"
  | "hivemind-funnel"
  | "posthog"
  | "plausible"
  | "ga4"
  | "x-api"
  | "hive-pulse"
  | "youtube"
  | "tiktok"
  | "slack"
  | "linear"
  | "n8n-crm-conversation-sync"
  | "hubspot"
  | "salesforce"
  | "pipedrive"
  | "granola"
  | "gong"
  | "fireflies"
  | "runtime-image-generation"
  | "runtime-video-generation";

export type SalesContentSourceMatrixRow = {
  id: SalesContentSourceId;
  label: string;
  kind: SalesContentSourceKind;
  status: SalesContentSourceStatus;
  capabilities: SalesContentSourceCapability[];
  sideEffects: SalesContentSideEffect[];
  credentialEnvKeys?: string[];
  connectionProviderKey?: string;
  analyticsProviderKey?: AnalyticsProviderKey;
  mailProviderId?: MailProviderId;
  mcpServerId?: string;
  runtimeIntegrationKey?: string;
  skillSlug?: string;
  evidence: string;
  gate?: string;
};

export type SalesContentEntity = {
  type: "company" | "lead" | "contact" | "deal" | "thread" | "asset" | "page" | "source" | "unknown";
  id?: string;
  label?: string;
};

export type SalesContentEventKind =
  | "company.product_catalog_ready"
  | "company.product_catalog_missing"
  | "mail.thread_sent"
  | "mail.thread_queued"
  | "mail.reply_received"
  | "analytics.conversion"
  | "analytics.traffic_signal"
  | "analytics.unconfigured"
  | "crm.deal_stalled"
  | "conversation.objection"
  | "creative.asset_ready"
  | "social.topic_signal"
  | "work.deliverable_ready";

export type SalesContentEvent = {
  id: string;
  companyId: string;
  sourceId: SalesContentSourceId;
  kind: SalesContentEventKind;
  occurredAt: string;
  title: string;
  summary: string;
  confidence: number;
  entity: SalesContentEntity;
  evidence: string[];
  payload?: Record<string, unknown>;
};

export type SalesContentSignalKind =
  | "respond-to-reply"
  | "unblock-queued-outreach"
  | "review-pricing-evidence"
  | "ship-follow-up"
  | "produce-case-study"
  | "produce-ad-creative"
  | "publish-social-post"
  | "wire-source";

export type SalesContentSignal = {
  id: string;
  companyId: string;
  kind: SalesContentSignalKind;
  title: string;
  summary: string;
  score: number;
  confidence: number;
  sourceEventIds: string[];
  evidence: string[];
  suggestedRole: "Growth" | "Research" | "Designer" | "Product" | "Engineer" | "Queen";
  approvalRequired: boolean;
};

export type SalesContentActionKind =
  | "draft-reply"
  | "draft-follow-up"
  | "pricing-review"
  | "creative-brief"
  | "case-study"
  | "source-setup"
  | "social-draft";

export type SalesContentAction = {
  id: string;
  companyId: string;
  kind: SalesContentActionKind;
  title: string;
  body: string;
  role: SalesContentSignal["suggestedRole"];
  priority: "high" | "medium" | "low";
  sourceSignalIds: string[];
  skills: string[];
  approvalRequired: boolean;
  workBoardPrompt: string;
};

export type SalesContentSourceRuntimeStatus = {
  row: SalesContentSourceMatrixRow;
  status: SalesContentSourceStatus;
  detail: string;
  ready: boolean;
};

export type SalesContentMachineResult = {
  companyId: string;
  generatedAt: string;
  sources: SalesContentSourceRuntimeStatus[];
  events: SalesContentEvent[];
  signals: SalesContentSignal[];
  actions: SalesContentAction[];
  gaps: string[];
  dispatchContext: string;
  diagnostics: {
    persistedEventCount: number;
    derivedEventCount: number;
    mail?: Pick<CompanyEmailThreadsResult, "configured" | "detail" | "truncated">;
    analytics?: Pick<AnalyticsSummaryResult, "ok" | "state"> & { providerLabel?: string; error?: string };
  };
};

export type SalesContentDerivedInputs = {
  mail?: CompanyEmailThreadsResult | null;
  analytics?: AnalyticsSummaryResult | null;
  now?: Date;
};

export type SalesContentMailThread = Pick<
  CompanyEmailThread,
  "id" | "provider" | "providerLabel" | "threadId" | "subject" | "preview" | "body" | "direction" | "labels" | "correspondents" | "updatedAt" | "sentAt" | "links"
>;
