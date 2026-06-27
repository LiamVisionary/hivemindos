import { requireAuth } from "@/lib/utils/server-auth";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { providerCatalogEntry } from "@/lib/config/provider-catalog";
import { buildUsePodProxyBaseUrl } from "@/lib/services/usepod";

export const runtime = "nodejs";

// Some providers' `/models` returns more than chat models (Venice also lists
// image/audio/embedding models); keep only chat-capable entries when typed.
const CHAT_MODEL_TYPES = new Set(["text", "llm", "chat", "language"]);

/**
 * Live model list for a configured catalog provider. Resolves the provider's
 * base URL (from the provider catalog) and its API key (from the shared hive
 * env, never returned to the client) and calls `/models`, so configured
 * providers (OpenAI, Anthropic, Groq, Gemini, Venice) show their real, current
 * models instead of the Hermes-configured subset. Fetched lazily so it never
 * blocks the settings status sweep. (UsePod is intentionally excluded: its
 * token is per-agent and its own guided setup owns model discovery.)
 */
export async function GET(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const slug = new URL(request.url).searchParams.get("provider")?.trim() ?? "";
  const entry = providerCatalogEntry(slug);
  if (!entry?.keyEnv) {
    return Response.json({ ok: false, error: "Provider does not support live model discovery." }, { status: 400 });
  }
  const key = await hiveEnvValue(entry.keyEnv).catch(() => "");
  if (!key) {
    return Response.json({ ok: false, error: `${entry.keyEnv} is not configured.` }, { status: 400 });
  }

  // UsePod has no static base URL: its OpenAI-compatible endpoint is a tokenized
  // proxy derived from the (shared) token, which is carried in the path, so no
  // Authorization header is sent. Other providers use their catalog base URL.
  let url: string;
  let headers: Record<string, string> = { Accept: "application/json" };
  if (slug === "usepod") {
    url = `${buildUsePodProxyBaseUrl(key, "openai").replace(/\/+$/, "")}/models`;
  } else if (entry.baseUrl) {
    url = `${entry.baseUrl.replace(/\/+$/, "")}/models`;
    headers = {
      ...headers,
      ...(entry.modelsHeaders ?? {}),
      ...(entry.modelsAuth === "x-api-key" ? { "x-api-key": key } : { Authorization: `Bearer ${key}` }),
    };
  } else {
    return Response.json({ ok: false, error: "Provider does not support live model discovery." }, { status: 400 });
  }

  try {
    const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let message = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } | string };
        message = (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) || message;
      } catch {
        /* not json */
      }
      return Response.json({ ok: false, error: message || `HTTP ${response.status}` }, { status: 502 });
    }
    const data = (await response.json().catch(() => null)) as { data?: unknown; models?: unknown } | null;
    const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    const models = rows
      .map((row) => {
        if (typeof row === "string") return { id: row, type: "" };
        const record = row as { id?: string; name?: string; type?: string };
        return { id: String(record?.id ?? record?.name ?? ""), type: typeof record?.type === "string" ? record.type : "" };
      })
      .filter((model) => model.id && (!model.type || CHAT_MODEL_TYPES.has(model.type)))
      .map((model) => ({ id: model.id }));
    return Response.json({ ok: true, provider: slug, models });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Model fetch failed." }, { status: 502 });
  }
}
