"use client";

import { useCallback, useState } from "react";

import { generateImagePreviewFromDataUrl } from "@/features/chat/chat-file-references";
import { useComposerFileDrop } from "@/features/chat/use-composer-file-drop";
import { readLocalImagePreview } from "@/lib/native/local-image";

/**
 * Listing-photo attach state: drag/drop (HTML5 + Tauri native, via the shared
 * composer drop hook — Tauri swallows HTML5 drops) plus click-to-attach.
 * Unlike chat attachments, listing photos keep the FULL bytes (the server
 * persists them as binary files in the vault), with a downscaled preview for
 * display. Tauri native drops deliver a PATH instead of bytes; those are read
 * to a full-resolution data URL through the same native command the chat
 * composer uses (read_local_image_preview returns the un-downscaled source).
 */

export type ListingImage = {
  id: string;
  name: string;
  /** Full-resolution data URL — sent to the server once on save. */
  dataUrl: string;
  /** Downscaled display preview. */
  previewUrl: string;
};

export const MAX_LISTING_IMAGES = 10;

// Mirrors the server's photo mime allowlist (PHOTO_EXTENSION_BY_MIME in
// marketplace-listings-store.ts) so a drop never accepts what save rejects.
const IMAGE_NAME_PATTERN = /\.(jpe?g|png|webp|gif|avif)$/i;

/** Tauri native drops synthesize empty Files carrying the source path. */
type DroppedFileReference = File & { path?: string };

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function useListingImages(initial?: ListingImage[]) {
  const [images, setImages] = useState<ListingImage[]>(initial ?? []);
  const [imageError, setImageError] = useState<string | null>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    void (async () => {
      setImageError(null);
      const list = Array.from(files);
      const added: ListingImage[] = [];
      let unsupported = 0;
      let unreadable = 0;
      for (const file of list) {
        const looksImage = file.type.startsWith("image/") || IMAGE_NAME_PATTERN.test(file.name);
        if (!looksImage) {
          unsupported += 1;
          continue;
        }
        try {
          let dataUrl = "";
          if (file.size > 0) {
            dataUrl = await readFileAsDataUrl(file);
          } else {
            // Path-only reference (desktop native drop): read the full bytes
            // from disk via the native command. Outside the desktop runtime
            // this returns null and the file counts as unreadable.
            const referencePath = (file as DroppedFileReference).path;
            if (referencePath) dataUrl = (await readLocalImagePreview(referencePath)) ?? "";
          }
          if (!dataUrl.startsWith("data:image/")) {
            unreadable += 1;
            continue;
          }
          const previewUrl = (await generateImagePreviewFromDataUrl(dataUrl, file.name)) || dataUrl;
          added.push({ id: `img-${crypto.randomUUID()}`, name: file.name, dataUrl, previewUrl });
        } catch {
          unreadable += 1;
        }
      }
      if (added.length) {
        setImages((current) => {
          const next = [...current, ...added];
          if (next.length > MAX_LISTING_IMAGES) {
            setImageError(`A listing holds up to ${MAX_LISTING_IMAGES} photos — extras were left off.`);
          }
          return next.slice(0, MAX_LISTING_IMAGES);
        });
      }
      if (unreadable > 0) {
        setImageError(
          unreadable === list.length
            ? "Couldn't read the dropped files — try the Add photos button."
            : `Couldn't read ${unreadable} of the dropped files.`,
        );
      } else if (unsupported > 0 && !added.length) {
        setImageError("Only photo files can be attached (jpg, png, webp, gif, avif).");
      }
    })();
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((current) => current.filter((image) => image.id !== id));
  }, []);

  const reset = useCallback((next?: ListingImage[]) => {
    setImages(next ?? []);
    setImageError(null);
  }, []);

  const { dropRef, dropActive, dropHandlers } = useComposerFileDrop({ enabled: true, onDropFileReferences: addFiles });

  return { images, imageError, addFiles, removeImage, reset, dropRef, dropActive, dropHandlers };
}
