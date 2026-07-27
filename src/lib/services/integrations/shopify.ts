import "server-only";

import { readSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";

const SHOPIFY_API_VERSION = "2026-07";
const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export type ShopifyReadAction = "store" | "products";

type ShopifyGraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

async function shopifyGraphql<T>(query: string, variables?: Record<string, unknown>) {
  const sharedEnv = await readSharedAgentEnv();
  const token = sharedEnvValue("SHOPIFY_ADMIN_ACCESS_TOKEN", sharedEnv);
  const shopDomain = sharedEnvValue("SHOPIFY_STORE_DOMAIN", sharedEnv).toLowerCase();
  if (!token || !shopDomain) throw new Error("Connect Shopify in HivemindOS before reading store data.");
  if (!SHOP_DOMAIN_PATTERN.test(shopDomain)) throw new Error("The saved Shopify store domain is invalid. Reconnect Shopify with the permanent *.myshopify.com domain.");
  const response = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
      "User-Agent": "hivemindos-shopify",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null) as ShopifyGraphqlEnvelope<T> | null;
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.errors?.[0]?.message || `Shopify Admin API request failed (HTTP ${response.status}).`);
  }
  return payload.data;
}

export async function readShopify(action: ShopifyReadAction, limit = 25) {
  if (action === "store") {
    return shopifyGraphql(`{
      shop {
        name
        myshopifyDomain
        primaryDomain { host url }
        currencyCode
        contactEmail
        plan { displayName }
      }
    }`);
  }
  const first = Math.max(1, Math.min(100, Math.floor(limit)));
  return shopifyGraphql(`query Products($first: Int!) {
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        status
        productType
        vendor
        updatedAt
        totalInventory
      }
      pageInfo { hasNextPage endCursor }
    }
  }`, { first });
}
