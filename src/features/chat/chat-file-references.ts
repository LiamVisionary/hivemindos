import type { KanbanTaskAttachment } from "@/lib/types/kanban";
import { isChatImagePath } from "@/lib/services/chat/chat-image-formats";

type FileWithReferencePath = File & {
  path?: string;
  referenceKind?: "file" | "directory";
  webkitRelativePath?: string;
};

function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) || "";
}

function createFileReferenceAttachment(file: File): KanbanTaskAttachment {
  const source = file as FileWithReferencePath;
  const referencePath = String(source.path || source.webkitRelativePath || "").trim();
  const referenceKind = source.referenceKind === "directory" ? "directory" : "file";
  return {
    id: `file-ref-${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    kind: "file",
    name: file.name || basename(referencePath) || "Dropped file",
    mimeType: referenceKind === "directory" ? "inode/directory" : file.type || "application/octet-stream",
    size: Number(file.size) || 0,
    dataUrl: "",
    referencePath: referencePath || undefined,
    referenceKind,
    referenceOnly: true,
    lastModified: Number(file.lastModified) || undefined,
  };
}

export function createFileReferenceAttachments(files: FileList | File[]) {
  return Array.from(files).map(createFileReferenceAttachment);
}

/** True when an attachment is (or references) an image, by kind, mime, or extension. */
export function isImageAttachment(attachment: KanbanTaskAttachment) {
  if (attachment.referenceKind === "directory") return false;
  if (attachment.kind === "image") return true;
  if (attachment.mimeType?.startsWith("image/")) return true;
  return isChatImagePath(attachment.referencePath || attachment.name);
}

/** Best display source for an image attachment's thumbnail/lightbox, or "" if none. */
export function imageAttachmentPreviewSrc(attachment: KanbanTaskAttachment) {
  if (!isImageAttachment(attachment)) return "";
  if (attachment.previewUrl) return attachment.previewUrl;
  // Picker images (kind "image") and file-picker images carry the bytes inline.
  if (attachment.dataUrl) return attachment.dataUrl;
  return "";
}

const PREVIEW_MAX_EDGE = 1024;
const PREVIEW_JPEG_QUALITY = 0.72;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode image preview."));
    image.src = src;
  });
}

// Downscale a full-resolution image data URL to a small display-only preview.
// Returns "" when the format can't be decoded here (e.g. HEIC in Chromium) so
// the caller falls back to the pill rather than showing a broken image.
async function downscaleImageDataUrl(dataUrl: string, keepsAlpha: boolean) {
  if (typeof document === "undefined" || typeof Image === "undefined") return dataUrl;
  let image: HTMLImageElement;
  try {
    image = await loadImageElement(dataUrl);
  } catch {
    return "";
  }
  try {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) return dataUrl;
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Keep transparency for formats that use it; JPEG-encode photos to stay small.
    const encoded = keepsAlpha
      ? canvas.toDataURL("image/webp", 0.82)
      : canvas.toDataURL("image/jpeg", PREVIEW_JPEG_QUALITY);
    return encoded && encoded.startsWith("data:image/") ? encoded : dataUrl;
  } catch {
    return dataUrl;
  }
}

async function generateImagePreviewDataUrl(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  if (!dataUrl) return "";
  // SVGs are already tiny and vector — use them as-is rather than rasterizing.
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return dataUrl;
  return downscaleImageDataUrl(dataUrl, /^image\/(png|webp|gif|avif)$/.test(file.type));
}

// Build a preview from a full-resolution data URL (e.g. a desktop native
// local-file read of a path-only drop), classifying transparency by source.
// Exported for surfaces that keep the full bytes AND need a display preview
// (the Marketplace listing modal).
export async function generateImagePreviewFromDataUrl(dataUrl: string, nameOrPath: string) {
  if (!dataUrl) return "";
  if (/^data:image\/svg\+xml/i.test(dataUrl) || /\.svg$/i.test(nameOrPath)) return dataUrl;
  const keepsAlpha = /^data:image\/(png|webp|gif|avif)/i.test(dataUrl) || /\.(png|webp|gif|avif)$/i.test(nameOrPath);
  return downscaleImageDataUrl(dataUrl, keepsAlpha);
}

/**
 * Progressively attach a display-only `previewUrl` to image references. When the
 * dropped file carries bytes (browser drops / pickers) the preview is built from
 * those bytes; when it's a path-only reference (Tauri native drops give a path
 * and no bytes) the optional `readPathPreview` reads the file to a data URL that
 * is then downscaled. `attachments[i]` must correspond to `files[i]`.
 */
export async function hydrateImageReferencePreviews(
  files: FileList | File[],
  attachments: KanbanTaskAttachment[],
  onPreview: (id: string, previewUrl: string) => void,
  readPathPreview?: (path: string) => Promise<string | null>,
) {
  const list = Array.from(files);
  await Promise.all(attachments.map(async (attachment, index) => {
    if (attachment.previewUrl || attachment.dataUrl || !isImageAttachment(attachment)) return;
    const file = list[index];
    try {
      let previewUrl = "";
      if (file && Number(file.size) > 0) {
        previewUrl = await generateImagePreviewDataUrl(file);
      } else if (attachment.referencePath && readPathPreview) {
        const raw = await readPathPreview(attachment.referencePath);
        if (raw) previewUrl = await generateImagePreviewFromDataUrl(raw, attachment.referencePath);
      }
      if (previewUrl) onPreview(attachment.id, previewUrl);
    } catch {
      // Leave the attachment as a reference pill if the preview can't be built.
    }
  }));
}
