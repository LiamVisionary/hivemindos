"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Network } from "lucide-react";

import { createStyleClass } from "@/features/dashboard/style-classes";
import brainServiceStyles from "./brain-services.module.css";
import cardStyles from "./embeddings-provider-card.module.css";

const brainClass = createStyleClass(brainServiceStyles);
const spinClass = cardStyles.embeddingsSpin;

// Local mirrors of the /api/providers/embedding-models payload. Do NOT import
// them from the discovery service: it transitively imports server-only modules
// (shared hive env) and would break the client bundle.
type EmbeddingsModelOption = { id: string; label?: string; supportsDimensions?: boolean };
type EmbeddingsProviderOption = {
  id: string;
  kind: "hosted" | "local";
  label: string;
  baseUrl: string;
  keyEnv?: string;
  configured: boolean;
  models: EmbeddingsModelOption[];
  note?: string;
};
type EmbeddingsDiscovery = {
  options: EmbeddingsProviderOption[];
  current: {
    enabled: boolean;
    url?: string;
    model: string;
    dimensions?: number;
    keyEnv?: string;
    source: string;
    matchedOptionId?: string;
  };
};

/**
 * Self-contained brain-service card that turns shared-brain semantic recall on
 * and off: pick an embedding provider (hosted key-based or a live local
 * OpenAI-compatible server) and a model, the same interaction as the chat
 * model picker. Applying writes HIVEMINDOS_EMBEDDINGS_* to the shared hive env
 * and kicks off a vector backfill for existing memories.
 */
export function EmbeddingsProviderCard() {
  const [discovery, setDiscovery] = useState<EmbeddingsDiscovery | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"refresh" | "disable" | `apply:${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backfillStarted, setBackfillStarted] = useState(false);

  const acceptDiscovery = useCallback((json: EmbeddingsDiscovery) => {
    setDiscovery(json);
    setSelectedOptionId((previous) =>
      previous && json.options.some((option) => option.id === previous)
        ? previous
        : json.current.matchedOptionId ?? json.options.find((option) => option.configured)?.id ?? null);
  }, []);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    try {
      const res = await fetch("/api/providers/embedding-models", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (json.ok) {
        acceptDiscovery(json as EmbeddingsDiscovery);
        setError(null);
      } else {
        setError(json.error || "Embedding providers unavailable.");
      }
    } catch {
      setError("Could not reach the embedding-provider API.");
    } finally {
      setBusy(null);
    }
  }, [acceptDiscovery]);

  const post = useCallback(async (body: Record<string, unknown>, busyKey: "disable" | `apply:${string}`) => {
    setBusy(busyKey);
    try {
      const res = await fetch("/api/providers/embedding-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (json.ok) {
        acceptDiscovery(json as EmbeddingsDiscovery);
        setBackfillStarted(Boolean(json.backfillStarted));
        setError(null);
      } else {
        setError(json.error || "Embedding provider update failed.");
      }
    } catch {
      setError("Could not reach the embedding-provider API.");
    } finally {
      setBusy(null);
    }
  }, [acceptDiscovery]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initial);
  }, [refresh]);

  const current = discovery?.current;
  const selectedOption = discovery?.options.find((option) => option.id === selectedOptionId) ?? null;
  const enabled = Boolean(current?.enabled);
  const currentLabel = current?.matchedOptionId
    ? discovery?.options.find((option) => option.id === current.matchedOptionId)?.label
    : current?.enabled
      ? "Custom endpoint (env)"
      : undefined;

  return (
    <article className={brainClass("brainServiceOverviewCard", enabled ? "live" : "idle")}>
      <div className={brainClass("brainServiceOverviewTopline")}>
        <span className={brainClass("brainServiceOverviewIcon")}><Network aria-hidden="true" /></span>
        <small className={brainClass(enabled ? "serviceBadgeLive" : "serviceBadgeIdle")}>
          {discovery ? (enabled ? "on" : "off") : "checking"}
        </small>
      </div>
      <div>
        <small>Semantic recall</small>
        <h4>Memory embeddings</h4>
        <p>Paraphrase search over the shared brain. Pick a provider and embedding model; vectors build automatically and recall blends them with lexical search.</p>
      </div>

      {error ? <p style={{ fontSize: 12, color: "var(--rose-2,#fb7185)" }}>{error}</p> : null}

      <p className={brainClass("skillSecurityStatus")} role="status">
        {!discovery ? (
          <><LoaderCircle aria-hidden="true" className={spinClass} size={12} /> Discovering embedding providers</>
        ) : enabled ? (
          <>
            On — {currentLabel ?? current?.url} · {current?.model}
            {current?.dimensions ? ` · ${current.dimensions} dims` : ""}
            {current?.source === "shared-hive-env" ? " · shared across the fleet" : " · process env override"}
            {backfillStarted ? " · backfilling vectors" : ""}
          </>
        ) : (
          <>Off — recall is lexical-only until a provider is selected.</>
        )}
      </p>

      {discovery ? (
        <>
          <div className={brainClass("skillSecurityPills")} role="radiogroup" aria-label="Embedding provider">
            {discovery.options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selectedOptionId === option.id}
                className={brainClass("skillSecurityPill", selectedOptionId === option.id && "selected")}
                disabled={busy !== null || !option.configured}
                title={option.note}
                onClick={() => setSelectedOptionId(option.id)}
              >
                {option.label}
                {option.kind === "local" ? " (local)" : ""}
                {!option.configured && option.note ? ` — ${option.note}` : ""}
              </button>
            ))}
            {!discovery.options.length ? (
              <span className={brainClass("skillSecurityStatus")}>
                No embedding providers found. Add an OpenAI key or start LM Studio/Ollama with an embedding model.
              </span>
            ) : null}
          </div>

          {selectedOption?.configured ? (
            <div className={brainClass("skillSecurityPills")} role="radiogroup" aria-label={`${selectedOption.label} embedding models`}>
              {selectedOption.models.map((model) => {
                const isCurrent = enabled
                  && current?.matchedOptionId === selectedOption.id
                  && current?.model === model.id;
                const applying = busy === `apply:${model.id}`;
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="radio"
                    aria-checked={isCurrent}
                    className={brainClass("skillSecurityPill", isCurrent && "selected")}
                    disabled={busy !== null || isCurrent}
                    onClick={() => void post({ action: "apply", optionId: selectedOption.id, model: model.id }, `apply:${model.id}`)}
                  >
                    {applying ? <LoaderCircle aria-hidden="true" className={spinClass} size={12} /> : null}
                    {applying ? " Applying " : ""}
                    {model.label ?? model.id}
                    {isCurrent ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className={brainClass("skillSecurityPills")}>
            <button type="button" className={brainClass("skillSecurityPill")} disabled={busy !== null} onClick={() => void refresh()}>
              {busy === "refresh" ? <><LoaderCircle aria-hidden="true" className={spinClass} size={12} /> Refreshing</> : "Refresh"}
            </button>
            {enabled ? (
              <button type="button" className={brainClass("skillSecurityPill")} disabled={busy !== null} onClick={() => void post({ action: "disable" }, "disable")}>
                {busy === "disable" ? <><LoaderCircle aria-hidden="true" className={spinClass} size={12} /> Disabling</> : "Turn off semantic recall"}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </article>
  );
}
