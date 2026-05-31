"use client";

import { useState } from "react";
import { Check, Coins, LoaderCircle, PlugZap, RefreshCcw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentProfile } from "@/lib/types/agent-runtime";

type GuidedUsePodSetupProps = {
  agent?: AgentProfile | null;
  busy?: string;
  fleetClass: (...classes: string[]) => string;
  onCancel: () => void;
  onComplete: (patch: Partial<AgentProfile>) => void | Promise<void>;
};

type RegisterResponse = {
  ok?: boolean;
  error?: string;
  tokenEnvName?: string;
  depositEnvName?: string;
  depositAddress?: string;
  tokenPreview?: string;
  savedToEnv?: boolean;
};

const USEPOD_STARTER_MODELS = [
  { id: "gpt-5.5", name: "Frontier fallback" },
  { id: "llama-4", name: "Llama 4" },
  { id: "qwen-3.5", name: "Qwen 3.5" },
  { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
  { id: "glm-5.1", name: "GLM 5.1" },
];

export function GuidedUsePodSetup({ agent, busy, fleetClass, onCancel, onComplete }: GuidedUsePodSetupProps) {
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState<RegisterResponse | null>(null);
  const [selectedModel, setSelectedModel] = useState(agent?.model || USEPOD_STARTER_MODELS[0].id);
  const [message, setMessage] = useState("");
  const isBusy = registering || busy === "usepod-register";

  async function registerToken() {
    setRegistering(true);
    setMessage("");
    try {
      const response = await fetch("/api/usepod/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saveToEnv: true }),
      });
      const data = await response.json().catch(() => null) as RegisterResponse | null;
      if (!response.ok || !data?.ok) {
        setMessage(data?.error ?? "UsePod registration failed.");
        return;
      }
      setRegistered(data);
      setMessage(`Saved ${data.tokenEnvName ?? "USEPOD_TOKEN"} and ${data.depositEnvName ?? "USEPOD_DEPOSIT_ADDRESS"} to shared env.`);
    } catch {
      setMessage("UsePod registration failed.");
    } finally {
      setRegistering(false);
    }
  }

  async function connectUsePod() {
    await onComplete({
      provider: "usepod",
      model: selectedModel,
      gatewayUrl: "https://api.usepod.ai",
      chatPath: "/v1/chat/completions",
      statusPath: "/v1/models",
      usePod: {
        tokenEnvName: registered?.tokenEnvName ?? agent?.usePod?.tokenEnvName ?? "USEPOD_TOKEN",
        depositAddress: registered?.depositAddress ?? agent?.usePod?.depositAddress ?? "",
        maxPriceInputMicrounits: agent?.usePod?.maxPriceInputMicrounits ?? "",
        maxPriceOutputMicrounits: agent?.usePod?.maxPriceOutputMicrounits ?? "",
      },
    });
  }

  return (
    <section className={fleetClass("guidedProviderSetup")} aria-label="UsePod setup">
      <div className={fleetClass("guidedProviderHeader")}>
        <span className={fleetClass("guidedProviderIcon")} aria-hidden="true">
          <PlugZap />
        </span>
        <div>
          <strong>Connect UsePod</strong>
          <p>Register a funded proxy token, choose a starter model, and route this OpenAI-compatible agent through UsePod.</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Cancel UsePod setup" onClick={onCancel}>
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className={fleetClass("guidedProviderBody")}>
        <label className={fleetClass("agentSettingsField")}>
          <span>Model</span>
          <select value={selectedModel} disabled={isBusy} onChange={(event) => setSelectedModel(event.target.value)}>
            {USEPOD_STARTER_MODELS.map((model) => (
              <option value={model.id} key={model.id}>{model.name ? `${model.name} (${model.id})` : model.id}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={fleetClass("guidedProviderStatusGrid")}>
        <div className={registered?.savedToEnv ? fleetClass("guidedProviderStatus", "ready") : fleetClass("guidedProviderStatus")}>
          {registered?.savedToEnv ? <ShieldCheck aria-hidden="true" /> : <RefreshCcw aria-hidden="true" />}
          <div>
            <strong>{registered?.savedToEnv ? "Token saved" : "Register token"}</strong>
            <p>{registered?.savedToEnv ? `Credential lives in ${registered.tokenEnvName}.` : "Create a UsePod token and save it to shared env."}</p>
          </div>
        </div>
        <div className={registered?.depositAddress ? fleetClass("guidedProviderStatus", "ready") : fleetClass("guidedProviderStatus")}>
          {registered?.depositAddress ? <Check aria-hidden="true" /> : <Coins aria-hidden="true" />}
          <div>
            <strong>{registered?.depositAddress ? "Deposit address ready" : "USDC funding"}</strong>
            <p>{registered?.depositAddress ? registered.depositAddress : "Fund the saved token with Solana USDC before paid inference."}</p>
          </div>
        </div>
      </div>

      {message ? <p className={fleetClass("guidedProviderMessage")}>{message}</p> : null}

      <div className={fleetClass("guidedProviderActions")}>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={registering}>Cancel</Button>
        <Button type="button" variant="secondary" onClick={() => void registerToken()} disabled={isBusy}>
          {registering ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RefreshCcw aria-hidden="true" />}
          Register token
        </Button>
        <Button type="button" onClick={() => void connectUsePod()} disabled={isBusy || !selectedModel}>
          <PlugZap aria-hidden="true" />
          Use UsePod
        </Button>
      </div>
    </section>
  );
}
