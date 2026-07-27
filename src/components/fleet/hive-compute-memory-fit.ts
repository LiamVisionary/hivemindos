/** Memory-fit heuristic for advertised Hive Compute models: with N concurrent
 * job slots, the N largest advertised models could be resident at once, so
 * their combined weights should fit inside a conservative share of physical
 * memory (weights are a floor — KV cache and runtime overhead come on top). */

const MEMORY_BUDGET_RATIO = 0.75;

export type HiveComputeMemoryFit = {
  fits: boolean;
  /** Combined size of the largest `concurrency` sized models. */
  totalBytes: number;
  budgetBytes: number;
  machineMemoryBytes: number;
  /** The models counted toward the total (largest first). */
  models: Array<{ label: string; sizeBytes: number }>;
  /** Advertised models the backend reported no size for (not counted). */
  unsizedCount: number;
};

export function hiveComputeMemoryFit(
  models: Array<{ id: string; name?: string; sizeBytes?: number }>,
  concurrency: number,
  machineMemoryBytes?: number,
): HiveComputeMemoryFit | null {
  if (!machineMemoryBytes || machineMemoryBytes <= 0 || !models.length) return null;
  const sized = models
    .filter((model) => (model.sizeBytes ?? 0) > 0)
    .sort((left, right) => (right.sizeBytes ?? 0) - (left.sizeBytes ?? 0));
  if (!sized.length) return null;
  const counted = sized.slice(0, Math.max(1, Math.floor(concurrency)));
  const totalBytes = counted.reduce((sum, model) => sum + (model.sizeBytes ?? 0), 0);
  const budgetBytes = machineMemoryBytes * MEMORY_BUDGET_RATIO;
  return {
    fits: totalBytes <= budgetBytes,
    totalBytes,
    budgetBytes,
    machineMemoryBytes,
    models: counted.map((model) => ({ label: model.name || model.id, sizeBytes: model.sizeBytes ?? 0 })),
    unsizedCount: models.length - sized.length,
  };
}

export function formatGigabytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
}
