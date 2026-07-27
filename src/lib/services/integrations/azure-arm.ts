import "server-only";

import { mintAzureAccessToken } from "@/lib/services/integrations/azure-oauth";

const ARM_ORIGIN = "https://management.azure.com";
const SUBSCRIPTIONS_API_VERSION = "2022-12-01";
const RESOURCES_API_VERSION = "2021-04-01";
const SUBSCRIPTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_VERSION = /^20\d{2}-\d{2}-\d{2}(?:-preview)?$/;
const MAX_ITEMS = 200;
const MAX_RESPONSE_BYTES = 2_000_000;

export type AzureReadAction = "subscriptions" | "resource-groups" | "resources" | "resource";

export type AzureReadInput = {
  action: AzureReadAction;
  subscriptionId?: string;
  resourceGroup?: string;
  resourceId?: string;
  apiVersion?: string;
  top?: number;
};

function assertSubscriptionId(value: string): string {
  const clean = value.trim();
  if (!SUBSCRIPTION_ID.test(clean)) throw new Error("A valid Azure subscriptionId is required.");
  return clean;
}

function safeTop(value?: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(MAX_ITEMS, Math.floor(value ?? 100)));
}

function resourceUrl(input: AzureReadInput): URL {
  if (input.action === "subscriptions") {
    return new URL(`/subscriptions?api-version=${SUBSCRIPTIONS_API_VERSION}`, ARM_ORIGIN);
  }
  const subscriptionId = assertSubscriptionId(input.subscriptionId || "");
  if (input.action === "resource-groups") {
    const url = new URL(`/subscriptions/${subscriptionId}/resourcegroups`, ARM_ORIGIN);
    url.searchParams.set("api-version", RESOURCES_API_VERSION);
    url.searchParams.set("$top", String(safeTop(input.top)));
    return url;
  }
  if (input.action === "resources") {
    const group = input.resourceGroup?.trim();
    const path = group
      ? `/subscriptions/${subscriptionId}/resourceGroups/${encodeURIComponent(group)}/resources`
      : `/subscriptions/${subscriptionId}/resources`;
    const url = new URL(path, ARM_ORIGIN);
    url.searchParams.set("api-version", RESOURCES_API_VERSION);
    url.searchParams.set("$top", String(safeTop(input.top)));
    return url;
  }

  const resourceId = input.resourceId?.trim() || "";
  const expectedPrefix = `/subscriptions/${subscriptionId}/`;
  if (!resourceId.toLowerCase().startsWith(expectedPrefix.toLowerCase()) || resourceId.includes("?") || resourceId.includes("..")) {
    throw new Error("resourceId must be an Azure Resource Manager id inside the selected subscription.");
  }
  const apiVersion = input.apiVersion?.trim() || "";
  if (!API_VERSION.test(apiVersion)) throw new Error("A provider API version such as 2024-01-01 is required.");
  const url = new URL(resourceId, ARM_ORIGIN);
  url.searchParams.set("api-version", apiVersion);
  return url;
}

export async function readAzureArm(input: AzureReadInput): Promise<unknown> {
  const url = resourceUrl(input);
  const accessToken = await mintAzureAccessToken();
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Azure returned more than 2 MB. Narrow the resource query.");
  const data = text ? JSON.parse(text) as unknown : null;
  if (!response.ok) {
    const detail = data && typeof data === "object" && "error" in data
      ? JSON.stringify((data as { error?: unknown }).error).slice(0, 800)
      : `HTTP ${response.status}`;
    throw new Error(`Azure Resource Manager rejected the read (${detail}).`);
  }
  return data;
}

