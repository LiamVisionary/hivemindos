import type { AgentPaymentProvider, AgentSpendCapAsset } from "@/lib/types/agent-wallet";

export type AgentPaymentProviderBalanceSource = "manual-ledger" | "local-wallet" | "moneyclaw" | "x402-wallet" | "usepod-runtime" | "venice-runtime";
export type AgentPaymentProviderAdvancedSection =
  | "provider"
  | "wallet-address"
  | "network-token"
  | "x402-base-url"
  | "moneyclaw-env"
  | "clawcard-env"
  | "veil-setup"
  | "veil-x402-mode"
  | "notes"
  | "copy-prompt"
  | "test-x402"
  | "usepod-status"
  | "usepod-connection"
  | "usepod-routing"
  | "usepod-repair";

export type AgentPaymentProviderAdvancedSetup = {
  sections: readonly AgentPaymentProviderAdvancedSection[];
};

export type WalletDropInGroup = "bankr" | "cards" | "crypto" | "manual" | "usepod" | "veil" | "venice" | "x402";

export type AgentPaymentProviderFeatures = {
  label: string;
  summary: string;
  setup: string;
  balanceSource: AgentPaymentProviderBalanceSource;
  addressSource: "manual" | "local-wallet" | "moneyclaw" | "usepod-deposit" | "none";
  /** Card stack the wallets drop-in view renders this provider's wallets under. */
  walletDropInGroup: WalletDropInGroup;
  localWalletRequired: boolean;
  canReceive: boolean;
  canSend: boolean;
  canRunway: boolean;
  canAutopay: boolean;
  canX402: boolean;
  privateTransferAssets: readonly AgentSpendCapAsset[];
  privateTransferEndpoint?: string;
  x402Endpoint?: string;
  advancedSetup: AgentPaymentProviderAdvancedSetup;
};

const MANUAL_ADVANCED_SECTIONS = ["provider", "wallet-address", "network-token", "notes", "copy-prompt"] as const;
const LOCAL_WALLET_ADVANCED_SECTIONS = ["provider", "wallet-address", "network-token", "x402-base-url", "notes", "copy-prompt", "test-x402"] as const;

