export const HONEY_BEE_LOTTIE_SRC = "/animations/Honey%20bee.lottie";

type LottieAssetCacheEntry = {
  data?: ArrayBuffer;
  promise?: Promise<ArrayBuffer>;
};

const lottieAssetCache = new Map<string, LottieAssetCacheEntry>();

export function normalizeLottieSource(src: string) {
  if (/^(?:https?:|data:|blob:)/i.test(src)) {
    return src;
  }

  return src
    .split("/")
    .map((part, index) => {
      if (index === 0 || part.length === 0) {
        return part;
      }

      try {
        return encodeURIComponent(decodeURIComponent(part));
      } catch {
        return encodeURIComponent(part);
      }
    })
    .join("/");
}

function cacheableLottieSource(src: string) {
  return typeof window !== "undefined" && !/^(?:data:|blob:)/i.test(src);
}

export function getCachedLottieAssetData(src: string) {
  const normalizedSrc = normalizeLottieSource(src);
  return lottieAssetCache.get(normalizedSrc)?.data ?? null;
}

export async function warmLottieAsset(src: string) {
  const normalizedSrc = normalizeLottieSource(src);
  if (!cacheableLottieSource(normalizedSrc)) return null;

  const existing = lottieAssetCache.get(normalizedSrc);
  if (existing?.data) return existing.data;
  if (existing?.promise) return existing.promise;

  const promise = fetch(normalizedSrc, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to preload Lottie asset ${normalizedSrc}: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((data) => {
      lottieAssetCache.set(normalizedSrc, { data });
      return data;
    })
    .catch((error) => {
      lottieAssetCache.delete(normalizedSrc);
      throw error;
    });

  lottieAssetCache.set(normalizedSrc, { promise });
  return promise;
}
