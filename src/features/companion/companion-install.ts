"use client";

/* companion-install.ts — install/uninstall lifecycle for the hologram
 * companion module.
 *
 * Asset bytes live in the browser Cache API (COMPANION_CACHE_NAME) — never in
 * the dashboard state store (AGENTS.md: only small scalar settings there).
 * The dashboard state service holds just the flags: installed, popover mode,
 * hologram mode. Install streams each CDN asset with byte progress, then
 * flips the flag; the engine later loads assets through blob object URLs so
 * playback works fully offline.
 */

import {
  loadDashboardStateSnapshot,
  saveDashboardStateValue,
} from "@/lib/services/dashboard-state-client";
import {
  COMPANION_ASSETS,
  COMPANION_CACHE_NAME,
  COMPANION_TOTAL_APPROX_BYTES,
  companionAssetUrl,
  type CompanionAsset,
} from "./companion-assets";

export const COMPANION_INSTALLED_KEY = "hivemindos.companion.installed.v1";
export const COMPANION_POPOVER_KEY = "hivemindos.companion.popover.v1";
export const COMPANION_HOLOGRAM_KEY = "hivemindos.companion.hologram.v1";
// Camera framing (numbers as strings; shared by the fleet tab + popover).
export const COMPANION_CAMERA_DISTANCE_KEY = "hivemindos.companion.camera.distance.v1";
export const COMPANION_CAMERA_CENTER_Y_KEY = "hivemindos.companion.camera.centerY.v1";
/** Wardrobe outfit key (SARA_OUTFITS); empty = default. */
export const COMPANION_OUTFIT_KEY = "hivemindos.companion.outfit.v1";

export const COMPANION_CAMERA_DISTANCE_DEFAULT = 2.4;
export const COMPANION_CAMERA_CENTER_Y_DEFAULT = 1.4;

const COMPANION_STATE_EVENT = "hivemindos:companion-state";

export type CompanionSettings = {
  installed: boolean;
  /** Floating always-on-top popover window (desktop only). Off by default. */
  popoverEnabled: boolean;
  /** Hologram render style. On by default — the companion's signature look. */
  hologramEnabled: boolean;
};

export type CompanionDownloadProgress = {
  /** 0..1 across the whole manifest, byte-weighted. */
  fraction: number;
  downloadedBytes: number;
  totalBytes: number;
  currentAsset: CompanionAsset | null;
  completedAssets: number;
  totalAssets: number;
};

function cachesAvailable(): boolean {
  return typeof window !== "undefined" && typeof caches !== "undefined";
}

export async function readCompanionSettings(): Promise<CompanionSettings> {
  const snapshot = await loadDashboardStateSnapshot().catch(
    () => ({}) as Record<string, unknown>,
  );
  return {
    installed: snapshot[COMPANION_INSTALLED_KEY] === "1",
    popoverEnabled: snapshot[COMPANION_POPOVER_KEY] === "1",
    // Default ON when unset — hologram is the companion's default style.
    hologramEnabled: snapshot[COMPANION_HOLOGRAM_KEY] !== "0",
  };
}

export function emitCompanionStateChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COMPANION_STATE_EVENT));
}

/** Subscribe to install/settings changes (fired after any flag write). */
export function subscribeCompanionState(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(COMPANION_STATE_EVENT, onChange);
  return () => window.removeEventListener(COMPANION_STATE_EVENT, onChange);
}

export async function saveCompanionFlag(
  key: string,
  enabled: boolean,
): Promise<void> {
  await saveDashboardStateValue(key, enabled ? "1" : "0").catch(() => undefined);
  emitCompanionStateChanged();
}

