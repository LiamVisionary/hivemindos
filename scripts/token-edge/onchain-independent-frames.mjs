export function independentAssetFrames(items, options) {
  const durationMs = options?.durationMs;
  if (!(durationMs > 0)) return [];
  const ordered = items.map((item, index) => ({
    item,
    index,
    timestamp: options.timestamp(item),
    assetKey: options.assetKey(item),
  })).filter((row) => Number.isFinite(row.timestamp) && row.assetKey)
    .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);
  const frames = [];
  let frameStart = null;
  let byAsset = new Map();
  const flush = () => {
    if (byAsset.size) frames.push([...byAsset.values()]);
  };
  for (const row of ordered) {
    if (frameStart == null || row.timestamp >= frameStart + durationMs) {
      flush();
      frameStart = row.timestamp;
      byAsset = new Map();
    }
    if (!byAsset.has(row.assetKey)) byAsset.set(row.assetKey, row.item);
  }
  flush();
  return frames;
}

export function overlappingAssetSignalCount(items, frames) {
  return Math.max(0, items.length - frames.reduce((sum, frame) => sum + frame.length, 0));
}

export function tokenEdgeAssetKey(value) {
  const chain = String(value?.chain ?? "").trim().toLowerCase();
  const rawAddress = String(value?.tokenAddress ?? "").trim();
  const tokenAddress = chain === "solana" ? rawAddress : rawAddress.toLowerCase();
  return chain && tokenAddress ? `${chain}:${tokenAddress}` : "";
}
