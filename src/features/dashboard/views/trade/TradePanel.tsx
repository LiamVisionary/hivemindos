"use client";

/* TradePanel — the Trade route. Renders the redesigned Trade desk
   (@/components/trade) fed entirely with REAL data:

     • acting wallet      — the unified pickable list (your wallets, the Bankr
                            trading wallet, configured agents) + WalletSelectModal.
     • crypto holdings    — live /api/wallet/balance tokens for the acting wallet.
     • crypto market      — live prices / 24h / price-history sparklines + a real
                            portfolio value curve (Σ holding × price history).
     • crypto rails       — the capability router (prepare→execute), the local DEX
                            swap, and the full Hyperliquid form + practice book.
     • stocks             — Alpaca readiness + portfolio + live snapshots/bars.
     • FX                 — real USD→currency rates for the display toggle.
     • activity           — the unified spend-ledger feed.

   The order tickets + capability rail call the real trade-api rails directly;
   this panel builds the dataset + owns the wallet picker. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import type { DashboardActingWallet } from "@/features/dashboard/screen-context";
import type { SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentSurvivalSnapshot, AgentWalletConfig } from "@/lib/types/agent-wallet";
import { createDefaultAgentWallet, hasConfiguredAgentWallet } from "@/lib/utils/agent-wallet";
import { fetchPersonalWalletBalance, fetchPersonalWalletBalanceResult, fetchPersonalWalletRecords } from "@/lib/native/personal-wallets";
import {
  TradeView, TradeDeskProvider,
  type TradeDeskData, type DeskWallet, type DeskMover, type DeskPortfolio, type DeskStockReadiness, type DeskWalletKind,
} from "@/components/trade";
import {
  buildCryptoPortfolio, buildStockPortfolio, cryptoBalancesFrom, cryptoPortfolioHistory,
  mapActivity, moverFromCrypto, moverFromStock, truncateAddress,
} from "@/components/trade/adapt-trade";
import {
  SWAP_MAX_USD, SWAP_TOKENS_BASE, SWAP_TOKENS_SOLANA,
  fetchBankrWallet, fetchCryptoCapabilities, fetchCryptoMarket, fetchFxRates, fetchStockEquityHistory,
  fetchStockMarket, fetchStockPortfolio, fetchTradingReadiness, fetchWalletActivity,
  type BankrWalletInfo, type CryptoCapabilityMap,
} from "./trade-api";
import { WalletSelectModal, type PickableWallet } from "./WalletSelectModal";
import { agentPickable, groupedUserPickables, isSelectablePickableId, resolvePickableAccount, type PickableAgent } from "./wallet-pickables";
import { chainKeyForNetwork, chainLabelForNetwork } from "@/lib/utils/personal-wallet-grouping";

type TradeAgent = PickableAgent;

const STOCK_MOVERS = ["NVDA", "TSLA", "MSTR", "COIN", "AAPL", "SPY"];
const STOCK_NAMES: Record<string, string> = {
  NVDA: "NVIDIA", TSLA: "Tesla", MSTR: "MicroStrategy", COIN: "Coinbase", AAPL: "Apple",
  SPY: "S&P 500 ETF", QQQ: "Nasdaq 100", MSFT: "Microsoft", AMZN: "Amazon", HOOD: "Robinhood",
};

type DeskData = {
  cryptoPortfolio: DeskPortfolio;
  cryptoBalances: Record<string, number>;
  cryptoMovers: DeskMover[];
  cryptoCaps: CryptoCapabilityMap | null;
  stockPortfolio: DeskPortfolio;
  stockMovers: DeskMover[];
  stockReadiness: DeskStockReadiness;
  activity: TradeDeskData["activity"];
  network: string;
  isEvmWallet: boolean;
  isSolanaWallet: boolean;
};

const EMPTY_PORTFOLIO: DeskPortfolio = { rows: [], total: 0, dayChange: 0, dayPct: 0, history: [] };
const EMPTY_READINESS: DeskStockReadiness = {
  venue: null, liveEnabled: false, venueReady: false, paperConfigured: false, liveConfigured: false,
  paperKeys: [], liveKeys: [], buyingPower: 0, confirmations: { buy: "CONFIRM_BUY", sell: "CONFIRM_SELL" },
  account: null, xstockTickers: [],
};

// The acting-wallet choice persists across view switches / reloads — the panel
// unmounts when you leave the Trade view, so without this it reset every time.
// Mirrors SwarmPanel's per-feature wallet memory.
const LAST_TRADE_WALLET_KEY = "hivemindos.trade.actingWalletId.v1";
function readLastTradeWalletId(): string {
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem(LAST_TRADE_WALLET_KEY) || ""; } catch { return ""; }
}
function writeLastTradeWalletId(id: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LAST_TRADE_WALLET_KEY, id); } catch { /* quota — best effort */ }
}

