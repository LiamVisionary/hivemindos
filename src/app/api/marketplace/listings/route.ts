// guard:allow-hive-action-route - dashboard-only Marketplace listings management; not an
// agent-invokable Hive action. request-approval is the authenticated human's own submit
// from the listing editor, so its decision is created pre-approved and posting starts
// immediately (their submit IS the approval); agent-proposed listings still go through a
// pending decision card (listing-approval-required, re-checked at fire time).
import { NextRequest } from "next/server";

import { errorJson, okJson } from "@/lib/utils/api-response";
import { readMarketplaceConversations } from "@/lib/services/marketplace/marketplace-conversations-store";
import {
  createMarketplaceListingDraft,
  deleteMarketplaceListing,
  getMarketplaceListing,
  mergeListingPhotos,
  readMarketplaceListings,
  saveListingPhotos,
  updateMarketplaceListing,
  type ListingPhotoPayload,
} from "@/lib/services/marketplace/marketplace-listings-store";
import { getMarketplaceAccount } from "@/lib/services/marketplace/marketplace-store";
import {
  DuplicateListingError,
  requestListingApproval,
  syncMarketplaceCatalog,
} from "@/lib/services/marketplace/marketplace-listing-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function photoPayloads(raw: unknown): ListingPhotoPayload[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is { dataUrl: string; alt?: string } => Boolean(item && typeof item === "object" && typeof (item as { dataUrl?: unknown }).dataUrl === "string"))
    .map((item) => ({ dataUrl: item.dataUrl, ...(item.alt ? { alt: item.alt } : {}) }));
}

export async function GET(request: NextRequest) {
  try {
    const accountId = request.nextUrl.searchParams.get("accountId")?.trim() || undefined;
    const [listings, conversations] = await Promise.all([
      readMarketplaceListings(accountId),
      readMarketplaceConversations(accountId),
    ]);
    return okJson({ listings, conversations });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : String(error), 500);
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorJson("Invalid JSON body");
  }
  const action = typeof body.action === "string" ? body.action : "";
  try {
    switch (action) {
      case "create-draft": {
        const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
        if (!accountId || !(await getMarketplaceAccount(accountId))) return errorJson("A connected marketplace account is required.");
        const title = typeof body.title === "string" ? body.title.trim() : "";
        const description = typeof body.description === "string" ? body.description : "";
        const priceUsd = typeof body.priceUsd === "number" && Number.isFinite(body.priceUsd) ? body.priceUsd : 0;
        if (!title) return errorJson("title is required");
        const draft = await createMarketplaceListingDraft({
          accountId,
          title,
          description,
          priceUsd,
          ...(typeof body.minOfferUsd === "number" && body.minOfferUsd > 0 ? { minOfferUsd: body.minOfferUsd } : {}),
          ...(typeof body.category === "string" ? { category: body.category } : {}),
          ...(typeof body.condition === "string" ? { condition: body.condition } : {}),
        });
        const photos = photoPayloads(body.photos);
        if (photos.length) {
          const records = await saveListingPhotos(draft.id, photos);
          await updateMarketplaceListing(draft.id, { photos: records });
        }
        const listing = await getMarketplaceListing(draft.id);
        return okJson({ listing: listing ?? draft });
      }
      case "update-draft": {
        const id = typeof body.id === "string" ? body.id.trim() : "";
        if (!id) return errorJson("id is required");
        const existing = await getMarketplaceListing(id);
        if (!existing) return errorJson(`Unknown listing: ${id}`, 404);
        if (existing.state !== "draft" && existing.state !== "rejected" && existing.state !== "failed") {
          return errorJson(`Listing is ${existing.state} — only drafts are editable here.`);
        }
        if (body.photosPatch && typeof body.photosPatch === "object") {
          const patch = body.photosPatch as { keepVaultPaths?: unknown; add?: unknown };
          const keep = Array.isArray(patch.keepVaultPaths) ? patch.keepVaultPaths.filter((entry): entry is string => typeof entry === "string") : [];
          const records = await mergeListingPhotos(id, keep, photoPayloads(patch.add));
          await updateMarketplaceListing(id, { photos: records });
        } else if (Array.isArray(body.photos)) {
          const records = await saveListingPhotos(id, photoPayloads(body.photos));
          await updateMarketplaceListing(id, { photos: records });
        }
        const listing = await updateMarketplaceListing(id, {
          ...(typeof body.title === "string" ? { title: body.title } : {}),
          ...(typeof body.description === "string" ? { description: body.description } : {}),
          ...(typeof body.priceUsd === "number" && Number.isFinite(body.priceUsd) ? { priceUsd: body.priceUsd } : {}),
          ...(typeof body.minOfferUsd === "number" && body.minOfferUsd > 0 ? { minOfferUsd: body.minOfferUsd } : {}),
          ...(body.clearMinOffer === true ? { clearMinOffer: true } : {}),
          ...(typeof body.category === "string" ? { category: body.category } : {}),
          ...(typeof body.condition === "string" ? { condition: body.condition } : {}),
        });
        return okJson({ listing });
      }
      case "request-approval": {
        const id = typeof body.id === "string" ? body.id.trim() : "";
        if (!id) return errorJson("id is required");
        try {
          // This route is dashboard-only (auth-gated, not a hive action), so the
          // caller is the human who authored the draft — submit auto-approves.
          const result = await requestListingApproval(id, { overrideDuplicate: body.overrideDuplicate === true, submittedBy: "human" });
          return okJson({ listing: result.listing, decision: result.decision });
        } catch (error) {
          if (error instanceof DuplicateListingError) {
            return errorJson(error.message, 409, { duplicateListingId: error.duplicate.id });
          }
          throw error;
        }
      }
      case "delete-draft": {
        const id = typeof body.id === "string" ? body.id.trim() : "";
        if (!id) return errorJson("id is required");
        const existing = await getMarketplaceListing(id);
        if (!existing) return errorJson(`Unknown listing: ${id}`, 404);
        if (existing.state === "active" || existing.state === "posting" || existing.state === "posted-unverified") {
          return errorJson("This listing is live — end it on the marketplace instead of deleting the record.");
        }
        await deleteMarketplaceListing(id);
        return okJson();
      }
      case "sync-catalog": {
        const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
        if (!accountId) return errorJson("accountId is required");
        const result = await syncMarketplaceCatalog(accountId);
        return okJson(result);
      }
      default:
        return errorJson(`Unknown action: ${action || "(none)"}`);
    }
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : String(error), 500);
  }
}
