/**
 * Sara skin-variant application — minimal port of ami-ai-companion's
 * freckled-face default (the app-look default skin).
 *
 * Mechanism (traced through ami's VRMLoader skin-variant cache +
 * scene-manager-appearance.applyBodySkinTexture + the /model-viewer
 * `applySaraFreckledFace` port): Sara's base VRM EMBEDS several skin-atlas
 * variants as named glTF images that no texture references — GLTFLoader
 * therefore never decodes them. The freckled look is NOT a separate CDN
 * asset, material set, or morph: it is the embedded webp image
 * `Sara_skin_freckled_nose_blush` (image 22 in Sara.base.v148, bufferView
 * 22) swapped onto the FACE material `Skin.Sarah.003` only. The body atlas
 * (`Skin.Sarah.002` etc.) is untouched, so stockings/body variants remain
 * independent — exactly how ami's wardrobe treats the "Authored Freckles"
 * face style.
 *
 * Because the variant ships inside the VRM binary, applying it needs no
 * network fetch and adds ZERO download bytes — hence no resolveUrl callback
 * and no companion-assets manifest entry.
 *
 * Texture settings mirror ami's configureVariantTexture: copy the current
 * face albedo's colorSpace/flipY/wrap/magFilter/anisotropy, then force
 * `generateMipmaps = false` + `minFilter = LinearFilter` (variant atlases
 * are bit-identical at mip 0 but diverge in auto-generated mips, which
 * would visibly shift skin tone at distance when variants swap).
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { logger } from './logger';

/** Embedded glTF image name of the freckled nose + blush face atlas. */
export const SARA_FRECKLED_FACE_IMAGE = 'Sara_skin_freckled_nose_blush';

/** Sara's face-skin material (ami: FACE_SKIN_MAT_NAMES). The loader's face
 *  contour pass clones this material per mesh slot, so every clone carrying
 *  the name gets the swap. */
const SARA_FACE_SKIN_MAT_NAME = 'Skin.Sarah.003';

/**
 * Apply Sara's default freckled-face skin. Call once after
 * `loadCompanionVRM` resolves, passing the SAME `gltf` it returned (the
 * embedded image bytes are read through `gltf.parser`). Idempotent — the
 * decoded texture is cached on the VRM and re-applying is a cheap no-op.
 *
 * Returns true when the swap was applied (or already active); false when
 * the model has no embedded freckle image or no face material (non-Sara
 * VRMs) — a safe no-op.
 */
export async function applySaraFreckledSkin(vrm: VRM, gltf: GLTF): Promise<boolean> {
  // Find every material named Skin.Sarah.003 (base + loader clones).
  const faceMats: (THREE.Material & { map?: THREE.Texture | null })[] = [];
  vrm.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m && m.name === SARA_FACE_SKIN_MAT_NAME) faceMats.push(m);
    }
  });
  if (faceMats.length === 0) {
    logger.debug('[skin-variant] no face material — not a Sara VRM, skipping freckles');
    return false;
  }

  // Reuse a previously decoded texture (idempotency / re-apply after an
  // outfit change re-clones materials).
  const record = vrm as unknown as Record<string, unknown>;
  let tex = record.__companionFreckledFaceTexture as THREE.Texture | undefined;

  if (!tex) {
    const parser = (gltf as unknown as {
      parser?: {
        json?: {
          images?: Array<{ name?: string; bufferView?: number; mimeType?: string }>;
        };
        getDependency: (type: string, index: number) => Promise<unknown>;
      };
    }).parser;
    const images = parser?.json?.images ?? [];
    const imgIdx = images.findIndex((im) => im?.name === SARA_FRECKLED_FACE_IMAGE);
    if (imgIdx < 0 || !parser) {
      logger.warn('[skin-variant] freckled face image not embedded in this VRM — skipping');
      return false;
    }
    const img = images[imgIdx];
    if (img.bufferView === undefined) {
      logger.warn('[skin-variant] freckled face image has no bufferView — skipping');
      return false;
    }

    const bytes = (await parser.getDependency('bufferView', img.bufferView)) as
      | ArrayBuffer
      | Uint8Array;
    const blob = new Blob([bytes as BlobPart], { type: img.mimeType || 'image/webp' });
    const bitmap = await createImageBitmap(blob);
    tex = new THREE.Texture(bitmap);
    tex.name = SARA_FRECKLED_FACE_IMAGE;

    // Copy the current face albedo's render settings so the variant renders
    // identically (GLTFLoader defaults would put albedo in linear space).
    const template = faceMats[0].map ?? null;
    if (template) {
      tex.colorSpace = template.colorSpace;
      tex.flipY = template.flipY;
      tex.wrapS = template.wrapS;
      tex.wrapT = template.wrapT;
      tex.magFilter = template.magFilter;
      tex.anisotropy = template.anisotropy;
    } else {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
    }
    // Mipmaps OFF on variants (see file header — mip-level tone drift).
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    record.__companionFreckledFaceTexture = tex;
  }

  let updated = 0;
  for (const m of faceMats) {
    if (m.map === tex) continue;
    m.map = tex;
    m.needsUpdate = true;
    updated++;
  }
  logger.info(
    `[skin-variant] freckled face applied: ${updated}/${faceMats.length} material slot(s) updated`,
  );
  return true;
}
