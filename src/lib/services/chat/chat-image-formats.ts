const CHAT_IMAGE_MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".dib": "image/bmp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".ico": "image/vnd.microsoft.icon",
  ".jpe": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pjp": "image/jpeg",
  ".pjpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
};

const PREFERRED_CHAT_IMAGE_EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  "image/apng": ".apng",
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff",
  "image/vnd.microsoft.icon": ".ico",
  "image/webp": ".webp",
  "image/x-icon": ".ico",
};

function extensionFromPath(path: string) {
  const basename = path.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  const dot = basename.lastIndexOf(".");
  return dot >= 0 ? basename.slice(dot).toLowerCase() : "";
}

export function chatImageMimeTypeForPath(path: string) {
  return CHAT_IMAGE_MIME_TYPE_BY_EXTENSION[extensionFromPath(path)] ?? "";
}

export function isChatImagePath(path: string) {
  return Boolean(chatImageMimeTypeForPath(path));
}

export function preferredChatImageExtensionForMimeType(mimeType: string) {
  return PREFERRED_CHAT_IMAGE_EXTENSION_BY_MIME_TYPE[mimeType.trim().toLowerCase()] ?? "";
}

function ascii(data: ArrayLike<number>, start: number, length: number) {
  let value = "";
  for (let index = start; index < Math.min(data.length, start + length); index += 1) {
    value += String.fromCharCode(data[index] ?? 0);
  }
  return value;
}

function isoBaseMediaBrands(data: ArrayLike<number>) {
  if (data.length < 12 || ascii(data, 4, 4) !== "ftyp") return [];
  const brands: string[] = [];
  for (let offset = 8; offset + 4 <= Math.min(data.length, 80); offset += 4) {
    brands.push(ascii(data, offset, 4));
  }
  return brands;
}

function hasSvgRoot(data: ArrayLike<number>) {
  const prefix = new Uint8Array(Math.min(data.length, 4096));
  for (let index = 0; index < prefix.length; index += 1) prefix[index] = data[index] ?? 0;
  const text = new TextDecoder().decode(prefix);
  return /^\uFEFF?\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(text);
}

export function hasChatImageSignature(data: ArrayLike<number>, mimeType: string) {
  const type = mimeType.trim().toLowerCase();
  if (type === "image/png" || type === "image/apng") {
    return data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  }
  if (type === "image/jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (type === "image/gif") return ascii(data, 0, 3) === "GIF";
  if (type === "image/webp") return ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 4) === "WEBP";
  if (type === "image/bmp") return ascii(data, 0, 2) === "BM";
  if (type === "image/tiff") {
    return (data[0] === 0x49 && data[1] === 0x49 && data[2] === 0x2a && data[3] === 0)
      || (data[0] === 0x4d && data[1] === 0x4d && data[2] === 0 && data[3] === 0x2a);
  }
  if (type === "image/vnd.microsoft.icon" || type === "image/x-icon") {
    return data[0] === 0 && data[1] === 0 && data[2] === 1 && data[3] === 0;
  }
  if (type === "image/svg+xml") return hasSvgRoot(data);
  const brands = isoBaseMediaBrands(data);
  if (type === "image/avif") return brands.some((brand) => brand === "avif" || brand === "avis");
  if (type === "image/heic") return brands.some((brand) => /^(?:heic|heix|hevc|hevx|heim|heis)$/.test(brand));
  if (type === "image/heif") return brands.some((brand) => /^(?:mif1|msf1|heic|heix|hevc|hevx|heim|heis)$/.test(brand));
  return false;
}
