"use client";

import { useEffect, useMemo, useState } from "react";
import { Globe2, ImagePlus, MapPin, Search, Send, X } from "lucide-react";

import { ImageAttachmentThumbnail } from "@/features/chat/image-attachment-preview";
import type { MarketplaceListing } from "@/lib/services/marketplace/marketplace-types";

import { useMarketplaceDesk } from "./marketplace-context";
import { PriceResearchPanel } from "./PriceResearchPanel";
import { ListingStatusPill, Spinner, ghostButtonStyle, primaryButtonStyle } from "./primitives";
import { usePriceResearch } from "./use-price-research";
import { useListingImages, MAX_LISTING_IMAGES } from "./use-listing-images";

/**
 * Create/edit a listing: describe the item, attach photos (drag/drop or
 * picker), optionally hand pricing to the Queen (locale-aware research with a
 * live stage ticker), then submit for approval — the agent posts only after
 * the human approves the exact preview.
 */

const CONDITION_OPTIONS = ["New", "Like new", "Good", "Fair", "For parts"];

const labelStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", letterSpacing: 0.02, marginBottom: 6, display: "block" };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 10, fontSize: 13.5,
  background: "var(--panel-2)", border: "1px solid var(--line-2)", color: "var(--fg)",
  fontFamily: "var(--f-body)", outline: "none",
};

export function ListingModal() {
  const desk = useMarketplaceDesk();
  if (!desk.listingModal.open) return null;
  // key-remount per target so every field hydrates via useState initializers —
  // no hydrate-on-open effect (react-hooks/set-state-in-effect).
  return <ListingModalBody key={desk.listingModal.listingId ?? "new"} />;
}

