"use client";

/* CapabilityRail — the long-tail crypto capabilities, master/detail. Each detail
   offers a structured manual form (Build) AND a free-form composer (Ask hive),
   both wired to the REAL crypto-capability router (prepare → clear-signing review
   → execute), plus the embedded full Hyperliquid rail. Readiness dots come from
   the live capability map.

   The Trade panel is human-initiated, so the agent auto-spend POLICY doesn't
   apply here — every wallet (personal / agent / Bankr) gets the full catalog, and
   nothing moves without an explicit Review → Confirm (the server also forces a
   fresh confirmation for a `user:` wallet). Which wallet actually funds an action
   is shown in the detail. */

import React from "react";
import { Badge, BBtn } from "./primitives";
import { BIcon, type IconName } from "./icons";
import { useTradeDesk } from "./trade-context";
import { prepareCapability, executeCapability, type RailResult } from "./rails";
import {
  INTENT_FORMS, TR_CHAINS, type IntentFieldDef, type IntentFormDef,
  initFormValues, buildPrepareParams, isFormValid, recipientError,
} from "./intent-forms";
import { CRYPTO_INTENTS, CRYPTO_INTENT_GROUPS, type CryptoIntentDef } from "@/features/dashboard/views/trade/trade-intents";
import type { CryptoCapabilityMap, CryptoPreparedAction } from "@/features/dashboard/views/trade/trade-api";
import { HyperliquidTradeForm } from "@/features/dashboard/views/trade/HyperliquidTradeForm";

const INTENT_ICON: Record<string, IconName> = {
  "crosschain-swap": "repeat", bridge: "branch", hyperliquid: "activity", polymarket: "spark",
  "token-launch": "sparkles", nft: "hex", automation: "refresh", send: "promote",
  "private-transfer": "shield", "crosschain-payment": "network", receive: "download",
  "paid-api": "plug", "private-paid-api": "key", "fund-llm-credits": "bot", "card-payment": "doc",
};

type Readiness = { ready: boolean; configured: boolean; missing: string[]; providerLabel?: string; provider?: string };
function readinessForIntent(caps: CryptoCapabilityMap | null, intentId: string): Readiness {
  const supporting = (caps?.providers ?? []).filter((provider) => provider.intents.includes(intentId));
  const provider = supporting.find((p) => p.ready) ?? supporting.find((p) => p.configured) ?? supporting[0];
  return {
    ready: supporting.some((p) => p.ready),
    configured: supporting.some((p) => p.configured),
    missing: provider?.missing ?? [],
    providerLabel: provider?.label,
    provider: provider?.provider,
  };
}

// Catalog shown in the rail: the real crypto intents, minus the spot swap (now
// the order ticket) and the read-only portfolio (the desk already shows it).
const RAIL_INTENTS = CRYPTO_INTENTS.filter((intent) => intent.id !== "trade" && intent.id !== "portfolio");

