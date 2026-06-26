"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import styles from "./trade.module.css";
import { CRYPTO_INTENTS, CRYPTO_INTENT_GROUPS, type CryptoIntentDef } from "./trade-intents";
import {
  BANKR_ACTION_CONFIRMATION_FALLBACK,
  SWAP_CONFIRMATION,
  SWAP_MAX_USD,
  SWAP_TOKENS_BASE,
  SWAP_TOKENS_SOLANA,
  type HyperliquidAccountStatus,
  type HyperliquidActionName,
  type HyperliquidMarketType,
  type HyperliquidOrderType,
  type HyperliquidQuote,
  type HyperliquidSide,
  type CryptoCapabilityMap,
  type CryptoPreparedAction,
  type CryptoProviderCapability,
  type DexSwapQuote,
  type DexSwapResult,
  approveHyperliquidBuilder,
  executeBankrDraft,
  executeHyperliquidTrade,
  executePreparedRoute,
  executeSwap,
  fetchCryptoCapabilities,
  fetchHyperliquidStatus,
  fundBankrLlmCredits,
  prepareCryptoAction,
  quoteHyperliquidTrade,
  quoteSwap,
  runHyperliquidAction,
} from "./trade-api";

type IntentReadiness = { ready: boolean; configured: boolean; provider?: CryptoProviderCapability; missing: string[] };

function readinessForIntent(caps: CryptoCapabilityMap | null, intentId: string): IntentReadiness {
  const supporting = (caps?.providers ?? []).filter((provider) => provider.intents.includes(intentId));
  const provider = supporting.find((p) => p.ready) ?? supporting.find((p) => p.configured) ?? supporting[0];
  return {
    ready: supporting.some((p) => p.ready),
    configured: supporting.some((p) => p.configured),
    provider,
    missing: provider?.missing ?? [],
  };
}

function walletAddress(wallet: Record<string, unknown> | null): string {
  return String(wallet?.walletAddress || wallet?.vaultAddress || wallet?.address || "").trim();
}

