import { OFFICIAL_MANAGED_CLOUD_AGENTS_BASE_URL } from "@/lib/services/managed-cloud-agents-contract";

export const OFFICIAL_HIVEMINDOS_MACHINES_BASE_URL = OFFICIAL_MANAGED_CLOUD_AGENTS_BASE_URL;
export const AZURE_MARKETPLACE_DEPLOY_CONFIRMATION = "DEPLOY_HIVEMINDOS_AZURE_MACHINE";

export type AzureMarketplaceMachinePlan = {
  id: "starter" | "builder" | "swarm";
  label: string;
  marketplacePlanId: string;
  recommendedVmSize: string;
  memoryGb: number;
  vcpus: number;
  osDiskGb: number;
  softwareUsdPerHour: number;
};

export type AzureMarketplaceMachineCatalog = {
  provider: "azure-marketplace";
  availability: "available" | "publisher_setup_required";
  publisherId: string | null;
  offerId: string | null;
  imageVersion: string | null;
  billing: {
    authority: "microsoft";
    infrastructureBilledTo: "customer_azure_subscription";
    softwareFeeBilledTo: "customer_azure_subscription";
    microsoftStoreFeePercent: number;
    publisherSharePercentBeforeTax: number;
    infrastructurePriceVariesByRegion: boolean;
  };
  plans: AzureMarketplaceMachinePlan[];
  setup: {
    marketplaceAccount: "complete" | "required";
    payoutAndTax: "configured_out_of_band" | "required";
    certifiedImage: "published" | "required";
  };
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} returned an invalid object.`);
  return value as Record<string, unknown>;
}

function identifier(value: unknown, required: boolean): string | null {
  if (value === null && !required) return null;
  const clean = String(value || "").trim();
  if (!clean && !required) return null;
  if (!/^[a-z0-9._-]{1,128}$/i.test(clean)) throw new Error("The official Marketplace catalog returned an invalid identifier.");
  return clean;
}

export function assertAzureMarketplaceMachineCatalog(value: unknown): AzureMarketplaceMachineCatalog {
  const catalog = object(value, "HivemindOS Machines catalog");
  const billing = object(catalog.billing, "HivemindOS Machines billing policy");
  const setup = object(catalog.setup, "HivemindOS Machines publisher setup");
  const availability = catalog.availability === "available" ? "available" : "publisher_setup_required";
  if (catalog.provider !== "azure-marketplace") throw new Error("The official machine catalog returned an unexpected provider.");
  if (billing.authority !== "microsoft") throw new Error("The official machine catalog returned an unexpected billing authority.");
  if (billing.infrastructureBilledTo !== "customer_azure_subscription" || billing.softwareFeeBilledTo !== "customer_azure_subscription") {
    throw new Error("The official machine catalog returned an unexpected Azure billing owner.");
  }
  if (!Array.isArray(catalog.plans) || catalog.plans.length === 0) throw new Error("The official machine catalog returned no plans.");

  const seen = new Set<string>();
  const plans = catalog.plans.map((raw) => {
    const plan = object(raw, "HivemindOS Machines plan");
    const id = String(plan.id || "").trim();
    if (!(["starter", "builder", "swarm"] as string[]).includes(id) || seen.has(id)) throw new Error("The official machine catalog returned an invalid plan id.");
    seen.add(id);
    const softwareUsdPerHour = Number(plan.softwareUsdPerHour);
    const memoryGb = Number(plan.memoryGb);
    const vcpus = Number(plan.vcpus);
    const osDiskGb = Number(plan.osDiskGb);
    if (!Number.isFinite(softwareUsdPerHour) || softwareUsdPerHour < 0 || softwareUsdPerHour > 100) throw new Error("The official machine catalog returned an invalid software fee.");
    if (![memoryGb, vcpus, osDiskGb].every((number) => Number.isFinite(number) && number > 0)) throw new Error("The official machine catalog returned invalid machine capacity.");
    return {
      id: id as AzureMarketplaceMachinePlan["id"],
      label: String(plan.label || id),
      marketplacePlanId: identifier(plan.marketplacePlanId, availability === "available") || "",
      recommendedVmSize: String(plan.recommendedVmSize || "").trim(),
      memoryGb,
      vcpus,
      osDiskGb,
      softwareUsdPerHour,
    };
  });

  return {
    provider: "azure-marketplace",
    availability,
    publisherId: identifier(catalog.publisherId, availability === "available"),
    offerId: identifier(catalog.offerId, availability === "available"),
    imageVersion: availability === "available" ? identifier(catalog.imageVersion, true) : null,
    billing: {
      authority: "microsoft",
      infrastructureBilledTo: "customer_azure_subscription",
      softwareFeeBilledTo: "customer_azure_subscription",
      microsoftStoreFeePercent: Number(billing.microsoftStoreFeePercent),
      publisherSharePercentBeforeTax: Number(billing.publisherSharePercentBeforeTax),
      infrastructurePriceVariesByRegion: Boolean(billing.infrastructurePriceVariesByRegion),
    },
    plans,
    setup: {
      marketplaceAccount: setup.marketplaceAccount === "complete" ? "complete" : "required",
      payoutAndTax: setup.payoutAndTax === "configured_out_of_band" ? "configured_out_of_band" : "required",
      certifiedImage: setup.certifiedImage === "published" ? "published" : "required",
    },
  };
}
