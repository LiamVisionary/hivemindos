"use client";

import { useState } from "react";
import { ArrowUpRight, Check, Copy, LoaderCircle, PlugZap, RefreshCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import styles from "./UsePodSetup.module.css";

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
  savedToEnv?: boolean;
};

type UsePodStatusResponse = {
  ok?: boolean;
  status?: string;
  message?: string;
  tokenEnvName?: string;
  depositAddress?: string;
  modelCount?: number;
  models?: Array<{ id: string; name?: string }>;
  balanceRemaining?: string;
  route?: string;
  checkedAt?: string;
};

type SpendPreset = "cheapest" | "balanced" | "fast" | "none" | "custom";

const SPEND_PRESETS: Array<{ id: SpendPreset; label: string; input: string; output: string }> = [
  { id: "cheapest", label: "Cheapest", input: "250", output: "1000" },
  { id: "balanced", label: "Balanced", input: "2000", output: "8000" },
  { id: "fast", label: "Fast", input: "10000", output: "30000" },
  { id: "none", label: "No cap", input: "", output: "" },
];

const FALLBACK_MODELS = [
  { id: "gpt-5.5", name: "gpt-5.5" },
  { id: "llama-4", name: "llama-4" },
  { id: "qwen-3.5", name: "qwen-3.5" },
  { id: "deepseek-v3.2", name: "deepseek-v3.2" },
  { id: "glm-5.1", name: "glm-5.1" },
];

function presetForCaps(input = "", output = ""): SpendPreset {
  return SPEND_PRESETS.find((preset) => preset.input === input && preset.output === output)?.id ?? "custom";
}

