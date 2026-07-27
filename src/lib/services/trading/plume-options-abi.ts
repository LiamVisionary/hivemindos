import { parseAbi } from "viem";

/** Frozen public surface from Plume docs/INTERFACES.md at the pinned registry commit. */
export const PLUME_MARKET_ABI = parseAbi([
  "function writeAndList(uint128 strike, uint40 expiry, uint256 amount, uint128 premiumPerOption) external returns (uint256 offerId)",
  "function cancelOffer(uint256 offerId, uint256 amount) external",
  "function buyToClose(bytes32 seriesId, uint256 amount) external",
  "function reclaim(bytes32 seriesId) external",
  "function buy(uint256 offerId, uint256 amount) external",
  "function exercise(bytes32 seriesId, uint256 amount) external",
  "function redeem(bytes32 seriesId, uint256 amount) external",
  "function settle(bytes32 seriesId, uint80 roundId) external",
  "function settleWorthlessFallback(bytes32 seriesId) external",
  "function series(bytes32 seriesId) external view returns (uint128 strike, uint40 expiry, bool settled, uint128 payoutPerOption, uint256 totalOutstanding)",
  "function seriesToken(bytes32 seriesId) external view returns (address)",
  "function offers(uint256 offerId) external view returns (address writer, bytes32 seriesId, uint128 premiumPerOption, uint128 remaining)",
  "function writerState(bytes32 seriesId, address writer) external view returns (uint256 unassignedOutstanding, uint256 assignedSoFar, uint256 releasedCollateral)",
  "function maxCollateral() external view returns (uint256)",
  "function totalLocked() external view returns (uint256)",
  "function seriesIdFor(uint128 strike, uint40 expiry) external pure returns (bytes32)",
  "function underlying() external view returns (address)",
  "function quote() external view returns (address)",
  "function feed() external view returns (address)",
  "function underlyingDecimals() external view returns (uint8)",
  "function quoteDecimals() external view returns (uint8)",
  "function feedDecimals() external view returns (uint8)",
  "function premiumFeeBps() external view returns (uint16)",
  "function settlementFeeBps() external view returns (uint16)",
  "function nextOfferId() external view returns (uint256)",
  "event SeriesCreated(bytes32 indexed seriesId, uint128 strike, uint40 expiry)",
  "event Written(bytes32 indexed seriesId, uint256 indexed offerId, address indexed writer, uint256 amount, uint128 premiumPerOption)",
  "event OfferCancelled(uint256 indexed offerId, uint256 amount)",
  "event Bought(bytes32 indexed seriesId, uint256 indexed offerId, address indexed buyer, uint256 amount, uint256 premiumPaid)",
  "event Exercised(bytes32 indexed seriesId, address indexed holder, uint256 amount, uint256 price, uint256 payout)",
  "event BoughtToClose(bytes32 indexed seriesId, address indexed writer, uint256 amount, uint256 collateralReleased)",
  "event Settled(bytes32 indexed seriesId, uint256 settlementPrice, uint128 payoutPerOption)",
  "event SettledWorthlessFallback(bytes32 indexed seriesId)",
  "event Redeemed(bytes32 indexed seriesId, address indexed holder, uint256 amount, uint256 paid)",
  "event Reclaimed(bytes32 indexed seriesId, address indexed writer, uint256 returned)",
]);

export const PLUME_ERC20_ABI = parseAbi([
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
]);

export const PLUME_FEED_ABI = parseAbi([
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) external view returns (uint80 id, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
]);
