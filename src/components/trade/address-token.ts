export const EVM_TOKEN_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
export const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isTokenAddressInput(value: string, network: string): boolean {
  return network.startsWith("solana") ? SOLANA_MINT_RE.test(value) : EVM_TOKEN_ADDRESS_RE.test(value);
}

export function shortToken(value: string): string {
  return value.length > 12 && (EVM_TOKEN_ADDRESS_RE.test(value) || SOLANA_MINT_RE.test(value))
    ? `${value.slice(0, 6)}…${value.slice(-4)}`
    : value;
}

export function sameToken(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function addressTokenKey(network: string, address: string): string {
  const normalizedAddress = network.startsWith("solana") ? address.trim() : address.trim().toLowerCase();
  return `${network}:${normalizedAddress}`;
}