export function GuidedUsePodSetup({ agent, busy, fleetClass, onCancel, onComplete }: GuidedUsePodSetupProps) {
  const [registering, setRegistering] = useState(false);
  const [checking, setChecking] = useState(false);
  const [registered, setRegistered] = useState<RegisterResponse | null>(null);
  const [status, setStatus] = useState<UsePodStatusResponse | null>(null);
  const [selectedModel, setSelectedModel] = useState(agent?.model || FALLBACK_MODELS[0].id);
  const [spendPreset, setSpendPreset] = useState<SpendPreset>(
    agent?.usePod?.spendPreset ?? presetForCaps(agent?.usePod?.maxPriceInputMicrounits, agent?.usePod?.maxPriceOutputMicrounits),
  );
  const [customCaps, setCustomCaps] = useState({
    input: agent?.usePod?.maxPriceInputMicrounits ?? "",
    output: agent?.usePod?.maxPriceOutputMicrounits ?? "",
  });
  const [message, setMessage] = useState("");
  const [copiedDeposit, setCopiedDeposit] = useState(false);
  const discoveredModels = status?.models?.length ? status.models : [];
  const modelOptions = discoveredModels.length ? discoveredModels : FALLBACK_MODELS;
  const activePreset = SPEND_PRESETS.find((preset) => preset.id === spendPreset);
  const inputCap = spendPreset === "custom" ? customCaps.input : activePreset?.input ?? "";
  const outputCap = spendPreset === "custom" ? customCaps.output : activePreset?.output ?? "";
  const depositAddress = registered?.depositAddress || status?.depositAddress || agent?.usePod?.depositAddress || "";
  const tokenEnvName = status?.tokenEnvName || registered?.tokenEnvName || agent?.usePod?.tokenEnvName || "USEPOD_TOKEN";
  const isBusy = registering || checking || busy === "usepod-register";
  const flowStep = discoveredModels.length ? "ready" : depositAddress ? "fund" : "start";
  const title = flowStep === "ready" ? "UsePod is ready" : flowStep === "fund" ? "Fund UsePod" : "Set up UsePod";
  const body = flowStep === "ready"
    ? "Pick a model and save it to this agent."
    : flowStep === "fund"
      ? "Send USDC to the address below, then continue."
      : "Create a prepaid UsePod token for this agent.";

  function profilePatchFromState(extra?: Partial<AgentProfile["usePod"]>): Partial<AgentProfile> {
    return {
      provider: "usepod",
      model: selectedModel,
      gatewayUrl: "https://api.usepod.ai",
      chatPath: "/v1/chat/completions",
      statusPath: "/v1/models",
      usePod: {
        tokenEnvName,
        depositAddress,
        maxPriceInputMicrounits: inputCap,
        maxPriceOutputMicrounits: outputCap,
        spendPreset,
        lastBalanceRemaining: status?.balanceRemaining ?? agent?.usePod?.lastBalanceRemaining ?? "",
        lastRoute: status?.route ?? agent?.usePod?.lastRoute ?? "",
        lastCheckedAt: status?.checkedAt ?? agent?.usePod?.lastCheckedAt ?? "",
        lastTestStatus: status?.status ?? agent?.usePod?.lastTestStatus ?? "",
        lastModelCount: status?.modelCount ?? agent?.usePod?.lastModelCount,
        ...extra,
      },
    };
  }

  async function discoverModels(registration?: RegisterResponse) {
    setChecking(true);
    setMessage("");
    try {
      const response = await fetch("/api/usepod/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: {
            ...(agent ?? {}),
            ...profilePatchFromState({
              tokenEnvName: registration?.tokenEnvName ?? tokenEnvName,
              depositAddress: registration?.depositAddress ?? depositAddress,
            }),
          },
          action: "models",
          model: selectedModel,
        }),
      });
      const data = await response.json().catch(() => null) as UsePodStatusResponse | null;
      if (!data) {
        setMessage("UsePod did not return model data.");
        return;
      }
      setStatus(data);
      const nextModel = data.models?.[0]?.id;
      if (nextModel && !data.models?.some((model) => model.id === selectedModel)) setSelectedModel(nextModel);
      setMessage(data.message ?? (data.ok ? "Models found." : "Funding may still be pending."));
      await onComplete(profilePatchFromState({
        tokenEnvName: data.tokenEnvName ?? registration?.tokenEnvName ?? tokenEnvName,
        depositAddress: data.depositAddress ?? registration?.depositAddress ?? depositAddress,
        lastBalanceRemaining: data.balanceRemaining ?? "",
        lastRoute: data.route ?? "",
        lastCheckedAt: data.checkedAt ?? "",
        lastTestStatus: data.status ?? "",
        lastModelCount: data.modelCount,
      }));
    } catch {
      setMessage("UsePod model discovery failed.");
    } finally {
      setChecking(false);
    }
  }

  async function setUpUsePod() {
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
        setMessage(data?.error ?? "UsePod setup failed.");
        return;
      }
      setRegistered(data);
      setStatus((current) => ({
        ...(current ?? {}),
        status: current?.status ?? "registered",
        tokenEnvName: data.tokenEnvName ?? "USEPOD_TOKEN",
        depositAddress: data.depositAddress ?? "",
        modelCount: current?.modelCount ?? 0,
        models: current?.models ?? [],
        checkedAt: current?.checkedAt ?? new Date().toISOString(),
      }));
      await onComplete(profilePatchFromState({
        tokenEnvName: data.tokenEnvName ?? "USEPOD_TOKEN",
        depositAddress: data.depositAddress ?? "",
        lastTestStatus: "registered",
      }));
      await discoverModels(data);
    } catch {
      setMessage("UsePod setup failed.");
    } finally {
      setRegistering(false);
    }
  }

  async function saveUsePod() {
    await onComplete(profilePatchFromState());
    onCancel();
  }

  async function copyDepositAddress() {
    if (!depositAddress) return;
    try {
      await navigator.clipboard.writeText(depositAddress);
      setCopiedDeposit(true);
      window.setTimeout(() => setCopiedDeposit(false), 1200);
    } catch {
      setMessage("Could not copy the deposit address.");
    }
  }

  return (
    <section className={fleetClass("guidedProviderSetup")} aria-label="UsePod setup">
      <div className={fleetClass("guidedProviderHeader")}>
        <span className={fleetClass("guidedProviderIcon")} aria-hidden="true">
          <PlugZap />
        </span>
        <div>
          <strong>{title}</strong>
          <p>{body}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Close UsePod setup" onClick={onCancel}>
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className={styles.stepRail} aria-hidden="true">
        {["Token", "Fund", "Model"].map((step, index) => {
          const activeIndex = flowStep === "ready" ? 2 : flowStep === "fund" ? 1 : 0;
          return (
            <span className={index <= activeIndex ? `${styles.stepPill} ${styles.active}` : styles.stepPill} key={step}>
              {index < activeIndex ? <Check /> : null}
              {step}
            </span>
          );
        })}
      </div>

      {flowStep === "start" ? (
        <div className={styles.focusPanel}>
          <strong>{tokenEnvName}</strong>
          <p>Stored in shared env for this machine.</p>
        </div>
      ) : null}

      {flowStep === "fund" ? (
        <div className={styles.depositPanel}>
          <span>Deposit address</span>
          <strong>{depositAddress}</strong>
          <div className={styles.inlineActions}>
            <Button type="button" variant="secondary" size="sm" onClick={() => void copyDepositAddress()}>
              <Copy aria-hidden="true" />
              {copiedDeposit ? "Copied" : "Copy"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => window.open(`https://solscan.io/account/${encodeURIComponent(depositAddress)}`, "_blank", "noopener,noreferrer")}
            >
              <ArrowUpRight aria-hidden="true" />
              Open
            </Button>
          </div>
        </div>
      ) : null}

      {flowStep === "ready" ? (
        <div className={fleetClass("guidedProviderBody")}>
          <label className={fleetClass("agentSettingsField")}>
            <span>Model</span>
            <select value={selectedModel} disabled={isBusy} onChange={(event) => setSelectedModel(event.target.value)}>
              {modelOptions.map((model) => (
                <option value={model.id} key={model.id}>{model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id}</option>
              ))}
            </select>
          </label>
          {status?.balanceRemaining || status?.route ? (
            <div className={styles.focusPanel}>
              {status.balanceRemaining ? <p>Balance: {status.balanceRemaining}</p> : null}
              {status.route ? <p>Route: {status.route}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <details className={fleetClass("adaptiveAdvanced")}>
        <summary>
          <span>Spend cap</span>
          <small>{spendPreset === "custom" ? "Custom" : activePreset?.label ?? "Balanced"}</small>
        </summary>
        <div className={styles.spendPanel}>
          <div className={styles.presetGroup} role="group" aria-label="UsePod spend cap preset">
            {SPEND_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className={spendPreset === preset.id ? `${styles.preset} ${styles.selected}` : styles.preset}
                aria-pressed={spendPreset === preset.id}
                disabled={isBusy}
                onClick={() => setSpendPreset(preset.id)}
              >
                <strong>{preset.label}</strong>
              </button>
            ))}
          </div>
          <div className={fleetClass("adaptiveAdvancedGrid")}>
            <label className={fleetClass("agentSettingsField")}>
              <span>Input cap</span>
              <input
                type="number"
                min="0"
                step="1000"
                value={inputCap}
                onChange={(event) => {
                  setSpendPreset("custom");
                  setCustomCaps((current) => ({ ...current, input: event.target.value }));
                }}
                placeholder="Microunits"
              />
            </label>
            <label className={fleetClass("agentSettingsField")}>
              <span>Output cap</span>
              <input
                type="number"
                min="0"
                step="1000"
                value={outputCap}
                onChange={(event) => {
                  setSpendPreset("custom");
                  setCustomCaps((current) => ({ ...current, output: event.target.value }));
                }}
                placeholder="Microunits"
              />
            </label>
          </div>
        </div>
      </details>

      {message ? <p className={fleetClass("guidedProviderMessage")}>{message}</p> : null}

      <div className={fleetClass("guidedProviderActions")}>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={registering}>Cancel</Button>
        {flowStep === "start" ? (
          <Button type="button" onClick={() => void setUpUsePod()} disabled={isBusy}>
            {registering ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <PlugZap aria-hidden="true" />}
            Set up UsePod
          </Button>
        ) : flowStep === "fund" ? (
          <Button type="button" onClick={() => void discoverModels()} disabled={isBusy}>
            {checking ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RefreshCcw aria-hidden="true" />}
            I funded it
          </Button>
        ) : (
          <Button type="button" onClick={() => void saveUsePod()} disabled={isBusy || !selectedModel}>
            <PlugZap aria-hidden="true" />
            Use this model
          </Button>
        )}
      </div>
    </section>
  );
}
