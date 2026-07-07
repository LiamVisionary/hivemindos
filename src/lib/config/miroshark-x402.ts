export const MIROSHARK_X402_SIMULATION_PRICE_USD = 1.2;
export const MIROSHARK_X402_HIVEMINDOS_CUT_USD = 0.2;
export const MIROSHARK_X402_UPSTREAM_BASE_URL = "https://x402.miroshark.xyz";
export const HIVEMINDOS_MIROSHARK_X402_PROXY_BASE_URL = "https://hivemindos-paid-agent-gateway.hivemindos.workers.dev/api/miroshark/x402";

export function formatMiroSharkX402Usd(value: number = MIROSHARK_X402_SIMULATION_PRICE_USD) {
  return `$${value.toFixed(2)}`;
}

export const MIROSHARK_X402_SIMULATION_PRICE_LABEL = `${formatMiroSharkX402Usd()} USDC`;
