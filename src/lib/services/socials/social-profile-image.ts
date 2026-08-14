/** Accept only public HTTPS image URLs before they cross the server/UI boundary. */
export function normalizeSocialProfileImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  if (!candidate || candidate.length > 2_048) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Replace X's tiny 48px profile variant with its confirmed 400px variant. */
export function normalizeXProfileImageUrl(value: unknown): string | undefined {
  const normalized = normalizeSocialProfileImageUrl(value);
  if (!normalized) return undefined;
  const url = new URL(normalized);
  if (url.hostname.toLowerCase() !== "pbs.twimg.com") return normalized;
  url.pathname = url.pathname.replace(/_(?:normal|bigger|mini)(\.[a-z0-9]+)$/i, "_400x400$1");
  if (/^(?:normal|bigger|mini|small)$/i.test(url.searchParams.get("name") ?? "")) {
    url.searchParams.set("name", "400x400");
  }
  return url.toString();
}
