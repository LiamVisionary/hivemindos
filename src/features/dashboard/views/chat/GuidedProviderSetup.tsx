"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, KeyRound, LoaderCircle, PlugZap, RefreshCcw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentProfile, AgentRuntime } from "@/lib/types/agent-runtime";

type ProviderSetupOption = {
  slug: string;
  name: string;
  models: Array<{ id: string; name?: string }>;
  totalModels: number;
  authenticated?: boolean;
  authType?: string;
  keyEnv?: string;
  warning?: string;
};

type ProviderSetupResponse = {
  ok?: boolean;
  error?: string;
  providers?: ProviderSetupOption[];
};

type ProviderAddResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  provider?: string;
  model?: string;
};

type GuidedProviderSetupProps = {
  agent?: AgentProfile | null;
  busy?: string;
  fleetClass: (...classes: string[]) => string;
  runtime: AgentRuntime;
  onCancel: () => void;
  onComplete: (provider: string, model: string) => void | Promise<void>;
};

const preferredProviders = ["openrouter", "anthropic", "openai-api", "gemini", "xai", "nous"];

function providerSortValue(provider: ProviderSetupOption) {
  const preferredIndex = preferredProviders.indexOf(provider.slug);
  return [
    provider.authenticated ? 0 : 1,
    preferredIndex === -1 ? preferredProviders.length : preferredIndex,
    provider.name,
  ] as const;
}

export function GuidedProviderSetup({ agent, busy, fleetClass, runtime, onCancel, onComplete }: GuidedProviderSetupProps) {
  const [providers, setProviders] = useState<ProviderSetupOption[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("openrouter");
  const [selectedModel, setSelectedModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const sortedProviders = useMemo(() => [...providers].sort((a, b) => {
    const left = providerSortValue(a);
    const right = providerSortValue(b);
    return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]);
  }), [providers]);
  const activeProvider = sortedProviders.find((provider) => provider.slug === selectedProvider) ?? sortedProviders[0];
  const modelOptions = activeProvider?.models ?? [];
  const credentialReady = Boolean(activeProvider?.authenticated);
  const credentialOptional = activeProvider?.authType === "none";
  const isBusy = loading || submitting || busy === "add-provider" || busy === "provider-setup-options";

  useEffect(() => {
    let cancelled = false;
    async function loadProviders() {
      if (!agent || runtime !== "hermes") return;
      setLoading(true);
      setMessage("");
      try {
        const response = await fetch(`/api/runtimes/${runtime}/integrations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent, action: "provider-setup-options" }),
        });
        const data = await response.json().catch(() => null) as ProviderSetupResponse | null;
        if (cancelled) return;
        if (!response.ok || !data?.ok) {
          setMessage(data?.error ?? "Could not load Hermes providers.");
          return;
        }
        const nextProviders = data.providers ?? [];
        setProviders(nextProviders);
        const initialProvider = nextProviders.find((provider) => provider.slug === "openrouter")
          ?? nextProviders[0];
        if (initialProvider) {
          setSelectedProvider(initialProvider.slug);
          setSelectedModel(initialProvider.models[0]?.id ?? "");
        }
      } catch {
        if (!cancelled) setMessage("Could not load Hermes providers.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadProviders();
    return () => {
      cancelled = true;
    };
  }, [agent, runtime, reloadKey]);

  async function submitProvider() {
    if (!agent || !activeProvider || !selectedModel) return;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/runtimes/${runtime}/integrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent,
          action: "add-provider",
          input: { provider: activeProvider.slug, model: selectedModel },
        }),
      });
      const data = await response.json().catch(() => null) as ProviderAddResponse | null;
      if (!response.ok || !data?.ok) {
        setMessage(data?.error ?? "Provider setup failed.");
        return;
      }
      await onComplete(data.provider ?? activeProvider.slug, data.model ?? selectedModel);
    } catch {
      setMessage("Provider setup failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={fleetClass("guidedProviderSetup")} aria-label="Guided provider setup">
      <div className={fleetClass("guidedProviderHeader")}>
        <span className={fleetClass("guidedProviderIcon")} aria-hidden="true">
          <PlugZap />
        </span>
        <div>
          <strong>Add provider</strong>
          <p>Choose a Hermes provider, confirm the credential source, and add its first model directly.</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Cancel provider setup" onClick={onCancel}>
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className={fleetClass("guidedProviderBody")}>
        <label className={fleetClass("agentSettingsField")}>
          <span>Provider</span>
          <select
            value={activeProvider?.slug ?? ""}
            disabled={isBusy || !sortedProviders.length}
            onChange={(event) => {
              const nextProvider = sortedProviders.find((provider) => provider.slug === event.target.value);
              setSelectedProvider(event.target.value);
              setSelectedModel(nextProvider?.models[0]?.id ?? "");
            }}
          >
            {sortedProviders.map((provider) => (
              <option value={provider.slug} key={provider.slug}>{provider.name}</option>
            ))}
          </select>
        </label>
        <label className={fleetClass("agentSettingsField")}>
          <span>Model</span>
          <select
            value={selectedModel}
            disabled={isBusy || !modelOptions.length}
            onChange={(event) => setSelectedModel(event.target.value)}
          >
            {modelOptions.map((model) => (
              <option value={model.id} key={model.id}>{model.name || model.id}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={fleetClass("guidedProviderStatusGrid")}>
        <div className={credentialReady ? fleetClass("guidedProviderStatus", "ready") : fleetClass("guidedProviderStatus")}>
          {credentialReady ? <ShieldCheck aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
          <div>
            <strong>{credentialOptional ? "No credential needed" : credentialReady ? "Credential ready" : "Credential needed"}</strong>
            <p>{credentialOptional ? "This local provider uses its configured base URL." : credentialReady ? `${activeProvider?.keyEnv || "Provider credentials"} available to Hermes.` : activeProvider?.warning || "Configure credentials, then reload providers."}</p>
          </div>
        </div>
        <div className={fleetClass("guidedProviderStatus", modelOptions.length ? "ready" : "")}>
          <Check aria-hidden="true" />
          <div>
            <strong>{modelOptions.length ? `${activeProvider?.totalModels ?? modelOptions.length} models found` : "No models yet"}</strong>
            <p>{modelOptions.length ? "The selected model will be written into Hermes config." : "Reload after the provider reports models."}</p>
          </div>
        </div>
      </div>

      {message ? <p className={fleetClass("guidedProviderMessage")}>{message}</p> : null}

      <div className={fleetClass("guidedProviderActions")}>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button type="button" variant="secondary" onClick={() => setReloadKey((current) => current + 1)} disabled={submitting || loading}>
          <RefreshCcw aria-hidden="true" />
          Reload providers
        </Button>
        <Button type="button" onClick={() => void submitProvider()} disabled={!credentialReady || !selectedModel || isBusy}>
          {submitting ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <PlugZap aria-hidden="true" />}
          Add provider
        </Button>
      </div>
    </section>
  );
}
