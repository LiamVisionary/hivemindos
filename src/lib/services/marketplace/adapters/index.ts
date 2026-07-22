import type { MarketplaceProvider } from "@/lib/services/marketplace/marketplace-types";
import type { MarketplaceProviderAdapter } from "@/lib/services/marketplace/adapters/types";
import { facebookMarketplaceAdapter } from "@/lib/services/marketplace/adapters/facebook";

/**
 * Adapter registry — typed Record so a provider added to the matrix without an
 * adapter is a compile error, mirroring SOCIAL_ADAPTERS.
 */
export const MARKETPLACE_ADAPTERS: Record<MarketplaceProvider, MarketplaceProviderAdapter> = {
  facebook: facebookMarketplaceAdapter,
};

export function marketplaceAdapter(provider: MarketplaceProvider): MarketplaceProviderAdapter {
  return MARKETPLACE_ADAPTERS[provider];
}
