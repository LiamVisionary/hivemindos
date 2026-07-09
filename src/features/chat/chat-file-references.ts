import type { KanbanTaskAttachment } from "@/lib/types/kanban";

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

const IMAGE_REFERENCE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg", "heic", "heif", "ico", "tiff", "tif",
]);

function attachmentExtension(nameOrPath?: string) {
  const base = String(nameOrPath ?? "").split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** True when an attachment is (or references) an image, by kind, mime, or extension. */
export function isImageAttachment(attachment: KanbanTaskAttachment) {
  if (attachment.referenceKind === "directory") return false;
  if (attachment.kind === "image") return true;
  if (attachment.mimeType?.startsWith("image/")) return true;
  return IMAGE_REFERENCE_EXTENSIONS.has(attachmentExtension(attachment.referencePath || attachment.name));
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

async function generateImagePreviewDataUrl(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  if (!dataUrl) return "";
  // SVGs are already tiny and vector — use them as-is rather than rasterizing.
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return dataUrl;
  if (typeof document === "undefined" || typeof Image === "undefined") return dataUrl;
  try {
    const image = await loadImageElement(dataUrl);
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
    const keepsAlpha = /^image\/(png|webp|gif|avif)$/.test(file.type);
    const encoded = keepsAlpha
      ? canvas.toDataURL("image/webp", 0.82)
      : canvas.toDataURL("image/jpeg", PREVIEW_JPEG_QUALITY);
    return encoded && encoded.startsWith("data:image/") ? encoded : dataUrl;
  } catch {
    return dataUrl;
  }
}

/**
 * Progressively attach a display-only `previewUrl` to any image reference that
 * still carries bytes (browser file drops / picker). Path-only references (e.g.
 * Tauri native drops with `size` 0) have no bytes to read and are left as pills.
 * `attachments[i]` must correspond to `files[i]` (as produced by
 * `createFileReferenceAttachments`).
 */
export async function hydrateImageReferencePreviews(
  files: FileList | File[],
  attachments: KanbanTaskAttachment[],
  onPreview: (id: string, previewUrl: string) => void,
) {
  const list = Array.from(files);
  await Promise.all(attachments.map(async (attachment, index) => {
    const file = list[index];
    if (!file || attachment.previewUrl || attachment.dataUrl) return;
    if (!isImageAttachment(attachment)) return;
    if (!(Number(file.size) > 0)) return; // path-only reference — no bytes to preview
    try {
      const previewUrl = await generateImagePreviewDataUrl(file);
      if (previewUrl) onPreview(attachment.id, previewUrl);
    } catch {
      // Leave the attachment as a reference pill if the preview can't be built.
    }
  }));
}
