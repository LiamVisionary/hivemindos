import "server-only";

import {
  BaseError,
  HttpRequestError,
  InternalRpcError,
  LimitExceededRpcError,
  ResourceUnavailableRpcError,
  SocketClosedError,
  TimeoutError,
  WebSocketRequestError,
  createPublicClient,
  fallback,
  getAddress,
  http,
  parseAbi,
  zeroAddress,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { tickToPrice } from "@/lib/services/trading/liquidity-range-policy";
import {
  LIQUIDITY_RANGE_NETWORK,
  type LiquidityPositionSnapshot,
  type LiquidityTokenSnapshot,
} from "@/lib/types/liquidity-range-manager";

// Confirmed against the current official Uniswap v3 Base deployment table.
export const BASE_UNISWAP_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as Address;
export const BASE_UNISWAP_V3_POSITION_MANAGER = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1" as Address;

const POSITION_MANAGER_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address owner)",
  "function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)",
]);
const FACTORY_ABI = parseAbi([
  "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)",
]);
const POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
  "function tickSpacing() view returns (int24)",
]);
const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const POSITION_READ_ATTEMPTS = 2;
const POSITION_READ_RETRY_DELAY_MS = 250;

const BASE_STABLECOINS = new Set([
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // native USDC
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", // bridged USDbC
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", // USDT
]);

type PublicClient = ReturnType<typeof createBaseLiquidityClient>;

export function createBaseLiquidityClient() {
  return createPublicClient({
    chain: base,
    transport: fallback(baseRpcUrls().map((url) => http(url, { retryCount: 1, timeout: 12_000 }))),
  });
}

export async function readBaseUniswapV3Position(
  tokenIdInput: string,
  client: PublicClient = createBaseLiquidityClient(),
): Promise<LiquidityPositionSnapshot> {
  const tokenId = parseTokenId(tokenIdInput);
  let lastError: unknown;
  for (let attempt = 0; attempt < POSITION_READ_ATTEMPTS; attempt += 1) {
    try {
      return await readBaseUniswapV3PositionOnce(tokenId, client);
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= POSITION_READ_ATTEMPTS || !isTransientReadError(error)) throw error;
      await delay(POSITION_READ_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

async function readBaseUniswapV3PositionOnce(
  tokenId: bigint,
  client: PublicClient,
): Promise<LiquidityPositionSnapshot> {
  const [position, owner, blockNumber] = await Promise.all([
    client.readContract({
      address: BASE_UNISWAP_V3_POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: "positions",
      args: [tokenId],
    }),
    client.readContract({
      address: BASE_UNISWAP_V3_POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    }),
    client.getBlockNumber(),
  ]);

  const token0Address = getAddress(position[2]);
  const token1Address = getAddress(position[3]);
  const fee = Number(position[4]);
  const tickLower = Number(position[5]);
  const tickUpper = Number(position[6]);
  const liquidity = position[7];
  const poolAddress = await client.readContract({
    address: BASE_UNISWAP_V3_FACTORY,
    abi: FACTORY_ABI,
    functionName: "getPool",
    args: [token0Address, token1Address, fee],
  });
  if (poolAddress === zeroAddress) throw new Error("The position points to a Uniswap v3 pool that is not deployed on Base.");

  const [slot0, tickSpacing, token0, token1] = await Promise.all([
    client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: "slot0" }),
    client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: "tickSpacing" }),
    readToken(client, token0Address),
    readToken(client, token1Address),
  ]);
  const currentTick = Number(slot0[1]);
  const currentPrice = tickToPrice(currentTick, token0.decimals, token1.decimals);
  const lowerPrice = tickToPrice(tickLower, token0.decimals, token1.decimals);
  const upperPrice = tickToPrice(tickUpper, token0.decimals, token1.decimals);
  const amounts = positionAmounts(liquidity, currentTick, tickLower, tickUpper, token0.decimals, token1.decimals);
  const rawPositionValueUsd = stableQuotedValue(token0, token1, currentPrice, amounts.amount0, amounts.amount1);
  const positionValueUsd = rawPositionValueUsd == null ? null : roundUsd(rawPositionValueUsd);

  return {
    network: LIQUIDITY_RANGE_NETWORK,
    protocol: "uniswap-v3",
    tokenId: tokenId.toString(),
    owner: getAddress(owner),
    positionManagerAddress: BASE_UNISWAP_V3_POSITION_MANAGER,
    factoryAddress: BASE_UNISWAP_V3_FACTORY,
    poolAddress: getAddress(poolAddress),
    token0,
    token1,
    fee,
    feePercent: fee / 10_000,
    tickSpacing: Math.abs(Number(tickSpacing)),
    currentTick,
    tickLower,
    tickUpper,
    liquidity: liquidity.toString(),
    tokensOwed0: position[10].toString(),
    tokensOwed1: position[11].toString(),
    currentPrice,
    lowerPrice,
    upperPrice,
    amount0: amounts.amount0,
    amount1: amounts.amount1,
    positionValueUsd,
    quoteLabel: `${token1.symbol} per ${token0.symbol}`,
    blockNumber: blockNumber.toString(),
    observedAt: Date.now(),
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTransientReadError(error: unknown): boolean {
  const isTransient = (candidate: unknown) => (
    candidate instanceof HttpRequestError
    || candidate instanceof InternalRpcError
    || candidate instanceof LimitExceededRpcError
    || candidate instanceof ResourceUnavailableRpcError
    || candidate instanceof SocketClosedError
    || candidate instanceof TimeoutError
    || candidate instanceof WebSocketRequestError
  );
  if (isTransient(error)) return true;
  return error instanceof BaseError && error.walk(isTransient) !== null;
}

function baseRpcUrls(): string[] {
  const configured = (process.env.BASE_RPC_URL ?? "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set([...configured, "https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://1rpc.io/base"]));
}

function parseTokenId(value: string): bigint {
  const normalized = String(value ?? "").trim();
  if (!/^\d{1,78}$/.test(normalized)) throw new Error("Enter a valid numeric Uniswap v3 position NFT ID.");
  const tokenId = BigInt(normalized);
  if (tokenId <= 0n) throw new Error("Position NFT ID must be greater than zero.");
  return tokenId;
}

async function readToken(client: PublicClient, address: Address): Promise<LiquidityTokenSnapshot> {
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }).catch(() => shortAddress(address)),
    client.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
  ]);
  return { address: getAddress(address), symbol: String(symbol).slice(0, 24), decimals: Number(decimals) };
}

