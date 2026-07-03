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
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import { fetchPersonalWalletBalance, fetchPersonalWalletBalanceResult, fetchPersonalWalletRecords } from "@/lib/native/personal-wallets";
import {
  TradeView, TradeDeskProvider,
  type TradeDeskData, type DeskWallet, type DeskMover, type DeskPortfolio, type DeskHolding, type DeskStockReadiness, type DeskWalletKind,
} from "@/components/trade";
import {
  buildCryptoPortfolio, buildStockPortfolio, cryptoBalancesFrom, cryptoPortfolioHistory,
  mapActivity, moverFromCrypto, moverFromStock, truncateAddress,
} from "@/components/trade/adapt-trade";
import {
  SWAP_MAX_USD, SWAP_TOKENS_BASE, SWAP_TOKENS_SOLANA,
  cancelStockOrder,
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
  account: null, xstockTickers: [], robinhoodTickers: [], robinhoodExecutable: false,
};

// The acting-wallet choice persists across view switches / reloads / app
// surfaces through the shared dashboard state service (the panel unmounts when
// you leave the Trade view, so without this it reset every time).
const LAST_TRADE_WALLET_STATE_KEY = "trade.actingWalletId";

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
  /** Persist a config change to an AGENT wallet (the shared dashboard handler).
      Used by the inline "Enable stock trading" flow for agent acting wallets;
      personal wallets persist through /api/wallet/personal instead. */
  updateWallet?: (agentId: string, patch: Partial<AgentWalletConfig>) => void;
};

