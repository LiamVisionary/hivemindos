"use client";

import { createContext, useContext, type ReactNode } from "react";

import type {
  SocialAccount,
  SocialAwakeHours,
  SocialCapability,
  SocialCapabilitySupport,
  SocialContextSourceKind,
  SocialPlatformCapabilityDto,
  SocialDraftingPolicy,
  SocialDraftingRuntime,
  SocialQueueEngineMeta,
  SocialQueueItem,
  SocialMetricSnapshot,
  SocialXDiscoveryStatus,
} from "@/lib/services/socials/socials-types";
import type { SocialConnectProbe } from "@/lib/services/socials/adapters/types";
import type { SocialXSessionBinding } from "@/lib/services/socials/social-x-session-binding";

/** Account as the desk renders it: definition + live probe + capability projection. */
export type SocialsAccountView = SocialAccount & {
  avatarUrl?: string;
  probe: SocialConnectProbe;
  capabilities: Record<SocialCapability, SocialCapabilitySupport>;
};

export type SocialsSoulOption = { path: string; label: string };

export type SocialsNewContextSource = { kind: SocialContextSourceKind; ref: string; note?: string };

/**
 * The Socials desk contract (trade-context pattern): SocialsPanel owns all
 * data/orchestration and provides one memoized dataset; every presentational
 * component reads it through useSocialsDesk().
 */
export type SocialsDeskData = {
  theme: "light" | "dark";
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  accounts: SocialsAccountView[];
  platforms: SocialPlatformCapabilityDto[];
  souls: SocialsSoulOption[];
  queueMeta: SocialQueueEngineMeta;
  queueItems: SocialQueueItem[];
  queueCounts: Record<string, number>;
  queueLoading: boolean;
  queueBusy: string | null;
  engine: {
    running: boolean;
    disabled: boolean;
    enabled: boolean;
    startedAt?: string;
    lastWakeAt?: string;
    lastTickAt?: string;
    lastPostedAt?: string;
    lastError?: string;
    leaseHeld: boolean;
  };
  socialAnalytics: {
    posted: number;
    failed: number;
    canceled: number;
    automated: number;
    manual: number;
    metricTotals: Record<string, number>;
  };
  metricSnapshots: SocialMetricSnapshot[];
  managedReadBudget: { limit: number; used: number; remaining: number } | null;
  draftingRuntime: SocialDraftingRuntime | null;
  xDiscovery: SocialXDiscoveryStatus | null;
  activeAccountId: string;
  activeAccount: SocialsAccountView | null;
  allAccountsSelected: boolean;
  connectOpen: boolean;
  selectAccount: (id: string) => void;
  selectAllAccounts: () => void;
  setConnectOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  createAccount: (input: {
    platform: string;
    handle: string;
    method: string;
    binding?: Record<string, string>;
    soulPath?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  deleteAccount: (id: string) => Promise<void>;
  setAwakeHours: (id: string, awakeHours: Partial<SocialAwakeHours>) => Promise<void>;
  setSoulPath: (id: string, soulPath: string) => Promise<void>;
  addContextSources: (id: string, sources: SocialsNewContextSource[]) => Promise<void>;
  removeContextSource: (id: string, sourceId: string) => Promise<void>;
  setPostingMode: (id: string, mode: "manual" | "auto") => Promise<{ ok: boolean; error?: string }>;
  setXSessionBinding: (id: string, session: SocialXSessionBinding) => Promise<{ ok: boolean; error?: string }>;
  setMaxDailyReadOps: (id: string, maxDailyReadOps: number) => Promise<void>;
  setDraftingPolicy: (id: string, drafting: Partial<Pick<SocialDraftingPolicy,
    "enabled" | "cadenceHours" | "draftsPerRun" | "engagementEnabled" | "replyDraftsPerRun" | "quoteDraftsPerRun" | "engagementLookbackHours">>) => Promise<void>;
  queueAction: (body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; item?: SocialQueueItem }>;
  refreshQueue: () => Promise<void>;
};

const SocialsDeskContext = createContext<SocialsDeskData | null>(null);

export function SocialsDeskProvider({ value, children }: { value: SocialsDeskData; children: ReactNode }) {
  return <SocialsDeskContext.Provider value={value}>{children}</SocialsDeskContext.Provider>;
}

export function useSocialsDesk(): SocialsDeskData {
  const ctx = useContext(SocialsDeskContext);
  if (!ctx) throw new Error("useSocialsDesk must be used inside SocialsDeskProvider");
  return ctx;
}
