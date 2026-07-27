export type TroubleshootingSeverity = "info" | "warning" | "critical";

export type TroubleshootingEntry = {
  id: string;
  title: string;
  area: "link" | "collector" | "brain" | "env" | "runtime" | "model" | "wallet" | "general";
  severity: TroubleshootingSeverity;
  symptoms: string[];
  checks: string[];
  fixes: string[];
  relatedRoutes?: string[];
};

export const TROUBLESHOOTING_COOKBOOK: TroubleshootingEntry[] = [
  {
    id: "dashboard-auth-missing",
    title: "Dashboard is locked or API routes return 401",
    area: "general",
    severity: "critical",
    symptoms: ["Unlock screen repeats", "API calls return Dashboard authentication is required"],
    checks: ["Run dashboard-auth status", "Confirm .env.local has dashboard auth keys"],
    fixes: ["Run dashboard-auth copy-token to recover the device token", "Run dashboard-auth reset-token if the token is lost", "Restart the dashboard after rotating auth values"],
    relatedRoutes: ["/api/auth/session", "/api/system/health"],
  },
  {
    id: "collector-unreachable",
    title: "Fleet machine is online but collector is not ready",
    area: "collector",
    severity: "critical",
    symptoms: ["Fleet shows a machine without ready collector", "Remote chat, files, or env sync fail"],
    checks: ["Open Fleet and inspect collector state", "Check the collector URL through the Link or Tailnet path", "Review the machine monitor service logs"],
    fixes: ["Run the setup repair flow for the target machine", "Restart only the HivemindOS collector service for that machine", "Keep remote Link /peer URLs intact instead of rewriting them to local loopback"],
    relatedRoutes: ["/api/fleet/discover", "/api/system/health"],
  },
  {
    id: "vault-index-stale",
    title: "Shared brain recall misses notes that exist",
    area: "brain",
    severity: "warning",
    symptoms: ["hive-brain returns old or incomplete answers", "Skills or memories are present in Obsidian but not found"],
    checks: ["Run pnpm vault:doctor", "Inspect Operations/Brain Services/Full Vault Search Index.jsonl", "Check that the configured vault path is readable"],
    fixes: ["Rebuild the full-vault search index", "Refresh shared skill sync from Brain Services", "Resolve Syncthing conflict copies before relying on stale indexes"],
    relatedRoutes: ["/api/brain/services/status", "/api/system/health"],
  },
  {
    id: "shared-env-not-syncing",
    title: "Shared env key is present locally but missing on peers",
    area: "env",
    severity: "warning",
    symptoms: ["A runtime says a provider key is missing on another machine", "hive-env-check succeeds locally but remote agents fail"],
    checks: ["Run hive-env-check KEY locally", "Check Fleet for env-sync-ready collectors", "Inspect whether peer collectors are online"],
    fixes: ["Run hive-env-add --reconcile", "Let queued sync retry when peer collectors return", "Avoid pinning raw Tailnet IPs in HIVE_ENV_TAILNET_TARGETS"],
    relatedRoutes: ["/api/env", "/api/system/health"],
  },
  {
    id: "local-model-server-off",
    title: "Local model is selected but chat fails quickly",
    area: "model",
    severity: "warning",
    symptoms: ["Fetch failed against localhost model endpoint", "LM Studio or Ollama shows a loaded model but /v1/models is unreachable"],
    checks: ["Open the model server app and verify its OpenAI-compatible server is enabled", "Check LOCAL_OPENAI_BASE_URL or the agent provider profile"],
    fixes: ["Start the LM Studio or Ollama server", "Select a reachable provider fallback", "Use Fleet model-fit recommendations to move local inference to the right machine"],
    relatedRoutes: ["/api/chat/agent-runtime", "/api/system/model-fit"],
  },
  {
    id: "wallet-action-blocked",
    title: "Wallet or x402 action prepares but does not execute",
    area: "wallet",
    severity: "info",
    symptoms: ["Action stays in approval-needed state", "Agent reports missing rail readiness"],
    checks: ["Review wallet approval queue", "Check provider readiness by key name only", "Confirm spend budget and kill switch state"],
    fixes: ["Approve the prepared action from Wallets", "Configure the missing provider rail", "Do not bypass spend gates from chat or tool output"],
    relatedRoutes: ["/api/wallet/approvals", "/api/crypto/capabilities"],
  },
];

export function searchTroubleshootingCookbook(query = "", limit = TROUBLESHOOTING_COOKBOOK.length) {
  const normalized = query.trim().toLowerCase();
  const scored = TROUBLESHOOTING_COOKBOOK.map((entry) => {
    const text = [
      entry.id,
      entry.title,
      entry.area,
      ...entry.symptoms,
      ...entry.checks,
      ...entry.fixes,
      ...(entry.relatedRoutes ?? []),
    ].join(" ").toLowerCase();
    const score = normalized
      ? normalized.split(/\s+/).filter(Boolean).reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0)
      : 1;
    return { entry, score };
  })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title));
  return scored.slice(0, limit).map((item) => item.entry);
}