export function positionAmounts(
  liquidityInput: bigint | number,
  currentTick: number,
  tickLower: number,
  tickUpper: number,
  token0Decimals: number,
  token1Decimals: number,
): { amount0: number; amount1: number } {
  const liquidity = Number(liquidityInput);
  const sqrtCurrent = Math.pow(1.0001, currentTick / 2);
  const sqrtLower = Math.pow(1.0001, tickLower / 2);
  const sqrtUpper = Math.pow(1.0001, tickUpper / 2);
  let raw0 = 0;
  let raw1 = 0;
  if (currentTick < tickLower) {
    raw0 = liquidity * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper);
  } else if (currentTick < tickUpper) {
    raw0 = liquidity * (sqrtUpper - sqrtCurrent) / (sqrtCurrent * sqrtUpper);
    raw1 = liquidity * (sqrtCurrent - sqrtLower);
  } else {
    raw1 = liquidity * (sqrtUpper - sqrtLower);
  }
  return {
    amount0: finiteOrZero(raw0 / Math.pow(10, token0Decimals)),
    amount1: finiteOrZero(raw1 / Math.pow(10, token1Decimals)),
  };
}

export function stableQuotedValue(
  token0: LiquidityTokenSnapshot,
  token1: LiquidityTokenSnapshot,
  token1PerToken0: number,
  amount0: number,
  amount1: number,
): number | null {
  if (!Number.isFinite(token1PerToken0) || token1PerToken0 <= 0) return null;
  if (BASE_STABLECOINS.has(token1.address.toLowerCase())) return amount1 + amount0 * token1PerToken0;
  if (BASE_STABLECOINS.has(token0.address.toLowerCase())) return amount0 + amount1 / token1PerToken0;
  return null;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
