// Activity-aware supervision shared by streaming runtime transports. A stream
// can run for hours as long as it keeps producing bytes; only silence expires.

export const RUNTIME_STREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const RUNTIME_STREAM_KEEPALIVE_MS = 15 * 1000;
export const RUNTIME_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export function createRuntimeStreamActivityTimeout(timeoutMs = RUNTIME_STREAM_IDLE_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const touch = () => {
    if (controller.signal.aborted) return;
    stop();
    timer = setTimeout(() => controller.abort(new DOMException(
      `The runtime stream stopped sending data for ${Math.round(timeoutMs / 1000)} seconds.`,
      "TimeoutError",
    )), timeoutMs);
  };
  touch();
  return { signal: controller.signal, stop, touch };
}

export function createRuntimeStreamingFetch(fetchImpl: typeof fetch = fetch) {
  let activity: ReturnType<typeof createRuntimeStreamActivityTimeout> | undefined;
  const streamingFetch = async (url: string, init: RequestInit) => {
    activity?.stop();
    const next = createRuntimeStreamActivityTimeout();
    activity = next;
    try {
      const response = await fetchImpl(url, { ...init, signal: next.signal });
      next.touch();
      return response;
    } catch (error) {
      next.stop();
      if (activity === next) activity = undefined;
      throw error;
    }
  };
  return Object.assign(streamingFetch, {
    stop: () => activity?.stop(),
    touch: () => activity?.touch(),
  });
}

export function startRuntimeStreamKeepalive(
  enqueue: (payload: string) => void,
  intervalMs = RUNTIME_STREAM_KEEPALIVE_MS,
) {
  const timer = setInterval(() => {
    try {
      enqueue(": HivemindOS runtime stream still working\n\n");
    } catch {
      clearInterval(timer);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