function ListingModalBody() {
  const desk = useMarketplaceDesk();
  const research = usePriceResearch();
  const { images, imageError, addFiles, removeImage, reset: resetImages, dropRef, dropActive, dropHandlers } = useListingImages();
  const existing = desk.listingModal.listingId ? desk.listings.find((listing) => listing.id === desk.listingModal.listingId) ?? null : null;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [price, setPrice] = useState(existing && existing.priceUsd > 0 ? String(existing.priceUsd) : "");
  const [minOfferEnabled, setMinOfferEnabled] = useState(Boolean(existing?.minOfferUsd));
  const [minOffer, setMinOffer] = useState(existing?.minOfferUsd ? String(existing.minOfferUsd) : "");
  const [condition, setCondition] = useState(existing?.condition ?? "");
  const [keepPhotos, setKeepPhotos] = useState<string[]>(existing?.photos.map((photo) => photo.vaultPath) ?? []);
  const [savedListingId, setSavedListingId] = useState<string | null>(existing?.id ?? null);
  const [globalComparison, setGlobalComparison] = useState(desk.activeAccount?.locale.globalComparison ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarningId, setDuplicateWarningId] = useState<string | null>(null);

  const editable = !existing || existing.state === "draft" || existing.state === "rejected" || existing.state === "failed";

  // When research succeeds, apply the suggested price (still editable).
  // Deferred kick per the set-state-in-effect rule.
  const suggested = research.job?.status === "succeeded" ? research.job.result : undefined;
  const suggestedPrice = suggested?.suggestedPriceUsd;
  useEffect(() => {
    if (suggestedPrice === undefined) return;
    const timer = window.setTimeout(() => setPrice(String(suggestedPrice)), 0);
    return () => window.clearTimeout(timer);
  }, [suggestedPrice]);

  const totalPhotoCount = keepPhotos.length + images.length;
  const priceNumber = Number.parseFloat(price);
  const minOfferNumber = Number.parseFloat(minOffer);

  const draftBody = useMemo(() => ({
    title: title.trim(),
    description,
    priceUsd: Number.isFinite(priceNumber) && priceNumber > 0 ? priceNumber : 0,
    ...(minOfferEnabled && Number.isFinite(minOfferNumber) && minOfferNumber > 0 ? { minOfferUsd: minOfferNumber } : { clearMinOffer: true }),
    ...(condition ? { condition } : {}),
  }), [title, description, priceNumber, minOfferEnabled, minOfferNumber, condition]);

  const close = () => {
    desk.closeListingModal();
  };

  /** Persist the draft (create or update) and return its id. */
  const saveDraft = async (): Promise<string | null> => {
    if (!desk.activeAccountId) {
      setError("Connect a marketplace account first.");
      return null;
    }
    if (!title.trim()) {
      setError("Give the listing a title.");
      return null;
    }
    const newPhotoPayloads = images.map((image) => ({ dataUrl: image.dataUrl }));
    if (savedListingId) {
      const result = await desk.runListingsAction({
        action: "update-draft",
        id: savedListingId,
        ...draftBody,
        photosPatch: { keepVaultPaths: keepPhotos, add: newPhotoPayloads },
      });
      if (!result.ok) {
        setError(result.error ?? "Could not save the draft.");
        return null;
      }
      const updated = result.listing as MarketplaceListing | undefined;
      if (updated) {
        setKeepPhotos(updated.photos.map((photo) => photo.vaultPath));
        resetImages();
      }
      return savedListingId;
    }
    const result = await desk.runListingsAction({
      action: "create-draft",
      accountId: desk.activeAccountId,
      ...draftBody,
      photos: newPhotoPayloads,
    });
    if (!result.ok) {
      setError(result.error ?? "Could not create the draft.");
      return null;
    }
    const created = result.listing as MarketplaceListing | undefined;
    if (!created) {
      setError("The draft was not returned by the server.");
      return null;
    }
    setSavedListingId(created.id);
    setKeepPhotos(created.photos.map((photo) => photo.vaultPath));
    resetImages();
    return created.id;
  };

  const startResearch = async () => {
    setBusy(true);
    setError(null);
    try {
      const listingId = await saveDraft();
      if (!listingId) return;
      await research.start(listingId, globalComparison);
    } finally {
      setBusy(false);
    }
  };

  const submitForApproval = async (overrideDuplicate = false) => {
    setBusy(true);
    setError(null);
    try {
      if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
        setError("Set a price first — run the research or type one in.");
        return;
      }
      const listingId = await saveDraft();
      if (!listingId) return;
      const result = await desk.runListingsAction({ action: "request-approval", id: listingId, ...(overrideDuplicate ? { overrideDuplicate: true } : {}) });
      if (!result.ok) {
        if (typeof result.duplicateListingId === "string") {
          setDuplicateWarningId(result.duplicateListingId);
          setError(result.error ?? "This looks like a duplicate listing.");
        } else {
          setError(result.error ?? "Could not submit the listing.");
        }
        return;
      }
      close();
    } finally {
      setBusy(false);
    }
  };

  const researchDisabledReason = !description.trim()
    ? "Write a description first so the Queen knows what to research. Photos help too."
    : research.active
      ? "Research is already running."
      : null;

  return (
    <div
      className="mkt-root"
      data-theme={desk.theme}
      role="dialog"
      aria-modal="true"
      aria-label={existing ? "Listing details" : "Create a listing"}
      onClick={close}
      style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", padding: 20, background: "color-mix(in srgb, var(--bg) 62%, transparent)", backdropFilter: "blur(14px)" }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ width: "min(640px, 96vw)", maxHeight: "92vh", overflowY: "auto", borderRadius: 18, border: "1px solid var(--line-2)", background: "var(--panel)", boxShadow: "var(--shadow)", padding: "22px 24px", color: "var(--fg)", display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 600, margin: 0, flex: 1 }}>
            {existing ? existing.title : "Sell something"}
          </h2>
          {existing ? <ListingStatusPill state={existing.state} /> : null}
          <button type="button" aria-label="Close" onClick={close} style={{ background: "transparent", border: "none", color: "var(--fg-3)", cursor: "pointer", padding: 4 }}>
            <X aria-hidden width={16} height={16} />
          </button>
        </div>

        {!editable && existing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {existing.external?.url ? (
              <a href={existing.external.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "var(--honey)" }}>
                View on the marketplace ↗
              </a>
            ) : null}
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--fg-2)", whiteSpace: "pre-wrap" }}>{existing.description || "No description on file (synced from your account)."}</p>
            <div style={{ display: "flex", gap: 14, fontFamily: "var(--f-mono)", fontSize: 12.5 }}>
              <span>${existing.priceUsd}</span>
              {existing.minOfferUsd ? <span style={{ color: "var(--fg-3)" }}>min offer ${existing.minOfferUsd}</span> : null}
            </div>
            {existing.photos.length ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {existing.photos.map((photo) => (
                  <ImageAttachmentThumbnail key={photo.vaultPath} src={`/api/marketplace/photo?path=${encodeURIComponent(photo.vaultPath)}`} alt={photo.alt ?? existing.title} variant="composer" />
                ))}
              </div>
            ) : null}
            <div>
              <span className="mcap" style={{ color: "var(--fg-4)" }}>History</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {existing.stateHistory.slice(-6).map((entry, index) => (
                  <span key={index} style={{ fontSize: 11.5, color: "var(--fg-3)", fontFamily: "var(--f-mono)" }}>
                    {new Date(entry.at).toLocaleString()} — {entry.state} ({entry.by})
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Photos */}
            <div
              ref={dropRef}
              {...dropHandlers}
              className={`mkt-dropzone${dropActive ? " drag-over" : ""}`}
              style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}
            >
              {totalPhotoCount > 0 ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {keepPhotos.map((vaultPath) => (
                    <ImageAttachmentThumbnail
                      key={vaultPath}
                      src={`/api/marketplace/photo?path=${encodeURIComponent(vaultPath)}`}
                      alt={title || "Listing photo"}
                      variant="composer"
                      onRemove={() => setKeepPhotos((current) => current.filter((entry) => entry !== vaultPath))}
                    />
                  ))}
                  {images.map((image) => (
                    <ImageAttachmentThumbnail key={image.id} src={image.previewUrl} alt={image.name} variant="composer" onRemove={() => removeImage(image.id)} />
                  ))}
                </div>
              ) : null}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--fg-2)", cursor: "pointer", alignSelf: "flex-start" }}>
                <ImagePlus aria-hidden width={15} height={15} style={{ color: "var(--honey)" }} />
                {totalPhotoCount > 0 ? `Add photos (${totalPhotoCount}/${MAX_LISTING_IMAGES})` : "Add photos — or drop them anywhere on this box"}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(event) => {
                    if (event.target.files?.length) addFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
              {imageError ? <span style={{ fontSize: 11.5, color: "var(--danger)" }}>{imageError}</span> : null}
            </div>

            {/* Title + description */}
            <div>
              <label style={labelStyle} htmlFor="mkt-listing-title">What are you selling?</label>
              <input id="mkt-listing-title" style={inputStyle} placeholder="e.g. 2018 Toyota Camry SE, 60k miles" value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="mkt-listing-description">Description</label>
              <textarea
                id="mkt-listing-description"
                style={{ ...inputStyle, minHeight: 96, resize: "vertical", lineHeight: 1.55 }}
                placeholder="Condition, history, extras — the agent answers buyer questions from this, so include what matters."
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle} htmlFor="mkt-listing-condition">Condition</label>
                <select id="mkt-listing-condition" style={inputStyle} value={condition} onChange={(event) => setCondition(event.target.value)}>
                  <option value="">Not specified</option>
                  {CONDITION_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="mkt-listing-price">Asking price (USD)</label>
                <input
                  id="mkt-listing-price"
                  style={{ ...inputStyle, fontFamily: "var(--f-mono)" }}
                  inputMode="decimal"
                  placeholder="0"
                  value={price}
                  disabled={research.active}
                  onChange={(event) => setPrice(event.target.value.replace(/[^0-9.]/g, ""))}
                />
              </div>
            </div>

            {/* Price research */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={Boolean(researchDisabledReason) || busy}
                  title={researchDisabledReason ?? undefined}
                  onClick={() => void startResearch()}
                  style={ghostButtonStyle()}
                >
                  {research.starting ? <Spinner size={13} /> : <Search aria-hidden width={14} height={14} style={{ color: "var(--honey)" }} />}
                  Auto-set price from research
                </button>
                <div role="radiogroup" aria-label="Research scope" style={{ display: "inline-flex", border: "1px solid var(--line-2)", borderRadius: 999, overflow: "hidden" }}>
                  {[{ id: false, label: "Local prices", icon: <MapPin aria-hidden width={12} height={12} /> }, { id: true, label: "Global prices", icon: <Globe2 aria-hidden width={12} height={12} /> }].map((option) => (
                    <button
                      key={String(option.id)}
                      type="button"
                      role="radio"
                      aria-checked={globalComparison === option.id}
                      disabled={research.active}
                      onClick={() => setGlobalComparison(option.id)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: 11.5, fontWeight: 500,
                        background: globalComparison === option.id ? "var(--honey-soft)" : "transparent",
                        color: globalComparison === option.id ? "var(--honey)" : "var(--fg-3)",
                        border: "none", cursor: research.active ? "default" : "pointer",
                      }}
                    >
                      {option.icon}
                      {option.label}
                    </button>
                  ))}
                </div>
                {!globalComparison && desk.activeAccount?.locale.description ? (
                  <span style={{ fontSize: 11, color: "var(--fg-4)" }}>near {desk.activeAccount.locale.description}</span>
                ) : null}
              </div>
              {research.startError ? <span style={{ fontSize: 12, color: "var(--danger)" }}>{research.startError}</span> : null}
              {research.job ? (
                <PriceResearchPanel
                  job={research.job}
                  onRetry={() => void startResearch()}
                  onUseManualPrice={() => research.resetResearch()}
                />
              ) : null}
              {suggested ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {[
                    { label: `Quick sale $${suggested.priceRangeUsd[0]}`, value: suggested.priceRangeUsd[0] },
                    { label: `Suggested $${suggested.suggestedPriceUsd}`, value: suggested.suggestedPriceUsd },
                    { label: `Patient $${suggested.priceRangeUsd[1]}`, value: suggested.priceRangeUsd[1] },
                  ].map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => setPrice(String(chip.value))}
                      style={{
                        padding: "5px 11px", borderRadius: 999, fontSize: 11.5, fontFamily: "var(--f-mono)",
                        border: `1px solid ${Number.parseFloat(price) === chip.value ? "var(--honey)" : "var(--line-2)"}`,
                        background: Number.parseFloat(price) === chip.value ? "var(--honey-soft)" : "transparent",
                        color: Number.parseFloat(price) === chip.value ? "var(--honey)" : "var(--fg-2)", cursor: "pointer",
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                  <span style={{ fontSize: 11, color: "var(--fg-4)" }}>{suggested.confidence} confidence · {suggested.comps.length} comps</span>
                </div>
              ) : null}
            </div>

            {/* Minimum offer */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={minOfferEnabled} onChange={(event) => setMinOfferEnabled(event.target.checked)} />
                Ignore offers below…
              </label>
              {minOfferEnabled ? (
                <input
                  aria-label="Minimum acceptable offer (USD)"
                  style={{ ...inputStyle, width: 130, fontFamily: "var(--f-mono)" }}
                  inputMode="decimal"
                  placeholder="$"
                  value={minOffer}
                  onChange={(event) => setMinOffer(event.target.value.replace(/[^0-9.]/g, ""))}
                />
              ) : (
                <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>Off — the agent escalates any offer it is unsure about.</span>
              )}
            </div>

            {error ? (
              <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--danger)" }}>
                {error}
                {duplicateWarningId ? (
                  <button type="button" style={{ ...ghostButtonStyle(), marginLeft: 10, borderColor: "var(--danger)", color: "var(--danger)" }} onClick={() => void submitForApproval(true)}>
                    It really is a different item — submit anyway
                  </button>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                style={ghostButtonStyle()}
                disabled={busy}
                onClick={() => void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const id = await saveDraft();
                    if (id) close();
                  } finally {
                    setBusy(false);
                  }
                })()}
              >
                Save draft
              </button>
              <button type="button" style={primaryButtonStyle(busy)} disabled={busy || research.active} onClick={() => void submitForApproval()}>
                {busy ? <Spinner size={13} /> : <Send aria-hidden width={14} height={14} />}
                Submit for your approval
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--fg-4)", textAlign: "right" }}>
              Nothing posts yet — you approve the final preview, then the agent lists it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
