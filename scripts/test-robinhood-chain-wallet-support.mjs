#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function contains(source, needle, label) {
  assert(source.includes(needle), label || `Expected source to include ${needle}`);
}

function matches(source, pattern, label) {
  assert(pattern.test(source), label || `Expected source to match ${pattern}`);
}

const chainWallet = read("src/lib/services/wallet/chain-wallet.ts");
contains(chainWallet, 'network: "eip155:4663"', "recovery-phrase imports must create a Robinhood Chain wallet");
contains(chainWallet, 'label: "Robinhood Chain"', "Robinhood Chain wallet label must be user-facing");
contains(chainWallet, 'symbol === "USDC" || input.symbol === "USDG" ? 1', "USDG balances must be valued as dollar-stable");
contains(chainWallet, "export async function sendUsdStable", "stablecoin sends must use the chain-aware send helper");
contains(chainWallet, "const stable = evmUsdToken(network)", "Robinhood Chain stable sends must resolve the EVM dollar token by network");
contains(chainWallet, "assetSymbol: stable.symbol", "Robinhood Chain stable sends must report USDG instead of USDC");

const createRoute = read("src/app/api/wallet/create/route.ts");
const importRoute = read("src/app/api/wallet/import/route.ts");
contains(createRoute, "primaryTokenSymbol(wallet.network)", "wallet creation must persist the right primary stable token per network");
contains(importRoute, "primaryTokenSymbol(wallet.network)", "wallet import must persist the right primary stable token per network");
contains(createRoute, 'if (network === "eip155:4663") return "USDG"', "wallet creation must default Robinhood Chain to USDG");
contains(importRoute, 'if (network === "eip155:4663") return "USDG"', "wallet import must default Robinhood Chain to USDG");

const governedSend = read("src/lib/services/wallet/governed-send.ts");
contains(governedSend, "sendUsdStable", "governed sends must call the chain-aware stablecoin helper");
contains(governedSend, 'assetSymbol: "USDC" | "USDG"', "governed send result must report USDC/USDG");
contains(governedSend, "asset: result.assetSymbol", "spend ledger must record the actual stablecoin sent");
contains(governedSend, 'return network === "eip155:4663" ? "USDG" : "USDC"', "send governance must evaluate USDG on Robinhood Chain");

const sendRoute = read("src/app/api/wallet/send/route.ts");
contains(sendRoute, "assetSymbol", "wallet send API must return the actual stablecoin symbol");
contains(sendRoute, "Failed to send stablecoin", "wallet send API errors must not imply USDC-only support");

const dexSwap = read("src/lib/services/trading/dex-swap.ts");
contains(dexSwap, "ROBINHOOD_CORE_TOKENS", "DEX swap rail must import Robinhood Chain core tokens");
contains(dexSwap, "const ROBINHOOD_TOKENS", "DEX swap rail must expose Robinhood Chain token choices");
contains(dexSwap, "export const SWAP_TOKENS_ROBINHOOD", "DEX token list must be exported for the UI");
contains(dexSwap, "return network === \"eip155:4663\" ? ROBINHOOD_CHAIN.chainId : 8453", "0x swaps must use Robinhood Chain ID 4663");
contains(dexSwap, "zeroExFetch(`/swap/permit2/price?chainId=${evmChainId(network)}", "0x price calls must be network-aware");
contains(dexSwap, "zeroExFetch(`/swap/permit2/quote?chainId=${evmChainId(network)}", "0x quote calls must be network-aware");
contains(dexSwap, 'throw new Error("Local DEX swaps support Base, Robinhood Chain, and Solana wallets.")', "unsupported-swap copy must name Robinhood Chain");
assert(!dexSwap.includes("BASE_CHAIN_ID"), "DEX swap rail should not retain the old Base-only chain constant");

const tradeApi = read("src/features/dashboard/views/trade/trade-api.ts");
contains(tradeApi, "SWAP_TOKENS_ROBINHOOD", "Trade API must publish Robinhood Chain swap tokens");
contains(tradeApi, '"USDG"', "Trade API Robinhood list must start from USDG");
contains(tradeApi, "network?: string", "Trade API swap calls must pass the acting network");

