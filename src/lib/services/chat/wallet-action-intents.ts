import type { AgentWalletConfig } from "@/lib/types/agent-wallet";

export const SEND_CONFIRMATION = "SEND_USDC";

const EVM_ADDRESS = /0x[a-fA-F0-9]{40}/;
const EVM_ADDRESS_G = /0x[a-fA-F0-9]{40}/g;

export type WalletFamily = "evm" | "solana";

export function networkFamily(network: string): WalletFamily | null {
  if (network.startsWith("eip155:")) return "evm";
  if (network.startsWith("solana:")) return "solana";
  return null;
}

export function networkChainLabel(network: string): string {
  if (network === "eip155:8453") return "Base";
  if (network === "eip155:1") return "Ethereum";
  if (network.startsWith("solana:")) return "Solana";
  if (network.startsWith("eip155:")) return `EVM chain ${network.slice("eip155:".length)}`;
  return network;
}

/** What wallet a "from …" phrase points at. `personal` means an explicit "my (personal) wallet" with no address. */
export type SourceHint = { address?: string; chain?: "base" | "solana"; personal?: boolean };

export type SendRequest = { recipient: string; amountUsd: number; source: SourceHint };

/**
 * Parse a plain-language USDC send. Deliberately conservative — funds move, so a
 * draft is only produced when the recipient (explicit `to 0x…`) and amount are
 * unambiguous, and never for private/Veil ("private", "shield") or x402 (a URL)
 * phrasing, which other interceptors own.
 */
export function parseSendRequest(text: string): SendRequest | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/https?:\/\//i.test(text)) return null; // URL -> x402, not a plain send.
  if (/\b(private|privately|veil|shield|shielded)\b/i.test(lower)) return null; // -> Veil rail.
  if (!/\b(send|transfer)\b/i.test(lower)) return null;

  // Recipient must be an explicit "to 0x…".
  const toMatch = text.match(/\bto\s+(0x[a-fA-F0-9]{40})\b/i);
  if (!toMatch) return null;
  const recipient = toMatch[1];

  // Amount in USD/USDC. Only USDC is supported on this rail.
  if (/\b(eth|ether|weth|sol|btc)\b/i.test(lower) && !/\busdc?\b/i.test(lower) && !/\$/.test(text)) return null;
  const amountMatch = text.match(/\$\s*(\d+(?:\.\d{1,6})?)/)
    ?? text.match(/(\d+(?:\.\d{1,6})?)\s*(?:usdc|usd|dollars?|bucks)\b/i);
  if (!amountMatch) return null;
  const amountUsd = Number(amountMatch[1]);
  if (!(amountUsd > 0)) return null;

  return { recipient, amountUsd, source: parseSourceHint(text, recipient) };
}

/**
 * Parse a "from …" source phrase: an explicit "from 0x…" address, or "from my
 * (personal|base|solana) wallet". `excludeAddress` prevents capturing the
 * recipient as the source.
 */
export function parseSourceHint(text: string, excludeAddress?: string): SourceHint {
  const source: SourceHint = {};
  const fromAddr = text.match(/\bfrom\b[^]*?(0x[a-fA-F0-9]{40})/i);
  if (fromAddr && (!excludeAddress || fromAddr[1].toLowerCase() !== excludeAddress.toLowerCase())) {
    source.address = fromAddr[1];
  } else if (/\bfrom\s+(?:my\s+)?(?:the\s+)?(personal|base|solana|my)\b/i.test(text) || /\bfrom\s+my\s+wallet\b/i.test(text)) {
    source.personal = true;
    if (/\bbase\b/i.test(text)) source.chain = "base";
    else if (/\bsolana\b/i.test(text)) source.chain = "solana";
  }
  return source;
}

/** True when the user pointed at a specific/personal wallet or an on-chain DEX. */
export function hasLocalSwapIntent(text: string, source: SourceHint): boolean {
  return Boolean(source.address || source.personal || source.chain) || /\b(dex|0x|jupiter|on-?chain)\b/i.test(text);
}

export type WalletSourceRef = { agentId: string; address: string; network: string; isPersonal: boolean; label: string };

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

// ---- Draft message (preview) + parse-back -----------------------------------

const SEND_DRAFT_MARKER = /\*{0,2}Send ready\*{0,2}/i;

export function isSendDraftText(text: string): boolean {
  return SEND_DRAFT_MARKER.test(text);
}

export function buildSendDraftMessage(input: {
  source?: WalletSourceRef;
  recipient: string;
  amountUsd: number;
  validation?: string;
}): string {
  if (input.validation || !input.source) {
    return ["**Send unavailable**", "", input.validation || "No source wallet could be resolved.", "", "Fix this, then ask again."].join("\n");
  }
  const { source, recipient, amountUsd } = input;
  return [
    "**Send ready**",
    "",
    `From ${source.label} \`${source.address}\`${source.isPersonal ? " (personal)" : ""}`,
    `To \`${recipient}\``,
    `Network **${networkChainLabel(source.network)}**`,
    "Asset **USDC**",
    `Amount **$${amountUsd.toFixed(2)}** (1 USDC = $1)`,
    "",
    "Reply `SEND_USDC` to send. Personal wallets always require this and never auto-send.",
  ].join("\n");
}

export type SendDraft = { sourceAddress: string; recipient: string; amountUsd: number };