export function CryptoTradeView({
  agentId,
  wallet,
  agentName,
  walletKind,
  setActiveView,
}: {
  agentId: string;
  wallet: Record<string, unknown> | null;
  agentName: string;
  walletKind?: "user" | "agent" | "bankr";
  setActiveView?: (view: DashboardView) => void;
}) {
  const [caps, setCaps] = useState<CryptoCapabilityMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("trade");

  const [prompt, setPrompt] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<"USDC" | "ETH">("USDC");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("GET");
  const [token, setToken] = useState("USDC");

  const [prepared, setPrepared] = useState<CryptoPreparedAction | null>(null);
  const [preparedKey, setPreparedKey] = useState("");
  const [busy, setBusy] = useState<"prepare" | "execute" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let ignore = false;
    void fetchCryptoCapabilities(agentId, wallet).then((data) => {
      if (ignore) return;
      setCaps(data);
      setLoading(false);
    });
    return () => { ignore = true; };
  }, [agentId, wallet]);

  const selected = useMemo<CryptoIntentDef>(
    () => CRYPTO_INTENTS.find((intent) => intent.id === selectedId) ?? CRYPTO_INTENTS[0],
    [selectedId],
  );
  const selectedReadiness = useMemo(() => readinessForIntent(caps, selected.id), [caps, selected.id]);

  const resetAction = useCallback(() => { setPrepared(null); setError(""); setSuccess(""); }, []);
  const pickIntent = useCallback((id: string) => { setSelectedId(id); resetAction(); }, [resetAction]);

  const amountUsd = Number(amount) || 0;

  // A prepared action only matches the exact inputs it was built from. If the user
  // edits anything afterward, isPrepared flips false and the action reverts to the
  // Review step — so the primary button is never silently disabled.
  const inputKey = [selected.id, prompt, recipient, amount, asset, url, method, token].join("|");
  const isPrepared = Boolean(prepared) && preparedKey === inputKey;
  const inputValid = selected.input === "prompt" ? prompt.trim().length > 0
    : selected.input === "recipient-amount" ? recipient.trim().length > 0 && amountUsd > 0
    : selected.input === "url" ? url.trim().length > 0
    : selected.input === "amount" ? amountUsd > 0
    : true;

  // Be honest about where the funds actually come from: Bankr executes on its own
  // provisioned wallet (the one behind the API key), and MoneyClaw on the card
  // account — neither uses the selected acting wallet. Only the direct wallet rails
  // (x402 send / pay, Veil private) spend from the selected wallet itself.
  const fundingProvider = prepared?.provider ?? selectedReadiness.provider?.provider;
  const fundingNote = !fundingProvider ? ""
    : fundingProvider === "bankr" ? "Executes on the workspace's Bankr-managed wallet (the wallet behind the Bankr API key) — not the selected wallet."
    : fundingProvider === "moneyclaw" ? "Runs through the workspace MoneyClaw card account — not the selected wallet."
    : selected.input === "address" ? ""
    : `Funds come from the selected wallet — ${agentName}.`;

  // The "trade" intent (swap) runs on the local DEX rail (0x) for a non-Bankr
  // wallet; the other Bankr-only intents still require the Bankr wallet.
  const useDexRail = selected.id === "trade" && Boolean(walletKind) && walletKind !== "bankr";
  const useHyperliquidRail = selected.id === "hyperliquid" && Boolean(walletKind) && walletKind !== "bankr";
  const bankrWalletMismatch = fundingProvider === "bankr" && walletKind !== "bankr" && !useDexRail;
  const walletNetwork = String((wallet as { network?: string } | null)?.network || "");
  const isSolanaWallet = walletNetwork.includes("solana");
  const isEvmWallet = walletNetwork.startsWith("eip155:");
  const dexTokens = isSolanaWallet ? SWAP_TOKENS_SOLANA : SWAP_TOKENS_BASE;
  const dexChainLabel = isSolanaWallet ? "Jupiter on Solana" : "0x on Base";

  const review = useCallback(async () => {
    resetAction();
    if (selected.input === "address" || selected.input === "info") return;
    setBusy("prepare");
    const response = await prepareCryptoAction({
      agentId,
      intent: selected.id,
      wallet: wallet ?? undefined,
      amountUsd: amountUsd || undefined,
      asset: selected.withAsset ? asset : undefined,
      url: url.trim() || undefined,
      method,
      recipientAddress: recipient.trim() || undefined,
      amount: amountUsd || undefined,
      prompt: prompt.trim() || undefined,
    });
    setBusy(null);
    if (!response.ok || !response.prepared) {
      setError(response.error || "Could not prepare this action.");
      return;
    }
    setPrepared(response.prepared);
    setPreparedKey(inputKey);
  }, [agentId, selected, wallet, amountUsd, asset, url, method, recipient, prompt, inputKey, resetAction]);

  const execute = useCallback(async () => {
    setError("");
    setSuccess("");

    // fund-llm-credits uses the dedicated credits route, not the prepared body.
    if (selected.id === "fund-llm-credits") {
      if (amountUsd <= 0) { setError("Enter a USD amount to fund."); return; }
      setBusy("execute");
      const response = await fundBankrLlmCredits(amountUsd, token.trim() || "USDC");
      setBusy(null);
      if (!response.ok) { setError(response.error || "Funding failed."); return; }
      setSuccess(response.message || "LLM credit funding submitted.");
      return;
    }

    if (!prepared?.endpoint?.route) { setError("Prepare the action first."); return; }
    if (!prepared.ready) { setError(`Set up ${prepared.provider}: ${prepared.missing.join(" ")}`); return; }
    const route = prepared.endpoint.route;
    setBusy("execute");

    // Bankr actions are a two-step prepare→confirm flow; the prepared body runs
    // the prepare leg, then we confirm+execute with the returned draft message.
    const isBankrDraft = prepared.provider === "bankr" && route === "/api/bankr/actions" && (prepared.requestBody as { action?: string })?.action === "prepare";
    if (isBankrDraft) {
      const draftResponse = await executePreparedRoute(route, prepared.requestBody);
      if (!draftResponse.ok) { setBusy(null); setError(draftResponse.error || "Bankr prepare failed."); return; }
      const draftMessage = String((draftResponse as { message?: string }).message ?? "");
      const confirmation = String((draftResponse as { confirmation?: string }).confirmation ?? prepared.confirmation ?? BANKR_ACTION_CONFIRMATION_FALLBACK);
      const execResponse = await executeBankrDraft(draftMessage, confirmation);
      setBusy(null);
      if (!execResponse.ok) { setError(execResponse.error || "Bankr execution failed."); return; }
      setSuccess(execResponse.message || "Bankr action executed.");
      return;
    }

    const response = await executePreparedRoute(route, prepared.requestBody);
    setBusy(null);
    if (!response.ok) { setError(response.error || "Execution failed — check governance/approvals."); return; }
    setSuccess(String((response as { message?: string }).message ?? "Action submitted."));
  }, [selected.id, amountUsd, token, prepared]);

  // Personal (`user:`) wallets are manual-only: swap and receive here, send via
  // the proven Wallets flow. The capability grid (x402/Veil/Bankr/MoneyClaw) is
  // the agent/auto-spend surface and needs a persisted spend policy a personal
  // wallet has no way to set, so it's omitted. The server also forces a fresh
  // per-action confirmation for any `user:` wallet, so nothing can auto-spend —
  // an explicit "send X from my wallet" still works, it just always confirms.
  if (walletKind === "user") {
    return <PersonalManualPanel agentId={agentId} agentName={agentName} wallet={wallet} setActiveView={setActiveView} />;
  }

  if (loading) return <div className={styles.empty}>Checking crypto rails…</div>;
  if (!caps) return <div className={styles.empty}>Crypto capabilities are unavailable right now.</div>;

  return (
    <div className={styles.grid}>
      <div className={styles.card}>
        {CRYPTO_INTENT_GROUPS.map((group) => {
          const intents = CRYPTO_INTENTS.filter((intent) => intent.group === group);
          if (!intents.length) return null;
          return (
            <div className={styles.intentGroup} key={group}>
              <div className={styles.groupTitle}>{group}</div>
              <div className={styles.intentGrid}>
                {intents.map((intent) => {
                  const r = readinessForIntent(caps, intent.id);
                  const badgeClass = r.ready ? styles.badgeReady : r.configured ? styles.badgeSetup : styles.badgeOff;
                  const badgeText = r.ready ? "Ready" : r.configured ? "Setup" : "Off";
                  return (
                    <button
                      key={intent.id}
                      type="button"
                      className={styles.intentTile}
                      data-active={selectedId === intent.id ? "" : undefined}
                      onClick={() => pickIntent(intent.id)}
                    >
                      <span className={`${styles.badge} ${badgeClass}`}>{badgeText}</span>
                      <span className={styles.intentName}>{intent.label}</span>
                      <span className={styles.intentDesc}>{intent.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.card}>
        <h3 className={styles.title} style={{ fontSize: 15 }}>{selected.label}</h3>
        <p className={styles.subtitle}>
          {useDexRail
            ? `Swap from ${agentName} via ${dexChainLabel} · $${SWAP_MAX_USD} cap`
            : useHyperliquidRail
              ? `Hyperliquid trading from ${agentName}`
            : selectedReadiness.provider ? `Routes via ${selectedReadiness.provider.label}` : "No configured provider for this action"}
        </p>
        {fundingNote && !useDexRail && !useHyperliquidRail ? <p className={styles.note} style={{ marginTop: 4 }}>{fundingNote}</p> : null}

        {useDexRail ? (
          <DexSwapForm agentId={agentId} agentName={agentName} tokens={dexTokens} chainLabel={dexChainLabel} setActiveView={setActiveView} />
        ) : useHyperliquidRail ? (
          <HyperliquidTradeForm agentId={agentId} agentName={agentName} isEvmWallet={isEvmWallet} setActiveView={setActiveView} />
        ) : (
        <>
        <div style={{ marginTop: 12 }}>
          <IntentInputs
            selected={selected}
            wallet={wallet}
            prompt={prompt} setPrompt={setPrompt}
            recipient={recipient} setRecipient={setRecipient}
            amount={amount} setAmount={setAmount}
            asset={asset} setAsset={setAsset}
            url={url} setUrl={setUrl}
            method={method} setMethod={setMethod}
            token={token} setToken={setToken}
          />
        </div>

        {!selectedReadiness.ready && selectedReadiness.missing.length ? (
          <div className={styles.warnCard} style={{ marginTop: 8 }}>
            {selectedReadiness.provider?.label ?? "This rail"} needs setup: {selectedReadiness.missing.join(" ")}
            {setActiveView ? <> <button type="button" className={styles.btn} style={{ marginLeft: 8, padding: "4px 10px" }} onClick={() => setActiveView("wallet")}>Open Wallets</button></> : null}
          </div>
        ) : null}

        {bankrWalletMismatch ? (
          <div className={styles.warnCard} style={{ marginTop: 12 }}>
            {selected.label} runs on the Bankr trading wallet, not {agentName}. Use the wallet picker (Change, top right) and select &ldquo;Bankr trading wallet&rdquo; to run it.
          </div>
        ) : null}

        {selected.input !== "address" && selected.input !== "info" && !bankrWalletMismatch ? (
          <>
            <div className={styles.actions} style={{ marginTop: 12 }}>
              {!isPrepared ? (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={review}
                  disabled={busy != null || !inputValid || !selectedReadiness.ready}
                >
                  {busy === "prepare" ? "Reviewing…" : "Review"}
                </button>
              ) : (
                <>
                  <button type="button" className={styles.btn} onClick={resetAction} disabled={busy != null}>Edit</button>
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={execute} disabled={busy != null}>
                    {busy === "execute" ? "Submitting…" : selected.mutating ? "Confirm & execute" : "Run"}
                  </button>
                </>
              )}
            </div>
            {!isPrepared && selectedReadiness.ready ? (
              <p className={styles.note} style={{ marginTop: 8 }}>
                {!inputValid
                  ? (selected.input === "prompt" ? "Describe what you want to do above, then Review."
                    : selected.input === "recipient-amount" ? "Enter a recipient and USD amount, then Review."
                    : selected.input === "url" ? "Enter the API URL, then Review."
                    : selected.input === "amount" ? "Enter a USD amount, then Review."
                    : "Fill in the details, then Review.")
                  : "Review builds a clear-signing preview, then Confirm & execute."}
              </p>
            ) : null}
          </>
        ) : null}

        {isPrepared && prepared?.review ? <PreparedReview prepared={prepared} /> : null}
        {selected.input === "address" ? <ReceiveCard address={walletAddress(wallet)} agentName={agentName} /> : null}
        {selected.input === "info" ? (
          <div className={styles.note} style={{ marginTop: 10 }}>
            Virtual-card checkout runs through MoneyClaw. Configure the card rail in Wallets, then ask an agent to complete the bounded checkout task.
            {setActiveView ? <> <button type="button" className={styles.btn} style={{ marginLeft: 8, padding: "4px 10px" }} onClick={() => setActiveView("wallet")}>Open Wallets</button></> : null}
          </div>
        ) : null}

        {error ? <p className={styles.error} style={{ marginTop: 10 }}>{error}</p> : null}
        {success ? (
          <div style={{ marginTop: 10 }}>
            <p className={styles.success}>{success}</p>
            {setActiveView ? (
              <div className={styles.actions}><button type="button" className={styles.btn} onClick={() => setActiveView("wallet")}>View in Wallets · Activity</button></div>
            ) : null}
          </div>
        ) : null}
        </>
        )}
      </div>
    </div>
  );
}

/**
 * Manual-only crypto surface for a personal (`user:`) wallet. Personal wallets
 * can't set a spend policy, so the agent/auto-spend rails are omitted; what's
 * left are the two rails that work with an explicit per-action confirmation:
 * the local DEX swap (/api/trading/swap) and a read-only receive address. Send
 * is the Wallets-route action, so it deep-links there rather than duplicating
 * that money path here.
 */
function PersonalManualPanel({ agentId, agentName, wallet, setActiveView }: {
  agentId: string;
  agentName: string;
  wallet: Record<string, unknown> | null;
  setActiveView?: (view: DashboardView) => void;
}) {
  const [tab, setTab] = useState<"swap" | "receive">("swap");
  const isSolana = String((wallet as { network?: string } | null)?.network || "").includes("solana");
  const tokens = isSolana ? SWAP_TOKENS_SOLANA : SWAP_TOKENS_BASE;
  const chainLabel = isSolana ? "Jupiter on Solana" : "0x on Base";
  return (
    <div className={styles.grid}>
      <div className={styles.card}>
        <div className={styles.segmented} role="tablist" aria-label="Action">
          <button type="button" role="tab" aria-selected={tab === "swap"} data-active={tab === "swap" ? "" : undefined} onClick={() => setTab("swap")}>Swap</button>
          <button type="button" role="tab" aria-selected={tab === "receive"} data-active={tab === "receive" ? "" : undefined} onClick={() => setTab("receive")}>Receive</button>
        </div>
        <p className={styles.note} style={{ marginTop: 12 }}>
          This is a personal wallet, so it&apos;s <strong>manual-only</strong> — swap and receive here, and send from the Wallets screen. It can never auto-spend; every action needs your explicit confirmation. Agent rails (x402, Veil, Bankr automations) require an agent wallet.
        </p>
        {setActiveView ? (
          <div className={styles.actions} style={{ marginTop: 10 }}>
            <button type="button" className={styles.btn} onClick={() => setActiveView("wallet")}>Send from Wallets</button>
          </div>
        ) : null}
      </div>
      <div className={styles.card}>
        <h3 className={styles.title} style={{ fontSize: 15 }}>{tab === "swap" ? `Swap via ${chainLabel}` : "Receive"}</h3>
        {tab === "swap"
          ? <DexSwapForm agentId={agentId} agentName={agentName} tokens={tokens} chainLabel={chainLabel} setActiveView={setActiveView} />
          : <ReceiveCard address={walletAddress(wallet)} agentName={agentName} />}
      </div>
    </div>
  );
}

function DexSwapForm({ agentId, agentName, tokens, chainLabel, setActiveView }: { agentId: string; agentName: string; tokens: string[]; chainLabel: string; setActiveView?: (view: DashboardView) => void }) {
  const [sellToken, setSellToken] = useState(tokens[0] ?? "USDC");
  const [buyToken, setBuyToken] = useState(tokens[1] ?? tokens[0] ?? "USDC");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<DexSwapQuote | null>(null);
  const [busy, setBusy] = useState<"quote" | "swap" | null>(null);
  const [result, setResult] = useState<DexSwapResult | null>(null);
  const [error, setError] = useState("");

  const amt = Number(amount) || 0;
  const canAct = amt > 0 && sellToken !== buyToken && !busy;

  const getQuote = async () => {
    if (!canAct) return;
    setBusy("quote"); setError(""); setQuote(null); setResult(null);
    const response = await quoteSwap({ agentId, sellToken, buyToken, amountHuman: amt });
    setBusy(null);
    if (!response.ok || !response.quote) { setError(response.error || "Could not price this swap."); return; }
    setQuote(response.quote);
  };

  const submit = async () => {
    if (!canAct) return;
    setBusy("swap"); setError(""); setResult(null);
    const response = await executeSwap({ agentId, sellToken, buyToken, amountHuman: amt, confirmation: SWAP_CONFIRMATION });
    setBusy(null);
    if (!response.ok || !response.result) { setError(response.error || "Swap failed."); return; }
    setResult(response.result);
    setQuote(null);
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label}>From</label>
          <select className={styles.select} value={sellToken} onChange={(event) => { setSellToken(event.target.value); setQuote(null); }}>
            {tokens.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>To</label>
          <select className={styles.select} value={buyToken} onChange={(event) => { setBuyToken(event.target.value); setQuote(null); }}>
            {tokens.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
          </select>
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Amount ({sellToken})</label>
        <input className={styles.input} inputMode="decimal" value={amount} placeholder={`Up to $${SWAP_MAX_USD} worth`} onChange={(event) => { setAmount(event.target.value.replace(/[^0-9.]/g, "")); setQuote(null); }} />
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={getQuote} disabled={!canAct}>{busy === "quote" ? "Pricing…" : "Get quote"}</button>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={submit} disabled={!canAct}>{busy === "swap" ? "Swapping…" : "Confirm & swap"}</button>
      </div>
      <p className={styles.note} style={{ marginTop: 8 }}>Signs locally from {agentName} and routes through {chainLabel}. Hard-capped at ${SWAP_MAX_USD}.</p>
      {quote ? (
        <div className={styles.card} style={{ marginTop: 10, background: "transparent" }}>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>You pay</span><span className={styles.reviewVal}>{quote.sellAmount} {quote.sell} (~${quote.valueUsd.toFixed(2)})</span></div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>You get ≈</span><span className={styles.reviewVal}>{quote.buyAmount.toPrecision(6)} {quote.buy}</span></div>
        </div>
      ) : null}
      {error ? <p className={styles.error} style={{ marginTop: 10 }}>{error}</p> : null}
      {result ? (
        <div style={{ marginTop: 10 }}>
          <p className={styles.success}>{result.detail}</p>
          <p className={styles.note} style={{ marginTop: 4 }}>Tx: <span className={styles.mono}>{result.reference}</span></p>
          {setActiveView ? <div className={styles.actions}><button type="button" className={styles.btn} onClick={() => setActiveView("wallet")}>View in Wallets · Activity</button></div> : null}
        </div>
      ) : null}
    </div>
  );
}

function HyperliquidTradeForm({ agentId, agentName, isEvmWallet, setActiveView }: {
  agentId: string;
  agentName: string;
  isEvmWallet: boolean;
  setActiveView?: (view: DashboardView) => void;
}) {
  const [coin, setCoin] = useState("BTC");
  const [marketType, setMarketType] = useState<HyperliquidMarketType>("perp");
  const [side, setSide] = useState<HyperliquidSide>("long");
  const [orderType, setOrderType] = useState<HyperliquidOrderType>("market");
  const [timeInForce, setTimeInForce] = useState<"Gtc" | "Ioc" | "Alo">("Gtc");
  const [triggerPx, setTriggerPx] = useState("");
  const [triggerType, setTriggerType] = useState<"tp" | "sl">("tp");
  const [triggerIsMarket, setTriggerIsMarket] = useState(true);
  const [clientOrderId, setClientOrderId] = useState("");
  const [notional, setNotional] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [advancedAction, setAdvancedAction] = useState<HyperliquidActionName>("cancel");
  const [orderId, setOrderId] = useState("");
  const [cloid, setCloid] = useState("");
  const [leverage, setLeverage] = useState("3");
  const [marginDeltaUsd, setMarginDeltaUsd] = useState("");
  const [transferType, setTransferType] = useState<"usd-class" | "usd-send" | "spot-send" | "withdraw">("usd-class");
  const [transferAmount, setTransferAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [spotToken, setSpotToken] = useState("");
  const [toPerp, setToPerp] = useState(true);
  const [twapMinutes, setTwapMinutes] = useState("5");
  const [twapId, setTwapId] = useState("");
  const [status, setStatus] = useState<HyperliquidAccountStatus | null>(null);
  const [quote, setQuote] = useState<HyperliquidQuote | null>(null);
  const [busy, setBusy] = useState<"status" | "quote" | "approve" | "trade" | "advanced" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const notionalUsd = Number(notional) || 0;
  const limit = Number(limitPrice) || 0;
  const trigger = Number(triggerPx) || 0;
  const canQuote = isEvmWallet && notionalUsd > 0 && (orderType === "market" || limit > 0 || (orderType === "trigger" && trigger > 0 && (triggerIsMarket || limit > 0))) && !busy;
  const needsBuilderApproval = Boolean(quote?.builder && quote.builderApproval.configured && !quote.builderApproval.approved);
  const marketChoices = marketType === "perp" ? ["BTC", "ETH", "SOL", "HYPE"] : ["HYPE", "PURR/USDC", "BTC/USDC", "ETH/USDC"];

  const refreshStatus = useCallback(async () => {
    if (!isEvmWallet) return;
    setBusy("status");
    setError("");
    const response = await fetchHyperliquidStatus(agentId);
    setBusy(null);
    if (!response.ok || !response.status) {
      setError(response.error || "Could not load Hyperliquid status.");
      return;
    }
    setStatus(response.status);
  }, [agentId, isEvmWallet]);

  useEffect(() => {
    let ignore = false;
    if (!isEvmWallet) return () => { ignore = true; };
    void fetchHyperliquidStatus(agentId).then((response) => {
      if (ignore) return;
      if (response.ok && response.status) {
        setStatus(response.status);
        return;
      }
      setError(response.error || "Could not load Hyperliquid status.");
    });
    return () => { ignore = true; };
  }, [agentId, isEvmWallet]);

  const clearDraft = () => {
    setQuote(null);
    setSuccess("");
  };

  useEffect(() => {
    setCoin(marketType === "perp" ? "BTC" : "HYPE");
    setSide(marketType === "perp" ? "long" : "buy");
    setReduceOnly(false);
    clearDraft();
  }, [marketType]);

  const getQuote = async () => {
    if (!canQuote) return;
    setBusy("quote");
    setError("");
    setSuccess("");
    const response = await quoteHyperliquidTrade({
      agentId,
      coin,
      marketType,
      side,
      orderType,
      notionalUsd,
      limitPrice: orderType === "limit" || (orderType === "trigger" && !triggerIsMarket) ? limit : undefined,
      timeInForce,
      triggerPx: orderType === "trigger" ? trigger : undefined,
      triggerType: orderType === "trigger" ? triggerType : undefined,
      triggerIsMarket: orderType === "trigger" ? triggerIsMarket : undefined,
      grouping: orderType === "trigger" ? "normalTpsl" : "na",
      clientOrderId: clientOrderId.trim() || undefined,
      reduceOnly,
      slippageBps,
    });
    setBusy(null);
    if (!response.ok || !response.quote) {
      setError(response.error || "Could not quote this Hyperliquid order.");
      return;
    }
    setQuote(response.quote);
  };

  const approveBuilder = async () => {
    setBusy("approve");
    setError("");
    setSuccess("");
    const response = await approveHyperliquidBuilder(agentId);
    setBusy(null);
    if (!response.ok || !response.result) {
      setError(response.error || "Builder approval failed.");
      return;
    }
    setSuccess(response.result.detail);
    await refreshStatus();
    await getQuote();
  };

  const submit = async () => {
    if (!canQuote) return;
    if (needsBuilderApproval) {
      setError("Approve the configured builder fee before placing this order.");
      return;
    }
    setBusy("trade");
    setError("");
    setSuccess("");
    const response = await executeHyperliquidTrade({
      agentId,
      coin,
      marketType,
      side,
      orderType,
      notionalUsd,
      limitPrice: orderType === "limit" || (orderType === "trigger" && !triggerIsMarket) ? limit : undefined,
      timeInForce,
      triggerPx: orderType === "trigger" ? trigger : undefined,
      triggerType: orderType === "trigger" ? triggerType : undefined,
      triggerIsMarket: orderType === "trigger" ? triggerIsMarket : undefined,
      grouping: orderType === "trigger" ? "normalTpsl" : "na",
      clientOrderId: clientOrderId.trim() || undefined,
      reduceOnly,
      slippageBps,
    });
    setBusy(null);
    if (!response.ok || !response.result) {
      setError(response.error || "Hyperliquid order failed.");
      return;
    }
    setQuote(null);
    setSuccess(response.result.detail);
    await refreshStatus();
  };

  const runAdvanced = async () => {
    setBusy("advanced");
    setError("");
    setSuccess("");
    const action = advancedAction === "cancel-by-cloid" && !cloid.trim() ? "cancel" : advancedAction;
    const response = await runHyperliquidAction({
      action,
      agentId,
      coin,
      marketType,
      side,
      assetId: undefined,
      orderId: orderId.trim() || undefined,
      cloid: cloid.trim() || undefined,
      leverage: Number(leverage) || undefined,
      marginMode: "cross",
      marginDeltaUsd: Number(marginDeltaUsd) || undefined,
      transferType,
      amount: Number(transferAmount) || undefined,
      amountUsd: Number(transferAmount) || undefined,
      destination: destination.trim() || undefined,
      token: spotToken.trim() || undefined,
      toPerp,
      twapMinutes: Number(twapMinutes) || undefined,
      twapId: twapId.trim() || undefined,
      notionalUsd,
      size: undefined,
      reduceOnly,
      twapRandomize: true,
    });
    setBusy(null);
    if (!response.ok) { setError(response.error || "Hyperliquid action failed."); return; }
    setSuccess(response.result?.detail || response.status?.detail || "Hyperliquid action submitted.");
    await refreshStatus();
  };

  if (!isEvmWallet) {
    return (
      <div className={styles.warnCard} style={{ marginTop: 12 }}>
        Hyperliquid trading requires a local EVM wallet. {setActiveView ? <button type="button" className={styles.btn} style={{ marginLeft: 8, padding: "4px 10px" }} onClick={() => setActiveView("wallet")}>Open Wallets</button> : null}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="hyperliquid-market-type">Type</label>
          <select id="hyperliquid-market-type" className={styles.select} value={marketType} onChange={(event) => setMarketType(event.target.value as HyperliquidMarketType)}>
            <option value="perp">Perps</option>
            <option value="spot">Spot</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="hyperliquid-market">Market</label>
          <select id="hyperliquid-market" className={styles.select} value={coin} onChange={(event) => { setCoin(event.target.value); clearDraft(); }}>
            {marketChoices.map((symbol) => <option key={symbol} value={symbol}>{marketType === "perp" ? `${symbol}-PERP` : symbol}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="hyperliquid-side">Side</label>
          <select id="hyperliquid-side" className={styles.select} value={side} onChange={(event) => { setSide(event.target.value as HyperliquidSide); clearDraft(); }}>
            {marketType === "perp" ? (
              <>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </>
            ) : (
              <>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </>
            )}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="hyperliquid-type">Order</label>
          <select id="hyperliquid-type" className={styles.select} value={orderType} onChange={(event) => { setOrderType(event.target.value as HyperliquidOrderType); clearDraft(); }}>
            <option value="market">Market IOC</option>
            <option value="limit">Limit GTC</option>
            <option value="trigger">TP / SL trigger</option>
          </select>
        </div>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="hyperliquid-notional">Notional (USD)</label>
          <input id="hyperliquid-notional" className={styles.input} inputMode="decimal" value={notional} onChange={(event) => { setNotional(event.target.value.replace(/[^0-9.]/g, "")); clearDraft(); }} />
        </div>
      </div>

      <div className={styles.fieldRow}>
        {orderType === "limit" ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="hyperliquid-limit">Limit price</label>
            <input id="hyperliquid-limit" className={styles.input} inputMode="decimal" value={limitPrice} onChange={(event) => { setLimitPrice(event.target.value.replace(/[^0-9.]/g, "")); clearDraft(); }} />
          </div>
        ) : orderType === "trigger" ? (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-trigger">Trigger price</label>
              <input id="hyperliquid-trigger" className={styles.input} inputMode="decimal" value={triggerPx} onChange={(event) => { setTriggerPx(event.target.value.replace(/[^0-9.]/g, "")); clearDraft(); }} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-trigger-type">Trigger</label>
              <select id="hyperliquid-trigger-type" className={styles.select} value={triggerType} onChange={(event) => { setTriggerType(event.target.value as "tp" | "sl"); clearDraft(); }}>
                <option value="tp">Take profit</option>
                <option value="sl">Stop loss</option>
              </select>
            </div>
            {!triggerIsMarket ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hyperliquid-trigger-limit">Limit price</label>
                <input id="hyperliquid-trigger-limit" className={styles.input} inputMode="decimal" value={limitPrice} onChange={(event) => { setLimitPrice(event.target.value.replace(/[^0-9.]/g, "")); clearDraft(); }} />
              </div>
            ) : null}
          </>
        ) : (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="hyperliquid-slippage">Market slippage</label>
            <select id="hyperliquid-slippage" className={styles.select} value={slippageBps} onChange={(event) => { setSlippageBps(Number(event.target.value)); clearDraft(); }}>
              <option value={25}>0.25%</option>
              <option value={50}>0.50%</option>
              <option value={100}>1.00%</option>
            </select>
          </div>
        )}
        {orderType !== "market" ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="hyperliquid-tif">Time in force</label>
            <select id="hyperliquid-tif" className={styles.select} value={timeInForce} onChange={(event) => { setTimeInForce(event.target.value as "Gtc" | "Ioc" | "Alo"); clearDraft(); }}>
              <option value="Gtc">GTC</option>
              <option value="Ioc">IOC</option>
              <option value="Alo">Post only</option>
            </select>
          </div>
        ) : null}
        {orderType === "trigger" ? (
          <label className={styles.checkboxLine}>
            <input type="checkbox" checked={triggerIsMarket} onChange={(event) => { setTriggerIsMarket(event.target.checked); clearDraft(); }} />
            Market on trigger
          </label>
        ) : null}
        <label className={styles.checkboxLine}>
          <input type="checkbox" checked={reduceOnly} disabled={marketType === "spot"} onChange={(event) => { setReduceOnly(event.target.checked); clearDraft(); }} />
          Reduce only
        </label>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="hyperliquid-cloid">Client order ID</label>
        <input id="hyperliquid-cloid" className={styles.input} value={clientOrderId} placeholder="Optional 0x… client id" onChange={(event) => { setClientOrderId(event.target.value.trim()); clearDraft(); }} />
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={refreshStatus} disabled={busy != null}>{busy === "status" ? "Refreshing..." : "Refresh status"}</button>
        <button type="button" className={styles.btn} onClick={getQuote} disabled={!canQuote}>{busy === "quote" ? "Quoting..." : "Get quote"}</button>
        {needsBuilderApproval ? (
          <button type="button" className={styles.btn} onClick={approveBuilder} disabled={busy != null}>{busy === "approve" ? "Approving..." : "Approve builder"}</button>
        ) : null}
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={submit} disabled={!canQuote || !quote || needsBuilderApproval}>{busy === "trade" ? "Trading..." : "Confirm & trade"}</button>
      </div>

      <p className={styles.note} style={{ marginTop: 8 }}>Signs locally from {agentName}. Server policy controls wallet, cap, builder address, and builder fee.</p>

      <div className={styles.card} style={{ marginTop: 10, background: "transparent" }}>
        <div className={styles.groupTitle}>Advanced</div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="hyperliquid-advanced-action">Action</label>
            <select
              id="hyperliquid-advanced-action"
              className={styles.select}
              value={advancedAction}
              onChange={(event) => {
                const next = event.target.value as HyperliquidActionName;
                setAdvancedAction(next);
                if (["usd-class", "usd-send", "spot-send", "withdraw"].includes(next)) setTransferType(next as "usd-class" | "usd-send" | "spot-send" | "withdraw");
              }}
            >
              <option value="open-orders">Open orders</option>
              <option value="order-status">Order status</option>
              <option value="cancel">Cancel order</option>
              <option value="cancel-by-cloid">Cancel client order</option>
              <option value="leverage">Set leverage</option>
              <option value="margin">Adjust isolated margin</option>
              <option value="usd-class">Move USDC spot/perps</option>
              <option value="usd-send">Send USDC</option>
              <option value="withdraw">Withdraw USDC</option>
              <option value="spot-send">Send spot asset</option>
              <option value="twap-order">Place TWAP</option>
              <option value="twap-cancel">Cancel TWAP</option>
            </select>
          </div>
          {["order-status", "cancel", "twap-cancel"].includes(advancedAction) ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-order-id">Order / TWAP ID</label>
              <input id="hyperliquid-order-id" className={styles.input} inputMode="numeric" value={advancedAction === "twap-cancel" ? twapId : orderId} onChange={(event) => advancedAction === "twap-cancel" ? setTwapId(event.target.value.replace(/[^0-9]/g, "")) : setOrderId(event.target.value.replace(/[^0-9]/g, ""))} />
            </div>
          ) : null}
          {advancedAction === "cancel-by-cloid" ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-cancel-cloid">Client order ID</label>
              <input id="hyperliquid-cancel-cloid" className={styles.input} value={cloid} onChange={(event) => setCloid(event.target.value.trim())} />
            </div>
          ) : null}
          {advancedAction === "leverage" ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-leverage">Leverage</label>
              <input id="hyperliquid-leverage" className={styles.input} inputMode="numeric" value={leverage} onChange={(event) => setLeverage(event.target.value.replace(/[^0-9]/g, ""))} />
            </div>
          ) : null}
          {advancedAction === "margin" ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-margin">Margin delta USD</label>
              <input id="hyperliquid-margin" className={styles.input} inputMode="decimal" value={marginDeltaUsd} onChange={(event) => setMarginDeltaUsd(event.target.value.replace(/[^0-9.-]/g, ""))} />
            </div>
          ) : null}
        </div>

        {["usd-class", "usd-send", "spot-send", "withdraw"].includes(advancedAction) ? (
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-transfer-amount">Amount</label>
              <input id="hyperliquid-transfer-amount" className={styles.input} inputMode="decimal" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
            {advancedAction === "usd-class" ? (
              <label className={styles.checkboxLine}>
                <input type="checkbox" checked={toPerp} onChange={(event) => setToPerp(event.target.checked)} />
                To perps
              </label>
            ) : (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hyperliquid-destination">Destination</label>
                <input id="hyperliquid-destination" className={styles.input} value={destination} onChange={(event) => setDestination(event.target.value.trim())} />
              </div>
            )}
            {advancedAction === "spot-send" ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hyperliquid-spot-token">Spot token</label>
                <input id="hyperliquid-spot-token" className={styles.input} value={spotToken} placeholder="Token id from Hyperliquid" onChange={(event) => setSpotToken(event.target.value.trim())} />
              </div>
            ) : null}
          </div>
        ) : null}

        {advancedAction === "twap-order" ? (
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-twap-minutes">Minutes</label>
              <input id="hyperliquid-twap-minutes" className={styles.input} inputMode="numeric" value={twapMinutes} onChange={(event) => setTwapMinutes(event.target.value.replace(/[^0-9]/g, ""))} />
            </div>
          </div>
        ) : null}

        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={runAdvanced} disabled={busy != null}>{busy === "advanced" ? "Submitting..." : "Run advanced action"}</button>
        </div>
      </div>

      {status ? (
        <div className={styles.card} style={{ marginTop: 10, background: "transparent" }}>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Account value</span><span className={styles.reviewVal}>{status.accountValueUsd == null ? "Unavailable" : `$${status.accountValueUsd.toFixed(2)}`}</span></div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Open orders</span><span className={styles.reviewVal}>{status.openOrders.length}</span></div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Builder</span><span className={styles.reviewVal}>{status.builderConfig.configured ? status.builderApproval.detail : status.builderConfig.missing.join(" ")}</span></div>
          {status.positions.slice(0, 3).map((position) => (
            <div className={styles.reviewLine} key={position.coin}>
              <span className={styles.reviewKey}>{position.coin}</span>
              <span className={styles.reviewVal}>{position.side} {Math.abs(position.size).toPrecision(6)}{position.unrealizedPnlUsd == null ? "" : ` · PnL $${position.unrealizedPnlUsd.toFixed(2)}`}</span>
            </div>
          ))}
          {status.spotBalances.slice(0, 3).map((balance) => (
            <div className={styles.reviewLine} key={`spot-${balance.coin}`}>
              <span className={styles.reviewKey}>{balance.coin}</span>
              <span className={styles.reviewVal}>{balance.available.toPrecision(6)} available</span>
            </div>
          ))}
        </div>
      ) : null}

      {quote ? (
        <div className={styles.card} style={{ marginTop: 10, background: "transparent" }}>
          <div className={styles.groupTitle}>Quote</div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Order</span><span className={styles.reviewVal}>{quote.order.marketType} {quote.order.side} {quote.order.size} {quote.order.coin} at {quote.order.price}</span></div>
          {quote.order.triggerPx ? <div className={styles.reviewLine}><span className={styles.reviewKey}>Trigger</span><span className={styles.reviewVal}>{quote.order.triggerType?.toUpperCase()} at {quote.order.triggerPx}</span></div> : null}
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Notional</span><span className={styles.reviewVal}>${quote.order.notionalUsd.toFixed(2)}</span></div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Network</span><span className={styles.reviewVal}>{quote.network}</span></div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Builder fee</span><span className={styles.reviewVal}>{quote.builder ? `${(quote.builder.f / 10).toFixed(1).replace(/\.0$/, "")} bps` : "Disabled"}</span></div>
          <p className={styles.note} style={{ marginTop: 8 }}>{quote.detail}</p>
        </div>
      ) : null}

      {error ? <p className={styles.error} style={{ marginTop: 10 }}>{error}</p> : null}
      {success ? (
        <div style={{ marginTop: 10 }}>
          <p className={styles.success}>{success}</p>
          {setActiveView ? <div className={styles.actions}><button type="button" className={styles.btn} onClick={() => setActiveView("wallet")}>View in Wallets · Activity</button></div> : null}
        </div>
      ) : null}
    </div>
  );
}

function IntentInputs(props: {
  selected: CryptoIntentDef;
  wallet: Record<string, unknown> | null;
  prompt: string; setPrompt: (v: string) => void;
  recipient: string; setRecipient: (v: string) => void;
  amount: string; setAmount: (v: string) => void;
  asset: "USDC" | "ETH"; setAsset: (v: "USDC" | "ETH") => void;
  url: string; setUrl: (v: string) => void;
  method: string; setMethod: (v: string) => void;
  token: string; setToken: (v: string) => void;
}) {
  const { selected } = props;
  if (selected.input === "prompt") {
    return (
      <div className={styles.field}>
        <label className={styles.label} htmlFor="crypto-prompt">What do you want to do?</label>
        <textarea id="crypto-prompt" className={styles.textarea} placeholder={selected.promptPlaceholder} value={props.prompt} onChange={(event) => props.setPrompt(event.target.value)} />
      </div>
    );
  }
  if (selected.input === "recipient-amount") {
    return (
      <>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="crypto-recipient">Recipient address</label>
          <input id="crypto-recipient" className={styles.input} placeholder="0x… or solana address" value={props.recipient} onChange={(event) => props.setRecipient(event.target.value)} />
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="crypto-amount">Amount (USD)</label>
            <input id="crypto-amount" className={styles.input} inputMode="decimal" value={props.amount} onChange={(event) => props.setAmount(event.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
          {selected.withAsset ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="crypto-asset">Asset</label>
              <select id="crypto-asset" className={styles.select} value={props.asset} onChange={(event) => props.setAsset(event.target.value as "USDC" | "ETH")}>
                <option value="USDC">USDC</option>
                <option value="ETH">ETH</option>
              </select>
            </div>
          ) : null}
        </div>
      </>
    );
  }
  if (selected.input === "url") {
    return (
      <>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="crypto-url">API URL</label>
          <input id="crypto-url" className={styles.input} placeholder="https://api.example.com/paid" value={props.url} onChange={(event) => props.setUrl(event.target.value)} />
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="crypto-method">Method</label>
            <select id="crypto-method" className={styles.select} value={props.method} onChange={(event) => props.setMethod(event.target.value)}>
              {["GET", "POST", "PUT", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="crypto-max">Max pay (USD)</label>
            <input id="crypto-max" className={styles.input} inputMode="decimal" value={props.amount} onChange={(event) => props.setAmount(event.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
        </div>
      </>
    );
  }
  if (selected.input === "amount") {
    return (
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="crypto-fund">Amount (USD)</label>
          <input id="crypto-fund" className={styles.input} inputMode="decimal" value={props.amount} onChange={(event) => props.setAmount(event.target.value.replace(/[^0-9.]/g, ""))} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="crypto-token">Pay with</label>
          <select id="crypto-token" className={styles.select} value={props.token} onChange={(event) => props.setToken(event.target.value)}>
            {["USDC", "USDT", "ETH", "HIVE"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
    );
  }
  return null;
}

function PreparedReview({ prepared }: { prepared: CryptoPreparedAction }) {
  const review = prepared.review ?? {};
  return (
    <div className={styles.card} style={{ marginTop: 12, background: "transparent" }}>
      <div className={styles.groupTitle}>Review</div>
      {review.summary ? <p className={styles.note} style={{ marginBottom: 8 }}>{review.summary}</p> : null}
      <div className={styles.reviewLine}><span className={styles.reviewKey}>Provider</span><span className={styles.reviewVal}>{prepared.provider}</span></div>
      {review.network ? <div className={styles.reviewLine}><span className={styles.reviewKey}>Network</span><span className={styles.reviewVal}>{review.network}</span></div> : null}
      {review.amountUsd != null ? <div className={styles.reviewLine}><span className={styles.reviewKey}>Amount</span><span className={styles.reviewVal}>${review.amountUsd.toFixed(2)}{review.asset ? ` ${review.asset}` : ""}</span></div> : null}
      {prepared.platformFee?.enabled ? (
        <div className={styles.reviewLine}>
          <span className={styles.reviewKey}>Platform fee</span>
          <span className={styles.reviewVal}>
            {prepared.platformFee.configured
              ? `$${prepared.platformFee.amountUsd.toFixed(6)} USDC`
              : prepared.platformFee.reason ?? "Not configured"}
          </span>
        </div>
      ) : null}
      {review.recipientAddress ? <div className={styles.reviewLine}><span className={styles.reviewKey}>Recipient</span><span className={`${styles.reviewVal} ${styles.mono}`}>{review.recipientAddress}</span></div> : null}
      {prepared.confirmation ? <div className={styles.reviewLine}><span className={styles.reviewKey}>Confirm token</span><span className={styles.reviewVal}>{prepared.confirmation}</span></div> : null}
      {(review.risks ?? []).map((risk, index) => (
        <p key={index} className={styles.risk}>⚠ {risk.message}</p>
      ))}
      {prepared.guidance ? <p className={styles.note} style={{ marginTop: 8 }}>{prepared.guidance}</p> : null}
    </div>
  );
}

function ReceiveCard({ address, agentName }: { address: string; agentName: string }) {
  if (!address) {
    return <div className={styles.warnCard} style={{ marginTop: 12 }}>No wallet address found for {agentName}. Create or import a wallet in the Wallets tab first.</div>;
  }
  return (
    <div className={styles.card} style={{ marginTop: 12, background: "transparent" }}>
      <div className={styles.groupTitle}>Deposit address</div>
      <p className={styles.mono}>{address}</p>
      <p className={styles.note} style={{ marginTop: 6 }}>Send funds to this address to top up {agentName}&apos;s wallet.</p>
    </div>
  );
}
