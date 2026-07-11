/* companion-assets.ts — the download manifest for the hologram companion.
 *
 * The 3D companion is an optional module: none of these files ship with the
 * app. "Install" streams them from the shared Ami asset CDN (a public
 * Supabase storage bucket) into the browser Cache API, so the ~40 MB of
 * model + animation data is fetched once and served locally afterwards.
 *
 * The Sara Lite VRM and the conversation-idle/gesture GLB clips are the same
 * assets the standalone Ami companion app uses (ami-ai-companion repo,
 * sara-lite-assets.ts + animationPathMap.ts). The `?v=` pin matches that
 * app's ASSET_VERSION so we hit its long-lived CDN cache entries.
 */

export const COMPANION_ASSET_BASE =
  "https://xozwagmagjivgalpnzzy.supabase.co/storage/v1/object/public/public-assets";

const ASSET_VERSION = "626";

export const COMPANION_CACHE_NAME = "hivemindos-companion-v1";

export type CompanionAsset = {
  /** CDN path under COMPANION_ASSET_BASE. */
  path: string;
  /** Rough size in bytes, used to weight download progress when the CDN
   *  response has no usable Content-Length. */
  approxBytes: number;
  kind: "model" | "animation";
  /** Stable key gestures/idles are referenced by in companion code. */
  key: string;
  /** Human-readable name (wardrobe pickers). */
  label?: string;
};

export const SARA_LITE_MODEL: CompanionAsset = {
  path: "/assets/models/vrm/tomcat/female-body-a/sara-lite/Sara.base.v148.opt.vrm",
  approxBytes: 37_000_000,
  kind: "model",
  key: "sara-lite",
};

/** Sara's wardrobe GLBs (the composer's SARA_OUTFITS mirror these keys). The
 *  base VRM is nude on its own; the engine binds one of these onto her
 *  skeleton after load. Only the default (first entry) ships in the install
 *  manifest — other outfits download-and-cache on first wear. Textures are
 *  embedded in each GLB. */
export const SARA_OUTFIT_ASSETS: CompanionAsset[] = [
  {
    path: "/assets/models/vrm/tomcat/female-body-a/outfits/retargeted/sara-vdress.opaque.glb",
    approxBytes: 354_000,
    kind: "model",
    key: "outfit-v-dress",
    label: "V-Dress",
  },
  {
    path: "/assets/models/vrm/tomcat/female-body-a/outfits/retargeted/tomcat-peakdress.opaque.glb",
    approxBytes: 13_150_000,
    kind: "model",
    key: "outfit-peak-dress",
    label: "Peak Dress",
  },
  {
    path: "/assets/models/vrm/tomcat/female-body-a/sara-lite/sara-detective-vest.glb",
    approxBytes: 6_600_000,
    kind: "model",
    key: "outfit-detective-vest",
    label: "Detective (Vest)",
  },
];

export const SARA_DEFAULT_OUTFIT: CompanionAsset = SARA_OUTFIT_ASSETS[0];

const CONVERSATION_DIR = "/assets/animations/new-animations/conversation";

/** Idle loops — Idle01 is the base breathing loop the engine returns to. */
export const COMPANION_IDLE_ASSETS: CompanionAsset[] = [
  { path: `${CONVERSATION_DIR}/Idle01_breathing.glb`, approxBytes: 900_000, kind: "animation", key: "idle-breathing" },
  { path: `${CONVERSATION_DIR}/Idle02_LookLeftAndRight.glb`, approxBytes: 900_000, kind: "animation", key: "idle-look-around" },
];

/** One-shot gesture clips, triggered from queen replies. */
export const COMPANION_GESTURE_ASSETS: CompanionAsset[] = [
  { path: `${CONVERSATION_DIR}/Idle16_WaveHands.glb`, approxBytes: 900_000, kind: "animation", key: "gesture-wave" },
  { path: `${CONVERSATION_DIR}/Idle28_Laugh.glb`, approxBytes: 900_000, kind: "animation", key: "gesture-laugh" },
  { path: `${CONVERSATION_DIR}/Idle65_ThumbsUp.glb`, approxBytes: 900_000, kind: "animation", key: "gesture-thumbs-up" },
  { path: `${CONVERSATION_DIR}/Idle75_Pointing.glb`, approxBytes: 900_000, kind: "animation", key: "gesture-pointing" },
  { path: `${CONVERSATION_DIR}/Idle36_Yay.glb`, approxBytes: 900_000, kind: "animation", key: "gesture-yay" },
];

export const COMPANION_ASSETS: CompanionAsset[] = [
  SARA_LITE_MODEL,
  SARA_DEFAULT_OUTFIT,
  ...COMPANION_IDLE_ASSETS,
  ...COMPANION_GESTURE_ASSETS,
];

export function companionAssetUrl(asset: CompanionAsset): string {
  // The bucket stores files WITHOUT the leading /assets/ prefix (same
  // convention as ami's assetUrl — see its "Strips the leading /assets/"
  // note). Keeping manifest paths in /assets/ form preserves parity with the
  // source app's asset catalog.
  const stripped = asset.path.replace(/^\/assets\//, "");
  return `${COMPANION_ASSET_BASE}/${stripped}?v=${ASSET_VERSION}`;
}

export function companionAssetByKey(key: string): CompanionAsset | undefined {
  return COMPANION_ASSETS.find((asset) => asset.key === key);
}

export const COMPANION_TOTAL_APPROX_BYTES = COMPANION_ASSETS.reduce(
  (sum, asset) => sum + asset.approxBytes,
  0,
);
