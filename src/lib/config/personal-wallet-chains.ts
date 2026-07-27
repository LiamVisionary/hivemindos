export type PersonalWalletChainOption = {
  chainKey: "base" | "solana" | "robinhood" | "base-sepolia";
  label: "Base" | "Solana" | "Robinhood Chain" | "Base Sepolia";
  network: "eip155:8453" | "solana:mainnet" | "eip155:4663" | "eip155:84532";
  create: boolean;
  addable: boolean;
};

export const MULTI_CHAIN_WALLET_LABEL = "Multi-chain (Base + Robinhood Chain + Solana)";
export const RECOVERY_PHRASE_ACCOUNT_OPTIONS = Array.from({ length: 20 }, (_, accountIndex) => ({
  accountIndex,
  label: `Account ${accountIndex + 1}`,
}));

export const PERSONAL_WALLET_CHAIN_OPTIONS: readonly PersonalWalletChainOption[] = [
  { chainKey: "base", label: "Base", network: "eip155:8453", create: true, addable: true },
  { chainKey: "robinhood", label: "Robinhood Chain", network: "eip155:4663", create: true, addable: true },
  { chainKey: "solana", label: "Solana", network: "solana:mainnet", create: true, addable: true },
  { chainKey: "base-sepolia", label: "Base Sepolia", network: "eip155:84532", create: false, addable: false },
] as const;

export const PERSONAL_WALLET_CREATE_CHAIN_LABELS = [
  MULTI_CHAIN_WALLET_LABEL,
  ...PERSONAL_WALLET_CHAIN_OPTIONS.filter((chain) => chain.create).map((chain) => chain.label),
] as const;

export const PERSONAL_WALLET_IMPORT_CHAIN_LABELS = [
  MULTI_CHAIN_WALLET_LABEL,
  ...PERSONAL_WALLET_CHAIN_OPTIONS.map((chain) => chain.label),
] as const;

export const PERSONAL_WALLET_ADDABLE_CHAINS = PERSONAL_WALLET_CHAIN_OPTIONS
  .filter((chain) => chain.addable)
  .map(({ chainKey, label }) => ({ chainKey, label }));

export function personalWalletNetworkForChainLabel(label: string): PersonalWalletChainOption["network"] {
  return PERSONAL_WALLET_CHAIN_OPTIONS.find((chain) => chain.label.toLowerCase() === label.trim().toLowerCase())?.network
    ?? "eip155:8453";
}
