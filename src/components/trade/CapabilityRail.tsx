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
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import { Badge, BBtn, ProviderBadge } from "./primitives";
import { BIcon, type IconName } from "./icons";
import { useTradeDesk } from "./trade-context";
import { playTradeSuccessSound } from "./trade-sound";
import { prepareCapability, executeCapability, type RailResult } from "./rails";
import {
  INTENT_FORMS, TR_CHAINS, type IntentFieldDef, type IntentFormDef,
  initFormValues, buildPrepareParams, isFormValid, recipientError,
} from "./intent-forms";
import { CRYPTO_INTENTS, CRYPTO_INTENT_GROUPS, type CryptoIntentDef } from "@/features/dashboard/views/trade/trade-intents";
import {
  runNansenComplexTemplate,
  runNansenSimpleTemplate,
  type CryptoCapabilityMap,
  type CryptoPreparedAction,
  type TradeNansenComplexTemplateId,
  type TradeNansenComplexTemplateParams,
  type TradeNansenInsightBrief,
  type TradeNansenSimpleTemplateId,
  type TradeNansenSimpleTemplateParams,
} from "@/features/dashboard/views/trade/trade-api";
import { ChatMarkdown } from "@/features/dashboard/ChatMarkdown";
import { HyperliquidTradeForm } from "@/features/dashboard/views/trade/HyperliquidTradeForm";
import { CopyTradingPanel } from "./CopyTradingPanel";

