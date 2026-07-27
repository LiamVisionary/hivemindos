export const HIVE_COMPUTE_BENCHMARK_RECOVERY_TIMEOUT_MS = 10 * 60_000;
const HIVE_COMPUTE_BENCHMARK_POLL_INTERVAL_MS = 2_000;

export function isHiveComputeBenchmarkProxyTimeout(value: unknown) {
  if (!value || typeof value !== "object") return false;
  return (value as { code?: unknown }).code === "DEV_PROXY_TIMEOUT";
}

export async function waitForHiveComputeBenchmarkCompletion<T>(options: {
  poll: () => Promise<T>;
  isComplete: (snapshot: T) => boolean;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
  timeoutMs?: number;
}) {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = options.timeoutMs ?? HIVE_COMPUTE_BENCHMARK_RECOVERY_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? HIVE_COMPUTE_BENCHMARK_POLL_INTERVAL_MS;
  const startedAt = now();
  while (true) {
    const snapshot = await options.poll();
    if (options.isComplete(snapshot)) return snapshot;
    if (now() - startedAt >= timeoutMs) {
      throw new Error("The benchmark is still running after 10 minutes. Refresh the host panel to check its saved progress.");
    }
    await wait(intervalMs);
  }
}
