"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SocialsDeskProvider, SocialsView, type SocialsAccountView, type SocialsDeskData, type SocialsNewContextSource, type SocialsSoulOption } from "@/components/socials";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import type { SocialXSessionBinding } from "@/lib/services/socials/social-x-session-binding";
import type { SocialAwakeHours, SocialDraftingPolicy, SocialDraftingRuntime, SocialMetricSnapshot, SocialPlatformCapabilityDto, SocialQueueEngineMeta, SocialQueueItem, SocialXDiscoveryStatus } from "@/lib/services/socials/socials-types";

const ACTIVE_ACCOUNT_STATE_KEY = "socials.activeAccountId";

type AccountsPayload = {
  ok: boolean;
  error?: string;
  accounts?: SocialsAccountView[];
  platforms?: SocialPlatformCapabilityDto[];
  queue?: SocialQueueEngineMeta;
  queueCounts?: Record<string, number>;
  souls?: SocialsSoulOption[];
};

type QueuePayload = {
  ok: boolean;
  error?: string;
  queue?: SocialQueueItem[];
  snapshots?: SocialMetricSnapshot[];
  analytics?: {
    posted: number;
    failed: number;
    canceled: number;
    automated: number;
    manual: number;
    metricTotals: Record<string, number>;
  };
  readBudget?: { limit: number; used: number; remaining: number };
  drafting?: SocialDraftingRuntime;
  discovery?: SocialXDiscoveryStatus;
  engine?: SocialsDeskData["engine"];
};

