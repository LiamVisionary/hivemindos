import { Agent, request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

const DEFAULT_CONNECT_TIMEOUT_MS = 1_000;
const DEFAULT_CONNECT_ATTEMPTS = 6;
const CONNECT_TIMEOUT_CODE = "HIVEMINDOS_CONNECT_TIMEOUT";
const providerAgent = new Agent({
  keepAlive: true,
  keepAliveMsecs: 1_000,
  maxSockets: 12,
  maxFreeSockets: 4,
  scheduling: "lifo",
});

async function requestBodyBuffer(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Buffer | null> {
  if (init.body !== undefined && init.body !== null) {
    return Buffer.from(await new Response(init.body).arrayBuffer());
  }
  if (input instanceof Request && input.body) {
    return Buffer.from(await input.clone().arrayBuffer());
  }
  return null;
}

function responseHeaders(
  source: import("node:http").IncomingHttpHeaders,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function connectTimeoutError() {
  return Object.assign(
    new Error("Provider connection did not establish before the retry deadline."),
    { code: CONNECT_TIMEOUT_CODE },
  );
}

function singleHttpsAttempt(
  url: URL,
  method: string,
  headers: Headers,
  body: Buffer | null,
  signal: AbortSignal | null,
  connectTimeoutMs: number,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = httpsRequest(
      url,
      {
        method,
        headers: Object.fromEntries(headers.entries()),
        // Own a small provider-only pool. Successful prewarms and turns reuse
        // their TLS connection; stale sockets fail into the bounded retry loop.
        agent: providerAgent,
      },
      (response) => {
        clearTimeout(connectTimer);
        settled = true;
        resolve(new Response(
          Readable.toWeb(response) as ReadableStream<Uint8Array>,
          {
            status: response.statusCode ?? 502,
            statusText: response.statusMessage,
            headers: responseHeaders(response.headers),
          },
        ));
      },
    );
    const connectTimer = setTimeout(() => {
      request.destroy(connectTimeoutError());
    }, connectTimeoutMs);
    connectTimer.unref?.();
    const connected = () => clearTimeout(connectTimer);
    request.once("socket", (socket) => socket.once("secureConnect", connected));
    const abort = () => {
      clearTimeout(connectTimer);
      const reason = signal?.reason;
      request.destroy(reason instanceof Error ? reason : new Error("The operation was aborted."));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    request.once("close", () => signal?.removeEventListener("abort", abort));
    request.once("error", (error) => {
      clearTimeout(connectTimer);
      if (!settled) reject(error);
    });
    request.end(body ?? undefined);
  });
}

function retryableConnectFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  return code === CONNECT_TIMEOUT_CODE ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN/i.test(code);
}

/** HTTPS fetch for latency-sensitive provider calls. It gives a blackholed
 * connection one second—not Node's ten—then opens a fresh connection while
 * preserving the caller's overall response deadline and streaming body. */
export async function resilientHttpsFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { connectAttempts?: number; connectTimeoutMs?: number } = {},
): Promise<Response> {
  const value = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("resilientHttpsFetch only accepts HTTPS provider URLs.");
  }
  const method = init.method || (input instanceof Request ? input.method : "GET");
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((headerValue, name) => headers.set(name, headerValue));
  const body = await requestBodyBuffer(input, init);
  if (body && !headers.has("content-length")) {
    headers.set("content-length", String(body.byteLength));
  }
  const signal = init.signal ?? (input instanceof Request ? input.signal : null);
  const attempts = Math.max(1, Math.min(8, options.connectAttempts ?? DEFAULT_CONNECT_ATTEMPTS));
  const connectTimeoutMs = Math.max(
    250,
    Math.min(5_000, options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS),
  );
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) throw signal.reason;
    try {
      return await singleHttpsAttempt(
        url,
        method,
        headers,
        body,
        signal,
        connectTimeoutMs,
      );
    } catch (error) {
      lastError = error;
      if (!retryableConnectFailure(error) || attempt === attempts - 1) throw error;
    }
  }
  throw lastError;
}

/** Establishes a reusable TLS connection without invoking a model. Provider
 * origins commonly answer HEAD / with 200/3xx/4xx; any response is warm. */
export async function prewarmResilientHttpsOrigin(origin: string) {
  const url = new URL("/", origin);
  const response = await resilientHttpsFetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(8_000),
  });
  await response.body?.cancel().catch(() => undefined);
  return { ok: true, status: response.status };
}
