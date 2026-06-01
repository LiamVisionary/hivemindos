function parseHealthPayload<TPayload>(bodyText: string) {
  try {
    const parsed = JSON.parse(bodyText) as TPayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function fetchServiceProbe<TPayload>(url: string, timeoutMs: number) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const bodyText = await response.text();
    return { payload: parseHealthPayload<TPayload>(bodyText), bodyText };
  } catch {
    return null;
  }
}
