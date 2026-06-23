import { BUILDER_CODE_PATTERN } from "@x402/extensions/builder-code";
import type { Network } from "@x402/core/types";

export const BASE_MAINNET_NETWORK = "eip155:8453" as const;

export const X402_CLIENT_BUILDER_CODE_ENV_KEYS = [
  "HIVEMINDOS_X402_CLIENT_BUILDER_CODE",
  "HIVEMINDOS_X402_BUILDER_CODE",
] as const;

export const X402_SELLER_BUILDER_CODE_ENV_KEYS = [
  "HIVEMINDOS_PAID_AGENT_BUILDER_CODE",
  "HIVEMINDOS_X402_SELLER_BUILDER_CODE",
  "HIVEMINDOS_X402_BUILDER_CODE",
] as const;

export function normalizeX402BuilderCode(value: unknown, source = "builder code"): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!BUILDER_CODE_PATTERN.test(trimmed)) {
    throw new Error(`${source} must be 1-32 lowercase letters, digits, or underscores.`);
  }
  return trimmed;
}

export function x402BuilderCodeFromEnv(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const code = normalizeX402BuilderCode(process.env[key], key);
    if (code) return code;
  }
  return undefined;
}

export function isBaseMainnetNetwork(network: Network | string): boolean {
  return network === BASE_MAINNET_NETWORK;
}

export function x402BuilderCodeFromEnvForNetwork(network: Network | string, keys: readonly string[]): string | undefined {
  if (network !== BASE_MAINNET_NETWORK) return undefined;
  return x402BuilderCodeFromEnv(keys);
}

export function normalizeX402BuilderCodeForNetwork(
  network: Network | string,
  value: unknown,
  source = "builder code",
): string | undefined {
  if (network !== BASE_MAINNET_NETWORK) return undefined;
  return normalizeX402BuilderCode(value, source);
}
