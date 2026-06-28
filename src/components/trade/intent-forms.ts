/* intent-forms.ts — the structured "Build" forms for each crypto capability,
   ported from the drop-in's TR_INTENT_FORMS and keyed to the REAL intent ids
   (CRYPTO_INTENTS). Each capability detail offers a manual structured form
   (Build) and a free-form composer (Ask hive); both drive the real
   crypto-capability router. Intents the router takes as structured params
   (send / private transfer / paid-api / fund-credits) map their fields straight
   through; the natural-language intents (swap-across-chains, bridge, perps,
   prediction, launch, NFT, automation, cross-chain pay) compose their fields into
   the prompt the router executes. */

export type IntentFieldDef = {
  k: string;
  t: "text" | "address" | "amount" | "select" | "chain";
  label: string;
  opts?: string[];
  def?: string;
  unit?: string;
  ph?: string;
  chips?: number[];
};
export type IntentFormDef = { run: string; fields: IntentFieldDef[] };

export const TR_CHAINS = ["Base", "Arbitrum", "Optimism", "Polygon", "Solana", "Ethereum"];
export const TR_TOKENS_LIST = ["USDC", "ETH", "cbBTC", "SOL", "HYPE", "HIVE"];

export const INTENT_FORMS: Record<string, IntentFormDef> = {
  "crosschain-swap": { run: "Review swap", fields: [
    { k: "from", t: "select", label: "From asset", opts: TR_TOKENS_LIST, def: "USDC" },
    { k: "amt", t: "amount", label: "Amount", unit: "token" },
    { k: "fchain", t: "chain", label: "From chain", def: "Base" },
    { k: "to", t: "select", label: "To asset", opts: TR_TOKENS_LIST, def: "SOL" },
    { k: "tchain", t: "chain", label: "To chain", def: "Solana" } ] },
  bridge: { run: "Bridge", fields: [
    { k: "asset", t: "select", label: "Asset", opts: TR_TOKENS_LIST, def: "ETH" },
    { k: "amt", t: "amount", label: "Amount", unit: "token" },
    { k: "from", t: "chain", label: "From chain", def: "Base" },
    { k: "to", t: "chain", label: "To chain", def: "Arbitrum" } ] },
  hyperliquid: { run: "Submit order", fields: [
    { k: "mkt", t: "text", label: "Market", ph: "ETH-PERP or HYPE" },
    { k: "side", t: "select", label: "Side", opts: ["Long", "Short", "Spot buy", "Spot sell"] },
    { k: "size", t: "amount", label: "Size", unit: "USD" },
    { k: "lev", t: "select", label: "Leverage", opts: ["1x", "2x", "3x", "5x", "10x"] } ] },
  polymarket: { run: "Place bet", fields: [
    { k: "mkt", t: "text", label: "Market", ph: "Fed cut by September?" },
    { k: "side", t: "select", label: "Outcome", opts: ["Yes", "No"] },
    { k: "amt", t: "amount", label: "Stake", unit: "USDC" } ] },
  "token-launch": { run: "Launch token", fields: [
    { k: "name", t: "text", label: "Token name", ph: "HIVE BEE" },
    { k: "tick", t: "text", label: "Ticker", ph: "BEE" },
    { k: "supply", t: "text", label: "Supply", ph: "1,000,000,000" } ] },
  "claim-fees": { run: "Review claim", fields: [
    { k: "token", t: "text", label: "Token", ph: "ticker or contract address" },
    { k: "act", t: "select", label: "Action", opts: ["Claim fees", "Check claimable", "Claim fee NFT"], def: "Claim fees" } ] },
  nft: { run: "Submit", fields: [
    { k: "col", t: "text", label: "Collection", ph: "contract address or name" },
    { k: "act", t: "select", label: "Action", opts: ["Buy floor", "Make offer", "Mint"] },
    { k: "max", t: "amount", label: "Max spend", unit: "USD" } ] },
  automation: { run: "Schedule", fields: [
    { k: "strat", t: "select", label: "Strategy", opts: ["DCA", "TWAP", "Limit", "Stop-loss"] },
    { k: "asset", t: "select", label: "Asset", opts: TR_TOKENS_LIST, def: "ETH" },
    { k: "amt", t: "amount", label: "Amount", unit: "USD" },
    { k: "freq", t: "select", label: "Frequency", opts: ["Hourly", "Daily", "Weekly"] } ] },
  send: { run: "Review send", fields: [
    { k: "to", t: "address", label: "Recipient", ph: "0x… or name.eth" },
    { k: "amt", t: "amount", label: "Amount", unit: "USDC" } ] },
  "private-transfer": { run: "Review private send", fields: [
    { k: "asset", t: "select", label: "Asset", opts: ["USDC", "ETH"], def: "USDC" },
    { k: "amt", t: "amount", label: "Amount", unit: "token" },
    { k: "to", t: "address", label: "Recipient", ph: "0x…" } ] },
  "crosschain-payment": { run: "Review payment", fields: [
    { k: "to", t: "address", label: "Recipient", ph: "0x…" },
    { k: "amt", t: "amount", label: "Amount", unit: "USDC" },
    { k: "pchain", t: "chain", label: "Pay from chain", def: "Base" },
    { k: "rchain", t: "chain", label: "Recipient chain", def: "Polygon" } ] },
  "paid-api": { run: "Review call", fields: [
    { k: "url", t: "text", label: "Endpoint URL", ph: "https://api.example.com/resource" },
    { k: "method", t: "select", label: "Method", opts: ["GET", "POST", "PUT", "DELETE"] },
    { k: "max", t: "amount", label: "Max cost", unit: "USD" } ] },
  "private-paid-api": { run: "Review private call", fields: [
    { k: "url", t: "text", label: "Endpoint URL", ph: "https://api.example.com/resource" },
    { k: "method", t: "select", label: "Method", opts: ["GET", "POST", "PUT", "DELETE"] },
    { k: "max", t: "amount", label: "Max cost", unit: "USD" } ] },
  "fund-llm-credits": { run: "Fund credits", fields: [
    { k: "amt", t: "amount", label: "Amount", unit: "USD", chips: [10, 20, 50, 100] },
    { k: "token", t: "select", label: "Pay with", opts: ["USDC", "USDT", "ETH", "HIVE"], def: "USDC" } ] },
};

