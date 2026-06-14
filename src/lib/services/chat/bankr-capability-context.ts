import { bankrLlmApiKey } from "@/lib/services/bankr-llm";

/**
 * Static Bankr platform briefing, gated on a configured Bankr credential.
 *
 * The Hive capability search injects Bankr knowledge per turn, but it runs
 * under a hard preflight timeout and can drop out of the prompt entirely
 * (observed 2026-06-10: a Bankr agent could not answer "what can you do with
 * Bankr"). An agent's knowledge of the Bankr rails must not depend on a
 * latency race, so this distilled briefing is baked into the system context.
 *
 * Bankr is not provider-specific: any agent on any runtime/provider/model can
 * use it through the shared key, so the gate is credential presence (hive env
 * BANKR_* keys or the Bankr CLI config), never the agent profile. When no key
 * is set, a short instruction is injected instead so agents tell the user a
 * key is missing rather than role-playing Bankr actions. Full reference docs
 * stay retrieval-only: docs/bankr/bankr-platform-reference.md (repo) and
 * Memory/Imported Sources/Bankr Platform Documentation.md (shared vault).
 */

export const BANKR_REPO_REFERENCE_PATH = "docs/bankr/bankr-platform-reference.md";
export const BANKR_VAULT_REFERENCE_PATH = "Memory/Imported Sources/Bankr Platform Documentation.md";
const BANKR_KEY_NAMES = "BANKR_API_KEY, BANKR_LLM_KEY, or BANKR_MANAGEMENT_KEY";
const BANKR_KEY_PRESENCE_TTL_MS = 30_000;

let keyPresenceCache: { configured: boolean; checkedAt: number } | null = null;

async function bankrKeyConfigured(): Promise<boolean> {
  const now = Date.now();
  if (keyPresenceCache && now - keyPresenceCache.checkedAt < BANKR_KEY_PRESENCE_TTL_MS) {
    return keyPresenceCache.configured;
  }
  const configured = Boolean(await bankrLlmApiKey().catch(() => ""));
  keyPresenceCache = { configured, checkedAt: now };
  return configured;
}

export function clearBankrKeyPresenceCache() {
  keyPresenceCache = null;
}

/** One fact per line; reused verbatim by the context-index entry so retrieval
 *  and the baked-in briefing never drift apart. */
export const BANKR_PLATFORM_FACTS = [
  "Bankr is financial rails plus a full agent runtime for self-sustaining AI agents: every agent gets a cross-chain wallet, can launch a token, earns 57% of the 1.2% swap fee as creator, and can pay its own LLM costs from those fees (the self-funding flywheel).",
  "Wallet spans nine chains: Base (primary, most features), Ethereum, Polygon, Unichain, World Chain, Arbitrum, BNB Chain, Solana, and Hyperliquid. Gas is sponsored on Base, Polygon, Unichain, World Chain, and BNB Chain.",
  "Trading via natural language: swaps and cross-chain swaps, limit orders, stop orders, DCA, TWAP, leveraged trading (Avantis on Base; Hyperliquid perps and spot), Polymarket prediction markets (Polygon), NFT buy/sell/mint, and transfers that resolve ENS or Twitter handles.",
  "Token launching: fair launch on Base via natural language, the Bankr CLI (bankr launch), or the Deploy API; trading fees flow to the creator wallet automatically.",
  "LLM Gateway: OpenAI-compatible proxy at llm.bankr.bot routing to OpenAI, Anthropic, Google, and more. Max Mode runs premium models pay-per-token from USDC-denominated LLM credits; base model is Gemini 3 Flash with Bankr Club ($20/mo, 1,000 msgs/day). Top up with 'add $25 in LLM credits', 'bankr llm credits add 25', or auto top-up.",
  "Automations: limit/stop/DCA/TWAP/vesting-sell orders plus any recurring agent command (e.g. 'every day at 9am check ETH and send a summary'). Standard tier: 5 active automations; Bankr Club: 20.",
  "Bankr runtime extras per wallet: persistent file storage, durable memory in /.memory/, x402 paid-endpoint support (call, host, and settle pay-per-request APIs; deploy x402 endpoints from chat), an execute_cli code sandbox, installable skills from GitHub, user-level MCP servers, secure env vars, browser automation with stored credentials, and chat-built apps/dashboards.",
  "Integration surfaces: the Bankr skill (github.com/BankrBot/skills), the Bankr CLI (npm @bankr/cli; bankr login; bankr agent \"...\"), the Agent API (POST https://api.bankr.bot/agent/prompt with X-API-Key then poll /agent/job/JOB_ID), and Claude plugins (BankrBot/claude-plugins).",
] as const;

export const BANKR_HIVEMIND_INTEGRATION_FACTS = [
  "Bankr is a shared capability, not a provider feature: any agent on any runtime/provider/model can use it through the configured shared Bankr key.",
  "In HivemindOS, start crypto work at GET/POST /api/crypto/capabilities (intents: status, portfolio, trade, token-launch, polymarket, hyperliquid, automation, nft, agent-job, fund-llm-credits, paid-api, and more); it reports Bankr readiness by credential key name (BANKR_API_KEY, BANKR_LLM_KEY, BANKR_MANAGEMENT_KEY) and prepares gated request drafts.",
  "Execution paths from HivemindOS: native chat Bankr actions and POST /api/bankr/actions for Bankr wallet portfolio reads, swaps, token launches, Polymarket, Hyperliquid, recurring automations, NFT actions, and Bankr Agent API jobs; POST /api/bankr/llm-credits funds LLM credits and requires the FUND_BANKR_LLM_CREDITS confirmation.",
  "Spend discipline: start read-only (price checks, balances, portfolio, job status, market search). Swaps, token launches, transfers, Polymarket bets, Hyperliquid positions, automations, NFT mutations, and credit funding need explicit user approval of a concrete draft. Never reveal or request keys; refer to credentials by key name and set/missing status only.",
] as const;

/** Distilled Bankr briefing when a key is configured; a do-not-role-play
 *  instruction when it is not. */
export async function buildBankrCapabilityContext(): Promise<string> {
  if (!(await bankrKeyConfigured())) {
    return [
      "Bankr capability status:",
      `- No Bankr credential is configured (${BANKR_KEY_NAMES} unset in the shared hive env, and no Bankr CLI login). If the user asks for anything Bankr-related (trading, token launch, Bankr LLM credits, Bankr wallet), say a Bankr key must be added first — for example via the shared hive env or 'bankr login' — and do not role-play or claim Bankr actions.`,
    ].join("\n");
  }
  return [
    "Bankr platform capability briefing (static, always available — do not claim you lack Bankr knowledge if capability search times out):",
    ...BANKR_PLATFORM_FACTS.map((fact) => `- ${fact}`),
    ...BANKR_HIVEMIND_INTEGRATION_FACTS.map((fact) => `- ${fact}`),
    `- Full reference docs for details beyond this briefing: ${BANKR_REPO_REFERENCE_PATH} in the hivemind-os repo and ${BANKR_VAULT_REFERENCE_PATH} in the shared vault. Search them with rg/grep (pass plain args; the run_command tool has no shell, so pipes like | head do not work).`,
  ].join("\n");
}
