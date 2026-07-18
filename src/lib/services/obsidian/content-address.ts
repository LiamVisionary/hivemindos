import { createHash } from "crypto";

export const CONTENT_ADDRESS_SCHEMA = "hivemindos.content-address.v1" as const;

/**
 * Stable text normalization for exact-content identity. It intentionally does
 * not lowercase: case can carry meaning in code, identifiers, and names.
 */
export function normalizeContentAddressText(value: string) {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

export function contentAddressForText(value: string) {
  return `sha256:${createHash("sha256").update(normalizeContentAddressText(value), "utf8").digest("hex")}`;
}

export function contentAddressForParts(parts: readonly string[]) {
  return contentAddressForText(parts.map(normalizeContentAddressText).join("\n\u001e\n"));
}

export function contentAddressMatches(value: string, expected?: string) {
  return Boolean(expected && contentAddressForText(value) === expected);
}