async function postAccountsAction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/socials/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json()) as { ok?: boolean; error?: string };
    return parsed.ok ? { ok: true } : { ok: false, error: parsed.error ?? `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Socials desk container: owns fetch/state, provides one memoized dataset (Trade triad pattern). */
export function SocialsPanel({ theme }: { theme: "light" | "dark" }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SocialsAccountView[]>([]);
  const [platforms, setPlatforms] = useState<SocialPlatformCapabilityDto[]>([]);
  const [souls, setSouls] = useState<SocialsSoulOption[]>([]);
  const [queueMeta, setQueueMeta] = useState<SocialQueueEngineMeta>({ settings: { enabled: true, updatedAt: "", updatedBy: "system" } });
  const [queueItems, setQueueItems] = useState<SocialQueueItem[]>([]);
  const [queueCounts, setQueueCounts] = useState<Record<string, number>>({});
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueBusy, setQueueBusy] = useState<string | null>(null);
  const [engine, setEngine] = useState<SocialsDeskData["engine"]>({ running: false, disabled: false, enabled: true, leaseHeld: false });
  const [socialAnalytics, setSocialAnalytics] = useState<SocialsDeskData["socialAnalytics"]>({ posted: 0, failed: 0, canceled: 0, automated: 0, manual: 0, metricTotals: {} });
  const [metricSnapshots, setMetricSnapshots] = useState<SocialMetricSnapshot[]>([]);
  const [managedReadBudget, setManagedReadBudget] = useState<SocialsDeskData["managedReadBudget"]>(null);
  const [draftingRuntime, setDraftingRuntime] = useState<SocialDraftingRuntime | null>(null);
  const [xDiscovery, setXDiscovery] = useState<SocialXDiscoveryStatus | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [allAccountsSelected, setAllAccountsSelected] = useState(false);
  const queueScopeRef = useRef<"all" | "account">("account");
  const [rememberedActiveId, rememberActiveId] = useRememberedDashboardValue(ACTIVE_ACCOUNT_STATE_KEY);

  const loadQueue = useCallback(async (accountId?: string, showLoading = false) => {
    if (showLoading) setQueueLoading(true);
    try {
      const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
      const response = await fetch(`/api/socials/queue${query}`, { cache: "no-store" });
      const payload = (await response.json()) as QueuePayload;
      if (!payload.ok) {
        setError(payload.error ?? `HTTP ${response.status}`);
        return;
      }
      const nextQueue = payload.queue ?? [];
      setQueueItems(nextQueue);
      setQueueCounts((current) => {
        if (accountId) {
          return {
            ...current,
            [accountId]: nextQueue.filter((item) => ["draft", "suggested", "failed"].includes(item.state)).length,
          };
        }
        const next = Object.fromEntries(Object.keys(current).map((id) => [id, 0])) as Record<string, number>;
        for (const item of nextQueue) {
          if (["draft", "suggested", "failed"].includes(item.state)) next[item.accountId] = (next[item.accountId] ?? 0) + 1;
        }
        return next;
      });
      setMetricSnapshots(payload.snapshots ?? []);
      setManagedReadBudget(payload.readBudget ?? null);
      setDraftingRuntime(payload.drafting ?? null);
      setXDiscovery(payload.discovery ?? null);
      if (payload.analytics) setSocialAnalytics(payload.analytics);
      if (payload.engine) {
        setEngine(payload.engine);
        setQueueMeta((current) => ({
          ...current,
          settings: { ...current.settings, enabled: payload.engine!.enabled },
          lastTickAt: payload.engine!.lastTickAt,
          lastPostedAt: payload.engine!.lastPostedAt,
          lastError: payload.engine!.lastError,
        }));
      }
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : String(queueError));
    } finally {
      if (showLoading) setQueueLoading(false);
    }
  }, []);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "refresh") setRefreshing(true);
    try {
      const res = await fetch("/api/socials/accounts", { cache: "no-store" });
      const payload = (await res.json()) as AccountsPayload;
      if (!payload.ok) {
        setError(payload.error ?? `HTTP ${res.status}`);
        return;
      }
      setError(null);
      setAccounts(payload.accounts ?? []);
      setPlatforms(payload.platforms ?? []);
      setSouls(payload.souls ?? []);
      setQueueCounts(payload.queueCounts ?? {});
      if (payload.queue) setQueueMeta(payload.queue);
      const selected = (payload.accounts ?? []).some((account) => account.id === rememberedActiveId)
        ? rememberedActiveId
        : payload.accounts?.[0]?.id ?? "";
      await loadQueue(queueScopeRef.current === "all" ? undefined : selected, mode === "initial");
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadQueue, rememberedActiveId]);

  useEffect(() => {
    // Deferred like ClawBankStatusCard's initial refresh: the set-state-in-effect
    // rule forbids kicking a state-setting fetch synchronously in the effect body.
    const timer = window.setTimeout(() => void load("initial"), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeAccountId = useMemo(() => {
    if (accounts.some((account) => account.id === rememberedActiveId)) return rememberedActiveId;
    return accounts[0]?.id ?? "";
  }, [accounts, rememberedActiveId]);

  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null;

  useEffect(() => {
    if (!activeAccountId && !allAccountsSelected) return undefined;
    const interval = window.setInterval(
      () => void loadQueue(allAccountsSelected ? undefined : activeAccountId),
      5_000,
    );
    return () => window.clearInterval(interval);
  }, [activeAccountId, allAccountsSelected, loadQueue]);

  const runAction = useCallback(
    async (body: Record<string, unknown>) => {
      const result = await postAccountsAction(body);
      if (!result.ok) setError(result.error ?? "Action failed");
      await load("refresh");
      return result;
    },
    [load],
  );

  const runQueueAction = useCallback(async (body: Record<string, unknown>) => {
    const busyKey = typeof body.id === "string" ? body.id : String(body.action ?? "queue");
    setQueueBusy(busyKey);
    try {
      const response = await fetch("/api/socials/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = (await response.json()) as { ok?: boolean; error?: string; item?: SocialQueueItem };
      if (!parsed.ok) {
        const message = parsed.error ?? `HTTP ${response.status}`;
        setError(message);
        return { ok: false, error: message };
      }
      setError(null);
      await loadQueue(queueScopeRef.current === "all" ? undefined : activeAccountId);
      return { ok: true, ...(parsed.item ? { item: parsed.item } : {}) };
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : String(actionError);
      setError(message);
      return { ok: false, error: message };
    } finally {
      setQueueBusy(null);
    }
  }, [activeAccountId, loadQueue]);

  const dataset = useMemo<SocialsDeskData>(
    () => ({
      theme,
      loading,
      refreshing,
      error,
      accounts,
      platforms,
      souls,
      queueMeta,
      queueItems,
      queueCounts,
      queueLoading,
      queueBusy,
      engine,
      socialAnalytics,
      metricSnapshots,
      managedReadBudget,
      draftingRuntime,
      xDiscovery,
      activeAccountId,
      activeAccount,
      allAccountsSelected,
      connectOpen,
      selectAccount: (id: string) => {
        queueScopeRef.current = "account";
        setAllAccountsSelected(false);
        rememberActiveId(id);
        void loadQueue(id, true);
      },
      selectAllAccounts: () => {
        queueScopeRef.current = "all";
        setAllAccountsSelected(true);
        void loadQueue(undefined, true);
      },
      setConnectOpen,
      refresh: async () => {
        await load("refresh");
      },
      createAccount: async (input) => {
        const result = await runAction({ action: "create", account: input });
        return result;
      },
      deleteAccount: async (id: string) => {
        await runAction({ action: "delete", id });
      },
      setAwakeHours: async (id: string, awakeHours: Partial<SocialAwakeHours>) => {
        await runAction({ action: "set-awake-hours", id, awakeHours });
      },
      setSoulPath: async (id: string, soulPath: string) => {
        await runAction({ action: "update", id, update: { soulPath } });
      },
      addContextSources: async (id: string, sources: SocialsNewContextSource[]) => {
        await runAction({ action: "add-context-sources", id, sources });
      },
      removeContextSource: async (id: string, sourceId: string) => {
        await runAction({ action: "remove-context-source", id, sourceId });
      },
      setPostingMode: async (id: string, mode: "manual" | "auto") => runAction({
        action: "set-mode",
        id,
        mode,
        ...(mode === "auto" ? { optIn: true, optInNote: "Enabled from the Socials queue controls." } : {}),
      }),
      setXSessionBinding: async (id: string, xSession: SocialXSessionBinding) => runAction({
        action: "set-x-session",
        id,
        xSession,
      }),
      setMaxDailyReadOps: async (id: string, maxDailyReadOps: number) => {
        await runAction({ action: "update", id, update: { maxDailyReadOps } });
      },
      setDraftingPolicy: async (id: string, drafting: Partial<Pick<SocialDraftingPolicy,
        "enabled" | "cadenceHours" | "draftsPerRun" | "engagementEnabled" | "replyDraftsPerRun" | "quoteDraftsPerRun" | "engagementLookbackHours">>) => {
        await runAction({ action: "set-drafting", id, drafting });
      },
      queueAction: runQueueAction,
      refreshQueue: async () => loadQueue(queueScopeRef.current === "all" ? undefined : activeAccountId, true),
    }),
    [theme, loading, refreshing, error, accounts, platforms, souls, queueMeta, queueItems, queueCounts, queueLoading, queueBusy, engine, socialAnalytics, metricSnapshots, managedReadBudget, draftingRuntime, xDiscovery, activeAccountId, activeAccount, allAccountsSelected, connectOpen, rememberActiveId, load, loadQueue, runAction, runQueueAction],
  );

  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      <SocialsDeskProvider value={dataset}>
        <SocialsView />
      </SocialsDeskProvider>
    </div>
  );
}

export default SocialsPanel;