export const AGENT_PAYMENT_PROVIDER_FEATURES = {
  bankr: {
    label: "Bankr trading",
    summary: "Broker rail for autonomous crypto and Polymarket trading once the Bankr key is reachable.",
    setup: "Store the Bankr API key in the shared/agent environment, set spending caps here, and route trades through Bankr instead of treating it as the primary wallet.",
    balanceSource: "manual-ledger",
    addressSource: "manual",
    walletDropInGroup: "bankr",
    localWalletRequired: false,
    canReceive: false,
    canSend: false,
    canRunway: true,
    canAutopay: true,
    canX402: false,
    privateTransferAssets: [],
    advancedSetup: {
      sections: ["provider", "notes", "copy-prompt"],
    },
  },
  clawcard: {
    label: "ClawCard legacy",
    summary: "Paused unless it proves a card feature that MoneyClaw does not cover.",
    setup: "Keep existing CLAWCARD_API_KEY values if you have them, but new agent wallet setup uses MoneyClaw for cards, local wallets for crypto, x402 for paid APIs, and Bankr for trading.",
    balanceSource: "manual-ledger",
    addressSource: "none",
    walletDropInGroup: "cards",
    localWalletRequired: false,
    canReceive: false,
    canSend: false,
    canRunway: true,
    canAutopay: true,
    canX402: false,
    privateTransferAssets: [],
    advancedSetup: {
      sections: ["provider", "clawcard-env", "notes", "copy-prompt"],
    },
  },
  moneyclaw: {
    label: "MoneyClaw",
    summary: "Primary card and web-payment rail for bounded checkout tasks, subscriptions, and inbox-backed payment context.",
    setup: "Store MONEYCLAW_API_KEY once through shared env. The wallet card can then inspect readiness, deposit address, balance, and recent payment tasks automatically.",
    balanceSource: "moneyclaw",
    addressSource: "moneyclaw",
    walletDropInGroup: "cards",
    localWalletRequired: true,
    canReceive: true,
    canSend: true,
    canRunway: true,
    canAutopay: true,
    canX402: true,
    privateTransferAssets: [],
    advancedSetup: {
      sections: ["provider", "wallet-address", "network-token", "x402-base-url", "moneyclaw-env", "notes", "copy-prompt", "test-x402"],
    },
  },
  x402: {
    label: "x402",
    summary: "HTTP-native pay-per-call API/resource payments with wallet-selected requirements.",
    setup: "Configure a Base/Solana wallet and enforce network, scheme, and max-amount payment policies.",
    balanceSource: "x402-wallet",
    addressSource: "local-wallet",
    walletDropInGroup: "x402",
    localWalletRequired: true,
    canReceive: true,
    canSend: true,
    canRunway: true,
    canAutopay: true,
    canX402: true,
    privateTransferAssets: [],
    advancedSetup: {
      sections: LOCAL_WALLET_ADVANCED_SECTIONS,
    },
  },
  usepod: {
    label: "UsePod prepaid",
    summary: "Prepaid Solana USDC wallet for UsePod inference, model routing, spend controls, and provider-managed x402 paywalls.",
    setup: "Register UsePod from agent settings, keep the token in HivemindOS env, fund the saved receiver, and let UsePod handle model calls and machine-native paywalls from that balance.",
    balanceSource: "usepod-runtime",
    addressSource: "usepod-deposit",
    walletDropInGroup: "usepod",
    localWalletRequired: false,
    canReceive: true,
    canSend: false,
    canRunway: true,
    canAutopay: true,
    canX402: true,
    privateTransferAssets: [],
    advancedSetup: {
      sections: ["usepod-status", "usepod-connection", "usepod-routing", "usepod-repair", "copy-prompt"],
    },
  },
  venice: {
    label: "Venice prepaid",
    summary: "Wallet-authenticated Venice AI inference: a Base or Solana wallet signs requests and spends a prepaid USDC balance held at Venice, or an API key bills a Venice account funded by card.",
    setup: "Connect or create a wallet from Venice setup in agent settings, top up the Venice balance with Base USDC over x402, and pick a model. Or save VENICE_API_KEY and buy credits with a card at venice.ai/settings/api.",
    balanceSource: "venice-runtime",
    addressSource: "local-wallet",
    walletDropInGroup: "venice",
    localWalletRequired: false,
    canReceive: true,
    canSend: false,
    canRunway: true,
    canAutopay: true,
    canX402: true,
    privateTransferAssets: [],
    advancedSetup: {
      sections: ["provider", "wallet-address", "network-token", "notes", "copy-prompt"],
    },
  },
  veil: {
    label: "Veil Cash",
    summary: "Base privacy-pool rail for private ETH and USDC sends from one agent spend balance, with shielding handled internally when possible.",
    setup: "Run Setup Veil once, keep a funded Base wallet for the agent, and let HivemindOS use ready private funds or shield from the local wallet before completing reviewed private sends.",
    balanceSource: "local-wallet",
    addressSource: "manual",
    walletDropInGroup: "veil",
    localWalletRequired: false,
    canReceive: true,
    canSend: true,
    canRunway: true,
    canAutopay: false,
    canX402: true,
    privateTransferAssets: ["USDC", "ETH"],
    privateTransferEndpoint: "/api/wallet/veil/transfer",
    x402Endpoint: "/api/wallet/veil/x402",
    advancedSetup: {
      sections: ["provider", "wallet-address", "network-token", "x402-base-url", "veil-setup", "veil-x402-mode", "notes", "copy-prompt", "test-x402"],
    },
  },
  manual: {
    label: "Manual ledger",
    summary: "Local survival accounting without an external payment rail connected yet.",
    setup: "Track seed balance, burn rate, and caps before connecting real credentials.",
    balanceSource: "manual-ledger",
    addressSource: "manual",
    walletDropInGroup: "manual",
    localWalletRequired: false,
    canReceive: false,
    canSend: false,
    canRunway: true,
    canAutopay: false,
    canX402: false,
    privateTransferAssets: [],
    advancedSetup: {
      sections: MANUAL_ADVANCED_SECTIONS,
    },
  },
} as const satisfies Record<AgentPaymentProvider, AgentPaymentProviderFeatures>;

export const AGENT_PAYMENT_PROVIDER_COPY = Object.fromEntries(
  Object.entries(AGENT_PAYMENT_PROVIDER_FEATURES).map(([provider, features]) => [
    provider,
    {
      label: features.label,
      summary: features.summary,
      setup: features.setup,
    },
  ]),
) as Record<AgentPaymentProvider, Pick<AgentPaymentProviderFeatures, "label" | "summary" | "setup">>;

export function agentPaymentProviderFeatures(provider: AgentPaymentProvider): AgentPaymentProviderFeatures {
  return AGENT_PAYMENT_PROVIDER_FEATURES[provider] ?? AGENT_PAYMENT_PROVIDER_FEATURES.manual;
}

// Adapted from elvismusli/moneyclaw: moneyclaw-skill/SKILL.md and docs/security-model.md.
export const PAYMENT_SAFETY_RULES = [
  "Use prepaid balances and bounded payment tasks by default.",
  "Confirm merchant domain, amount, and currency before any spending step.",
  "Require dashboard or human approval unless autopay is explicitly enabled within scope.",
  "Treat the payment task, not the card, as the auditable source of truth.",
  "Never fabricate billing identity, verification data, card details, or wallet balances.",
  "Inspect transaction state before retrying failed or ambiguous payment attempts.",
  "For Veil Cash, keep reviewed private sends explicit while treating shielded/private balances as internal rail state rather than user-managed wallets.",
] as const;

export const SOVEREIGN_AGENT_LAUNCH_STEPS = [
  "Create or connect the agent profile.",
  "Choose a payment provider and store credentials outside shared notes.",
  "Seed a small USDC balance and keep ETH gas separate when using Base.",
  "Set max payment, approval threshold, and daily compute burn.",
  "Generate the agent payment prompt and add it to the runtime/system context.",
  "Run the agent in survival mode: earn, conserve, or stop when the ledger reaches zero.",
] as const;
