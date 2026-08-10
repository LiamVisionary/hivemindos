type BrowserPreviewRecord = {
  path: string;
  source?: string;
  url: string;
};

function previewPath(value: unknown) {
  const path = typeof value === "string" ? value.trim() : "";
  const match = path.match(/^\/app-proxy\/(\d{1,5})\/?$/);
  const port = Number(match?.[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "";
  return `/app-proxy/${port}`;
}

function withoutBrowserPreview(event: Record<string, unknown>) {
  const rest = { ...event };
  delete rest.browserPreview;
  return rest;
}

export function withRuntimeBrowserPreviewUrl(value: unknown, runtimeUrl: string) {
  if (!value || typeof value !== "object") return value;
  const event = value as Record<string, unknown>;
  const rawPreview = event.browserPreview;
  if (!rawPreview || typeof rawPreview !== "object") return value;
  const source = rawPreview as Record<string, unknown>;
  const path = previewPath(source.path);
  if (!path) return withoutBrowserPreview(event);
  try {
    const runtime = new URL(runtimeUrl);
    if (runtime.protocol !== "http:" && runtime.protocol !== "https:") {
      return withoutBrowserPreview(event);
    }
    const browserPreview: BrowserPreviewRecord = {
      path,
      source: typeof source.source === "string" ? source.source.slice(0, 64) : undefined,
      url: new URL(path, runtime.origin).toString(),
    };
    return { ...event, browserPreview };
  } catch {
    return withoutBrowserPreview(event);
  }
}
