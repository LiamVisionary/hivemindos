export const VEIL_CASH_NETWORK = "eip155:8453" as const;
export const VEIL_CASH_CHAIN_ID = 8453 as const;
export const VEIL_CASH_APP_URL = "https://www.veil.cash/app" as const;
export const VEIL_CASH_WALLET_URL = VEIL_CASH_APP_URL;
export const VEIL_CASH_DOCS_URL = "https://docs.veil.cash/" as const;
export const VEIL_CASH_SDK_PACKAGE = "@veil-cash/sdk" as const;
export const VEIL_CASH_SDK_MIN_VERSION = "0.7.0" as const;
export const VEIL_CASH_CLI = "veil" as const;
export const VEIL_CASH_MCP_PACKAGE = "@veil-cash/mcp" as const;
export const VEIL_CASH_MCP_MIN_VERSION = "0.2.1" as const;
export const VEIL_CASH_MCP_CLI = "veil-mcp" as const;
export const VEIL_CASH_TRANSFER_CONFIRMATION = "VEIL_TRANSFER" as const;
export const VEIL_CASH_TRANSFER_CONFIRMATION_LABEL = "CONFIRM" as const;
export const VEIL_CASH_X402_CONFIRMATION = "VEIL_X402" as const;
export const VEIL_CASH_DEFAULT_X402_URL = "https://x402.payai.network/api/base/paid-content" as const;
export const VEIL_CASH_DEPOSIT_FEE_BPS = 30 as const;
export const VEIL_CASH_USDC_DEPOSIT_MINIMUM = 20 as const;
export const VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM = 5 as const;
export type VeilCashTransferAsset = "USDC" | "ETH";
export const VEIL_CASH_TRANSFER_ASSETS = ["USDC", "ETH"] as const satisfies readonly VeilCashTransferAsset[];

// Adapted from veildotcash/veildotcash-sdk: src/addresses.ts.
export const VEIL_CASH_CONTRACTS = {
  entry: "0xc2535c547B64b997A4BD9202E1663deaF11c78a5",
  ethPool: "0x293dCda114533FF8f477271c5cA517209FFDEEe7",
  ethQueue: "0xA4a926A2E7a22c38e8DFC6744A61a6aA8b06B230",
  usdcPool: "0x5c50d58E49C59d112680c187De2Bf989d2a91242",
  usdcQueue: "0x5530241b24504bF05C9a22e95A1F5458888e6a9B",
  usdcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  forwarderFactory: "0x2848Fd62293A1ff3b4a897E9FcD0e5962dcc8101",
  relayUrl: "https://veil-relay.up.railway.app",
} as const;

export const VEIL_CASH_POOLS = {
  eth: {
    symbol: "ETH",
    decimals: 18,
    minimumDeposit: "0.01 ETH",
  },
  usdc: {
    symbol: "USDC",
    decimals: 6,
    minimumDeposit: "20 USDC shielded after fee",
    minimumGrossDeposit: "about 20.06 USDC including fee",
    minimumPublicWithdraw: "5 USDC",
  },
} as const;

export function veilCashExplorerUrl(address: string): string {
  return `https://basescan.org/address/${address}`;
}

export function veilCashCliQuickStart(address?: string): string {
  const signer = address?.trim() || "0xYOUR_AGENT_WALLET";
  return [
    `# Review and install ${VEIL_CASH_SDK_PACKAGE} before using the Veil CLI.`,
    `export SIGNER_ADDRESS=${signer}`,
    `${VEIL_CASH_CLI} status --json`,
    `${VEIL_CASH_CLI} register --unsigned`,
    `${VEIL_CASH_CLI} deposit USDC 20 --unsigned`,
    "# Verify chain, recipient contract, token, and amount before submitting any unsigned payload.",
  ].join("\n");
}
