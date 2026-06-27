export type AgenticInboxBlueprint = {
  id: "cloudflare-agentic-inbox";
  name: string;
  sourceUrl: string;
  summary: string;
  prerequisites: string[];
  bindings: Array<{ name: string; kind: string; purpose: string }>;
  routes: Array<{ method: string; path: string; summary: string }>;
  setupSteps: string[];
  credentialKeys: string[];
  safetyNotes: string[];
};

export const AGENTIC_INBOX_BLUEPRINT: AgenticInboxBlueprint = {
  id: "cloudflare-agentic-inbox",
  name: "Hive Inbox for Cloudflare",
  sourceUrl: "https://github.com/cloudflare/agentic-inbox",
  summary: "Self-hosted email inbox and email-agent blueprint for HivemindOS. Incoming mail is routed through Cloudflare Email Routing into an Agent/Durable Object, message and task state lives in SQLite-backed Durable Object storage, attachments belong in R2, and outgoing transactional replies use Cloudflare Email Sending.",
  prerequisites: [
    "Cloudflare account and zone for the mailbox domain",
    "Email Routing enabled for inbound addresses",
    "Email Sending enabled for the sender domain before replies are sent",
    "Wrangler configured for the target account",
  ],
  bindings: [
    { name: "INBOX_AGENT", kind: "Durable Object / Agents SDK", purpose: "One isolated mailbox agent per inbox or alias." },
    { name: "ATTACHMENTS", kind: "R2 bucket", purpose: "Store raw attachments and large MIME artifacts outside the inbox state." },
    { name: "AI", kind: "Workers AI", purpose: "Draft replies, summarize threads, and classify routing intent." },
    { name: "EMAIL", kind: "send_email binding", purpose: "Send transactional replies from onboarded domains." },
  ],
  routes: [
    { method: "POST", path: "/api/inbox/messages", summary: "List or search indexed message metadata for HivemindOS." },
    { method: "POST", path: "/api/inbox/draft", summary: "Ask the mailbox agent to draft a reply or Work Board task." },
    { method: "POST", path: "/api/inbox/approve-send", summary: "Send a reviewed draft reply through Email Sending." },
    { method: "POST", path: "/api/queen-bee", summary: "Forward actionable emails into Queen Bee as routed Work Board tasks." },
  ],
  setupSteps: [
    "Fork or scaffold a Worker from the Agentic Inbox architecture.",
    "Add Agents SDK Durable Object bindings and a new SQLite migration tag.",
    "Add an R2 bucket binding for attachments.",
    "Add a send_email binding named EMAIL after the sender domain is onboarded.",
    "Configure Email Routing to deliver selected addresses into the Worker email handler.",
    "Expose a HivemindOS route catalog so Apps & Services can discover the inbox API.",
  ],
  credentialKeys: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  safetyNotes: [
    "Do not auto-send email; draft first and require user or policy approval.",
    "Do not write message bodies into Shared Brain Memory by default; summarize only durable decisions or commitments.",
    "Treat attachments as sensitive and keep them in private Cloudflare/HivemindOS storage.",
    "Use exact mailbox/domain setup checks before deploying routes that receive real mail.",
  ],
};
