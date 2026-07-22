import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { titleTokens, titlesSimilar } from "@/lib/services/company-task-dedup";
import {
  mutateRecordsFile,
  readRecordsFile,
  resolveMarketplaceStorage,
} from "@/lib/services/marketplace/marketplace-store-io";
import {
  MARKETPLACE_LISTING_STATES,
  type MarketplaceListing,
  type MarketplaceListingPhoto,
  type MarketplaceListingState,
  type MarketplaceReportCatalogItem,
} from "@/lib/services/marketplace/marketplace-types";

/**
 * Marketplace listings — drafted + catalog-synced records (vault-replicated).
 *
 * Photos are binary files, never base64 in JSON: a multi-MB blob inside a
 * definitions file that gets .bak.N-rotated and Syncthing-replicated on every
 * mutation would be pathological. Records store full vault-relative paths
 * ("Operations/Marketplace/Photos/<listingId>/<n>.jpg"); in local-fallback
 * mode the same paths resolve under ~/.hivemindos/marketplace/.
 */

const LISTINGS_FILE = "listings.json";
const PHOTOS_DIR_NAME = "Photos";
const VAULT_PHOTO_PREFIX = ["Operations", "Marketplace", PHOTOS_DIR_NAME].join("/");

export const MARKETPLACE_MAX_PHOTOS_PER_LISTING = 10;
export const MARKETPLACE_MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const PHOTO_EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

function isListingState(value: unknown): value is MarketplaceListingState {
  return typeof value === "string" && (MARKETPLACE_LISTING_STATES as readonly string[]).includes(value);
}

function normalizePhoto(raw: unknown): MarketplaceListingPhoto | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const vaultPath = typeof record.vaultPath === "string" ? record.vaultPath.trim() : "";
  if (!vaultPath || vaultPath.includes("..")) return null;
  return { vaultPath, ...(typeof record.alt === "string" && record.alt.trim() ? { alt: record.alt.trim() } : {}) };
}