/** Default field values for a form (used to seed the Build form). Chain fields
 *  are clamped to a chain the user actually holds (`chainOpts`) so the form never
 *  seeds a chain that isn't in the filtered dropdown. */
export function initFormValues(form?: IntentFormDef, chainOpts?: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  if (!form) return values;
  const chains = chainOpts && chainOpts.length ? chainOpts : TR_CHAINS;
  for (const f of form.fields) {
    if (f.t === "chain") {
      values[f.k] = (f.def && chains.includes(f.def)) ? f.def : (chains[0] ?? f.def ?? "Base");
    } else {
      values[f.k] = f.def != null ? f.def : (f.t === "select" ? (f.opts?.[0] ?? "") : "");
    }
  }
  return values;
}

/** Natural-language prompt composed from a Build form, for the prompt-routed intents. */
export function composeIntentPrompt(intentId: string, v: Record<string, string>): string {
  switch (intentId) {
    case "crosschain-swap": return `swap ${v.amt} ${v.from} on ${v.fchain} to ${v.to} on ${v.tchain}`;
    case "bridge": return `bridge ${v.amt} ${v.asset} from ${v.from} to ${v.to}`;
    case "hyperliquid": return `${v.side} ${v.size} USD of ${v.mkt}${v.lev && v.lev !== "1x" ? ` at ${v.lev} leverage` : ""}`;
    case "polymarket": return `bet ${v.amt} ${v.side} on ${v.mkt}`;
    case "token-launch": return `launch a token called ${v.name}, ticker ${v.tick}${v.supply ? `, supply ${v.supply}` : ""}`;
    case "claim-fees": return v.act === "Check claimable"
      ? `check how much in trading fees I can claim for ${v.token}`
      : v.act === "Claim fee NFT"
        ? `claim my fee NFT for ${v.token}`
        : `claim my creator and LP trading fees for ${v.token}`;
    case "nft": return `${v.act} ${v.col}${v.max ? ` up to $${v.max}` : ""}`;
    case "automation": return `${v.strat} $${v.amt} into ${v.asset} ${v.freq}`;
    case "crosschain-payment": return `pay ${v.amt} USDC on ${v.pchain} to ${v.to} on ${v.rchain}`;
    default: return "";
  }
}

