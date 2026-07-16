export const MINI_APP_WALLET_BRIDGE_SOURCE = "hivemindos-mini-app-wallet";
export const MINI_APP_WALLET_BRIDGE_VERSION = 1;

const OFFICIAL_MINI_APP_ORIGINS = new Set(["https://hivemindos.app"]);
const ALLOWED_RPC_METHODS = new Set([
  "eth_requestAccounts",
  "eth_chainId",
  "wallet_switchEthereumChain",
  "personal_sign",
]);

export type MiniAppWalletRpcRequest = {
  source: typeof MINI_APP_WALLET_BRIDGE_SOURCE;
  version: typeof MINI_APP_WALLET_BRIDGE_VERSION;
  type: "wallet-rpc-request";
  requestId: string;
  method: "eth_requestAccounts" | "eth_chainId" | "wallet_switchEthereumChain" | "personal_sign";
  params?: unknown[] | Record<string, unknown>;
};

export type MiniAppWalletRpcResponse = {
  source: typeof MINI_APP_WALLET_BRIDGE_SOURCE;
  version: typeof MINI_APP_WALLET_BRIDGE_VERSION;
  type: "wallet-rpc-response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export function isOfficialMiniAppOrigin(origin: string): boolean {
  try {
    return OFFICIAL_MINI_APP_ORIGINS.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function parseMiniAppWalletRequest(value: unknown): MiniAppWalletRpcRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (request.source !== MINI_APP_WALLET_BRIDGE_SOURCE) return null;
  if (request.version !== MINI_APP_WALLET_BRIDGE_VERSION) return null;
  if (request.type !== "wallet-rpc-request") return null;
  if (typeof request.requestId !== "string" || !request.requestId.trim() || request.requestId.length > 160) return null;
  if (typeof request.method !== "string" || !ALLOWED_RPC_METHODS.has(request.method)) return null;
  if (request.params !== undefined && !Array.isArray(request.params) && (typeof request.params !== "object" || request.params === null)) return null;
  return request as MiniAppWalletRpcRequest;
}

export function miniAppWalletResponse(requestId: string, result: unknown): MiniAppWalletRpcResponse {
  return {
    source: MINI_APP_WALLET_BRIDGE_SOURCE,
    version: MINI_APP_WALLET_BRIDGE_VERSION,
    type: "wallet-rpc-response",
    requestId,
    ok: true,
    result,
  };
}

export function miniAppWalletErrorResponse(requestId: string, error: string): MiniAppWalletRpcResponse {
  return {
    source: MINI_APP_WALLET_BRIDGE_SOURCE,
    version: MINI_APP_WALLET_BRIDGE_VERSION,
    type: "wallet-rpc-response",
    requestId,
    ok: false,
    error,
  };
}

export function parsePersonalSignParams(params: unknown): { address: string; message: string } | null {
  if (!Array.isArray(params)) return null;
  const address = params.find((value) => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim()));
  const messageHex = params.find((value) => typeof value === "string" && /^0x(?:[a-fA-F0-9]{2})+$/.test(value.trim()) && value !== address);
  if (typeof address !== "string" || typeof messageHex !== "string") return null;
  try {
    const bytes = new Uint8Array(messageHex.slice(2).match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
    const message = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!message || message.length > 12_000) return null;
    return { address: address.trim(), message };
  } catch {
    return null;
  }
}
