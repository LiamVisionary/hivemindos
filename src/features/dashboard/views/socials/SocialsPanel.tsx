"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { SocialsDeskProvider, SocialsView, type SocialsAccountView, type SocialsDeskData, type SocialsNewContextSource, type SocialsSoulOption } from "@/components/socials";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import type { SocialAwakeHours, SocialPlatformCapabilityDto } from "@/lib/services/socials/socials-types";

const ACTIVE_ACCOUNT_STATE_KEY = "socials.activeAccountId";

type AccountsPayload = {
  ok: boolean;
  error?: string;
  accounts?: SocialsAccountView[];
  platforms?: SocialPlatformCapabilityDto[];
  queue?: { lastTickAt?: string };
  souls?: SocialsSoulOption[];
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
  const [queueMeta, setQueueMeta] = useState<{ lastTickAt?: string }>({});
  const [connectOpen, setConnectOpen] = useState(false);
  const [rememberedActiveId, rememberActiveId] = useRememberedDashboardValue(ACTIVE_ACCOUNT_STATE_KEY);

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
      setQueueMeta(payload.queue ?? {});
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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

  const runAction = useCallback(
    async (body: Record<string, unknown>) => {
      const result = await postAccountsAction(body);
      if (!result.ok) setError(result.error ?? "Action failed");
      await load("refresh");
      return result;
    },
    [load],
  );

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
      activeAccountId,
      activeAccount,
      connectOpen,
      selectAccount: (id: string) => rememberActiveId(id),
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
    }),
    [theme, loading, refreshing, error, accounts, platforms, souls, queueMeta, activeAccountId, activeAccount, connectOpen, rememberActiveId, load, runAction],
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
