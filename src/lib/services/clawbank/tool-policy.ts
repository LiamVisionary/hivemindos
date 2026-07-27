/**
 * Read/write classification for ClawBank's runtime-discovered MCP tools.
 *
 * The generic discovery runner (`/api/clawbank/run`) can invoke any tool the
 * account exposes. Money- and state-moving tools must pass a confirmation gate;
 * read/discovery tools may run freely. Because the catalog is dynamic, we
 * classify by name with a curated allowlist plus conservative prefixes, and
 * **default to write** (gated) for anything unrecognized — over-gating a read
 * is harmless; under-gating a write is not.
 */

/** Known read-only / discovery tools from the ClawBank MCP catalog. */
const READ_ONLY_TOOL_NAMES = new Set<string>([
  "get_me",
  "get_self_custody_wallet_address",
  "get_self_custody_token_balance",
  "get_deposit_instructions",
  "list_wallets",
  "get_balance",
  "get_offramp_status",
  "get_offramp_history",
  "discover_coms_users",
  "list_company_records",
  "read_company_record",
  "get_company_history",
  "get_trading_report",
  "get_trading_pnl",
  "list_trading_tokens",
  "get_formation_order",
  "list_formation_orders",
  "get_formation_jurisdictions",
  "get_exchange_rate",
  "list_transfers",
  "list_recipients",
  "inspect_formation_payload_schema",
  "inspect_fightclub_payload_schema",
]);

/** Prefixes that strongly indicate a read. */
const READ_PREFIXES = ["get_", "list_", "read_", "discover_", "inspect_", "fetch_"];
/** Verb prefixes that force WRITE classification, taking precedence over the
 *  read substrings below (e.g. `create_offramp_address` is a write even though
 *  it contains "address"). */
const WRITE_PREFIXES = [
  "create_", "send_", "set_", "start_", "execute_", "run_", "link_", "register_",
  "sign_", "mint_", "transfer_", "withdraw_", "pay_", "buy_", "sell_", "deploy_",
  "update_", "delete_", "remove_", "approve_", "reject_", "cancel_", "open_", "close_", "submit_", "swap_",
];
/** Substrings that indicate a read once write-prefixes are ruled out. "balance"
 *  and "address" are intentionally NOT here — they appear in both reads
 *  (get_balance) and writes (create_offramp_address); the read forms are caught
 *  by the allowlist or the read prefixes instead. */
const READ_SUBSTRINGS = ["_guide", "status", "report", "history", "_state", "exchange_rate", "jurisdiction", "pnl"];

export function isReadOnlyClawbankTool(name: string): boolean {
  const key = name.trim().toLowerCase();
  if (!key) return false;
  if (READ_ONLY_TOOL_NAMES.has(key)) return true;
  if (WRITE_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  if (key.endsWith("_guide")) return true;
  if (READ_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  if (READ_SUBSTRINGS.some((part) => key.includes(part))) return true;
  return false;
}
