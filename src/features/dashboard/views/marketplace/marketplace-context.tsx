"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { DashboardRouteTarget } from "@/features/dashboard/dashboard-navigation";
import type {
  MarketplaceAccount,
  MarketplaceConversation,
  MarketplaceDecision,
  MarketplaceDirective,
  MarketplaceListing,
  MarketplaceProviderCapabilityDto,
} from "@/lib/services/marketplace/marketplace-types";

export type MarketplaceTab = "catalog" | "decisions" | "settings";

/** Action results carry the route's whole okJson payload (e.g. the created listing). */
export type MarketplaceActionResult = { ok: boolean; error?: string } & Record<string, unknown>;

/** One memoized dataset the whole Marketplace view reads (Socials desk pattern). */
export type MarketplaceDeskData = {
  theme: "light" | "dark";
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  accounts: MarketplaceAccount[];
  providers: MarketplaceProviderCapabilityDto[];
  listings: MarketplaceListing[];
  conversations: MarketplaceConversation[];
  decisions: MarketplaceDecision[];
  directives: MarketplaceDirective[];
  activeAccountId: string;
  activeAccount: MarketplaceAccount | null;
  activeTab: MarketplaceTab;
  connectOpen: boolean;
  listingModal: { open: boolean; listingId?: string };
  /** Per-account monitor liveness from the driver (absent until the driver reports). */
  monitorStatus: Record<string, { nextPollAt?: string; lastPollAt?: string; accelerated?: boolean }>;
  selectAccount: (id: string) => void;
  selectTab: (tab: MarketplaceTab) => void;
  setConnectOpen: (open: boolean) => void;
  openListingModal: (listingId?: string) => void;
  closeListingModal: () => void;
  refresh: () => Promise<void>;
  runAccountsAction: (body: Record<string, unknown>) => Promise<MarketplaceActionResult>;
  runListingsAction: (body: Record<string, unknown>) => Promise<MarketplaceActionResult>;
  decideDecision: (id: string, decision: "approved" | "denied", note: string, makeDirective: boolean) => Promise<MarketplaceActionResult>;
  removeDirective: (id: string) => Promise<MarketplaceActionResult>;
  onNavigate?: (target: DashboardRouteTarget) => void;
};

const MarketplaceDeskContext = createContext<MarketplaceDeskData | null>(null);

export function MarketplaceDeskProvider({ value, children }: { value: MarketplaceDeskData; children: ReactNode }) {
  return <MarketplaceDeskContext.Provider value={value}>{children}</MarketplaceDeskContext.Provider>;
}

export function useMarketplaceDesk(): MarketplaceDeskData {
  const context = useContext(MarketplaceDeskContext);
  if (!context) throw new Error("useMarketplaceDesk must be used inside MarketplaceDeskProvider");
  return context;
}