export function CapabilityRail() {
  const desk = useTradeDesk();
  const { cryptoCaps } = desk;
  const [active, setActive] = React.useState<string | null>(null);

  const groups = CRYPTO_INTENT_GROUPS
    .map((group) => ({ group, items: RAIL_INTENTS.filter((i) => i.group === group) }))
    .filter((g) => g.items.length);

  const activeIntent = RAIL_INTENTS.find((i) => i.id === active) ?? null;

  if (activeIntent) {
    return <CapabilityDetail intent={activeIntent} onBack={() => setActive(null)} />;
  }

  return (
    <div className="tk-rail">
      <div className="tk-railhead">
        <h3>More you can do here</h3>
        <Badge>via {desk.wallet.short}</Badge>
      </div>
      {groups.map((g) => (
        <div className="tk-group" key={g.group}>
          <div className="tk-grouplbl">{g.group}</div>
          <div className="tk-tiles">
            {g.items.map((it) => {
              const r = readinessForIntent(cryptoCaps, it.id);
              const tone = it.id === "receive" ? undefined : r.ready ? "ready" : r.configured ? "setup" : "off";
              return (
                <button key={it.id} type="button" className="tk-tile" onClick={() => setActive(it.id)}>
                  {tone ? <span className="rdot" data-tone={tone} title={r.ready ? "Ready" : r.configured ? "Needs setup" : "Off"} /> : null}
                  <span className="ti"><BIcon name={INTENT_ICON[it.id] ?? "spark"} size={16} /></span>
                  <b>{it.label}</b>
                  <span>{it.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── detail ───────────────────────────────────────────────────────────────────
function CapabilityDetail({ intent, onBack }: { intent: CryptoIntentDef; onBack: () => void }) {
  const desk = useTradeDesk();
  const { agentId, wallet, walletConfig, walletKind, isEvmWallet, isSolanaWallet, cryptoCaps, onOpenView, availableChains } = desk;

  const form = INTENT_FORMS[intent.id];
  const hasForm = Boolean(form);
  const isCredits = intent.id === "fund-llm-credits";
  // Build = structured form; Ask hive = free-form prompt. Credits is a simple
  // amount form with no natural-language equivalent, so it stays Build-only.
  const hasHive = hasForm && !isCredits;

  const [mode, setMode] = React.useState<"build" | "hive">(hasForm ? "build" : "hive");
  // Chain fields are seeded/clamped to chains the user actually holds.
  const [values, setValues] = React.useState<Record<string, string>>(() => initFormValues(form, availableChains));
  const [prompt, setPrompt] = React.useState("");
  const [prepared, setPrepared] = React.useState<CryptoPreparedAction | null>(null);
  const [preparedKey, setPreparedKey] = React.useState("");
  const [busy, setBusy] = React.useState<"prepare" | "execute" | null>(null);
  const [result, setResult] = React.useState<RailResult | null>(null);

  const r = readinessForIntent(cryptoCaps, intent.id);
  // Be honest about where the funds come from: Bankr executes on its own
  // provisioned wallet and MoneyClaw on the card account — only the direct wallet
  // rails (send / x402 / Veil) spend from the selected wallet itself.
  const fundingNote = intent.input === "address" || intent.input === "info" ? ""
    : r.provider === "bankr" ? "Executes on the workspace Bankr trading wallet — not the selected wallet."
    : r.provider === "moneyclaw" ? "Runs through the workspace MoneyClaw card account — not the selected wallet."
    : `Funds come from the selected wallet — ${wallet.short}.`;

  const reset = () => { setPrepared(null); setResult(null); };
  const setField = (k: string, v: string) => { setValues((prev) => ({ ...prev, [k]: v })); reset(); };

  const showBuild = hasForm && mode === "build";
  const inputKey = [intent.id, mode, JSON.stringify(values), prompt].join("|");
  const isPrepared = Boolean(prepared) && preparedKey === inputKey;
  // Block a recipient that doesn't match where it's going (wrong-network paste).
  const recipErr = showBuild ? recipientError(intent.id, values, { isEvmWallet, isSolanaWallet }) : "";
  const inputValid = (showBuild ? isFormValid(intent.id, values) : prompt.trim().length > 0) && !recipErr;

  const paramsForReview = () => (showBuild ? buildPrepareParams(intent.id, values) : { prompt: prompt.trim() });

  const review = async () => {
    reset();
    setBusy("prepare");
    const response = await prepareCapability({ agentId, intent: intent.id, wallet: walletConfig ?? undefined, ...paramsForReview() });
    setBusy(null);
    if (!response.ok || !response.prepared) { setResult({ ok: false, error: response.error || "Could not prepare this action." }); return; }
    setPrepared(response.prepared);
    setPreparedKey(inputKey);
  };

  const execute = async () => {
    setBusy("execute");
    setResult(null);
    const amountUsd = Number(buildPrepareParams(intent.id, values).amountUsd) || 0;
    const outcome = await executeCapability(prepared, { intentId: intent.id, amountUsd, token: values.token });
    setBusy(null);
    setResult(outcome);
    if (outcome.ok) desk.refresh();
  };

  // Credits funds directly (no prepare step) — execute on the single Run button.
  const fundCredits = async () => {
    setBusy("execute");
    setResult(null);
    const outcome = await executeCapability(null, { intentId: "fund-llm-credits", amountUsd: Number(values.amt) || 0, token: values.token || "USDC" });
    setBusy(null);
    setResult(outcome);
    if (outcome.ok) desk.refresh();
  };

  const modeToggle = hasHive ? (
    <span className="tk-otype tk-modeseg">
      <button type="button" data-active={mode === "build" ? "" : undefined} onClick={() => { setMode("build"); reset(); }}>Build</button>
      <button type="button" data-active={mode === "hive" ? "" : undefined} onClick={() => { setMode("hive"); reset(); }}>Ask hive</button>
    </span>
  ) : null;

  // ── special-case details ────────────────────────────────────────────────────
  if (intent.input === "address") {
    return (
      <DetailShell intent={intent} walletShort={wallet.short} onBack={onBack}>
        {wallet.fullAddress ? (
          <>
            <span className="lbl">Deposit address · {wallet.network.includes("solana") ? "Solana" : "Base"}</span>
            <div className="fw-addr">{wallet.fullAddress}</div>
            <div className="sf">
              <span className="hint">share to receive funds into {wallet.short}</span>
              <BBtn variant="primary" sm onClick={() => { void navigator.clipboard?.writeText(wallet.fullAddress); }}><BIcon name="copy" size={14} /> Copy address</BBtn>
            </div>
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: "var(--fg-2)" }}>No wallet address found. Create or import a wallet in the Wallets tab first.</p>
        )}
      </DetailShell>
    );
  }

  if (intent.input === "info") {
    return (
      <DetailShell intent={intent} walletShort={wallet.short} onBack={onBack}>
        <p style={{ fontSize: 12.5, color: "var(--fg-2)", margin: 0, lineHeight: 1.6 }}>
          Virtual-card checkout runs through MoneyClaw. Configure the card rail in Wallets, then ask an agent to complete the bounded checkout task.
        </p>
        <div className="sf"><span className="hint">card rail is configured in Wallets</span><BBtn variant="ghost" sm onClick={() => onOpenView("wallet")}>Open Wallets</BBtn></div>
      </DetailShell>
    );
  }

  // Hyperliquid → embed the full real rail for a non-Bankr EVM wallet; otherwise
  // fall back to the Build form / prompt (the router still serves it).
  if (intent.id === "hyperliquid" && walletKind !== "bankr" && isEvmWallet) {
    return (
      <DetailShell intent={intent} walletShort={wallet.short} onBack={onBack}>
        <div className="tk-railform">
          <HyperliquidTradeForm agentId={agentId} agentName={wallet.name} isEvmWallet={isEvmWallet} setActiveView={(v) => onOpenView(v)} />
        </div>
      </DetailShell>
    );
  }

  const reviewLabel = showBuild && form ? form.run : "Review";

  return (
    <DetailShell intent={intent} walletShort={wallet.short} onBack={onBack} modeToggle={modeToggle}>
      {showBuild && form ? (
        <IntentForm form={form} values={values} onChange={setField} chainOpts={availableChains} />
      ) : (
        <>
          <span className="lbl">Describe it in plain language — the hive routes it through the right provider</span>
          <textarea value={prompt} onChange={(e) => { setPrompt(e.target.value); reset(); }} placeholder={intent.promptPlaceholder} autoFocus />
        </>
      )}

      {fundingNote ? <p style={{ marginTop: 10, fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.5 }}>{fundingNote}</p> : null}

      {recipErr ? <p style={{ marginTop: 8, fontSize: 11.5, color: "var(--danger)", lineHeight: 1.5 }}>{recipErr}</p> : null}

      {!r.configured && r.missing.length ? (
        <p style={{ marginTop: 10, fontSize: 11.5, color: "var(--honey)" }}>
          {r.providerLabel ?? "This rail"} needs setup: {r.missing.join(" ")}{" "}
          <button type="button" className="fw-manage" onClick={() => onOpenView("wallet")}>Open Wallets →</button>
        </p>
      ) : null}

      {isPrepared && prepared?.review ? <PreparedReview prepared={prepared} /> : null}

      <div className="sf">
        <span className="hint" style={result?.ok ? { color: "var(--live)" } : undefined}>
          {result?.ok ? "Submitted ↗ — confirm in chat"
            : isCredits ? "tops up Bankr LLM credits"
            : !isPrepared ? `runs through ${wallet.short}` : "review built — confirm to run"}
        </span>
        {isCredits ? (
          <BBtn variant="primary" sm disabled={busy != null || !inputValid} onClick={fundCredits}>
            <BIcon name={busy === "execute" ? "refresh" : "bot"} size={14} /> {busy === "execute" ? "Funding…" : "Fund credits"}
          </BBtn>
        ) : !isPrepared ? (
          <BBtn variant="primary" sm disabled={busy != null || !inputValid || !r.configured} onClick={review}>
            <BIcon name="shield" size={14} /> {busy === "prepare" ? "Reviewing…" : reviewLabel}
          </BBtn>
        ) : (
          <span style={{ display: "inline-flex", gap: 8 }}>
            <BBtn variant="ghost" sm disabled={busy != null} onClick={reset}>Edit</BBtn>
            <BBtn variant="primary" sm disabled={busy != null} onClick={execute}>
              <BIcon name={busy === "execute" ? "refresh" : "check"} size={14} /> {busy === "execute" ? "Submitting…" : intent.mutating ? "Confirm & run" : "Run"}
            </BBtn>
          </span>
        )}
      </div>

      {result && !result.ok && result.error ? <p className="tk-error">{result.error}</p> : null}
      {result?.ok ? (
        <div className="tk-success">{result.message || "Submitted."}
          <div style={{ marginTop: 6 }}><button type="button" className="fw-manage" onClick={() => onOpenView("wallet")}>View in Wallets · Activity →</button></div>
        </div>
      ) : null}
    </DetailShell>
  );
}

// Structured Build form — controlled fields drive the real rail.
function IntentForm({ form, values, onChange, chainOpts }: { form: IntentFormDef; values: Record<string, string>; onChange: (k: string, v: string) => void; chainOpts?: string[] }) {
  return (
    <div className="tk-form">
      {form.fields.map((f) => <IntentField key={f.k} f={f} value={values[f.k] ?? ""} onChange={(v) => onChange(f.k, v)} chainOpts={chainOpts} />)}
    </div>
  );
}

function IntentField({ f, value, onChange, chainOpts }: { f: IntentFieldDef; value: string; onChange: (v: string) => void; chainOpts?: string[] }) {
  const full = f.t === "text" || f.t === "address";
  let control: React.ReactNode;
  if (f.t === "select" || f.t === "chain") {
    // Chain fields offer ONLY chains the user holds (across personal + agent
    // wallets); fall back to the static list only if none were resolved.
    const opts = f.t === "chain" ? (f.opts || (chainOpts && chainOpts.length ? chainOpts : TR_CHAINS)) : (f.opts || []);
    control = <select className="fb-select" value={value} onChange={(e) => onChange(e.target.value)}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  } else if (f.t === "amount") {
    control = (
      <>
        <span className="tk-amtfield">
          <input className="fb-field fb-mono" inputMode="decimal" placeholder="0" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} />
          {f.unit ? <span className="u">{f.unit}</span> : null}
        </span>
        {f.chips ? <div className="tk-chips sm">{f.chips.map((c) => <button type="button" key={c} onClick={() => onChange(String(c))}>${c}</button>)}</div> : null}
      </>
    );
  } else {
    control = <input className={"fb-field" + (f.t === "address" ? " fb-mono" : "")} placeholder={f.ph || ""} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <label className="fb-label" style={{ gridColumn: full ? "1 / -1" : "auto" }}>{f.label}{control}</label>;
}

function DetailShell({ intent, walletShort, onBack, modeToggle, children }: { intent: CryptoIntentDef; walletShort: string; onBack: () => void; modeToggle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="tk-rail">
      <div className="tk-railhead">
        <button type="button" className="tk-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
          All actions
        </button>
        <Badge>via {walletShort}</Badge>
      </div>
      <div className="tk-detail">
        <div className="dh">
          <span className="ti"><BIcon name={INTENT_ICON[intent.id] ?? "spark"} size={19} /></span>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}><b>{intent.label}</b><span>{intent.desc}</span></div>
          {modeToggle}
        </div>
        {children}
      </div>
    </div>
  );
}

function PreparedReview({ prepared }: { prepared: CryptoPreparedAction }) {
  const review = prepared.review ?? {};
  return (
    <div className="review">
      <div className="tk-grouplbl" style={{ marginBottom: 8 }}>Review</div>
      {review.summary ? <p style={{ fontSize: 12, color: "var(--fg-2)", margin: "0 0 8px", lineHeight: 1.5 }}>{review.summary}</p> : null}
      <div className="tk-rl"><span className="k">Provider</span><span className="v">{prepared.provider}</span></div>
      {review.network ? <div className="tk-rl"><span className="k">Network</span><span className="v">{review.network}</span></div> : null}
      {review.amountUsd != null ? <div className="tk-rl"><span className="k">Amount</span><span className="v">${review.amountUsd.toFixed(2)}{review.asset ? ` ${review.asset}` : ""}</span></div> : null}
      {prepared.platformFee?.enabled ? (
        <div className="tk-rl"><span className="k">Platform fee</span><span className="v">{prepared.platformFee.configured ? `$${prepared.platformFee.amountUsd.toFixed(6)} USDC` : prepared.platformFee.reason ?? "Not configured"}</span></div>
      ) : null}
      {review.recipientAddress ? <div className="tk-rl"><span className="k">Recipient</span><span className="v" style={{ wordBreak: "break-all" }}>{review.recipientAddress}</span></div> : null}
      {prepared.confirmation ? <div className="tk-rl"><span className="k">Confirm token</span><span className="v">{prepared.confirmation}</span></div> : null}
      {(review.risks ?? []).map((risk, index) => (
        <p key={index} style={{ fontSize: 11.5, color: "var(--honey)", margin: "6px 0 0" }}>⚠ {risk.message}</p>
      ))}
      {prepared.guidance ? <p style={{ fontSize: 11.5, color: "var(--fg-3)", margin: "8px 0 0", lineHeight: 1.5 }}>{prepared.guidance}</p> : null}
    </div>
  );
}
