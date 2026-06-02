"use client";

import Image from "next/image";
import * as React from "react";
import { ArrowUpRight, Copy, LoaderCircle, RefreshCcw } from "lucide-react";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { Button } from "@/components/ui/button";
import { CopyableCodeLine } from "@/components/ui/copyable-code-line";
import { USEPOD_PROVIDER_BOND_USDC, USEPOD_PROVIDER_EARN_SHARE, USEPOD_SUPPLY_MATRIX } from "@/lib/config/usepod-features";
import type { FleetMachine } from "./fleet-data";
import styles from "./usepod-host-modal.module.css";

const USEPOD_RUNTIME_ICON_PATH = "/icons/runtimes/usepod.webp";

type UsePodHostSetupAction = "status" | "install" | "preflight" | "setup" | "pair-status";

type UsePodProviderStatus = "ready" | "funded" | "needs-bond" | "failed";

type UsePodProviderPreflight = {
  status?: UsePodProviderStatus;
  message?: string;
  walletAddress?: string;
  bondAmountUsdc?: number;
  balanceUsdc?: number;
  depositCode?: string;
  bondSignature?: string;
};

type UsePodHostSetupResponse = {
  ok?: boolean;
  error?: string;
  status?: { installed?: boolean; version?: string } | "starting" | "waiting" | "paired" | "failed" | "idle" | UsePodProviderStatus;
  provider?: UsePodProviderPreflight;
  pairingCode?: string;
  pairingUrl?: string;
  claim?: {
    status?: "claimed" | "missing-token" | "failed";
    message?: string;
    enrolled?: boolean;
    walletAddress?: string;
  } | null;
  output?: string;
  startedAt?: number;
};

const HOST_SETUP_STEPS = [
  { label: "Install", detail: "Provider agent" },
  { label: "Bond", detail: "Operator stake" },
  { label: "Pair", detail: "Machine identity" },
  { label: "Ready", detail: "Provider setup" },
] as const;