const tradePanel = read("src/features/dashboard/views/trade/TradePanel.tsx");
contains(tradePanel, "SWAP_TOKENS_ROBINHOOD", "Trade panel must select Robinhood Chain token choices");
contains(tradePanel, 'if (network === "eip155:4663") return SWAP_TOKENS_ROBINHOOD', "Trade panel must switch token lists by network");

const cryptoTicket = read("src/components/trade/CryptoTicket.tsx");
contains(cryptoTicket, 'tokens.includes("USDG") ? "USDG" : "USDC"', "Crypto ticket must use USDG as the Robinhood stable token");
contains(cryptoTicket, 'return "0x · Robinhood Chain"', "Crypto ticket must label the Robinhood 0x route");
matches(cryptoTicket, /runDexSwap\(\{[\s\S]*\bnetwork\b[\s\S]*\}\)/m, "Crypto ticket must send the acting network to the swap route");

const capabilityRail = read("src/components/trade/CapabilityRail.tsx");
contains(capabilityRail, 'if (network === "eip155:4663") return "Robinhood Chain"', "Trade rail receive copy must label Robinhood Chain deposits correctly");
contains(capabilityRail, "walletNetworkLabel(wallet.network)", "Trade rail receive copy must use network-specific labels");

const walletPanel = read("src/features/dashboard/views/WalletPanel.tsx");
contains(walletPanel, 'return String(network || "").toLowerCase() === "eip155:4663" ? "USDG" : "USDC"', "Wallet panel must resolve Robinhood Chain stable sends to USDG");
contains(walletPanel, "resolvePersonalWalletAgentIdForAsset", "Grouped personal wallets must resolve the correct chain account by stable asset");
contains(walletPanel, "MULTI_CHAIN_WALLET_LABEL", "Wallet creation must use the canonical multi-chain option");
contains(read("src/lib/config/personal-wallet-chains.ts"), 'MULTI_CHAIN_WALLET_LABEL = "Multi-chain (Base + Robinhood Chain + Solana)"', "Wallet creation copy must name Robinhood Chain");

const walletPickables = read("src/features/dashboard/views/trade/wallet-pickables.ts");
contains(walletPickables, '"eip155:4663"', "x402-capable wallet picker must include Robinhood Chain");
contains(walletPickables, "Use a Base, Robinhood Chain, or Solana wallet", "unsupported x402 copy must include Robinhood Chain");

const x402AgentFetch = read("src/lib/services/wallet/x402-agent-fetch.ts");
contains(x402AgentFetch, '"eip155:4663"', "x402 executor must allow Robinhood Chain");
contains(x402AgentFetch, 'return network === "eip155:4663" ? "USDG" : "USDC"', "x402 fee/spend accounting must use USDG on Robinhood Chain");

const modelsWalletRoute = read("src/app/api/hivemindos/models/wallet/route.ts");
contains(modelsWalletRoute, '"eip155:4663"', "HivemindOS Models funding wallets must support Robinhood Chain");
contains(modelsWalletRoute, 'return network === "eip155:4663" ? "USDG" : "USDC"', "HivemindOS Models wallet records must use USDG on Robinhood Chain");

const walletActionIntents = read("src/lib/services/chat/wallet-action-intents.ts");
contains(walletActionIntents, '"robinhood"', "chat wallet intents must parse Robinhood Chain source hints");
contains(walletActionIntents, "supportedRobinhoodStockTickers", "chat stock intents must recognize Robinhood Chain Stock Token tickers");
contains(walletActionIntents, 'return network === "eip155:4663" ? "USDG" : "USDC"', "chat send drafts must display the acting chain stablecoin");

const docs = [
  "docs/for-users/features/wallets-honey-and-x402.md",
  "docs/for-users/trading/index.md",
  "docs/for-users/trading/crypto.md",
  "docs/for-users/trading/stocks.md",
  "docs/for-users/trading/agent-access.md",
  "docs/for-investors/index.md",
  "docs/for-investors/ecosystem-plan.md",
].map(read).join("\n");
contains(docs, "Robinhood Chain", "docs must name Robinhood Chain");
contains(docs, "USDG", "docs must explain Robinhood Chain USDG");
contains(docs, "tokenized stock", "investor/user copy must present the tokenized-stock surface");

console.log("Robinhood Chain wallet/support checks passed.");
