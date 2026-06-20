"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import styles from "./trade.module.css";
import { CRYPTO_INTENTS, CRYPTO_INTENT_GROUPS, type CryptoIntentDef } from "./trade-intents";
import {
  BANKR_ACTION_CONFIRMATION_FALLBACK,
  type CryptoCapabilityMap,
  type CryptoPreparedAction,
  type CryptoProviderCapability,
  executeBankrDraft,
  executePreparedRoute,
  fetchCryptoCapabilities,
  fundBankrLlmCredits,
  prepareCryptoAction,
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
  setActiveView,
}: {
  agentId: string;
  wallet: Record<string, unknown> | null;
  agentName: string;
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
  const [busy, setBusy] = useState<"prepare" | "execute" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let ignore = false;
    void fetchCryptoCapabilities(agentId).then((data) => {
      if (ignore) return;
      setCaps(data);
      setLoading(false);
    });
    return () => { ignore = true; };
  }, [agentId]);

  const selected = useMemo<CryptoIntentDef>(
    () => CRYPTO_INTENTS.find((intent) => intent.id === selectedId) ?? CRYPTO_INTENTS[0],
    [selectedId],
  );
  const selectedReadiness = useMemo(() => readinessForIntent(caps, selected.id), [caps, selected.id]);

  const resetAction = useCallback(() => { setPrepared(null); setError(""); setSuccess(""); }, []);
  const pickIntent = useCallback((id: string) => { setSelectedId(id); resetAction(); }, [resetAction]);

  const amountUsd = Number(amount) || 0;

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
  }, [agentId, selected, wallet, amountUsd, asset, url, method, recipient, prompt, resetAction]);

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
          {selectedReadiness.provider ? `Routes via ${selectedReadiness.provider.label}` : "No configured provider for this action"}
        </p>

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

        {selected.input !== "address" && selected.input !== "info" ? (
          <div className={styles.actions} style={{ marginTop: 12 }}>
            <button type="button" className={styles.btn} onClick={review} disabled={busy != null}>{busy === "prepare" ? "Reviewing…" : "Review"}</button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={execute}
              disabled={busy != null || (selected.id !== "fund-llm-credits" && (!prepared || !prepared.ready))}
            >
              {busy === "execute" ? "Submitting…" : selected.mutating ? "Confirm & execute" : "Run"}
            </button>
          </div>
        ) : null}

        {prepared?.review ? <PreparedReview prepared={prepared} /> : null}
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
      </div>
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
