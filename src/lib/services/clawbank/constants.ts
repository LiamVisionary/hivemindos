/**
 * Confirmation tokens for ClawBank money- and state-moving actions.
 *
 * Mirrors the repo convention (SEND_USDC, CONFIRM_SWAP, …): every spend or
 * legal-entity-creating action requires the human/agent to supply the exact
 * token. Defined once here and imported by the routes; the MCP catalog uses the
 * matching literals (kept in sync by tests).
 */
export const CLAWBANK_CONFIRM = {
  /** Self-custody USDC transfer (gas-sponsored, on Base). */
  SEND_USDC: "CLAWBANK_SEND_USDC",
  /** One-off spot swap against USDC from the self-custody wallet. */
  SWAP: "CONFIRM_CLAWBANK_SWAP",
  /** On-chain USDC transfer from the custodial (Bridge) wallet. */
  MONEY_TRANSFER: "CONFIRM_CLAWBANK_TRANSFER",
  /** Generic discovery runner invoking any non-read MCP tool. Today this is the
   *  active gate for off-ramp, formation checkout, contracts, comms, fight
   *  clubs, and Wise (their bodies are discovery-only — no typed route yet). */
  CALL: "CONFIRM_CLAWBANK_CALL",
  /** Reserved for a future dedicated off-ramp route (link bank / mint
   *  liquidation address / withdraw to USD). Not wired today — off-ramp runs
   *  through the generic runner ({@link CALL}). */
  OFFRAMP: "CONFIRM_CLAWBANK_OFFRAMP",
  /** Reserved for a future dedicated LLC-formation-checkout route (real state
   *  filing + on-chain payment). Not wired today — formation checkout runs
   *  through the generic runner ({@link CALL}). */
  FORMATION: "CONFIRM_CLAWBANK_FORMATION",
} as const;

export type ClawbankConfirmToken = (typeof CLAWBANK_CONFIRM)[keyof typeof CLAWBANK_CONFIRM];