type TradePanelProps = {
  displayAgents?: TradeAgent[];
  walletsByAgent?: Record<string, unknown>;
  selectedAgent?: { id?: string } | null;
  setSelectedAgentId?: (id: string) => void;
  setActiveView?: (view: DashboardView) => void;
  getSurvivalSnapshot?: (wallet: AgentWalletConfig) => AgentSurvivalSnapshot;
  sharedVault?: SharedVaultConfig;
  theme?: "light" | "dark";
  /** Report the currently-selected acting wallet up to the dashboard so the
      app-wide hive chat can default wallet/trade actions to it. */
  onActingWalletChange?: (wallet: DashboardActingWallet | null) => void;
};

export function TradePanel(props: TradePanelProps) {
  const agents = useMemo(() => (Array.isArray(props.displayAgents) ? props.displayAgents : []), [props.displayAgents]);
  const vaultPath = props.sharedVault?.enabled ? String(props.sharedVault.vaultPath || "").trim() : "";
  const [actingId, setActingId] = useState<string>(() => readLastTradeWalletId());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [personalWallets, setPersonalWallets] = useState<Array<Record<string, unknown>>>([]);
  const [personalBalancesLoading, setPersonalBalancesLoading] = useState(true);
  const [bankr, setBankr] = useState<BankrWalletInfo | null>(null);

  const [paper, setPaper] = useState(true);
  const [currency, setCurrency] = useState("USD");
  const [fxRates, setFxRates] = useState<Record<string, number>>({ USD: 1 });
  const [data, setData] = useState<DeskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // ── pickable wallets (unchanged behaviour) ─────────────────────────────────
  useEffect(() => {
    let ignore = false;
    void (async () => {
      setPersonalBalancesLoading(true);
      const list = await fetchPersonalWalletRecords(vaultPath);
      if (ignore) return;
      setPersonalWallets(list);
      const refreshed = await Promise.all(list.map(async (record) => {
        const address = String(record.address || "").trim();
        const network = String(record.network || "").trim();
        if (!address || !network) return record;
        const balance = await fetchPersonalWalletBalance(address, network);
        return balance
          ? { ...record, currentBalanceUsd: balance.currentBalanceUsd, nativeBalance: balance.nativeBalance, tokens: balance.tokens, lastOnchainSyncAt: balance.lastOnchainSyncAt }
          : record;
      }));
      if (ignore) return;
      setPersonalWallets(refreshed);
      setPersonalBalancesLoading(false);
    })();
    return () => { ignore = true; };
  }, [vaultPath]);

  useEffect(() => {
    let ignore = false;
    void fetchBankrWallet().then((info) => { if (!ignore) setBankr(info); });
    return () => { ignore = true; };
  }, []);

  // FX rates are wallet-independent — load once.
  useEffect(() => {
    let ignore = false;
    void fetchFxRates().then((response) => { if (!ignore && response.ok && response.rates) setFxRates(response.rates); });
    return () => { ignore = true; };
  }, []);

  const pickables = useMemo<PickableWallet[]>(() => {
    const user = groupedUserPickables(personalWallets)
      .map((p) => ({ ...p, pending: personalBalancesLoading }));
    const bankrPickable: PickableWallet | null = bankr?.configured ? {
      id: "bankr",
      name: "Bankr trading wallet",
      kind: "bankr",
      wallet: {
        ...createDefaultAgentWallet("bankr"),
        walletAddress: bankr.address || "",
        network: "eip155:8453",
        enabled: true,
        currentBalanceUsd: Number(bankr.balanceUsd) || 0,
      } as AgentWalletConfig,
      statusOverride: { tone: "ok", text: "Bankr-managed" },
    } : null;
    const agentPickables = agents
      .map((agent): PickableWallet => agentPickable(agent, props.walletsByAgent))
      .filter((p) => hasConfiguredAgentWallet({ usePod: p.usePod } as Parameters<typeof hasConfiguredAgentWallet>[0], p.wallet) && !(p.wallet as { setupRequired?: boolean }).setupRequired);
    return [...user, ...(bankrPickable ? [bankrPickable] : []), ...agentPickables];
  }, [personalWallets, personalBalancesLoading, bankr, agents, props.walletsByAgent]);

  const defaultId = (props.selectedAgent?.id && pickables.some((p) => p.id === props.selectedAgent!.id))
    ? props.selectedAgent.id
    : (pickables[0]?.id || "");
  const resolvedId = actingId && isSelectablePickableId(pickables, actingId) ? actingId : defaultId;
  // Memoized: resolvePickableAccount builds a FRESH object for a grouped per-chain
  // user wallet, so without this `acting` changes identity every render — which
  // re-fires the report-acting effect → parent setState → infinite render loop.
  const acting = useMemo(() => resolvePickableAccount(pickables, resolvedId), [pickables, resolvedId]);

  const pickWallet = (id: string) => {
    setActingId(id);
    writeLastTradeWalletId(id);
    if (resolvePickableAccount(pickables, id)?.kind === "agent") props.setSelectedAgentId?.(id);
  };

  // Chains the ACTING wallet holds — drives the in-action chain dropdown. For a
  // grouped user wallet these are its per-chain accounts; for a single-chain
  // agent/bankr wallet it's just the one chain. Switching chain re-points the
  // acting account so network/tokens/execution follow.
  // Memoized so the dataset (and thus the whole desk tree) doesn't re-render on
  // every render from a fresh array / function identity.
  const actingGroup = useMemo(
    () => pickables.find((p) => p.kind === "user" && (p.accounts ?? []).some((a) => a.id === resolvedId)) ?? null,
    [pickables, resolvedId],
  );
  const walletChains = useMemo(
    () => actingGroup?.accounts?.length
      ? actingGroup.accounts.map((a) => ({ key: a.chainKey, label: chainLabelForNetwork(a.network), network: a.network, accountId: a.id }))
      : acting
        ? [{ key: chainKeyForNetwork(String((acting.wallet as unknown as Record<string, unknown>).network || "")), label: chainLabelForNetwork(String((acting.wallet as unknown as Record<string, unknown>).network || "")), network: String((acting.wallet as unknown as Record<string, unknown>).network || ""), accountId: acting.id }]
        : [],
    [actingGroup, acting],
  );
  // A chain switch always targets a user wallet's per-chain account (never an
  // agent), so it just re-points actingId + persists — no global agent sync.
  const onSelectChain = useCallback((net: string) => {
    const target = actingGroup?.accounts?.find((a) => a.network === net);
    if (target) { setActingId(target.id); writeLastTradeWalletId(target.id); }
  }, [actingGroup]);

  // Every chain the user actually has access to — derived from the resolved
  // pickable wallets themselves (personal per-chain accounts + each configured
  // agent wallet's network + Bankr), so the bridge / cross-chain dropdowns offer
  // exactly the user's chains and nothing hardcoded.
  const availableChains = useMemo<string[]>(() => {
    const labels: string[] = [];
    const add = (network: unknown) => {
      const label = chainLabelForNetwork(String(network || "").trim());
      if (label && !labels.includes(label)) labels.push(label);
    };
    for (const p of pickables) {
      if (p.accounts?.length) p.accounts.forEach((a) => add(a.network));
      else add((p.wallet as unknown as Record<string, unknown>)?.network);
    }
    const order = ["Base", "Base Sepolia", "Ethereum", "Arbitrum", "Optimism", "Polygon", "Solana"];
    return labels.sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }, [pickables]);

  // ── real data orchestration for the acting wallet ──────────────────────────
  useEffect(() => {
    let ignore = false;
    const activeWallet = acting;
    void (async () => {
      if (!activeWallet) { if (!ignore) { setData(null); setLoading(false); } return; }
      if (!ignore) setLoading(true);
      const agentId = activeWallet.id;
      const walletConfig = activeWallet.wallet as unknown as Record<string, unknown>;
      const address = String(walletConfig.walletAddress || walletConfig.vaultAddress || walletConfig.address || "").trim();
      const network = String(walletConfig.network || "");
      const isSolanaWallet = network.includes("solana");
      const isEvmWallet = network.startsWith("eip155:");

      // crypto: balance tokens + capability map
      const [balanceResult, caps] = await Promise.all([
        address && network ? fetchPersonalWalletBalanceResult(address, network) : Promise.resolve(null),
        fetchCryptoCapabilities(agentId, walletConfig),
      ]);
      const balance = balanceResult?.ok ? balanceResult.balance : null;
      // A FAILED live read (RPC timeout / rate-limit / no server) must not render
      // as a confident $0.00 — that's indistinguishable from an empty wallet. Only
      // flag when a read was actually attempted (address+network present) and failed.
      const cryptoBalanceError = balanceResult && !balanceResult.ok ? (balanceResult.error || "Couldn't load this wallet's balance.") : null;
      const tokens = (balance?.tokens ?? (Array.isArray(walletConfig.tokens) ? (walletConfig.tokens as Array<Record<string, unknown>>) : [])) as Parameters<typeof cryptoBalancesFrom>[0];
      const cryptoBalances = cryptoBalancesFrom(tokens);
      const heldSymbols = Object.keys(cryptoBalances);
      const cryptoMoversList = isSolanaWallet ? ["SOL", "ETH", "HYPE", "HIVE", "USDC"] : ["BTC", "ETH", "SOL", "HYPE", "HIVE"];
      const cryptoMarket = await fetchCryptoMarket([...new Set([...cryptoMoversList, ...heldSymbols])], "24h");
      const cryptoRows = cryptoMarket.ok && cryptoMarket.rows ? cryptoMarket.rows : [];
      const cryptoPortfolio: DeskPortfolio = { ...buildCryptoPortfolio(tokens, cryptoPortfolioHistory(cryptoBalances, cryptoRows)), error: cryptoBalanceError };
      const cryptoMovers: DeskMover[] = cryptoMoversList
        .map((sym) => cryptoRows.find((row) => row.symbol === sym))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .map(moverFromCrypto);

      // stocks: readiness + portfolio + live snapshots/bars + equity history
      const [readiness, stockPf] = await Promise.all([fetchTradingReadiness(), fetchStockPortfolio(agentId, paper)]);
      const portfolio = stockPf.ok ? (stockPf.portfolio ?? null) : null;
      const heldTickers = (portfolio?.positions ?? []).map((position) => position.symbol);
      const [heldSnaps, equityHistory, stockMoverRes] = await Promise.all([
        heldTickers.length ? fetchStockMarket(heldTickers, paper, "24h", false) : Promise.resolve({ ok: true, rows: [] as Awaited<ReturnType<typeof fetchStockMarket>>["rows"] }),
        fetchStockEquityHistory(paper, "30d"),
        fetchStockMarket(STOCK_MOVERS, paper, "24h", true),
      ]);
      const snapshotChg: Record<string, number> = {};
      for (const row of (heldSnaps.ok && heldSnaps.rows ? heldSnaps.rows : [])) snapshotChg[row.symbol] = row.change24h;
      const stockPortfolio = buildStockPortfolio(portfolio, snapshotChg, equityHistory.ok && equityHistory.history ? equityHistory.history : []);
      const stockMovers: DeskMover[] = (stockMoverRes.ok && stockMoverRes.rows ? stockMoverRes.rows : []).map((row) => moverFromStock(row, STOCK_NAMES[row.symbol] || row.symbol));

      // stock readiness shape
      const tradeAgent = readiness?.agents.find((entry) => entry.agentId === agentId) ?? null;
      const venue = (tradeAgent?.venue ?? (walletConfig.tradingVenue as DeskStockReadiness["venue"])) ?? null;
      const liveEnabled = tradeAgent?.liveEnabled ?? (walletConfig.alpacaPaper === false);
      const alpaca = readiness?.venues.alpaca;
      const paperConfigured = alpaca?.paper.configured ?? false;
      const liveConfigured = alpaca?.live.configured ?? false;
      const venueReady = venue === "alpaca" ? (paper ? paperConfigured : liveConfigured) : venue === "xstocks";
      const stockReadiness: DeskStockReadiness = {
        venue, liveEnabled, venueReady, paperConfigured, liveConfigured,
        paperKeys: alpaca?.paper.keys ?? ["ALPACA_PAPER_API_KEY_ID", "ALPACA_PAPER_API_SECRET_KEY"],
        liveKeys: alpaca?.live.keys ?? ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"],
        buyingPower: portfolio?.account.buyingPower ?? 0,
        confirmations: readiness?.confirmations ?? { buy: "CONFIRM_BUY", sell: "CONFIRM_SELL" },
        account: portfolio?.account ?? null,
        xstockTickers: readiness?.venues.xstocks.supportedTickers ?? [],
      };

      // activity (unified spend ledger)
      const activityRes = await fetchWalletActivity(100);
      const activity = mapActivity(activityRes.ok && activityRes.records ? activityRes.records : [], Date.now());

      if (ignore) return;
      setData({
        cryptoPortfolio, cryptoBalances, cryptoMovers, cryptoCaps: caps,
        stockPortfolio, stockMovers, stockReadiness, activity,
        network, isEvmWallet, isSolanaWallet,
      });
      setLoading(false);
    })();
    return () => { ignore = true; };
  }, [acting?.id, paper, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── handlers ───────────────────────────────────────────────────────────────
  const onOpenView = useCallback((view: string) => { props.setActiveView?.(view as DashboardView); }, [props]);
  const onChangeWallet = useCallback(() => setPickerOpen(true), []);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // executor id → display name + kind, for the activity attribution chips.
  const actors = useMemo<Record<string, { name: string; kind: DeskWalletKind }>>(() => {
    const map: Record<string, { name: string; kind: DeskWalletKind }> = { bankr: { name: "Bankr", kind: "bankr" } };
    for (const wallet of personalWallets) {
      const id = String(wallet.id || wallet.agentId || "").trim();
      if (id) map[id] = { name: String(wallet.name || "My wallet"), kind: "user" };
    }
    for (const agent of agents) map[agent.id] = { name: agent.name || agent.id, kind: "agent" };
    return map;
  }, [personalWallets, agents]);

  // ── desk wallet identity ───────────────────────────────────────────────────
  const wallet = useMemo<DeskWallet>(() => {
    if (!acting) return { id: "", name: "", short: "", kind: "user", custody: "", addr: "", fullAddress: "", network: "", cap: null };
    const config = acting.wallet as unknown as Record<string, unknown>;
    const fullAddress = String(config.walletAddress || config.vaultAddress || config.address || "").trim();
    const network = String(config.network || "");
    const kind = acting.kind as DeskWalletKind;
    const custody = kind === "bankr" ? "Bankr-managed"
      : kind === "agent" ? "governed agent"
      : config.custodyMode === "local" ? "local signer" : "watch only";
    const cap = kind === "user" ? null : (Number(config.maxTradeUsd) || Number(config.maxPaymentUsd) || null);
    // Drop the " · Network" suffix for the short chip (e.g. "My wallet · Base" →
    // "My wallet"); only hard-truncate a genuinely long remaining name.
    const short = (acting.name.split(/\s*·\s*/)[0].trim() || acting.name).slice(0, 22);
    return { id: acting.id, name: acting.name, short, kind, custody, addr: truncateAddress(fullAddress), fullAddress, network, cap };
  }, [acting]);

  // Report the acting wallet up to the dashboard (kept in a ref so the effect
  // doesn't churn when the parent re-creates the callback) so the app-wide hive
  // chat defaults wallet/trade actions to it. Cleared on unmount.
  const reportActingRef = useRef(props.onActingWalletChange);
  useEffect(() => { reportActingRef.current = props.onActingWalletChange; }, [props.onActingWalletChange]);
  useEffect(() => {
    reportActingRef.current?.(acting ? {
      id: wallet.id || undefined,
      label: wallet.name || wallet.short || "Acting wallet",
      kind: wallet.kind,
      provider: wallet.kind === "bankr" ? "bankr" : (String((acting.wallet as unknown as Record<string, unknown>)?.provider || "") || undefined),
      network: wallet.network || undefined,
      networkLabel: chainLabelForNetwork(wallet.network),
      address: wallet.fullAddress || undefined,
      custody: wallet.custody || undefined,
      capUsd: wallet.cap,
    } : null);
  }, [wallet, acting]);
  useEffect(() => () => reportActingRef.current?.(null), []);

  const dataset = useMemo<TradeDeskData>(() => {
    const network = data?.network ?? wallet.network;
    const isSolanaWallet = data?.isSolanaWallet ?? network.includes("solana");
    return {
      agentId: acting?.id ?? "",
      wallet,
      walletConfig: (acting?.wallet as unknown as Record<string, unknown>) ?? null,
      walletKind: wallet.kind,
      network,
      isEvmWallet: data?.isEvmWallet ?? network.startsWith("eip155:"),
      isSolanaWallet,
      hasActingWallet: Boolean(acting),
      walletChains,
      onSelectChain,
      availableChains,
      loading,
      cryptoPortfolio: data?.cryptoPortfolio ?? EMPTY_PORTFOLIO,
      cryptoBalances: data?.cryptoBalances ?? {},
      cryptoMovers: data?.cryptoMovers ?? [],
      swapTokens: isSolanaWallet ? SWAP_TOKENS_SOLANA : SWAP_TOKENS_BASE,
      swapMaxUsd: SWAP_MAX_USD,
      cryptoCaps: data?.cryptoCaps ?? null,
      stockPortfolio: data?.stockPortfolio ?? EMPTY_PORTFOLIO,
      stockMovers: data?.stockMovers ?? [],
      stockReadiness: data?.stockReadiness ?? EMPTY_READINESS,
      paper,
      setPaper,
      activity: data?.activity ?? [],
      actors,
      currency,
      fxRates,
      setCurrency,
      theme: props.theme === "light" ? "light" : "dark",
      onChangeWallet,
      onOpenView,
      refresh,
    };
  }, [acting, wallet, walletChains, onSelectChain, availableChains, data, loading, paper, currency, fxRates, actors, props.theme, onChangeWallet, onOpenView, refresh]);

  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      <TradeDeskProvider value={dataset}>
        <TradeView />
      </TradeDeskProvider>

      {pickerOpen ? (
        <WalletSelectModal
          pickables={pickables}
          getSurvivalSnapshot={props.getSurvivalSnapshot ?? (() => ({}) as AgentSurvivalSnapshot)}
          currentId={resolvedId}
          onConfirm={pickWallet}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}

export default TradePanel;
