import type { CompanyProduct, CompanyProductCatalog } from "@/lib/types/company";

const PRODUCT_INTERVALS: NonNullable<CompanyProduct["interval"]>[] = ["one-time", "month", "year"];

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function productKeyFrom(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "product";
}

function normalizeProduct(value: unknown, taken: Set<string>): CompanyProduct | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = trimmed(raw.name);
  const amount = Number(raw.amountUsd);
  if (!name || !Number.isFinite(amount) || amount < 0) return null;
  let key = trimmed(raw.key)?.toLowerCase() || productKeyFrom(name);
  while (taken.has(key)) key = `${key}-2`;
  taken.add(key);
  const interval = typeof raw.interval === "string" && (PRODUCT_INTERVALS as string[]).includes(raw.interval)
    ? (raw.interval as CompanyProduct["interval"])
    : undefined;
  return {
    key,
    name,
    amountUsd: Math.round(amount * 100) / 100,
    description: trimmed(raw.description),
    recommended: raw.recommended === true || undefined,
    interval: interval === "one-time" ? undefined : interval,
    kind: raw.kind === "addon" ? "addon" : undefined,
  };
}

/** Normalize and enforce one recommended package/add-on per catalog group. */
export function normalizeCompanyProductCatalog(value: unknown): CompanyProductCatalog | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const taken = new Set<string>();
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((item) => normalizeProduct(item, taken))
    .filter((item): item is CompanyProduct => item !== null);
  const recommendedSeen = new Set<string>();
  for (const item of items) {
    if (!item.recommended) continue;
    const group = item.kind === "addon" ? "addon" : "package";
    if (recommendedSeen.has(group)) delete item.recommended;
    else recommendedSeen.add(group);
  }
  const seededFrom = trimmed(raw.seededFrom);
  // An empty seeded catalog means the human cleared it and must not be auto-seeded again.
  if (items.length === 0 && !seededFrom) return undefined;
  return { items, seededFrom, updatedAt: trimmed(raw.updatedAt) };
}