export function UsePodHostModal({ machine, onClose }: { machine: FleetMachine; onClose: () => void }) {
  const provider = USEPOD_SUPPLY_MATRIX["provider-agent"];
  const keyRelay = USEPOD_SUPPLY_MATRIX["key-relay"];
  const commands = provider.commands ?? [];
  const [setupStarted, setSetupStarted] = React.useState(false);
  const [setupRunning, setSetupRunning] = React.useState(false);
  const [setupStep, setSetupStep] = React.useState(0);
  const [setupMessage, setSetupMessage] = React.useState("");
  const [setupError, setSetupError] = React.useState("");
  const [pairingCode, setPairingCode] = React.useState("");
  const [pairingUrl, setPairingUrl] = React.useState("");
  const [pairingClaim, setPairingClaim] = React.useState("");
  const [manualFallbackAvailable, setManualFallbackAvailable] = React.useState(false);
  const [providerPreflight, setProviderPreflight] = React.useState<UsePodProviderPreflight | null>(null);
  const needsFunding = providerPreflight?.status === "needs-bond";

  const copyCommands = () => {
    void navigator.clipboard.writeText(commands.join("\n")).catch(() => undefined);
  };

  const callSetupAction = async (action: UsePodHostSetupAction, extra?: Record<string, unknown>) => {
    const response = await fetch("/api/usepod/host/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await response.json().catch(() => null) as UsePodHostSetupResponse | null;
    if (!response.ok || !data?.ok) throw new Error(data?.error || `UsePod host ${action} failed.`);
    return data;
  };

  const waitForPairingReady = async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      const status = await callSetupAction("pair-status");
      if (status.status === "paired") return status;
      if (status.status === "failed") throw new Error(status.error || "UsePod host setup failed.");
    }
    return null;
  };

  const runProviderPreflight = async () => {
    const preflight = await callSetupAction("preflight", { displayName: `HivemindOS ${machine.name}` });
    setProviderPreflight(preflight.provider ?? null);
    if (preflight.provider?.status === "failed") {
      throw new Error(preflight.provider.message || "UsePod provider preflight failed.");
    }
    return preflight.provider ?? null;
  };

  const startAutomaticSetup = async (options?: { skipPreflight?: boolean }) => {
    setSetupRunning(true);
    setSetupError("");
    setPairingCode("");
    setPairingUrl("");
    setPairingClaim("");
    setManualFallbackAvailable(false);
    try {
      if (!options?.skipPreflight) {
        setSetupMessage("Checking provider wallet...");
        const preflight = await runProviderPreflight();
        if (preflight?.status === "needs-bond") {
          setSetupStarted(false);
          setSetupMessage("");
          return;
        }
      }
      setSetupStarted(true);
      setProviderPreflight(null);
      setSetupStep(0);
      setSetupMessage("Checking provider agent...");
      const status = await callSetupAction("status");
      const agentStatus = typeof status.status === "object" ? status.status : null;
      if (!agentStatus?.installed) {
        setSetupMessage("Installing provider agent...");
        await callSetupAction("install");
      }

      setSetupStep(1);
      setSetupMessage("Creating provider identity and posting the operator bond...");
      const setup = await callSetupAction("setup", { displayName: `HivemindOS ${machine.name}` });
      if (setup.pairingCode) setPairingCode(setup.pairingCode);
      if (setup.pairingUrl) setPairingUrl(setup.pairingUrl);
      if (setup.claim?.message) setPairingClaim(setup.claim.message);
      const pairingStatus = typeof setup.status === "string" ? setup.status : "";
      if (pairingStatus === "paired") {
        setSetupStep(4);
        setSetupMessage("UsePod provider setup completed here.");
      } else if (pairingStatus === "needs-bond" || setup.provider?.status === "needs-bond") {
        setSetupStarted(false);
        setProviderPreflight(setup.provider ?? null);
        setSetupMessage("");
      } else if (setup.claim?.status === "claimed") {
        setSetupStep(3);
        setSetupMessage("UsePod accepted the machine. Finishing local provider setup...");
        const finalStatus = await waitForPairingReady();
        if (finalStatus?.status === "paired") {
          setSetupStep(4);
          setSetupMessage("UsePod provider setup completed here.");
        } else {
          setSetupMessage("UsePod accepted the machine. The local provider is still finalizing.");
        }
      } else {
        setManualFallbackAvailable(true);
        setSetupMessage(setup.claim?.message || "Automatic claim failed. Manual pairing is available as a fallback.");
      }
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "UsePod host setup failed.");
    } finally {
      setSetupRunning(false);
    }
  };

  const checkProviderFunding = async () => {
    setSetupRunning(true);
    setSetupError("");
    setSetupMessage("");
    try {
      const preflight = await runProviderPreflight();
      if (!preflight || preflight.status === "needs-bond") return;
      await startAutomaticSetup({ skipPreflight: true });
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "UsePod provider funding check failed.");
    } finally {
      setSetupRunning(false);
    }
  };

  return (
    <div role="presentation" onClick={onClose} className={styles.backdrop}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`UsePod host setup for ${machine.name}`}
        onClick={(event) => event.stopPropagation()}
        className={styles.modal}
      >
        <CloseIconButton
          type="button"
          onClick={onClose}
          aria-label="Close UsePod host setup"
          title="Close"
          className={styles.close}
        />
        <div className={styles.header}>
          <span className={styles.icon} data-active={setupStarted ? "true" : "false"}>
            <span className={styles.orbit} aria-hidden="true" />
            <Image src={USEPOD_RUNTIME_ICON_PATH} alt="" aria-hidden="true" width={34} height={34} unoptimized />
          </span>
          <div>
            <div className={styles.eyebrow}>UsePod provider</div>
            <h2>Rent out {machine.name}</h2>
            <p>Turn this machine into a UsePod provider.</p>
          </div>
        </div>

        <div className={styles.autoPanel}>
          <div className={styles.autoVisual} data-active={setupStarted ? "true" : "false"} aria-hidden="true">
            <span />
            <span />
            <Image src={USEPOD_RUNTIME_ICON_PATH} alt="" width={44} height={44} unoptimized />
          </div>
          {needsFunding ? (
            <div className={styles.fundingPanel} aria-live="polite">
              <div className={styles.fundingHeader}>
                <div>
                  <strong>Fund provider wallet</strong>
                  <p>Deposit Solana USDC here first. HivemindOS will post the operator bond automatically after funding is detected.</p>
                </div>
                <span>USDC</span>
              </div>
              <div className={styles.fundingStats}>
                <div>
                  <span>Current</span>
                  <strong>${(providerPreflight?.balanceUsdc ?? 0).toFixed(2)}</strong>
                </div>
                <div>
                  <span>Required</span>
                  <strong>${(providerPreflight?.bondAmountUsdc ?? USEPOD_PROVIDER_BOND_USDC).toFixed(2)}</strong>
                </div>
              </div>
              {providerPreflight?.walletAddress ? (
                <div className={styles.directDepositField}>
                  <span>Recipient address</span>
                  <CopyableCodeLine value={providerPreflight.walletAddress} label="Copy recipient address" copiedLabel="Address copied" />
                </div>
              ) : null}
              <Button type="button" size="default" onClick={() => void checkProviderFunding()} disabled={setupRunning}>
                {setupRunning ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <RefreshCcw size={15} aria-hidden="true" />}
                {setupRunning ? "Checking" : "Check funding"}
              </Button>
            </div>
          ) : (
            <Button type="button" size="default" onClick={() => void startAutomaticSetup()} disabled={setupRunning}>
              {setupRunning ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <ArrowUpRight size={15} aria-hidden="true" />}
              {setupRunning ? "Setting up" : "Automatic setup"}
            </Button>
          )}
          {setupStarted && !needsFunding ? (
            <div className={styles.setupFlow} aria-live="polite">
              <div className={styles.setupSteps}>
                {HOST_SETUP_STEPS.map((step, index) => {
                  const state = setupError && setupStep === index
                    ? "error"
                    : setupStep > index
                      ? "done"
                      : setupStep === index && setupRunning
                        ? "active"
                        : setupStep >= HOST_SETUP_STEPS.length
                          ? "done"
                          : "idle";
                  return (
                    <div key={step.label} className={styles.setupStep} data-state={state}>
                      <span>{index + 1}</span>
                      <strong>{step.label}</strong>
                      <small>{step.detail}</small>
                    </div>
                  );
                })}
              </div>
              {manualFallbackAvailable && pairingCode ? (
                <button
                  type="button"
                  className={styles.pairingCard}
                  onClick={() => void navigator.clipboard.writeText(pairingCode).catch(() => undefined)}
                >
                  <span>Pairing code</span>
                  <strong>{pairingCode}</strong>
                  {pairingClaim ? <small>{pairingClaim}</small> : null}
                </button>
              ) : null}
              {manualFallbackAvailable && pairingCode && pairingUrl ? (
                <button
                  type="button"
                  className={styles.pairingLink}
                  onClick={() => window.open(pairingUrl, "_blank", "noopener,noreferrer")}
                >
                  <ArrowUpRight size={13} aria-hidden="true" />
                  Open pairing page
                </button>
              ) : null}
            </div>
          ) : null}
          {!needsFunding && !setupStarted ? <div className={styles.stats}>
            <div>
              <span>Bond</span>
              <strong>${USEPOD_PROVIDER_BOND_USDC} USDC</strong>
            </div>
            <div>
              <span>Earn</span>
              <strong>{(USEPOD_PROVIDER_EARN_SHARE * 100).toFixed(0)}%</strong>
            </div>
            <div>
              <span>Mode</span>
              <strong>Compute</strong>
            </div>
          </div> : null}
          {setupMessage ? <p className={styles.status} data-tone={setupError ? "error" : "ok"}>{setupError || setupMessage}</p> : null}
        </div>

        <details className={styles.manual}>
          <summary>Manual setup</summary>
          <div className={styles.commands}>
            {commands.map((command) => (
              <code key={command}>{command}</code>
            ))}
          </div>
          <div className={styles.actions}>
            <button type="button" onClick={copyCommands}>
              <Copy size={13} aria-hidden="true" />
              Copy commands
            </button>
            <button type="button" onClick={() => window.open(keyRelay.docsUrl, "_blank", "noopener,noreferrer")}>
              <ArrowUpRight size={13} aria-hidden="true" />
              Key relay docs
            </button>
          </div>
        </details>
      </section>
    </div>
  );
}