export type PrepareParams = {
  prompt?: string;
  recipientAddress?: string;
  amount?: number;
  amountUsd?: number;
  asset?: "USDC" | "ETH";
  url?: string;
  method?: string;
  token?: string;
};

/** Map a Build form's values to the router's prepare params for this intent. */
export function buildPrepareParams(intentId: string, v: Record<string, string>): PrepareParams {
  const num = (k: string) => { const n = Number(v[k]); return Number.isFinite(n) && n > 0 ? n : undefined; };
  switch (intentId) {
    case "send": return { recipientAddress: v.to?.trim(), amount: num("amt"), amountUsd: num("amt") };
    case "private-transfer": return { recipientAddress: v.to?.trim(), amount: num("amt"), amountUsd: num("amt"), asset: v.asset === "ETH" ? "ETH" : "USDC" };
    case "paid-api":
    case "private-paid-api": return { url: v.url?.trim(), method: v.method, amount: num("max"), amountUsd: num("max") };
    case "fund-llm-credits": return { amountUsd: num("amt"), token: v.token || "USDC" };
    default: return { prompt: composeIntentPrompt(intentId, v) };
  }
}

// ── recipient address format validation ─────────────────────────────────────
const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
const NAME_SERVICE = /\.(eth|sol|base|box|cb\.id)$/i; // ENS / SNS / Basenames etc.
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const evmOk = (to: string) => EVM_ADDR.test(to) || NAME_SERVICE.test(to);
const solOk = (to: string) => SOL_ADDR.test(to) || NAME_SERVICE.test(to);

/**
 * "" when the recipient is valid for where it's going, else a fix message.
 * send → must match the acting wallet's network; private-transfer → EVM (Veil);
 * crosschain-payment → must match the chosen recipient chain (rchain).
 */
export function recipientError(intentId: string, v: Record<string, string>, ctx: { isEvmWallet: boolean; isSolanaWallet: boolean }): string {
  const to = (v.to || "").trim();
  if (!to) return ""; // emptiness is handled by isFormValid
  if (intentId === "send") {
    if (ctx.isSolanaWallet) return solOk(to) ? "" : "Enter a valid Solana address — this is a Solana wallet.";
    if (ctx.isEvmWallet) return evmOk(to) ? "" : "Enter a valid 0x… address (or ENS) — this is an EVM wallet.";
    return "";
  }
  if (intentId === "private-transfer") {
    return evmOk(to) ? "" : "Private transfers settle to an EVM 0x… recipient.";
  }
  if (intentId === "crosschain-payment") {
    return (v.rchain || "").trim() === "Solana"
      ? (solOk(to) ? "" : "Enter a valid Solana address for the recipient chain.")
      : (evmOk(to) ? "" : "Enter a valid 0x… address for the recipient chain.");
  }
  return "";
}

/** Whether a Build form has enough to Review. */
export function isFormValid(intentId: string, v: Record<string, string>): boolean {
  const has = (k: string) => Boolean(v[k]?.trim());
  const pos = (k: string) => Number(v[k]) > 0;
  switch (intentId) {
    case "send":
    case "private-transfer": return has("to") && pos("amt");
    case "crosschain-payment": return has("to") && pos("amt");
    case "paid-api":
    case "private-paid-api": return has("url") && pos("max");
    case "fund-llm-credits": return pos("amt");
    case "crosschain-swap":
    case "bridge":
    case "automation": return pos("amt");
    case "hyperliquid": return has("mkt") && pos("size");
    case "polymarket": return has("mkt") && pos("amt");
    case "token-launch": return has("name") && has("tick");
    case "claim-fees": return has("token");
    case "nft": return has("col");
    default: return true;
  }
}
