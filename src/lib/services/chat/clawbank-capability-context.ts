import { clawbankConfigured } from "@/lib/services/clawbank";

/**
 * Static ClawBank platform briefing, gated on a configured ClawBank credential.
 *
 * Like the Bankr briefing, this is baked into the system context so an agent's
 * knowledge of ClawBank survives a timed-out capability search. ClawBank is not
 * provider-specific: any agent on any runtime can use it through the shared
 * credential, so the gate is credential presence (CLAWBANK_TOKEN in the shared
 * hive env, or `clawbank login`), never the agent profile. When no credential
 * is set, a short instruction is injected so agents tell the user to add one
 * rather than role-playing ClawBank actions. Full reference docs stay
 * retrieval-only: docs/clawbank/clawbank-platform-reference.md (repo) and
 * Memory/Imported Sources/ClawBank Platform Documentation.md (shared vault).
 */

export const CLAWBANK_REPO_REFERENCE_PATH = "docs/clawbank/clawbank-platform-reference.md";
export const CLAWBANK_VAULT_REFERENCE_PATH = "Memory/Imported Sources/ClawBank Platform Documentation.md";
const CLAWBANK_KEY_NAMES = "CLAWBANK_TOKEN (or CLAWBANK_API_TOKEN / CLAWBANK_API_KEY)";
const CLAWBANK_KEY_PRESENCE_TTL_MS = 30_000;

let keyPresenceCache: { configured: boolean; checkedAt: number } | null = null;

async function clawbankKeyConfigured(): Promise<boolean> {
  const now = Date.now();
  if (keyPresenceCache && now - keyPresenceCache.checkedAt < CLAWBANK_KEY_PRESENCE_TTL_MS) {
    return keyPresenceCache.configured;
  }
  const configured = await clawbankConfigured().catch(() => false);
  keyPresenceCache = { configured, checkedAt: now };
  return configured;
}

export function clearClawbankKeyPresenceCache() {
  keyPresenceCache = null;
}

/** One fact per line; reused verbatim by the context-index entry so retrieval
 *  and the baked-in briefing never drift apart. */
export const CLAWBANK_PLATFORM_FACTS = [
  "ClawBank (app.clawbank.co) is a financial + legal operating system for AI agents: one credential gives an agent a self-custody crypto wallet, KYC bank rails, off-ramp, autonomous trading, real US LLC formation, contracts, comms, and more, over REST and MCP.",
  "Two money systems, kept separate: (1) a self-custody wallet (Base + XRPL, KYC-free, auto-provisioned) for trading and on-chain transfers; (2) custodial bank rails via Bridge.xyz (KYC-required) for USD deposits, balances, and off-ramp. Only banking endpoints return bridge_customer_required.",
  "Capabilities: self-custody wallet (address, token balances, gas-sponsored USDC sends, card/Apple Pay top-up, Base↔XRPL bridge), trading (tradeable tokens, one-off spot swaps vs USDC, long-running engines with P&L), money (deposit instructions, custodial balance, on-chain transfers), off-ramp (link US bank, mint liquidation address, ACH to USD), formation (real US LLCs with on-chain payment and state filing), contracts (create/send/sign, Shodai milestone work), comms (handles, inbox, chat, email), fight clubs, and optional Wise FX.",
  "Discovery-first design: the REST docs are intentionally partial. The authoritative per-account surface is the MCP tool catalog (tools/list) plus capability guides (clawbank_*_guide) and schema inspectors (inspect_formation_payload_schema). GET /api/v1/me reports readiness flags: bridge_customer_configured, kyc_approved, trading_enabled, and wallet { address, chain, provisioned }.",
  "Auth: a long-lived API token minted via a three-step email flow (request_code → verify_code → bootstrap/api_tokens), sent as Authorization: Bearer. Interfaces: REST (/api/v1/*), MCP JSON-RPC (POST /mcp), and the clawbank CLI (npm clawbank-cli).",
] as const;

export const CLAWBANK_HIVEMIND_INTEGRATION_FACTS = [
  "ClawBank is a shared capability in HivemindOS, gated by credential presence (CLAWBANK_TOKEN in the shared hive env), not by provider. It is isolated from the shared crypto-capability-router (Bankr/x402/Veil/Hyperliquid): use the ClawBank surfaces below, not /api/crypto/capabilities.",
  "Start at GET /api/clawbank (MCP clawbank_status) for readiness, then GET /api/clawbank/run (clawbank_list_tools) to discover the live tool catalog. Typed REST routes cover the documented endpoints: /api/clawbank/wallet (address, balance, send_usdc, topup_link), /api/clawbank/trading (tokens, report, swap), /api/clawbank/money (balance, deposit, transfer), /api/clawbank/formation (jurisdictions, orders). Onboarding tokens are minted at POST /api/clawbank/auth.",
  "Everything not covered by a typed route — off-ramp, contracts, comms, records, fight clubs, Wise, trading engines, formation checkout — runs through the discovery runner POST /api/clawbank/run: read tools via clawbank_read, state-changing tools via clawbank_call.",
  "Spend discipline: read-only first (status, balances, deposit instructions, tradeable tokens, reports, guides, schema inspectors). Money- and entity-moving actions need explicit confirmation tokens: CLAWBANK_SEND_USDC (self-custody send), CONFIRM_CLAWBANK_SWAP (spot swap), CONFIRM_CLAWBANK_TRANSFER (custodial transfer), and CONFIRM_CLAWBANK_CALL (the generic write runner — used for off-ramp, formation checkout, contracts, Wise, and any other discovered write tool). Never reveal or request the credential; refer to it by key name and set/missing status only.",
] as const;

/** Distilled ClawBank briefing when a credential is configured; a
 *  do-not-role-play instruction when it is not. */
export async function buildClawbankCapabilityContext(): Promise<string> {
  if (!(await clawbankKeyConfigured())) {
    return [
      "ClawBank capability status:",
      `- No ClawBank credential is configured (${CLAWBANK_KEY_NAMES} unset in the shared hive env, and no clawbank CLI login). If the user asks for anything ClawBank-related (bank account, LLC formation, off-ramp, ClawBank wallet/trading, contracts, comms), say a ClawBank token must be added first — e.g. via the shared hive env (hive-env-add CLAWBANK_TOKEN <token>) or 'clawbank login' — and do not role-play or claim ClawBank actions.`,
    ].join("\n");
  }
  return [
    "ClawBank platform capability briefing (static, always available — do not claim you lack ClawBank knowledge if capability search times out):",
    ...CLAWBANK_PLATFORM_FACTS.map((fact) => `- ${fact}`),
    ...CLAWBANK_HIVEMIND_INTEGRATION_FACTS.map((fact) => `- ${fact}`),
    `- Full reference docs for details beyond this briefing: ${CLAWBANK_REPO_REFERENCE_PATH} in the hivemind-os repo and ${CLAWBANK_VAULT_REFERENCE_PATH} in the shared vault. Search them with rg/grep (pass plain args; the run_command tool has no shell, so pipes like | head do not work).`,
  ].join("\n");
}
