"use client";

import { createContext, useContext, type ReactNode } from "react";

import type {
  SocialAccount,
  SocialAwakeHours,
  SocialCapability,
  SocialCapabilitySupport,
  SocialContextSourceKind,
  SocialPlatformCapabilityDto,
} from "@/lib/services/socials/socials-types";

/** Account as the desk renders it: definition + live probe + capability projection. */
export type SocialsAccountView = SocialAccount & {
  probe: { ok: boolean; detail: string; handle?: string; displayName?: string };
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
  queueMeta: { lastTickAt?: string };
  activeAccountId: string;
  activeAccount: SocialsAccountView | null;
  connectOpen: boolean;
  selectAccount: (id: string) => void;
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
