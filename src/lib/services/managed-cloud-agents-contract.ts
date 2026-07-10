export const OFFICIAL_MANAGED_CLOUD_AGENTS_BASE_URL = "https://hivemindos-managed-agents.hivemindos.workers.dev";
export const MANAGED_CLOUD_PAYMENT_NETWORK = "eip155:8453";
export const MANAGED_CLOUD_PAYMENT_ASSET = "USDC";
export const MANAGED_CLOUD_PAYMENT_ASSET_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const MANAGED_CLOUD_TOP_UP_AMOUNTS_USD = [0.25, 1, 5, 10] as const;
export const MANAGED_CLOUD_FUND_CONFIRMATION = "FUND_MANAGED_AGENT";

export type ManagedCloudPlan = {
  id: "small" | "medium" | "large";
  label: string;
  memoryGb: number;
  vcpus: number;
  persistentStorageGb: number;
  runningUsdPerHour: number;
  stoppedUsdPerHour: number;
  setupUsd: number;
};

export type ManagedCloudAccount = {
  id: string;
  ownerWallet: string;
  balanceUsd: number;
  createdAt: string;
  updatedAt: string;
};

export type ManagedCloudAgent = {
  id: string;
  name: string;
  planId: ManagedCloudPlan["id"];
  region: string;
  model: string;
  status: "provisioning" | "running" | "stopping" | "stopped" | "starting" | "deleting" | "error";
  activeOperationId: string | null;
  runtimeUrl: string | null;
  tailnet: {
    status: "not_configured" | "pending" | "connected" | "error";
    dnsName: string | null;
  };
  sharedBrain: {
    status: "not_configured" | "pending" | "ready" | "error";
    deviceId: string | null;
  };
  integrations: {
    status: "not_configured" | "ready" | "error";
    generation: number;
  };
  lastHealthAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ManagedCloudIntegration = {
  id: string;
  kind: "remote_mcp" | "cloud_api" | "tailnet_auth" | "brain_peer";
  name: string;
  classification: "cloud_native" | "bridge_required" | "local_only";
  status: "pending" | "ready" | "error" | "revoked";
  publicConfig: Record<string, unknown>;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ManagedCloudPaymentQuote = {
  id: string;
  amountUsd: number;
  network: typeof MANAGED_CLOUD_PAYMENT_NETWORK;
  asset: typeof MANAGED_CLOUD_PAYMENT_ASSET;
  assetAddress: typeof MANAGED_CLOUD_PAYMENT_ASSET_ADDRESS;
  payTo: string;
  expiresAt: string;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} returned an invalid object.`);
  return value as Record<string, unknown>;
}

export function normalizeManagedCloudTopUp(amountUsd: unknown): number {
  const amount = Number(amountUsd);
  const match = MANAGED_CLOUD_TOP_UP_AMOUNTS_USD.find((candidate) => Math.abs(candidate - amount) <= 1e-9);
  if (match === undefined) throw new Error("Managed cloud top up must be $0.25, $1, $5, or $10.");
  return match;
}

export function assertOfficialManagedCloudQuote(value: unknown, expectedAmountUsd: number): ManagedCloudPaymentQuote {
  const quote = record(value, "Managed cloud quote");
  const amountUsd = Number(quote.amountUsd);
  const expiresAt = String(quote.expiresAt || "");
  const payTo = String(quote.payTo || "");
  if (String(quote.network) !== MANAGED_CLOUD_PAYMENT_NETWORK) throw new Error("Managed cloud quote uses an unexpected network.");
  if (String(quote.asset).toUpperCase() !== MANAGED_CLOUD_PAYMENT_ASSET) throw new Error("Managed cloud quote uses an unexpected asset.");
  if (String(quote.assetAddress).toLowerCase() !== MANAGED_CLOUD_PAYMENT_ASSET_ADDRESS.toLowerCase()) {
    throw new Error("Managed cloud quote uses an unexpected USDC contract.");
  }
  if (Math.abs(amountUsd - expectedAmountUsd) > 1e-9) throw new Error("Managed cloud quote amount changed unexpectedly.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) throw new Error("Managed cloud quote recipient is invalid.");
  if (!expiresAt || Date.parse(expiresAt) <= Date.now()) throw new Error("Managed cloud quote has expired.");
  const id = String(quote.id || "").trim();
  if (!id) throw new Error("Managed cloud quote is missing its identifier.");
  return {
    id,
    amountUsd,
    network: MANAGED_CLOUD_PAYMENT_NETWORK,
    asset: MANAGED_CLOUD_PAYMENT_ASSET,
    assetAddress: MANAGED_CLOUD_PAYMENT_ASSET_ADDRESS,
    payTo,
    expiresAt,
  };
}
