"use client";

import { useMemo, useState } from "react";
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
  depositCode?: string;
  dashboardUrl?: string;
  fundingUrl?: string;
  savedToEnv?: boolean;
};

type UsePodStatusResponse = {
  ok?: boolean;
  status?: string;
  message?: string;
  tokenEnvName?: string;
  depositAddress?: string;
  depositCode?: string;
  dashboardUrl?: string;
  modelCount?: number;
  models?: Array<{ id: string; name?: string }>;
  balanceRemaining?: string;
  route?: string;
  checkedAt?: string;
};

type SpendPreset = "cheapest" | "balanced" | "fast" | "none" | "custom";
type SetupStep = 1 | 2 | 3;

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

function usePodFundingUrl(registration: RegisterResponse | null, agent?: AgentProfile | null) {
  return registration?.fundingUrl
    || registration?.dashboardUrl
    || agent?.usePod?.dashboardUrl
    || "";
}

export function GuidedUsePodSetup({ agent, busy, fleetClass, onCancel, onComplete }: GuidedUsePodSetupProps) {
  const initialStep: SetupStep = agent?.usePod?.lastModelCount ? 3 : agent?.usePod?.dashboardUrl || agent?.usePod?.depositCode || agent?.usePod?.depositAddress ? 2 : 1;
  const [currentStep, setCurrentStep] = useState<SetupStep>(initialStep);
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
  const [copiedCode, setCopiedCode] = useState(false);
  const [fundingOpened, setFundingOpened] = useState(Boolean(agent?.usePod?.dashboardUrl));
  const discoveredModels = status?.models?.length ? status.models : [];
  const modelOptions = discoveredModels.length ? discoveredModels : FALLBACK_MODELS;
  const activePreset = SPEND_PRESETS.find((preset) => preset.id === spendPreset);
  const inputCap = spendPreset === "custom" ? customCaps.input : activePreset?.input ?? "";
  const outputCap = spendPreset === "custom" ? customCaps.output : activePreset?.output ?? "";
  const tokenEnvName = status?.tokenEnvName || registered?.tokenEnvName || agent?.usePod?.tokenEnvName || "USEPOD_TOKEN";
  const depositAddress = registered?.depositAddress || status?.depositAddress || agent?.usePod?.depositAddress || "";
  const depositCode = registered?.depositCode || status?.depositCode || agent?.usePod?.depositCode || "";
  const dashboardUrl = usePodFundingUrl(registered, agent) || status?.dashboardUrl || (depositCode ? "https://usepod.ai/fund" : "");
  const isBusy = registering || checking || busy === "usepod-register";
  const headerCopy = useMemo(() => {
    if (currentStep === 1) return { title: "Create UsePod token", body: "HivemindOS will create and save it automatically." };
    if (currentStep === 2) return { title: "Fund UsePod", body: "Finish the top-up in UsePod, then come back here." };
    return { title: "Choose model", body: "Pick the model this agent should use." };
  }, [currentStep]);

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
        depositCode,
        dashboardUrl,
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

  function openFundingPage(url = dashboardUrl) {
    if (!url) return false;
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    setFundingOpened(Boolean(opened));
    return Boolean(opened);
  }

  async function discoverModels() {
    setChecking(true);
    setMessage("");
    try {
      const response = await fetch("/api/usepod/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: { ...(agent ?? {}), ...profilePatchFromState() },
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
      const resolvedModel = data.models?.some((model) => model.id === selectedModel) ? selectedModel : nextModel || selectedModel;
      if (resolvedModel !== selectedModel) setSelectedModel(resolvedModel);
      await onComplete({
        ...profilePatchFromState({
          tokenEnvName: data.tokenEnvName ?? tokenEnvName,
          depositAddress: data.depositAddress ?? depositAddress,
          depositCode: data.depositCode ?? depositCode,
          dashboardUrl: data.dashboardUrl ?? dashboardUrl,
          lastBalanceRemaining: data.balanceRemaining ?? "",
          lastRoute: data.route ?? "",
          lastCheckedAt: data.checkedAt ?? "",
          lastTestStatus: data.status ?? "",
          lastModelCount: data.modelCount,
        }),
        model: resolvedModel,
      });
      if (data.models?.length) {
        setCurrentStep(3);
        setMessage("");
        return;
      }
      setMessage(data.message ?? "Funding may still be pending. Try again after UsePod confirms the top-up.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "UsePod model discovery failed.");
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
        setMessage(data?.error ?? `UsePod setup failed with HTTP ${response.status}.`);
        return;
      }
      const nextFundingUrl = data.fundingUrl || data.dashboardUrl || "";
      setRegistered(data);
      setStatus((current) => ({
        ...(current ?? {}),
        status: current?.status ?? "registered",
        tokenEnvName: data.tokenEnvName ?? "USEPOD_TOKEN",
        depositAddress: data.depositAddress ?? "",
        depositCode: data.depositCode ?? "",
        dashboardUrl: nextFundingUrl,
        modelCount: current?.modelCount ?? 0,
        models: current?.models ?? [],
        checkedAt: current?.checkedAt ?? new Date().toISOString(),
      }));
      await onComplete(profilePatchFromState({
        tokenEnvName: data.tokenEnvName ?? "USEPOD_TOKEN",
        depositAddress: data.depositAddress ?? "",
        depositCode: data.depositCode ?? "",
        dashboardUrl: nextFundingUrl,
        lastTestStatus: "registered",
      }));
      setCurrentStep(2);
      if (nextFundingUrl && openFundingPage(nextFundingUrl)) {
        setMessage("Funding page opened.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "UsePod setup failed.");
    } finally {
      setRegistering(false);
    }
  }

  async function saveUsePod() {
    await onComplete(profilePatchFromState());
    onCancel();
  }

  async function copyDepositCode() {
    if (!depositCode) return;
    try {
      await navigator.clipboard.writeText(depositCode);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1200);
    } catch {
      setMessage("Could not copy the funding code.");
    }
  }

  return (
    <section className={fleetClass("guidedProviderSetup")} aria-label="UsePod setup">
      <div className={fleetClass("guidedProviderHeader")}>
        <span className={fleetClass("guidedProviderIcon")} aria-hidden="true">
          <PlugZap />
        </span>
        <div>
          <strong>{headerCopy.title}</strong>
          <p>{headerCopy.body}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Close UsePod setup" onClick={onCancel}>
          <X aria-hidden="true" />
        </Button>
      </div>

      <ol className={styles.stepRail} aria-label="UsePod setup steps">
        {[1, 2, 3].map((step) => (
          <li className={step <= currentStep ? `${styles.stepPill} ${styles.active}` : styles.stepPill} key={step}>
            {step < currentStep ? <Check aria-hidden="true" /> : null}
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {currentStep === 1 ? (
        <div className={styles.focusPanel}>
          <strong>Create token</strong>
          <p>HivemindOS creates and saves it for this agent.</p>
          <div className={styles.cardActions}>
            <Button type="button" onClick={() => void setUpUsePod()} disabled={isBusy}>
              {registering ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <PlugZap aria-hidden="true" />}
              Create token
            </Button>
          </div>
        </div>
      ) : null}

      {currentStep === 2 ? (
        <div className={styles.focusPanel}>
          <strong>Fund UsePod</strong>
          <p>Top up with card or Solana USDC in UsePod.</p>
          {depositCode ? (
            <button type="button" className={styles.copyLine} onClick={() => void copyDepositCode()}>
              <Copy aria-hidden="true" />
              {copiedCode ? "Copied funding code" : "Copy funding code"}
            </button>
          ) : null}
          <div className={styles.cardActions}>
            <Button type="button" variant="secondary" onClick={() => openFundingPage()} disabled={!dashboardUrl}>
              <ArrowUpRight aria-hidden="true" />
              {fundingOpened ? "Reopen funding" : "Open funding"}
            </Button>
            <Button type="button" onClick={() => void discoverModels()} disabled={isBusy}>
              {checking ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RefreshCcw aria-hidden="true" />}
              I funded it
            </Button>
          </div>
        </div>
      ) : null}

      {currentStep === 3 ? (
        <>
          <div className={styles.focusPanel}>
            <strong>Choose model</strong>
            <label className={fleetClass("agentSettingsField")}>
              <span>Model</span>
              <select value={selectedModel} disabled={isBusy} onChange={(event) => setSelectedModel(event.target.value)}>
                {modelOptions.map((model) => (
                  <option value={model.id} key={model.id}>{model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id}</option>
                ))}
              </select>
            </label>
            <div className={styles.cardActions}>
              <Button type="button" onClick={() => void saveUsePod()} disabled={isBusy || !selectedModel}>
                <PlugZap aria-hidden="true" />
                Use this model
              </Button>
            </div>
          </div>
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
        </>
      ) : null}

      {message ? <p className={fleetClass("guidedProviderMessage")}>{message}</p> : null}
    </section>
  );
}
