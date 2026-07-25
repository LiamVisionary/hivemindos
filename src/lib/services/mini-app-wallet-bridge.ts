export const MINI_APP_WALLET_BRIDGE_SOURCE = "hivemindos-mini-app-wallet";
export const MINI_APP_WALLET_BRIDGE_VERSION = 1;

const OFFICIAL_MINI_APP_ORIGINS = new Set(["https://hivemindos.app"]);
const ALLOWED_RPC_METHODS = new Set([
  "eth_requestAccounts",
  "eth_chainId",
  "wallet_switchEthereumChain",
  "personal_sign",
  "eth_sendTransaction",
  "hivemindos_requestTestnetFaucet",
]);

export type MiniAppWalletRpcRequest = {
  source: typeof MINI_APP_WALLET_BRIDGE_SOURCE;
  version: typeof MINI_APP_WALLET_BRIDGE_VERSION;
  type: "wallet-rpc-request";
  requestId: string;
  method:
    | "eth_requestAccounts"
    | "eth_chainId"
    | "wallet_switchEthereumChain"
    | "personal_sign"
    | "eth_sendTransaction"
    | "hivemindos_requestTestnetFaucet";
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

export type MiniAppTestnetFaucetRequest = {
  network: string;
  asset: string;
  recipient: string;
  idempotencyKey: string;
};

export function parseTestnetFaucetRequestParams(params: unknown): MiniAppTestnetFaucetRequest | null {
  if (!Array.isArray(params) || params.length !== 1 || !params[0] || typeof params[0] !== "object") return null;
  const input = params[0] as Record<string, unknown>;
  const network = typeof input.network === "string" ? input.network.trim().toLowerCase() : "";
  const asset = typeof input.asset === "string" ? input.asset.trim().toLowerCase() : "";
  const recipient = typeof input.recipient === "string" ? input.recipient.trim() : "";
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!/^[a-z0-9-]{1,80}$/.test(network) || !/^[a-z0-9-]{1,40}$/.test(asset)) return null;
  if (!/^[A-Za-z0-9]{20,80}$/.test(recipient)) return null;
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) return null;
  return { network, asset, recipient, idempotencyKey };
}

const ROBINHOOD_USDG_ADDRESS = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";
const MAX_MINI_APP_USDG_ATOMIC = 500_000_000n;

export function parseRobinhoodUsdgTransferParams(params: unknown): {
  from: string;
  tokenAddress: string;
  recipient: string;
  amountAtomic: string;
  amountUsdg: string;
} | null {
  if (!Array.isArray(params) || params.length !== 1 || !params[0] || typeof params[0] !== "object") return null;
  const transaction = params[0] as Record<string, unknown>;
  const from = typeof transaction.from === "string" ? transaction.from.trim().toLowerCase() : "";
  const tokenAddress = typeof transaction.to === "string" ? transaction.to.trim().toLowerCase() : "";
  const data = typeof transaction.data === "string" ? transaction.data.trim().toLowerCase() : "";
  const value = transaction.value === undefined ? "0x0" : String(transaction.value).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(from) || tokenAddress !== ROBINHOOD_USDG_ADDRESS) return null;
  if (value !== "0x0" && value !== "0x" && !/^0x0+$/.test(value)) return null;
  if (!data.startsWith(ERC20_TRANSFER_SELECTOR) || !/^0x[0-9a-f]{136}$/.test(data)) return null;
  const recipient = `0x${data.slice(34, 74)}`;
  const amount = BigInt(`0x${data.slice(74, 138)}`);
  if (!/^0x[0-9a-f]{40}$/.test(recipient) || amount <= 0n || amount > MAX_MINI_APP_USDG_ATOMIC) return null;
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return {
    from,
    tokenAddress,
    recipient,
    amountAtomic: amount.toString(),
    amountUsdg: fraction ? `${whole}.${fraction}` : whole.toString(),
  };
}
