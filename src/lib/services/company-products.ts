import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { readProjectRegistry } from "@/lib/services/projects/project-registry";
import { proposeCompanyPricingChange, setCompanyProducts } from "@/lib/services/companies-store";
import type { Company, CompanyProduct } from "@/lib/types/company";

/**
 * Opportunistic product-catalog seeding from a company's attached code repo.
 *
 * A company that has NEVER had a catalog (products === undefined) and has a
 * projectId gets one chance per read to inherit default pricing from its repo:
 * we look for a conventional pricing file, map it into CompanyProduct[], and
 * persist it through the companies store — so the seed lands in the shared
 * vault (Operations/Companies/companies.json) and from then on the vault value
 * is the single source of truth (UI edits overwrite it; the repo file is never
 * consulted again). A catalog the human emptied keeps its `seededFrom` marker
 * and is deliberately NOT re-seeded.
 */

/** Conventional default-pricing files checked in the attached repo, in order. */
const REPO_PRICING_FILES = [
  path.join("config", "pricing.json"),
  path.join("config", "products.json"),
  "pricing.json",
  "products.json",
];

function trimmedText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

/** Loose price read: accepts amountUsd / priceUsd / price / amount, "$1,500" strings included. */
function priceOf(raw: Record<string, unknown>): number | null {
  for (const field of ["amountUsd", "priceUsd", "price", "amount"]) {
    const value = raw[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === "string") {
      const numeric = Number(value.replace(/[$,\s]/g, ""));
      if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    }
  }
  return null;
}

function intervalOf(raw: Record<string, unknown>): CompanyProduct["interval"] {
  const value = trimmedText(raw.interval)?.toLowerCase();
  if (value === "month" || value === "monthly" || value === "mo") return "month";
  if (value === "year" || value === "yearly" || value === "annual") return "year";
  return undefined;
}

/** Map one loose repo entry into a CompanyProduct; null when unusable. */
function repoEntryToProduct(value: unknown): CompanyProduct | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = trimmedText(raw.name) ?? trimmedText(raw.title);
  const amountUsd = priceOf(raw);
  if (!name || amountUsd === null) return null;
  return {
    key: trimmedText(raw.key)?.toLowerCase() ?? "",
    name,
    amountUsd,
    description: trimmedText(raw.description),
    recommended: raw.recommended === true || undefined,
    interval: intervalOf(raw),
    kind: raw.kind === "addon" || raw.addon === true ? "addon" : undefined,
  };
}

/** Accepted top-level shapes: [...], {products: [...]}, {packages: [...]}, {items: [...]}. */
function repoEntriesOf(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const raw = parsed as Record<string, unknown>;
    for (const field of ["products", "packages", "items"]) {
      if (Array.isArray(raw[field])) return raw[field] as unknown[];
    }
  }
  return [];
}

/** Read default products from a repo checkout; null when no conventional file yields any. */
export async function readRepoDefaultProducts(
  repoPath: string,
): Promise<{ items: CompanyProduct[]; file: string } | null> {
  for (const candidate of REPO_PRICING_FILES) {
    const file = path.join(repoPath, candidate);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      continue; // missing or unparseable → try the next convention
    }
    const items = repoEntriesOf(parsed)
      .map(repoEntryToProduct)
      .filter((item): item is CompanyProduct => item !== null);
    if (items.length > 0) return { items, file: candidate };
  }
  return null;
}

/** Resolve the local checkout path of the company's attached project, if any. */
async function companyRepoPath(company: Company): Promise<string | null> {
  const projectId = company.projectId?.trim();
  if (!projectId) return null;
  try {
    const registry = await readProjectRegistry();
    const project = registry.projects.find((entry) => entry.id === projectId);
    const localPath = project?.localPath?.trim();
    if (!localPath) return null;
    await fs.access(localPath);
    return localPath;
  } catch {
    return null; // registry unavailable or checkout not on this machine
  }
}

// ── crew-raised pricing proposals (the "pricing is why they aren't buying" rail) ──

export type PricingProposalMarker = { productRef: string; amountUsd: number; why?: string };
export type TaskPricingCatalogEntry = { productKey: string; productName: string; amountUsd: number };

