"use client";

/* rails.ts — the real money rails for the Trade desk, wrapping the typed
   trade-api fetchers with the SAME prepare→confirm→execute orchestration the
   original CryptoTradeView used. No new execution logic: this just lets the
   redesigned tickets + capability rail drive the proven rails. Every path keeps
   its server-side confirmation token and governance gate. */

import {
  BANKR_ACTION_CONFIRMATION_FALLBACK,
  SWAP_CONFIRMATION,
  type CryptoPreparedAction,
  type DexSwapQuote,
  type TradePrepareParams,
  executeBankrDraft,
  executePreparedRoute,
  executeSwap,
  fundBankrLlmCredits,
  prepareCryptoAction,
  quoteSwap,
} from "@/features/dashboard/views/trade/trade-api";

export type RailResult = { ok: boolean; message?: string; reference?: string; error?: string };

// ── local DEX swap rail (0x on Base / Jupiter on Solana) ─────────────────────
export async function quoteDex(params: { agentId: string; sellToken: string; buyToken: string; amountHuman: number }): Promise<{ ok: boolean; quote?: DexSwapQuote; error?: string }> {
  return quoteSwap(params);
}

export async function runDexSwap(params: { agentId: string; sellToken: string; buyToken: string; amountHuman: number }): Promise<RailResult> {
  const response = await executeSwap({ ...params, confirmation: SWAP_CONFIRMATION });
  if (!response.ok || !response.result) return { ok: false, error: response.error || "Swap failed." };
  return { ok: true, message: response.result.detail, reference: response.result.reference };
}

// ── crypto capability router (prepare → review → execute) ────────────────────
export async function prepareCapability(params: TradePrepareParams): Promise<{ ok: boolean; prepared?: CryptoPreparedAction; error?: string }> {
  return prepareCryptoAction(params);
}

/**
 * Execute a prepared crypto capability. Mirrors CryptoTradeView.execute exactly:
 * fund-llm-credits uses its dedicated route; a Bankr "prepare" body runs the
 * two-step draft→confirm flow; everything else POSTs the router-prepared body to
 * its prepared route. Confirmation tokens always come from the server's prepare
 * response, never assumed here.
 */
export async function executeCapability(
  prepared: CryptoPreparedAction | null,
  opts: { intentId: string; amountUsd: number; token?: string },
): Promise<RailResult> {
  if (opts.intentId === "fund-llm-credits") {
    if (!(opts.amountUsd > 0)) return { ok: false, error: "Enter a USD amount to fund." };
    const response = await fundBankrLlmCredits(opts.amountUsd, (opts.token || "USDC").trim() || "USDC");
    return response.ok ? { ok: true, message: response.message || "LLM credit funding submitted." } : { ok: false, error: response.error || "Funding failed." };
  }

  if (!prepared?.endpoint?.route) return { ok: false, error: "Prepare the action first." };
  if (!prepared.ready) return { ok: false, error: `Set up ${prepared.provider}: ${prepared.missing.join(" ")}` };
  const route = prepared.endpoint.route;

  const isBankrDraft = prepared.provider === "bankr"
    && route === "/api/bankr/actions"
    && (prepared.requestBody as { action?: string })?.action === "prepare";
  if (isBankrDraft) {
    const draftResponse = await executePreparedRoute(route, prepared.requestBody);
    if (!draftResponse.ok) return { ok: false, error: draftResponse.error || "Bankr prepare failed." };
    const draftMessage = String((draftResponse as { message?: string }).message ?? "");
    const confirmation = String((draftResponse as { confirmation?: string }).confirmation ?? prepared.confirmation ?? BANKR_ACTION_CONFIRMATION_FALLBACK);
    const execResponse = await executeBankrDraft(draftMessage, confirmation);
    return execResponse.ok ? { ok: true, message: execResponse.message || "Bankr action executed." } : { ok: false, error: execResponse.error || "Bankr execution failed." };
  }

  const response = await executePreparedRoute(route, prepared.requestBody);
  return response.ok
    ? { ok: true, message: String((response as { message?: string }).message ?? "Action submitted.") }
    : { ok: false, error: response.error || "Execution failed — check governance/approvals." };
}