/** True when every manifest asset is present in the local cache. */
export async function companionCacheComplete(): Promise<boolean> {
  if (!cachesAvailable()) return false;
  try {
    const cache = await caches.open(COMPANION_CACHE_NAME);
    for (const asset of COMPANION_ASSETS) {
      const hit = await cache.match(companionAssetUrl(asset));
      if (!hit) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Stream one asset into the cache with byte progress. Reads the body
 * manually so progress ticks smoothly through the 37 MB VRM instead of
 * jumping per file.
 */
async function downloadAssetToCache(
  cache: Cache | null,
  asset: CompanionAsset,
  onBytes: (delta: number) => void,
): Promise<void> {
  const url = companionAssetUrl(asset);
  if (cache) {
    const existing = await cache.match(url);
    if (existing) {
      onBytes(asset.approxBytes);
      return;
    }
  }
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${asset.path}`);
  }
  const declaredTotal = Number(response.headers.get("content-length") || 0);
  const total = declaredTotal > 0 ? declaredTotal : asset.approxBytes;
  const scale = asset.approxBytes / total;

  if (!response.body) {
    const blob = await response.blob();
    if (cache) await cache.put(url, new Response(blob, { headers: response.headers }));
    onBytes(asset.approxBytes);
    return;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      onBytes(value.byteLength * scale);
    }
  }
  const blob = new Blob(chunks as BlobPart[]);
  if (cache) {
    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    headers.set("content-length", String(blob.size));
    await cache.put(url, new Response(blob, { status: 200, headers }));
  }
}

/**
 * Download the full companion manifest and mark the module installed.
 * Without the Cache API (very old webviews) it still succeeds — assets then
 * stream from the CDN on each launch instead of from the local cache.
 */
export async function installCompanion(
  onProgress?: (progress: CompanionDownloadProgress) => void,
): Promise<void> {
  const cache = cachesAvailable()
    ? await caches.open(COMPANION_CACHE_NAME).catch(() => null)
    : null;

  let downloaded = 0;
  let completed = 0;
  const report = (currentAsset: CompanionAsset | null) => {
    onProgress?.({
      fraction: Math.min(1, downloaded / COMPANION_TOTAL_APPROX_BYTES),
      downloadedBytes: Math.round(downloaded),
      totalBytes: COMPANION_TOTAL_APPROX_BYTES,
      currentAsset,
      completedAssets: completed,
      totalAssets: COMPANION_ASSETS.length,
    });
  };

  report(COMPANION_ASSETS[0] ?? null);
  for (const asset of COMPANION_ASSETS) {
    report(asset);
    await downloadAssetToCache(cache, asset, (delta) => {
      downloaded += delta;
      report(asset);
    });
    completed += 1;
    report(asset);
  }
  downloaded = COMPANION_TOTAL_APPROX_BYTES;
  report(null);

  await saveDashboardStateValue(COMPANION_INSTALLED_KEY, "1").catch(() => undefined);
  emitCompanionStateChanged();
}

/** Remove downloaded assets and clear the installed flag. */
export async function uninstallCompanion(): Promise<void> {
  if (cachesAvailable()) {
    await caches.delete(COMPANION_CACHE_NAME).catch(() => undefined);
  }
  await saveDashboardStateValue(COMPANION_INSTALLED_KEY, "0").catch(() => undefined);
  await saveDashboardStateValue(COMPANION_POPOVER_KEY, "0").catch(() => undefined);
  emitCompanionStateChanged();
}

const objectUrlByAsset = new Map<string, string>();

/**
 * Resolve an asset to a same-origin blob object URL from the cache, falling
 * back to the direct CDN URL when the cache is unavailable. A cache MISS
 * downloads and caches the asset first (on-demand assets like alternate
 * wardrobe outfits aren't in the install manifest), so anything worn or
 * played once keeps working offline. Object URLs are memoized for the
 * window's lifetime — the engine may load the same clip repeatedly.
 */
export async function resolveCompanionAssetUrl(
  asset: CompanionAsset,
): Promise<string> {
  const url = companionAssetUrl(asset);
  const memoized = objectUrlByAsset.get(url);
  if (memoized) return memoized;
  if (!cachesAvailable()) return url;
  try {
    const cache = await caches.open(COMPANION_CACHE_NAME);
    let hit = await cache.match(url);
    if (!hit) {
      await downloadAssetToCache(cache, asset, () => undefined);
      hit = await cache.match(url);
      if (!hit) return url;
    }
    const blob = await hit.blob();
    const objectUrl = URL.createObjectURL(blob);
    objectUrlByAsset.set(url, objectUrl);
    return objectUrl;
  } catch {
    return url;
  }
}