const INTENT_ICON: Record<string, IconName> = {
  "crosschain-swap": "repeat", bridge: "branch", hyperliquid: "activity", polymarket: "spark",
  "token-launch": "sparkles", "claim-fees": "wallet", nft: "hex", automation: "refresh", send: "promote",
  "private-transfer": "shield", "crosschain-payment": "network", receive: "download",
  "paid-api": "plug", "private-paid-api": "key", "fund-llm-credits": "bot", "card-payment": "doc",
  "copy-trading": "copy",
  "nansen-defi-positions": "wallet", "nansen-smart-money-holdings": "spark",
  "nansen-token-holders": "eye", "nansen-token-screener": "search",
  "nansen-token-tracking": "search", "nansen-hyperliquid-wallets": "activity", "nansen-related-wallets": "network",
  "nansen-top-wallets": "eye", "nansen-cex-health": "doc",
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

// Providers that are a SEPARATE managed account/runtime — only relevant to a
// capability when the ACTING wallet actually is that provider. They report
// "ready" globally (a shared env token), so without this filter UsePod/MoneyClaw
// badge generic capabilities (receive / pay-api) on an unrelated personal wallet.
// x402, Veil, Bankr, Hyperliquid stay (wallet-native, or inherent to a capability).
const WALLET_BOUND_PROVIDERS = new Set(["usepod", "moneyclaw", "clawcard", "venice"]);

/** Which provider's badge to show on a rail card — resolved for the ACTING
 *  wallet, not from global env readiness. */
function badgeProviderForIntent(caps: CryptoCapabilityMap | null, intentId: string, actingProvider: string): string | undefined {
  const supporting = (caps?.providers ?? []).filter((p) => p.intents.includes(intentId));
  if (!supporting.length) return undefined;
  const applicable = supporting.filter((p) => !WALLET_BOUND_PROVIDERS.has(p.provider) || p.provider === actingProvider);
  // If excluding wallet-bound runtimes empties the list, the capability is only
  // served by one of them (e.g. Card payment → MoneyClaw) — keep it (inherent).
  const pool = applicable.length ? applicable : supporting;
  const pick = pool.find((p) => p.ready) ?? pool.find((p) => p.configured) ?? pool[0];
  return pick?.provider;
}

function walletNetworkLabel(network: string): string {
  if (network.includes("solana")) return "Solana";
  if (network === "eip155:4663") return "Robinhood Chain";
  if (network === "eip155:46630") return "Robinhood Chain Testnet";
  if (network === "eip155:84532") return "Base Sepolia";
  if (network === "eip155:8453") return "Base";
  return network || "wallet";
}

// Catalog shown in the rail: the real crypto intents, minus the spot swap (now
// the order ticket) and the read-only portfolio (the desk already shows it).
const RAIL_INTENTS = CRYPTO_INTENTS.filter((intent) => intent.id !== "trade" && intent.id !== "portfolio");

type NansenTradeAction =
  | { kind: "simple"; template: TradeNansenSimpleTemplateId; runLabel: string; hint: string }
  | { kind: "complex"; template: TradeNansenComplexTemplateId; runLabel: string; hint: string };

const NANSEN_TRADE_ACTIONS = {
  "nansen-defi-positions": {
    kind: "simple",
    template: "defi-positions",
    runLabel: "Run DeFi positions",
    hint: "wallet DeFi positions",
  },
  "nansen-smart-money-holdings": {
    kind: "simple",
    template: "smart-money-holdings",
    runLabel: "Run holdings brief",
    hint: "aggregated Smart Money holdings",
  },
  "nansen-token-holders": {
    kind: "simple",
    template: "token-top-holders",
    runLabel: "Run holder brief",
    hint: "top holder context",
  },
  "nansen-token-screener": {
    kind: "simple",
    template: "token-screener-discovery",
    runLabel: "Run token screener",
    hint: "new-token discovery context",
  },
  "nansen-token-tracking": {
    kind: "complex",
    template: "token-tracking-smart-money",
    runLabel: "Run token brief",
    hint: "derived token and Smart Money context",
  },
  "nansen-hyperliquid-wallets": {
    kind: "complex",
    template: "hyperliquid-wallet-discovery",
    runLabel: "Run wallet discovery",
    hint: "read-only Hyperliquid wallet context",
  },
  "nansen-related-wallets": {
    kind: "complex",
    template: "related-wallets-scale",
    runLabel: "Run wallet cluster",
    hint: "probabilistic related-wallet context",
  },
  "nansen-top-wallets": {
    kind: "complex",
    template: "top-wallet-copytrade-research",
    runLabel: "Find top wallets",
    hint: "top wallets for a token",
  },
  "nansen-cex-health": {
    kind: "complex",
    template: "cex-health-monitor",
    runLabel: "Run CEX health",
    hint: "exchange balance and flow context",
  },
} as const satisfies Record<string, NansenTradeAction>;

type NansenTradeIntentId = keyof typeof NANSEN_TRADE_ACTIONS;

function isNansenTradeIntent(intentId: string): intentId is NansenTradeIntentId {
  return intentId in NANSEN_TRADE_ACTIONS;
}

export function CapabilityRail() {
  const desk = useTradeDesk();
  const { cryptoCaps, walletKind, walletConfig } = desk;
  // The acting wallet's own provider — drives which managed rails are allowed to
  // badge its capabilities (so a personal wallet never shows UsePod/MoneyClaw).
  const actingProvider = walletKind === "bankr" ? "bankr" : String((walletConfig as Record<string, unknown> | null)?.provider || "").toLowerCase();
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
            {g.items.map((it) => (
              <button key={it.id} type="button" className="tk-tile" onClick={() => setActive(it.id)}>
                <ProviderBadge provider={isNansenTradeIntent(it.id) ? "nansen" : badgeProviderForIntent(cryptoCaps, it.id, actingProvider)} />
                <span className="ti"><BIcon name={INTENT_ICON[it.id] ?? "spark"} size={16} /></span>
                <b>{it.label}</b>
                <span>{it.desc}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// The last token a fee claim was submitted for persists across reloads (via
// shared dashboard state), so an owner who claims regularly doesn't retype it.
const CLAIM_FEES_TOKEN_STATE_KEY = "trade.claimFeesToken";

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
  // Chain fields are seeded/clamped to chains the user actually holds; the
  // claim-fees token is rehydrated (async) from the last submitted claim.
  const [values, setValues] = React.useState<Record<string, string>>(() => initFormValues(form, availableChains));
  const [savedClaimFeesToken, rememberClaimFeesToken] = useRememberedDashboardValue(CLAIM_FEES_TOKEN_STATE_KEY);
  // Seed the token when the remembered value hydrates, unless the user already
  // typed one — render-phase adjust, not an effect (react.dev guidance).
  const [seededClaimFeesToken, setSeededClaimFeesToken] = React.useState("");
  if (savedClaimFeesToken !== seededClaimFeesToken) {
    setSeededClaimFeesToken(savedClaimFeesToken);
    if (intent.id === "claim-fees" && savedClaimFeesToken && !values.token?.trim()) {
      setValues((current) => ({ ...current, token: savedClaimFeesToken }));
    }
  }
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
    if (outcome.ok) {
      playTradeSuccessSound();
      // Remember the token a claim was submitted for so the next visit pre-fills it.
      if (intent.id === "claim-fees" && values.token?.trim()) rememberClaimFeesToken(values.token.trim());
      desk.refresh();
    }
  };

  // Credits funds directly (no prepare step) — execute on the single Run button.
  const fundCredits = async () => {
    setBusy("execute");
    setResult(null);
    const outcome = await executeCapability(null, { intentId: "fund-llm-credits", amountUsd: Number(values.amt) || 0, token: values.token || "USDC" });
    setBusy(null);
    setResult(outcome);
    if (outcome.ok) { playTradeSuccessSound(); desk.refresh(); }
  };

  const modeToggle = hasHive ? (
    <span className="tk-otype tk-modeseg">
      <button type="button" data-active={mode === "build" ? "" : undefined} onClick={() => { setMode("build"); reset(); }}>Build</button>
      <button type="button" data-active={mode === "hive" ? "" : undefined} onClick={() => { setMode("hive"); reset(); }}>Ask hive</button>
    </span>
  ) : null;

  // ── special-case details ────────────────────────────────────────────────────
  // Copy trading is a persistent per-wallet/per-chain config, not a one-shot
  // prepare→execute action, so it owns its whole detail surface (must come
  // before the generic input === "info" branch below).
  if (intent.id === "copy-trading") {
    return (
      <DetailShell intent={intent} walletShort={wallet.short} onBack={onBack}>
        <CopyTradingPanel
          agentId={agentId}
          walletShort={wallet.short}
          walletAddress={wallet.fullAddress}
          walletKind={walletKind}
          custody={wallet.custody}
          network={wallet.network}
          walletChains={desk.walletChains}
          onSelectChain={desk.onSelectChain}
          onOpenView={onOpenView}
        />
      </DetailShell>
    );
  }

  if (isNansenTradeIntent(intent.id)) {
    return (
      <DetailShell intent={intent} walletShort="Nansen" onBack={onBack}>
        <NansenCapabilityPanel intentId={intent.id} />
      </DetailShell>
    );
  }

  if (intent.input === "address") {
    return (
      <DetailShell intent={intent} walletShort={wallet.short} onBack={onBack}>
        {wallet.fullAddress ? (
          <>
            <span className="lbl">Deposit address · {walletNetworkLabel(wallet.network)}</span>
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
            <BIcon name={busy === "execute" ? "spinner" : "bot"} size={14} spin={busy === "execute"} /> {busy === "execute" ? "Funding…" : "Fund credits"}
          </BBtn>
        ) : !isPrepared ? (
          <BBtn variant="primary" sm disabled={busy != null || !inputValid || !r.configured} onClick={review}>
            <BIcon name={busy === "prepare" ? "spinner" : "shield"} size={14} spin={busy === "prepare"} /> {busy === "prepare" ? "Reviewing…" : reviewLabel}
          </BBtn>
        ) : (
          <span style={{ display: "inline-flex", gap: 8 }}>
            <BBtn variant="ghost" sm disabled={busy != null} onClick={reset}>Edit</BBtn>
            <BBtn variant="primary" sm disabled={busy != null} onClick={execute}>
              <BIcon name={busy === "execute" ? "spinner" : "check"} size={14} spin={busy === "execute"} /> {busy === "execute" ? "Submitting…" : intent.mutating ? "Confirm & run" : "Run"}
            </BBtn>
          </span>
        )}
      </div>

      {result && !result.ok && result.error ? <p className="tk-error">{result.error}</p> : null}
      {result?.ok ? (
        <div className="tk-success">
          <ChatMarkdown text={result.message || "Submitted."} className="tk-md" />
          <div style={{ marginTop: 6 }}><button type="button" className="fw-manage" onClick={() => onOpenView("wallet")}>View in Wallets · Activity →</button></div>
        </div>
      ) : null}
    </DetailShell>
  );
}

type NansenDraftValues = {
  chain: string;
  tokenSymbol: string;
  tokenAddress: string;
  address: string;
  entityName: string;
  timeframe: string;
  labelType: string;
};

type NansenTokenOption = {
  symbol: string;
  name: string;
  address: string;
  source?: string;
};

const NANSEN_CHAIN_OPTIONS = [
  { value: "base", label: "Base" },
  { value: "ethereum", label: "Ethereum" },
  { value: "solana", label: "Solana" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "polygon", label: "Polygon" },
  { value: "bnb", label: "BNB Chain" },
];

const NANSEN_TIMEFRAME_OPTIONS = ["24h", "7d", "30d"] as const;
const NANSEN_HOLDER_LABEL_OPTIONS = [
  { value: "all_holders", label: "All holders" },
  { value: "smart_money", label: "Smart Money" },
  { value: "whale", label: "Whales" },
  { value: "exchange", label: "Exchanges" },
];
const STABLE_SYMBOLS = new Set(["USDC", "USDT", "USDG", "DAI", "PYUSD"]);

const NANSEN_TOP_WALLET_TOKEN_OPTIONS: Record<string, NansenTokenOption[]> = {
  base: [
    { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006" },
    { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" },
    { symbol: "AERO", name: "Aerodrome", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
  ],
  ethereum: [
    { symbol: "WETH", name: "Wrapped Ether", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
    { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    { symbol: "USDT", name: "Tether USD", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
    { symbol: "LINK", name: "Chainlink", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA" },
    { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" },
  ],
  arbitrum: [
    { symbol: "WETH", name: "Wrapped Ether", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" },
    { symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
    { symbol: "ARB", name: "Arbitrum", address: "0x912CE59144191C1204E64559FE8253a0e49E6548" },
  ],
  polygon: [
    { symbol: "WPOL", name: "Wrapped POL", address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270" },
    { symbol: "USDC", name: "USD Coin", address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" },
    { symbol: "WETH", name: "Wrapped Ether", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" },
  ],
  bnb: [
    { symbol: "WBNB", name: "Wrapped BNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" },
    { symbol: "USDT", name: "Tether USD", address: "0x55d398326f99059fF775485246999027B3197955" },
  ],
  solana: [
    { symbol: "SOL", name: "Wrapped SOL", address: "So11111111111111111111111111111111111111112" },
    { symbol: "USDC", name: "USD Coin", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    { symbol: "JUP", name: "Jupiter", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
    { symbol: "BONK", name: "Bonk", address: "DezXAZ8z7PnrnRJjz3HWqWTWwJpHTB1pPB263uLb263" },
  ],
};

function NansenCapabilityPanel({ intentId }: { intentId: NansenTradeIntentId }) {
  const desk = useTradeDesk();
  const action = NANSEN_TRADE_ACTIONS[intentId];
  const [values, setValues] = React.useState<NansenDraftValues>(() => initialNansenDraft(intentId, desk));
  const [busy, setBusy] = React.useState(false);
  const [brief, setBrief] = React.useState<TradeNansenInsightBrief | null>(null);
  const [error, setError] = React.useState("");
  const validation = validateNansenDraft(intentId, values);
  const topWalletTokenOptions = React.useMemo(
    () => nansenTopWalletTokenOptions(values.chain, desk.cryptoPortfolio.rows),
    [desk.cryptoPortfolio.rows, values.chain],
  );

  const setField = (key: keyof NansenDraftValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setBrief(null);
    setError("");
  };

  const run = async () => {
    const invalid = validateNansenDraft(intentId, values);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    setBrief(null);
    const request = buildNansenTemplateParams(intentId, values);
    const response = request.kind === "simple"
      ? await runNansenSimpleTemplate(request.params)
      : await runNansenComplexTemplate(request.params);
    setBusy(false);
    if (!response.ok || !response.brief) {
      setError(response.error || "Nansen did not return a brief.");
      return;
    }
    setBrief(response.brief);
  };

  return (
    <div className="tk-nansen">
      <div className="tk-form tk-nansen-form">
        {renderNansenFields(intentId, values, setField, topWalletTokenOptions)}
      </div>
      <p className="tk-nansen-note">
        These actions return derived HivemindOS research only. They do not place trades, copy wallets, or expose raw Nansen feeds.
      </p>
      <div className="sf">
        <span className="hint" style={brief ? { color: "var(--live)" } : validation ? { color: "var(--honey)" } : undefined}>
          {brief ? "Nansen brief ready" : validation || action.hint}
        </span>
        <BBtn variant="primary" sm disabled={busy || Boolean(validation)} onClick={run}>
          <BIcon name={busy ? "spinner" : "search"} size={14} spin={busy} /> {busy ? "Running research" : action.runLabel}
        </BBtn>
      </div>
      {error ? <p className="tk-error">{error}</p> : null}
      {brief ? <NansenBriefResult brief={brief} /> : null}
    </div>
  );
}

function renderNansenFields(
  intentId: NansenTradeIntentId,
  values: NansenDraftValues,
  setField: (key: keyof NansenDraftValues, value: string) => void,
  topWalletTokenOptions: NansenTokenOption[],
) {
  const chainField = (
    <label className="fb-label">
      Chain
      <select className="fb-select" value={values.chain} onChange={(event) => setField("chain", event.target.value)}>
        {NANSEN_CHAIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
  if (intentId === "nansen-defi-positions") {
    return (
      <label className="fb-label tk-nansen-full">
        Wallet address
        <input className="fb-field fb-mono" placeholder="0x..." value={values.address} onChange={(event) => setField("address", event.target.value.trim())} />
      </label>
    );
  }
  if (intentId === "nansen-smart-money-holdings") {
    return chainField;
  }
  if (intentId === "nansen-token-holders") {
    return (
      <>
        {chainField}
        <label className="fb-label">
          Holder lens
          <select className="fb-select" value={values.labelType} onChange={(event) => setField("labelType", event.target.value)}>
            {NANSEN_HOLDER_LABEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="fb-label tk-nansen-full">
          Token
          <input
            className="fb-field fb-mono"
            list="nansen-top-wallet-token-options"
            placeholder={values.chain === "solana" ? "Search token or paste mint..." : "Search token or paste contract..."}
            value={values.tokenAddress}
            onChange={(event) => setField("tokenAddress", event.target.value.trim())}
          />
          <datalist id="nansen-top-wallet-token-options">
            {topWalletTokenOptions.map((option) => (
              <option
                key={`${option.address}:${option.symbol}`}
                value={option.address}
                label={`${option.symbol} · ${option.name}${option.source ? ` · ${option.source}` : ""}`}
              />
            ))}
          </datalist>
        </label>
      </>
    );
  }
  if (intentId === "nansen-token-screener") {
    return (
      <>
        {chainField}
        <label className="fb-label">
          Timeframe
          <select className="fb-select" value={values.timeframe} onChange={(event) => setField("timeframe", event.target.value)}>
            {NANSEN_TIMEFRAME_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      </>
    );
  }
  if (intentId === "nansen-token-tracking") {
    return (
      <>
        {chainField}
        <label className="fb-label">
          Token symbol
          <input className="fb-field fb-mono" placeholder="HYPE" value={values.tokenSymbol} onChange={(event) => setField("tokenSymbol", event.target.value.toUpperCase())} />
        </label>
        <label className="fb-label tk-nansen-full">
          Token address (optional)
          <input className="fb-field fb-mono" placeholder="0x..." value={values.tokenAddress} onChange={(event) => setField("tokenAddress", event.target.value.trim())} />
        </label>
      </>
    );
  }
  if (intentId === "nansen-hyperliquid-wallets") {
    return (
      <label className="fb-label tk-nansen-full">
        Wallet address (optional)
        <input className="fb-field fb-mono" placeholder="0x..." value={values.address} onChange={(event) => setField("address", event.target.value.trim())} />
      </label>
    );
  }
  if (intentId === "nansen-related-wallets") {
    return (
      <>
        {chainField}
        <label className="fb-label tk-nansen-full">
          Wallet address
          <input className="fb-field fb-mono" placeholder="0x..." value={values.address} onChange={(event) => setField("address", event.target.value.trim())} />
        </label>
      </>
    );
  }
  if (intentId === "nansen-top-wallets") {
    return (
      <>
        {chainField}
        <label className="fb-label">
          Timeframe
          <select className="fb-select" value={values.timeframe} onChange={(event) => setField("timeframe", event.target.value)}>
            {NANSEN_TIMEFRAME_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="fb-label tk-nansen-full">
          Token address
          <input className="fb-field fb-mono" placeholder="0x..." value={values.tokenAddress} onChange={(event) => setField("tokenAddress", event.target.value.trim())} />
        </label>
      </>
    );
  }
  return (
    <>
      {chainField}
      <label className="fb-label">
        Entity
        <input className="fb-field" placeholder="Coinbase" value={values.entityName} onChange={(event) => setField("entityName", event.target.value)} />
      </label>
    </>
  );
}

function initialNansenDraft(intentId: NansenTradeIntentId, desk: ReturnType<typeof useTradeDesk>): NansenDraftValues {
  const chain = nansenChainForNetwork(desk.network);
  const preferredSymbol = desk.cryptoPortfolio.rows
    .map((row) => row.sym.toUpperCase())
    .find((symbol) => symbol && !STABLE_SYMBOLS.has(symbol)) ?? "";
  const walletAddress = desk.wallet.fullAddress || "";
  return {
    chain,
    tokenSymbol: intentId === "nansen-token-tracking" ? preferredSymbol : "",
    tokenAddress: "",
    address: intentId === "nansen-defi-positions"
      ? walletAddress
      : intentId === "nansen-related-wallets"
      ? walletAddress
      : intentId === "nansen-hyperliquid-wallets" && desk.isEvmWallet
        ? walletAddress
        : "",
    entityName: "Coinbase",
    timeframe: intentId === "nansen-token-screener" ? "24h" : "7d",
    labelType: "all_holders",
  };
}

function validateNansenDraft(intentId: NansenTradeIntentId, values: NansenDraftValues): string {
  if (intentId === "nansen-defi-positions" && !values.address.trim()) return "Enter a wallet address for DeFi positions.";
  if (intentId === "nansen-token-holders" && !values.tokenAddress.trim()) return "Enter a token contract address.";
  if (intentId === "nansen-related-wallets" && !values.address.trim()) return "Enter a wallet address to cluster.";
  if (intentId === "nansen-top-wallets" && !values.tokenAddress.trim()) return "Enter a token contract address to find top wallets.";
  if (intentId === "nansen-cex-health" && !values.entityName.trim()) return "Enter an exchange/entity name.";
  return "";
}

type BuiltNansenTemplateParams =
  | { kind: "simple"; params: TradeNansenSimpleTemplateParams }
  | { kind: "complex"; params: TradeNansenComplexTemplateParams };

function buildNansenTemplateParams(intentId: NansenTradeIntentId, values: NansenDraftValues): BuiltNansenTemplateParams {
  const action = NANSEN_TRADE_ACTIONS[intentId];
  const chain = values.chain.trim();
  const tokenSymbol = values.tokenSymbol.trim();
  const tokenAddress = values.tokenAddress.trim();
  const address = values.address.trim();
  const entityName = values.entityName.trim();
  if (action.kind === "simple") {
    if (intentId === "nansen-defi-positions") {
      return { kind: "simple", params: { template: action.template, address } };
    }
    if (intentId === "nansen-smart-money-holdings") {
      return { kind: "simple", params: { template: action.template, chain, chains: chain ? [chain] : undefined } };
    }
    if (intentId === "nansen-token-holders") {
      return {
        kind: "simple",
        params: {
          template: action.template,
          chain,
          tokenAddress,
          labelType: values.labelType || "all_holders",
          aggregateByEntity: false,
          premiumLabels: false,
        },
      };
    }
    return {
      kind: "simple",
      params: {
        template: action.template,
        chain,
        chains: chain ? [chain] : undefined,
        timeframe: values.timeframe || "24h",
        filters: { token_age_days: { max: 7 } },
      },
    };
  }
  if (intentId === "nansen-token-tracking") {
    return { kind: "complex", params: {
      template: action.template,
      chain,
      chains: chain ? [chain] : undefined,
      tokenSymbol: tokenSymbol || undefined,
      tokenAddress: tokenAddress || undefined,
    } };
  }
  if (intentId === "nansen-hyperliquid-wallets") {
    return { kind: "complex", params: { template: action.template, address: address || undefined } };
  }
  if (intentId === "nansen-related-wallets") {
    return { kind: "complex", params: {
      template: action.template,
      chain,
      address,
      includeLabels: true,
      includeHistoricalBalances: true,
      includeTransactions: true,
    } };
  }
  if (intentId === "nansen-top-wallets") {
    return { kind: "complex", params: {
      template: action.template,
      chain,
      chains: chain ? [chain] : undefined,
      tokenAddress,
      timeframe: values.timeframe || "7d",
    } };
  }
  return { kind: "complex", params: { template: action.template, chain, entityName: entityName || "Coinbase" } };
}

function nansenTopWalletTokenOptions(
  chain: string,
  portfolioRows: Array<{ id: string; sym: string; name: string; usd: number }>,
): NansenTokenOption[] {
  const seen = new Set<string>();
  const add = (options: NansenTokenOption[], option: NansenTokenOption) => {
    const address = option.address.trim();
    if (!address || !looksLikeNansenTokenAddress(chain, address)) return;
    const key = address.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    options.push(option);
  };
  const options: NansenTokenOption[] = [];
  for (const row of portfolioRows) {
    add(options, {
      symbol: row.sym,
      name: row.name || row.sym,
      address: row.id,
      source: row.usd > 0 ? "Held" : undefined,
    });
  }
  for (const option of NANSEN_TOP_WALLET_TOKEN_OPTIONS[chain] ?? []) add(options, option);
  return options;
}

function looksLikeNansenTokenAddress(chain: string, value: string) {
  const trimmed = value.trim();
  if (chain === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed);
}

function nansenChainForNetwork(network: string): string {
  if (network.includes("solana")) return "solana";
  if (network === "eip155:1") return "ethereum";
  if (network === "eip155:8453" || network === "eip155:84532") return "base";
  if (network === "eip155:42161") return "arbitrum";
  if (network === "eip155:137") return "polygon";
  return "base";
}

function NansenBriefResult({ brief }: { brief: TradeNansenInsightBrief }) {
  const tone = brief.status === "ok" ? "live" : brief.status === "blocked" ? "danger" : "honey";
  return (
    <div className="tk-nansen-result">
      <div className="tk-nansen-head">
        <Badge tone={tone}>{brief.status}</Badge>
        <span>{brief.subject}</span>
      </div>
      <p className="tk-nansen-summary">{brief.summary}</p>

      {brief.cards.length ? (
        <div className="tk-nansen-cards">
          {brief.cards.map((card) => (
            <article key={`${card.endpoint}:${card.title}`} className="tk-nansen-card">
              <b>{card.title}</b>
              {card.summary ? <p>{card.summary}</p> : null}
              {card.metrics.length ? (
                <div className="tk-nansen-metrics">
                  {card.metrics.map((metric) => (
                    <span key={`${card.endpoint}:${metric.label}`}>
                      <small>{metric.label}</small>
                      <strong>{metric.value}</strong>
                    </span>
                  ))}
                </div>
              ) : null}
              {card.observations.length ? (
                <ul>
                  {card.observations.map((observation, index) => <li key={`${card.endpoint}:obs:${index}`}>{observation}</li>)}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {brief.riskFlags.length ? (
        <div className="tk-nansen-callout" data-tone="risk">
          {brief.riskFlags.map((risk) => <span key={risk}>{risk}</span>)}
        </div>
      ) : null}

      {brief.nextQuestions.length ? (
        <div className="tk-nansen-next">
          <div className="tk-grouplbl">Next checks</div>
          {brief.nextQuestions.map((question) => <span key={question}>{question}</span>)}
        </div>
      ) : null}

      <details className="tk-nansen-sources">
        <summary>{brief.attribution.text}</summary>
        <div>
          {brief.sources.map((source) => (
            <span key={`${source.endpoint}:${source.label}`}>
              {source.label} · {source.endpoint} · {source.credits} credits
            </span>
          ))}
        </div>
      </details>
    </div>
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