export function parseSendDraft(text: string): SendDraft | null {
  if (!isSendDraftText(text)) return null;
  const fromMatch = text.match(/From[^]*?\`(0x[a-fA-F0-9]{40})\`/i);
  const toMatch = text.match(/To\s+\`(0x[a-fA-F0-9]{40})\`/i);
  const amountMatch = text.match(/Amount\s+\*\*\$(\d+(?:\.\d{1,6})?)\*\*/i);
  if (!fromMatch || !toMatch || !amountMatch) return null;
  return { sourceAddress: fromMatch[1], recipient: toMatch[1], amountUsd: Number(amountMatch[1]) };
}

export function validateSend(amountUsd: number, capUsd: number | undefined): string {
  if (!(amountUsd > 0)) return "Amount must be a positive USD value.";
  if (capUsd && capUsd > 0 && amountUsd > capUsd) return `Amount exceeds the per-payment cap ($${capUsd.toFixed(2)}).`;
  return "";
}

/** Best-effort per-payment cap for the *agent's own* wallet (personal wallets have no policy). */
export function sendCapUsd(wallet?: AgentWalletConfig): number {
  return Number(wallet?.maxPaymentUsd) || 0;
}

// ---- DEX swap (local 0x on Base / Jupiter on Solana) ------------------------

// Symbol -> which chain family it implies ("any" = exists on both, e.g. USDC).
const SWAP_SYMBOL_FAMILY: Record<string, "evm" | "solana" | "any"> = {
  USDC: "any", USDT: "any", WETH: "evm", ETH: "evm", HIVE: "evm", SOL: "solana", WSOL: "solana",
};

export type SwapRequest = { sellToken: string; buyToken: string; amountHuman: number; source: SourceHint; family: WalletFamily };

/**
 * Parse a plain-language DEX swap ("swap 5 USDC to ETH from my wallet"). The
 * amount is in the *sell token's* units; a "$" amount is only accepted for a
 * stablecoin sell (USDC/USDT) since "$5 of ETH" is ambiguous. Returns null for
 * private/x402 phrasing or unknown symbols. The caller decides routing (local
 * DEX vs Bankr) via hasLocalSwapIntent.
 */
export function parseSwapRequest(text: string): SwapRequest | null {
  if (!text) return null;
  if (/https?:\/\//i.test(text)) return null;
  if (/\b(private|privately|veil|shield|shielded)\b/i.test(text)) return null;
  const m = text.match(/\b(?:swap|convert|trade)\s+(\$)?\s*([\d.]+)\s*([A-Za-z]{2,6})\s+(?:to|for|into)\s+([A-Za-z]{2,6})\b/i);
  if (!m) return null;
  const isUsd = Boolean(m[1]);
  const amountHuman = Number(m[2]);
  const sellToken = m[3].toUpperCase();
  const buyToken = m[4].toUpperCase();
  if (!(sellToken in SWAP_SYMBOL_FAMILY) || !(buyToken in SWAP_SYMBOL_FAMILY)) return null;
  if (sellToken === buyToken) return null;
  if (!(amountHuman > 0)) return null;
  const sellIsStable = sellToken === "USDC" || sellToken === "USDT";
  if (isUsd && !sellIsStable) return null; // "$5 ETH" is ambiguous — ask for a token amount.

  const sellFam = SWAP_SYMBOL_FAMILY[sellToken];
  const buyFam = SWAP_SYMBOL_FAMILY[buyToken];
  const family: WalletFamily = sellFam === "solana" || buyFam === "solana" ? "solana"
    : sellFam === "evm" || buyFam === "evm" ? "evm" : "evm";
  return { sellToken, buyToken, amountHuman, source: parseSourceHint(text), family };
}

const SWAP_DRAFT_MARKER = /\*{0,2}Swap ready\*{0,2}/i;

export function isSwapDraftText(text: string): boolean {
  return SWAP_DRAFT_MARKER.test(text);
}

export function buildSwapDraftMessage(input: {
  source?: WalletSourceRef;
  sellToken: string;
  buyToken: string;
  amountHuman: number;
  quoteLine?: string;
  maxUsd: number;
  validation?: string;
}): string {
  if (input.validation || !input.source) {
    return ["**Swap unavailable**", "", input.validation || "No source wallet could be resolved.", "", "Fix this, then ask again."].join("\n");
  }
  const { source, sellToken, buyToken, amountHuman } = input;
  return [
    "**Swap ready**",
    "",
    `From ${source.label} \`${source.address}\`${source.isPersonal ? " (personal)" : ""}`,
    `Network **${networkChainLabel(source.network)}** (${source.network.startsWith("solana:") ? "Jupiter" : "0x"})`,
    `Swap **${amountHuman} ${sellToken}** → **${buyToken}**`,
    input.quoteLine || "",
    `Hard cap **$${input.maxUsd}** per swap`,
    "",
    "Reply `CONFIRM_SWAP` to swap. Personal wallets always require this and never auto-swap.",
  ].filter(Boolean).join("\n");
}

export type SwapDraft = { sourceAddress: string; sellToken: string; buyToken: string; amountHuman: number };

export function parseSwapDraft(text: string): SwapDraft | null {
  if (!isSwapDraftText(text)) return null;
  const fromMatch = text.match(/From[^]*?\`(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\`/i);
  const swapMatch = text.match(/Swap\s+\*\*([\d.]+)\s+([A-Za-z]{2,6})\*\*\s+→\s+\*\*([A-Za-z]{2,6})\*\*/i);
  if (!fromMatch || !swapMatch) return null;
  return { sourceAddress: fromMatch[1], amountHuman: Number(swapMatch[1]), sellToken: swapMatch[2].toUpperCase(), buyToken: swapMatch[3].toUpperCase() };
}

// Re-exported for callers that match recipient addresses against text.
export { EVM_ADDRESS, EVM_ADDRESS_G };
