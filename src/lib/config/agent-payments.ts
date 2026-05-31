export const AGENT_PAYMENT_PROVIDER_COPY = {
  bankr: {
    label: "Bankr trading",
    summary: "Broker rail for autonomous crypto and Polymarket trading once the Bankr key is reachable.",
    setup: "Store the Bankr API key in the shared/agent environment, set spending caps here, and route trades through Bankr instead of treating it as the primary wallet.",
  },
  clawcard: {
    label: "ClawCard legacy",
    summary: "Paused unless it proves a card feature that MoneyClaw does not cover.",
    setup: "Keep existing CLAWCARD_API_KEY values if you have them, but new agent wallet setup uses MoneyClaw for cards, local wallets for crypto, x402 for paid APIs, and Bankr for trading.",
  },
  moneyclaw: {
    label: "MoneyClaw",
    summary: "Primary card and web-payment rail for bounded checkout tasks, subscriptions, and inbox-backed payment context.",
    setup: "Store MONEYCLAW_API_KEY once through shared env. The wallet card can then inspect readiness, deposit address, balance, and recent payment tasks automatically.",
  },
  x402: {
    label: "x402",
    summary: "HTTP-native pay-per-call API/resource payments with wallet-selected requirements.",
    setup: "Configure a Base/Solana wallet and enforce network, scheme, and max-amount payment policies.",
  },
  usepod: {
    label: "UsePod prepaid",
    summary: "Prepaid USDC balance for UsePod inference tokens, funded through the token deposit address.",
    setup: "Register UsePod from agent settings, keep USEPOD_TOKEN in shared env, and send Solana USDC to the saved deposit address.",
  },
  manual: {
    label: "Manual ledger",
    summary: "Local survival accounting without an external payment rail connected yet.",
    setup: "Track seed balance, burn rate, and caps before connecting real credentials.",
  },
} as const;

// Adapted from elvismusli/moneyclaw: moneyclaw-skill/SKILL.md and docs/security-model.md.
export const PAYMENT_SAFETY_RULES = [
  "Use prepaid balances and bounded payment tasks by default.",
  "Confirm merchant domain, amount, and currency before any spending step.",
  "Require dashboard or human approval unless autopay is explicitly enabled within scope.",
  "Treat the payment task, not the card, as the auditable source of truth.",
  "Never fabricate billing identity, verification data, card details, or wallet balances.",
  "Inspect transaction state before retrying failed or ambiguous payment attempts.",
] as const;

export const SOVEREIGN_AGENT_LAUNCH_STEPS = [
  "Create or connect the agent profile.",
  "Choose a payment provider and store credentials outside shared notes.",
  "Seed a small USDC balance and keep ETH gas separate when using Base.",
  "Set max payment, approval threshold, and daily compute burn.",
  "Generate the agent payment prompt and add it to the runtime/system context.",
  "Run the agent in survival mode: earn, conserve, or stop when the ledger reaches zero.",
] as const;