export function normalizeMarketplaceListingRecord(raw: unknown): MarketplaceListing | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const accountId = typeof record.accountId === "string" ? record.accountId.trim() : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!id || !accountId || !title) return null;
  const priceUsd = typeof record.priceUsd === "number" && Number.isFinite(record.priceUsd) && record.priceUsd >= 0 ? record.priceUsd : 0;
  const external =
    record.external && typeof record.external === "object" && typeof (record.external as Record<string, unknown>).externalId === "string"
      ? (record.external as MarketplaceListing["external"])
      : undefined;
  const minOfferRaw = record.minOfferUsd;
  return {
    id,
    accountId,
    origin: record.origin === "synced" ? "synced" : "drafted",
    state: isListingState(record.state) ? record.state : "draft",
    title,
    description: typeof record.description === "string" ? record.description : "",
    priceUsd,
    ...(typeof minOfferRaw === "number" && Number.isFinite(minOfferRaw) && minOfferRaw > 0 ? { minOfferUsd: minOfferRaw } : {}),
    ...(typeof record.category === "string" && record.category.trim() ? { category: record.category.trim() } : {}),
    ...(typeof record.condition === "string" && record.condition.trim() ? { condition: record.condition.trim() } : {}),
    photos: Array.isArray(record.photos) ? record.photos.map(normalizePhoto).filter((photo): photo is MarketplaceListingPhoto => photo !== null) : [],
    ...(record.research && typeof record.research === "object" ? { research: record.research as MarketplaceListing["research"] } : {}),
    ...(external ? { external } : {}),
    stateHistory: Array.isArray(record.stateHistory) ? (record.stateHistory as MarketplaceListing["stateHistory"]) : [],
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function readMarketplaceListings(accountId?: string): Promise<MarketplaceListing[]> {
  const storage = resolveMarketplaceStorage(LISTINGS_FILE);
  const records = await readRecordsFile(storage.file, normalizeMarketplaceListingRecord);
  const filtered = accountId ? records.filter((listing) => listing.accountId === accountId) : records;
  return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getMarketplaceListing(id: string): Promise<MarketplaceListing | null> {
  const listings = await readMarketplaceListings();
  return listings.find((listing) => listing.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Duplicate prevention
// ---------------------------------------------------------------------------

/**
 * Listing-title similarity: real duplicates are usually the same item plus
 * extra descriptor words ("2018 Camry SE" vs "2018 Camry SE clean title"), so
 * token CONTAINMENT (how much of the shorter title the longer one covers) is
 * the primary signal, with plain Jaccard as a backstop.
 */
function listingTitlesLookAlike(a: string, b: string): boolean {
  if (titlesSimilar(a, b, 0.75)) return true;
  const tokensA = titleTokens(a);
  const tokensB = titleTokens(b);
  if (tokensA.size < 2 || tokensB.size < 2) return false;
  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection++;
  return intersection / Math.min(tokensA.size, tokensB.size) >= 0.8;
}

/**
 * A draft duplicates an existing listing when the titles look alike AND the
 * price is within ±15% (when both prices are known — an unknown price does
 * not veto a title match).
 */
export async function findDuplicateListing(
  accountId: string,
  draft: { id?: string; title: string; priceUsd: number },
): Promise<MarketplaceListing | null> {
  const listings = await readMarketplaceListings(accountId);
  for (const listing of listings) {
    if (draft.id && listing.id === draft.id) continue;
    if (listing.state === "ended" || listing.state === "rejected" || listing.state === "failed") continue;
    if (!listingTitlesLookAlike(listing.title, draft.title)) continue;
    if (listing.priceUsd > 0 && draft.priceUsd > 0) {
      const ratio = draft.priceUsd / listing.priceUsd;
      if (ratio < 0.85 || ratio > 1.15) continue;
    }
    return listing;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type CreateListingDraftInput = {
  accountId: string;
  title: string;
  description: string;
  priceUsd: number;
  minOfferUsd?: number;
  category?: string;
  condition?: string;
};

export async function createMarketplaceListingDraft(input: CreateListingDraftInput): Promise<MarketplaceListing> {
  const now = new Date().toISOString();
  const listing: MarketplaceListing = {
    id: `mlst_${randomUUID()}`,
    accountId: input.accountId,
    origin: "drafted",
    state: "draft",
    title: input.title.trim(),
    description: input.description.trim(),
    priceUsd: input.priceUsd,
    ...(typeof input.minOfferUsd === "number" && input.minOfferUsd > 0 ? { minOfferUsd: input.minOfferUsd } : {}),
    ...(input.category?.trim() ? { category: input.category.trim() } : {}),
    ...(input.condition?.trim() ? { condition: input.condition.trim() } : {}),
    photos: [],
    stateHistory: [{ state: "draft", at: now, by: "human" }],
    createdAt: now,
    updatedAt: now,
  };
  if (!listing.title) throw new Error("Listing title is required.");
  await mutateRecordsFile(LISTINGS_FILE, normalizeMarketplaceListingRecord, (listings) => [...listings, listing]);
  return listing;
}

export type UpdateListingDraftPatch = Partial<
  Pick<MarketplaceListing, "title" | "description" | "priceUsd" | "minOfferUsd" | "category" | "condition" | "photos" | "research">
> & { clearMinOffer?: boolean };

export async function updateMarketplaceListing(id: string, patch: UpdateListingDraftPatch): Promise<MarketplaceListing | null> {
  let updated: MarketplaceListing | null = null;
  await mutateRecordsFile(LISTINGS_FILE, normalizeMarketplaceListingRecord, (listings) =>
    listings.map((listing) => {
      if (listing.id !== id) return listing;
      const merged: MarketplaceListing = {
        ...listing,
        ...(patch.title !== undefined ? { title: patch.title.trim() || listing.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.priceUsd !== undefined && Number.isFinite(patch.priceUsd) && patch.priceUsd >= 0 ? { priceUsd: patch.priceUsd } : {}),
        ...(patch.minOfferUsd !== undefined && Number.isFinite(patch.minOfferUsd) && (patch.minOfferUsd as number) > 0
          ? { minOfferUsd: patch.minOfferUsd }
          : {}),
        ...(patch.category !== undefined ? { category: patch.category.trim() || undefined } : {}),
        ...(patch.condition !== undefined ? { condition: patch.condition.trim() || undefined } : {}),
        ...(patch.photos !== undefined ? { photos: patch.photos } : {}),
        ...(patch.research !== undefined ? { research: patch.research } : {}),
        updatedAt: new Date().toISOString(),
      };
      if (patch.clearMinOffer) delete merged.minOfferUsd;
      updated = merged;
      return merged;
    }),
  );
  return updated;
}

export async function setMarketplaceListingState(
  id: string,
  state: MarketplaceListingState,
  by: "human" | "agent" | "tick",
  external?: MarketplaceListing["external"],
): Promise<MarketplaceListing | null> {
  let updated: MarketplaceListing | null = null;
  const now = new Date().toISOString();
  await mutateRecordsFile(LISTINGS_FILE, normalizeMarketplaceListingRecord, (listings) =>
    listings.map((listing) => {
      if (listing.id !== id) return listing;
      updated = {
        ...listing,
        state,
        ...(external ? { external } : {}),
        stateHistory: [...listing.stateHistory, { state, at: now, by }],
        updatedAt: now,
      };
      return updated;
    }),
  );
  return updated;
}

export async function deleteMarketplaceListing(id: string): Promise<boolean> {
  let removed = false;
  await mutateRecordsFile(LISTINGS_FILE, normalizeMarketplaceListingRecord, (listings) => {
    const next = listings.filter((listing) => listing.id !== id);
    removed = next.length !== listings.length;
    return next;
  });
  return removed;
}

/**
 * Merge a catalog sweep into the listings file: items matching an existing
 * record's externalId refresh its external snapshot + state; unknown items
 * become origin:"synced" records so the monitor covers the whole account.
 */
export async function upsertSyncedListings(accountId: string, items: MarketplaceReportCatalogItem[]): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;
  const now = new Date().toISOString();
  await mutateRecordsFile(LISTINGS_FILE, normalizeMarketplaceListingRecord, (listings) => {
    const next = [...listings];
    for (const item of items) {
      const externalId = item.externalId?.trim();
      if (!externalId || !item.title?.trim()) continue;
      const stateFromItem: MarketplaceListingState = item.state === "sold" || item.state === "ended" ? "ended" : "active";
      const index = next.findIndex((listing) => listing.accountId === accountId && listing.external?.externalId === externalId);
      if (index >= 0) {
        const existing = next[index];
        next[index] = {
          ...existing,
          title: item.title.trim(),
          ...(typeof item.priceUsd === "number" && Number.isFinite(item.priceUsd) ? { priceUsd: item.priceUsd } : {}),
          state: existing.state === "posting" ? existing.state : stateFromItem,
          external: {
            externalId,
            url: item.url?.trim() || existing.external?.url || "",
            ...(existing.external?.postedAt ? { postedAt: existing.external.postedAt } : {}),
            lastSyncedAt: now,
          },
          updatedAt: now,
        };
        updated++;
        continue;
      }
      next.push({
        id: `mlst_${randomUUID()}`,
        accountId,
        origin: "synced",
        state: stateFromItem,
        title: item.title.trim(),
        description: "",
        priceUsd: typeof item.priceUsd === "number" && Number.isFinite(item.priceUsd) ? item.priceUsd : 0,
        photos: [],
        external: { externalId, url: item.url?.trim() || "", lastSyncedAt: now },
        stateHistory: [{ state: stateFromItem, at: now, by: "tick" }],
        createdAt: now,
        updatedAt: now,
      });
      added++;
    }
    return next;
  });
  return { added, updated };
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

function photosRootDir(): string {
  const storage = resolveMarketplaceStorage(PHOTOS_DIR_NAME);
  return storage.file;
}

/**
 * Resolve a stored vault-relative photo path to an absolute path under the
 * current photos root, rejecting traversal. Accepts both the canonical
 * "Operations/Marketplace/Photos/…" form and a bare "Photos/…" suffix.
 */
export function resolveMarketplacePhotoAbsolutePath(vaultPath: string): string {
  const cleaned = vaultPath.trim().replace(/\\/g, "/");
  const suffix = cleaned.startsWith(`${VAULT_PHOTO_PREFIX}/`)
    ? cleaned.slice(VAULT_PHOTO_PREFIX.length + 1)
    : cleaned.startsWith(`${PHOTOS_DIR_NAME}/`)
      ? cleaned.slice(PHOTOS_DIR_NAME.length + 1)
      : "";
  if (!suffix) throw new Error(`Not a marketplace photo path: ${vaultPath}`);
  const root = photosRootDir();
  const absolute = path.resolve(root, suffix);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error(`Refusing to resolve a photo path outside the marketplace photos root: ${vaultPath}`);
  }
  return absolute;
}

export type ListingPhotoPayload = { dataUrl: string; alt?: string };

function safePhotoListingId(listingId: string): string {
  const safe = listingId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("Invalid listing id for photo storage.");
  return safe;
}

/** Decode + validate photo payloads WITHOUT touching disk (caps + image-mime allowlist). */
function decodeListingPhotoPayloads(photos: ListingPhotoPayload[]): Array<{ extension: string; bytes: Buffer; alt?: string }> {
  const decoded: Array<{ extension: string; bytes: Buffer; alt?: string }> = [];
  for (const [index, photo] of photos.entries()) {
    const match = photo.dataUrl.match(/^data:([a-z0-9./+-]+);base64,(.+)$/i);
    if (!match) throw new Error(`Photo ${index + 1} is not a base64 data URL.`);
    const mime = match[1].toLowerCase();
    const extension = PHOTO_EXTENSION_BY_MIME[mime];
    if (!extension) throw new Error(`Photo ${index + 1} has unsupported type ${mime}.`);
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length) throw new Error(`Photo ${index + 1} is empty.`);
    if (bytes.length > MARKETPLACE_MAX_PHOTO_BYTES) {
      throw new Error(`Photo ${index + 1} is ${(bytes.length / (1024 * 1024)).toFixed(1)} MB (max ${MARKETPLACE_MAX_PHOTO_BYTES / (1024 * 1024)} MB).`);
    }
    decoded.push({ extension, bytes, ...(photo.alt?.trim() ? { alt: photo.alt.trim() } : {}) });
  }
  return decoded;
}

/**
 * Replace a listing's photo set with freshly decoded payloads. Decode-first so
 * a bad payload can never destroy the photos already stored for this listing.
 */
export async function saveListingPhotos(listingId: string, photos: ListingPhotoPayload[]): Promise<MarketplaceListingPhoto[]> {
  const safeListingId = safePhotoListingId(listingId);
  if (photos.length > MARKETPLACE_MAX_PHOTOS_PER_LISTING) {
    throw new Error(`Too many photos: ${photos.length} (max ${MARKETPLACE_MAX_PHOTOS_PER_LISTING}).`);
  }
  const decoded = decodeListingPhotoPayloads(photos);
  const directory = path.join(photosRootDir(), safeListingId);
  await fs.rm(directory, { recursive: true, force: true });
  if (!decoded.length) return [];
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const records: MarketplaceListingPhoto[] = [];
  for (const [index, photo] of decoded.entries()) {
    const fileName = `${index + 1}.${photo.extension}`;
    await fs.writeFile(path.join(directory, fileName), new Uint8Array(photo.bytes), { mode: 0o600 });
    records.push({
      vaultPath: `${VAULT_PHOTO_PREFIX}/${safeListingId}/${fileName}`,
      ...(photo.alt ? { alt: photo.alt } : {}),
    });
  }
  return records;
}

/**
 * Merge-edit a listing's photos: keep a subset of the existing files (by
 * vaultPath), delete the rest, and append newly uploaded payloads — so editing
 * never re-uploads bytes the server already has.
 */
export async function mergeListingPhotos(
  listingId: string,
  keepVaultPaths: string[],
  add: ListingPhotoPayload[],
): Promise<MarketplaceListingPhoto[]> {
  const safeListingId = safePhotoListingId(listingId);
  const listing = await getMarketplaceListing(listingId);
  const existing = listing?.photos ?? [];
  const keepSet = new Set(keepVaultPaths);
  const kept = existing.filter((photo) => keepSet.has(photo.vaultPath));
  if (kept.length + add.length > MARKETPLACE_MAX_PHOTOS_PER_LISTING) {
    throw new Error(`Too many photos: ${kept.length + add.length} (max ${MARKETPLACE_MAX_PHOTOS_PER_LISTING}).`);
  }
  const decoded = decodeListingPhotoPayloads(add);
  // Delete dropped files (best-effort — a missing file is already gone).
  for (const photo of existing) {
    if (keepSet.has(photo.vaultPath)) continue;
    await fs.rm(resolveMarketplacePhotoAbsolutePath(photo.vaultPath), { force: true }).catch(() => undefined);
  }
  const directory = path.join(photosRootDir(), safeListingId);
  const records: MarketplaceListingPhoto[] = [...kept];
  if (decoded.length) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    // Continue numbering past the highest existing index to keep names unique.
    let nextIndex = existing.reduce((max, photo) => {
      const match = photo.vaultPath.match(/\/(\d+)\.[a-z0-9]+$/i);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    for (const photo of decoded) {
      nextIndex += 1;
      const fileName = `${nextIndex}.${photo.extension}`;
      await fs.writeFile(path.join(directory, fileName), new Uint8Array(photo.bytes), { mode: 0o600 });
      records.push({
        vaultPath: `${VAULT_PHOTO_PREFIX}/${safeListingId}/${fileName}`,
        ...(photo.alt ? { alt: photo.alt } : {}),
      });
    }
  }
  return records;
}