/** Parse the immutable official-price lines embedded in a company task prompt. */
export function extractTaskPricingCatalog(body: string): TaskPricingCatalogEntry[] {
  const entries: TaskPricingCatalogEntry[] = [];
  for (const line of (body ?? "").split(/\r?\n/)) {
    const match = /^\s*-\s+(.+?)\s+\(key:\s*([^)]+)\)\s+(?:—|->|-)\s+\$\s*([\d,]+(?:\.\d+)?)/i.exec(line);
    if (!match) continue;
    const amountUsd = Number(match[3].replace(/,/g, ""));
    if (!Number.isFinite(amountUsd) || amountUsd < 0) continue;
    entries.push({
      productKey: match[2].trim().toLowerCase(),
      productName: match[1].trim(),
      amountUsd: Math.round(amountUsd * 100) / 100,
    });
  }
  return entries;
}

/**
 * Extract `PRICING PROPOSAL:` markers from a task result. The protocol mirrors
 * the ACTION NEEDED convention agents already follow:
 *
 *   PRICING PROPOSAL: <product key or name> $<new price>
 *   WHY: <the concrete evidence — reply objections, quote-vs-close, abandonment>
 *
 * One proposal per marker line; the WHY line directly below it is optional but
 * strongly encouraged (it becomes the evidence the human sees under Approvals).
 */
export function extractPricingProposalMarkers(result: string): PricingProposalMarker[] {
  const markers: PricingProposalMarker[] = [];
  const lines = (result ?? "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*PRICING PROPOSAL:\s*(.+?)\s*(?:->|→|—|:)?\s*\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*\w+)?\s*\.?\s*$/i.exec(lines[index]);
    if (!match) continue;
    const amountUsd = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(amountUsd) || amountUsd < 0) continue;
    const productRef = match[1].replace(/["'`]/g, "").replace(/[-–—:]+$/, "").trim();
    if (!productRef) continue;
    const whyMatch = /^\s*WHY:\s*(.+)$/i.exec(lines[index + 1] ?? "");
    markers.push({ productRef, amountUsd, why: whyMatch?.[1]?.trim() || undefined });
  }
  return markers;
}

/**
 * File any pricing proposals a finished company task's result carries. The
 * store consumes a durable task/product receipt, while the prompt's immutable
 * catalog snapshot prevents a marker from being reinterpreted after prices
 * change. Bad references, stale snapshots, and no-op prices are skipped.
 */
export async function fileTaskPricingProposals(
  companyId: string,
  task: { id: string; body?: string; result?: string; assignee?: string | null; createdAt?: number },
): Promise<number> {
  let filed = 0;
  const catalogSnapshot = extractTaskPricingCatalog(task.body ?? "");
  for (const marker of extractPricingProposalMarkers(task.result ?? "").slice(0, 5)) {
    const ref = marker.productRef.trim().toLowerCase();
    const sourceProduct = catalogSnapshot.find((entry) => entry.productKey === ref)
      ?? catalogSnapshot.find((entry) => entry.productName.toLowerCase() === ref);
    const proposal = await proposeCompanyPricingChange(companyId, {
      productRef: marker.productRef,
      proposedAmountUsd: marker.amountUsd,
      why: marker.why,
      sourceTaskId: task.id,
      proposedBy: task.assignee ?? undefined,
      sourceCatalogAmountUsd: sourceProduct?.amountUsd,
      sourceTaskCreatedAtMs: task.createdAt,
    }).catch(() => null);
    if (proposal) filed += 1;
  }
  return filed;
}

/**
 * Seed a company's catalog from its repo's default pricing, once. Returns the
 * (possibly updated) company. No-ops when a catalog already exists in the
 * shared vault — including one the human emptied — or when no repo/pricing
 * file is reachable from this machine.
 */
export async function ensureCompanyProductsSeeded(company: Company): Promise<Company> {
  if (company.products !== undefined) return company;
  const repoPath = await companyRepoPath(company);
  if (!repoPath) return company;
  const found = await readRepoDefaultProducts(repoPath);
  if (!found) return company;
  const updated = await setCompanyProducts(
    company.id,
    { items: found.items, seededFrom: `repo:${found.file}` },
    "company-products:repo-seed",
  );
  return updated ?? company;
}