export function TradePanel(props: TradePanelProps) {
  const agents = useMemo(() => (Array.isArray(props.displayAgents) ? props.displayAgents : []), [props.displayAgents]);
  const vaultPath = props.sharedVault?.enabled ? String(props.sharedVault.vaultPath || "").trim() : "";
  const [actingId, rememberActingWalletId] = useRememberedDashboardValue(LAST_TRADE_WALLET_STATE_KEY);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [personalWallets, setPersonalWallets] = useState<Array<Record<string, unknown>>>([]);
  const [personalBalancesLoading, setPersonalBalancesLoading] = useState(true);
  const [bankr, setBankr] = useState<BankrWalletInfo | null>(null);

  const [paper, setPaper] = useState(true);
  const [currency, setCurrency] = useState("USD");
  const [fxRates, setFxRates] = useState<Record<string, number>>({ USD: 1 });
  const [data, setData] = useState<DeskData | null>(null);
  const [loading, setLoading] = useState(true);
  // Orders the user just cancelled — hidden from the desk optimistically so the
  // pending row drops immediately, instead of lingering until Alpaca's open-order
  // list stops returning the just-cancelled order (eventual consistency). Pruned
  // once a fetch confirms the order is gone.
  const [cancelledOrders, setCancelledOrders] = useState<string[]>([]);
  // Orders the user just submitted — shown as a pending position IMMEDIATELY (at
  // the same moment as the order-placed confirmation) so the row doesn't lag the
  // 3-5s it takes Alpaca's open-order list to surface it. Reconciled away in the
  // data effect once the real open order (same id) appears, or after a timeout.
  const [optimisticOrders, setOptimisticOrders] = useState<Array<{ id: string; ticker: string; notionalUsd: number; side: "buy" | "sell"; ts: number }>>([]);
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
    rememberActingWalletId(id);
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
    if (target) rememberActingWalletId(target.id);
  }, [actingGroup, rememberActingWalletId]);

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
    const order = ["Base", "Base Sepolia", "Robinhood Chain", "Ethereum", "Arbitrum", "Optimism", "Polygon", "Solana"];
    return labels.sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }, [pickables]);

  // ── real data orchestration for the acting wallet ──────────────────────────
  // Tracks the wallet we've already loaded data for, so a manual refresh (after
  // a trade) or a paper/live toggle refetches IN THE BACKGROUND — keeping the
  // current desk (and the order ticket + its "Order placed" message) mounted —
  // instead of flashing the full DeskSkeleton, which unmounts the ticket and
  // reads as "the whole route reloaded". The skeleton is for first load / a
  // genuine wallet switch only.
  const loadedWalletRef = useRef<string>("");
  useEffect(() => {
    let ignore = false;
    const activeWallet = acting;
    void (async () => {
      if (!activeWallet) { if (!ignore) { setData(null); setLoading(false); loadedWalletRef.current = ""; } return; }
      const walletChanged = loadedWalletRef.current !== activeWallet.id;
      if (!ignore) setLoading(walletChanged);
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
      const robinhood = readiness?.venues.robinhoodChain;
      const paperConfigured = alpaca?.paper.configured ?? false;
      const liveConfigured = alpaca?.live.configured ?? false;
      const venueReady = venue === "alpaca"
        ? (paper ? paperConfigured : liveConfigured)
        : venue === "xstocks"
          ? true
          : venue === "robinhood-chain"
            ? Boolean(robinhood?.executable) && network === "eip155:4663"
            : false;
      const stockReadiness: DeskStockReadiness = {
        venue, liveEnabled, venueReady, paperConfigured, liveConfigured,
        paperKeys: alpaca?.paper.keys ?? ["ALPACA_PAPER_API_KEY_ID", "ALPACA_PAPER_API_SECRET_KEY"],
        liveKeys: alpaca?.live.keys ?? ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"],
        buyingPower: portfolio?.account.buyingPower ?? 0,
        confirmations: readiness?.confirmations ?? { buy: "CONFIRM_BUY", sell: "CONFIRM_SELL" },
        account: portfolio?.account ?? null,
        xstockTickers: readiness?.venues.xstocks.supportedTickers ?? [],
        robinhoodTickers: robinhood?.supportedTickers ?? [],
        robinhoodExecutable: Boolean(robinhood?.executable),
        robinhoodReason: robinhood?.reason,
      };

      // First load of an Alpaca wallet: the portfolio above was fetched with the
      // default paper mode, so a LIVE-configured wallet just pulled the $100k
      // PAPER account, not its real one. Flip to the wallet's persisted mode and
      // refetch BEFORE showing anything — the skeleton stays up, so the hero never
      // flashes the paper balance. Only on first load; an in-session manual
      // paper/live toggle (not first load) is respected.
      const wantPaper = !(venue === "alpaca" && liveEnabled);
      if (loadedWalletRef.current !== activeWallet.id && venue === "alpaca" && paper !== wantPaper) {
        if (!ignore) setPaper(wantPaper);
        return;
      }

      // activity (unified spend ledger)
      const activityRes = await fetchWalletActivity(100);
      const activity = mapActivity(activityRes.ok && activityRes.records ? activityRes.records : [], Date.now());

      if (ignore) return;
      setData({
        cryptoPortfolio, cryptoBalances, cryptoMovers, cryptoCaps: caps,
        stockPortfolio, stockMovers, stockReadiness, activity,
        network, isEvmWallet, isSolanaWallet,
      });
      loadedWalletRef.current = activeWallet.id;
      setLoading(false);
      // Reconcile optimistic order rows against the freshly-fetched open orders:
      // drop an optimistic row once the real open order (same id) represents it —
      // a seamless handoff — or after a short grace window for an order that
      // filled instantly and never appeared in the open-order list.
      const fetchedOpenIds = new Set(stockPortfolio.rows.filter((row) => row.pending && row.orderId).map((row) => row.orderId));
      const settledAt = Date.now();
      setOptimisticOrders((prev) => {
        if (!prev.length) return prev;
        const next = prev.filter((order) => !fetchedOpenIds.has(order.id) && settledAt - order.ts < 15000);
        return next.length === prev.length ? prev : next;
      });
    })();
    return () => { ignore = true; };
  }, [acting?.id, paper, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // (The paper/live toggle is initialized from the wallet's persisted mode inside
  // the data effect above — on first load it flips to the persisted mode and
  // refetches before showing data, so a live wallet reopens in live with no
  // paper-balance flash.)

  // ── handlers ───────────────────────────────────────────────────────────────
  const onOpenView = useCallback((view: string) => { props.setActiveView?.(view as DashboardView); }, [props]);
  const onChangeWallet = useCallback(() => setPickerOpen(true), []);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Auto-poll while a stock order is pending: re-fetch the portfolio every few
  // seconds so a just-submitted order flips from a pending row to a filled
  // position (and buying power updates) on its own — no manual refresh. Capped
  // (~2 min) so an order queued over a market close doesn't poll indefinitely;
  // the counter resets once nothing is pending, so the next order polls afresh.
  const pollCountRef = useRef(0);
  useEffect(() => {
    // Poll while a real order is pending OR an optimistic order is still awaiting
    // reconciliation, so the optimistic row reliably hands off to the real one.
    const pending = (data?.stockPortfolio?.rows?.some((row) => row.pending) ?? false) || optimisticOrders.length > 0;
    if (!pending) { pollCountRef.current = 0; return; }
    if (pollCountRef.current >= 24) return;
    const timer = window.setTimeout(() => { pollCountRef.current += 1; refresh(); }, 5000);
    return () => window.clearTimeout(timer);
  }, [data?.stockPortfolio, optimisticOrders, refresh]);

  // Turn on stock trading for the acting wallet by setting its venue. The trade
  // backend resolves the venue server-side from the wallet ledger keyed by this
  // wallet's id, so we persist there (not just in memory): agent wallets through
  // the shared updateWallet write-through, personal wallets through the personal
  // route (which now round-trips the venue). Bankr has no ledger record.
  const updateWallet = props.updateWallet;
  const onEnableStockVenue = useCallback(async (
    { venue, paper: enablePaper }: { venue: "alpaca" | "xstocks" | "robinhood-chain"; paper: boolean },
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!acting) return { ok: false, error: "Pick a wallet first." };
    const alpacaPaper = venue === "alpaca" ? enablePaper : undefined;
    // Trading requires a spend-enabled wallet: the buy-stock + platform-fee
    // rails reject a wallet with enabled !== true ("This agent's wallet is not
    // enabled."), so turning on trading must also flip the master spend switch.
    if (acting.kind === "agent") {
      if (!updateWallet) return { ok: false, error: "Wallet settings aren't available here." };
      updateWallet(acting.id, { tradingVenue: venue, alpacaPaper, enabled: true });
      if (venue === "alpaca") setPaper(enablePaper);
      refresh();
      return { ok: true };
    }
    if (acting.kind === "user") {
      const target = personalWallets.find((wallet) => String(wallet.id || wallet.agentId || "") === acting.id);
      if (!target) return { ok: false, error: "Couldn't find this wallet to update." };
      const updated = { ...target, tradingVenue: venue, alpacaPaper, enabled: true, updatedAt: Date.now() };
      setPersonalWallets((current) => current.map((wallet) => (String(wallet.id || wallet.agentId || "") === acting.id ? updated : wallet)));
      const response = await fetch("/api/wallet/personal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vaultPath: vaultPath || undefined, wallets: [updated] }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response?.ok || !data?.ok) return { ok: false, error: data?.error || "Couldn't save the trading venue." };
      if (venue === "alpaca") setPaper(enablePaper);
      refresh();
      return { ok: true };
    }
    return { ok: false, error: "Stock trading needs a personal or agent wallet — pick one in the wallet picker." };
  }, [acting, updateWallet, personalWallets, vaultPath, refresh]);

  // Cancel a pending Alpaca order (the pending-position cancel button), then
  // refresh so the row drops + buying power restores.
  const onCancelStockOrder = useCallback(async (orderId: string): Promise<{ ok: boolean; error?: string }> => {
    if (!acting) return { ok: false, error: "Pick a wallet first." };
    const response = await cancelStockOrder(acting.id, orderId, paper);
    if (response.ok) {
      // Drop the row now; re-arm the poll budget so the background refresh
      // reconciles even if polling had already hit its cap while pending.
      setCancelledOrders((prev) => (prev.includes(orderId) ? prev : [...prev, orderId]));
      pollCountRef.current = 0;
      refresh();
    }
    return { ok: response.ok, error: response.error };
  }, [acting, paper, refresh]);

  // Show a just-submitted order as a pending position immediately (called by the
  // order ticket on a successful place), so the row appears with the confirmation
  // rather than 3-5s later when Alpaca's open-order list catches up.
  const onOptimisticStockOrder = useCallback((order: { orderId: string; ticker: string; notionalUsd: number; side: "buy" | "sell" }) => {
    if (!order.orderId || !order.ticker) return;
    setOptimisticOrders((prev) => (prev.some((entry) => entry.id === order.orderId)
      ? prev
      : [...prev, { id: order.orderId, ticker: order.ticker, notionalUsd: order.notionalUsd, side: order.side, ts: Date.now() }]));
    pollCountRef.current = 0;
    refresh();
  }, [refresh]);

  // Display portfolio with just-cancelled pending orders filtered out (optimistic).
  // The auto-poll still reads the RAW data so it keeps reconciling until Alpaca
  // drops the order from its open-order list; once gone, the hidden id matches no
  // row and is simply inert (order ids are unique and never reused), so the set
  // needs no pruning.
  const displayStockPortfolio = useMemo(() => {
    const pf = data?.stockPortfolio ?? EMPTY_PORTFOLIO;
    const hidden = new Set(cancelledOrders);
    let rows = hidden.size ? pf.rows.filter((row) => !(row.pending && row.orderId && hidden.has(row.orderId))) : pf.rows;
    if (optimisticOrders.length) {
      // Only add an optimistic row while the REAL open order for it hasn't yet
      // appeared (dedup by id) and it wasn't just cancelled — so the optimistic
      // row hands off to the real pending row with no flicker or duplicate.
      const realPendingIds = new Set(rows.filter((row) => row.pending && row.orderId).map((row) => row.orderId));
      const optimisticRows: DeskHolding[] = optimisticOrders
        .filter((order) => !realPendingIds.has(order.id) && !hidden.has(order.id))
        .map((order) => ({ id: `opt:${order.id}`, sym: order.ticker, name: order.ticker, amount: 0, usd: order.notionalUsd, chg: 0, pending: true, status: "accepted", side: order.side, orderId: order.id }));
      if (optimisticRows.length) rows = [...optimisticRows, ...rows];
    }
    return rows === pf.rows ? pf : { ...pf, rows };
  }, [data?.stockPortfolio, cancelledOrders, optimisticOrders]);

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
      stockPortfolio: displayStockPortfolio,
      stockMovers: data?.stockMovers ?? [],
      stockReadiness: data?.stockReadiness ?? EMPTY_READINESS,
      paper,
      setPaper,
      onEnableStockVenue,
      onCancelStockOrder,
      onOptimisticStockOrder,
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
  }, [acting, wallet, walletChains, onSelectChain, availableChains, data, loading, paper, currency, fxRates, actors, props.theme, onChangeWallet, onOpenView, refresh, onEnableStockVenue, onCancelStockOrder, onOptimisticStockOrder, displayStockPortfolio]);

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
