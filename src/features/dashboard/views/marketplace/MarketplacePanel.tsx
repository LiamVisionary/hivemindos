"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { DashboardRouteTarget } from "@/features/dashboard/dashboard-navigation";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import type {
  MarketplaceAccount,
  MarketplaceConversation,
  MarketplaceDecision,
  MarketplaceDirective,
  MarketplaceListing,
  MarketplaceProviderCapabilityDto,
} from "@/lib/services/marketplace/marketplace-types";

import { MarketplaceDeskProvider, type MarketplaceActionResult, type MarketplaceDeskData, type MarketplaceTab } from "./marketplace-context";
import { MarketplaceView } from "./MarketplaceView";
import "./theme.css";

const ACTIVE_ACCOUNT_STATE_KEY = "marketplace.activeAccountId";
const LISTINGS_POLL_MS = 30_000;

type AccountsPayload = {
  ok: boolean;
  error?: string;
  accounts?: MarketplaceAccount[];
  providers?: MarketplaceProviderCapabilityDto[];
  directives?: MarketplaceDirective[];
  monitorStatus?: MarketplaceDeskData["monitorStatus"];
};

type ListingsPayload = {
  ok: boolean;
  error?: string;
  listings?: MarketplaceListing[];
  conversations?: MarketplaceConversation[];
};

type DecisionsPayload = { ok: boolean; error?: string; decisions?: MarketplaceDecision[] };

async function postJson(url: string, body: Record<string, unknown>): Promise<MarketplaceActionResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json()) as Record<string, unknown> & { ok?: boolean; error?: string };
    return parsed.ok
      ? { ...parsed, ok: true }
      : { ...parsed, ok: false, error: parsed.error ?? `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Marketplace desk container: owns fetch/state, provides one memoized dataset (Socials triad pattern). */
export function MarketplacePanel({ theme, onNavigate }: { theme: "light" | "dark"; onNavigate?: (target: DashboardRouteTarget) => void }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([]);
  const [providers, setProviders] = useState<MarketplaceProviderCapabilityDto[]>([]);
  const [directives, setDirectives] = useState<MarketplaceDirective[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [conversations, setConversations] = useState<MarketplaceConversation[]>([]);
  const [decisions, setDecisions] = useState<MarketplaceDecision[]>([]);
  const [monitorStatus, setMonitorStatus] = useState<MarketplaceDeskData["monitorStatus"]>({});
  const [connectOpen, setConnectOpen] = useState(false);
  const [listingModal, setListingModal] = useState<{ open: boolean; listingId?: string }>({ open: false });
  const [rememberedActiveId, rememberActiveId] = useRememberedDashboardValue(ACTIVE_ACCOUNT_STATE_KEY);
  // Deliberately NOT remembered: the view always opens on Catalog — the hub —
  // instead of whatever tab the last visit ended on (e.g. Settings after
  // connecting, which made every later open land on Settings).
  const [activeTab, setActiveTab] = useState<MarketplaceTab>("catalog");

  const load = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "refresh") setRefreshing(true);
    try {
      const [accountsRes, listingsRes, decisionsRes] = await Promise.all([
        fetch("/api/marketplace/accounts", { cache: "no-store" }),
        fetch("/api/marketplace/listings", { cache: "no-store" }),
        fetch("/api/marketplace/decisions?status=pending", { cache: "no-store" }),
      ]);
      const accountsPayload = (await accountsRes.json()) as AccountsPayload;
      const listingsPayload = (await listingsRes.json()) as ListingsPayload;
      const decisionsPayload = (await decisionsRes.json()) as DecisionsPayload;
      if (!accountsPayload.ok) {
        setError(accountsPayload.error ?? `HTTP ${accountsRes.status}`);
        return;
      }
      setError(null);
      setAccounts(accountsPayload.accounts ?? []);
      setProviders(accountsPayload.providers ?? []);
      setDirectives(accountsPayload.directives ?? []);
      setMonitorStatus(accountsPayload.monitorStatus ?? {});
      if (listingsPayload.ok) {
        setListings(listingsPayload.listings ?? []);
        setConversations(listingsPayload.conversations ?? []);
      }
      if (decisionsPayload.ok) setDecisions(decisionsPayload.decisions ?? []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Deferred kickoff (set-state-in-effect rule) + a steady poll while mounted.
    const timer = window.setTimeout(() => void load("initial"), 0);
    const interval = window.setInterval(() => void load("refresh"), LISTINGS_POLL_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [load]);

  const activeAccountId = useMemo(() => {
    if (accounts.some((account) => account.id === rememberedActiveId)) return rememberedActiveId;
    return accounts[0]?.id ?? "";
  }, [accounts, rememberedActiveId]);

  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null;

  const runAccountsAction = useCallback(async (body: Record<string, unknown>) => {
    const result = await postJson("/api/marketplace/accounts", body);
    if (!result.ok) setError(result.error ?? "Action failed");
    await load("refresh");
    return result;
  }, [load]);

  const runListingsAction = useCallback(async (body: Record<string, unknown>) => {
    const result = await postJson("/api/marketplace/listings", body);
    if (!result.ok) setError(result.error ?? "Action failed");
    await load("refresh");
    return result;
  }, [load]);

  const decideDecision = useCallback(async (id: string, decision: "approved" | "denied", note: string, makeDirective: boolean) => {
    // Optimistically drop the decided card (use-spend-approvals pattern); the
    // refresh reconciles.
    setDecisions((current) => current.filter((candidate) => candidate.id !== id));
    const result = await postJson("/api/marketplace/decisions", { action: "decide", id, decision, note, makeDirective });
    if (!result.ok) setError(result.error ?? "Decision failed");
    await load("refresh");
    return result;
  }, [load]);

  const removeDirective = useCallback(async (id: string) => {
    const result = await postJson("/api/marketplace/directives", { action: "remove", id });
    if (!result.ok) setError(result.error ?? "Could not remove the rule");
    await load("refresh");
    return result;
  }, [load]);

  const dataset = useMemo<MarketplaceDeskData>(
    () => ({
      theme,
      loading,
      refreshing,
      error,
      accounts,
      providers,
      listings,
      conversations,
      decisions,
      directives,
      activeAccountId,
      activeAccount,
      activeTab,
      connectOpen,
      listingModal,
      monitorStatus,
      selectAccount: (id: string) => rememberActiveId(id),
      selectTab: (tab: MarketplaceTab) => setActiveTab(tab),
      setConnectOpen,
      openListingModal: (listingId?: string) => setListingModal({ open: true, ...(listingId ? { listingId } : {}) }),
      closeListingModal: () => setListingModal({ open: false }),
      refresh: async () => {
        await load("refresh");
      },
      runAccountsAction,
      runListingsAction,
      decideDecision,
      removeDirective,
      onNavigate,
    }),
    [theme, loading, refreshing, error, accounts, providers, listings, conversations, decisions, directives, activeAccountId, activeAccount, activeTab, connectOpen, listingModal, monitorStatus, rememberActiveId, load, runAccountsAction, runListingsAction, decideDecision, removeDirective, onNavigate],
  );

  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      <MarketplaceDeskProvider value={dataset}>
        <MarketplaceView />
      </MarketplaceDeskProvider>
    </div>
  );
}

export default MarketplacePanel;
